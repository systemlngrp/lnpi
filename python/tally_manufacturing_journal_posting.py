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


BASE_DIR = Path(__file__).resolve().parents[1]


def resolve_log_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd()


LOG_DIR = resolve_log_dir()
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "manufacturingjournallog.log"
REQUEST_TIMEOUT = 8
POSTED_BY = "tally_manufacturing_journal_posting.py"

REEL_GROUP = str(os.getenv("LNPI_TALLY_REEL_GROUP") or os.getenv("TALLY_REEL_GROUP") or "PAPER IN REEL FORM").strip()
OTHER_GROUP = "OTHER"
FG_GROUP = "FG- FINISHED GOODS"
RM_GROUP_BY_TYPE = {
    "reel": REEL_GROUP,
}


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_manufacturing_journal_posting")
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
    "host": os.getenv("LNPI_DB_HOST", "193.203.184.152"),
    "user": os.getenv("LNPI_DB_USER", "u380633007_lnpidata"),
    "password": os.getenv("LNPI_DB_PASSWORD", "!Office1@"),
    "database": os.getenv("LNPI_DB_NAME", "u380633007_lnpidata"),
    "port": int(os.getenv("LNPI_DB_PORT", "3306")),
    "use_pure": True,
}


def build_tally_url_candidates() -> list[str]:
    candidates: list[str] = []
    preferred = [
        os.getenv("LNPI_TALLY_URL"),
        os.getenv("TALLY_URL"),
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
ITEM_NAME_CACHE: dict[str, str | None] = {}
FG_GROUP_OVERRIDE = str(os.getenv("LNPI_TALLY_FG_GROUP", "")).strip()
# Optional only. If blank, no <SVCURRENTCOMPANY> is sent and Tally uses the active/open company on port 9004.
TALLY_COMPANY_NAME = str(
    os.getenv("LNPI_TALLY_COMPANY_NAME")
    or os.getenv("TALLY_COMPANY_NAME")
    or ""
).strip()

# In this Tally data, reel-paper ERP codes are stored as MAILINGNAME aliases
# (example: <MAILINGNAME>7220134</MAILINGNAME>). Using this alias in
# voucher STOCKITEMNAME avoids failures caused by multiple spaces in long item names.
# Keep default ON. Set LNPI_POST_REEL_BY_ERP_ALIAS=0 only if your Tally does not accept aliases.
POST_REEL_BY_ERP_ALIAS = str(os.getenv("LNPI_POST_REEL_BY_ERP_ALIAS", "1")).strip().lower() not in ("0", "false", "no")
TALLY_STOCK_ITEM_CACHE: dict[str, dict[str, dict[str, Any]]] = {}


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


def clean_tally_xml(xml_content: str | bytes) -> str:
    text = xml_content.decode("utf-8", errors="ignore") if isinstance(xml_content, bytes) else str(xml_content)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"&#(?:0?[0-8]|1[12]|1[4-9]|2[0-9]|3[01]);", "", text)
    text = re.sub(r"&#x(?:[0-8]|[bBcCeE]|1[0-9a-fA-F]);", "", text, flags=re.IGNORECASE)
    return text


def extract_first_matching_tag(xml_block: str, tag_names: list[str]) -> str:
    for tag_name in tag_names:
        escaped_tag = re.escape(tag_name)
        match = re.search(rf"<{escaped_tag}\b[^>]*>(.*?)</{escaped_tag}>", xml_block, re.IGNORECASE | re.DOTALL)
        if match:
            return re.sub(r"\s+", " ", str(match.group(1) or "").strip())
    return ""


def extract_matching_tag_values(xml_block: str, tag_names: list[str]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for tag_name in tag_names:
        escaped_tag = re.escape(tag_name)
        for match in re.findall(rf"<{escaped_tag}\b[^>]*>(.*?)</{escaped_tag}>", xml_block, re.IGNORECASE | re.DOTALL):
            cleaned = re.sub(r"\s+", " ", str(match or "").strip())
            normalized = cleaned.upper()
            if not cleaned or normalized in seen:
                continue
            seen.add(normalized)
            values.append(cleaned)
    return values


def normalize_lookup_token(value: Any) -> str:
    # Tally may return names with double/triple spaces.
    # Use this everywhere for matching, otherwise an existing item can be missed.
    return re.sub(r"\s+", " ", str(value or "").strip()).upper()


def clean_tally_text(value: Any) -> str:
    """
    Decode Tally/XML text while preserving meaningful internal spaces.

    Important: Tally stock item names are exact text. A name like
    "BF: 18   Color" is different from "BF: 18 Color" while importing
    a voucher. Therefore this function must NOT collapse whitespace.

    Use normalize_lookup_token() only for comparisons/search keys.
    Use clean_tally_text() for the exact value that will be posted back to Tally.
    """
    cleaned = clean_tally_xml(str(value or ""))
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    cleaned = (
        cleaned.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )
    return cleaned.strip()


def extract_first_tag_value(source_text: str, tag_name: str) -> str:
    match = re.search(
        rf"<{re.escape(tag_name)}\b[^>]*>(.*?)</{re.escape(tag_name)}>",
        source_text or "",
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return clean_tally_text(match.group(1))


def extract_stockitem_attr(xml_text: str, attr_name: str) -> str:
    match = re.search(
        rf"<STOCKITEM\b[^>]*\b{re.escape(attr_name)}=\"([^\"]*)\"",
        xml_text or "",
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return clean_tally_text(match.group(1))


def normalize_erp_token(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip()).upper()


def build_stock_item_details_from_xml_block(item_block: str, requested_name: str = "") -> dict[str, Any]:
    # Tally often stores ERP/part code in MAILINGNAME, not PARTNO.
    # Example received from Tally:
    # <MAILINGNAME>7220134</MAILINGNAME> and <BASEUNITS>KGS</BASEUNITS>
    name = (
        extract_stockitem_attr(item_block, "NAME")
        or extract_stockitem_attr(item_block, "REQNAME")
        or extract_first_tag_value(item_block, "NAME")
        or str(requested_name or "").strip()
    )
    aliases = extract_matching_tag_values(item_block, ["MAILINGNAME", "NAME"])
    part_no = (
        extract_first_tag_value(item_block, "PARTNO")
        or extract_first_tag_value(item_block, "PARTNUMBER")
        or extract_first_tag_value(item_block, "PARTNUM")
        or extract_first_tag_value(item_block, "MAILINGNAME")
    )
    return {
        "exists": True,
        "name": clean_tally_text(name),
        "guid": extract_first_tag_value(item_block, "GUID"),
        "partNo": clean_tally_text(part_no),
        "baseUnit": extract_first_tag_value(item_block, "BASEUNITS") or extract_first_tag_value(item_block, "BASEUNIT"),
        "parent": extract_first_tag_value(item_block, "PARENT"),
        "aliases": aliases,
    }


def extract_stock_item_fragment(source_text: str, stock_item_name: str) -> str:
    # Tally object export often returns <STOCKITEM NAME="..."> or REQNAME.
    # This raw fallback is helpful when ElementTree cannot parse Tally's XML cleanly.
    escaped_name = re.escape(str(stock_item_name or "").strip())
    if not escaped_name:
        return ""
    pattern = re.compile(
        rf'<STOCKITEM\b[^>]*\b(?:NAME|REQNAME)="{escaped_name}"[^>]*>.*?</STOCKITEM>',
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(source_text or "")
    return match.group(0) if match else ""


def query_tally_stock_item_details(item_name: str, company_name: str | None = None) -> dict[str, Any]:
    """
    Directly read one Stock Item from Tally by name.

    Important Tally behaviour handled here:
    - The item code/ERP may come in <MAILINGNAME>, not <PARTNO>.
    - The base unit comes in <BASEUNITS>, for reel paper normally KGS.
    - The stock item name may be an attribute NAME/REQNAME, not a child <NAME>.
    """
    cleaned_item_name = str(item_name or "").strip()
    blank = {"exists": False, "name": "", "guid": "", "partNo": "", "baseUnit": "", "parent": "", "aliases": []}
    if not cleaned_item_name:
        return blank

    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>Export</TALLYREQUEST>
            <TYPE>Object</TYPE>
            <SUBTYPE>Stock Item</SUBTYPE>
            <ID TYPE="Name">{escape_xml(cleaned_item_name)}</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <FETCHLIST>
                    <FETCH>Name</FETCH>
                    <FETCH>GUID</FETCH>
                    <FETCH>Parent</FETCH>
                    <FETCH>BaseUnits</FETCH>
                    <FETCH>PartNo</FETCH>
                    <FETCH>PartNumber</FETCH>
                    <FETCH>MailingName.LIST</FETCH>
                    <FETCH>LanguageName.LIST</FETCH>
                </FETCHLIST>
            </DESC>
        </BODY>
    </ENVELOPE>
    """

    try:
        response_text = post_xml_to_tally(xml_text)
    except Exception as error:
        LOGGER.warning("Direct Tally stock-item lookup failed for '%s': %s", cleaned_item_name, error)
        return blank

    if not response_text or "<LINEERROR>" in response_text.upper():
        return blank

    cleaned_response = clean_tally_xml(response_text)
    requested_token = normalize_lookup_token(cleaned_item_name)

    # First, use raw STOCKITEM blocks. This is more reliable for Tally XML because
    # BASEUNITS and MAILINGNAME can be present even when ElementTree findtext misses them.
    raw_blocks = re.findall(r"<STOCKITEM\b[^>]*>.*?</STOCKITEM>", cleaned_response, flags=re.IGNORECASE | re.DOTALL)
    for block in raw_blocks:
        details = build_stock_item_details_from_xml_block(block, cleaned_item_name)
        name_token = normalize_lookup_token(details.get("name"))
        attr_name_token = normalize_lookup_token(extract_stockitem_attr(block, "NAME"))
        attr_req_token = normalize_lookup_token(extract_stockitem_attr(block, "REQNAME"))
        if requested_token in (name_token, attr_name_token, attr_req_token):
            LOGGER.info(
                "Direct Tally lookup found stock item '%s' with Part/Mailing No '%s', BaseUnits '%s', Parent '%s'.",
                details.get("name") or cleaned_item_name,
                details.get("partNo") or "blank",
                details.get("baseUnit") or "blank",
                details.get("parent") or "blank",
            )
            return details

    # XML parse fallback, useful when Tally returns a clean ElementTree-friendly response.
    try:
        root = ET.fromstring(cleaned_response)
        for stock_item in root.findall(".//STOCKITEM"):
            item_block = ET.tostring(stock_item, encoding="unicode")
            details = build_stock_item_details_from_xml_block(item_block, cleaned_item_name)
            name_attr = stock_item.get("NAME") or stock_item.get("REQNAME") or ""
            if normalize_lookup_token(details.get("name")) == requested_token or normalize_lookup_token(name_attr) == requested_token:
                LOGGER.info(
                    "Direct Tally lookup found stock item '%s' with Part/Mailing No '%s', BaseUnits '%s', Parent '%s'.",
                    details.get("name") or cleaned_item_name,
                    details.get("partNo") or "blank",
                    details.get("baseUnit") or "blank",
                    details.get("parent") or "blank",
                )
                return details
    except ET.ParseError as error:
        LOGGER.warning("Could not parse direct stock-item XML for '%s': %s", cleaned_item_name, error)

    # Last fallback: response contains the item name but not a full block.
    if f'NAME="{escape_xml(cleaned_item_name)}"' in cleaned_response or f'REQNAME="{escape_xml(cleaned_item_name)}"' in cleaned_response:
        details = build_stock_item_details_from_xml_block(cleaned_response, cleaned_item_name)
        LOGGER.info(
            "Direct Tally lookup found stock item '%s' with Part/Mailing No '%s', BaseUnits '%s', Parent '%s'.",
            details.get("name") or cleaned_item_name,
            details.get("partNo") or "blank",
            details.get("baseUnit") or "blank",
            details.get("parent") or "blank",
        )
        return details

    return blank


def escape_tally_formula_text(value: Any) -> str:
    return escape_xml(str(value or "")).replace('"', '&quot;')


def query_tally_stock_item_by_part_no(erp_code: str, company_name: str | None = None) -> dict[str, Any]:
    """
    Find a Tally stock item by ERP/Part code.
    In this Tally data, the ERP code may be stored as MAILINGNAME, not PARTNO.
    """
    normalized_erp = normalize_erp_token(erp_code)
    blank = {"exists": False, "name": "", "guid": "", "partNo": "", "baseUnit": "", "parent": "", "aliases": []}
    if not normalized_erp:
        return blank

    safe_formula_erp = escape_tally_formula_text(normalized_erp)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>Export Data</TALLYREQUEST>
        </HEADER>
        <BODY>
            <EXPORTDATA>
                <REQUESTDESC>
                    <STATICVARIABLES>
                        {build_company_static_variables(company_name)}
                        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    </STATICVARIABLES>
                    <TDL>
                        <TDLMESSAGE>
                            <COLLECTION NAME="StockItemByPartNo" ISMODIFY="No">
                                <TYPE>StockItem</TYPE>
                                <FETCH>Name</FETCH>
                                <FETCH>GUID</FETCH>
                                <FETCH>Parent</FETCH>
                                <FETCH>BaseUnits</FETCH>
                                <FETCH>PartNo</FETCH>
                                <FETCH>PartNumber</FETCH>
                                <FETCH>MailingName.LIST</FETCH>
                                <FETCH>LanguageName.LIST</FETCH>
                                <FILTERS>OnlyMatchingPartNoOrMailingName</FILTERS>
                            </COLLECTION>
                            <SYSTEM TYPE="Formulae" NAME="OnlyMatchingPartNoOrMailingName">
                                $$StringEqual:$$StringUpper:$$String:$PartNo:"{safe_formula_erp}"
                                OR $$StringEqual:$$StringUpper:$$String:$PartNumber:"{safe_formula_erp}"
                                OR $$StringEqual:$$StringUpper:$$String:$MailingName:"{safe_formula_erp}"
                            </SYSTEM>
                        </TDLMESSAGE>
                    </TDL>
                </REQUESTDESC>
            </EXPORTDATA>
        </BODY>
    </ENVELOPE>
    """

    try:
        response_text = post_xml_to_tally(xml_text)
    except Exception as error:
        LOGGER.warning("Tally ERP/MailingName lookup failed for ERP '%s': %s", erp_code, error)
        return blank

    cleaned = clean_tally_xml(response_text or "")
    matches: list[dict[str, Any]] = []

    for block in re.findall(r"<STOCKITEM\b[^>]*>.*?</STOCKITEM>", cleaned, flags=re.IGNORECASE | re.DOTALL):
        details = build_stock_item_details_from_xml_block(block)
        candidates = [details.get("partNo") or ""] + list(details.get("aliases") or [])
        # Some reel item names also start with the ERP code.
        if details.get("name"):
            candidates.append(str(details.get("name")).split("-", 1)[0].strip())
        if any(normalize_erp_token(candidate) == normalized_erp for candidate in candidates):
            matches.append(details)

    # If TDL $MailingName filter is not supported and no row came, fall back to bulk stock item cache.
    # This cache already includes MAILINGNAME aliases.
    if not matches:
        for item in get_tally_stock_item_map(company_name).values():
            candidates = [item.get("partNo") or ""] + list(item.get("aliases") or [])
            if item.get("name"):
                candidates.append(str(item.get("name")).split("-", 1)[0].strip())
            if any(normalize_erp_token(candidate) == normalized_erp for candidate in candidates):
                matches.append(item)

    # De-duplicate by item name.
    unique: dict[str, dict[str, Any]] = {}
    for match in matches:
        key = normalize_lookup_token(match.get("name"))
        if key:
            unique[key] = match
    matches = list(unique.values())

    if len(matches) == 1:
        LOGGER.info(
            "Tally ERP/MailingName lookup matched ERP '%s' to stock item '%s' with BaseUnits '%s'.",
            erp_code,
            matches[0].get("name") or "",
            matches[0].get("baseUnit") or "blank",
        )
        return matches[0]

    if len(matches) > 1:
        LOGGER.warning(
            "ERP/MailingName '%s' matched multiple Tally stock items: %s. Skipping ERP auto-match.",
            erp_code,
            ", ".join(str(m.get("name") or "") for m in matches),
        )

    return blank


def parse_json_lines(raw_lines: Any) -> list[dict[str, Any]]:
    if isinstance(raw_lines, list):
        return [line for line in raw_lines if isinstance(line, dict)]
    if isinstance(raw_lines, str) and raw_lines.strip():
        try:
            import json

            parsed = json.loads(raw_lines)
            if isinstance(parsed, list):
                return [line for line in parsed if isinstance(line, dict)]
        except Exception as error:
            LOGGER.warning("Invalid JSON in material lines. Skipping that row. Error=%s | Raw=%s", error, raw_lines[:300])
    return []


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


def format_production_date(production: dict[str, Any]) -> str:
    for raw in (
        production.get("date"),
        production.get("scheduledDate"),
        production.get("updateTimestamp"),
    ):
        parsed = _parse_tally_date(raw)
        if parsed:
            return parsed.strftime("%Y%m%d")
    raise RuntimeError(
        "Voucher date could not be resolved from production date fields. "
        f"date={production.get('date')!r}, scheduledDate={production.get('scheduledDate')!r}"
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
        "This usually means Tally XML/HTTP is not enabled or another app is using that port."
    ) from last_error


def build_company_static_variables(company_name: str | None) -> str:
    if not company_name:
        return ""
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>"


def get_current_tally_company() -> str | None:
    xml_text = """
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>DATA</TYPE>
            <ID>List of Companies</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    patterns = [
        r"<SVCURRENTCOMPANY>(.*?)</SVCURRENTCOMPANY>",
        r"<CMPNAME>(.*?)</CMPNAME>",
        r"<NAME>(.*?)</NAME>",
    ]
    for pattern in patterns:
        company_names = re.findall(pattern, response_text, flags=re.IGNORECASE | re.DOTALL)
        company_names = [name.strip() for name in company_names if name.strip()]
        if company_names:
            return company_names[0]
    return None


def parse_import_summary(response_text: str) -> dict[str, str]:
    summary: dict[str, str] = {}
    for tag in ["CREATED", "ALTERED", "COMBINED", "IGNORED", "DELETED", "CANCELLED", "ERRORS", "EXCEPTIONS"]:
        match = re.search(rf"<{tag}>(.*?)</{tag}>", response_text or "", re.IGNORECASE)
        if match:
            summary[tag.lower()] = match.group(1).strip()
    return summary


def response_error_message(response_text: str) -> str:
    response_text = (response_text or "").strip()
    if not response_text:
        return "Empty response from Tally"

    line_error = re.search(r"<LINEERROR>(.*?)</LINEERROR>", response_text, re.IGNORECASE | re.DOTALL)
    if line_error:
        return line_error.group(1).strip()

    summary = parse_import_summary(response_text)
    if summary:
        details = ", ".join(f"{key}={value}" for key, value in summary.items())
        return f"Tally import failed without LINEERROR ({details})"

    cleaned = re.sub(r"<[^>]+>", " ", response_text)
    cleaned = " ".join(cleaned.split())
    return cleaned[:250] if cleaned else "Failed to import"


def compact_xml_for_log(xml_text: str, max_length: int = 1200) -> str:
    cleaned = clean_tally_xml(xml_text or "")
    # Preserve multiple spaces inside Tally stock item names. Collapsing all whitespace
    # makes the log misleading for names like "BF: 18   Color".
    cleaned = re.sub(r"[\r\n\t]+", " ", cleaned).strip()
    cleaned = re.sub(r" {10,}", "   ", cleaned)
    if len(cleaned) <= max_length:
        return cleaned
    return cleaned[:max_length] + "...(truncated)"


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


def get_tally_groups() -> set[str]:
    xml_text = """
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>StockGroups</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="StockGroups">
                            <TYPE>StockGroup</TYPE>
                            <FETCH>Name</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    groups: set[str] = set()
    try:
        root = ET.fromstring(cleaned)
        for group in root.findall(".//STOCKGROUP"):
            name = group.get("NAME") or group.findtext("NAME")
            if name:
                groups.add(str(name).strip().upper())
    except ET.ParseError:
        pass
    return groups


def get_tally_stock_item_map(company_name: str | None = None) -> dict[str, dict[str, Any]]:
    cache_key = str(company_name or "").strip().upper()
    cached = TALLY_STOCK_ITEM_CACHE.get(cache_key)
    if cached is not None:
        return cached

    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
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
                        <COLLECTION NAME="StockItems">
                            <TYPE>StockItem</TYPE>
                            <FETCH>Name</FETCH>
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
    response_text = post_xml_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    items: dict[str, dict[str, Any]] = {}
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        root = None

    if root is not None:
        for item in root.findall(".//STOCKITEM"):
            name = str(item.get("NAME") or item.findtext("NAME") or "").strip()
            if not name:
                continue
            item_block = ET.tostring(item, encoding="unicode")
            part_no = str(item.findtext("PARTNO") or item.findtext("PARTNUMBER") or "").strip()
            if not part_no:
                part_no = extract_first_matching_tag(item_block, ["PARTNO", "PARTNUMBER", "PARTNUM", "PARTNUMBER"] )
            aliases = extract_matching_tag_values(item_block, ["MAILINGNAME", "NAME"])
            items[normalize_lookup_token(name)] = {
                "name": name,
                "guid": str(item.get("GUID") or item.findtext("GUID") or "").strip(),
                "partNo": part_no,
                "aliases": aliases,
                "parent": str(item.findtext("PARENT") or "").strip(),
            }
        for item in root.findall(".//STOCKITEMS.LIST/*"):
            name = str(item.get("NAME") or item.findtext("NAME") or "").strip()
            if not name:
                continue
            item_block = ET.tostring(item, encoding="unicode")
            part_no = str(item.findtext("PARTNO") or item.findtext("PARTNUMBER") or "").strip()
            if not part_no:
                part_no = extract_first_matching_tag(item_block, ["PARTNO", "PARTNUMBER", "PARTNUM", "PARTNUMBER"] )
            aliases = extract_matching_tag_values(item_block, ["MAILINGNAME", "NAME"])
            items[normalize_lookup_token(name)] = {
                "name": name,
                "guid": str(item.get("GUID") or item.findtext("GUID") or "").strip(),
                "partNo": part_no,
                "aliases": aliases,
                "parent": str(item.findtext("PARENT") or "").strip(),
            }

    LOGGER.info("Loaded %s Tally stock item(s) for company key '%s'", len(items), cache_key or "current")
    TALLY_STOCK_ITEM_CACHE[cache_key] = items
    return items


def invalidate_tally_stock_item_cache(company_name: str | None = None) -> None:
    cache_key = str(company_name or "").strip().upper()
    if cache_key:
        TALLY_STOCK_ITEM_CACHE.pop(cache_key, None)
        return
    TALLY_STOCK_ITEM_CACHE.clear()


def query_tally_item(item_name: str, company_name: str | None = None) -> tuple[bool, str | None]:
    item = get_tally_item_record_by_name(item_name, company_name)
    if not item:
        return False, None
    guid = str(item.get("guid") or "").strip() or None
    return True, guid


def get_tally_item_record_by_name(item_name: str, company_name: str | None = None) -> dict[str, Any] | None:
    cleaned_name = str(item_name or "").strip()
    if not cleaned_name:
        return None

    # 1) Use direct object lookup first. This matches the working MRR code approach.
    direct_item = query_tally_stock_item_details(cleaned_name, company_name)
    if direct_item.get("exists"):
        LOGGER.info(
            "Direct Tally lookup found stock item '%s' with Part No '%s' and BaseUnits '%s'.",
            direct_item.get("name") or cleaned_name,
            direct_item.get("partNo") or "blank",
            direct_item.get("baseUnit") or "blank",
        )
        return direct_item

    # 2) Fallback to bulk map lookup, useful for ERP/alias matching and older Tally responses.
    normalized_name = normalize_lookup_token(cleaned_name)
    stock_items = get_tally_stock_item_map(company_name)
    return stock_items.get(normalized_name)


def query_tally_item_by_erp(
    erp_code: str, company_name: str | None = None
) -> tuple[bool, str | None, str | None, str | None, str | None]:
    normalized_erp = normalize_lookup_token(erp_code)
    if not normalized_erp:
        return False, None, None, None, None

    # 1) Direct Tally Part No lookup. This is the preferred fallback when item name differs.
    direct_part_item = query_tally_stock_item_by_part_no(erp_code, company_name)
    if direct_part_item.get("exists") and direct_part_item.get("name"):
        return (
            True,
            str(direct_part_item.get("name") or "").strip() or None,
            str(direct_part_item.get("guid") or "").strip() or None,
            str(direct_part_item.get("partNo") or "").strip() or None,
            "part number",
        )

    # 2) Fallback to bulk map lookup.
    stock_items = get_tally_stock_item_map(company_name)
    matches: list[dict[str, Any]] = []
    match_sources: list[str] = []
    for item in stock_items.values():
        part_no = normalize_lookup_token(item.get("partNo"))
        aliases = [normalize_lookup_token(alias) for alias in list(item.get("aliases") or [])]
        if normalized_erp == part_no and part_no:
            matches.append(item)
            match_sources.append("part number")
            continue
        if normalized_erp in aliases:
            matches.append(item)
            match_sources.append("alias")

    if len(matches) == 1:
        matched = matches[0]
        direct_item = query_tally_stock_item_details(str(matched.get("name") or ""), company_name)
        if direct_item.get("exists"):
            matched = direct_item
        return (
            True,
            str(matched.get("name") or "").strip() or None,
            str(matched.get("guid") or "").strip() or None,
            str(matched.get("partNo") or "").strip() or None,
            match_sources[0] if match_sources else None,
        )

    if len(matches) > 1:
        candidate_names = ", ".join(
            sorted(
                f"{str(match.get('name') or '').strip()} [Part No: {str(match.get('partNo') or '').strip() or 'blank'}]"
                for match in matches
                if match.get("name")
            )
        )
        LOGGER.warning(
            "ERP '%s' matched multiple Tally stock items: %s. Auto-match skipped to avoid ambiguity.",
            str(erp_code or "").strip(),
            candidate_names,
        )
    return False, None, None, None, None


def resolve_tally_item_name(item_name: str, erp_code: str, company_name: str | None, item_kind: str) -> str:
    normalized_name = str(item_name or "").strip()
    exact_item = get_tally_item_record_by_name(normalized_name, company_name)
    if exact_item:
        if str(erp_code or "").strip():
            LOGGER.info(
                "%s '%s' found in Tally by exact name with Tally Part No '%s'.",
                item_kind,
                normalized_name,
                str(exact_item.get("partNo") or "").strip() or "blank",
            )
        return str(exact_item.get("name") or normalized_name).strip() or normalized_name

    exists_by_erp, tally_name, _guid_by_erp, tally_part_no, match_source = query_tally_item_by_erp(erp_code, company_name)
    if exists_by_erp and tally_name:
        LOGGER.warning(
            "%s '%s' not found by name in Tally. ERP '%s' matched existing Tally item '%s' via %s lookup. Tally Part No='%s'. Posting will use the Tally name.",
            item_kind,
            normalized_name,
            str(erp_code or "").strip(),
            tally_name,
            str(match_source or "part/alias"),
            str(tally_part_no or "").strip() or "blank",
        )
        return tally_name

    if str(erp_code or "").strip():
        LOGGER.info(
            "%s '%s' was not found in Tally by name, part number, or alias for ERP '%s'.",
            item_kind,
            normalized_name,
            str(erp_code or "").strip(),
        )

    return normalized_name


def _normalize_group_name(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").strip().upper())


def resolve_tally_target_group(preferred_group: str, tally_groups: set[str], item_kind: str) -> str:
    cleaned_preferred = str(preferred_group or "").strip()
    preferred_upper = cleaned_preferred.upper()
    if preferred_upper in tally_groups:
        return cleaned_preferred

    normalized_groups = {group: _normalize_group_name(group) for group in tally_groups}
    preferred_normalized = _normalize_group_name(cleaned_preferred)
    if preferred_normalized:
        for group_name, normalized in normalized_groups.items():
            if normalized == preferred_normalized:
                return group_name

    if item_kind.upper().startswith("FG"):
        fg_candidates = [
            FG_GROUP_OVERRIDE,
            cleaned_preferred,
            FG_GROUP,
            "FINISHED GOOD",
            "FINISHED PRODUCTS",
            "FINISHED PRODUCT",
            "FG",
            "FINISH GOODS",
        ]
        for candidate in fg_candidates:
            normalized_candidate = _normalize_group_name(candidate)
            if not normalized_candidate:
                continue
            for group_name, normalized in normalized_groups.items():
                if normalized == normalized_candidate:
                    LOGGER.warning(
                        "FG target stock group '%s' not found in Tally. Using existing group '%s' instead.",
                        cleaned_preferred or FG_GROUP,
                        group_name,
                    )
                    return group_name

        fuzzy_matches = [
            group_name
            for group_name, normalized in normalized_groups.items()
            if "FINISHED" in normalized or normalized == "FG" or normalized.startswith("FG")
        ]
        if len(fuzzy_matches) == 1:
            LOGGER.warning(
                "FG target stock group '%s' not found in Tally. Using closest existing group '%s'.",
                cleaned_preferred or FG_GROUP,
                fuzzy_matches[0],
            )
            return fuzzy_matches[0]

    return cleaned_preferred


def query_tally_unit(unit_name: str, company_name: str | None = None) -> bool:
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
    response_text = post_xml_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        root = None
    if root is not None:
        for unit in root.findall(".//UNIT"):
            name = unit.get("NAME") or unit.findtext("NAME")
            if str(name or "").strip().upper() == unit_name.strip().upper():
                return True
        for unit in root.findall(".//EXACTUNITS.LIST/*"):
            name = unit.get("NAME") or unit.findtext("NAME")
            if str(name or "").strip().upper() == unit_name.strip().upper():
                return True
            for node in list(unit):
                node_text = str(node.text or "").strip()
                if node_text.upper() == unit_name.strip().upper():
                    return True
    return False


def _format_material_number(value: Any) -> str:
    numeric = to_float(value)
    if numeric <= 0:
        return ""
    if abs(numeric - int(numeric)) < 0.00001:
        return str(int(numeric))
    return f"{numeric:.2f}".rstrip("0").rstrip(".")


def build_reel_display_name(material: dict[str, Any], fallback_line: dict[str, Any] | None = None) -> str:
    source = fallback_line or {}
    erp_code = str(material.get("erpCode") or source.get("erpCode") or "").strip()
    size = _format_material_number(material.get("size") or source.get("size"))
    gsm = _format_material_number(material.get("gsm") or source.get("gsm"))
    bf = _format_material_number(material.get("bf") or source.get("bf"))
    uom = str(material.get("uom") or source.get("uom") or "CM").strip() or "CM"
    color = str(material.get("color") or source.get("color") or "").strip()
    if erp_code and size and gsm and bf and color:
        return f"{erp_code} - Size: {size} {uom} X GSM: {gsm} X BF: {bf}   Color - {color}"
    return ""


def resolve_material_display_name(material: dict[str, Any], fallback_line: dict[str, Any] | None = None) -> str:
    source = fallback_line or {}
    for key in ("name", "itemName", "materialName"):
        value = str(material.get(key) or source.get(key) or "").strip()
        if value:
            return value

    material_type = str(material.get("type") or source.get("type") or "").strip().lower()
    if material_type == "reel":
        reel_name = build_reel_display_name(material, source)
        if reel_name:
            return reel_name

    erp_code = str(material.get("erpCode") or source.get("erpCode") or "").strip()
    if erp_code:
        return erp_code

    return ""


def build_material_lookup_row(
    material_id: str,
    material_map: dict[str, dict[str, Any]],
    npd_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    material = material_map.get(material_id)
    if material:
        return material

    npd_row = npd_map.get(material_id) or {}
    if not npd_row:
        return {}

    return {
        "id": material_id,
        "name": str(npd_row.get("itemName") or "").strip(),
        "itemName": str(npd_row.get("itemName") or "").strip(),
        "materialName": str(npd_row.get("itemName") or "").strip(),
        "uom": str(npd_row.get("uom") or "PCS").strip() or "PCS",
        "type": str(npd_row.get("type") or "").strip(),
        "erpCode": str(npd_row.get("erp") or "").strip(),
        "openingRate": to_float(npd_row.get("openingRate") or npd_row.get("rate")),
    }


def is_reel_like_material(material_type: str, item_name: str, target_group: str) -> bool:
    normalized_type = str(material_type or "").strip().lower()
    if normalized_type == "reel":
        return True

    normalized_group = str(target_group or "").strip().upper()
    normalized_name = str(item_name or "").strip().upper()
    if normalized_group == "KRAFT PAPER":
        return True
    if "SIZE:" in normalized_name and "GSM:" in normalized_name:
        return True
    return False


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
    if "already exists" in response_text.lower() or "duplicate" in response_text.lower():
        return True, "Already exists"
    if query_tally_unit(unit_name, company_name):
        return True, "Linked after import verification"
    return False, response_error_message(response_text)


def ensure_tally_unit_exists(company_name: str | None, unit_name: str) -> None:
    normalized_unit = str(unit_name or "").strip() or "NOS"
    if query_tally_unit(normalized_unit, company_name):
        return

    LOGGER.info("Unit '%s' missing in Tally. Auto-creating unit.", normalized_unit)
    success, result = create_tally_unit(company_name, normalized_unit)
    if not success:
        raise RuntimeError(f"Unit '{normalized_unit}' could not be auto-created in Tally: {result}")
    LOGGER.info("Unit '%s' accepted by Tally unit-create flow (%s)", normalized_unit, result)


def create_tally_rm_item(
    company_name: str | None,
    item_name: str,
    erp_code: str,
    target_group: str,
    unit_name: str,
) -> tuple[bool, str]:
    safe_name = escape_xml(item_name)
    safe_group = escape_xml(target_group)
    safe_erp = escape_xml(erp_code)
    safe_unit = escape_xml(unit_name or "Nos")
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
                            <PARTNO>{safe_erp}</PARTNO>
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
        invalidate_tally_stock_item_cache(company_name)
        return True, "Success"
    if "already exists" in response_text.lower() or "duplicate" in response_text.lower():
        invalidate_tally_stock_item_cache(company_name)
        return True, "Already exists"
    invalidate_tally_stock_item_cache(company_name)
    exists, _guid = query_tally_item(item_name, company_name)
    if exists:
        return True, "Linked after import verification"
    exists_by_erp, matched_name, _guid, _part_no, match_source = query_tally_item_by_erp(erp_code, company_name)
    if exists_by_erp and matched_name:
        LOGGER.info(
            "Raw material '%s' became available in Tally after create attempt as '%s' using %s match for ERP '%s'.",
            item_name,
            matched_name,
            match_source or "ERP",
            erp_code,
        )
        return True, "Linked after ERP verification"
    LOGGER.error(
        "Tally stock-item create failed for '%s'. Request XML: %s | Response XML: %s",
        item_name,
        compact_xml_for_log(xml_text),
        compact_xml_for_log(response_text),
    )
    return False, response_error_message(response_text)


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


def build_voucher_lookup_xml(voucher_number: str, company_name: str | None, voucher_type: str) -> str:
    safe_number = escape_xml(voucher_number)
    safe_type = escape_xml(voucher_type)
    return f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>VoucherLookup</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVFROMDATE>20240101</SVFROMDATE>
                    <SVTODATE>20991231</SVTODATE>
                    <VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="VoucherLookup" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>VoucherNumber</FETCH>
                            <FETCH>MasterID</FETCH>
                            <FETCH>GUID</FETCH>
                            <FETCH>VoucherKey</FETCH>
                            <FETCH>RemoteID</FETCH>
                            <FILTERS>OnlyTargetVoucher</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="OnlyTargetVoucher">$$StringEqual:$VoucherNumber:"{safe_number}"</SYSTEM>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """


def build_voucher_object_export_xml(id_type: str, id_value: str, company_name: str | None) -> str:
    return f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>OBJECT</TYPE>
            <SUBTYPE>Voucher</SUBTYPE>
            <ID TYPE="{escape_xml(id_type)}">{escape_xml(id_value)}</ID>
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


def parse_voucher_lookup_ids(xml_text: str) -> dict[str, str]:
    cleaned = clean_tally_xml(xml_text)
    if not cleaned:
        return {}
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return {}

    for element in root.iter():
        voucher_number = extract_first_tag_value(ET.tostring(element, encoding="unicode"), "VOUCHERNUMBER")
        master_id = extract_first_tag_value(ET.tostring(element, encoding="unicode"), "MASTERID")
        guid = extract_first_tag_value(ET.tostring(element, encoding="unicode"), "GUID")
        voucher_key = extract_first_tag_value(ET.tostring(element, encoding="unicode"), "VOUCHERKEY")
        remote_id = extract_first_tag_value(ET.tostring(element, encoding="unicode"), "REMOTEID")
        if voucher_number and any((master_id, guid, voucher_key, remote_id)):
            return {
                "VoucherNumber": voucher_number,
                "MasterID": master_id,
                "GUID": guid,
                "VoucherKey": voucher_key,
                "RemoteID": remote_id,
            }
    return {}


def fetch_voucher_xml_from_tally(company_name: str | None, voucher_number: str, voucher_type: str) -> str:
    lookup_response = post_xml_to_tally(build_voucher_lookup_xml(voucher_number, company_name, voucher_type))
    lookup_ids = parse_voucher_lookup_ids(lookup_response)

    for id_type, key in (("MasterID", "MasterID"), ("GUID", "GUID"), ("VoucherKey", "VoucherKey"), ("RemoteID", "RemoteID")):
        id_value = str(lookup_ids.get(key) or "").strip()
        if not id_value:
            continue
        object_response = post_xml_to_tally(build_voucher_object_export_xml(id_type, id_value, company_name))
        if "<VOUCHER" in str(object_response or "").upper():
            return object_response

    return ""


def fetch_voucher_lookup_ids_from_tally(company_name: str | None, voucher_number: str, voucher_type: str) -> dict[str, str]:
    lookup_response = post_xml_to_tally(build_voucher_lookup_xml(voucher_number, company_name, voucher_type))
    return parse_voucher_lookup_ids(lookup_response)


def voucher_contains_fg_inward_item(voucher_xml: str, fg_item_name: str) -> bool:
    cleaned = clean_tally_xml(voucher_xml)
    if not cleaned or not fg_item_name:
        return False

    target = normalize_lookup_token(fg_item_name)
    for match in re.findall(r"<INVENTORYENTRIESIN\.LIST\b[^>]*>.*?</INVENTORYENTRIESIN\.LIST>", cleaned, flags=re.IGNORECASE | re.DOTALL):
        stock_item_name = extract_first_tag_value(match, "STOCKITEMNAME")
        if normalize_lookup_token(stock_item_name) == target:
            return True
    return False


def build_voucher_delete_xml(master_id: str, company_name: str | None, voucher_type: str) -> str:
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
                    <TALLYMESSAGE>
                        <VOUCHER VCHTYPE="{escape_xml(voucher_type)}" ACTION="Delete" MASTERID="{escape_xml(master_id)}">
                            <MASTERID>{escape_xml(master_id)}</MASTERID>
                        </VOUCHER>
                    </TALLYMESSAGE>
                </REQUESTDATA>
            </IMPORTDATA>
        </BODY>
    </ENVELOPE>
    """


def delete_voucher_from_tally(company_name: str | None, voucher_number: str, voucher_type: str) -> tuple[bool, str]:
    lookup_ids = fetch_voucher_lookup_ids_from_tally(company_name, voucher_number, voucher_type)
    master_id = str(lookup_ids.get("MasterID") or "").strip()
    if not master_id:
        return False, f"MasterID not found for {voucher_type} {voucher_number}."

    delete_xml = build_voucher_delete_xml(master_id, company_name, voucher_type)
    response_text = post_xml_to_tally(delete_xml)
    if "<DELETED>1</DELETED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        return True, "Deleted from Tally"

    return False, response_error_message(response_text)


def get_latest_non_reel_rate(conn, material_id: str, opening_rate: float) -> float:
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT pol.rate
            FROM `purchase_order_lines` pol
            INNER JOIN `purchase_orders` po ON po.id = pol.purchaseOrderId
            WHERE pol.materialId = %s
            ORDER BY po.poDate DESC, po.updateTimestamp DESC, po.id DESC
            LIMIT 1
            """,
            (material_id,),
        )
        row = cursor.fetchone()
        latest_rate = to_float((row or {}).get("rate"))
        if latest_rate > 0:
            return latest_rate
        return opening_rate
    finally:
        cursor.close()


def get_latest_reel_rate_from_material_in(material_in_rows: list[dict[str, Any]], material_map: dict[str, dict[str, Any]]) -> float:
    ranked_rows: list[tuple[datetime, dict[str, Any]]] = []
    for row in material_in_rows:
        parsed = _parse_tally_date(row.get("date")) or _parse_tally_date(row.get("updateTimestamp")) or _parse_tally_date(row.get("timestamp"))
        ranked_rows.append((parsed or datetime.min, row))

    ranked_rows.sort(key=lambda item: item[0], reverse=True)

    for _rank, row in ranked_rows:
        lines = parse_json_lines(row.get("lines"))

        for line in lines:
            material_id = str(line.get("materialId") or line.get("itemId") or "").strip()
            material = material_map.get(material_id) or {}
            if str(material.get("type") or "").strip().lower() != "reel":
                continue

            rate = to_float(line.get("invoiceRate")) or to_float(line.get("rate"))
            if rate > 0:
                return rate

    return 0.0


def get_pending_jobs(conn) -> list[dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT *
            FROM `productions`
            WHERE COALESCE(prodFromFFG, 0) > 0
              AND (cancelTimestamp IS NULL OR TRIM(cancelTimestamp) = '')
              AND COALESCE(status, '') <> 'Cancelled'
              AND (tallyTimestamp IS NULL OR TRIM(tallyTimestamp) = '')
              AND (
                    tallyPostingStatus IS NULL
                 OR TRIM(tallyPostingStatus) = ''
                 OR tallyPostingStatus IN ('Pending', 'Ready', 'Error', 'Processing')
              )
            ORDER BY date ASC, transactionNo ASC
            """
        )
        return cursor.fetchall()
    finally:
        cursor.close()


def resolve_fg_item_profile(conn, production: dict[str, Any]) -> dict[str, str]:
    if str(production.get("itemSource") or "FG").strip().upper() == "FG":
        item_id = str(production.get("itemId") or "").strip()
        if item_id:
            cursor = conn.cursor(dictionary=True)
            try:
                cursor.execute(
                    """
                    SELECT i.`name`, i.`uom`, i.`erp`, ig.`name` AS groupName
                    FROM `items` i
                    LEFT JOIN `item_groups` ig ON ig.`id` = i.`groupId`
                    WHERE i.`id` = %s
                    LIMIT 1
                    """,
                    (item_id,),
                )
                row = cursor.fetchone()
                name = str((row or {}).get("name") or "").strip()
                if name:
                    return {
                        "name": name,
                        "uom": str((row or {}).get("uom") or production.get("uom") or "PCS").strip(),
                        "erpCode": str((row or {}).get("erp") or "").strip(),
                        "groupName": str((row or {}).get("groupName") or FG_GROUP).strip() or FG_GROUP,
                    }
            finally:
                cursor.close()

    for erp_code in (
        str(production.get("erpCode") or "").strip(),
        str(production.get("masterErp") or "").strip(),
    ):
        if not erp_code:
            continue

        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                """
                SELECT i.`name`, i.`uom`, i.`erp`, ig.`name` AS groupName
                FROM `items` i
                LEFT JOIN `item_groups` ig ON ig.`id` = i.`groupId`
                WHERE TRIM(COALESCE(i.`erp`, '')) = %s
                LIMIT 1
                """,
                (erp_code,),
            )
            row = cursor.fetchone()
            name = str((row or {}).get("name") or "").strip()
            if name:
                return {
                    "name": name,
                    "uom": str((row or {}).get("uom") or production.get("uom") or "PCS").strip(),
                    "erpCode": str((row or {}).get("erp") or erp_code).strip(),
                    "groupName": str((row or {}).get("groupName") or FG_GROUP).strip() or FG_GROUP,
                }
        finally:
            cursor.close()

    npd_id = str(production.get("npdId") or "").strip()
    if npd_id:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute("SELECT `itemName`, `uom` FROM `npd` WHERE `id` = %s LIMIT 1", (npd_id,))
            row = cursor.fetchone()
            name = str((row or {}).get("itemName") or "").strip()
            if name:
                return {
                    "name": name,
                    "uom": str((row or {}).get("uom") or production.get("uom") or "PCS").strip(),
                    "erpCode": str(production.get("erpCode") or production.get("masterErp") or "").strip(),
                    "groupName": FG_GROUP,
                }
        finally:
            cursor.close()

    for erp_code in (
        str(production.get("erpCode") or "").strip(),
        str(production.get("masterErp") or "").strip(),
    ):
        if not erp_code:
            continue

        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute("SELECT `itemName`, `uom` FROM `npd` WHERE TRIM(COALESCE(`erp`, '')) = %s LIMIT 1", (erp_code,))
            row = cursor.fetchone()
            name = str((row or {}).get("itemName") or "").strip()
            if name:
                return {
                    "name": name,
                    "uom": str((row or {}).get("uom") or production.get("uom") or "PCS").strip(),
                    "erpCode": erp_code,
                    "groupName": FG_GROUP,
                }
        finally:
            cursor.close()

    raise RuntimeError(f"FG stock item name could not be resolved for job {production.get('transactionNo') or production.get('id')}.")


def build_job_context(conn, production: dict[str, Any]) -> dict[str, Any]:
    production_id = str(production["id"])
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM `materials`")
        materials = cursor.fetchall()
        material_map = {str(row["id"]): row for row in materials}

        cursor.execute("SELECT * FROM `npd`")
        npd_rows = cursor.fetchall()
        npd_map = {str(row["id"]): row for row in npd_rows}

        cursor.execute("SELECT * FROM `material_in_packing_slips`")
        packing_slips = cursor.fetchall()
        packing_slip_map = {str(row["id"]): row for row in packing_slips}

        cursor.execute("SELECT * FROM `material_in`")
        material_in_rows = cursor.fetchall()
        material_in_line_map: dict[tuple[str, str], dict[str, Any]] = {}
        for row in material_in_rows:
            lines = parse_json_lines(row.get("lines"))
            for line in lines:
                material_in_line_map[(str(row["id"]), str(line.get("id") or ""))] = line

        latest_reel_rate = get_latest_reel_rate_from_material_in(material_in_rows, material_map)

        cursor.execute(
            """
            SELECT mil.*, mi.productionId
            FROM `material_issue_lines` mil
            INNER JOIN `material_issues` mi ON mi.id = mil.materialIssueId
            WHERE mi.productionId = %s AND COALESCE(mi.issueType, '') = 'Job'
            """,
            (production_id,),
        )
        issue_lines = cursor.fetchall()

        cursor.execute(
            """
            SELECT mirl.*
            FROM `material_issue_reel_lines` mirl
            INNER JOIN `material_issues` mi ON mi.id = mirl.materialIssueId
            WHERE mi.productionId = %s AND COALESCE(mi.issueType, '') = 'Job'
            """,
            (production_id,),
        )
        issue_reel_lines = cursor.fetchall()

        cursor.execute(
            """
            SELECT mrl.*, mr.productionId
            FROM `material_return_lines` mrl
            INNER JOIN `material_returns` mr ON mr.id = mrl.materialReturnId
            WHERE mr.productionId = %s AND COALESCE(mr.returnType, '') = 'Job'
            """,
            (production_id,),
        )
        return_lines = cursor.fetchall()

        cursor.execute(
            """
            SELECT mrrl.*
            FROM `material_return_reel_lines` mrrl
            INNER JOIN `material_returns` mr ON mr.id = mrrl.materialReturnId
            WHERE mr.productionId = %s AND COALESCE(mr.returnType, '') = 'Job'
            """,
            (production_id,),
        )
        return_reel_lines = cursor.fetchall()
    finally:
        cursor.close()

    fg_profile = resolve_fg_item_profile(conn, production)
    fg_name = fg_profile["name"]
    fg_uom = fg_profile["uom"]
    fg_qty = to_float(production.get("prodFromFFG"))
    voucher_no = str(production.get("transactionNo") or "").strip()
    if not voucher_no:
        raise RuntimeError(f"Voucher number could not be derived for production {production_id}.")
    voucher_date = format_production_date(production)

    rm_map: dict[str, dict[str, Any]] = {}

    for line in issue_reel_lines:
        material_id = str(line.get("materialId") or "").strip()
        if not material_id:
            continue
        material = build_material_lookup_row(material_id, material_map, npd_map)
        slip = packing_slip_map.get(str(line.get("packingSlipId") or "").strip()) or {}
        material_in_id = str(slip.get("materialInId") or "").strip()
        material_line_id = str(slip.get("materialLineId") or "").strip()
        source_line = material_in_line_map.get((material_in_id, material_line_id), {})
        rate = (
            to_float(source_line.get("invoiceRate"))
            or to_float(source_line.get("rate"))
            or latest_reel_rate
            or to_float(material.get("openingRate"))
        )
        current = rm_map.get(material_id) or {
            "materialId": material_id,
            "name": resolve_material_display_name(material, line),
            "uom": str(material.get("uom") or "KG").strip() or "KG",
            "type": str(material.get("type") or "reel").strip() or "reel",
            "erpCode": str(material.get("erpCode") or "").strip(),
            "openingRate": to_float(material.get("openingRate")),
            "issuedQty": 0.0,
            "returnedQty": 0.0,
            "rate": 0.0,
        }
        current["issuedQty"] += to_float(line.get("weightKg"))
        if rate > 0:
            current["rate"] = rate
        rm_map[material_id] = current

    for line in return_reel_lines:
        material_id = str(line.get("materialId") or "").strip()
        if not material_id:
            continue
        material = build_material_lookup_row(material_id, material_map, npd_map)
        current = rm_map.get(material_id) or {
            "materialId": material_id,
            "name": resolve_material_display_name(material, line),
            "uom": str(material.get("uom") or "KG").strip() or "KG",
            "type": str(material.get("type") or "reel").strip() or "reel",
            "erpCode": str(material.get("erpCode") or "").strip(),
            "openingRate": to_float(material.get("openingRate")),
            "issuedQty": 0.0,
            "returnedQty": 0.0,
            "rate": 0.0,
        }
        current["returnedQty"] += to_float(line.get("weightKg"))
        rm_map[material_id] = current

    for line in issue_lines:
        material_id = str(line.get("materialId") or "").strip()
        material = build_material_lookup_row(material_id, material_map, npd_map)
        if str(material.get("type") or "").strip().lower() == "reel":
            continue
        current = rm_map.get(material_id) or {
            "materialId": material_id,
            "name": resolve_material_display_name(material, line),
            "uom": str(line.get("uom") or material.get("uom") or "NOS").strip() or "NOS",
            "type": str(material.get("type") or "").strip(),
            "erpCode": str(material.get("erpCode") or "").strip(),
            "openingRate": to_float(material.get("openingRate")),
            "issuedQty": 0.0,
            "returnedQty": 0.0,
            "rate": 0.0,
        }
        current["issuedQty"] += to_float(line.get("qty"))
        rm_map[material_id] = current

    for line in return_lines:
        material_id = str(line.get("materialId") or "").strip()
        material = build_material_lookup_row(material_id, material_map, npd_map)
        if str(material.get("type") or "").strip().lower() == "reel":
            continue
        current = rm_map.get(material_id) or {
            "materialId": material_id,
            "name": resolve_material_display_name(material, line),
            "uom": str(line.get("uom") or material.get("uom") or "NOS").strip() or "NOS",
            "type": str(material.get("type") or "").strip(),
            "erpCode": str(material.get("erpCode") or "").strip(),
            "openingRate": to_float(material.get("openingRate")),
            "issuedQty": 0.0,
            "returnedQty": 0.0,
            "rate": 0.0,
        }
        current["returnedQty"] += to_float(line.get("qty"))
        rm_map[material_id] = current

    rm_lines: list[dict[str, Any]] = []
    for material_id, row in rm_map.items():
        net_qty = round(row["issuedQty"] - row["returnedQty"], 5)
        if net_qty <= 0:
            continue
        material_type = str(row.get("type") or "").strip().lower()
        resolved_rate = to_float(row.get("rate"))
        if material_type != "reel":
            resolved_rate = get_latest_non_reel_rate(conn, material_id, to_float(row.get("openingRate")))
        amount = round(net_qty * resolved_rate, 2)
        rm_lines.append(
            {
                "materialId": material_id,
                "name": str(row.get("name") or "").strip(),
                "uom": str(row.get("uom") or "NOS").strip() or "NOS",
                "type": str(row.get("type") or "").strip(),
                "erpCode": str(row.get("erpCode") or "").strip(),
                "netQty": net_qty,
                "rate": resolved_rate,
                "amount": amount,
            }
        )

    total_component_cost = round(sum(line["amount"] for line in rm_lines if line["amount"] > 0), 2)
    effective_rate = round(total_component_cost / fg_qty, 5) if fg_qty > 0 else 0.0

    return {
        "production": production,
        "voucherNo": voucher_no,
        "voucherDate": voucher_date,
        "fgName": fg_name,
        "fgQty": fg_qty,
        "fgUom": fg_uom or str(production.get("uom") or "PCS").strip() or "PCS",
        "fgErpCode": str(fg_profile.get("erpCode") or "").strip(),
        "fgGroupName": str(fg_profile.get("groupName") or FG_GROUP).strip() or FG_GROUP,
        "rmLines": rm_lines,
        "totalComponentCost": total_component_cost,
        "effectiveRate": effective_rate,
    }


def validate_job_context(job: dict[str, Any]) -> None:
    production = job["production"]
    if job["fgQty"] <= 0:
        raise RuntimeError(f"Prod (FFG) is missing or zero for job {production.get('transactionNo')}.")
    if not job["voucherNo"]:
        raise RuntimeError(f"Voucher number is blank for job {production.get('id')}.")
    if not job["voucherDate"]:
        raise RuntimeError(f"Voucher date is blank for job {production.get('transactionNo')}.")
    if not str(job["fgName"]).strip():
        raise RuntimeError(f"FG stock item name is missing for job {production.get('transactionNo')}.")
    if not job["rmLines"]:
        raise RuntimeError(f"No positive net material consumption found for job {production.get('transactionNo')}.")
    for line in job["rmLines"]:
        if not str(line.get("name") or "").strip():
            raise RuntimeError(f"Material name could not be resolved for materialId={line.get('materialId')}.")
        if to_float(line.get("netQty")) <= 0:
            raise RuntimeError(f"Material quantity is invalid for {line.get('name')}.")
        if to_float(line.get("rate")) <= 0:
            raise RuntimeError(f"Material rate could not be resolved for {line.get('name')}.")
    if job["totalComponentCost"] <= 0:
        raise RuntimeError(f"Total component cost is not positive for job {production.get('transactionNo')}.")


def ensure_stock_item_exists(
    company_name: str | None,
    item_name: str,
    erp_code: str,
    target_group: str,
    unit_name: str,
    tally_groups: set[str],
    item_kind: str,
) -> None:
    exists, _guid = query_tally_item(item_name, company_name)
    if exists:
        return

    ensure_tally_unit_exists(company_name, unit_name)

    effective_group = resolve_tally_target_group(target_group, tally_groups, item_kind)

    normalized_tally_groups = {_normalize_group_name(group) for group in tally_groups}
    if _normalize_group_name(effective_group) not in normalized_tally_groups:
        raise RuntimeError(
            f"{item_kind} '{item_name}' is missing in Tally and target stock group '{target_group}' does not exist."
        )

    LOGGER.info("%s '%s' missing in Tally. Auto-creating under group '%s'.", item_kind, item_name, effective_group)
    success, result = create_tally_rm_item(
        company_name=company_name,
        item_name=item_name,
        erp_code=erp_code,
        target_group=effective_group,
        unit_name=unit_name,
    )
    if not success:
        raise RuntimeError(f"{item_kind} '{item_name}' could not be auto-created in Tally: {result}")

    exists_after, _guid_after = query_tally_item(item_name, company_name)
    if not exists_after:
        raise RuntimeError(f"{item_kind} '{item_name}' still does not exist in Tally after auto-create attempt.")

    LOGGER.info("Auto-created %s '%s' in Tally under group '%s'", item_kind.lower(), item_name, effective_group)


def ensure_stock_items_for_jobs(company_name: str | None, jobs: list[dict[str, Any]], tally_groups: set[str]) -> None:
    for job in jobs:
        job["fgTallyName"] = resolve_tally_item_name(
            item_name=str(job.get("fgName") or ""),
            erp_code=str(job.get("fgErpCode") or ""),
            company_name=company_name,
            item_kind="FG stock item",
        )
        if str(job.get("fgTallyName") or "") != str(job.get("fgName") or ""):
            LOGGER.info("FG posting name resolved exactly from Tally: app='%s' | tally='%s'", job.get("fgName"), job.get("fgTallyName"))
        fg_tally_details = query_tally_stock_item_details(str(job.get("fgTallyName") or job.get("fgName") or ""), company_name)
        fg_base_unit = str(fg_tally_details.get("baseUnit") or "").strip()
        job["fgTallyBaseUnit"] = fg_base_unit
        if fg_tally_details.get("exists") and has_valid_tally_unit(fg_base_unit):
            job["fgUom"] = fg_base_unit
            LOGGER.info("Using Tally BaseUnits '%s' for FG stock item '%s'.", fg_base_unit, job.get("fgTallyName") or job.get("fgName"))
        elif fg_tally_details.get("exists"):
            job["fgUnitValidationError"] = (
                f"FG stock item '{job.get('fgTallyName') or job.get('fgName')}' exists in Tally "
                f"but has no valid Unit/Base Unit. Current Tally unit is "
                f"'{fg_base_unit or 'blank'}'. Please set Units, for example 'PCS', in Tally before MJ posting."
            )
        for line in job["rmLines"]:
            line["tallyName"] = resolve_tally_item_name(
                item_name=str(line.get("name") or ""),
                erp_code=str(line.get("erpCode") or ""),
                company_name=company_name,
                item_kind="Raw material",
            )
            if str(line.get("tallyName") or "") != str(line.get("name") or ""):
                LOGGER.info("Raw material posting name resolved exactly from Tally: app='%s' | tally='%s'", line.get("name"), line.get("tallyName"))
            tally_item_details = query_tally_stock_item_details(str(line.get("tallyName") or line.get("name") or ""), company_name)
            tally_base_unit = str(tally_item_details.get("baseUnit") or "").strip()
            material_type = str(line.get("type") or "").strip().lower()
            if tally_item_details.get("exists") and tally_base_unit:
                line["uom"] = tally_base_unit
                LOGGER.info("Using Tally BaseUnits '%s' for raw material '%s'.", tally_base_unit, line.get("tallyName") or line.get("name"))
            elif tally_item_details.get("exists") and is_reel_like_material(material_type, str(line.get("tallyName") or line.get("name") or ""), REEL_GROUP):
                # Safe fallback for reel paper items. Tally XML shows reel items use BASEUNITS=KGS.
                line["uom"] = "KGS"
                LOGGER.info("Tally BaseUnits blank for reel raw material '%s'. Using fallback UOM 'KGS'.", line.get("tallyName") or line.get("name"))

            # Final posting name. For reel/paper raw materials, prefer ERP/MailingName alias
            # because Tally stores the ERP code as MAILINGNAME and voucher import accepts aliases.
            # This avoids exact-name failures caused by multiple spaces in descriptive names.
            line["postingName"] = str(line.get("tallyName") or line.get("name") or "").strip()
            if (
                POST_REEL_BY_ERP_ALIAS
                and str(line.get("erpCode") or "").strip()
                and is_reel_like_material(material_type, str(line.get("tallyName") or line.get("name") or ""), REEL_GROUP)
            ):
                line["postingName"] = str(line.get("erpCode") or "").strip()
                LOGGER.info(
                    "Posting reel raw material by ERP/MailingName alias: app='%s' | tally='%s' | posting='%s'",
                    line.get("name"),
                    line.get("tallyName"),
                    line.get("postingName"),
                )

    prepared: set[tuple[str, str]] = set()
    required_items: list[dict[str, str]] = []

    for job in jobs:
        fg_key = ("FG", str(job.get("fgTallyName") or job["fgName"]).strip().upper())
        if fg_key not in prepared:
            required_items.append(
                {
                    "kind": "FG stock item",
                    "itemName": str(job["fgName"]),
                    "tallyName": str(job.get("fgTallyName") or job["fgName"]),
                    "erpCode": str(job.get("fgErpCode") or ""),
                    "targetGroup": str(job.get("fgGroupName") or FG_GROUP),
                    "unitName": str(job.get("fgUom") or "PCS"),
                }
            )
            prepared.add(fg_key)

        for line in job["rmLines"]:
            item_name = str(line.get("name") or "").strip()
            tally_name = str(line.get("tallyName") or item_name).strip()
            material_type = str(line.get("type") or "").strip().lower()
            target_group = RM_GROUP_BY_TYPE.get(material_type, OTHER_GROUP)
            if is_reel_like_material(material_type, tally_name or item_name, target_group):
                unit_name = "KGS"
            else:
                unit_name = str(line.get("uom") or "NOS").strip() or "NOS"
            rm_key = ("RM", tally_name.upper())
            if rm_key in prepared:
                continue
            required_items.append(
                {
                    "kind": "Raw material",
                    "itemName": item_name,
                    "tallyName": tally_name,
                    "erpCode": str(line.get("erpCode") or "").strip(),
                    "targetGroup": target_group,
                    "unitName": unit_name,
                }
            )
            prepared.add(rm_key)

    LOGGER.info("Preflight stock-item scan prepared %s unique item(s) across %s job(s)", len(required_items), len(jobs))

    missing_before: list[dict[str, str]] = []
    for item in required_items:
        exists, _guid = query_tally_item(str(item.get("tallyName") or item["itemName"]), company_name)
        if not exists:
            missing_before.append(item)

    LOGGER.info("Preflight found %s missing stock item(s) in Tally before creation", len(missing_before))
    for item in missing_before[:25]:
        LOGGER.info(
            "Missing before create => kind=%s | group=%s | item=%s",
            item["kind"],
            item["targetGroup"],
            str(item.get("tallyName") or item["itemName"]),
        )

    created_count = 0
    for item in missing_before:
        ensure_stock_item_exists(
            company_name=company_name,
            item_name=str(item.get("tallyName") or item["itemName"]),
            erp_code=item["erpCode"],
            target_group=item["targetGroup"],
            unit_name=item["unitName"],
            tally_groups=tally_groups,
            item_kind=item["kind"],
        )
        created_count += 1

    LOGGER.info("Preflight creation attempted for %s stock item(s)", created_count)

    missing_after: list[dict[str, str]] = []
    for item in required_items:
        exists, _guid = query_tally_item(str(item.get("tallyName") or item["itemName"]), company_name)
        if not exists:
            missing_after.append(item)

    LOGGER.info("Preflight found %s stock item(s) still missing after creation", len(missing_after))
    for item in missing_after[:25]:
        LOGGER.error(
            "Still missing after create => kind=%s | group=%s | item=%s",
            item["kind"],
            item["targetGroup"],
            str(item.get("tallyName") or item["itemName"]),
        )

    if missing_after:
        raise RuntimeError(
            f"Preflight stock-item creation incomplete. {len(missing_after)} item(s) are still missing in Tally after create attempt."
        )


def format_qty(quantity: float, unit_name: str) -> str:
    qty_text = f"{quantity:.5f}".rstrip("0").rstrip(".")
    if not qty_text:
        qty_text = "0"
    return f"{qty_text} {unit_name}"


def format_rate(rate: float, unit_name: str) -> str:
    rate_text = f"{rate:.5f}".rstrip("0").rstrip(".")
    if not rate_text:
        rate_text = "0"
    return f"{rate_text}/{unit_name}"


def has_valid_tally_unit(unit_name: str) -> bool:
    normalized = str(unit_name or "").strip().lower()
    return normalized not in ("", "not applicable", "notapplicable", "n/a", "na")


def build_manufacturing_journal_xml(company_name: str | None, job: dict[str, Any]) -> str:
    production = job["production"]
    narration = (
        f"Imported from LNPI Job {production.get('transactionNo')} | "
        f"FG {job['fgName']} | FFG Qty {job['fgQty']}"
    )

    consumption_entries = []

    for line in job["rmLines"]:
        material_type = str(line.get("type") or "").strip().lower()
        item_name_for_unit = str(line.get("tallyName") or line.get("name") or "")

        unit_name = str(line.get("uom") or "").strip()
        if is_reel_like_material(material_type, item_name_for_unit, REEL_GROUP) and unit_name.upper() in ("", "KG", "KILOGRAM", "KILOGRAMS"):
            unit_name = "KGS"
        if not unit_name:
            unit_name = "NOS"

        qty_text = format_qty(to_float(line["netQty"]), unit_name)
        rate_text = format_rate(to_float(line["rate"]), unit_name)
        posting_name = str(line.get("postingName") or line.get("tallyName") or line["name"])

        consumption_entries.append(
            f"""
<INVENTORYENTRIESOUT.LIST>
 <STOCKITEMNAME>{escape_xml(posting_name)}</STOCKITEMNAME>
 <RATE>{escape_xml(rate_text)}</RATE>
 <ACTUALQTY>{escape_xml(qty_text)}</ACTUALQTY>
 <BILLEDQTY>{escape_xml(qty_text)}</BILLEDQTY>
</INVENTORYENTRIESOUT.LIST>
"""
        )

    fg_qty_text = format_qty(job["fgQty"], str(job["fgUom"]))
    fg_name = str(job.get("fgTallyName") or job["fgName"])

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
    <TALLYMESSAGE>
     <VOUCHER VCHTYPE="Manufacturing Journal" ACTION="Create" OBJVIEW="Consumption Voucher View">
      <DATE>{job['voucherDate']}</DATE>
      <VOUCHERTYPENAME>Manufacturing Journal</VOUCHERTYPENAME>
      <VOUCHERNUMBER>{escape_xml(job['voucherNo'])}</VOUCHERNUMBER>
      <PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>
      <ISINVOICE>No</ISINVOICE>
      <NARRATION>{escape_xml(narration)}</NARRATION>

      {''.join(consumption_entries)}

      <INVENTORYENTRIESIN.LIST>
       <STOCKITEMNAME>{escape_xml(fg_name)}</STOCKITEMNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPRIMARYITEM>Yes</ISPRIMARYITEM>
       <ACTUALQTY>{escape_xml(fg_qty_text)}</ACTUALQTY>
       <BILLEDQTY>{escape_xml(fg_qty_text)}</BILLEDQTY>
      </INVENTORYENTRIESIN.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
"""


def update_attempt(conn, production_id: str) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `productions`
        SET `tallyLastAttemptAt` = %s,
            `tallyPostingAttemptCount` = COALESCE(`tallyPostingAttemptCount`, 0) + 1,
            `tallyPostingStatus` = 'Processing',
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (now, now, production_id),
    )
    conn.commit()
    cursor.close()


def mark_posted(
    conn,
    production_id: str,
    voucher_no: str,
    voucher_date: str,
    remark: str,
    tally_timestamp: str | None = None,
) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    success_time = tally_timestamp or now
    cursor.execute(
        """
        UPDATE `productions`
        SET `tallyTimestamp` = %s,
            `tallyPostingStatus` = 'Posted',
            `tallyVoucherNo` = %s,
            `tallyVoucherDate` = %s,
            `tallyPostedBy` = %s,
            `tallyPostingRemark` = %s,
            `tallyPostingError` = NULL,
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (success_time, voucher_no, voucher_date, POSTED_BY, remark, now, production_id),
    )
    conn.commit()
    cursor.close()


def mark_error(conn, production_id: str, error_text: str) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `productions`
        SET `tallyPostingStatus` = 'Error',
            `tallyPostingRemark` = %s,
            `tallyPostingError` = %s,
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (error_text[:5000], error_text[:5000], now, production_id),
    )
    conn.commit()
    cursor.close()


def process_one_job(conn, company_name: str | None, tally_groups: set[str], job: dict[str, Any]) -> None:
    # Use the already-prepared job so the resolved Tally item names and BaseUnits are not lost.
    production = job["production"]
    production_id = str(production["id"])
    voucher_no = str(production.get("transactionNo") or "").strip()
    update_attempt(conn, production_id)
    validate_job_context(job)
    fg_unit_error = str(job.get("fgUnitValidationError") or "").strip()
    if fg_unit_error:
        raise RuntimeError(fg_unit_error)

    if voucher_exists_in_tally(company_name, job["voucherNo"], "Manufacturing Journal"):
        mark_posted(
            conn,
            production_id=production_id,
            voucher_no=job["voucherNo"],
            voucher_date=job["voucherDate"],
            remark="Manufacturing Journal already existed in Tally. Local row reconciled.",
        )
        LOGGER.info("Skipping job %s because Manufacturing Journal already exists in Tally", voucher_no)
        return

    xml_text = build_manufacturing_journal_xml(company_name, job)
    response_text = post_xml_to_tally(xml_text)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        saved_voucher_xml = fetch_voucher_xml_from_tally(company_name, job["voucherNo"], "Manufacturing Journal")
        if not voucher_contains_fg_inward_item(saved_voucher_xml, str(job.get("fgTallyName") or job["fgName"])):
            delete_success = False
            delete_result = "Delete not attempted"
            try:
                delete_success, delete_result = delete_voucher_from_tally(company_name, job["voucherNo"], "Manufacturing Journal")
            except Exception as delete_error:
                delete_result = f"Delete failed: {delete_error}"
            LOGGER.error(
                "Manufacturing Journal %s was created in Tally but saved voucher does not contain FG inward item '%s'. Delete status=%s (%s). Saved XML: %s",
                job["voucherNo"],
                str(job.get("fgTallyName") or job["fgName"]),
                "success" if delete_success else "failed",
                delete_result,
                compact_xml_for_log(saved_voucher_xml, 2500),
            )
            raise RuntimeError(
                f"Manufacturing Journal {job['voucherNo']} saved in Tally without FG item '{job.get('fgTallyName') or job['fgName']}'. Delete status: {delete_result}. Posting rejected."
            )
        mark_posted(
            conn,
            production_id=production_id,
            voucher_no=job["voucherNo"],
            voucher_date=job["voucherDate"],
            remark=(
                f"Manufacturing Journal posted successfully. "
                f"FG={job['fgName']}, Qty={job['fgQty']}, Cost={job['totalComponentCost']:.2f}"
            ),
        )
        LOGGER.info("Posted Manufacturing Journal %s successfully", job["voucherNo"])
        return

    LOGGER.error("Tally rejected voucher %s. Request XML: %s | Response XML: %s", job["voucherNo"], compact_xml_for_log(xml_text, 2500), compact_xml_for_log(response_text, 2500))
    raise RuntimeError(f"Tally rejected Manufacturing Journal {job['voucherNo']}: {response_error_message(response_text)}")


def main() -> None:
    LOGGER.info("Starting Tally Manufacturing Journal posting")
    LOGGER.info("Tally URL candidates: %s", ", ".join(TALLY_URL_CANDIDATES))

    # Do not force company name by default. Tally will use the active/open company on port 9004.
    # Set LNPI_TALLY_COMPANY_NAME/TALLY_COMPANY_NAME only if you intentionally want to force a company.
    company_name = TALLY_COMPANY_NAME or None
    if company_name:
        LOGGER.info("Using configured Tally company: %s", company_name)
    else:
        LOGGER.info("Using active Tally company on the configured port. No SVCURRENTCOMPANY will be sent.")

    tally_groups = get_tally_groups()
    LOGGER.info("Found %s stock group(s) in Tally", len(tally_groups))

    conn = get_db_connection()
    try:
        pending_jobs = get_pending_jobs(conn)
        LOGGER.info("Found %s eligible job(s) for Manufacturing Journal posting", len(pending_jobs))
        prepared_jobs: list[dict[str, Any]] = []
        for production in pending_jobs:
            try:
                job = build_job_context(conn, production)
                validate_job_context(job)
                prepared_jobs.append(job)
            except Exception as error:
                transaction_no = production.get("transactionNo") or production.get("id")
                LOGGER.exception("ERROR in job %s: %s", transaction_no, error)
                mark_error(conn, str(production["id"]), str(error))

        if prepared_jobs:
            try:
                ensure_stock_items_for_jobs(company_name, prepared_jobs, tally_groups)
            except Exception as error:
                LOGGER.exception("Preflight stock-item preparation failed: %s", error)
                for job in prepared_jobs:
                    mark_error(conn, str(job["production"]["id"]), str(error))
                return

        for job in prepared_jobs:
            production = job["production"]
            try:
                process_one_job(conn, company_name, tally_groups, job)
            except Exception as error:
                transaction_no = production.get("transactionNo") or production.get("id")
                LOGGER.exception("ERROR in job %s: %s", transaction_no, error)
                mark_error(conn, str(production["id"]), str(error))
    finally:
        conn.close()
        LOGGER.info("Finished Tally Manufacturing Journal posting")


if __name__ == "__main__":
    main()
