import json
import logging
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import mysql.connector
import requests
from requests import exceptions as requests_exceptions


def get_runtime_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


BASE_DIR = get_runtime_base_dir()
LOG_DIR = BASE_DIR
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "mrrtallysync.log"
DEBUG_XML_DIR = LOG_DIR / "mrr_tally_xml_debug"
DEBUG_XML_DIR.mkdir(parents=True, exist_ok=True)
REQUEST_TIMEOUT = 20


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_mrr_posting")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    logger.propagate = False
    return logger


LOGGER = setup_logger()
ITEM_NAME_CACHE: dict[str, str | None] = {}
STOCK_ITEM_LOOKUP_CACHE: dict[str, tuple[str, str | None]] = {}
CONFIRMED_TALLY_UNITS: set[str] = set()


class TallyUnavailableError(RuntimeError):
    pass


def _sanitize_debug_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return cleaned.strip("._-") or "unnamed"


def dump_tally_xml(debug_step: str, xml_text: str, voucher_no: str | None = None) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    file_name = f"{timestamp}__{_sanitize_debug_name(voucher_no or 'general')}__{_sanitize_debug_name(debug_step)}.xml"
    target = DEBUG_XML_DIR / file_name
    target.write_text(xml_text, encoding="utf-8")
    return target


def normalize_lookup_key(value: Any) -> str:
    text = str(value or "").strip().upper()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[^A-Z0-9]+", "", text)
    return text


def clean_tally_xml(xml_text: str) -> str:
    cleaned = str(xml_text or "")
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", cleaned)
    cleaned = re.sub(r"&#(?:0?[0-8]|1[12]|1[4-9]|2[0-9]|3[01]);", "", cleaned)
    cleaned = re.sub(r"&#x(?:[0-8]|[bBcCeE]|1[0-9A-Fa-f]);", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def load_env_file() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()

DB_CONFIG = {
    "host": "193.203.184.152",
    "user": "u380633007_lnpidata",
    "password": "!Office1@",
    "database": "u380633007_lnpidata",
    "port": 3306,
    "use_pure": True,
}

PURCHASE_LEDGER_BY_MRR = {
    "Reel": "PURCHASE PAPER",
    "Others": "Purchase Other RM",
    "FG Purchase": "Purchase - FG",
    "Rejection In": "Purchase - Rejection In",
}

STOCK_GROUP_BY_MRR = {
    "Reel": "KRAFT PAPER",
    "Others": "App Group",
    "FG Purchase": "FG- FINISHED GOODS",
    "Rejection In": "FG- FINISHED GOODS",
}

SUPPLIER_GROUP_HINT_BY_MRR = {
    "Reel": "SUNDRY CREDITORS - PAPER",
    "Others": "SUNDRY CREDITORS - OTHERS",
    "FG Purchase": "Sundry Creditors",
    "Rejection In": "Sundry Creditors",
    "Service Return": "Sundry Creditors",
}


def build_tally_url_candidates() -> list[str]:
    candidates: list[str] = []
    preferred = [
        os.getenv("LNPI_TALLY_URL"),
        "http://localhost:9004",
        "http://127.0.0.1:9004",
    ]
    for url in preferred:
        if not url:
            continue
        cleaned = str(url).strip()
        if cleaned and cleaned not in candidates:
            candidates.append(cleaned)
    return candidates


TALLY_URL_CANDIDATES = build_tally_url_candidates()
ACTIVE_TALLY_URL: str | None = None


def to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except Exception:
        return 0.0


def escape_xml(text: Any) -> str:
    value = "" if text is None else str(text)
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _parse_tally_date(raw_value: Any) -> datetime | None:
    raw_text = str(raw_value or "").strip()
    if not raw_text:
        return None

    if re.fullmatch(r"\d{8}", raw_text):
        return datetime(int(raw_text[:4]), int(raw_text[4:6]), int(raw_text[6:8]))

    try:
        return datetime.fromisoformat(raw_text.replace("Z", "+00:00"))
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%d-%b-%Y %H:%M:%S",
        "%d-%B-%Y %H:%M:%S",
    ):
        try:
            return datetime.strptime(raw_text, fmt)
        except ValueError:
            pass

    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw_text)
    if match:
        year, month, day = match.groups()
        return datetime(int(year), int(month), int(day))

    match = re.match(r"^(\d{2})-(\d{2})-(\d{4})", raw_text)
    if match:
        day, month, year = match.groups()
        return datetime(int(year), int(month), int(day))

    return None


def format_tally_date(mrr: dict[str, Any]) -> str:
    inv_date = mrr.get("invDate") or mrr.get("InvDate") or mrr.get("inv_date") or mrr.get("invdate")
    for raw in (
        inv_date,
        mrr.get("date"),
        mrr.get("Date"),
        mrr.get("timestamp"),
        mrr.get("ts"),
        mrr.get("createdAt"),
    ):
        parsed = _parse_tally_date(raw)
        if parsed:
            return parsed.strftime("%Y%m%d")

    raise RuntimeError(
        "Voucher date could not be resolved from invDate/date/timestamp. "
        f"invDate={inv_date!r}, date={mrr.get('date')!r}, timestamp={mrr.get('timestamp')!r}"
    )


def resolve_voucher_datetime(mrr: dict[str, Any]) -> datetime:
    inv_date = mrr.get("invDate") or mrr.get("InvDate") or mrr.get("inv_date") or mrr.get("invdate")
    for raw in (
        inv_date,
        mrr.get("date"),
        mrr.get("Date"),
        mrr.get("timestamp"),
        mrr.get("ts"),
        mrr.get("createdAt"),
    ):
        parsed = _parse_tally_date(raw)
        if parsed:
            return parsed

    raise RuntimeError(
        "Voucher date could not be resolved from invDate/date/timestamp. "
        f"invDate={inv_date!r}, date={mrr.get('date')!r}, timestamp={mrr.get('timestamp')!r}"
    )


def get_financial_year_bounds(voucher_date: datetime) -> tuple[str, str]:
    fy_start_year = voucher_date.year if voucher_date.month >= 4 else voucher_date.year - 1
    fy_start = datetime(fy_start_year, 4, 1)
    fy_end = datetime(fy_start_year + 1, 3, 31)
    return fy_start.strftime("%Y%m%d"), fy_end.strftime("%Y%m%d")

def post_xml_to_tally(xml_text: str, debug_step: str = "unknown", voucher_no: str | None = None) -> str:
    global ACTIVE_TALLY_URL

    urls_to_try = [ACTIVE_TALLY_URL] if ACTIVE_TALLY_URL else []
    urls_to_try.extend([url for url in TALLY_URL_CANDIDATES if url not in urls_to_try])
    last_error: Exception | None = None
    xml_dump_path = dump_tally_xml(debug_step, xml_text, voucher_no)
    LOGGER.info(
        "Sending Tally XML | step=%s | voucher=%s | payload=%s",
        debug_step,
        voucher_no or "-",
        xml_dump_path,
    )

    for url in urls_to_try:
        try:
            response = requests.post(
                url,
                data=xml_text.encode("utf-8"),
                headers={"Content-Type": "application/xml"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            if ACTIVE_TALLY_URL != url:
                LOGGER.info("Connected to Tally at %s", url)
            LOGGER.info(
                "Tally XML completed | step=%s | voucher=%s | url=%s | response_chars=%s",
                debug_step,
                voucher_no or "-",
                url,
                len(response.text or ""),
            )
            ACTIVE_TALLY_URL = url
            return response.text
        except requests_exceptions.Timeout as error:
            LOGGER.warning(
                "Tally timed out | step=%s | voucher=%s | url=%s | timeout=%ss | payload=%s",
                debug_step,
                voucher_no or "-",
                url,
                REQUEST_TIMEOUT,
                xml_dump_path,
            )
            last_error = error
        except requests_exceptions.ConnectionError as error:
            LOGGER.warning(
                "Tally not reachable | step=%s | voucher=%s | url=%s | payload=%s",
                debug_step,
                voucher_no or "-",
                url,
                xml_dump_path,
            )
            last_error = error
        except requests_exceptions.RequestException as error:
            LOGGER.warning(
                "Tally request failed | step=%s | voucher=%s | url=%s | payload=%s | error=%s",
                debug_step,
                voucher_no or "-",
                url,
                xml_dump_path,
                error,
            )
            last_error = error

    urls_text = ", ".join(urls_to_try)
    raise TallyUnavailableError(
        f"Cannot connect to Tally on the configured URLs: {urls_text}. "
        f"Last step='{debug_step}', voucher='{voucher_no or '-'}', payload='{xml_dump_path}'. "
        "This usually means Tally XML/HTTP is not enabled on port 9004, or another app is using that port. "
        "If your Tally runs on a different port, set LNPI_TALLY_URL before running."
    ) from last_error


def build_company_static_variables(company_name: str | None) -> str:
    if not company_name:
        return ""
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>"


def check_tally_health(company_name: str | None, reason: str = "health_check") -> None:
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>DATA</TYPE>
            <ID>Units</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    post_xml_to_tally(xml_text, debug_step=f"health_check:{reason}")


def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as error:
        host = DB_CONFIG.get("host")
        port = DB_CONFIG.get("port")
        database = DB_CONFIG.get("database")
        user = DB_CONFIG.get("user")
        raise RuntimeError(
            f"Cannot connect to MySQL at {host}:{port} (DB: {database}, User: {user}). "
            f"Original error: {error}"
        ) from error


def ensure_db_connection(conn):
    try:
        conn.ping(reconnect=True, attempts=3, delay=2)
        return conn
    except mysql.connector.Error:
        try:
            conn.close()
        except Exception:
            pass
        return get_db_connection()


def get_pending_mrrs(conn):
    conn = ensure_db_connection(conn)
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT `id`, `transactionNo`, `mrrType`, `date`, `timestamp`, `invoiceNo`, `invDate`, `supplierId`,
               `totalAmount`, `totalCgst`, `totalSgst`, `totalIgst`,
               `insurance`, `otherCharges`, `roundOff`, `lines`, `status`, `tallyTimestamp`
        FROM `material_in`
        WHERE (`tallyTimestamp` IS NULL OR `tallyTimestamp` = '')
        ORDER BY `timestamp` ASC, `transactionNo` ASC
        """
    )
    rows = cursor.fetchall()
    cursor.close()
    return rows


def resolve_party_name(conn, supplier_id: str) -> tuple[str | None, str | None]:
    conn = ensure_db_connection(conn)
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT `name` FROM `suppliers` WHERE `id` = %s LIMIT 1", (supplier_id,))
        row = cursor.fetchone()
        supplier_name = str((row or {}).get("name") or "").strip()
        if supplier_name:
            return supplier_name, "suppliers"

        cursor.execute("SELECT `name` FROM `companies` WHERE `id` = %s LIMIT 1", (supplier_id,))
        row = cursor.fetchone()
        company_name = str((row or {}).get("name") or "").strip()
        if company_name:
            return company_name, "companies"

        return None, None
    finally:
        cursor.close()


def get_supplier_name(conn, supplier_id: str, mrr_type: str) -> tuple[str, str]:
    party_name, source_table = resolve_party_name(conn, supplier_id)
    if party_name and source_table:
        return party_name, source_table
    group_hint = SUPPLIER_GROUP_HINT_BY_MRR.get(mrr_type, "Sundry Creditors")
    raise RuntimeError(
        f"Party ledger name is missing for supplierId={supplier_id}. "
        f"Checked both suppliers and companies tables. "
        f"Create the ledger in Tally under '{group_hint}' and keep the same name in LNPI master."
    )


def resolve_stock_item_name(conn, line: dict[str, Any]) -> tuple[str, str]:
    direct_name = str(line.get("itemName") or "").strip()
    if direct_name:
        return direct_name, "line.itemName"

    line_item_id = str(line.get("itemId") or "").strip()
    material_id = str(line.get("materialId") or "").strip()
    npd_id = str(line.get("npdId") or "").strip()

    lookup_keys = [
        ("materials", material_id),
        ("materials", line_item_id),
        ("items", line_item_id),
        ("npd", npd_id),
        ("npd", line_item_id),
    ]

    conn = ensure_db_connection(conn)
    cursor = conn.cursor(dictionary=True)
    try:
        for table, lookup_id in lookup_keys:
            if not lookup_id:
                continue
            cache_key = f"{table}:{lookup_id}"
            if cache_key in ITEM_NAME_CACHE:
                cached = ITEM_NAME_CACHE[cache_key]
                if cached:
                    return cached, cache_key
                continue

            if table == "materials":
                cursor.execute("SELECT `name` FROM `materials` WHERE `id` = %s LIMIT 1", (lookup_id,))
                row = cursor.fetchone()
                resolved = str((row or {}).get("name") or "").strip() or None
            elif table == "items":
                cursor.execute("SELECT `name` FROM `items` WHERE `id` = %s LIMIT 1", (lookup_id,))
                row = cursor.fetchone()
                resolved = str((row or {}).get("name") or "").strip() or None
            else:
                cursor.execute("SELECT `itemName` FROM `npd` WHERE `id` = %s LIMIT 1", (lookup_id,))
                row = cursor.fetchone()
                resolved = str((row or {}).get("itemName") or "").strip() or None

            ITEM_NAME_CACHE[cache_key] = resolved
            if resolved:
                return resolved, cache_key
    finally:
        cursor.close()

    raise RuntimeError(
        "Stock item name could not be resolved. "
        f"line.itemId={line_item_id or '-'}, materialId={material_id or '-'}, npdId={npd_id or '-'}"
    )


def parse_lines(lines_raw: Any) -> list[dict[str, Any]]:
    if not lines_raw:
        return []
    if isinstance(lines_raw, list):
        return lines_raw
    if isinstance(lines_raw, str):
        return json.loads(lines_raw)
    return list(lines_raw)


def voucher_exists_in_tally(company_name: str | None, voucher_number: str, voucher_type: str) -> bool:
    safe_number = escape_xml(voucher_number)
    safe_type = escape_xml(voucher_type)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>DATA</TYPE>
            <ID>Voucher Number</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVFROMDATE>20240101</SVFROMDATE>
                    <SVTODATE>20991231</SVTODATE>
                    <VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="CheckVoucher" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>VoucherNumber</FETCH>
                            <FILTERS>OnlyTargetVoucher</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="OnlyTargetVoucher">$$StringEqual:$VoucherNumber:"{safe_number}"</SYSTEM>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    try:
        response_text = post_xml_to_tally(xml_text, debug_step="voucher_exists_check", voucher_no=voucher_number)
    except TallyUnavailableError:
        raise
    except Exception as error:
        LOGGER.warning("Voucher existence check failed for %s: %s", voucher_number, error)
        return False
    return safe_number in response_text


def _safe_tally_text(element: ET.Element | None, tag_name: str) -> str:
    if element is None:
        return ""
    child = element.find(tag_name)
    if child is None:
        return ""
    return str(child.text or "").strip()


def fetch_tally_vouchers_for_duplicate_check(
    company_name: str | None,
    voucher_type: str,
    supplier_name: str,
    from_date: str,
    to_date: str,
) -> list[dict[str, str]]:
    safe_type = escape_xml(voucher_type)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>DupCheckVouchers</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVFROMDATE>{from_date}</SVFROMDATE>
                    <SVTODATE>{to_date}</SVTODATE>
                    <VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="DupCheckVouchers" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>Date</FETCH>
                            <FETCH>VoucherNumber</FETCH>
                            <FETCH>Reference</FETCH>
                            <FETCH>Narration</FETCH>
                            <FETCH>PartyLedgerName</FETCH>
                            <FILTERS>OnlySupplierVouchers</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="OnlySupplierVouchers">
                            $$StringEqual:$$StringUpper:$$String:$PartyLedgerName:"{escape_xml(supplier_name.upper())}"
                        </SYSTEM>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(
        xml_text,
        debug_step=f"duplicate_check_fetch:{voucher_type}:{supplier_name}",
        voucher_no="-",
    )
    cleaned = clean_tally_xml(response_text)
    if not cleaned:
        return []

    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError as error:
        LOGGER.warning("Could not parse Tally duplicate-check response for supplier %s: %s", supplier_name, error)
        return []

    vouchers: list[dict[str, str]] = []
    seen_keys: set[tuple[str, str, str, str, str]] = set()
    for element in root.findall(".//VOUCHER") + root.findall(".//VOUCHERS.LIST/*"):
        voucher_date = _safe_tally_text(element, "DATE")
        voucher_number = _safe_tally_text(element, "VOUCHERNUMBER")
        reference = _safe_tally_text(element, "REFERENCE")
        narration = _safe_tally_text(element, "NARRATION")
        party = _safe_tally_text(element, "PARTYLEDGERNAME")
        key = (voucher_date, voucher_number, reference, narration, party)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        vouchers.append(
            {
                "date": voucher_date,
                "voucher_number": voucher_number,
                "reference": reference,
                "narration": narration,
                "party": party,
            }
        )

    LOGGER.info(
        "Fetched %s voucher(s) for duplicate check | supplier=%s | type=%s | from=%s | to=%s",
        len(vouchers),
        supplier_name,
        voucher_type,
        from_date,
        to_date,
    )
    return vouchers


def find_duplicate_voucher(
    company_name: str | None,
    voucher_type: str,
    supplier_name: str,
    transaction_no: str,
    invoice_no: str,
    voucher_date: datetime,
    mrr_type: str,
) -> dict[str, str] | None:
    from_date, to_date = get_financial_year_bounds(voucher_date)
    vouchers = fetch_tally_vouchers_for_duplicate_check(
        company_name=company_name,
        voucher_type=voucher_type,
        supplier_name=supplier_name,
        from_date=from_date,
        to_date=to_date,
    )
    target_narration = f"Imported from LNPI MRR {transaction_no} | Type: {mrr_type}".strip()
    normalized_target_narration = normalize_lookup_key(target_narration)
    normalized_target_reference = normalize_lookup_key(invoice_no)

    for voucher in vouchers:
        narration = str(voucher.get("narration") or "").strip()
        reference = str(voucher.get("reference") or "").strip()
        if normalized_target_narration and normalize_lookup_key(narration) == normalized_target_narration:
            voucher["duplicate_reason"] = "transaction_no_in_narration"
            return voucher
        if normalized_target_reference and normalize_lookup_key(reference) == normalized_target_reference:
            voucher["duplicate_reason"] = "supplier_invoice_reference_in_financial_year"
            return voucher
    return None


def response_error_message(response_text: str) -> str:
    match = re.search(r"<LINEERROR>(.*?)</LINEERROR>", response_text or "", re.IGNORECASE | re.DOTALL)
    if match:
        return re.sub(r"\s+", " ", match.group(1)).strip()
    summary = []
    for tag in ("CREATED", "ALTERED", "COMBINED", "IGNORED", "DELETED", "CANCELLED", "ERRORS", "EXCEPTIONS"):
        value_match = re.search(rf"<{tag}>(.*?)</{tag}>", response_text or "", re.IGNORECASE | re.DOTALL)
        if value_match:
            summary.append(f"{tag.lower()}={value_match.group(1).strip()}")
    return "Tally import failed" + (f" ({', '.join(summary)})" if summary else "")


def normalize_tally_unit_name(unit_name: Any) -> str:
    cleaned = str(unit_name or "").strip().upper()
    if cleaned in {"", "NOS", "NO", "NUMBER", "NUMBERS"}:
        return "NOS"
    if cleaned in {"KG", "KGS", "KILOGRAM", "KILOGRAMS"}:
        return "KGS"
    if cleaned in {"LTR", "LTS", "LT", "LITER", "LITERS", "LITRE", "LITRES"}:
        return "LTR"
    if cleaned in {"PCS", "PC", "PIECE", "PIECES"}:
        return "PCS"
    if cleaned in {"REAM", "REEM"}:
        return "NOS"
    if cleaned in {"CARTON", "CARTOON", "BOX", "BOXES"}:
        return "PCS"
    return cleaned


def get_unit_candidates(unit_name: Any) -> list[str]:
    normalized = normalize_tally_unit_name(unit_name)
    candidates: list[str] = []
    singular_map = {
        "KGS": "KG",
        "PCS": "PC",
        "LTRS": "LTR",
    }
    singular_candidate = singular_map.get(normalized)

    ordered_candidates = [normalized]
    if singular_candidate:
        ordered_candidates.append(singular_candidate)
    ordered_candidates.extend(["PCS", "PC", "NOS"])

    for candidate in ordered_candidates:
        cleaned = str(candidate or "").strip().upper()
        if cleaned and cleaned not in candidates:
            candidates.append(cleaned)
    return candidates


def extract_tally_unit_names(response_text: str) -> list[str]:
    matches = re.findall(r"<NAME>(.*?)</NAME>", response_text or "", re.IGNORECASE | re.DOTALL)
    units: list[str] = []
    for match in matches:
        cleaned = re.sub(r"\s+", " ", str(match or "")).strip()
        if cleaned:
            normalized = cleaned.upper()
            if normalized not in units:
                units.append(normalized)
    return units


def is_not_applicable_unit(unit_name: Any) -> bool:
    normalized = str(unit_name or "").strip().upper()
    return normalized in {"NOT APPLICABLE", "NOTAPPLICABLE", "N/A", "NA"}


def query_tally_unit(unit_name: str, company_name: str | None) -> bool:
    normalized_unit = normalize_tally_unit_name(unit_name)
    if normalized_unit in CONFIRMED_TALLY_UNITS:
        LOGGER.info("Tally unit cache hit | unit=%s", normalized_unit)
        return True

    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>DATA</TYPE>
            <ID>Units</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="ExactUnits" ISMODIFY="No">
                            <TYPE>Unit</TYPE>
                            <FETCH>Name</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    try:
        response_text = post_xml_to_tally(xml_text, debug_step=f"unit_lookup:{normalized_unit}")
    except TallyUnavailableError:
        raise
    except Exception:
        return False
    cleaned = clean_tally_xml(response_text)
    fetched_units: list[str] = []
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        root = None
    if root is not None:
        for unit in root.findall(".//UNIT"):
            candidates = [
                unit.get("NAME") or "",
                unit.findtext("NAME") or "",
                unit.findtext("ORIGINALNAME") or "",
                unit.findtext("FORMALNAME") or "",
            ]
            for candidate in candidates:
                cleaned_candidate = str(candidate or "").strip().upper()
                if cleaned_candidate and cleaned_candidate not in fetched_units:
                    fetched_units.append(cleaned_candidate)
    if not fetched_units:
        fetched_units = extract_tally_unit_names(response_text)
    if fetched_units:
        LOGGER.info(
            "Tally units fetched | count=%s | looking_for=%s | units=%s",
            len(fetched_units),
            normalized_unit,
            ", ".join(fetched_units),
        )
    else:
        LOGGER.warning(
            "Tally units fetch returned no parsable unit names | looking_for=%s",
            normalized_unit,
        )
    if normalized_unit in fetched_units:
        CONFIRMED_TALLY_UNITS.add(normalized_unit)
        return True
    return False


def extract_tally_stock_item_base_unit(response_text: str) -> str | None:
    for tag in ("BASEUNITS", "BASEUNITS.LIST", "UNITNAME"):
        match = re.search(rf"<{tag}>(.*?)</{tag}>", response_text or "", re.IGNORECASE | re.DOTALL)
        if match:
            cleaned = re.sub(r"\s+", " ", match.group(1)).strip()
            if cleaned:
                return cleaned.upper()
    return None


def extract_tally_stock_items(response_text: str) -> list[tuple[str, str | None]]:
    items: list[tuple[str, str | None]] = []
    cleaned = clean_tally_xml(response_text)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        root = None

    if root is not None:
        for item in root.findall(".//STOCKITEM"):
            name = str(item.get("NAME") or item.findtext("NAME") or "").strip()
            if not name:
                continue
            block = ET.tostring(item, encoding="unicode")
            items.append((name, extract_tally_stock_item_base_unit(block)))
        for item in root.findall(".//STOCKITEMS.LIST/*"):
            name = str(item.get("NAME") or item.findtext("NAME") or "").strip()
            if not name:
                continue
            block = ET.tostring(item, encoding="unicode")
            items.append((name, extract_tally_stock_item_base_unit(block)))

    if items:
        return items

    pattern = re.compile(r"<STOCKITEM\b.*?>.*?</STOCKITEM>", re.IGNORECASE | re.DOTALL)
    for block in pattern.findall(response_text or ""):
        name_match = re.search(r'NAME="(.*?)"', block, re.IGNORECASE | re.DOTALL)
        if not name_match:
            name_match = re.search(r"<NAME>(.*?)</NAME>", block, re.IGNORECASE | re.DOTALL)
        if not name_match:
            continue
        name = re.sub(r"\s+", " ", name_match.group(1)).strip()
        if not name:
            continue
        items.append((name, extract_tally_stock_item_base_unit(block)))
    return items


def fetch_tally_stock_item_matches(item_name: str, company_name: str | None) -> list[tuple[str, str | None]]:
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>StockItems</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="StockItems" ISMODIFY="No">
                            <TYPE>StockItem</TYPE>
                            <FETCH>Name</FETCH>
                            <FETCH>BaseUnits</FETCH>
                            <FETCH>GUID</FETCH>
                            <FETCH>PartNo</FETCH>
                            <FETCH>PartNumber</FETCH>
                            <FETCH>MailingName.LIST</FETCH>
                            <FETCH>LanguageName.LIST</FETCH>
                            <FETCH>Parent</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text, debug_step=f"stock_item_collection_lookup:{item_name}")
    all_items = extract_tally_stock_items(response_text)
    target_key = normalize_lookup_key(item_name)
    matches = [(name, unit) for name, unit in all_items if normalize_lookup_key(name) == target_key]
    LOGGER.info(
        "Tally stock item collection fetched | target=%s | total_items=%s | matched_items=%s",
        item_name,
        len(all_items),
        ", ".join(name for name, _ in matches) if matches else "-",
    )
    return matches


def create_tally_unit(company_name: str | None, unit_name: str) -> tuple[bool, str]:
    safe_unit = escape_xml(unit_name)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>Import Data</TALLYREQUEST>
        </HEADER>
        <BODY>
            <IMPORTDATA>
                <REQUESTDESC>
                    <REPORTNAME>All Masters</REPORTNAME>
                    <STATICVARIABLES>
                        {build_company_static_variables(company_name)}
                    </STATICVARIABLES>
                </REQUESTDESC>
                <REQUESTDATA>
                    <TALLYMESSAGE xmlns:UDF="TallyUDF">
                        <UNIT NAME="{safe_unit}" ACTION="Create">
                            <NAME.LIST TYPE="String">
                                <NAME>{safe_unit}</NAME>
                            </NAME.LIST>
                            <ORIGINALNAME>{safe_unit}</ORIGINALNAME>
                            <FORMALNAME>{safe_unit}</FORMALNAME>
                            <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
                            <DECIMALPLACES>2</DECIMALPLACES>
                        </UNIT>
                    </TALLYMESSAGE>
                </REQUESTDATA>
            </IMPORTDATA>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text, debug_step=f"unit_create:{normalize_tally_unit_name(unit_name)}")
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        CONFIRMED_TALLY_UNITS.add(normalize_tally_unit_name(unit_name))
        return True, "Success"
    response_lower = response_text.lower()
    if (
        "already exists" in response_lower
        or "duplicate original name" in response_lower
        or query_tally_unit(unit_name, company_name)
    ):
        CONFIRMED_TALLY_UNITS.add(normalize_tally_unit_name(unit_name))
        return True, "Already exists"
    return False, response_error_message(response_text)


def ensure_tally_unit_exists(company_name: str | None, unit_name: Any) -> str:
    unit_candidates = get_unit_candidates(unit_name)
    original_unit = str(unit_name or "").strip()

    for candidate in unit_candidates:
        if query_tally_unit(candidate, company_name):
            CONFIRMED_TALLY_UNITS.add(candidate)
            if candidate != normalize_tally_unit_name(original_unit):
                LOGGER.info("Unit '%s' mapped to existing Tally unit '%s'.", original_unit or "-", candidate)
            return candidate

    for candidate in unit_candidates:
        LOGGER.info("Unit '%s' missing in Tally. Auto-creating unit.", candidate)
        success, result = create_tally_unit(company_name, candidate)
        if success:
            if candidate != normalize_tally_unit_name(original_unit):
                LOGGER.info("Unit '%s' mapped to Tally unit '%s' (%s).", original_unit or "-", candidate, result)
            else:
                LOGGER.info("Unit '%s' accepted by Tally unit-create flow (%s)", candidate, result)
            return candidate
        LOGGER.warning("Unit '%s' create attempt failed: %s", candidate, result)

    raise RuntimeError(
        f"Unit '{normalize_tally_unit_name(unit_name)}' could not be auto-created in Tally. "
        f"Tried candidates: {', '.join(unit_candidates)}"
    )


def query_tally_stock_item(item_name: str, company_name: str | None) -> tuple[bool, str | None]:
    cache_key = normalize_lookup_key(item_name)
    if cache_key in STOCK_ITEM_LOOKUP_CACHE:
        matched_name, matched_unit = STOCK_ITEM_LOOKUP_CACHE[cache_key]
        LOGGER.info(
            "Tally stock item lookup cache hit | requested=%s | matched_name=%s | base_unit=%s",
            item_name,
            matched_name,
            matched_unit or "-",
        )
        return True, matched_unit

    try:
        matches = fetch_tally_stock_item_matches(item_name, company_name)
    except TallyUnavailableError:
        raise
    except Exception:
        return False, None

    if not matches:
        return False, None

    matched_name, matched_unit = matches[0]
    STOCK_ITEM_LOOKUP_CACHE[cache_key] = (matched_name, matched_unit)
    LOGGER.info(
        "Tally stock item matched by normalized lookup | requested=%s | matched_name=%s | base_unit=%s",
        item_name,
        matched_name,
        matched_unit or "-",
    )
    return True, matched_unit


def create_tally_stock_item(company_name: str | None, item_name: str, stock_group: str, unit_name: str) -> tuple[bool, str, str | None]:
    safe_name = escape_xml(item_name)
    safe_group = escape_xml(stock_group)
    safe_unit = escape_xml(unit_name)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>Import Data</TALLYREQUEST>
        </HEADER>
        <BODY>
            <IMPORTDATA>
                <REQUESTDESC>
                    <REPORTNAME>All Masters</REPORTNAME>
                    <STATICVARIABLES>
                        {build_company_static_variables(company_name)}
                    </STATICVARIABLES>
                </REQUESTDESC>
                <REQUESTDATA>
                    <TALLYMESSAGE xmlns:UDF="TallyUDF">
                        <STOCKITEM NAME="{safe_name}" ACTION="Create">
                            <NAME.LIST>
                                <NAME>{safe_name}</NAME>
                            </NAME.LIST>
                            <PARENT>{safe_group}</PARENT>
                            <BASEUNITS>{safe_unit}</BASEUNITS>
                        </STOCKITEM>
                    </TALLYMESSAGE>
                </REQUESTDATA>
            </IMPORTDATA>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text, debug_step=f"stock_item_create:{item_name}")
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        return True, "Success", unit_name
    response_message = response_error_message(response_text)
    exists_in_tally, tally_base_unit = query_tally_stock_item(item_name, company_name)
    if "already exists" in response_text.lower() or exists_in_tally:
        return True, "Already exists", tally_base_unit
    if "cannot alter units" in response_message.lower():
        LOGGER.warning(
            "Tally reports stock item '%s' already exists with a different unit. Falling back to existing item behavior.",
            item_name,
        )
        return True, "Exists with different unit", tally_base_unit
    LOGGER.error(
        "Tally stock-item create failed for '%s'. Response: %s",
        item_name,
        response_message,
    )
    return False, response_message, None


def ensure_tally_stock_item_exists(company_name: str | None, item_name: str, mrr_type: str, unit_name: Any) -> str:
    exists_in_tally, tally_base_unit = query_tally_stock_item(item_name, company_name)
    if exists_in_tally:
        if tally_base_unit and not is_not_applicable_unit(tally_base_unit):
            LOGGER.info(
                "Stock item '%s' already exists in Tally. Using Tally base unit '%s' instead of LNPI unit '%s'.",
                item_name,
                tally_base_unit,
                normalize_tally_unit_name(unit_name),
            )
            return tally_base_unit
        normalized_existing_unit = ensure_tally_unit_exists(company_name, unit_name)
        LOGGER.info(
            "Stock item '%s' already exists in Tally. Keeping LNPI unit '%s'.",
            item_name,
            normalized_existing_unit,
        )
        return normalized_existing_unit
    normalized_unit = ensure_tally_unit_exists(company_name, unit_name)
    stock_group = STOCK_GROUP_BY_MRR.get(mrr_type, "App Group")
    LOGGER.info(
        "Stock item '%s' missing in Tally. Auto-creating under group '%s' with unit '%s'.",
        item_name,
        stock_group,
        normalized_unit,
    )
    success, result, resolved_tally_unit = create_tally_stock_item(company_name, item_name, stock_group, normalized_unit)
    if not success:
        raise RuntimeError(f"Stock item '{item_name}' could not be auto-created in Tally: {result}")
    final_unit = resolved_tally_unit or normalized_unit
    if result == "Exists with different unit":
        LOGGER.warning(
            "Stock item '%s' exists in Tally with a different unit. Continuing with unit '%s'.",
            item_name,
            final_unit,
        )
    else:
        LOGGER.info("Stock item '%s' accepted by Tally stock-item create flow (%s)", item_name, result)
    return final_unit


def build_inventory_entries(conn, company_name: str | None, voucher_no: str, mrr_type: str, lines: list[dict[str, Any]], purchase_ledger: str) -> str:
    entries: list[str] = []
    for index, line in enumerate(lines, start=1):
        if str(line.get("lineType", "Material")) == "Service":
            continue

        item_name, resolved_from = resolve_stock_item_name(conn, line)
        qty = to_float(line.get("actualQty") or line.get("qty"))
        rate = to_float(line.get("invoiceRate") or line.get("rate") or line.get("poRate"))
        amount = to_float(line.get("actualValue") or line.get("value") or line.get("invoiceValue") or (qty * rate))
        uom = line.get("uom") or "Nos"

        if qty <= 0:
            LOGGER.info("Skipping zero-qty line %s for voucher %s", index, voucher_no)
            continue

        normalized_uom = ensure_tally_stock_item_exists(company_name, item_name, mrr_type, uom)

        LOGGER.info(
            "Voucher %s line %s => Stock Item: %s | resolved_from=%s | qty=%s | rate=%s | amount=%s",
            voucher_no,
            index,
            item_name,
            resolved_from,
            qty,
            rate,
            amount,
        )

        entries.append(
            f"""
        <ALLINVENTORYENTRIES.LIST>
            <STOCKITEMNAME>{escape_xml(item_name)}</STOCKITEMNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
            <RATE>{rate}/{escape_xml(normalized_uom)}</RATE>
            <AMOUNT>-{amount}</AMOUNT>
            <ACTUALQTY>{qty} {escape_xml(normalized_uom)}</ACTUALQTY>
            <BILLEDQTY>{qty} {escape_xml(normalized_uom)}</BILLEDQTY>
            <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>{escape_xml(purchase_ledger)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                <AMOUNT>-{amount}</AMOUNT>
            </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>
        """
        )
    return "\n".join(entries)


def _line_amount_for_tally(line: dict[str, Any]) -> Decimal:
    qty = Decimal(str(to_float(line.get("actualQty") or line.get("qty"))))
    rate = Decimal(str(to_float(line.get("invoiceRate") or line.get("rate") or line.get("poRate"))))
    amount_value = line.get("actualValue") or line.get("value") or line.get("invoiceValue")
    if amount_value not in (None, ""):
        return Decimal(str(to_float(amount_value)))
    return qty * rate


def derive_round_off(mrr: dict[str, Any], lines: list[dict[str, Any]]) -> float:
    total_amount = Decimal(str(to_float(mrr.get("totalAmount"))))
    component_total = Decimal("0")

    for line in lines:
        if str(line.get("lineType", "Material")) == "Service":
            continue
        qty = to_float(line.get("actualQty") or line.get("qty"))
        if qty <= 0:
            continue
        component_total += _line_amount_for_tally(line)

    component_total += Decimal(str(to_float(mrr.get("totalCgst"))))
    component_total += Decimal(str(to_float(mrr.get("totalSgst"))))
    component_total += Decimal(str(to_float(mrr.get("totalIgst"))))
    component_total += Decimal(str(to_float(mrr.get("insurance"))))
    component_total += Decimal(str(to_float(mrr.get("otherCharges"))))

    derived_round_off = float(total_amount - component_total)
    if abs(derived_round_off) < 0.005:
        return 0.0
    return round(derived_round_off, 2)


def build_tax_ledger_entries(mrr: dict[str, Any], lines: list[dict[str, Any]], voucher_no: str) -> str:
    entries: list[str] = []

    insurance_and_other = to_float(mrr.get("insurance")) + to_float(mrr.get("otherCharges"))
    mapped_ledgers = [
        ("Input CGST", to_float(mrr.get("totalCgst"))),
        ("Input SGST", to_float(mrr.get("totalSgst"))),
        ("Input IGST", to_float(mrr.get("totalIgst"))),
        ("INSURANCE & OTHER EXP. ON PURCHASE", insurance_and_other),
    ]

    for ledger_name, amount in mapped_ledgers:
        if not amount:
            continue
        entries.append(
            f"""
        <LEDGERENTRIES.LIST>
            <LEDGERNAME>{escape_xml(ledger_name)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-{amount}</AMOUNT>
        </LEDGERENTRIES.LIST>
        """
        )

    round_off = derive_round_off(mrr, lines)
    stored_round_off = round(to_float(mrr.get("roundOff")), 2)
    if round_off != stored_round_off:
        LOGGER.info(
            "Voucher %s round off recalculated from total amount. Stored=%s | Derived=%s",
            voucher_no,
            stored_round_off,
            round_off,
        )
    if round_off:
        round_off_amount = abs(round_off)
        entries.append(
            f"""
        <LEDGERENTRIES.LIST>
            <LEDGERNAME>Round Off</LEDGERNAME>
            <ISDEEMEDPOSITIVE>{"No" if round_off < 0 else "Yes"}</ISDEEMEDPOSITIVE>
            <AMOUNT>{"-" if round_off > 0 else ""}{round_off_amount}</AMOUNT>
        </LEDGERENTRIES.LIST>
        """
        )

    return "\n".join(entries)


def get_purchase_ledger(mrr_type: str) -> str:
    return PURCHASE_LEDGER_BY_MRR.get(mrr_type, "Purchase Other RM")


def build_purchase_voucher_xml(conn, company_name: str | None, mrr: dict[str, Any], supplier_name: str) -> str:
    mrr_type = mrr.get("mrrType") or "Others"
    purchase_ledger = get_purchase_ledger(str(mrr_type))
    date_str = format_tally_date(mrr)
    voucher_no = str(mrr.get("transactionNo") or "")
    invoice_no = str(mrr.get("invoiceNo") or "")
    total_amount = to_float(mrr.get("totalAmount"))
    lines = parse_lines(mrr.get("lines"))
    inventory_entries = build_inventory_entries(conn, company_name, voucher_no, str(mrr_type), lines, purchase_ledger)
    tax_entries = build_tax_ledger_entries(mrr, lines, voucher_no)

    return f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="Purchase" ACTION="Create">
                        <DATE>{date_str}</DATE>
                        <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
                        <PARTYLEDGERNAME>{escape_xml(supplier_name)}</PARTYLEDGERNAME>
                        <REFERENCE>{escape_xml(invoice_no)}</REFERENCE>
                        <NARRATION>{escape_xml(f"Imported from LNPI MRR {voucher_no} | Type: {mrr_type}")}</NARRATION>
                        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
                        <ISINVOICE>Yes</ISINVOICE>

                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{escape_xml(supplier_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{total_amount}</AMOUNT>
                            <BILLALLOCATIONS.LIST>
                                <NAME>{escape_xml(invoice_no or voucher_no)}</NAME>
                                <BILLTYPE>New Ref</BILLTYPE>
                                <AMOUNT>{total_amount}</AMOUNT>
                            </BILLALLOCATIONS.LIST>
                        </LEDGERENTRIES.LIST>

                        {inventory_entries}
                        {tax_entries}
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""


def build_journal_xml(company_name: str | None, mrr: dict[str, Any], supplier_name: str) -> str:
    date_str = format_tally_date(mrr)
    voucher_no = str(mrr.get("transactionNo") or "")
    invoice_no = str(mrr.get("invoiceNo") or "")
    mrr_type = str(mrr.get("mrrType") or "Service Return")
    total_amount = to_float(mrr.get("totalAmount"))

    return f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="Journal" ACTION="Create">
                        <DATE>{date_str}</DATE>
                        <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
                        <REFERENCE>{escape_xml(invoice_no)}</REFERENCE>
                        <NARRATION>{escape_xml(f"Imported from LNPI MRR {voucher_no} | Type: {mrr_type}")}</NARRATION>

                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>Service Return Adjustment</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{total_amount}</AMOUNT>
                        </LEDGERENTRIES.LIST>

                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{escape_xml(supplier_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{total_amount}</AMOUNT>
                        </LEDGERENTRIES.LIST>
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""


def mark_mrr_completed(conn, mrr_id: str) -> None:
    conn = ensure_db_connection(conn)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_in`
        SET `tallyTimestamp` = %s,
            `status` = 'Completed',
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (now, now, mrr_id),
    )
    conn.commit()
    cursor.close()


def process_one_mrr(conn, company_name: str | None, mrr: dict[str, Any]) -> None:
    conn = ensure_db_connection(conn)
    mrr_type = str(mrr.get("mrrType") or "Others")
    supplier_name, source_table = get_supplier_name(conn, str(mrr["supplierId"]), mrr_type)
    voucher_type = "Journal" if mrr_type == "Service Return" else "Purchase"
    voucher_no = str(mrr.get("transactionNo") or "")
    invoice_no = str(mrr.get("invoiceNo") or "").strip()
    purchase_ledger = get_purchase_ledger(mrr_type)
    voucher_date = format_tally_date(mrr)
    voucher_datetime = resolve_voucher_datetime(mrr)

    LOGGER.info("Processing MRR %s | type=%s | party=%s | source=%s | voucher_date=%s", voucher_no, mrr_type, supplier_name, source_table, voucher_date)
    if voucher_type == "Purchase":
        LOGGER.info("Voucher %s entries => Debit: %s | Credit: %s", voucher_no, purchase_ledger, supplier_name)
    else:
        LOGGER.info("Voucher %s entries => Debit: Service Return Adjustment | Credit: %s", voucher_no, supplier_name)

    check_tally_health(company_name, reason=f"before_mrr:{voucher_no}")

    duplicate_voucher = find_duplicate_voucher(
        company_name=company_name,
        voucher_type=voucher_type,
        supplier_name=supplier_name,
        transaction_no=voucher_no,
        invoice_no=invoice_no,
        voucher_date=voucher_datetime,
        mrr_type=mrr_type,
    )
    if duplicate_voucher:
        LOGGER.info(
            "Skipping %s because duplicate voucher already exists in Tally | reason=%s | existing_voucher=%s | existing_reference=%s | existing_date=%s | supplier=%s",
            voucher_no,
            duplicate_voucher.get("duplicate_reason") or "-",
            duplicate_voucher.get("voucher_number") or "-",
            duplicate_voucher.get("reference") or "-",
            duplicate_voucher.get("date") or "-",
            duplicate_voucher.get("party") or supplier_name,
        )
        mark_mrr_completed(conn, str(mrr["id"]))
        return

    if mrr_type == "Service Return":
        xml_text = build_journal_xml(company_name, mrr, supplier_name)
    else:
        xml_text = build_purchase_voucher_xml(conn, company_name, mrr, supplier_name)

    response_text = post_xml_to_tally(xml_text, debug_step=f"{voucher_type.lower()}_voucher_import", voucher_no=voucher_no)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        mark_mrr_completed(conn, str(mrr["id"]))
        LOGGER.info("Posted voucher %s successfully in company %s", voucher_no, company_name or "Current Open Company")
        return

    raise RuntimeError(f"Tally rejected voucher {voucher_no}: {response_text}")


def main() -> None:
    LOGGER.info("Starting Tally MRR posting")
    LOGGER.info("MRR log file: %s", LOG_FILE)
    LOGGER.info("Tally URL candidates: %s", ", ".join(TALLY_URL_CANDIDATES))
    LOGGER.info("Using active Tally company on port 9004. No SVCURRENTCOMPANY will be sent.")
    company_name = None

    conn = get_db_connection()
    try:
        pending_mrrs = get_pending_mrrs(conn)
        LOGGER.info("Found %s pending MRR(s)", len(pending_mrrs))
        for mrr in pending_mrrs:
            try:
                conn = ensure_db_connection(conn)
                STOCK_ITEM_LOOKUP_CACHE.clear()
                process_one_mrr(conn, company_name, mrr)
            except TallyUnavailableError as error:
                transaction_no = mrr.get("transactionNo")
                LOGGER.exception("ERROR in MRR %s: %s", transaction_no, error)
                LOGGER.error("Stopping MRR batch because Tally is unreachable/unresponsive.")
                break
            except Exception as error:
                transaction_no = mrr.get("transactionNo")
                LOGGER.exception("ERROR in MRR %s: %s", transaction_no, error)
    finally:
        try:
            conn.close()
        except Exception:
            pass
        LOGGER.info("Finished Tally MRR posting")


if __name__ == "__main__":
    main()
