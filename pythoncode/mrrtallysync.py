import os
import sys
import json
import re
import traceback
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
    "port": int(os.getenv('DB_PORT', '3306')),
    "use_pure": True,
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
APP_CREATED_STOCK_GROUP_NAME = os.getenv('APP_CREATED_STOCK_GROUP_NAME', 'App Group')
INSURANCE_LEDGER_NAME = os.getenv('INSURANCE_LEDGER_NAME', 'INSURANCE & OTHER EXP. ON PURCHASE')
OTHER_CHARGES_LEDGER_NAME = os.getenv('OTHER_CHARGES_LEDGER_NAME', 'INSURANCE & OTHER EXP. ON PURCHASE')
CGST_LEDGER_NAME = os.getenv('CGST_LEDGER_NAME', 'Input CGST')
SGST_LEDGER_NAME = os.getenv('SGST_LEDGER_NAME', 'Input SGST')
IGST_LEDGER_NAME = os.getenv('IGST_LEDGER_NAME', 'Input IGST')
ROUND_OFF_LEDGER_NAME = os.getenv('ROUND_OFF_LEDGER_NAME', 'Round Off')
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


LOG_FILE_NAME = "mrr sync log.txt"


class TeeStream:
    """
    Mirror console output to a persistent log file.
    """
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for stream in self.streams:
            try:
                stream.write(data)
            except Exception:
                pass
        return len(data)

    def flush(self):
        for stream in self.streams:
            try:
                stream.flush()
            except Exception:
                pass


def setup_run_logging():
    """
    Persist every run's output in the current working directory.
    """
    log_dir = os.getcwd()
    log_path = os.path.join(log_dir, LOG_FILE_NAME)
    log_file = open(log_path, "a", encoding="utf-8")
    run_stamp = datetime.now().strftime("%d-%b-%Y %I:%M:%S %p")
    separator = "\n" + "=" * 90 + "\n"
    log_file.write(separator)
    log_file.write(f"MRR sync run started at {run_stamp}\n")
    log_file.write(f"Working directory: {log_dir}\n")
    log_file.write(separator)
    log_file.flush()

    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sys.stdout = TeeStream(original_stdout, log_file)
    sys.stderr = TeeStream(original_stderr, log_file)

    def handle_unhandled_exception(exc_type, exc_value, exc_traceback):
        traceback_text = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
        print("\nUnhandled exception:")
        print(traceback_text)

    sys.excepthook = handle_unhandled_exception
    print(f"Persistent log file: {log_path}")
    return log_path


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


def round2(value):
    return round(to_float(value), 2)


def normalize_invoice_number(value):
    return re.sub(r"\s+", "", str(value or "").strip()).upper()


def sanitize_tally_xml(xml_text):
    if not xml_text:
        return xml_text
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    return cleaned


def escape_tally_formula_text(value):
    return saxutils.escape(str(value or ""), {'"': '&quot;'})


def clean_tally_text(value):
    """
    Strip XML/control-noise from text recovered from Tally responses.
    """
    cleaned = sanitize_tally_xml(str(value or ""))
    cleaned = re.sub(r"[\x00-\x1F\x7F]", "", cleaned)
    return saxutils.unescape(cleaned).strip()


def is_usable_tally_uom(value):
    """
    Accept only readable unit values. Junk placeholders must not drive posting.
    """
    cleaned = clean_tally_text(value)
    if not cleaned:
        return False

    normalized = cleaned.upper()
    blocked_tokens = (
        "NOT APPLICABLE",
        "N/A",
        "&#",
        "<",
        ">",
    )
    return not any(token in normalized for token in blocked_tokens)


def normalize_stock_item_name_for_tally(value):
    """
    Normalize spacing only. Preserve the full item name exactly, including
    bracketed suffixes, because they may be part of the real Tally stock item.
    """
    return re.sub(r"\s+", " ", str(value or "")).strip()


def resolve_total_tax_amount(stored_total, line_total, expense_total):
    """
    Prefer the stored MRR tax total when available. Otherwise derive it from
    line tax plus expense tax so the sync stays compatible with older rows too.
    """
    stored_total = round2(stored_total)
    line_total = round2(line_total)
    expense_total = round2(expense_total)

    if stored_total != 0:
        return stored_total
    return round(line_total + expense_total, 2)


def build_ledger_entry_xml(ledger_name, amount):
    """
    Build a Tally ledger entry with proper polarity handling.
    Negative amount -> ISDEEMEDPOSITIVE Yes
    Positive amount -> ISDEEMEDPOSITIVE No
    """
    amount = round2(amount)
    if amount == 0:
        return ""

    is_deemed_positive = "Yes" if amount < 0 else "No"
    return f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(ledger_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>{is_deemed_positive}</ISDEEMEDPOSITIVE>
                            <AMOUNT>{amount:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """


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


def format_narration_date(value):
    """
    Human-friendly date for narration text.
    """
    if value is None or value == "":
        return ""

    if isinstance(value, datetime):
        return value.strftime("%d-%b-%Y")

    if isinstance(value, date):
        return value.strftime("%d-%b-%Y")

    raw_value = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(raw_value, fmt).strftime("%d-%b-%Y")
        except Exception:
            pass

    return raw_value


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
    return APP_CREATED_STOCK_GROUP_NAME or DEFAULT_STOCK_GROUP_NAME


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
    Get supplier/customer name from suppliers table first, then companies table.
    """

    if not supplier_id:
        return ""

    supplier_sql = """
        SELECT name
        FROM suppliers
        WHERE id = %s
        LIMIT 1
    """

    company_sql = """
        SELECT name
        FROM companies
        WHERE id = %s
        LIMIT 1
    """

    cursor = conn.cursor(dictionary=True)
    cursor.execute(supplier_sql, (supplier_id,))
    row = cursor.fetchone()
    if not row:
        cursor.execute(company_sql, (supplier_id,))
        row = cursor.fetchone()
    cursor.close()

    if row:
        return row.get("name") or ""

    return ""


def get_user_display_name(conn, identifier):
    """
    Resolve user display name from email/userId. Falls back to the raw identifier.
    """
    raw_identifier = str(identifier or "").strip()
    if not raw_identifier:
        return ""

    sql = """
        SELECT name
        FROM users
        WHERE email = %s OR userId = %s
        LIMIT 1
    """

    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql, (raw_identifier, raw_identifier))
    row = cursor.fetchone()
    cursor.close()

    resolved_name = str((row or {}).get("name") or "").strip()
    return resolved_name or raw_identifier


def build_mrr_narration(conn, mrr):
    """
    Build narration with MRR reference and approval trail.
    """
    mrr_no = get_mrr_reference(mrr)
    mrr_date = format_narration_date(mrr.get("date"))

    approval_parts = []
    ph_name = get_user_display_name(conn, mrr.get("phEmailId"))
    acc_name = get_user_display_name(conn, mrr.get("accEmailId"))
    md_name = get_user_display_name(conn, mrr.get("mdEmailId"))

    if ph_name:
        approval_parts.append(f"PH Approver: {ph_name}")
    if acc_name:
        approval_parts.append(f"Account Approver: {acc_name}")
    if md_name:
        approval_parts.append(f"MD Approver: {md_name}")

    narration_parts = []
    if mrr_no:
        if mrr_date:
            narration_parts.append(f"MRR No: {mrr_no} Dt: {mrr_date}")
        else:
            narration_parts.append(f"MRR No: {mrr_no}")
    elif mrr_date:
        narration_parts.append(f"MRR Dt: {mrr_date}")

    if approval_parts:
        narration_parts.append(f"Approved by {', '.join(approval_parts)}")

    return " | ".join(part for part in narration_parts if part)


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

        line_type = str(line.get("lineType") or "").strip().upper()
        is_service_line = material_in_type.upper() == "SERVICE RETURN" or line_type == "SERVICE"

        if is_service_line:
            cursor.execute("SELECT name FROM services WHERE id = %s LIMIT 1", (item_id,))
            service_row = cursor.fetchone()
            service_name = (
                (service_row or {}).get("name")
                or line.get("serviceName")
                or line.get("itemName")
                or "Unknown Service"
            )
            service_name = normalize_stock_item_name_for_tally(service_name)
            processed_lines.append({
                "lineId": line_id,
                "itemId": item_id,
                "itemName": service_name,
                "itemErp": str(line.get("erpCode") or "").strip(),
                "mrrType": material_in_type,
                "lineType": "Service",
                "qty": get_first_numeric(line, ["actualQty", "invoiceQty", "qty"]),
                "uom": normalize_uom(line.get("uom")),
                "masterUom": "",
                "rate": get_first_numeric(line, ["rate", "invoiceRate", "poRate"]),
                "cost": get_first_numeric(line, ["cost", "rate", "invoiceRate", "poRate"]),
                "amount": get_first_numeric(line, ["actualValue", "invoiceValue", "value"]),
                "cgst": get_first_numeric(line, ["cgst"]),
                "sgst": get_first_numeric(line, ["sgst"]),
                "igst": get_first_numeric(line, ["igst"]),
            })
            continue

        # Look up in materials table first
        cursor.execute("SELECT name, erpCode, uom FROM materials WHERE id = %s LIMIT 1", (item_id,))
        m_row = cursor.fetchone()
        
        item_name = ""
        item_erp = str(line.get("erpCode") or "").strip()
        master_uom = ""
        if m_row:
            item_name = m_row.get("name")
            item_erp = str(m_row.get("erpCode") or item_erp).strip()
            master_uom = normalize_uom(m_row.get("uom"))
        else:
            # Look up in npd table if not found in materials
            cursor.execute("SELECT itemName as name, erp, uom FROM npd WHERE id = %s LIMIT 1", (item_id,))
            n_row = cursor.fetchone()
            if n_row:
                item_name = n_row.get("name")
                item_erp = str(n_row.get("erp") or item_erp).strip()
                master_uom = normalize_uom(n_row.get("uom"))

        item_name = normalize_stock_item_name_for_tally(
            item_name or line.get("itemName") or line.get("materialName") or "Unknown Item"
        )

        processed_lines.append({
            "lineId": line_id,
            "itemId": item_id,
            "itemName": item_name or "Unknown Item",
            "itemErp": item_erp,
            "mrrType": material_in_type,
            "qty": get_first_numeric(line, ["actualQty", "invoiceQty", "qty"]),
            "uom": normalize_uom(line.get("uom")),
            "masterUom": master_uom,
            "rate": get_first_numeric(line, ["rate", "invoiceRate", "poRate"]),
            "cost": get_first_numeric(line, ["cost", "rate", "invoiceRate", "poRate"]),
            "amount": get_first_numeric(line, ["actualValue", "invoiceValue", "value"]),
            "cgst": get_first_numeric(line, ["cgst"]),
            "sgst": get_first_numeric(line, ["sgst"]),
            "igst": get_first_numeric(line, ["igst"]),
        })

    cursor.close()
    return processed_lines


def validate_item_lines_basic(item_lines):
    """
    Ensure every line has usable qty and rate before Tally-specific UOM resolution.
    """
    errors = []

    for index, line in enumerate(item_lines, start=1):
        item_name = normalize_stock_item_name_for_tally(line.get("itemName") or f"Line {index}")
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

def create_purchase_voucher_xml(mrr, supplier_name, item_lines, company_name=None, narration_text=""):
    """
    Create Tally XML for Purchase Voucher.
    """

    invoice_no = str(mrr.get("invoiceNo") or "").strip()
    voucher_date = format_tally_date(mrr.get("date"))
    reference_date = format_tally_date(mrr.get("invDate") or mrr.get("date"))
    transaction_no = mrr.get("transactionNo") or ""

    supplier_name = supplier_name or "Unknown Supplier"

    insurance = to_float(mrr.get("insurance"))
    other_charges = to_float(mrr.get("otherCharges"))
    round_off = round2(mrr.get("roundOff"))
    expense_cgst = round2(mrr.get("expenseCGST"))
    expense_sgst = round2(mrr.get("expenseSGST"))
    expense_igst = round2(mrr.get("expenseIGST"))
    line_cgst = round(sum(round2(line.get("cgst")) for line in item_lines), 2)
    line_sgst = round(sum(round2(line.get("sgst")) for line in item_lines), 2)
    line_igst = round(sum(round2(line.get("igst")) for line in item_lines), 2)
    cgst = resolve_total_tax_amount(mrr.get("totalCgst"), line_cgst, expense_cgst)
    sgst = resolve_total_tax_amount(mrr.get("totalSgst"), line_sgst, expense_sgst)
    igst = resolve_total_tax_amount(mrr.get("totalIgst"), line_igst, expense_igst)

    inventory_xml = ""
    total_item_amount = 0.0
    service_ledger_entries_xml = ""

    for line in item_lines:
        item_name = normalize_stock_item_name_for_tally(line.get("itemName") or "")
        line["itemName"] = item_name
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

        if str(line.get("lineType") or "").strip().upper() == "SERVICE":
            service_ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(purchase_ledger_name)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{amount:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
"""
            continue

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
    total_invoice_amount = round(
        total_invoice_amount
        + round_off,
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

    ledger_entries_xml += service_ledger_entries_xml

    if insurance > 0:
        ledger_entries_xml += build_ledger_entry_xml(INSURANCE_LEDGER_NAME, -insurance)

    if other_charges > 0:
        ledger_entries_xml += build_ledger_entry_xml(OTHER_CHARGES_LEDGER_NAME, -other_charges)

    if cgst > 0:
        ledger_entries_xml += build_ledger_entry_xml(CGST_LEDGER_NAME, -cgst)

    if sgst > 0:
        ledger_entries_xml += build_ledger_entry_xml(SGST_LEDGER_NAME, -sgst)

    if igst > 0:
        ledger_entries_xml += build_ledger_entry_xml(IGST_LEDGER_NAME, -igst)

    if round_off != 0:
        ledger_entries_xml += build_ledger_entry_xml(ROUND_OFF_LEDGER_NAME, round_off)

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

                        <DATE>{voucher_date}</DATE>
                        <VOUCHERTYPENAME>{esc(VOUCHER_TYPE_NAME)}</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>{esc(transaction_no or invoice_no)}</VOUCHERNUMBER>
                        <REFERENCE>{esc(invoice_no or transaction_no)}</REFERENCE>
                        <REFERENCEDATE>{reference_date}</REFERENCEDATE>
                        <PARTYLEDGERNAME>{esc(supplier_name)}</PARTYLEDGERNAME>
                        <NARRATION>{esc(narration_text)}</NARRATION>
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
    if "<LINEERROR>" in response_text.upper():
        return {"exists": False, "name": "", "partNo": "", "baseUnit": ""}

    cleaned_response_text = sanitize_tally_xml(response_text)

    def extract_first_tag_value(source_text, tag_name):
        match = re.search(
            rf"<{tag_name}\b[^>]*>(.*?)</{tag_name}>",
            source_text,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            return ""
        return clean_tally_text(match.group(1))

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
        root = ET.fromstring(cleaned_response_text)
        for stock_item in root.findall(".//STOCKITEM"):
            name_elem = stock_item.find("NAME")
            name_attr = stock_item.get("NAME")
            found_name = (
                clean_tally_text(name_elem.text)
                if name_elem is not None and name_elem.text
                else clean_tally_text(name_attr)
            )
            if found_name.upper() == item_name.strip().upper():
                part_no = clean_tally_text(stock_item.findtext("PARTNO") or "")
                base_unit = clean_tally_text(stock_item.findtext("BASEUNITS") or "")
                return {
                    "exists": True,
                    "name": found_name,
                    "partNo": part_no,
                    "baseUnit": base_unit,
                }
    except Exception as exc:
        stock_item_fragment = extract_stock_item_fragment(cleaned_response_text, item_name.strip())
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

    return {"exists": False, "name": "", "partNo": "", "baseUnit": ""}


def query_tally_stock_item(item_name, company_name):
    """
    Check whether a stock item already exists in Tally for the selected company.
    """
    return query_tally_stock_item_details(item_name, company_name).get("exists", False)


def extract_tally_voucher_summary(voucher):
    summary = {
        "voucherNumber": voucher.get("VOUCHERNUMBER") or "",
        "voucherDate": voucher.get("DATE") or "",
        "reference": voucher.get("REFERENCE") or "",
        "referenceDate": voucher.get("REFERENCEDATE") or "",
        "partyLedgerName": voucher.get("PARTYLEDGERNAME") or "",
        "voucherTypeName": voucher.get("VOUCHERTYPENAME") or "",
        "masterId": voucher.get("MASTERID") or "",
    }

    for child in voucher:
        tag = str(child.tag or "").upper()
        text = (child.text or "").strip()
        if not text:
            continue
        if tag == "VOUCHERNUMBER" and not summary["voucherNumber"]:
            summary["voucherNumber"] = text
        elif tag == "DATE" and not summary["voucherDate"]:
            summary["voucherDate"] = text
        elif tag == "REFERENCE" and not summary["reference"]:
            summary["reference"] = text
        elif tag == "REFERENCEDATE" and not summary["referenceDate"]:
            summary["referenceDate"] = text
        elif tag == "PARTYLEDGERNAME" and not summary["partyLedgerName"]:
            summary["partyLedgerName"] = text
        elif tag == "VOUCHERTYPENAME" and not summary["voucherTypeName"]:
            summary["voucherTypeName"] = text
        elif tag == "MASTERID" and not summary["masterId"]:
            summary["masterId"] = text

    return {key: value for key, value in summary.items() if value}


def query_tally_duplicate_purchase_voucher(company_name, supplier_name, invoice_no, invoice_date):
    """
    Check Tally for an existing purchase voucher with the same supplier, invoice
    reference, and invoice/reference date.
    """
    normalized_supplier = str(supplier_name or "").strip()
    normalized_invoice_no = normalize_invoice_number(invoice_no)
    reference_date = format_tally_date(invoice_date)

    if not normalized_supplier or not normalized_invoice_no or not reference_date:
        return False, {}, ""

    supplier_formula = escape_tally_formula_text(normalized_supplier)
    reference_formula = escape_tally_formula_text(normalized_invoice_no)
    voucher_type_formula = escape_tally_formula_text(VOUCHER_TYPE_NAME)

    xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="MRRDuplicateVoucherCheck" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>Date</FETCH>
                            <FETCH>VoucherNumber</FETCH>
                            <FETCH>Reference</FETCH>
                            <FETCH>ReferenceDate</FETCH>
                            <FETCH>PartyLedgerName</FETCH>
                            <FETCH>VoucherTypeName</FETCH>
                            <FETCH>MasterID</FETCH>
                            <FILTERS>OnlyMatchingPurchaseVoucher</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="OnlyMatchingPurchaseVoucher">
                            $$StringEqual:$$StringUpper:$VoucherTypeName:"{voucher_type_formula}"
                            AND $$StringEqual:$$StringUpper:$PartyLedgerName:"{supplier_formula.upper()}"
                            AND $$StringEqual:$$StringUpper:$$String:$Reference:"{reference_formula}"
                            AND $$StringEqual:$$String:$ReferenceDate:"{reference_date}"
                        </SYSTEM>
                    </TDLMESSAGE>
                </TDL>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    cleaned = sanitize_tally_xml(response_text)

    try:
        root = ET.fromstring(cleaned)
        for voucher in root.findall(".//VOUCHER"):
            summary = extract_tally_voucher_summary(voucher)
            if summary:
                return True, summary, response_text
    except Exception:
        pass

    return False, {}, response_text


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


def query_tally_stock_group(group_name, company_name):
    """
    Check whether a stock group already exists in Tally for the selected company.
    """
    if not group_name:
        return False

    xml = f"""
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Stock Group</SUBTYPE>
        <ID TYPE="Name">{esc(group_name)}</ID>
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
        for stock_group in root.findall(".//STOCKGROUP"):
            name_elem = stock_group.find("NAME")
            name_attr = stock_group.get("NAME")
            found_name = (
                name_elem.text.strip()
                if name_elem is not None and name_elem.text
                else (name_attr.strip() if name_attr else "")
            )
            if found_name.upper() == group_name.strip().upper():
                return True
    except Exception:
        pass

    return f"<NAME>{esc(group_name)}</NAME>" in response_text or f'NAME="{esc(group_name)}"' in response_text


def query_tally_unit(unit_name, company_name):
    """
    Check whether a unit already exists in Tally for the selected company.
    """
    if not unit_name:
        return False

    xml = f"""
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Unit</SUBTYPE>
        <ID TYPE="Name">{esc(unit_name)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    if not response_text or "<LINEERROR>" in response_text.upper():
        return False

    cleaned_response_text = sanitize_tally_xml(response_text)
    return (
        f"<NAME>{esc(unit_name)}</NAME>" in cleaned_response_text
        or f'NAME="{esc(unit_name)}"' in cleaned_response_text
    )


def create_tally_stock_group(group_name, company_name, parent_group_name="Primary"):
    """
    Create a stock group in Tally under the selected parent stock group.
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
                    <STOCKGROUP NAME="{esc(group_name)}" ACTION="Create">
                        <NAME.LIST>
                            <NAME>{esc(group_name)}</NAME>
                        </NAME.LIST>
                        <PARENT>{esc(parent_group_name)}</PARENT>
                    </STOCKGROUP>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    return is_tally_success(response_text), response_text


def create_tally_unit(unit_name, company_name):
    """
    Create a simple unit master in Tally.
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
                    <UNIT NAME="{esc(unit_name)}" ACTION="Create">
                        <NAME>{esc(unit_name)}</NAME>
                        <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
                    </UNIT>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""

    response_text = post_to_tally(xml)
    return is_tally_success(response_text), response_text


def ensure_tally_unit(unit_name, company_name):
    """
    Ensure the required unit exists in Tally before stock item creation.
    """
    cleaned_unit = normalize_uom(unit_name)
    if not cleaned_unit:
        return False, "Unit name missing"

    if query_tally_unit(cleaned_unit, company_name):
        return True, ""

    print(f"Creating missing Tally unit: {cleaned_unit}")
    created, response_text = create_tally_unit(cleaned_unit, company_name)
    if created:
        return True, ""

    error_detail = extract_tally_error(response_text).upper()
    if "ALREADY EXISTS" in error_detail or "DUPLICATE" in error_detail:
        return True, ""
    return False, extract_tally_error(response_text)


def ensure_tally_stock_group(group_name, company_name):
    """
    Ensure the target stock group exists. If the configured group is missing,
    fall back to a reusable app-created stock group.
    """
    desired_group = str(group_name or "").strip()
    fallback_group = str(APP_CREATED_STOCK_GROUP_NAME or "").strip()

    if desired_group and query_tally_stock_group(desired_group, company_name):
        return True, "", desired_group, False

    if fallback_group and query_tally_stock_group(fallback_group, company_name):
        return True, "", fallback_group, desired_group.upper() != fallback_group.upper()

    group_to_create = fallback_group or desired_group
    if not group_to_create:
        return False, "Stock group name missing", "", False

    print(f"Creating missing Tally stock group: {group_to_create}")
    created, response_text = create_tally_stock_group(group_to_create, company_name)
    if not created:
        return False, extract_tally_error(response_text), "", False

    used_fallback = bool(desired_group and group_to_create.upper() != desired_group.upper())
    return True, "", group_to_create, used_fallback


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
        if str(line.get("lineType") or "").strip().upper() == "SERVICE":
            continue

        item_name = normalize_stock_item_name_for_tally(line.get("itemName") or f"Line {index}")
        line["itemName"] = item_name
        app_uom = normalize_uom(line.get("uom"))
        master_uom = normalize_uom(line.get("masterUom"))
        tally_item = query_tally_stock_item_details(item_name, company_name)
        raw_tally_uom = tally_item.get("baseUnit")
        tally_uom = normalize_uom(raw_tally_uom) if is_usable_tally_uom(raw_tally_uom) else ""

        if tally_item.get("exists") and tally_uom:
            line["uom"] = tally_uom
            print(f"UOM resolved from Tally for {item_name}: {tally_uom}")
            continue

        if tally_item.get("exists"):
            if raw_tally_uom and not tally_uom:
                print(
                    f"Tally item found with unusable base unit for {item_name}: "
                    f"{clean_tally_text(raw_tally_uom)}"
                )
            if app_uom:
                line["uom"] = app_uom
                print(
                    f"Tally item found without readable base unit for {item_name}. "
                    f"Using app UOM: {app_uom}"
                )
                continue

            if master_uom:
                line["uom"] = master_uom
                print(
                    f"Tally item found without readable base unit for {item_name}. "
                    f"Using current master UOM: {master_uom}"
                )
                continue

            errors.append(
                f"{item_name}: app UOM missing, master UOM missing, and existing Tally stock item has no readable base unit"
            )
            continue

        if app_uom:
            line["uom"] = app_uom
            print(f"Tally item not found for {item_name}. Using app UOM: {app_uom}")
            continue

        if master_uom:
            line["uom"] = master_uom
            print(f"Tally item not found for {item_name}. Using current master UOM: {master_uom}")
            continue

        errors.append(f"{item_name}: app UOM missing, master UOM missing, and Tally stock item not found")

    return errors


def create_tally_stock_item(item_name, item_erp, uom, company_name, stock_group_name):
    """
    Create a stock item in Tally under the configured stock group.
    """
    candidate_uoms = get_tally_uom_candidates(uom)
    last_response_text = ""

    for base_unit in candidate_uoms:
        unit_ready, unit_error = ensure_tally_unit(base_unit, company_name)
        if not unit_ready:
            return False, unit_error, base_unit

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
        if "ALREADY EXISTS" in error_detail or "DUPLICATE" in error_detail:
            print(f"Tally reported existing stock item during create attempt: {item_name}")
            return True, response_text, base_unit
        if "UNIT" in error_detail and ("DOES NOT EXIST" in error_detail or "NOT FOUND" in error_detail):
            unit_ready, unit_error = ensure_tally_unit(base_unit, company_name)
            if unit_ready:
                print(f"Tally unit {base_unit} created/reconfirmed. Retrying stock item: {item_name}")
                continue
            return False, unit_error, base_unit
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
        if str(line.get("lineType") or "").strip().upper() == "SERVICE":
            continue

        item_name = normalize_stock_item_name_for_tally(line.get("itemName") or "")
        line["itemName"] = item_name
        item_erp = (line.get("itemErp") or "").strip()
        uom = (line.get("uom") or "").strip()
        material_type = line.get("mrrType")
        requested_stock_group_name = get_stock_group_name(material_type)
        tally_item = query_tally_stock_item_details(item_name, company_name)
        raw_tally_uom = tally_item.get("baseUnit")
        usable_tally_uom = normalize_uom(raw_tally_uom) if is_usable_tally_uom(raw_tally_uom) else ""

        if not item_name:
            return False, "Stock item name missing", created_items

        if tally_item.get("exists") and usable_tally_uom:
            continue

        if tally_item.get("exists") and raw_tally_uom and not usable_tally_uom:
            print(
                f"Existing Tally stock item is not reliable for posting, so create will be attempted: "
                f"{item_name} | baseUnit={clean_tally_text(raw_tally_uom)}"
            )

        if not item_erp:
            return False, f"{item_name}: item ERP missing", created_items

        stock_group_ready, stock_group_error, stock_group_name, used_fallback_group = ensure_tally_stock_group(
            requested_stock_group_name,
            company_name,
        )
        if not stock_group_ready:
            return False, stock_group_error, created_items

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
        if used_fallback_group:
            created_items.append(f"{item_name} [{item_erp}] under stock group {stock_group_name}")
        else:
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
                narration_text = build_mrr_narration(conn, mrr)

                print(
                    f"\nProcessing Material In ID: {material_in_id} | "
                    f"MRR No: {mrr_reference} | "
                    f"Supplier: {supplier_log_name}"
                )
                print(
                    "Header -> "
                    f"mrrType={mrr_type or 'Unknown'}, "
                    f"invoiceNo={str(mrr.get('invoiceNo') or '').strip()}, "
                    f"invoiceDate={format_narration_date(mrr.get('invDate') or mrr.get('date'))}, "
                    f"insurance={round2(mrr.get('insurance'))}, "
                    f"otherCharges={round2(mrr.get('otherCharges'))}, "
                    f"expenseCGST={round2(mrr.get('expenseCGST'))}, "
                    f"expenseSGST={round2(mrr.get('expenseSGST'))}, "
                    f"expenseIGST={round2(mrr.get('expenseIGST'))}, "
                    f"roundOff={round2(mrr.get('roundOff'))}, "
                    f"totalCgst={round2(mrr.get('totalCgst'))}, "
                    f"totalSgst={round2(mrr.get('totalSgst'))}, "
                    f"totalIgst={round2(mrr.get('totalIgst'))}, "
                    f"totalAmount={round2(mrr.get('totalAmount'))}"
                )
                if narration_text:
                    print(f"Narration -> {narration_text}")

                if not supplier_name:
                    remark = "Supplier/customer not found in suppliers or companies table"
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

                    duplicate_found, duplicate_voucher, duplicate_response = query_tally_duplicate_purchase_voucher(
                        company_name,
                        supplier_name,
                        mrr.get("invoiceNo"),
                        mrr.get("invDate") or mrr.get("date"),
                    )
                    duplicate_query_error = extract_tally_error(duplicate_response) if duplicate_response else ""
                    if (
                        duplicate_response
                        and "<LINEERROR>" in duplicate_response.upper()
                        and not duplicate_found
                    ):
                        tally_response = f"Duplicate invoice check failed: {duplicate_query_error}"
                        if "SVCurrentCompany" in tally_response:
                            continue
                        print(tally_response)
                        break
                    if duplicate_found:
                        duplicate_voucher_no = duplicate_voucher.get("voucherNumber") or "-"
                        duplicate_reference = duplicate_voucher.get("reference") or str(mrr.get("invoiceNo") or "").strip() or "-"
                        duplicate_reference_date = duplicate_voucher.get("referenceDate") or format_tally_date(mrr.get("invDate") or mrr.get("date"))
                        duplicate_master_id = duplicate_voucher.get("masterId") or "-"
                        tally_response = (
                            "Duplicate invoice already exists in Tally for same supplier and invoice date. "
                            f"Company={company_name}, "
                            f"Reference={duplicate_reference}, "
                            f"ReferenceDate={duplicate_reference_date}, "
                            f"VoucherNo={duplicate_voucher_no}, "
                            f"MasterID={duplicate_master_id}"
                        )
                        print(tally_response)
                        break

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
                        company_name=company_name,
                        narration_text=narration_text,
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
    setup_run_logging()
    try:
        sync_mrr_to_tally()
    except Exception:
        traceback_text = traceback.format_exc()
        print("\nFatal error while running MRR sync:")
        print(traceback_text)
        raise
