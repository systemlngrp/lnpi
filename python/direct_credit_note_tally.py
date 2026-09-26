"""Post pending Direct Credit Notes to the active company in Tally on port 9000."""

from datetime import datetime
from decimal import Decimal
from pathlib import Path
import html
import xml.etree.ElementTree as ET

import mysql.connector
import requests

from mrrCreditNote import (
    CGST_LEDGER_NAME, CGST_LEDGER_PREFIX,
    SGST_LEDGER_NAME, SGST_LEDGER_PREFIX,
    IGST_LEDGER_NAME, IGST_LEDGER_PREFIX,
    ROUND_OFF_LEDGER_NAME,
    CreditNoteLine,
    derive_tax_rate,
    resolve_sales_ledger_name,
    resolve_tax_ledger_name,
    round_money,
    to_decimal,
)


# Fixed connection settings requested for this standalone script.
DB_CONFIG = {
    "host": "193.203.184.152",
    "user": "u380633007_lnpidata",
    "password": "!Office1@",
    "database": "u380633007_lnpidata",
    "port": 3306,
}

TALLY_URL = "http://127.0.0.1:9004"

ROUND_OFF_LEDGER = ROUND_OFF_LEDGER_NAME

XML_DIR = Path(__file__).resolve().parents[1] / "direct_credit_note_tally_xml"
XML_DIR.mkdir(exist_ok=True)


def esc(value):
    return html.escape(str(value or ""), quote=True)


def money(value):
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def tally_date(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%Y%m%d")
    except ValueError:
        return datetime.now().strftime("%Y%m%d")


def ledger_entry(name, amount, debit):
    amount = money(amount)
    signed_amount = amount if debit else -amount
    return f"""
    <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>{esc(name)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>{'Yes' if debit else 'No'}</ISDEEMEDPOSITIVE>
        <AMOUNT>{signed_amount:.2f}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>"""


def resolve_note_ledgers(note):
    """Apply MRR ledger rules to a direct note's single taxable amount."""
    gst_rate = to_decimal(note.get("gstRate"))
    if gst_rate <= 0:
        taxable = to_decimal(note.get("amount"))
        tax = sum((to_decimal(note.get(key)) for key in
                   ("cgstAmount", "sgstAmount", "igstAmount")), Decimal("0"))
        if taxable:
            gst_rate = round_money(tax * Decimal("100") / taxable)
    lines = [CreditNoteLine("", Decimal("1"), to_decimal(note.get("amount")), gst_rate)]
    return (
        resolve_sales_ledger_name(lines),
        resolve_tax_ledger_name(CGST_LEDGER_PREFIX, derive_tax_rate(lines, "cgst"), CGST_LEDGER_NAME),
        resolve_tax_ledger_name(SGST_LEDGER_PREFIX, derive_tax_rate(lines, "sgst"), SGST_LEDGER_NAME),
        resolve_tax_ledger_name(IGST_LEDGER_PREFIX, derive_tax_rate(lines, "igst"), IGST_LEDGER_NAME),
    )


def build_xml(note):
    item_name = str(note.get("itemName") or "").strip()
    item_erp = str(note.get("itemErp") or "").strip()
    item_reference = f"{item_name} (ERP: {item_erp})" if item_erp else item_name

    sales_ledger, cgst_ledger, sgst_ledger, igst_ledger = resolve_note_ledgers(note)
    entries = [
        ledger_entry(note["companyName"], note["grandTotal"], True),
        ledger_entry(sales_ledger, note["amount"], False),
    ]

    if money(note["cgstAmount"]):
        entries.append(ledger_entry(cgst_ledger, note["cgstAmount"], False))
    if money(note["sgstAmount"]):
        entries.append(ledger_entry(sgst_ledger, note["sgstAmount"], False))
    if money(note["igstAmount"]):
        entries.append(ledger_entry(igst_ledger, note["igstAmount"], False))
    if money(note["roundOff"]):
        entries.append(ledger_entry(ROUND_OFF_LEDGER, abs(money(note["roundOff"])), money(note["roundOff"]) < 0))

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>Vouchers</REPORTNAME>
      <STATICVARIABLES />
    </REQUESTDESC>
    <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER ACTION="Create" VCHTYPE="Credit Note" OBJVIEW="Accounting Voucher View">
        <DATE>{tally_date(note["createdAt"])}</DATE>
        <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
        <VOUCHERNUMBER>{esc(note["creditNoteNo"])}</VOUCHERNUMBER>
        <REFERENCE>{esc(note["invoiceNo"])}</REFERENCE>
        <NARRATION>Direct Credit Note {esc(note["creditNoteNo"])}; Item: {esc(item_reference)}; PO {esc(note["poNumber"])}</NARRATION>
        <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
        <ISINVOICE>Yes</ISINVOICE>
        {''.join(entries)}
      </VOUCHER>
    </TALLYMESSAGE></REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>'''


def pending_notes(connection):
    cursor = connection.cursor(dictionary=True)
    cursor.execute("""
        SELECT dcn.*, c.name AS companyName, m.name AS itemName, m.erpCode AS itemErp
        FROM direct_credit_notes dcn
        LEFT JOIN companies c ON c.id = dcn.companyId
        LEFT JOIN materials m ON m.id = dcn.materialId
        WHERE dcn.status = 'Pending Tally'
          AND (dcn.tallyTimestamp IS NULL OR dcn.tallyTimestamp = '')
        ORDER BY dcn.createdAt ASC
    """)
    rows = cursor.fetchall()
    cursor.close()
    return rows


def saved_voucher_id(response_text):
    """Require a confirmed creation and a usable Tally voucher ID."""
    root = ET.fromstring(response_text.lstrip("\ufeff").strip())
    for element in root.iter("LINEERROR"):
        raise RuntimeError(element.text or "Tally import failed")
    for tag in ("ERRORS", "EXCEPTIONS", "IGNORED", "CANCELLED"):
        if int(root.findtext(f".//{tag}", "0")) != 0:
            raise RuntimeError(f"Tally import failed: {tag}. {response_text[:700]}")
    if int(root.findtext(".//CREATED", "0")) != 1:
        raise RuntimeError(f"Tally did not confirm creation. {response_text[:700]}")
    voucher_id = int(root.findtext(".//LASTVCHID", "0"))
    if voucher_id <= 0:
        raise RuntimeError("Tally reported creation but returned no valid LASTVCHID; check Tally before retrying.")
    return voucher_id


def ensure_voucher_id_column(connection):
    cursor = connection.cursor()
    try:
        try:
            cursor.execute("ALTER TABLE direct_credit_notes ADD COLUMN tallyVoucherId BIGINT NULL")
            connection.commit()
        except mysql.connector.Error as error:
            if error.errno != 1060:  # Column already exists.
                raise
    finally:
        cursor.close()


def update_status(connection, note_id, status, remark, voucher_id=None):
    if status == "Posted" and (voucher_id is None or int(voucher_id) <= 0):
        raise ValueError("Cannot mark Posted without a confirmed Tally voucher ID")
    if not connection.is_connected():
        connection.reconnect(attempts=3, delay=2)
    now = datetime.now().isoformat(timespec="seconds")
    cursor = connection.cursor()
    cursor.execute("""
        UPDATE direct_credit_notes
        SET status = %s, tallyTimestamp = %s, tallyPostedBy = %s,
            tallyPostingRemark = %s, updateTimestamp = %s,
            tallyVoucherId = COALESCE(%s, tallyVoucherId)
        WHERE id = %s
    """, (status, now if status == "Posted" else None,
          "Python Tally Poster" if status == "Posted" else None,
          remark[:1000], now, voucher_id, note_id))
    connection.commit()
    cursor.close()


def main():
    print("Direct Credit Note sync: connecting to database...", flush=True)
    connection = mysql.connector.connect(**DB_CONFIG)
    try:
        ensure_voucher_id_column(connection)
        notes = pending_notes(connection)
        if not notes:
            print("No pending Direct Credit Notes found. Only status='Pending Tally' "
                  "with an empty tallyTimestamp is selected. No vouchers sent to Tally.")
            return
        print(f"Found {len(notes)} pending Direct Credit Note(s). Tally: {TALLY_URL}", flush=True)
        for note in notes:
            number = note["creditNoteNo"]
            print(f"Processing: {number}", flush=True)
            try:
                xml = build_xml(note)
                safe_name = str(number).replace("/", "_")
                (XML_DIR / f"{safe_name}.xml").write_text(xml, encoding="utf-8")
                response = requests.post(TALLY_URL, data=xml.encode(), headers={"Content-Type": "application/xml"}, timeout=30)
                response.raise_for_status()
                voucher_id = saved_voucher_id(response.text)
            except Exception as error:
                update_status(connection, note["id"], "Pending Tally", f"Tally posting failed: {error}")
                print(f"Failed: {number} - {error}")
                continue
            # Keep DB-save errors separate: Tally has already created the voucher.
            try:
                update_status(connection, note["id"], "Posted",
                              f"Posted to Tally. Voucher ID: {voucher_id}. {response.text[:500]}", voucher_id)
            except Exception as error:
                raise RuntimeError(
                    f"Tally saved {number} with voucher ID {voucher_id}, but the DB update failed. "
                    "Reconcile this ID in the database before rerunning."
                ) from error
            print(f"Posted: {number} - Tally voucher ID: {voucher_id}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
