import argparse
import html
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import mysql.connector
import requests


BASE_DIR = Path(__file__).resolve().parents[1]
TALLY_URL = os.getenv("LNPI_TALLY_URL", "http://localhost:9004")
COMPANY_NAME = os.getenv("LNPI_TALLY_COMPANY", "")
TALLY_ACTION = os.getenv("LNPI_TALLY_ACTION", "Create")
REQUEST_TIMEOUT = 30

DEFAULT_PURCHASE_RETURN_LEDGER = os.getenv("LNPI_DEBIT_PURCHASE_LEDGER", "Purchase Return")
DEFAULT_CGST_LEDGER = os.getenv("LNPI_CGST_LEDGER", "Input CGST")
DEFAULT_SGST_LEDGER = os.getenv("LNPI_SGST_LEDGER", "Input SGST")
DEFAULT_IGST_LEDGER = os.getenv("LNPI_IGST_LEDGER", "Input IGST")

MONEY_Q = Decimal("0.01")


@dataclass
class DebitNoteLine:
    item_name: str
    qty: Decimal
    rate: Decimal
    unit: str = "KGS"

    @property
    def amount(self) -> Decimal:
        return round_money(self.qty * self.rate)


@dataclass
class DebitNote:
    mrr_id: str
    mrr_no: str
    voucher_no: str
    date: str
    supplier_ledger: str
    purchase_return_ledger: str
    cgst_ledger: str
    sgst_ledger: str
    igst_ledger: str
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    line: DebitNoteLine
    narration: str = ""

    @property
    def total_amount(self) -> Decimal:
        return round_money(self.line.amount + self.cgst_amount + self.sgst_amount + self.igst_amount)


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


def get_db_config() -> dict[str, Any]:
    load_env_file()
    config = {
        "host": os.getenv("LNPI_DB_HOST") or os.getenv("DB_HOST"),
        "user": os.getenv("LNPI_DB_USER") or os.getenv("DB_USER"),
        "password": os.getenv("LNPI_DB_PASSWORD") or os.getenv("DB_PASSWORD"),
        "database": os.getenv("LNPI_DB_NAME") or os.getenv("DB_NAME"),
        "port": int(os.getenv("LNPI_DB_PORT") or os.getenv("DB_PORT") or "3306"),
        "use_pure": True,
    }
    missing = [key for key in ("host", "user", "password", "database") if not config.get(key)]
    if missing:
        raise RuntimeError(
            "Missing DB config: "
            + ", ".join(missing)
            + ". Set LNPI_DB_HOST, LNPI_DB_USER, LNPI_DB_PASSWORD, LNPI_DB_NAME in D:\\lnpi\\.env or PowerShell env."
        )
    return config


def esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=False)


def to_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def round_money(value: Any) -> Decimal:
    return to_decimal(value).quantize(MONEY_Q, rounding=ROUND_HALF_UP)


def money(value: Any) -> str:
    return f"{round_money(value):.2f}"


def normalize_date_for_tally(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return datetime.now().strftime("%Y%m%d")
    if re.fullmatch(r"\d{8}", text):
        return text
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt).strftime("%Y%m%d")
        except ValueError:
            pass
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        return "".join(match.groups())
    return datetime.now().strftime("%Y%m%d")


def get_db_connection():
    config = get_db_config()
    try:
        return mysql.connector.connect(**config)
    except mysql.connector.Error as error:
        raise RuntimeError(
            f"Cannot connect Hostinger MySQL {config['host']}:{config['port']} DB={config['database']} USER={config['user']}. Error: {error}"
        ) from error


def parse_lines(raw_lines: Any) -> list[dict[str, Any]]:
    if isinstance(raw_lines, list):
        return raw_lines
    if not raw_lines:
        return []
    try:
        parsed = json.loads(raw_lines)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def resolve_party_name(conn, supplier_id: str) -> str:
    cursor = conn.cursor(dictionary=True)
    try:
        for table in ("suppliers", "companies"):
            cursor.execute(f"SELECT `name` FROM `{table}` WHERE `id` = %s LIMIT 1", (supplier_id,))
            row = cursor.fetchone()
            name = str((row or {}).get("name") or "").strip()
            if name:
                return name
    finally:
        cursor.close()
    return supplier_id


def resolve_material_name(conn, material_id: str) -> str:
    if not material_id:
        return ""
    cursor = conn.cursor(dictionary=True)
    try:
        for table in ("materials", "items", "npd", "php_item_master", "plate_item_master"):
            try:
                cursor.execute(f"SELECT `name` FROM `{table}` WHERE `id` = %s LIMIT 1", (material_id,))
                row = cursor.fetchone()
                name = str((row or {}).get("name") or "").strip()
                if name:
                    return name
            except mysql.connector.Error:
                continue
    finally:
        cursor.close()
    return material_id


def get_pending_debit_note_row(conn, debit_note_no: str | None = None, mrr_no: str | None = None) -> dict[str, Any] | None:
    cursor = conn.cursor(dictionary=True)
    where = ["`debitNote` IS NOT NULL", "`debitNote` <> ''"]
    params: list[Any] = []
    if debit_note_no:
        where.append("`debitNote` = %s")
        params.append(debit_note_no)
    if mrr_no:
        where.append("`transactionNo` = %s")
        params.append(mrr_no)

    query = f"""
        SELECT `id`, `transactionNo`, `mrrType`, `date`, `timestamp`, `invoiceNo`, `invDate`,
               `supplierId`, `lines`, `debitNote`, `debitNoteDate`, `debitNoteAmount`,
               `totalCgst`, `totalSgst`, `totalIgst`, `tallyTimestamp`
        FROM `material_in`
        WHERE {' AND '.join(where)}
        ORDER BY `debitNoteDate` ASC, `timestamp` ASC, `transactionNo` ASC
        LIMIT 1
    """
    try:
        cursor.execute(query, tuple(params))
        return cursor.fetchone()
    finally:
        cursor.close()


def select_debit_line(lines: list[dict[str, Any]]) -> dict[str, Any]:
    if not lines:
        raise RuntimeError("MRR has no material lines.")
    best_line = lines[0]
    best_diff = Decimal("0")
    for line in lines:
        invoice_qty = to_decimal(line.get("invoiceQty") or line.get("invQty") or line.get("invoiceQuantity"))
        actual_qty = to_decimal(line.get("actualQty") or line.get("qty"))
        diff = invoice_qty - actual_qty
        if diff > best_diff:
            best_diff = diff
            best_line = line
    best_line = dict(best_line)
    if best_diff > 0:
        best_line["_debit_qty"] = best_diff
    return best_line


def build_note_from_db_row(conn, row: dict[str, Any]) -> DebitNote:
    lines = parse_lines(row.get("lines"))
    line = select_debit_line(lines)
    supplier_name = resolve_party_name(conn, str(row.get("supplierId") or ""))
    material_name = first_non_empty(
        line.get("materialName"), line.get("itemName"), line.get("name"), line.get("description"),
        resolve_material_name(conn, str(line.get("materialId") or line.get("itemId") or "")),
    )
    qty = to_decimal(line.get("_debit_qty"))
    if qty <= 0:
        qty = to_decimal(line.get("actualQty") or line.get("qty") or line.get("invoiceQty"))
    rate = to_decimal(line.get("invoiceRate") or line.get("rate") or line.get("poRate"))
    unit = first_non_empty(line.get("uom"), line.get("unit"), "KGS")
    taxable_amount = round_money(qty * rate)

    db_debit_amount = round_money(row.get("debitNoteAmount"))
    invoice_base = sum(
        round_money(to_decimal(l.get("invoiceQty") or l.get("qty")) * to_decimal(l.get("invoiceRate") or l.get("rate") or l.get("poRate")))
        for l in lines
    )
    cgst_amount = Decimal("0")
    sgst_amount = Decimal("0")
    igst_amount = Decimal("0")
    if invoice_base > 0:
        cgst_amount = round_money(taxable_amount * round_money(row.get("totalCgst")) / invoice_base)
        sgst_amount = round_money(taxable_amount * round_money(row.get("totalSgst")) / invoice_base)
        igst_amount = round_money(taxable_amount * round_money(row.get("totalIgst")) / invoice_base)
    if cgst_amount == 0 and sgst_amount == 0 and igst_amount == 0 and db_debit_amount > taxable_amount:
        tax_diff = db_debit_amount - taxable_amount
        cgst_amount = round_money(tax_diff / 2)
        sgst_amount = round_money(tax_diff - cgst_amount)

    return DebitNote(
        mrr_id=str(row.get("id") or ""),
        mrr_no=str(row.get("transactionNo") or ""),
        voucher_no=str(row.get("debitNote") or ""),
        date=normalize_date_for_tally(row.get("debitNoteDate") or row.get("date") or row.get("timestamp")),
        supplier_ledger=supplier_name,
        purchase_return_ledger=DEFAULT_PURCHASE_RETURN_LEDGER,
        cgst_ledger=DEFAULT_CGST_LEDGER,
        sgst_ledger=DEFAULT_SGST_LEDGER,
        igst_ledger=DEFAULT_IGST_LEDGER,
        cgst_amount=cgst_amount,
        sgst_amount=sgst_amount,
        igst_amount=igst_amount,
        line=DebitNoteLine(item_name=material_name, qty=qty, rate=rate, unit=unit),
        narration=f"Debit Note {row.get('debitNote')} against MRR {row.get('transactionNo')} Invoice {row.get('invoiceNo') or ''}".strip(),
    )


def build_company_xml() -> str:
    if not COMPANY_NAME.strip():
        return ""
    return f"""
          <STATICVARIABLES>
            <SVCURRENTCOMPANY>{esc(COMPANY_NAME)}</SVCURRENTCOMPANY>
          </STATICVARIABLES>"""


def build_debit_note_xml(note: DebitNote) -> str:
    qty_with_unit = f"{note.line.qty:.2f} {note.line.unit}"
    rate_with_unit = f"{note.line.rate:.2f}/{note.line.unit}"
    tax_ledgers = ""
    for ledger, amount in ((note.cgst_ledger, note.cgst_amount), (note.sgst_ledger, note.sgst_amount), (note.igst_ledger, note.igst_amount)):
        if amount:
            tax_ledgers += f"""
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{money(amount)}</AMOUNT>
            </LEDGERENTRIES.LIST>"""

    return f"""<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>{build_company_xml()}</REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Debit Note" ACTION="{esc(TALLY_ACTION)}" OBJVIEW="Invoice Voucher View">
            <DATE>{esc(note.date)}</DATE>
            <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
            <VOUCHERNUMBER>{esc(note.voucher_no)}</VOUCHERNUMBER>
            <REFERENCE>{esc(note.mrr_no)}</REFERENCE>
            <PARTYLEDGERNAME>{esc(note.supplier_ledger)}</PARTYLEDGERNAME>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <ISINVOICE>Yes</ISINVOICE>
            <NARRATION>{esc(note.narration)}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(note.supplier_ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-{money(note.total_amount)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>{esc(note.line.item_name)}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <RATE>{esc(rate_with_unit)}</RATE>
              <AMOUNT>{money(note.line.amount)}</AMOUNT>
              <ACTUALQTY>{esc(qty_with_unit)}</ACTUALQTY>
              <BILLEDQTY>{esc(qty_with_unit)}</BILLEDQTY>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>{esc(note.purchase_return_ledger)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <AMOUNT>{money(note.line.amount)}</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>{tax_ledgers}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""


def post_to_tally(xml: str) -> str:
    response = requests.post(TALLY_URL, data=xml.encode("utf-8"), headers={"Content-Type": "text/xml"}, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.text


def mark_posted(conn, note: DebitNote, response_text: str) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE `material_in`
            SET `tallyTimestamp` = %s, `tallySyncRemark` = %s
            WHERE `id` = %s
            """,
            (datetime.now().isoformat(timespec="seconds"), f"Debit Note {note.voucher_no} posted to Tally. Response: {response_text[:500]}", note.mrr_id),
        )
        conn.commit()
    finally:
        cursor.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Post MRR Debit Note from Hostinger DB to Tally")
    parser.add_argument("--debit-note", help="Debit note number, example DN-00038")
    parser.add_argument("--mrr", help="MRR transaction number")
    parser.add_argument("--dry-run", action="store_true", help="Print XML only; do not post to Tally or update DB")
    parser.add_argument("--mark-posted", action="store_true", help="After successful post, update material_in.tallyTimestamp")
    args = parser.parse_args()

    conn = get_db_connection()
    try:
        row = get_pending_debit_note_row(conn, debit_note_no=args.debit_note, mrr_no=args.mrr)
        if not row:
            print("No debit note MRR found in Hostinger DB for the given filter.")
            return
        note = build_note_from_db_row(conn, row)
        xml = build_debit_note_xml(note)
        print(f"MRR: {note.mrr_no}")
        print(f"Debit Note: {note.voucher_no}")
        print(f"Supplier: {note.supplier_ledger}")
        print(f"Item: {note.line.item_name}")
        print(f"Qty: {note.line.qty:.2f} {note.line.unit}")
        print(f"Rate: {note.line.rate:.2f}")
        print(f"Taxable: {money(note.line.amount)}")
        print(f"CGST: {money(note.cgst_amount)} SGST: {money(note.sgst_amount)} IGST: {money(note.igst_amount)}")
        print(f"Total: {money(note.total_amount)}")
        print(xml)
        if args.dry_run:
            return
        response_text = post_to_tally(xml)
        print("Tally Response:")
        print(response_text)
        if args.mark_posted:
            mark_posted(conn, note, response_text)
            print("Hostinger DB updated: material_in.tallyTimestamp set.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()