import json
import logging
import os
import re
import sys
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

def post_xml_to_tally(xml_text: str) -> str:
    global ACTIVE_TALLY_URL

    urls_to_try = [ACTIVE_TALLY_URL] if ACTIVE_TALLY_URL else []
    urls_to_try.extend([url for url in TALLY_URL_CANDIDATES if url not in urls_to_try])
    last_error: Exception | None = None

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
            ACTIVE_TALLY_URL = url
            return response.text
        except requests_exceptions.Timeout as error:
            LOGGER.warning("Tally timed out at %s after %ss", url, REQUEST_TIMEOUT)
            last_error = error
        except requests_exceptions.ConnectionError as error:
            LOGGER.warning("Tally not reachable at %s", url)
            last_error = error
        except requests_exceptions.RequestException as error:
            LOGGER.warning("Tally request failed at %s: %s", url, error)
            last_error = error

    urls_text = ", ".join(urls_to_try)
    raise RuntimeError(
        f"Cannot connect to Tally on the configured URLs: {urls_text}. "
        "This usually means Tally XML/HTTP is not enabled on port 9004, or another app is using that port. "
        "If your Tally runs on a different port, set LNPI_TALLY_URL before running."
    ) from last_error


def build_company_static_variables(company_name: str | None) -> str:
    if not company_name:
        return ""
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>"

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
        response_text = post_xml_to_tally(xml_text)
    except Exception as error:
        LOGGER.warning("Voucher existence check failed for %s: %s", voucher_number, error)
        return False
    return safe_number in response_text


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


def query_tally_unit(unit_name: str, company_name: str | None) -> bool:
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
        response_text = post_xml_to_tally(xml_text)
    except Exception:
        return False
    normalized_unit = normalize_tally_unit_name(unit_name)
    normalized_response = response_text.upper()
    return (
        f"<NAME>{normalized_unit}</NAME>" in normalized_response
        or f'NAME="{normalized_unit}"' in normalized_response
        or f"<ORIGINALNAME>{normalized_unit}</ORIGINALNAME>" in normalized_response
        or f"<FORMALNAME>{normalized_unit}</FORMALNAME>" in normalized_response
    )


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
    response_text = post_xml_to_tally(xml_text)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        return True, "Success"
    response_lower = response_text.lower()
    if (
        "already exists" in response_lower
        or "duplicate original name" in response_lower
        or query_tally_unit(unit_name, company_name)
    ):
        return True, "Already exists"
    return False, response_error_message(response_text)


def ensure_tally_unit_exists(company_name: str | None, unit_name: Any) -> str:
    unit_candidates = get_unit_candidates(unit_name)
    original_unit = str(unit_name or "").strip()

    for candidate in unit_candidates:
        if query_tally_unit(candidate, company_name):
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


def query_tally_stock_item(item_name: str, company_name: str | None) -> bool:
    safe_name = escape_xml(item_name)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>OBJECT</TYPE>
            <SUBTYPE>Stock Item</SUBTYPE>
            <ID TYPE="Name">{safe_name}</ID>
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
    try:
        response_text = post_xml_to_tally(xml_text)
    except Exception:
        return False
    normalized_name = str(item_name or "").strip().upper()
    normalized_response = response_text.upper()
    return "<STOCKITEM " in normalized_response and (
        f'NAME="{normalized_name}"' in normalized_response
        or f"<NAME>{normalized_name}</NAME>" in normalized_response
        or f'REQNAME="{normalized_name}"' in normalized_response
    )


def create_tally_stock_item(company_name: str | None, item_name: str, stock_group: str, unit_name: str) -> tuple[bool, str]:
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
    response_text = post_xml_to_tally(xml_text)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        return True, "Success"
    if "already exists" in response_text.lower() or query_tally_stock_item(item_name, company_name):
        return True, "Already exists"
    LOGGER.error(
        "Tally stock-item create failed for '%s'. Response: %s",
        item_name,
        response_error_message(response_text),
    )
    return False, response_error_message(response_text)


def ensure_tally_stock_item_exists(company_name: str | None, item_name: str, mrr_type: str, unit_name: Any) -> str:
    if query_tally_stock_item(item_name, company_name):
        return item_name
    normalized_unit = ensure_tally_unit_exists(company_name, unit_name)
    stock_group = STOCK_GROUP_BY_MRR.get(mrr_type, "App Group")
    LOGGER.info(
        "Stock item '%s' missing in Tally. Auto-creating under group '%s' with unit '%s'.",
        item_name,
        stock_group,
        normalized_unit,
    )
    success, result = create_tally_stock_item(company_name, item_name, stock_group, normalized_unit)
    if not success:
        raise RuntimeError(f"Stock item '{item_name}' could not be auto-created in Tally: {result}")
    LOGGER.info("Stock item '%s' accepted by Tally stock-item create flow (%s)", item_name, result)
    return item_name


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
                        <VOUCHERNUMBER>{escape_xml(voucher_no)}</VOUCHERNUMBER>
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
                        <VOUCHERNUMBER>{escape_xml(voucher_no)}</VOUCHERNUMBER>
                        <NARRATION>{escape_xml("Imported Service Return from LNPI")}</NARRATION>

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
    purchase_ledger = get_purchase_ledger(mrr_type)
    voucher_date = format_tally_date(mrr)

    LOGGER.info("Processing MRR %s | type=%s | party=%s | source=%s | voucher_date=%s", voucher_no, mrr_type, supplier_name, source_table, voucher_date)
    if voucher_type == "Purchase":
        LOGGER.info("Voucher %s entries => Debit: %s | Credit: %s", voucher_no, purchase_ledger, supplier_name)
    else:
        LOGGER.info("Voucher %s entries => Debit: Service Return Adjustment | Credit: %s", voucher_no, supplier_name)

    if voucher_exists_in_tally(company_name, voucher_no, voucher_type):
        LOGGER.info("Skipping %s because voucher already exists in Tally", voucher_no)
        mark_mrr_completed(conn, str(mrr["id"]))
        return

    if mrr_type == "Service Return":
        xml_text = build_journal_xml(company_name, mrr, supplier_name)
    else:
        xml_text = build_purchase_voucher_xml(conn, company_name, mrr, supplier_name)

    response_text = post_xml_to_tally(xml_text)
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
                process_one_mrr(conn, company_name, mrr)
            except Exception as error:
                transaction_no = mrr.get("transactionNo")
                LOGGER.exception("ERROR in MRR %s: %s", transaction_no, error)
                if "Cannot connect to Tally on the configured URLs" in str(error):
                    LOGGER.error("Stopping MRR batch because Tally is unreachable/unresponsive.")
                    break
    finally:
        try:
            conn.close()
        except Exception:
            pass
        LOGGER.info("Finished Tally MRR posting")


if __name__ == "__main__":
    main()
