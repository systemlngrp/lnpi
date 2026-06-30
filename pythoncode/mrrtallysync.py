import os
import sys
import json
import re
import mysql.connector
import requests
from datetime import datetime, date
import xml.sax.saxutils as saxutils
import xml.etree.ElementTree as ET
from dotenv import load_dotenv


# =====================================================
# LOAD CONFIGURATION
# =====================================================

def load_runtime_env():
    # Try to load from current directory or script directory
    env_paths = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            load_dotenv(env_path, override=True)
            return
    load_dotenv(override=True)

load_runtime_env()

# Database Config from Environment
DB_HOST = os.getenv('DB_HOST', '193.203.184.152').strip()
if DB_HOST in ('.', 'localhost'):
    DB_HOST = '127.0.0.1'

DB_CONFIG = {
    "host": DB_HOST,
    "user": os.getenv('DB_USER', 'u380633007_lnpidata'),
    "password": os.getenv('DB_PASSWORD', '!Office1@'),
    "database": os.getenv('DB_NAME', 'u380633007_lnpidata'),
    "port": int(os.getenv('DB_PORT', '3306'))
}

# Tally Config from Environment
TALLY_URL = os.getenv('TALLY_URL', 'http://localhost:9004').strip()
TALLY_COMPANY_NAME = os.getenv('TALLY_COMPANY_NAME', 'Laxmi Narayan Packaging Industries')
TALLY_COMPANY_FALLBACKS = []
for company_name in (TALLY_COMPANY_NAME, os.getenv('TALLY_COMPANY_ALT_NAME', 'LNPI')):
    cleaned_name = (company_name or "").strip()
    if cleaned_name and cleaned_name not in TALLY_COMPANY_FALLBACKS:
        TALLY_COMPANY_FALLBACKS.append(cleaned_name)
VOUCHER_TYPE_NAME = os.getenv('VOUCHER_TYPE_NAME', 'Purchase')
PURCHASE_LEDGER_NAME = os.getenv('PURCHASE_LEDGER_NAME', 'Purchase')
OTHERS_PURCHASE_LEDGER_NAME = os.getenv('OTHERS_PURCHASE_LEDGER_NAME', 'Purchase Other RM')
FG_PURCHASE_LEDGER_NAME = os.getenv('FG_PURCHASE_LEDGER_NAME', 'Purchase - FG')
PURCHASE_PAPER_LEDGER_NAME = os.getenv('PURCHASE_PAPER_LEDGER_NAME', 'PURCHASE PAPER')
SERVICE_PURCHASE_LEDGER_NAME = os.getenv('SERVICE_PURCHASE_LEDGER_NAME', 'REPAIR & MAINTANANCE')
REEL_STOCK_GROUP_NAME = os.getenv('REEL_STOCK_GROUP_NAME', 'PAPER IN REEL FORM')
DEFAULT_STOCK_GROUP_NAME = os.getenv('DEFAULT_STOCK_GROUP_NAME', 'Primary')
INSURANCE_LEDGER_NAME = os.getenv('INSURANCE_LEDGER_NAME', 'INSURANCE & OTHER EXP. ON PURCHASE')
OTHER_CHARGES_LEDGER_NAME = os.getenv('OTHER_CHARGES_LEDGER_NAME', 'INSURANCE & OTHER EXP. ON PURCHASE')
CGST_LEDGER_NAME = os.getenv('CGST_LEDGER_NAME', 'Input CGST')
SGST_LEDGER_NAME = os.getenv('SGST_LEDGER_NAME', 'Input SGST')
IGST_LEDGER_NAME = os.getenv('IGST_LEDGER_NAME', 'Input IGST')
SUPPLIER_GROUP_NAME = os.getenv('SUPPLIER_GROUP_NAME', 'Sundry Creditors')
DEFAULT_GODOWN_NAME = os.getenv('DEFAULT_GODOWN_NAME', 'Main Location')
DEFAULT_BATCH_NAME = os.getenv('DEFAULT_BATCH_NAME', 'Primary Batch')
DEBUG_TALLY_XML = os.getenv('DEBUG_TALLY_XML', '0').strip() == '1'
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


# =====================================================
# COMMON HELPER FUNCTIONS
# =====================================================

def esc(value):
    """
    Escape values safely for XML.
    """
    if value is None:
        return ""
    return saxutils.escape(str(value))


def to_float(value):
    """
    Convert database value safely to float.
    """
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def get_first_numeric(source, keys, default=0.0):
    """
    Return the first numeric-looking value from a dict for the given keys.
    """
    for key in keys:
        if key not in source:
            continue
        value = source.get(key)
        if value is None or value == "":
            continue
        return to_float(value)
    return default


def format_tally_date(value):
    """
    Tally date format: YYYYMMDD
    """

    if value is None or value == "":
        return datetime.today().strftime("%Y%m%d")

    if isinstance(value, datetime):
        return value.strftime("%Y%m%d")

    if isinstance(value, date):
        return value.strftime("%Y%m%d")

    value = str(value).strip()

    possible_formats = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%d.%m.%Y"
    ]

    for fmt in possible_formats:
        try:
            return datetime.strptime(value, fmt).strftime("%Y%m%d")
        except Exception:
            pass

    return datetime.today().strftime("%Y%m%d")


def normalize_uom(value):
    """
    Normalize application UOM to the exact unit name expected by Tally.
    """
    if value is None:
        return ""

    normalized = str(value).strip()
    if not normalized:
        return ""

    key = normalized.upper()
    return TALLY_UOM_ALIASES.get(key, normalized)


def get_mrr_reference(mrr_row):
    """
    Return the best available MRR reference for logging.
    """
    for key in ("mrrNo", "mrrNumber", "transactionNo", "documentNo", "id"):
        value = mrr_row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def get_purchase_ledger_name(material_type):
    """
    Use dedicated purchase ledgers for special material types.
    """
    normalized_type = str(material_type or "").strip().upper()
    if normalized_type == "REEL":
        return PURCHASE_PAPER_LEDGER_NAME
    if normalized_type == "OTHERS":
        return OTHERS_PURCHASE_LEDGER_NAME
    if normalized_type == "FG PURCHASE":
        return FG_PURCHASE_LEDGER_NAME
    if normalized_type == "SERVICE RETURN":
        return SERVICE_PURCHASE_LEDGER_NAME
    return PURCHASE_LEDGER_NAME


def is_reel_type(material_type):
    return str(material_type or "").strip().upper() == "REEL"


def get_stock_group_name(material_type):
    """
    Use a dedicated stock group for reel items and a configurable default for everything else.
    """
    if is_reel_type(material_type):
        return REEL_STOCK_GROUP_NAME
    return DEFAULT_STOCK_GROUP_NAME


def get_tally_uom_candidates(uom):
    """
    Return preferred Tally UOM candidates, with KG -> KGS fallback.
    """
    normalized = normalize_uom(uom) or "KG"
    candidates = [normalized]

    if normalized.upper() == "KG":
        candidates.append("KGS")

    unique_candidates = []
    for candidate in candidates:
        cleaned = str(candidate or "").strip()
        if cleaned and cleaned not in unique_candidates:
            unique_candidates.append(cleaned)
    return unique_candidates


# =====================================================
# FETCH PENDING MATERIAL IN / MRR RECORDS
# =====================================================

def get_pending_mrr_rows(conn):
    """
    Fetch only unsynced material_in records that are ready for Tally.
    """

    sql = """
        SELECT *
        FROM material_in
        WHERE status = 'Pending Tally'
          AND (
                tallyTimestamp IS NULL
             OR tallyTimestamp = ''
          )
    """

    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql)
    rows = cursor.fetchall()
    cursor.close()

    return rows


# =====================================================
# FETCH SUPPLIER / CREDITOR
# =====================================================

def get_supplier_name(conn, supplier_id):
    """
    Get supplier name from suppliers table.
    """

    if not supplier_id:
        return ""

    sql = """
        SELECT name
        FROM suppliers
        WHERE id = %s
        LIMIT 1
    """

    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql, (supplier_id,))
    row = cursor.fetchone()
    cursor.close()

    if row:
        return row.get("name") or ""

    return ""


# =====================================================
# FETCH MATERIAL IN LINES WITH MATERIAL NAME
# =====================================================

def get_material_lines(conn, mrr_row):
    """
    Parse item lines from the JSON 'lines' column in material_in table.
    Look up material name from 'materials' or 'npd' table.
    """

    lines_json = mrr_row.get("lines")
    if not lines_json:
        return []

    try:
        if isinstance(lines_json, str):
            lines = json.loads(lines_json)
        else:
            lines = lines_json
    except Exception as e:
        print(f"Error parsing lines JSON: {e}")
        return []

    processed_lines = []
    material_in_type = str(mrr_row.get("mrrType") or "").strip()
    cursor = conn.cursor(dictionary=True)

    for line in lines:
        line_id = line.get("id")
        item_id = line.get("itemId")
        if not item_id:
            continue

        # Look up in materials table first
        cursor.execute("SELECT name, erpCode FROM materials WHERE id = %s LIMIT 1", (item_id,))
        m_row = cursor.fetchone()
        
        item_name = ""
        item_erp = str(line.get("erpCode") or "").strip()
        if m_row:
            item_name = m_row.get("name")
            item_erp = str(m_row.get("erpCode") or item_erp).strip()
        else:
            # Look up in npd table if not found in materials
            cursor.execute("SELECT itemName as name, erp FROM npd WHERE id = %s LIMIT 1", (item_id,))
            n_row = cursor.fetchone()
            if n_row:
                item_name = n_row.get("name")
                item_erp = str(n_row.get("erp") or item_erp).strip()

        processed_lines.append({
            "lineId": line_id,
            "itemId": item_id,
            "itemName": item_name or "Unknown Item",
            "itemErp": item_erp,
            "mrrType": material_in_type,
            "qty": get_first_numeric(line, ["actualQty", "invoiceQty", "qty"]),
            "uom": normalize_uom(line.get("uom")),
            "rate": get_first_numeric(line, ["rate", "invoiceRate", "poRate"]),
            "cost": get_first_numeric(line, ["cost", "rate", "invoiceRate", "poRate"]),
            "amount": get_first_numeric(line, ["actualValue", "invoiceValue", "value"]),
        })

    cursor.close()
    return processed_lines


def validate_item_lines_basic(item_lines):
    """
    Ensure every line has usable qty and rate before Tally-specific UOM resolution.
    """
    errors = []

    for index, line in enumerate(item_lines, start=1):
        item_name = line.get("itemName") or f"Line {index}"
        qty = to_float(line.get("qty"))
        rate = to_float(line.get("rate"))

        if qty <= 0:
            errors.append(f"{item_name}: qty missing or zero")
        if rate <= 0:
            errors.append(f"{item_name}: rate missing or zero")

    return errors


# =====================================================
# CREATE TALLY PURCHASE VOUCHER XML
# =====================================================

def create_purchase_voucher_xml(mrr, supplier_name, item_lines, company_name=None):
    """
    Create Tally XML for Purchase Voucher.
    """

    invoice_no = mrr.get("invoiceNo") or ""
    invoice_date = format_tally_date(mrr.get("invDate") or mrr.get("date"))
    transaction_no = mrr.get("transactionNo") or ""

    supplier_name = supplier_name or "Unknown Supplier"

    insurance = to_float(mrr.get("insurance"))
    other_charges = to_float(mrr.get("otherCharges"))

    cgst = to_float(mrr.get("totalCgst"))
    sgst = to_float(mrr.get("totalSgst"))
    igst = to_float(mrr.get("totalIgst"))

    inventory_xml = ""
    total_item_amount = 0.0

    for line in item_lines:
        item_name = line.get("itemName") or ""
        qty = to_float(line.get("qty"))
        uom = line.get("uom") or ""
        rate = to_float(line.get("rate"))
        cost = to_float(line.get("cost"))
        line_amount = to_float(line.get("amount"))
        material_type = line.get("mrrType") or ""
        purchase_ledger_name = get_purchase_ledger_name(material_type)
        qty_text = f"{qty:g} {esc(uom)}".strip()
        rate_text = f"{rate:g}/{esc(uom)}" if uom else f"{rate:g}"

        amount = round(line_amount if line_amount > 0 else qty * rate, 2)
        total_item_amount += amount

        batch_allocations_xml = f"""
                            <BATCHALLOCATIONS.LIST>
                                <GODOWNNAME>{esc(DEFAULT_GODOWN_NAME)}</GODOWNNAME>
                                <BATCHNAME>{esc(DEFAULT_BATCH_NAME)}</BATCHNAME>
                                <AMOUNT>-{amount:.2f}</AMOUNT>
                                <ACTUALQTY>{qty_text}</ACTUALQTY>
                                <BILLEDQTY>{qty_text}</BILLEDQTY>
                            </BATCHALLOCATIONS.LIST>
            """

        inventory_xml += f"""
                        <ALLINVENTORYENTRIES.LIST>
                            <STOCKITEMNAME>{esc(item_name)}</STOCKITEMNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>

                            <ACTUALQTY>{qty_text}</ACTUALQTY>
                            <BILLEDQTY>{qty_text}</BILLEDQTY>
                            <RATE>{rate_text}</RATE>
                            <AMOUNT>-{amount:.2f}</AMOUNT>

                            <ACCOUNTINGALLOCATIONS.LIST>
                                <LEDGERNAME>{esc(purchase_ledger_name)}</LEDGERNAME>
                                <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                                <AMOUNT>-{amount:.2f}</AMOUNT>
                            </ACCOUNTINGALLOCATIONS.LIST>

                            {batch_allocations_xml}

                            <UDF:COST.LIST DESC="`COST`" ISLIST="YES" TYPE="Number">
                                <UDF:COST>{cost}</UDF:COST>
                            </UDF:COST.LIST>
                        </ALLINVENTORYENTRIES.LIST>
"""

    total_item_amount = round(total_item_amount, 2)

    total_invoice_amount = round(
        total_item_amount
        + insurance
        + other_charges
        + cgst
        + sgst
        + igst,
        2
    )

    ledger_entries_xml = f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(supplier_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{total_invoice_amount:.2f}</AMOUNT>

                            <BILLALLOCATIONS.LIST>
                                <NAME>{esc(invoice_no)}</NAME>
                                <BILLTYPE>New Ref</BILLTYPE>
                                <AMOUNT>{total_invoice_amount:.2f}</AMOUNT>
                            </BILLALLOCATIONS.LIST>
                        </LEDGERENTRIES.LIST>
    """

    if insurance > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(INSURANCE_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{insurance:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if other_charges > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(OTHER_CHARGES_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{other_charges:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if cgst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(CGST_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{cgst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if sgst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(SGST_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{sgst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if igst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(IGST_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{igst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    current_company_name = company_name or TALLY_COMPANY_NAME

    xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>

    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{esc(current_company_name)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>

            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="{esc(VOUCHER_TYPE_NAME)}" ACTION="Create">

                        <DATE>{invoice_date}</DATE>
                        <VOUCHERTYPENAME>{esc(VOUCHER_TYPE_NAME)}</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>{esc(invoice_no or transaction_no)}</VOUCHERNUMBER>
                        <REFERENCE>{esc(transaction_no or invoice_no)}</REFERENCE>
                        <PARTYLEDGERNAME>{esc(supplier_name)}</PARTYLEDGERNAME>
                        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
                        <ISINVOICE>Yes</ISINVOICE>

                        {inventory_xml}

                        {ledger_entries_xml}

                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""

    return xml


# =====================================================
# POST XML TO TALLY
# =====================================================

def post_to_tally(xml_data):
    """
    Send XML to Tally.
    """

    headers = {
        "Content-Type": "text/xml"
    }

    response = requests.post(
        TALLY_URL,
        data=xml_data.encode("utf-8"),
        headers=headers,
        timeout=30
    )

    return response.text


def query_tally_stock_item_details(item_name, company_name):
    """
    Read stock-item details from Tally so posting can prefer the existing Tally UOM.
    """
    if not item_name:
        return {"exists": False, "name": "", "partNo": "", "baseUnit": ""}

    xml = f"""
<ENVELOPE>
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
                <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
                <FETCH>PartNo</FETCH>
                <FETCH>BaseUnits</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    if not response_text:
        return {"exists": False, "name": "", "partNo": "", "baseUnit": ""}

    def extract_first_tag_value(source_text, tag_name):
        match = re.search(
            rf"<{tag_name}\b[^>]*>(.*?)</{tag_name}>",
            source_text,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            return ""
        return saxutils.unescape(match.group(1).strip())

    def extract_stock_item_fragment(source_text, stock_item_name):
        pattern = re.compile(
            rf'<STOCKITEM\b[^>]*\b(?:NAME|REQNAME)="{re.escape(stock_item_name)}"[^>]*>(.*?)</STOCKITEM>',
            re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(source_text)
        if not match:
            return ""
        return match.group(0)

    try:
        root = ET.fromstring(response_text)
        for stock_item in root.findall(".//STOCKITEM"):
            name_elem = stock_item.find("NAME")
            name_attr = stock_item.get("NAME")
            found_name = (
                name_elem.text.strip()
                if name_elem is not None and name_elem.text
                else (name_attr.strip() if name_attr else "")
            )
            if found_name.upper() == item_name.strip().upper():
                part_no = (stock_item.findtext("PARTNO") or "").strip()
                base_unit = (stock_item.findtext("BASEUNITS") or "").strip()
                return {
                    "exists": True,
                    "name": found_name,
                    "partNo": part_no,
                    "baseUnit": base_unit,
                }
    except Exception as exc:
        stock_item_fragment = extract_stock_item_fragment(response_text, item_name.strip())
        if stock_item_fragment:
            part_no = extract_first_tag_value(stock_item_fragment, "PARTNO")
            base_unit = extract_first_tag_value(stock_item_fragment, "BASEUNITS")
            if base_unit:
                print(
                    f"Recovered Tally stock item base unit from raw XML for {item_name}: "
                    f"{base_unit} ({exc})"
                )
            return {
                "exists": True,
                "name": item_name.strip(),
                "partNo": part_no,
                "baseUnit": base_unit,
            }

    if f"<NAME>{esc(item_name)}</NAME>" in response_text or f'NAME="{esc(item_name)}"' in response_text:
        return {"exists": True, "name": item_name.strip(), "partNo": "", "baseUnit": ""}

    return {"exists": False, "name": "", "partNo": "", "baseUnit": ""}


def query_tally_stock_item(item_name, company_name):
    """
    Check whether a stock item already exists in Tally for the selected company.
    """
    return query_tally_stock_item_details(item_name, company_name).get("exists", False)


def query_tally_ledger(ledger_name, company_name):
    """
    Check whether a ledger already exists in Tally for the selected company.
    """
    if not ledger_name:
        return False

    xml = f"""
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Ledger</SUBTYPE>
        <ID TYPE="Name">{esc(ledger_name)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
                <FETCH>Parent</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    if not response_text:
        return False

    try:
        root = ET.fromstring(response_text)
        for ledger in root.findall(".//LEDGER"):
            name_elem = ledger.find("NAME")
            name_attr = ledger.get("NAME")
            found_name = (
                name_elem.text.strip()
                if name_elem is not None and name_elem.text
                else (name_attr.strip() if name_attr else "")
            )
            if found_name.upper() == ledger_name.strip().upper():
                return True
    except Exception:
        pass

    return f"<NAME>{esc(ledger_name)}</NAME>" in response_text or f'NAME="{esc(ledger_name)}"' in response_text


def create_tally_supplier_ledger(supplier_name, company_name):
    """
    Create a supplier ledger in Tally under Sundry Creditors.
    """
    xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>All Masters</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <LEDGER NAME="{esc(supplier_name)}" ACTION="Create">
                        <NAME.LIST>
                            <NAME>{esc(supplier_name)}</NAME>
                        </NAME.LIST>
                        <PARENT>{esc(SUPPLIER_GROUP_NAME)}</PARENT>
                    </LEDGER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    return is_tally_success(response_text), response_text


def ensure_tally_supplier_ledger(supplier_name, company_name):
    """
    Ensure the supplier ledger exists in Tally before posting the voucher.
    """
    if not supplier_name:
        return False, "Supplier ledger name missing", False

    if query_tally_ledger(supplier_name, company_name):
        return True, "", False

    print(
        f"Creating missing Tally supplier ledger: {supplier_name} | "
        f"Group={SUPPLIER_GROUP_NAME}"
    )
    created, response_text = create_tally_supplier_ledger(supplier_name, company_name)
    if not created:
        return False, extract_tally_error(response_text), False
    return True, "", True


def resolve_item_line_uoms(item_lines, company_name):
    """
    Resolve UOM with Tally-first priority so existing stock masters decide the unit.
    """
    errors = []

    for index, line in enumerate(item_lines, start=1):
        item_name = (line.get("itemName") or f"Line {index}").strip()
        app_uom = normalize_uom(line.get("uom"))
        tally_item = query_tally_stock_item_details(item_name, company_name)
        tally_uom = normalize_uom(tally_item.get("baseUnit"))

        if tally_item.get("exists") and tally_uom:
            line["uom"] = tally_uom
            print(f"UOM resolved from Tally for {item_name}: {tally_uom}")
            continue

        if tally_item.get("exists"):
            if app_uom:
                line["uom"] = app_uom
                print(
                    f"Tally item found without readable base unit for {item_name}. "
                    f"Using app UOM: {app_uom}"
                )
                continue

            errors.append(
                f"{item_name}: app UOM missing and existing Tally stock item has no readable base unit"
            )
            continue

        if app_uom:
            line["uom"] = app_uom
            print(f"Tally item not found for {item_name}. Using app UOM: {app_uom}")
            continue

        errors.append(f"{item_name}: app UOM missing and Tally stock item not found")

    return errors


def create_tally_stock_item(item_name, item_erp, uom, company_name, stock_group_name):
    """
    Create a stock item in Tally under the configured stock group.
    """
    candidate_uoms = get_tally_uom_candidates(uom)
    last_response_text = ""

    for base_unit in candidate_uoms:
        xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>All Masters</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <STOCKITEM NAME="{esc(item_name)}" ACTION="Create">
                        <NAME.LIST>
                            <NAME>{esc(item_name)}</NAME>
                        </NAME.LIST>
                        <PARENT>{esc(stock_group_name)}</PARENT>
                        <PARTNO>{esc(item_erp)}</PARTNO>
                        <BASEUNITS>{esc(base_unit)}</BASEUNITS>
                    </STOCKITEM>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""

        response_text = post_to_tally(xml)
        last_response_text = response_text

        if is_tally_success(response_text):
            return True, response_text, base_unit

        error_detail = extract_tally_error(response_text).upper()
        if base_unit.upper() == "KG" and "KG" in error_detail and ("DOES NOT EXIST" in error_detail or "NOT FOUND" in error_detail):
            print(f"Tally UOM KG not found for {item_name}. Retrying with KGS.")
            continue

        return False, response_text, base_unit

    return False, last_response_text, candidate_uoms[-1]


def ensure_tally_stock_items(item_lines, company_name):
    """
    Create missing stock items in Tally before posting the voucher.
    """
    created_items = []

    for line in item_lines:
        item_name = (line.get("itemName") or "").strip()
        item_erp = (line.get("itemErp") or "").strip()
        uom = (line.get("uom") or "").strip()
        material_type = line.get("mrrType")
        stock_group_name = get_stock_group_name(material_type)

        if not item_name:
            return False, "Stock item name missing", created_items
        if not item_erp:
            return False, f"{item_name}: item ERP missing", created_items

        if query_tally_stock_item(item_name, company_name):
            continue

        print(
            f"Creating missing Tally stock item: {item_name} | "
            f"ERP={item_erp} | Group={stock_group_name}"
        )
        created, response_text, used_uom = create_tally_stock_item(
            item_name,
            item_erp,
            uom,
            company_name,
            stock_group_name,
        )
        if not created:
            return False, extract_tally_error(response_text), created_items
        line["uom"] = used_uom
        created_items.append(f"{item_name} [{item_erp}]")

    return True, "", created_items


# =====================================================
# CHECK TALLY RESPONSE
# =====================================================

def is_tally_success(response_text):
    """
    Check whether Tally posting was successful.
    Only returns True if CREATED > 0 or ALTERED > 0.
    """

    if not response_text:
        return False

    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        return True

    return False


def extract_tally_error(response_text):
    """
    Extract error message from Tally response.
    """
    if not response_text:
        return "Empty response from Tally"
    
    import re
    # Try to find LINEERROR
    match = re.search(r'<LINEERROR>(.*?)</LINEERROR>', response_text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    
    # Check if exceptions > 0
    if "<EXCEPTIONS>0</EXCEPTIONS>" not in response_text and "<EXCEPTIONS>" in response_text:
        return "Tally returned an exception. Check response for details."

    return response_text[:200]


def is_company_selection_error(response_text):
    """
    Check whether Tally rejected the selected company name.
    """
    if not response_text:
        return False
    return "SVCurrentCompany" in response_text


# =====================================================
# UPDATE MATERIAL IN MASTER AFTER POSTING
# =====================================================

def update_mrr_tally_status(conn, material_in_id, success, remark):
    """
    Update tallyTimestamp and tallySyncRemark.
    """

    if success:
        sql = """
            UPDATE material_in
            SET
                tallyTimestamp = %s,
                tallySyncRemark = %s
            WHERE id = %s
        """
        values = (
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            remark,
            material_in_id
        )
    else:
        sql = """
            UPDATE material_in
            SET
                tallySyncRemark = %s
            WHERE id = %s
        """
        values = (
            remark,
            material_in_id
        )

    cursor = conn.cursor()
    cursor.execute(sql, values)
    conn.commit()
    cursor.close()


def build_success_remark(company_used, created_items, supplier_created):
    base_remark = f"Posted successfully to Tally ({company_used})"
    details = []
    if supplier_created:
        details.append(f"Created supplier ledger under {SUPPLIER_GROUP_NAME}")
    if created_items:
        details.append(f"Created stock item(s): {', '.join(created_items)}")
    if not details:
        return base_remark
    return f"{base_remark} | {' | '.join(details)}"


def is_excluded_mrr_type(material_in_type):
    """
    Exclude flows that will be handled by a separate Tally sync process.
    """
    return str(material_in_type or "").strip().upper() == "REJECTION IN"


# =====================================================
# MAIN SYNC FUNCTION
# =====================================================

def sync_mrr_to_tally():
    conn = get_db_connection()

    try:
        pending_mrr_rows = get_pending_mrr_rows(conn)

        print("==========================================")
        print(f"Pending MRR found: {len(pending_mrr_rows)}")
        print("==========================================")

        for mrr in pending_mrr_rows:
            material_in_id = mrr.get("id")
            mrr_reference = get_mrr_reference(mrr)
            mrr_type = str(mrr.get("mrrType") or "").strip()

            try:
                if is_excluded_mrr_type(mrr_type):
                    remark = "Skipped in this Tally sync. Rejection In / FG return will be handled through separate code."
                    update_mrr_tally_status(conn, material_in_id, False, remark)
                    print(f"{remark} | MRR No: {mrr_reference} | Type: {mrr_type}")
                    continue

                supplier_id = mrr.get("supplierId")
                supplier_name = get_supplier_name(conn, supplier_id)
                supplier_log_name = supplier_name or "Unknown Supplier"

                print(
                    f"\nProcessing Material In ID: {material_in_id} | "
                    f"MRR No: {mrr_reference} | "
                    f"Supplier: {supplier_log_name}"
                )

                if not supplier_name:
                    remark = "Supplier not found in suppliers table"
                    update_mrr_tally_status(conn, material_in_id, False, remark)
                    print(remark)
                    continue

                item_lines = get_material_lines(conn, mrr)

                if not item_lines:
                    remark = "No item lines found in material_in lines column"
                    update_mrr_tally_status(conn, material_in_id, False, remark)
                    print(remark)
                    continue

                line_errors = validate_item_lines_basic(item_lines)
                if line_errors:
                    remark = " | ".join(line_errors[:10])
                    update_mrr_tally_status(conn, material_in_id, False, remark)
                    print(f"Validation failed: {remark}")
                    continue

                tally_response = ""
                company_used = ""
                created_items_for_remark = []
                supplier_created_for_remark = False

                for company_name in TALLY_COMPANY_FALLBACKS:
                    company_used = company_name
                    supplier_ready, supplier_error, supplier_created = ensure_tally_supplier_ledger(supplier_name, company_name)
                    if not supplier_ready:
                        tally_response = supplier_error
                        if "SVCurrentCompany" in supplier_error:
                            continue
                        break
                    supplier_created_for_remark = supplier_created

                    line_errors = resolve_item_line_uoms(item_lines, company_name)
                    if line_errors:
                        tally_response = " | ".join(line_errors[:10])
                        if "SVCurrentCompany" in tally_response:
                            continue
                        break

                    stock_items_ready, stock_item_error, created_items = ensure_tally_stock_items(item_lines, company_name)
                    if not stock_items_ready:
                        tally_response = stock_item_error
                        if "SVCurrentCompany" in stock_item_error:
                            continue
                        break
                    created_items_for_remark = created_items

                    for line in item_lines:
                        purchase_ledger_name = get_purchase_ledger_name(line.get("mrrType"))
                        print(
                            "Line -> "
                            f"item={line.get('itemName')}, "
                            f"erp={line.get('itemErp')}, "
                            f"mrrType={line.get('mrrType')}, "
                            f"ledger={purchase_ledger_name}, "
                            f"qty={line.get('qty')}, "
                            f"uom={line.get('uom')}, "
                            f"rate={line.get('rate')}, "
                            f"amount={line.get('amount')}"
                        )

                    tally_xml = create_purchase_voucher_xml(
                        mrr=mrr,
                        supplier_name=supplier_name,
                        item_lines=item_lines,
                        company_name=company_name
                    )

                    if DEBUG_TALLY_XML:
                        print(f"Generated Tally XML for company: {company_name}")
                        print(tally_xml)

                    print(f"Posting to Tally company: {company_name}")
                    tally_response = post_to_tally(tally_xml)

                    if is_tally_success(tally_response):
                        break

                    if not is_company_selection_error(tally_response):
                        break

                print("Tally Response:")
                print(tally_response)

                if is_tally_success(tally_response):
                    remark = build_success_remark(company_used, created_items_for_remark, supplier_created_for_remark)
                    update_mrr_tally_status(conn, material_in_id, True, remark)
                    print(f"{remark} | MRR No: {mrr_reference} | Supplier: {supplier_name}")
                else:
                    error_detail = extract_tally_error(tally_response)
                    update_mrr_tally_status(conn, material_in_id, False, error_detail)
                    print(
                        f"Posting failed: {error_detail} | "
                        f"MRR No: {mrr_reference} | Supplier: {supplier_name}"
                    )

            except Exception as e:
                error_message = str(e)
                update_mrr_tally_status(
                    conn,
                    material_in_id,
                    False,
                    error_message[:1000]
                )
                print(
                    f"Error in Material In ID {material_in_id} | "
                    f"MRR No: {mrr_reference}: {error_message}"
                )

    finally:
        conn.close()


# =====================================================
# RUN
# =====================================================

if __name__ == "__main__":
    sync_mrr_to_tally()
