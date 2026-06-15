import os
import sys
import json
import mysql.connector
import requests
from datetime import datetime, date
import xml.sax.saxutils as saxutils
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
    "user": os.getenv('DB_USER', 'u380633007_Inpidata'),
    "password": os.getenv('DB_PASSWORD', '!Office1@'),
    "database": os.getenv('DB_NAME', 'u380633007_Inpidata'),
    "port": int(os.getenv('DB_PORT', '3306'))
}

# Tally Config from Environment
TALLY_URL = os.getenv('TALLY_URL', 'http://localhost:9000').strip()
TALLY_COMPANY_NAME = os.getenv('TALLY_COMPANY_NAME', 'Laxmi Narayan Packaging Industries')
VOUCHER_TYPE_NAME = os.getenv('VOUCHER_TYPE_NAME', 'Purchase')
PURCHASE_LEDGER_NAME = os.getenv('PURCHASE_LEDGER_NAME', 'Purchase')
INSURANCE_LEDGER_NAME = os.getenv('INSURANCE_LEDGER_NAME', 'Insurance Charges')
OTHER_CHARGES_LEDGER_NAME = os.getenv('OTHER_CHARGES_LEDGER_NAME', 'Other Charges')
CGST_LEDGER_NAME = os.getenv('CGST_LEDGER_NAME', 'Input CGST')
SGST_LEDGER_NAME = os.getenv('SGST_LEDGER_NAME', 'Input SGST')
IGST_LEDGER_NAME = os.getenv('IGST_LEDGER_NAME', 'Input IGST')
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


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


# =====================================================
# FETCH PENDING MATERIAL IN / MRR RECORDS
# =====================================================

def get_pending_mrr_rows(conn):
    """
    Fetch all material_in records where tallyTimestamp is empty.
    """

    sql = """
        SELECT *
        FROM material_in
        WHERE tallyTimestamp IS NULL
           OR tallyTimestamp = ''
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
    cursor = conn.cursor(dictionary=True)

    for line in lines:
        line_id = line.get("id")
        item_id = line.get("itemId")
        if not item_id:
            continue

        # Look up in materials table first
        cursor.execute("SELECT name FROM materials WHERE id = %s LIMIT 1", (item_id,))
        m_row = cursor.fetchone()
        
        item_name = ""
        if m_row:
            item_name = m_row.get("name")
        else:
            # Look up in npd table if not found in materials
            cursor.execute("SELECT itemName as name FROM npd WHERE id = %s LIMIT 1", (item_id,))
            n_row = cursor.fetchone()
            if n_row:
                item_name = n_row.get("name")

        # Fetch packing slips for this specific line
        packing_slips = []
        if line_id:
            cursor.execute("""
                SELECT ourReelNo, weightKg
                FROM material_in_packing_slips
                WHERE materialLineId = %s
            """, (line_id,))
            packing_slips = cursor.fetchall()

        processed_lines.append({
            "lineId": line_id,
            "itemId": item_id,
            "itemName": item_name or "Unknown Item",
            "qty": get_first_numeric(line, ["actualQty", "invoiceQty", "qty"]),
            "uom": normalize_uom(line.get("uom")),
            "rate": get_first_numeric(line, ["rate", "invoiceRate", "poRate"]),
            "cost": get_first_numeric(line, ["cost", "rate", "invoiceRate", "poRate"]),
            "amount": get_first_numeric(line, ["actualValue", "invoiceValue", "value"]),
            "packingSlips": packing_slips
        })

    cursor.close()
    return processed_lines


def validate_item_lines(item_lines):
    """
    Ensure every line has usable qty, rate, and uom before posting to Tally.
    """
    errors = []

    for index, line in enumerate(item_lines, start=1):
        item_name = line.get("itemName") or f"Line {index}"
        qty = to_float(line.get("qty"))
        rate = to_float(line.get("rate"))
        uom = (line.get("uom") or "").strip()

        if qty <= 0:
            errors.append(f"{item_name}: qty missing or zero")
        if rate <= 0:
            errors.append(f"{item_name}: rate missing or zero")
        if not uom:
            errors.append(f"{item_name}: uom missing")

    return errors


# =====================================================
# CREATE TALLY PURCHASE VOUCHER XML
# =====================================================

def create_purchase_voucher_xml(mrr, supplier_name, item_lines):
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
        packing_slips = line.get("packingSlips") or []
        qty_text = f"{qty:g} {esc(uom)}".strip()
        rate_text = f"{rate:g}/{esc(uom)}" if uom else f"{rate:g}"

        amount = round(line_amount if line_amount > 0 else qty * rate, 2)
        total_item_amount += amount

        batch_allocations_xml = ""
        if packing_slips:
            for slip in packing_slips:
                reel_no = slip.get("ourReelNo") or DEFAULT_BATCH_NAME
                reel_weight = to_float(slip.get("weightKg"))
                # Note: The sum of reel weights might differ slightly from line qty due to rounding,
                # but we use the actual reel weight for the batch allocation.
                reel_amount = round(reel_weight * rate, 2)

                batch_allocations_xml += f"""
                            <BATCHALLOCATIONS.LIST>
                                <GODOWNNAME>{esc(DEFAULT_GODOWN_NAME)}</GODOWNNAME>
                                <BATCHNAME>{esc(reel_no)}</BATCHNAME>
                                <AMOUNT>-{reel_amount:.2f}</AMOUNT>
                                <ACTUALQTY>{reel_weight:g} {esc(uom)}</ACTUALQTY>
                                <BILLEDQTY>{reel_weight:g} {esc(uom)}</BILLEDQTY>
                            </BATCHALLOCATIONS.LIST>
                """
        else:
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
                                <LEDGERNAME>{esc(PURCHASE_LEDGER_NAME)}</LEDGERNAME>
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
                    <SVCURRENTCOMPANY>{esc(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
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

            print(f"\nProcessing Material In ID: {material_in_id}")

            try:
                # Only sync if status is Pending Tally
                if mrr.get("status") != "Pending Tally":
                    print(f"Skipping: Status is {mrr.get('status')}, not Pending Tally")
                    continue

                supplier_id = mrr.get("supplierId")
                supplier_name = get_supplier_name(conn, supplier_id)

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

                line_errors = validate_item_lines(item_lines)
                if line_errors:
                    remark = " | ".join(line_errors[:10])
                    update_mrr_tally_status(conn, material_in_id, False, remark)
                    print(f"Validation failed: {remark}")
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

                tally_xml = create_purchase_voucher_xml(
                    mrr=mrr,
                    supplier_name=supplier_name,
                    item_lines=item_lines
                )

                if DEBUG_TALLY_XML:
                    print("Generated Tally XML:")
                    print(tally_xml)

                tally_response = post_to_tally(tally_xml)

                print("Tally Response:")
                print(tally_response)

                if is_tally_success(tally_response):
                    remark = "Posted successfully to Tally"
                    update_mrr_tally_status(conn, material_in_id, True, remark)
                    print(remark)
                else:
                    error_detail = extract_tally_error(tally_response)
                    update_mrr_tally_status(conn, material_in_id, False, error_detail)
                    print(f"Posting failed: {error_detail}")

            except Exception as e:
                error_message = str(e)
                update_mrr_tally_status(
                    conn,
                    material_in_id,
                    False,
                    error_message[:1000]
                )
                print(f"Error in Material In ID {material_in_id}: {error_message}")

    finally:
        conn.close()


# =====================================================
# RUN
# =====================================================

if __name__ == "__main__":
    sync_mrr_to_tally()
