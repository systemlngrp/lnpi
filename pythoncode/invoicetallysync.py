import os
import re
import sys
import mysql.connector
import requests
from datetime import datetime, date
import xml.sax.saxutils as saxutils
import xml.etree.ElementTree as ET
from dotenv import load_dotenv


def load_runtime_env():
    env_paths = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            load_dotenv(env_path, override=True)
            return
    load_dotenv(override=True)


load_runtime_env()


DB_CONFIG = {
    "host": "193.203.184.152",
    "user": "u380633007_lnpidata",
    "password": "!Office1@",
    "database": "u380633007_lnpidata",
    "port": 3306,
    "use_pure": True,
}

TALLY_URL = "http://127.0.0.1:9004"
TALLY_COMPANY_NAME = os.getenv("TALLY_COMPANY_NAME", "Laxmi Narayan Packaging Industries")
VOUCHER_TYPE_NAME = os.getenv("SALES_VOUCHER_TYPE_NAME", "Sales")
SALES_LEDGER_NAME = os.getenv("SALES_LEDGER_NAME", "Sales")
SALES_5_LEDGER_NAME = os.getenv("SALES_5_LEDGER_NAME", "SALES 5%")
SALES_18_LEDGER_NAME = os.getenv("SALES_18_LEDGER_NAME", "SALES 18%")
OTHER_CHARGES_LEDGER_NAME = os.getenv("SALES_OTHER_CHARGES_LEDGER_NAME", "Other Charges")
ROUND_OFF_LEDGER_NAME = os.getenv("SALES_ROUND_OFF_LEDGER_NAME", "Round Off")
CGST_LEDGER_NAME = os.getenv("OUTPUT_CGST_LEDGER_NAME", "Output CGST")
SGST_LEDGER_NAME = os.getenv("OUTPUT_SGST_LEDGER_NAME", "Output SGST")
IGST_LEDGER_NAME = os.getenv("OUTPUT_IGST_LEDGER_NAME", "Output IGST")
CGST_LEDGER_PREFIX = os.getenv("CGST_LEDGER_PREFIX", "Tax - CGST @")
SGST_LEDGER_PREFIX = os.getenv("SGST_LEDGER_PREFIX", "Tax - SGST @")
IGST_LEDGER_PREFIX = os.getenv("IGST_LEDGER_PREFIX", "Tax - IGST @")
DEBUG_TALLY_XML = os.getenv("DEBUG_TALLY_XML", "0").strip() == "1"
DEFAULT_UPDATED_BY = os.getenv("TALLY_SYNC_USER", "system")
TALLY_UOM_ALIASES = {
    "KG": os.getenv("TALLY_UOM_KG", "KG"),
    "KGS": os.getenv("TALLY_UOM_KGS", "KG"),
    "KILOGRAM": os.getenv("TALLY_UOM_KILOGRAM", "KG"),
    "KILOGRAMS": os.getenv("TALLY_UOM_KILOGRAMS", "KG"),
    "NOS": os.getenv("TALLY_UOM_NOS", "NOS"),
    "NO": os.getenv("TALLY_UOM_NO", "NOS"),
    "PCS": os.getenv("TALLY_UOM_PCS", "PCS"),
    "PC": os.getenv("TALLY_UOM_PC", "PCS"),
}
TALLY_MASTER_CACHE = {}
TALLY_STOCK_ITEM_UOM_CACHE = {}


def log_terminal(level, message):
    print(f"[{level}] {message}")


def esc(value):
    if value is None:
        return ""
    return saxutils.escape(str(value))


def to_float(value):
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def format_tally_date(value):
    if value is None or value == "":
        return datetime.today().strftime("%Y%m%d")

    if isinstance(value, datetime):
        return value.strftime("%Y%m%d")

    if isinstance(value, date):
        return value.strftime("%Y%m%d")

    raw_value = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(raw_value, fmt).strftime("%Y%m%d")
        except Exception:
            pass

    return datetime.today().strftime("%Y%m%d")


def normalize_uom(value):
    if value is None:
        return ""

    normalized = str(value).strip()
    if not normalized:
        return ""

    return TALLY_UOM_ALIASES.get(normalized.upper(), normalized)


def sanitize_tally_xml(xml_text):
    if not xml_text:
        return xml_text
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    return cleaned


def format_iso_date(value):
    if value is None or value == "":
        return ""

    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")

    raw_value = str(value).strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(raw_value, fmt).strftime("%Y-%m-%d")
        except Exception:
            pass

    return raw_value


def parse_tally_voucher_response(response_text):
    if not response_text:
        return {}

    cleaned = sanitize_tally_xml(response_text)
    result = {}

    try:
        root = ET.fromstring(cleaned)
        voucher = root.find('.//VOUCHER')
        if voucher is not None:
            result.update(extract_voucher_summary(voucher))
        else:
            # Fallback search in entire response for common identifiers
            if "VOUCHERNUMBER" in cleaned.upper():
                match = re.search(r"<VOUCHERNUMBER>([^<]+)</VOUCHERNUMBER>", cleaned, re.IGNORECASE)
                if match:
                    result["tallyInvNo"] = match.group(1).strip()
            if "<DATE>" in cleaned.upper():
                match = re.search(r"<DATE>([^<]+)</DATE>", cleaned, re.IGNORECASE)
                if match:
                    result["tallyInvDate"] = match.group(1).strip()
            for key in ("GUID", "VOUCHERKEY", "REMOTEID"):
                pattern = rf"<{key}>([^<]+)</{key}>"
                match = re.search(pattern, cleaned, re.IGNORECASE)
                if match:
                    result["tallyInvId"] = match.group(1).strip()
                    break
            for key, output_key in (("LASTVCHID", "lastVchId"), ("LASTMID", "lastMasterId")):
                pattern = rf"<{key}>([^<]+)</{key}>"
                match = re.search(pattern, cleaned, re.IGNORECASE)
                if match:
                    result[output_key] = match.group(1).strip()
    except Exception:
        pass

    return {k: v for k, v in result.items() if v}


def extract_voucher_summary(voucher):
    summary = {
        "tallyInvNo": voucher.get("VOUCHERNUMBER") or "",
        "tallyInvDate": voucher.get("DATE") or "",
        "tallyInvId": voucher.get("GUID") or voucher.get("VOUCHERKEY") or voucher.get("REMOTEID") or "",
        "partyLedgerName": voucher.get("PARTYLEDGERNAME") or "",
        "narration": "",
    }

    for child in voucher:
        tag = child.tag.upper()
        text = (child.text or "").strip()
        if not text:
            continue
        if tag == "VOUCHERNUMBER" and not summary["tallyInvNo"]:
            summary["tallyInvNo"] = text
        elif tag == "DATE" and not summary["tallyInvDate"]:
            summary["tallyInvDate"] = text
        elif tag in {"GUID", "VOUCHERKEY", "REMOTEID"} and not summary["tallyInvId"]:
            summary["tallyInvId"] = text
        elif tag == "PARTYLEDGERNAME" and not summary["partyLedgerName"]:
            summary["partyLedgerName"] = text
        elif tag == "NARRATION" and not summary["narration"]:
            summary["narration"] = text

    return {key: value for key, value in summary.items() if value}


def parse_tally_voucher_collection(response_text):
    if not response_text:
        return []

    cleaned = sanitize_tally_xml(response_text)
    try:
        root = ET.fromstring(cleaned)
    except Exception:
        return []

    vouchers = []
    for voucher in root.findall(".//VOUCHER"):
        summary = extract_voucher_summary(voucher)
        if summary:
            vouchers.append(summary)
    return vouchers


def fetch_tally_voucher_reference(invoice_no, voucher_type=None):
    if not invoice_no:
        return {}

    voucher_type_attr = f' VOUCHERTYPENAME="{esc(voucher_type)}"' if voucher_type else ""
    xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <VOUCHER VOUCHERNUMBER="{esc(invoice_no)}"{voucher_type_attr} ACTION="Get" />
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    response_text = tally_request(xml)
    return parse_tally_voucher_response(response_text)


def fetch_tally_voucher_by_id(tally_inv_id):
    if not tally_inv_id:
        return {}

    object_request_variants = ("GUID", "MasterID", "VoucherKey")
    for id_type in object_request_variants:
        xml = f"""
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Voucher</SUBTYPE>
        <ID TYPE="{esc(id_type)}">{esc(tally_inv_id)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Date</FETCH>
                <FETCH>VoucherNumber</FETCH>
                <FETCH>GUID</FETCH>
                <FETCH>VoucherKey</FETCH>
                <FETCH>RemoteID</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>
"""
        response_text = tally_request(xml)
        result = parse_tally_voucher_response(response_text)
        if result.get("tallyInvId") or result.get("tallyInvNo"):
            return result

    action_get_variants = (
        f'<VOUCHER MASTERID="{esc(tally_inv_id)}" ACTION="Get"></VOUCHER>',
        f'<VOUCHER GUID="{esc(tally_inv_id)}" ACTION="Get"></VOUCHER>',
        f'<VOUCHER VCHKEY="{esc(tally_inv_id)}" ACTION="Get"></VOUCHER>',
        f'<VOUCHER REMOTEID="{esc(tally_inv_id)}" ACTION="Get"></VOUCHER>',
    )

    for voucher_tag in action_get_variants:
        xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    {voucher_tag}
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
        response_text = tally_request(xml)
        result = parse_tally_voucher_response(response_text)
        if result.get("tallyInvId") or result.get("tallyInvNo"):
            return result

    return {}


def fetch_created_tally_voucher(response_text):
    parsed_response = parse_tally_voucher_response(response_text)
    for candidate in (
        parsed_response.get("tallyInvId"),
        parsed_response.get("lastVchId"),
        parsed_response.get("lastMasterId"),
    ):
        if not candidate:
            continue
        voucher = fetch_tally_voucher_by_id(candidate)
        if voucher:
            if not voucher.get("tallyInvId"):
                voucher["tallyInvId"] = candidate
            return voucher
    if parsed_response.get("lastVchId") and not parsed_response.get("tallyInvId"):
        parsed_response["tallyInvId"] = parsed_response.get("lastVchId")
    elif parsed_response.get("lastMasterId") and not parsed_response.get("tallyInvId"):
        parsed_response["tallyInvId"] = parsed_response.get("lastMasterId")
    return parsed_response


def fetch_tally_voucher_by_context(invoice_row, customer_name, narration_text):
    tally_date = format_tally_date(invoice_row.get("date"))
    xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    <SVFROMDATE>{esc(tally_date)}</SVFROMDATE>
                    <SVTODATE>{esc(tally_date)}</SVTODATE>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <FETCHLIST>
                    <FETCH>Date</FETCH>
                    <FETCH>VoucherNumber</FETCH>
                    <FETCH>GUID</FETCH>
                    <FETCH>VoucherKey</FETCH>
                    <FETCH>RemoteID</FETCH>
                    <FETCH>PartyLedgerName</FETCH>
                    <FETCH>Narration</FETCH>
                </FETCHLIST>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    response_text = tally_request(xml)
    vouchers = parse_tally_voucher_collection(response_text)
    if not vouchers:
        return {}

    normalized_date = format_iso_date(tally_date)
    normalized_party = str(customer_name or "").strip().upper()
    normalized_narration = str(narration_text or "").strip().upper()

    exact_matches = [
        voucher
        for voucher in vouchers
        if format_iso_date(voucher.get("tallyInvDate")) == normalized_date
        and str(voucher.get("partyLedgerName") or "").strip().upper() == normalized_party
        and str(voucher.get("narration") or "").strip().upper() == normalized_narration
    ]
    if exact_matches:
        return exact_matches[-1]

    party_matches = [
        voucher
        for voucher in vouchers
        if format_iso_date(voucher.get("tallyInvDate")) == normalized_date
        and str(voucher.get("partyLedgerName") or "").strip().upper() == normalized_party
    ]
    if party_matches:
        return party_matches[-1]

    return {}


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def get_db_cursor(conn, dictionary=False):
    try:
        if conn and hasattr(conn, "ping"):
            conn.ping(reconnect=True, attempts=3, delay=2)
    except Exception:
        pass
    return conn.cursor(dictionary=dictionary)


def column_exists(conn, table_name, column_name):
    cursor = get_db_cursor(conn)
    cursor.execute(
        """
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = %s
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        LIMIT 1
        """,
        (DB_CONFIG["database"], table_name, column_name),
    )
    exists = cursor.fetchone() is not None
    cursor.close()
    return exists


def ensure_invoice_sync_columns(conn):
    cursor = get_db_cursor(conn)
    try:
        if not column_exists(conn, "invoices", "tallySyncRemark"):
            cursor.execute("ALTER TABLE invoices ADD COLUMN tallySyncRemark TEXT")
        if not column_exists(conn, "invoices", "tallyBy"):
            cursor.execute("ALTER TABLE invoices ADD COLUMN tallyBy VARCHAR(255)")
        if not column_exists(conn, "invoices", "tallyTimestamp"):
            cursor.execute("ALTER TABLE invoices ADD COLUMN tallyTimestamp VARCHAR(255)")
        if not column_exists(conn, "invoices", "tallyInvNo"):
            cursor.execute("ALTER TABLE invoices ADD COLUMN tallyInvNo VARCHAR(255)")
        if not column_exists(conn, "invoices", "tallyInvDate"):
            cursor.execute("ALTER TABLE invoices ADD COLUMN tallyInvDate VARCHAR(255)")
        if not column_exists(conn, "invoices", "tallyInvId"):
            cursor.execute("ALTER TABLE invoices ADD COLUMN tallyInvId VARCHAR(255)")
        conn.commit()
    finally:
        cursor.close()


def get_pending_invoice_rows(conn):
    sql = """
        SELECT *
        FROM invoices
        WHERE tallyTimestamp IS NULL
           OR tallyTimestamp = ''
    """

    cursor = get_db_cursor(conn, dictionary=True)
    cursor.execute(sql)
    rows = cursor.fetchall()
    cursor.close()
    return rows


def tally_request(xml_data):
    try:
        response = requests.post(
            TALLY_URL,
            data=xml_data.encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=60,
        )
        if response.status_code == 200:
            return response.text
        return f"HTTP error from Tally: {response.status_code}"
    except Exception as error:
        return f"Connection error: {error}"


def check_tally_object_exists(object_type, object_name):
    if not object_name:
        return False, "Empty name"

    cache_key = (object_type.upper(), object_name.strip().upper())
    if cache_key in TALLY_MASTER_CACHE:
        return TALLY_MASTER_CACHE[cache_key]

    xml = f"""<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>{esc(object_type)}</SUBTYPE>
        <ID TYPE="Name">{esc(object_name)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>"""

    response_text = tally_request(xml)
    if not response_text:
        result = (False, "Empty response from Tally")
        TALLY_MASTER_CACHE[cache_key] = result
        return result

    upper_response = response_text.upper()
    if "CONNECTION ERROR:" in upper_response or "HTTP ERROR FROM TALLY:" in upper_response:
        result = (False, response_text)
        TALLY_MASTER_CACHE[cache_key] = result
        return result

    if "UNKNOWN REQUEST" in upper_response or "<LINEERROR>" in upper_response:
        result = (False, f"{object_type} '{object_name}' not found in Tally")
        TALLY_MASTER_CACHE[cache_key] = result
        return result

    try:
        root = ET.fromstring(sanitize_tally_xml(response_text))
        found = root.find(f".//{object_type.upper().replace(' ', '')}")
        if found is not None or object_name.upper() in upper_response:
            result = (True, "")
        else:
            result = (False, f"{object_type} '{object_name}' not found in Tally")
    except Exception:
        if object_name.upper() in upper_response:
            result = (True, "")
        else:
            result = (False, f"{object_type} '{object_name}' not found in Tally")

    TALLY_MASTER_CACHE[cache_key] = result
    return result


def fetch_tally_stock_item_uom(item_name):
    if not item_name:
        return "", "Empty stock item name"

    cache_key = item_name.strip().upper()
    if cache_key in TALLY_STOCK_ITEM_UOM_CACHE:
        return TALLY_STOCK_ITEM_UOM_CACHE[cache_key]

    xml = f"""<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Stock Item</SUBTYPE>
        <ID TYPE="Name">{esc(item_name)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
                <FETCH>BaseUnits</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>"""

    response_text = tally_request(xml)
    if not response_text:
        result = ("", "Empty response from Tally")
        TALLY_STOCK_ITEM_UOM_CACHE[cache_key] = result
        return result

    upper_response = response_text.upper()
    if "CONNECTION ERROR:" in upper_response or "HTTP ERROR FROM TALLY:" in upper_response:
        result = ("", response_text)
        TALLY_STOCK_ITEM_UOM_CACHE[cache_key] = result
        return result

    try:
        root = ET.fromstring(sanitize_tally_xml(response_text))
        stock_item = root.find(".//STOCKITEM")
        if stock_item is not None:
            base_units = stock_item.get("BASEUNITS") or ""
            if not base_units:
                base_units_elem = stock_item.find("BASEUNITS")
                if base_units_elem is not None and base_units_elem.text:
                    base_units = base_units_elem.text.strip()
            if base_units:
                result = (normalize_uom(base_units), "")
                TALLY_STOCK_ITEM_UOM_CACHE[cache_key] = result
                return result
    except Exception:
        pass

    match = re.search(r"<BASEUNITS>([^<]+)</BASEUNITS>", response_text, re.IGNORECASE)
    if match:
        result = (normalize_uom(match.group(1).strip()), "")
        TALLY_STOCK_ITEM_UOM_CACHE[cache_key] = result
        return result

    result = ("", f"Unable to fetch Tally UOM for Stock Item '{item_name}'")
    TALLY_STOCK_ITEM_UOM_CACHE[cache_key] = result
    return result


def get_company_details(conn, company_id):
    if not company_id:
        return {}

    cursor = get_db_cursor(conn, dictionary=True)
    cursor.execute(
        """
        SELECT name, gstSupplyType, state
        FROM companies
        WHERE id = %s
        LIMIT 1
        """,
        (company_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    return row or {}


def get_invoice_lines(conn, invoice_id):
    cursor = get_db_cursor(conn, dictionary=True)
    cursor.execute(
        """
        SELECT *
        FROM invoice_line_items
        WHERE invoiceId = %s
        ORDER BY id
        """,
        (invoice_id,),
    )
    rows = cursor.fetchall()

    processed_lines = []
    for row in rows:
        item_name = ""
        uom = ""

        item_id = row.get("itemId")
        npd_id = row.get("npdId")

        if item_id:
            cursor.execute(
                """
                SELECT name, uom
                FROM items
                WHERE id = %s
                LIMIT 1
                """,
                (item_id,),
            )
            item_row = cursor.fetchone()
            if item_row:
                item_name = item_row.get("name") or ""
                uom = item_row.get("uom") or ""

        if not item_name and npd_id:
            cursor.execute(
                """
                SELECT itemName, uom
                FROM npd
                WHERE id = %s
                LIMIT 1
                """,
                (npd_id,),
            )
            npd_row = cursor.fetchone()
            if npd_row:
                item_name = npd_row.get("itemName") or ""
                if not uom:
                    uom = npd_row.get("uom") or ""

        processed_lines.append(
            {
                "id": row.get("id"),
                "invoiceId": row.get("invoiceId"),
                "loadingSlipId": row.get("loadingSlipId"),
                "itemId": item_id,
                "npdId": npd_id,
                "itemName": item_name or "Unknown Item",
                "uom": normalize_uom(uom),
                "qty": to_float(row.get("qty")),
                "rate": to_float(row.get("rate")),
                "amount": to_float(row.get("amount")),
                "gstRate": to_float(row.get("gstRate")),
                "cgst": to_float(row.get("cgst")),
                "sgst": to_float(row.get("sgst")),
                "igst": to_float(row.get("igst")),
            }
        )

    cursor.close()
    return processed_lines


def get_invoice_dispatch_details(conn, invoice_id, item_lines):
    loading_slip_ids = sorted(
        {
            str(line.get("loadingSlipId") or "").strip()
            for line in item_lines
            if str(line.get("loadingSlipId") or "").strip()
        }
    )

    slip_nos = []
    truck_nos = []
    cursor = get_db_cursor(conn, dictionary=True)

    try:
        if loading_slip_ids:
            placeholders = ", ".join(["%s"] * len(loading_slip_ids))
            cursor.execute(
                f"""
                SELECT ls.id, ls.slipNo, tr.truckNo
                FROM loading_slips ls
                LEFT JOIN trucks tr ON tr.id = ls.truckId
                WHERE ls.id IN ({placeholders})
                """,
                tuple(loading_slip_ids),
            )
            for row in cursor.fetchall():
                slip_no = str(row.get("slipNo") or "").strip()
                truck_no = str(row.get("truckNo") or "").strip()
                if slip_no and slip_no not in slip_nos:
                    slip_nos.append(slip_no)
                if truck_no and truck_no not in truck_nos:
                    truck_nos.append(truck_no)

        if not truck_nos:
            cursor.execute(
                """
                SELECT truckNo
                FROM gate_passes
                WHERE invoiceId = %s
                """,
                (invoice_id,),
            )
            for row in cursor.fetchall():
                truck_no = str(row.get("truckNo") or "").strip()
                if truck_no and truck_no not in truck_nos:
                    truck_nos.append(truck_no)
    finally:
        cursor.close()

    return {
        "loadingSlipNos": slip_nos,
        "truckNos": truck_nos,
    }


def build_invoice_narration(dispatch_details):
    parts = []
    slip_nos = dispatch_details.get("loadingSlipNos") or []
    truck_nos = dispatch_details.get("truckNos") or []

    if slip_nos:
        parts.append(f"Loading Slips: {', '.join(slip_nos)}")
    if truck_nos:
        parts.append(f"Truck No: {', '.join(truck_nos)}")

    return " | ".join(parts)


def validate_invoice_lines(item_lines):
    errors = []

    for index, line in enumerate(item_lines, start=1):
        item_name = line.get("itemName") or f"Line {index}"

        if to_float(line.get("qty")) <= 0:
            errors.append(f"{item_name}: qty missing or zero")
        if to_float(line.get("rate")) <= 0:
            errors.append(f"{item_name}: rate missing or zero")
        if to_float(line.get("amount")) <= 0:
            errors.append(f"{item_name}: amount missing or zero")
        if not (line.get("uom") or "").strip():
            errors.append(f"{item_name}: uom missing")
        if item_name == "Unknown Item":
            errors.append(f"Line {index}: item name not found")

    return errors


def resolve_sales_ledger_name(invoice_row, company_row, item_lines):
    gst_supply_type = str((company_row or {}).get("gstSupplyType") or "").strip().upper()
    igst_amount = round(to_float(invoice_row.get("igst")), 2)

    candidate_rates = []
    header_gst_rate = round(to_float(invoice_row.get("gstRate")), 2)
    if header_gst_rate > 0:
        candidate_rates.append(header_gst_rate)

    for line in item_lines:
        line_gst_rate = round(to_float(line.get("gstRate")), 2)
        if line_gst_rate > 0:
            candidate_rates.append(line_gst_rate)

    effective_gst_rate = max(candidate_rates) if candidate_rates else 0.0

    if abs(effective_gst_rate - 5.0) < 0.01:
        return SALES_5_LEDGER_NAME

    if abs(effective_gst_rate - 18.0) < 0.01:
        return SALES_18_LEDGER_NAME

    return SALES_LEDGER_NAME


def format_tax_rate(rate):
    value = to_float(rate)
    if value.is_integer():
        return f"{value:.1f}%"
    return f"{value:g}%"


def resolve_tax_ledger_name(prefix, rate, fallback_name):
    rate_value = round(to_float(rate), 2)
    if rate_value <= 0:
        return fallback_name
    return f"{prefix} {format_tax_rate(rate_value)}"


def derive_tax_rates(invoice_row, item_lines):
    header_gst_rate = round(to_float(invoice_row.get("gstRate")), 2)
    if header_gst_rate > 0:
        return {
            "cgst_rate": header_gst_rate / 2,
            "sgst_rate": header_gst_rate / 2,
            "igst_rate": header_gst_rate,
        }

    line_gst_rates = sorted(
        {
            round(to_float(line.get("gstRate")), 2)
            for line in item_lines
            if round(to_float(line.get("gstRate")), 2) > 0
        }
    )

    if line_gst_rates:
        primary_rate = line_gst_rates[0]
        return {
            "cgst_rate": primary_rate / 2,
            "sgst_rate": primary_rate / 2,
            "igst_rate": primary_rate,
        }

    return {
        "cgst_rate": 0,
        "sgst_rate": 0,
        "igst_rate": 0,
    }


def create_sales_voucher_xml(invoice_row, customer_name, item_lines, sales_ledger_name, narration_text=""):
    invoice_date = format_tally_date(invoice_row.get("date"))
    invoice_no = str(invoice_row.get("invoiceNo") or "").strip()
    customer_name = customer_name or "Unknown Customer"

    cgst = round(to_float(invoice_row.get("cgst")), 2)
    sgst = round(to_float(invoice_row.get("sgst")), 2)
    igst = round(to_float(invoice_row.get("igst")), 2)
    other_charges = round(to_float(invoice_row.get("otherCharges")), 2)
    round_off = round(to_float(invoice_row.get("roundOff")), 2)
    derived_tax_rates = derive_tax_rates(invoice_row, item_lines)
    cgst_rate = derived_tax_rates["cgst_rate"] if cgst > 0 else 0
    sgst_rate = derived_tax_rates["sgst_rate"] if sgst > 0 else 0
    igst_rate = derived_tax_rates["igst_rate"] if igst > 0 else 0
    cgst_ledger_name = resolve_tax_ledger_name(CGST_LEDGER_PREFIX, cgst_rate, CGST_LEDGER_NAME)
    sgst_ledger_name = resolve_tax_ledger_name(SGST_LEDGER_PREFIX, sgst_rate, SGST_LEDGER_NAME)
    igst_ledger_name = resolve_tax_ledger_name(IGST_LEDGER_PREFIX, igst_rate, IGST_LEDGER_NAME)

    inventory_xml = ""
    total_item_amount = 0.0

    for line in item_lines:
        item_name = line.get("itemName") or ""
        qty = to_float(line.get("qty"))
        rate = to_float(line.get("rate"))
        amount = round(to_float(line.get("amount")) or qty * rate, 2)
        uom = line.get("uom") or ""
        qty_text = f"{qty:g} {esc(uom)}".strip()
        rate_text = f"{rate:g}/{esc(uom)}" if uom else f"{rate:g}"

        total_item_amount += amount

        inventory_xml += f"""
                        <ALLINVENTORYENTRIES.LIST>
                            <STOCKITEMNAME>{esc(item_name)}</STOCKITEMNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
                            <ACTUALQTY>{qty_text}</ACTUALQTY>
                            <BILLEDQTY>{qty_text}</BILLEDQTY>
                            <RATE>{rate_text}</RATE>
                            <AMOUNT>{amount:.2f}</AMOUNT>
                            <ACCOUNTINGALLOCATIONS.LIST>
                                <LEDGERNAME>{esc(sales_ledger_name)}</LEDGERNAME>
                                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                                <AMOUNT>{amount:.2f}</AMOUNT>
                            </ACCOUNTINGALLOCATIONS.LIST>
                        </ALLINVENTORYENTRIES.LIST>
"""

    total_item_amount = round(total_item_amount, 2)
    total_invoice_amount = round(total_item_amount + cgst + sgst + igst + other_charges + round_off, 2)

    ledger_entries_xml = f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(customer_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{total_invoice_amount:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
    """

    if cgst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(cgst_ledger_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{cgst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if sgst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(sgst_ledger_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{sgst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if igst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(igst_ledger_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{igst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if other_charges != 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(OTHER_CHARGES_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{other_charges:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if round_off != 0:
        round_off_amount = f"{round_off:.2f}" if round_off > 0 else f"-{abs(round_off):.2f}"
        deemed_positive = "No" if round_off > 0 else "Yes"
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(ROUND_OFF_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>{deemed_positive}</ISDEEMEDPOSITIVE>
                            <AMOUNT>{round_off_amount}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

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
                    <SVCURRENTCOMPANY>{esc(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="{esc(VOUCHER_TYPE_NAME)}" ACTION="Create">
                        <DATE>{invoice_date}</DATE>
                        <VOUCHERNUMBER>{esc(invoice_no)}</VOUCHERNUMBER>
                        <VOUCHERTYPENAME>{esc(VOUCHER_TYPE_NAME)}</VOUCHERTYPENAME>
                        <PARTYLEDGERNAME>{esc(customer_name)}</PARTYLEDGERNAME>
                        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
                        <ISINVOICE>Yes</ISINVOICE>
                        <NARRATION>{esc(narration_text)}</NARRATION>
                        {inventory_xml}
                        {ledger_entries_xml}
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""


def post_to_tally(xml_data):
    response_text = tally_request(xml_data)

    if response_text and "Could not set &apos;SVCurrentCompany&apos;" in response_text:
        fallback_xml = re.sub(
            r"\s*<STATICVARIABLES>\s*<SVCURRENTCOMPANY>.*?</SVCURRENTCOMPANY>\s*</STATICVARIABLES>",
            "",
            xml_data,
            flags=re.IGNORECASE | re.DOTALL,
        )
        log_terminal("RETRY", "Retrying Tally post without SVCURRENTCOMPANY")
        return tally_request(fallback_xml)

    return response_text


def is_tally_success(response_text):
    if not response_text:
        return False
    return "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text


def extract_tally_error(response_text):
    if not response_text:
        return "Empty response from Tally"

    match = re.search(r"<LINEERROR>(.*?)</LINEERROR>", response_text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    if "<EXCEPTIONS>0</EXCEPTIONS>" not in response_text and "<EXCEPTIONS>" in response_text:
        return "Tally returned an exception. Check response for details."

    return response_text[:200]


def validate_tally_masters(customer_name, sales_ledger_name, item_lines, invoice_row):
    errors = []

    master_checks = [("Ledger", customer_name), ("Ledger", sales_ledger_name)]

    other_charges = round(to_float(invoice_row.get("otherCharges")), 2)
    round_off = round(to_float(invoice_row.get("roundOff")), 2)
    cgst = round(to_float(invoice_row.get("cgst")), 2)
    sgst = round(to_float(invoice_row.get("sgst")), 2)
    igst = round(to_float(invoice_row.get("igst")), 2)
    derived_tax_rates = derive_tax_rates(invoice_row, item_lines)

    if other_charges != 0:
        master_checks.append(("Ledger", OTHER_CHARGES_LEDGER_NAME))
    if round_off != 0:
        master_checks.append(("Ledger", ROUND_OFF_LEDGER_NAME))
    if cgst > 0:
        master_checks.append(
            ("Ledger", resolve_tax_ledger_name(CGST_LEDGER_PREFIX, derived_tax_rates["cgst_rate"], CGST_LEDGER_NAME))
        )
    if sgst > 0:
        master_checks.append(
            ("Ledger", resolve_tax_ledger_name(SGST_LEDGER_PREFIX, derived_tax_rates["sgst_rate"], SGST_LEDGER_NAME))
        )
    if igst > 0:
        master_checks.append(
            ("Ledger", resolve_tax_ledger_name(IGST_LEDGER_PREFIX, derived_tax_rates["igst_rate"], IGST_LEDGER_NAME))
        )

    for line in item_lines:
        master_checks.append(("Stock Item", line.get("itemName") or ""))

    checked = set()
    for object_type, object_name in master_checks:
        key = (object_type, object_name)
        if key in checked or not object_name:
            continue
        checked.add(key)
        exists, message = check_tally_object_exists(object_type, object_name)
        if not exists:
            errors.append(message)

    checked_uoms = set()
    for line in item_lines:
        item_name = str(line.get("itemName") or "").strip()
        line_uom = normalize_uom(line.get("uom"))
        if not item_name or not line_uom:
            continue
        if item_name.upper() in checked_uoms:
            continue
        checked_uoms.add(item_name.upper())

        tally_uom, uom_error = fetch_tally_stock_item_uom(item_name)
        if uom_error:
            errors.append(uom_error)
            continue
        if not tally_uom:
            errors.append(f"{item_name}: Tally UOM not found")
            continue
        if tally_uom != line_uom:
            errors.append(f"{item_name}: UOM mismatch. ERP={line_uom}, Tally={tally_uom}")

    return errors


def update_invoice_tally_status(
    conn,
    invoice_id,
    success,
    remark,
    tally_by=None,
    tally_inv_no=None,
    tally_inv_date=None,
    tally_inv_id=None,
):
    cursor = get_db_cursor(conn)
    if success:
        sql = """
            UPDATE invoices
            SET
                tallyTimestamp = %s,
                tallyBy = %s,
                tallySyncRemark = %s,
                tallyInvNo = %s,
                tallyInvDate = %s,
                tallyInvId = %s
            WHERE id = %s
            """
        cursor.execute(
            sql,
            (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                tally_by or DEFAULT_UPDATED_BY,
                remark,
                tally_inv_no,
                tally_inv_date,
                tally_inv_id,
                invoice_id,
            ),
        )
    else:
        cursor.execute(
            """
            UPDATE invoices
            SET tallySyncRemark = %s
            WHERE id = %s
            """,
            (remark, invoice_id),
        )
    conn.commit()
    cursor.close()


def sync_invoices_to_tally():
    conn = get_db_connection()

    try:
        ensure_invoice_sync_columns(conn)
        pending_invoice_rows = get_pending_invoice_rows(conn)

        print("==========================================")
        print(f"Pending invoices found: {len(pending_invoice_rows)}")
        print("==========================================")

        for invoice_row in pending_invoice_rows:
            invoice_id = invoice_row.get("id")
            invoice_no = str(invoice_row.get("invoiceNo") or "").strip()

            print(f"\nProcessing Invoice ID: {invoice_id} | Invoice No: {invoice_no}")

            try:
                company_row = get_company_details(conn, invoice_row.get("companyId"))
                company_name = (company_row or {}).get("name") or ""
                if not company_name:
                    remark = "Company ledger not found in companies table"
                    update_invoice_tally_status(conn, invoice_id, False, remark)
                    print(remark)
                    continue

                item_lines = get_invoice_lines(conn, invoice_id)
                if not item_lines:
                    remark = "No invoice line items found"
                    update_invoice_tally_status(conn, invoice_id, False, remark)
                    print(remark)
                    continue

                line_errors = validate_invoice_lines(item_lines)
                if line_errors:
                    remark = " | ".join(line_errors[:10])
                    update_invoice_tally_status(conn, invoice_id, False, remark)
                    log_terminal("VALIDATION", remark)
                    continue

                if not invoice_no:
                    remark = "Invoice No missing"
                    update_invoice_tally_status(conn, invoice_id, False, remark)
                    log_terminal("VALIDATION", remark)
                    continue

                sales_ledger_name = resolve_sales_ledger_name(invoice_row, company_row, item_lines)
                dispatch_details = get_invoice_dispatch_details(conn, invoice_id, item_lines)
                narration_text = build_invoice_narration(dispatch_details)

                existing_tally_id = str(invoice_row.get("tallyInvId") or "").strip()
                tally_reference = fetch_tally_voucher_by_id(existing_tally_id) if existing_tally_id else {}
                if existing_tally_id and tally_reference:
                    remark = "Voucher already exists in Tally. Matched by saved Tally ID."
                    update_invoice_tally_status(
                        conn,
                        invoice_id,
                        True,
                        remark,
                        invoice_row.get("updatedBy") or DEFAULT_UPDATED_BY,
                        tally_reference.get("tallyInvNo") or invoice_no,
                        format_iso_date(tally_reference.get("tallyInvDate")),
                        existing_tally_id,
                    )
                    print(f"Skipping creation: {remark} | {tally_reference}")
                    continue

                voucher_by_number = fetch_tally_voucher_reference(invoice_no, VOUCHER_TYPE_NAME)
                if voucher_by_number:
                    remark = "Voucher already exists in Tally. Matched by Invoice No."
                    update_invoice_tally_status(
                        conn,
                        invoice_id,
                        True,
                        remark,
                        invoice_row.get("updatedBy") or DEFAULT_UPDATED_BY,
                        voucher_by_number.get("tallyInvNo") or invoice_no,
                        format_iso_date(voucher_by_number.get("tallyInvDate")),
                        voucher_by_number.get("tallyInvId"),
                    )
                    print(f"Skipping creation: {remark} | {voucher_by_number}")
                    continue

                for line in item_lines:
                    print(
                        "Line -> "
                        f"item={line.get('itemName')}, "
                        f"qty={line.get('qty')}, "
                        f"uom={line.get('uom')}, "
                        f"rate={line.get('rate')}, "
                        f"amount={line.get('amount')}"
                    )
                print(f"Using sales ledger: {sales_ledger_name}")
                if narration_text:
                    print(f"Narration: {narration_text}")

                tally_master_errors = validate_tally_masters(
                    company_name,
                    sales_ledger_name,
                    item_lines,
                    invoice_row,
                )
                if tally_master_errors:
                    remark = " | ".join(tally_master_errors[:10])
                    update_invoice_tally_status(conn, invoice_id, False, remark)
                    log_terminal("PRECHECK", remark)
                    continue

                tally_xml = create_sales_voucher_xml(
                    invoice_row,
                    company_name,
                    item_lines,
                    sales_ledger_name,
                    narration_text,
                )

                if DEBUG_TALLY_XML:
                    print("Generated Tally XML:")
                    print(tally_xml)

                tally_response = post_to_tally(tally_xml)

                print("Tally Response:")
                print(tally_response)

                if is_tally_success(tally_response):
                    created_tally_voucher = fetch_created_tally_voucher(tally_response)
                    if not created_tally_voucher.get("tallyInvNo"):
                        created_tally_voucher["tallyInvNo"] = invoice_no
                    if not (
                        created_tally_voucher.get("tallyInvDate")
                        and created_tally_voucher.get("tallyInvId")
                    ):
                        voucher_by_number = fetch_tally_voucher_reference(invoice_no, VOUCHER_TYPE_NAME)
                        if voucher_by_number:
                            created_tally_voucher = {
                                **created_tally_voucher,
                                **voucher_by_number,
                            }
                            if not created_tally_voucher.get("tallyInvNo"):
                                created_tally_voucher["tallyInvNo"] = invoice_no

                    if not (
                        created_tally_voucher.get("tallyInvDate")
                        and created_tally_voucher.get("tallyInvId")
                    ):
                        context_voucher = fetch_tally_voucher_by_context(
                            invoice_row,
                            company_name,
                            narration_text,
                        )
                        if context_voucher:
                            created_tally_voucher = {
                                **created_tally_voucher,
                                **context_voucher,
                            }
                            if not created_tally_voucher.get("tallyInvNo"):
                                created_tally_voucher["tallyInvNo"] = invoice_no

                    has_voucher_no = bool(created_tally_voucher.get("tallyInvNo"))
                    has_voucher_date = bool(created_tally_voucher.get("tallyInvDate"))
                    has_voucher_id = bool(created_tally_voucher.get("tallyInvId"))
                    if has_voucher_no and has_voucher_date and has_voucher_id:
                        remark = "Posted successfully to Tally"
                    elif has_voucher_no:
                        remark = "Posted to Tally; voucher number saved, date/id fetch incomplete"
                    else:
                        remark = "Posted to Tally but voucher number unavailable"
                    update_invoice_tally_status(
                        conn,
                        invoice_id,
                        True,
                        remark,
                        invoice_row.get("updatedBy") or DEFAULT_UPDATED_BY,
                        created_tally_voucher.get("tallyInvNo"),
                        format_iso_date(created_tally_voucher.get("tallyInvDate")),
                        created_tally_voucher.get("tallyInvId"),
                    )
                    if created_tally_voucher:
                        print(f"Fetched Tally invoice reference: {created_tally_voucher}")
                    print(remark)
                else:
                    error_detail = extract_tally_error(tally_response)
                    update_invoice_tally_status(conn, invoice_id, False, error_detail)
                    print(f"Posting failed: {error_detail}")

            except Exception as exc:
                error_message = str(exc)[:1000]
                update_invoice_tally_status(conn, invoice_id, False, error_message)
                print(f"Error in Invoice ID {invoice_id}: {error_message}")

    finally:
        conn.close()


if __name__ == "__main__":
    sync_invoices_to_tally()
