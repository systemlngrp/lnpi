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
from requests import exceptions as requests_exceptions


BASE_DIR = Path(__file__).resolve().parents[1]
REQUEST_TIMEOUT = 30
MONEY_Q = Decimal("0.01")


class TallyUnavailableError(RuntimeError):
    pass


class TallyImportError(RuntimeError):
    pass


@dataclass
class CreditNoteLine:
    item_name: str
    qty: Decimal
    rate: Decimal
    unit: str = "NOS"

    @property
    def amount(self) -> Decimal:
        return round_money(self.qty * self.rate)


@dataclass
class CreditNote:
    mrr_id: str
    mrr_no: str
    date: str
    invoice_no: str
    party_ledger: str
    sales_return_ledger: str
    cgst_ledger: str
    sgst_ledger: str
    igst_ledger: str
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    lines: list[CreditNoteLine]
    narration: str

    @property
    def taxable_amount(self) -> Decimal:
        return round_money(sum((line.amount for line in self.lines), Decimal("0")))

    @property
    def total_amount(self) -> Decimal:
        return round_money(self.taxable_amount + self.cgst_amount + self.sgst_amount + self.igst_amount)


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

COMPANY_NAME = os.getenv("LNPI_TALLY_COMPANY", "")
TALLY_ACTION = os.getenv("LNPI_TALLY_ACTION", "Create")
DEFAULT_SALES_RETURN_LEDGER = "Sales A/C"
DEFAULT_CGST_LEDGER = os.getenv("LNPI_CGST_LEDGER", "Input CGST")
DEFAULT_SGST_LEDGER = os.getenv("LNPI_SGST_LEDGER", "Input SGST")
DEFAULT_IGST_LEDGER = os.getenv("LNPI_IGST_LEDGER", "Input IGST")


def build_tally_url_candidates() -> list[str]:
    candidates: list[str] = []
    preferred = (
        os.getenv("LNPI_TALLY_URL"),
        os.getenv("TALLY_URL"),
        "http://localhost:9004",
        "http://127.0.0.1:9004",
    )
    for url in preferred:
        cleaned = str(url or "").strip()
        if cleaned and cleaned not in candidates:
            candidates.append(cleaned)
    return candidates


TALLY_URL_CANDIDATES = build_tally_url_candidates()
ACTIVE_TALLY_URL: str | None = None


def get_db_config() -> dict[str, Any]:
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


def get_db_connection():
    config = get_db_config()
    try:
        return mysql.connector.connect(**config)
    except mysql.connector.Error as error:
        raise RuntimeError(
            f"Cannot connect Hostinger MySQL {config['host']}:{config['port']} DB={config['database']} USER={config['user']}. Error: {error}"
        ) from error


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


def resolve_party_name(conn, party_id: str) -> str:
    cursor = conn.cursor(dictionary=True)
    try:
        for table in ("suppliers", "companies"):
            cursor.execute(f"SELECT `name` FROM `{table}` WHERE `id` = %s LIMIT 1", (party_id,))
            row = cursor.fetchone()
            name = str((row or {}).get("name") or "").strip()
            if name:
                return name
    finally:
        cursor.close()
    return party_id


def resolve_item_name(conn, line: dict[str, Any]) -> str:
    direct_name = first_non_empty(line.get("itemName"), line.get("materialName"), line.get("name"), line.get("description"))
    if direct_name:
        return direct_name

    item_id = str(line.get("itemId") or line.get("materialId") or line.get("npdId") or "").strip()
    if not item_id:
        return "FG Item"

    cursor = conn.cursor(dictionary=True)
    try:
        for table in ("items", "npd", "php_item_master", "plate_item_master", "materials"):
            try:
                cursor.execute(f"SELECT `name` FROM `{table}` WHERE `id` = %s LIMIT 1", (item_id,))
                row = cursor.fetchone()
                name = str((row or {}).get("name") or "").strip()
                if name:
                    return name
            except mysql.connector.Error:
                continue
    finally:
        cursor.close()
    return item_id



def ensure_credit_tracking_columns(conn) -> None:
    cursor = conn.cursor()
    try:
        for column, column_type in (("creditTallySync", "VARCHAR(255)"), ("creditRemarkTally", "TEXT")):
            try:
                cursor.execute(f"ALTER TABLE `material_in` ADD COLUMN `{column}` {column_type}")
                conn.commit()
                print(f"Hostinger DB updated: material_in.{column} column added.")
            except mysql.connector.Error as error:
                if getattr(error, "errno", None) == 1060:
                    continue
                raise
    finally:
        cursor.close()
def get_pending_credit_note_rows(conn, mrr_no: str | None = None, limit: int = 1) -> list[dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    where = [
        "`mrrType` = 'FG Purchase'",
        "COALESCE(NULLIF(TRIM(`creditTallySync`), ''), '') = ''",
    ]
    params: list[Any] = []
    if mrr_no:
        where.append("`transactionNo` = %s")
        params.append(mrr_no)

    query = f"""
        SELECT `id`, `transactionNo`, `mrrType`, `date`, `timestamp`, `invoiceNo`, `invDate`,
               `supplierId`, `lines`, `totalCgst`, `totalSgst`, `totalIgst`, `creditTallySync`, `creditRemarkTally`
        FROM `material_in`
        WHERE {' AND '.join(where)}
        ORDER BY `date` ASC, `timestamp` ASC, `transactionNo` ASC
        LIMIT %s
    """
    params.append(max(1, int(limit or 1)))
    try:
        cursor.execute(query, tuple(params))
        return list(cursor.fetchall() or [])
    finally:
        cursor.close()


def build_note_lines(conn, raw_lines: list[dict[str, Any]]) -> list[CreditNoteLine]:
    note_lines: list[CreditNoteLine] = []
    for line in raw_lines:
        qty = to_decimal(line.get("actualQty") or line.get("qty") or line.get("invoiceQty"))
        rate = to_decimal(line.get("invoiceRate") or line.get("rate") or line.get("poRate"))
        if qty <= 0 or rate <= 0:
            continue
        note_lines.append(
            CreditNoteLine(
                item_name=resolve_item_name(conn, line),
                qty=qty,
                rate=rate,
                unit=first_non_empty(line.get("uom"), line.get("unit"), "NOS"),
            )
        )
    if not note_lines:
        raise RuntimeError("FG Purchase MRR has no valid positive-quantity/rate lines for Credit Note.")
    return note_lines


def build_note_from_db_row(conn, row: dict[str, Any]) -> CreditNote:
    lines = build_note_lines(conn, parse_lines(row.get("lines")))
    party_name = resolve_party_name(conn, str(row.get("supplierId") or ""))
    return CreditNote(
        mrr_id=str(row.get("id") or ""),
        mrr_no=str(row.get("transactionNo") or ""),
        date=normalize_date_for_tally(row.get("date") or row.get("timestamp") or row.get("invDate")),
        invoice_no=str(row.get("invoiceNo") or ""),
        party_ledger=party_name,
        sales_return_ledger=DEFAULT_SALES_RETURN_LEDGER,
        cgst_ledger=DEFAULT_CGST_LEDGER,
        sgst_ledger=DEFAULT_SGST_LEDGER,
        igst_ledger=DEFAULT_IGST_LEDGER,
        cgst_amount=round_money(row.get("totalCgst")),
        sgst_amount=round_money(row.get("totalSgst")),
        igst_amount=round_money(row.get("totalIgst")),
        lines=lines,
        narration=f"Credit Note against FG Purchase MRR {row.get('transactionNo')} Invoice {row.get('invoiceNo') or ''}".strip(),
    )


def build_company_xml() -> str:
    if not COMPANY_NAME.strip():
        return ""
    return f"""
          <STATICVARIABLES>
            <SVCURRENTCOMPANY>{esc(COMPANY_NAME)}</SVCURRENTCOMPANY>
          </STATICVARIABLES>"""


def build_line_narration(note: CreditNote) -> str:
    return "; ".join(f"{line.item_name} {line.qty:.2f} {line.unit} @ {line.rate:.2f}" for line in note.lines)[:900]


def build_inventory_entries(note: CreditNote) -> str:
    entries: list[str] = []
    for line in note.lines:
        entries.append(
            f"""
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>{esc(line.item_name)}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
              <RATE>{money(line.rate)}/{esc(line.unit)}</RATE>
              <AMOUNT>-{money(line.amount)}</AMOUNT>
              <ACTUALQTY>{money(line.qty)} {esc(line.unit)}</ACTUALQTY>
              <BILLEDQTY>{money(line.qty)} {esc(line.unit)}</BILLEDQTY>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>{esc(note.sales_return_ledger)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                <AMOUNT>-{money(line.amount)}</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>"""
        )
    return "\n".join(entries)


def build_credit_note_xml(note: CreditNote) -> str:
    tax_ledgers = ""
    for ledger, amount in ((note.cgst_ledger, note.cgst_amount), (note.sgst_ledger, note.sgst_amount), (note.igst_ledger, note.igst_amount)):
        if amount:
            tax_ledgers += f"""
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <LEDGERFROMITEM>No</LEDGERFROMITEM>
              <ISPARTYLEDGER>No</ISPARTYLEDGER>
              <AMOUNT>-{money(amount)}</AMOUNT>
            </LEDGERENTRIES.LIST>"""
    inventory_entries = build_inventory_entries(note)

    return f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>{build_company_xml()}
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Credit Note" ACTION="{esc(TALLY_ACTION)}" OBJVIEW="Invoice Voucher View">
            <OLDAUDITENTRYIDS.LIST TYPE="Number">
              <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
            </OLDAUDITENTRYIDS.LIST>
            <DATE>{esc(note.date)}</DATE>
            <REFERENCEDATE>{esc(note.date)}</REFERENCEDATE>
            <VCHSTATUSDATE>{esc(note.date)}</VCHSTATUSDATE>
            <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
            <PARTYNAME>{esc(note.party_ledger)}</PARTYNAME>
            <PARTYLEDGERNAME>{esc(note.party_ledger)}</PARTYLEDGERNAME>
            <REFERENCE>{esc(note.mrr_no)}</REFERENCE>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
            <ISINVOICE>Yes</ISINVOICE>
            <EFFECTIVEDATE>{esc(note.date)}</EFFECTIVEDATE>
            <NARRATION>{esc(note.narration)} | {esc(build_line_narration(note))}</NARRATION>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(note.party_ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <LEDGERFROMITEM>No</LEDGERFROMITEM>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>{money(note.total_amount)}</AMOUNT>
            </LEDGERENTRIES.LIST>{inventory_entries}{tax_ledgers}
            <GST.LIST></GST.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""

def parse_import_summary(response_text: str) -> dict[str, int]:
    summary: dict[str, int] = {}
    for tag in ("CREATED", "ALTERED", "COMBINED", "IGNORED", "DELETED", "CANCELLED", "ERRORS", "EXCEPTIONS"):
        match = re.search(rf"<{tag}>\s*([^<]+?)\s*</{tag}>", response_text or "", flags=re.IGNORECASE)
        if match:
            try:
                summary[tag] = int(str(match.group(1)).strip())
            except ValueError:
                summary[tag] = 0
    return summary


def response_error_message(response_text: str) -> str:
    line_errors = re.findall(r"<LINEERROR>(.*?)</LINEERROR>", response_text or "", flags=re.IGNORECASE | re.DOTALL)
    if line_errors:
        cleaned_errors = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", error))).strip() for error in line_errors]
        return "; ".join(error for error in cleaned_errors if error) or "Tally import failed."

    summary = parse_import_summary(response_text)
    failing_counts = {key: value for key, value in summary.items() if key in ("ERRORS", "EXCEPTIONS", "IGNORED") and value > 0}
    if failing_counts:
        return "Tally import failed: " + ", ".join(f"{key}={value}" for key, value in failing_counts.items())

    compact = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", response_text or ""))).strip()
    return compact[:500] or "Tally returned an empty response."


def assert_tally_import_success(response_text: str) -> None:
    summary = parse_import_summary(response_text)
    if summary.get("CREATED", 0) > 0 or summary.get("ALTERED", 0) > 0:
        return
    if any(summary.get(key, 0) > 0 for key in ("ERRORS", "EXCEPTIONS", "IGNORED")) or "<LINEERROR" in (response_text or "").upper():
        raise TallyImportError(response_error_message(response_text))
    raise TallyImportError("Tally did not confirm credit note creation. " + response_error_message(response_text))


def post_to_tally(xml: str) -> str:
    global ACTIVE_TALLY_URL

    urls_to_try = [ACTIVE_TALLY_URL] if ACTIVE_TALLY_URL else []
    urls_to_try.extend(url for url in TALLY_URL_CANDIDATES if url not in urls_to_try)
    last_error: Exception | None = None

    for url in urls_to_try:
        try:
            response = requests.post(
                url,
                data=xml.encode("utf-8"),
                headers={"Content-Type": "text/xml"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            ACTIVE_TALLY_URL = url
            return response.text
        except requests_exceptions.Timeout as error:
            last_error = error
        except requests_exceptions.ConnectionError as error:
            last_error = error
        except requests_exceptions.RequestException as error:
            last_error = error

    raise TallyUnavailableError(
        "Cannot connect to Tally on: "
        + ", ".join(urls_to_try)
        + ". Start Tally, open the correct company, and enable XML/HTTP on port 9004. "
        + "If Tally is running on another port, set LNPI_TALLY_URL in D:\\lnpi\\.env or PowerShell."
    ) from last_error


def mark_posted(conn, note: CreditNote, response_text: str) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE `material_in`
            SET `creditTallySync` = %s, `creditRemarkTally` = %s
            WHERE `id` = %s
            """,
            (datetime.now().isoformat(timespec="seconds"), f"Credit Note posted to Tally. Response: {response_text[:500]}", note.mrr_id),
        )
        conn.commit()
    finally:
        cursor.close()


def mark_failed(conn, note: CreditNote, error_message: str) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE `material_in`
            SET `creditRemarkTally` = %s
            WHERE `id` = %s
            """,
            (f"Credit Note Tally post failed at {datetime.now().isoformat(timespec='seconds')}: {error_message[:700]}", note.mrr_id),
        )
        conn.commit()
    finally:
        cursor.close()


def process_row(conn, row: dict[str, Any], dry_run: bool) -> None:
    note = build_note_from_db_row(conn, row)
    xml = build_credit_note_xml(note)
    print(f"MRR: {note.mrr_no}")
    print(f"Credit Note: Tally auto-number")
    print(f"Party: {note.party_ledger}")
    print(f"Ledger: {note.sales_return_ledger}")
    print(f"Lines: {len(note.lines)}")
    print(f"Taxable: {money(note.taxable_amount)}")
    print(f"CGST: {money(note.cgst_amount)} SGST: {money(note.sgst_amount)} IGST: {money(note.igst_amount)}")
    print(f"Total: {money(note.total_amount)}")
    print(xml)
    if dry_run:
        return

    try:
        response_text = post_to_tally(xml)
        assert_tally_import_success(response_text)
    except (TallyUnavailableError, TallyImportError) as error:
        mark_failed(conn, note, str(error))
        print(f"ERROR: {error}")
        raise SystemExit(1) from error

    print("Tally Response:")
    print(response_text)
    mark_posted(conn, note, response_text)
    print("Hostinger DB updated: material_in.creditTallySync set.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Post FG Purchase MRR Credit Note from Hostinger DB to Tally")
    parser.add_argument("--mrr", help="MRR transaction number")
    parser.add_argument("--dry-run", action="store_true", help="Print XML only; do not post to Tally or update DB")
    parser.add_argument("--limit", type=int, default=1, help="Maximum pending FG Purchase MRR rows to process")
    args = parser.parse_args()

    conn = get_db_connection()
    try:
        ensure_credit_tracking_columns(conn)
        rows = get_pending_credit_note_rows(conn, mrr_no=args.mrr, limit=args.limit)
        if not rows:
            print("No pending FG Purchase MRR found for Credit Note posting.")
            return
        for row in rows:
            process_row(conn, row, args.dry_run)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
