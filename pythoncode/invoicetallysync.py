import os
import re
import mysql.connector
import requests
from datetime import datetime, date
import xml.sax.saxutils as saxutils
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


DB_HOST = os.getenv("DB_HOST", "193.203.184.152").strip()
if DB_HOST in (".", "localhost"):
    DB_HOST = "127.0.0.1"

DB_CONFIG = {
    "host": DB_HOST,
    "user": os.getenv("DB_USER", "u380633007_Inpidata"),
    "password": os.getenv("DB_PASSWORD", "!Office1@"),
    "database": os.getenv("DB_NAME", "u380633007_Inpidata"),
    "port": int(os.getenv("DB_PORT", "3306")),
}

TALLY_URL = os.getenv("TALLY_URL", "http://localhost:9000").strip()
TALLY_COMPANY_NAME = os.getenv("TALLY_COMPANY_NAME", "Laxmi Narayan Packaging Industries")
VOUCHER_TYPE_NAME = os.getenv("SALES_VOUCHER_TYPE_NAME", "Sales")
SALES_LEDGER_NAME = os.getenv("SALES_LEDGER_NAME", "Sales")
OTHER_CHARGES_LEDGER_NAME = os.getenv("SALES_OTHER_CHARGES_LEDGER_NAME", "Other Charges")
ROUND_OFF_LEDGER_NAME = os.getenv("SALES_ROUND_OFF_LEDGER_NAME", "Round Off")
CGST_LEDGER_NAME = os.getenv("OUTPUT_CGST_LEDGER_NAME", "Output CGST")
SGST_LEDGER_NAME = os.getenv("OUTPUT_SGST_LEDGER_NAME", "Output SGST")
IGST_LEDGER_NAME = os.getenv("OUTPUT_IGST_LEDGER_NAME", "Output IGST")
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


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def get_pending_invoice_rows(conn):
    sql = """
        SELECT *
        FROM invoices
        WHERE tallyTimestamp IS NULL
           OR tallyTimestamp = ''
    """

    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql)
    rows = cursor.fetchall()
    cursor.close()
    return rows


def get_company_name(conn, company_id):
    if not company_id:
        return ""

    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT name
        FROM companies
        WHERE id = %s
        LIMIT 1
        """,
        (company_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    return (row or {}).get("name", "")


def get_invoice_lines(conn, invoice_id):
    cursor = conn.cursor(dictionary=True)
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
                SELECT itemName
                FROM npd
                WHERE id = %s
                LIMIT 1
                """,
                (npd_id,),
            )
            npd_row = cursor.fetchone()
            if npd_row:
                item_name = npd_row.get("itemName") or ""

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


def create_sales_voucher_xml(invoice_row, customer_name, item_lines):
    invoice_no = invoice_row.get("invoiceNo") or ""
    invoice_date = format_tally_date(invoice_row.get("date"))
    customer_name = customer_name or "Unknown Customer"

    cgst = round(to_float(invoice_row.get("cgst")), 2)
    sgst = round(to_float(invoice_row.get("sgst")), 2)
    igst = round(to_float(invoice_row.get("igst")), 2)
    other_charges = round(to_float(invoice_row.get("otherCharges")), 2)
    round_off = round(to_float(invoice_row.get("roundOff")), 2)

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
                                <LEDGERNAME>{esc(SALES_LEDGER_NAME)}</LEDGERNAME>
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
                            <BILLALLOCATIONS.LIST>
                                <NAME>{esc(invoice_no)}</NAME>
                                <BILLTYPE>New Ref</BILLTYPE>
                                <AMOUNT>-{total_invoice_amount:.2f}</AMOUNT>
                            </BILLALLOCATIONS.LIST>
                        </LEDGERENTRIES.LIST>
    """

    if cgst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(CGST_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{cgst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if sgst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(SGST_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <AMOUNT>{sgst:.2f}</AMOUNT>
                        </LEDGERENTRIES.LIST>
        """

    if igst > 0:
        ledger_entries_xml += f"""
                        <LEDGERENTRIES.LIST>
                            <LEDGERNAME>{esc(IGST_LEDGER_NAME)}</LEDGERNAME>
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
                        <VOUCHERTYPENAME>{esc(VOUCHER_TYPE_NAME)}</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>{esc(invoice_no)}</VOUCHERNUMBER>
                        <REFERENCE>{esc(invoice_no)}</REFERENCE>
                        <PARTYLEDGERNAME>{esc(customer_name)}</PARTYLEDGERNAME>
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


def post_to_tally(xml_data):
    response = requests.post(
        TALLY_URL,
        data=xml_data.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
        timeout=30,
    )
    return response.text


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


def update_invoice_tally_status(conn, invoice_id, success, remark, tally_by=None):
    cursor = conn.cursor()
    if success:
        cursor.execute(
            """
            UPDATE invoices
            SET
                tallyTimestamp = %s,
                tallyBy = %s,
                tallySyncRemark = %s
            WHERE id = %s
            """,
            (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                tally_by or DEFAULT_UPDATED_BY,
                remark,
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
        pending_invoice_rows = get_pending_invoice_rows(conn)

        print("==========================================")
        print(f"Pending invoices found: {len(pending_invoice_rows)}")
        print("==========================================")

        for invoice_row in pending_invoice_rows:
            invoice_id = invoice_row.get("id")
            invoice_no = invoice_row.get("invoiceNo")

            print(f"\nProcessing Invoice ID: {invoice_id} | Invoice No: {invoice_no}")

            try:
                company_name = get_company_name(conn, invoice_row.get("companyId"))
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

                tally_xml = create_sales_voucher_xml(invoice_row, company_name, item_lines)

                if DEBUG_TALLY_XML:
                    print("Generated Tally XML:")
                    print(tally_xml)

                tally_response = post_to_tally(tally_xml)

                print("Tally Response:")
                print(tally_response)

                if is_tally_success(tally_response):
                    remark = "Posted successfully to Tally"
                    update_invoice_tally_status(
                        conn,
                        invoice_id,
                        True,
                        remark,
                        invoice_row.get("updatedBy") or DEFAULT_UPDATED_BY,
                    )
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
