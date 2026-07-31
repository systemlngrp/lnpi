import logging
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
REQUEST_TIMEOUT = 8
POSTED_BY = "tally_consumption_journal_posting.py"
APP_GROUP_NAME = "App Group"


def resolve_log_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd()


LOG_DIR = resolve_log_dir()
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "consumptionjournallog.log"


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_consumption_journal_posting")
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

TALLY_URL_CANDIDATES = [
    "http://localhost:9004",
    "http://127.0.0.1:9004",
]
ACTIVE_TALLY_URL: str | None = None
TALLY_STOCK_ITEM_CACHE: dict[str, dict[str, dict[str, Any]]] = {}
TALLY_STOCK_ITEM_XML_CACHE: dict[str, str] = {}


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


def build_company_static_variables(company_name: str | None) -> str:
    if not company_name:
        return ""
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>"


def compact_xml_for_log(xml_text: str, max_length: int = 1600) -> str:
    compact = re.sub(r"\s+", " ", str(xml_text or "")).strip()
    if len(compact) <= max_length:
        return compact
    return f"{compact[:max_length]}..."


def clean_tally_xml(xml_text: str) -> str:
    cleaned = str(xml_text or "")
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", cleaned)
    cleaned = re.sub(r"&#(?:0?[0-8]|1[12]|1[4-9]|2[0-9]|3[01]);", "", cleaned)
    cleaned = re.sub(r"&#x(?:[0-8]|[bBcCeE]|1[0-9A-Fa-f]);", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def normalize_lookup_token(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).upper()


def normalize_erp_token(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip()).upper()


def normalize_tally_unit_name(unit_name: Any) -> str:
    cleaned = str(unit_name or "").strip() or "NOS"
    normalized = cleaned.upper()
    if normalized in ("KG", "KILOGRAM", "KILOGRAMS"):
        return "KGS"
    return cleaned


def escape_tally_formula_text(value: Any) -> str:
    return escape_xml(str(value or "")).replace('"', "&quot;")


def clean_tally_text(value: Any) -> str:
    cleaned = clean_tally_xml(str(value or ""))
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = (
        cleaned.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )
    return cleaned.strip()


def extract_matching_tag_values(xml_block: str, tag_names: list[str]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for tag_name in tag_names:
        escaped_tag = re.escape(tag_name)
        for match in re.findall(rf"<{escaped_tag}\b[^>]*>(.*?)</{escaped_tag}>", xml_block, re.IGNORECASE | re.DOTALL):
            cleaned = clean_tally_text(match)
            normalized = normalize_lookup_token(cleaned)
            if not cleaned or normalized in seen:
                continue
            seen.add(normalized)
            values.append(cleaned)
    return values


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


def build_stock_item_details_from_xml_block(item_block: str, requested_name: str = "") -> dict[str, Any]:
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


def query_tally_stock_item_details(item_name: str, company_name: str | None = None) -> dict[str, Any]:
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

    for block in re.findall(r"<STOCKITEM\b[^>]*>.*?</STOCKITEM>", cleaned_response, flags=re.IGNORECASE | re.DOTALL):
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


def get_tally_stock_items_xml(company_name: str | None = None) -> str:
    cache_key = str(company_name or "").strip().upper()
    cached = TALLY_STOCK_ITEM_XML_CACHE.get(cache_key)
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
                            <FETCH>BaseUnits</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    TALLY_STOCK_ITEM_XML_CACHE[cache_key] = cleaned
    return cleaned


def get_tally_stock_item_map(company_name: str | None = None) -> dict[str, dict[str, Any]]:
    cache_key = str(company_name or "").strip().upper()
    cached = TALLY_STOCK_ITEM_CACHE.get(cache_key)
    if cached is not None:
        return cached

    cleaned = get_tally_stock_items_xml(company_name)
    items: dict[str, dict[str, Any]] = {}

    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        root = None

    if root is not None:
        for item in root.findall(".//STOCKITEM"):
            item_block = ET.tostring(item, encoding="unicode")
            details = build_stock_item_details_from_xml_block(item_block)
            name = str(details.get("name") or "").strip()
            if not name:
                continue
            items[normalize_lookup_token(name)] = details
        for item in root.findall(".//STOCKITEMS.LIST/*"):
            item_block = ET.tostring(item, encoding="unicode")
            details = build_stock_item_details_from_xml_block(item_block)
            name = str(details.get("name") or "").strip()
            if not name:
                continue
            items[normalize_lookup_token(name)] = details

    LOGGER.info("Loaded %s Tally stock item(s) for company key '%s'", len(items), cache_key or "current")
    TALLY_STOCK_ITEM_CACHE[cache_key] = items
    return items


def get_tally_item_record_by_name(item_name: str, company_name: str | None = None) -> dict[str, Any] | None:
    cleaned_name = str(item_name or "").strip()
    if not cleaned_name:
        return None

    stock_items = get_tally_stock_item_map(company_name)
    map_match = stock_items.get(normalize_lookup_token(cleaned_name))
    if map_match:
        return map_match

    direct_item = query_tally_stock_item_details(cleaned_name, company_name)
    if direct_item.get("exists"):
        direct_name = str(direct_item.get("name") or "").strip()
        direct_name_match = stock_items.get(normalize_lookup_token(direct_name))
        if direct_name_match:
            return direct_name_match
        LOGGER.warning(
            "Direct Tally lookup reported stock item '%s', but it was not confirmed in the full stock-item collection. Treating it as missing for safe voucher posting.",
            direct_name or cleaned_name,
        )

    return None


def _find_tally_item_matches_by_erp(erp_code: str, company_name: str | None = None) -> list[tuple[dict[str, Any], str]]:
    normalized_erp = normalize_erp_token(erp_code)
    if not normalized_erp:
        return []

    stock_items = get_tally_stock_item_map(company_name)
    seen_names: set[str] = set()
    matches: list[tuple[dict[str, Any], str]] = []

    for item in stock_items.values():
        item_name = str(item.get("name") or "").strip()
        if not item_name:
            continue

        normalized_name = normalize_lookup_token(item_name)
        if normalized_name in seen_names:
            continue

        part_no = normalize_erp_token(item.get("partNo"))
        aliases = [normalize_erp_token(alias) for alias in list(item.get("aliases") or [])]
        prefixed_name = normalize_erp_token(item_name.split("-", 1)[0].strip())

        match_source = ""
        if part_no and normalized_erp == part_no:
            match_source = "part number"
        elif normalized_erp in aliases:
            match_source = "mailing alias"
        elif prefixed_name and normalized_erp == prefixed_name:
            match_source = "name prefix"

        if not match_source:
            continue

        seen_names.add(normalized_name)
        matches.append((item, match_source))

    return matches


def query_tally_item_by_erp(
    erp_code: str, company_name: str | None = None
) -> tuple[bool, str | None, str | None, str | None, str | None]:
    normalized_erp = normalize_erp_token(erp_code)
    if not normalized_erp:
        return False, None, None, None, None

    matches = _find_tally_item_matches_by_erp(erp_code, company_name)

    if len(matches) == 1:
        matched, match_source = matches[0]
        LOGGER.info(
            "ERP '%s' matched Tally stock item '%s' via %s lookup. Tally Part/Mailing No='%s', BaseUnits='%s', Parent='%s'.",
            str(erp_code or "").strip(),
            str(matched.get("name") or "").strip() or "blank",
            match_source,
            str(matched.get("partNo") or "").strip() or "blank",
            str(matched.get("baseUnit") or "").strip() or "blank",
            str(matched.get("parent") or "").strip() or "blank",
        )
        return (
            True,
            str(matched.get("name") or "").strip() or None,
            str(matched.get("guid") or "").strip() or None,
            str(matched.get("partNo") or "").strip() or None,
            match_source,
        )

    if len(matches) > 1:
        candidate_names = ", ".join(
            sorted(
                f"{str(match.get('name') or '').strip()} [Part No: {str(match.get('partNo') or '').strip() or 'blank'}]"
                for match, _match_source in matches
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
        LOGGER.info(
            "%s '%s' found in Tally by exact name with Tally Part No '%s'.",
            item_kind,
            normalized_name,
            str(exact_item.get("partNo") or "").strip() or "blank",
        )
        return str(exact_item.get("name") or normalized_name).strip() or normalized_name

    exists_by_erp, tally_name, _guid_by_erp, tally_part_no, match_source = query_tally_item_by_erp(erp_code, company_name)
    if exists_by_erp and tally_name:
        LOGGER.info(
            "%s '%s' was resolved by ERP '%s' to Tally item '%s' via %s lookup. Tally Part No='%s'. Posting will use the Tally name.",
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
    else:
        LOGGER.info("%s '%s' was not found in Tally by exact name.", item_kind, normalized_name)
    return normalized_name


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
    ):
        try:
            return datetime.strptime(raw_text, fmt)
        except ValueError:
            pass

    return None


def format_tally_date(raw_value: Any) -> str:
    parsed = _parse_tally_date(raw_value)
    if parsed:
        return parsed.strftime("%Y%m%d")
    raise RuntimeError(f"Could not resolve voucher date from value {raw_value!r}.")


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

    raise RuntimeError(
        "Cannot connect to Tally on port 9004. "
        "Please confirm Tally XML/HTTP is enabled on port 9004."
    ) from last_error


def parse_import_summary(response_text: str) -> dict[str, str]:
    summary: dict[str, str] = {}
    for tag in ("CREATED", "ALTERED", "COMBINED", "IGNORED", "DELETED", "CANCELLED", "ERRORS", "EXCEPTIONS"):
        match = re.search(rf"<{tag}>\s*([^<]+?)\s*</{tag}>", response_text, flags=re.IGNORECASE)
        summary[tag.lower()] = str(match.group(1)).strip() if match else "0"
    return summary


def response_error_message(response_text: str) -> str:
    line_errors = re.findall(r"<LINEERROR>(.*?)</LINEERROR>", response_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned_errors = [re.sub(r"\s+", " ", error).strip() for error in line_errors if str(error).strip()]
    if cleaned_errors:
        return "; ".join(cleaned_errors[:5])

    summary = parse_import_summary(response_text)
    if summary.get("exceptions") not in (None, "", "0") or summary.get("errors") not in (None, "", "0"):
        parts = ", ".join(f"{key}={value}" for key, value in summary.items())
        return f"Tally import failed without LINEERROR ({parts})"

    compact = compact_xml_for_log(response_text, 600)
    return compact or "Unknown Tally response"


def _normalize_group_name(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").strip().upper())


def get_tally_groups(company_name: str | None = None) -> set[str]:
    xml_text = f"""
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
                    {build_company_static_variables(company_name)}
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
    except ET.ParseError:
        root = None
    if root is not None:
        for node in root.findall(".//STOCKGROUP"):
            name = clean_tally_text(node.get("NAME") or node.findtext("NAME") or "")
            if name:
                groups.add(name)
        for node in root.findall(".//STOCKGROUPS.LIST/*"):
            name = clean_tally_text(node.get("NAME") or node.findtext("NAME") or "")
            if name:
                groups.add(name)
    return groups


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
        wanted = normalize_lookup_token(unit_name)
        for unit in root.findall(".//UNIT"):
            candidates = [
                unit.get("NAME") or "",
                unit.findtext("NAME") or "",
                unit.findtext("ORIGINALNAME") or "",
                unit.findtext("FORMALNAME") or "",
            ]
            if any(normalize_lookup_token(candidate) == wanted for candidate in candidates if str(candidate).strip()):
                return True
    return normalize_lookup_token(unit_name) in normalize_lookup_token(cleaned)


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
    requested_unit = str(unit_name or "").strip() or "NOS"
    effective_unit = normalize_tally_unit_name(requested_unit)
    if query_tally_unit(effective_unit, company_name):
        return

    LOGGER.info("Unit '%s' missing in Tally. Auto-creating unit.", effective_unit)
    success, result = create_tally_unit(company_name, effective_unit)
    if not success:
        raise RuntimeError(f"Unit '{effective_unit}' could not be auto-created in Tally: {result}")
    LOGGER.info("Unit '%s' accepted by Tally unit-create flow (%s)", effective_unit, result)


def invalidate_tally_stock_item_cache(company_name: str | None = None) -> None:
    cache_key = str(company_name or "").strip().upper()
    if cache_key:
        TALLY_STOCK_ITEM_CACHE.pop(cache_key, None)
        TALLY_STOCK_ITEM_XML_CACHE.pop(cache_key, None)
        return
    TALLY_STOCK_ITEM_CACHE.clear()
    TALLY_STOCK_ITEM_XML_CACHE.clear()


def create_tally_app_group_item(
    company_name: str | None,
    item_name: str,
    erp_code: str,
    unit_name: str,
) -> tuple[bool, str]:
    safe_name = escape_xml(item_name)
    safe_group = escape_xml(APP_GROUP_NAME)
    safe_erp = escape_xml(erp_code)
    safe_unit = escape_xml(normalize_tally_unit_name(unit_name))
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
    invalidate_tally_stock_item_cache(company_name)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        return True, "Success"
    if "already exists" in response_text.lower() or "duplicate" in response_text.lower():
        return True, "Already exists"
    if get_tally_item_record_by_name(item_name, company_name):
        return True, "Linked after import verification"
    LOGGER.error(
        "Tally stock-item create failed for '%s'. Request XML: %s | Response XML: %s",
        item_name,
        compact_xml_for_log(xml_text),
        compact_xml_for_log(response_text),
    )
    return False, response_error_message(response_text)


def ensure_app_group_item_exists(
    company_name: str | None,
    item_name: str,
    erp_code: str,
    unit_name: str,
) -> str:
    exists_by_erp, matched_name, _guid_by_erp, tally_part_no, match_source = query_tally_item_by_erp(erp_code, company_name)
    if exists_by_erp and matched_name:
        LOGGER.info(
            "Non-job issue stock item '%s' resolved by ERP '%s' to existing Tally stock item '%s' via %s lookup. Tally Part No='%s'.",
            item_name,
            str(erp_code or "").strip(),
            matched_name,
            str(match_source or "part/alias"),
            str(tally_part_no or "").strip() or "blank",
        )
        return matched_name

    resolved_name = resolve_tally_item_name(item_name, erp_code, company_name, "Non-job issue stock item")
    if get_tally_item_record_by_name(resolved_name, company_name):
        return resolved_name

    ensure_tally_unit_exists(company_name, unit_name)
    tally_groups = get_tally_groups(company_name)
    normalized_groups = {_normalize_group_name(group) for group in tally_groups}
    if _normalize_group_name(APP_GROUP_NAME) not in normalized_groups:
        raise RuntimeError(f"Target stock group '{APP_GROUP_NAME}' does not exist in Tally.")

    LOGGER.info("Non-job issue stock item '%s' missing in Tally. Auto-creating under group '%s'.", item_name, APP_GROUP_NAME)
    success, result = create_tally_app_group_item(company_name, item_name, erp_code, unit_name)
    if not success:
        exists_by_erp, matched_name, _guid, tally_part_no, match_source = query_tally_item_by_erp(erp_code, company_name)
        if exists_by_erp and matched_name:
            LOGGER.info(
                "Stock item '%s' could not be auto-created, but ERP '%s' matched existing Tally stock item '%s' via %s lookup after create conflict. Tally Part No='%s'. Posting will use the looked-up Tally name.",
                item_name,
                str(erp_code or "").strip(),
                matched_name,
                str(match_source or "part/alias"),
                str(tally_part_no or "").strip() or "blank",
            )
            return matched_name
        raise RuntimeError(f"Stock item '{item_name}' could not be auto-created in Tally: {result}")

    resolved_after = resolve_tally_item_name(item_name, erp_code, company_name, "Non-job issue stock item")
    if not get_tally_item_record_by_name(resolved_after, company_name):
        raise RuntimeError(f"Stock item '{item_name}' still does not exist in Tally after auto-create attempt.")

    LOGGER.info("Auto-created non-job issue stock item '%s' in Tally under group '%s'.", item_name, APP_GROUP_NAME)
    return resolved_after


def query_tally_item(name_or_alias: str, company_name: str | None = None) -> bool:
    return bool(get_tally_item_record_by_name(name_or_alias, company_name))


def tally_response_contains_voucher(response_text: str, voucher_number: str) -> bool:
    target = normalize_lookup_token(voucher_number)
    if not target:
        return False

    cleaned_response = clean_tally_xml(response_text)
    if target and target in normalize_lookup_token(cleaned_response):
        return True

    try:
        root = ET.fromstring(cleaned_response)
    except ET.ParseError:
        return False

    for element in root.iter():
        tag_name = str(element.tag or "").upper().split("}")[-1]
        if tag_name != "VOUCHERNUMBER":
            continue
        if normalize_lookup_token(element.text) == target:
            return True
    return False

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
        raise RuntimeError(
            f"Could not confirm whether Consumption Journal {voucher_number} already exists in Tally. "
            "Posting stopped to avoid creating a duplicate."
        ) from error
    return tally_response_contains_voucher(response_text, voucher_number)


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def is_non_job_issue(issue_type: Any) -> bool:
    normalized = str(issue_type or "").strip().lower()
    return normalized in ("without job", "withoutjob", "without_job", "general")


def get_pending_non_job_issues(conn) -> list[dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT *
            FROM `material_issues`
            WHERE COALESCE(`consumptionTransactionNo`, '') <> ''
              AND (
                    LOWER(TRIM(COALESCE(`issueType`, ''))) = 'without job'
                 OR LOWER(TRIM(COALESCE(`issueType`, ''))) = 'withoutjob'
                 OR LOWER(TRIM(COALESCE(`issueType`, ''))) = 'without_job'
                 OR LOWER(TRIM(COALESCE(`issueType`, ''))) = 'general'
              )
              AND COALESCE(`tallyTimestamp`, '') = ''
              AND COALESCE(TRIM(`tallyVoucherNo`), '') = ''
              AND LOWER(TRIM(COALESCE(`tallyPostingStatus`, ''))) <> 'posted'
            ORDER BY `date` ASC, `consumptionTransactionNo` ASC, `issueNo` ASC
            """
        )
        return cursor.fetchall()
    finally:
        cursor.close()


def get_latest_material_rate(conn, material_id: str, material_type: str, opening_rate: float) -> float:
    cursor = conn.cursor(dictionary=True)
    try:
        if material_type == "material":
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

            cursor.execute("SELECT `lines` FROM `material_in` ORDER BY `date` DESC, `updateTimestamp` DESC, `id` DESC")
            for row in cursor.fetchall():
                for line in parse_json_lines((row or {}).get("lines")):
                    if str(line.get("materialId") or line.get("itemId") or "").strip() != material_id:
                        continue
                    latest_rate = to_float(line.get("invoiceRate")) or to_float(line.get("rate"))
                    if latest_rate > 0:
                        return latest_rate
        else:
            cursor.execute("SELECT `lines` FROM `material_in` ORDER BY `date` DESC, `updateTimestamp` DESC, `id` DESC")
            for row in cursor.fetchall():
                for line in parse_json_lines((row or {}).get("lines")):
                    if str(line.get("itemId") or line.get("npdId") or "").strip() != material_id:
                        continue
                    latest_rate = to_float(line.get("invoiceRate")) or to_float(line.get("rate"))
                    if latest_rate > 0:
                        return latest_rate
    finally:
        cursor.close()

    return opening_rate


def parse_json_lines(raw_value: Any) -> list[dict[str, Any]]:
    if raw_value is None:
        return []
    if isinstance(raw_value, list):
        return [row for row in raw_value if isinstance(row, dict)]
    text = str(raw_value).strip()
    if not text:
        return []
    try:
        import json

        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [row for row in parsed if isinstance(row, dict)]
    except Exception:
        return []
    return []


def resolve_issue_context(conn, issue: dict[str, Any]) -> dict[str, Any]:
    issue_id = str(issue.get("id") or "").strip()
    if not issue_id:
        raise RuntimeError("Material issue id is missing.")

    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM `materials`")
        materials = {str(row["id"]): row for row in cursor.fetchall()}

        cursor.execute("SELECT * FROM `npd`")
        npd_rows = cursor.fetchall()
        npd_map = {str(row["id"]): row for row in npd_rows}

        cursor.execute(
            """
            SELECT *
            FROM `material_issue_lines`
            WHERE `materialIssueId` = %s
            ORDER BY `id` ASC
            """,
            (issue_id,),
        )
        issue_lines = cursor.fetchall()
    finally:
        cursor.close()

    if not issue_lines:
        raise RuntimeError(f"No issue lines found for non-job issue {issue.get('issueNo')}.")

    lines: list[dict[str, Any]] = []
    for issue_line in issue_lines:
        material_id = str(issue_line.get("materialId") or "").strip()
        material_row = materials.get(material_id)
        npd_row = npd_map.get(material_id)

        if material_row:
            name = str(material_row.get("name") or "").strip()
            erp_code = str(material_row.get("erpCode") or "").strip()
            unit_name = normalize_tally_unit_name(issue_line.get("uom") or material_row.get("uom") or "NOS")
            opening_rate = to_float(material_row.get("openingRate"))
            material_type = "material"
        elif npd_row:
            name = str(npd_row.get("itemName") or npd_row.get("name") or "").strip()
            erp_code = str(npd_row.get("erp") or "").strip()
            unit_name = normalize_tally_unit_name(issue_line.get("uom") or npd_row.get("uom") or "NOS")
            opening_rate = to_float(npd_row.get("rate"))
            material_type = "npd"
        else:
            raise RuntimeError(
                f"Material name could not be resolved for materialId={material_id} in issue {issue.get('issueNo')}."
            )

        quantity = round(to_float(issue_line.get("qty")), 5)
        if quantity <= 0:
            continue

        tally_name = ensure_app_group_item_exists(None, name, erp_code, unit_name)

        amount = round(to_float(issue_line.get("amount")), 2)
        last_purchase_rate = to_float(issue_line.get("lastPurchaseRate"))
        issue_line_opening_rate = to_float(issue_line.get("openingRate"))
        stored_rate = to_float(issue_line.get("rate"))
        fallback_rate = stored_rate or last_purchase_rate or issue_line_opening_rate or opening_rate
        rate = round(amount / quantity, 5) if amount > 0 else fallback_rate
        line_entry = {
            "materialId": material_id,
            "name": name,
            "tallyName": tally_name,
            "erpCode": erp_code,
            "uom": unit_name,
            "qty": quantity,
            "rate": rate,
            "amount": amount if amount > 0 else round(quantity * rate, 2),
        }
        lines.append(line_entry)

    if not lines:
        raise RuntimeError(f"No positive quantity lines found for non-job issue {issue.get('issueNo')}.")

    return {
        "issue": issue,
        "voucherNo": str(issue.get("consumptionTransactionNo") or "").strip(),
        "voucherDate": format_tally_date(issue.get("date")),
        "referenceNo": str(issue.get("issueNo") or "").strip(),
        "referenceDate": format_tally_date(issue.get("date")),
        "lines": lines,
    }


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


def format_amount(amount: float) -> str:
    return f"{amount:.2f}"


def build_consumption_journal_xml(company_name: str | None, context: dict[str, Any]) -> str:
    issue = context["issue"]
    narration = (
        f"Imported from LNPI Non-Job Issue {context['referenceNo']} | "
        f"Type {issue.get('issueType') or 'Without Job'}"
    )
    if str(issue.get("remarks") or "").strip():
        narration = f"{narration} | {str(issue.get('remarks')).strip()}"

    inventory_entries = []
    for line in context["lines"]:
        qty_text = format_qty(to_float(line.get("qty")), str(line.get("uom") or "NOS"))
        rate = to_float(line.get("rate"))
        amount = to_float(line.get("amount"))
        rate_tag = ""
        if rate > 0:
            rate_tag = f"<RATE>{escape_xml(format_rate(rate, str(line.get('uom') or 'NOS')))}</RATE>"
        amount_tag = ""
        if amount > 0:
            amount_tag = f"<AMOUNT>{escape_xml(format_amount(amount))}</AMOUNT>"
        inventory_entries.append(
            f"""
            <INVENTORYENTRIESOUT.LIST>
                <STOCKITEMNAME>{escape_xml(line['tallyName'])}</STOCKITEMNAME>
                {rate_tag}
                {amount_tag}
                <ACTUALQTY>{escape_xml(qty_text)}</ACTUALQTY>
                <BILLEDQTY>{escape_xml(qty_text)}</BILLEDQTY>
            </INVENTORYENTRIESOUT.LIST>
            """
        )

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
                    <VOUCHER VCHTYPE="Consumption Journal" ACTION="Create" OBJVIEW="Consumption Voucher View">
                        <DATE>{context['voucherDate']}</DATE>
                        <VOUCHERTYPENAME>Consumption Journal</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>{escape_xml(context['voucherNo'])}</VOUCHERNUMBER>
                        <REFERENCE>{escape_xml(context['referenceNo'])}</REFERENCE>
                        <REFERENCEDATE>{context['referenceDate']}</REFERENCEDATE>
                        <PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>
                        <ISINVOICE>No</ISINVOICE>
                        <NARRATION>{escape_xml(narration)}</NARRATION>
                        {''.join(inventory_entries)}
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""


def update_attempt(conn, issue_id: str) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_issues`
        SET `tallyLastAttemptAt` = %s,
            `tallyPostingAttemptCount` = COALESCE(`tallyPostingAttemptCount`, 0) + 1,
            `tallyPostingStatus` = 'Processing',
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (now, now, issue_id),
    )
    conn.commit()
    cursor.close()


def mark_posted(conn, issue_id: str, voucher_no: str, voucher_date: str, remark: str, voucher_type: str = "Consumption Journal") -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_issues`
        SET `tallyTimestamp` = %s,
            `tallyPostingStatus` = 'Posted',
            `tallyVoucherNo` = %s,
            `tallyVoucherDate` = %s,
            `tallyVoucherType` = %s,
            `tallyPostedBy` = %s,
            `tallyPostingRemark` = %s,
            `tallyPostingError` = NULL,
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (now, voucher_no, voucher_date, voucher_type, POSTED_BY, remark, now, issue_id),
    )
    conn.commit()
    cursor.close()


def mark_error(conn, issue_id: str, error_text: str) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_issues`
        SET `tallyPostingStatus` = 'Error',
            `tallyPostingRemark` = %s,
            `tallyPostingError` = %s,
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (error_text[:5000], error_text[:5000], now, issue_id),
    )
    conn.commit()
    cursor.close()


def process_one_issue(conn, company_name: str | None, issue: dict[str, Any]) -> None:
    issue_id = str(issue.get("id") or "").strip()
    update_attempt(conn, issue_id)

    context = resolve_issue_context(conn, issue)
    if not context["voucherNo"]:
        raise RuntimeError(f"Consumption voucher number is blank for issue {issue.get('issueNo')}.")

    if voucher_exists_in_tally(company_name, context["voucherNo"], "Consumption Journal"):
        mark_posted(
            conn,
            issue_id=issue_id,
            voucher_no=context["voucherNo"],
            voucher_date=context["voucherDate"],
            remark="Consumption Journal already existed in Tally. Local row reconciled.",
        )
        LOGGER.info("Skipping issue %s because Consumption Journal already exists in Tally", issue.get("issueNo"))
        return

    xml_text = build_consumption_journal_xml(company_name, context)
    response_text = post_xml_to_tally(xml_text)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        mark_posted(
            conn,
            issue_id=issue_id,
            voucher_no=context["voucherNo"],
            voucher_date=context["voucherDate"],
            remark=(
                f"Consumption Journal posted successfully. "
                f"Ref={context['referenceNo']}, Lines={len(context['lines'])}"
            ),
        )
        LOGGER.info("Posted Consumption Journal %s successfully", context["voucherNo"])
        return

    LOGGER.error(
        "Tally rejected Consumption Journal %s. Request XML: %s | Response XML: %s",
        context["voucherNo"],
        compact_xml_for_log(xml_text, 2500),
        compact_xml_for_log(response_text, 2500),
    )
    raise RuntimeError(
        f"Tally rejected Consumption Journal {context['voucherNo']}: {response_error_message(response_text)}"
    )


def main() -> None:
    LOGGER.info("Starting Tally Consumption Journal posting")
    LOGGER.info("Tally URL candidates: %s", ", ".join(TALLY_URL_CANDIDATES))
    LOGGER.info("Using active Tally company on port 9004. No SVCURRENTCOMPANY will be sent.")

    conn = get_db_connection()
    try:
        pending_issues = get_pending_non_job_issues(conn)
        LOGGER.info("Found %s eligible non-job issue(s) for Consumption Journal posting", len(pending_issues))
        for issue in pending_issues:
            issue_id = str(issue.get("id") or "").strip()
            issue_no = str(issue.get("issueNo") or "").strip()
            con_no = str(issue.get("consumptionTransactionNo") or "").strip()
            try:
                process_one_issue(conn, None, issue)
            except Exception as error:
                error_text = str(error)
                LOGGER.exception("ERROR in non-job issue %s: %s", issue_no, error_text)
                mark_error(conn, issue_id, error_text)
                LOGGER.error(
                    "Stopping Consumption Journal batch after failure in %s / %s so later CON serials are not posted out of sequence.",
                    issue_no or issue_id,
                    con_no or "blank CON",
                )
                break
    finally:
        conn.close()
        LOGGER.info("Finished Tally Consumption Journal posting")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        LOGGER.exception("Fatal error while posting Tally Consumption Journals: %s", exc)
        sys.exit(1)
