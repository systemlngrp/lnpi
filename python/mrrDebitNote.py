import argparse
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

try:
    import mysql.connector
except ModuleNotFoundError as error:
    if error.name == "mysql":
        print(
            "Missing dependency: mysql-connector-python\n"
            "Install it for this Python first:\n"
            f'  "{sys.executable}" -m pip install mysql-connector-python',
            file=sys.stderr,
        )
        raise SystemExit(1) from error
    raise

try:
    import requests
    from requests import exceptions as requests_exceptions
except ModuleNotFoundError as error:
    if error.name == "requests":
        print(
            "Missing dependency: requests\n"
            "Install it for this Python first:\n"
            f'  "{sys.executable}" -m pip install requests',
            file=sys.stderr,
        )
        raise SystemExit(1) from error
    raise


SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DIR = SCRIPT_DIR.parents[0]
REQUEST_TIMEOUT = 30
MONEY_Q = Decimal("0.01")


class TallyUnavailableError(RuntimeError):
    pass


class TallyImportError(RuntimeError):
    pass


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


def candidate_env_paths() -> list[Path]:
    paths: list[Path] = []
    explicit_env = os.getenv("LNPI_ENV_FILE")
    if explicit_env:
        paths.append(Path(explicit_env).expanduser())

    paths.extend(
        [
            Path.cwd() / ".env",
            SCRIPT_DIR / ".env",
            BASE_DIR / ".env",
            Path("D:/lnpi/.env"),
        ]
    )
    paths.extend(parent / ".env" for parent in SCRIPT_DIR.parents)

    unique_paths: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        try:
            key = str(path.resolve())
        except OSError:
            key = str(path)
        if key not in seen:
            seen.add(key)
            unique_paths.append(path)
    return unique_paths


def find_env_file() -> Path | None:
    for env_path in candidate_env_paths():
        if env_path.exists():
            return env_path
    return None


def load_env_file() -> Path | None:
    env_path = find_env_file()
    if env_path is None:
        return None

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
    return env_path


LOADED_ENV_PATH = load_env_file()

# Built-in fallback config for running this script on another PC without a .env file.
# Environment variables or .env values still override these values.
BUILTIN_DB_CONFIG = {
    "host": "193.203.184.152",
    "port": "3306",
    "user": "u380633007_lnpidata",
    "password": "!Office1@",
    "database": "u380633007_lnpidata",
}
BUILTIN_TALLY_URL = "http://127.0.0.1:9000"
BUILTIN_TALLY_COMPANY = "Laxmi Narayan Packaging Industries"

COMPANY_NAME = os.getenv("LNPI_TALLY_COMPANY") or os.getenv("TALLY_COMPANY") or BUILTIN_TALLY_COMPANY
TALLY_ACTION = os.getenv("LNPI_TALLY_ACTION", "Create")
DEFAULT_PURCHASE_RETURN_LEDGER = os.getenv("LNPI_DEBIT_PURCHASE_LEDGER", "Purchase Return")
DEFAULT_CGST_LEDGER = os.getenv("LNPI_CGST_LEDGER", "Input CGST")
DEFAULT_SGST_LEDGER = os.getenv("LNPI_SGST_LEDGER", "Input SGST")
DEFAULT_IGST_LEDGER = os.getenv("LNPI_IGST_LEDGER", "Input IGST")

PURCHASE_LEDGER_BY_MRR = {
    "Reel": "PURCHASE PAPER",
    "Others": "Purchase Other RM",
    "FG Purchase": "Purchase - FG",
    "Rejection In": "Purchase - Rejection In",
}


def build_tally_url_candidates() -> list[str]:
    candidates: list[str] = []
    preferred = (
        os.getenv("LNPI_TALLY_URL"),
        os.getenv("TALLY_URL"),
        BUILTIN_TALLY_URL,
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
        "host": os.getenv("LNPI_DB_HOST") or os.getenv("DB_HOST") or BUILTIN_DB_CONFIG["host"],
        "user": os.getenv("LNPI_DB_USER") or os.getenv("DB_USER") or BUILTIN_DB_CONFIG["user"],
        "password": os.getenv("LNPI_DB_PASSWORD") or os.getenv("DB_PASSWORD") or BUILTIN_DB_CONFIG["password"],
        "database": os.getenv("LNPI_DB_NAME") or os.getenv("DB_NAME") or BUILTIN_DB_CONFIG["database"],
        "port": int(os.getenv("LNPI_DB_PORT") or os.getenv("DB_PORT") or BUILTIN_DB_CONFIG["port"]),
        "use_pure": True,
    }
    missing = [key for key in ("host", "user", "password", "database") if not config.get(key)]
    if missing:
        searched = ", ".join(str(path) for path in candidate_env_paths())
        raise RuntimeError(
            "Missing DB config: "
            + ", ".join(missing)
            + ". Set LNPI_DB_HOST, LNPI_DB_USER, LNPI_DB_PASSWORD, LNPI_DB_NAME "
            + "or DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in a .env file or PowerShell env. "
            + "Searched .env paths: "
            + searched
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


def parse_tally_date(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(text[:10], fmt)
        except ValueError:
            pass
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    return None


def get_financial_year_bounds(tally_date: str) -> tuple[str, str]:
    parsed = parse_tally_date(tally_date) or datetime.now()
    start_year = parsed.year if parsed.month >= 4 else parsed.year - 1
    return f"{start_year}0401", f"{start_year + 1}0331"


def normalize_lookup_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


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
    where = ["`debitNote` IS NOT NULL", "`debitNote` <> ''", "COALESCE(NULLIF(TRIM(`debitTallySync`), ''), '') = ''"]
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
               `totalCgst`, `totalSgst`, `totalIgst`, `debitTallySync`, `debitRemarkTally`
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
        purchase_return_ledger=PURCHASE_LEDGER_BY_MRR.get(str(row.get("mrrType") or "").strip(), DEFAULT_PURCHASE_RETURN_LEDGER),
        cgst_ledger=DEFAULT_CGST_LEDGER,
        sgst_ledger=DEFAULT_SGST_LEDGER,
        igst_ledger=DEFAULT_IGST_LEDGER,
        cgst_amount=cgst_amount,
        sgst_amount=sgst_amount,
        igst_amount=igst_amount,
        line=DebitNoteLine(item_name=material_name, qty=qty, rate=rate, unit=unit),
        narration=f"Debit Note against MRR {row.get('transactionNo')} Invoice {row.get('invoiceNo') or ''}".strip(),
    )


def build_company_xml() -> str:
    if not COMPANY_NAME.strip():
        return ""
    return f"""
          <STATICVARIABLES>
            <SVCURRENTCOMPANY>{esc(COMPANY_NAME)}</SVCURRENTCOMPANY>
          </STATICVARIABLES>"""


def build_debit_note_xml(note: DebitNote) -> str:
    qty_with_unit = f" {note.line.qty:.2f} {note.line.unit}"
    rate_with_unit = f"{note.line.rate:.2f}/{note.line.unit}"
    tax_ledgers = ""
    for ledger, amount in ((note.cgst_ledger, note.cgst_amount), (note.sgst_ledger, note.sgst_amount), (note.igst_ledger, note.igst_amount)):
        if amount:
            tax_ledgers += f"""
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <LEDGERFROMITEM>No</LEDGERFROMITEM>
              <ISPARTYLEDGER>No</ISPARTYLEDGER>
              <AMOUNT>{money(amount)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>"""

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
          <VOUCHER VCHTYPE="Debit Note" ACTION="{esc(TALLY_ACTION)}" OBJVIEW="Accounting Voucher View">
            <OLDAUDITENTRYIDS.LIST TYPE="Number">
              <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
            </OLDAUDITENTRYIDS.LIST>
            <DATE>{esc(note.date)}</DATE>
            <REFERENCEDATE>{esc(note.date)}</REFERENCEDATE>
            <VCHSTATUSDATE>{esc(note.date)}</VCHSTATUSDATE>
            <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
            <VOUCHERNUMBER>{esc(note.voucher_no)}</VOUCHERNUMBER>
            <PARTYNAME>{esc(note.supplier_ledger)}</PARTYNAME>
            <PARTYLEDGERNAME>{esc(note.supplier_ledger)}</PARTYLEDGERNAME>
            <REFERENCE>{esc(note.mrr_no)}</REFERENCE>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
            <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
            <ISINVOICE>No</ISINVOICE>
            <EFFECTIVEDATE>{esc(note.date)}</EFFECTIVEDATE>
            <NARRATION>{esc(note.narration)}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(note.supplier_ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <LEDGERFROMITEM>No</LEDGERFROMITEM>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>-{money(note.total_amount)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(note.purchase_return_ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <LEDGERFROMITEM>No</LEDGERFROMITEM>
              <ISPARTYLEDGER>No</ISPARTYLEDGER>
              <AMOUNT>{money(note.line.amount)}</AMOUNT>
              <INVENTORYALLOCATIONS.LIST>
                <STOCKITEMNAME>{esc(note.line.item_name)}</STOCKITEMNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <RATE>{esc(rate_with_unit)}</RATE>
                <AMOUNT>{money(note.line.amount)}</AMOUNT>
                <ACTUALQTY>{esc(qty_with_unit)}</ACTUALQTY>
                <BILLEDQTY>{esc(qty_with_unit)}</BILLEDQTY>
                <BATCHALLOCATIONS.LIST>
                  <GODOWNNAME>Main Location</GODOWNNAME>
                  <BATCHNAME>Primary Batch</BATCHNAME>
                  <AMOUNT>{money(note.line.amount)}</AMOUNT>
                  <ACTUALQTY>{esc(qty_with_unit)}</ACTUALQTY>
                  <BILLEDQTY>{esc(qty_with_unit)}</BILLEDQTY>
                </BATCHALLOCATIONS.LIST>
              </INVENTORYALLOCATIONS.LIST>
            </ALLLEDGERENTRIES.LIST>{tax_ledgers}
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
    raise TallyImportError("Tally did not confirm debit note creation. " + response_error_message(response_text))

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


def clean_tally_xml(response_text: str) -> str:
    text = str(response_text or "").strip()
    if not text:
        return ""
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", text)
    start = text.find("<")
    if start > 0:
        text = text[start:]
    return text


def compact_lookup_key(value: Any) -> str:
    return re.sub(r"[^0-9a-z]+", "", normalize_lookup_key(value))


def fetch_tally_stock_item_names() -> list[str]:
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>DebitNoteStockItemList</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables()}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="DebitNoteStockItemList" ISMODIFY="No">
                            <TYPE>Stock Item</TYPE>
                            <FETCH>Name</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    if not cleaned:
        return []
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return []

    names: list[str] = []
    seen: set[str] = set()
    for element in root.iter():
        tag = str(element.tag or "").upper()
        raw_name = ""
        if tag.endswith("STOCKITEM"):
            raw_name = str(element.attrib.get("NAME") or "").strip() or safe_tally_text(element, "NAME")
        if not raw_name:
            continue
        key = normalize_lookup_key(raw_name)
        if key and key not in seen:
            seen.add(key)
            names.append(raw_name)
    return names


def resolve_tally_stock_item_name(item_name: str) -> str:
    original = str(item_name or "").replace("\u00a0", " ").strip()
    if not original:
        return original

    try:
        stock_items = fetch_tally_stock_item_names()
    except TallyUnavailableError:
        raise
    except Exception as error:
        print(f"Warning: could not verify stock item in Tally: {error}")
        return original

    exact_by_key = {normalize_lookup_key(name): name for name in stock_items}
    exact_match = exact_by_key.get(normalize_lookup_key(original))
    if exact_match:
        return exact_match

    loose_key = compact_lookup_key(original)
    loose_matches = [name for name in stock_items if compact_lookup_key(name) == loose_key]
    if len(loose_matches) == 1:
        print(f"Stock item matched in Tally: {original} -> {loose_matches[0]}")
        return loose_matches[0]

    similar = [name for name in stock_items if normalize_lookup_key(original) in normalize_lookup_key(name) or normalize_lookup_key(name) in normalize_lookup_key(original)]
    if similar:
        print("Stock item not exactly matched. Similar Tally items: " + ", ".join(similar[:5]))
    return original


def build_company_static_variables() -> str:
    if not COMPANY_NAME.strip():
        return ""
    return f"<SVCURRENTCOMPANY>{esc(COMPANY_NAME)}</SVCURRENTCOMPANY>"


def safe_tally_text(element: ET.Element | None, tag_name: str) -> str:
    if element is None:
        return ""
    child = element.find(tag_name)
    if child is None:
        return ""
    return str(child.text or "").strip()


def looks_like_voucher_element(element: ET.Element) -> bool:
    return any(
        safe_tally_text(element, field)
        for field in ("VOUCHERNUMBER", "REFERENCE", "NARRATION", "PARTYLEDGERNAME", "PARTYNAME")
    )


def fetch_debit_note_vouchers_for_duplicate_check(note: DebitNote) -> list[dict[str, str]]:
    from_date, to_date = get_financial_year_bounds(note.date)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>DebitNoteDuplicateCheck</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables()}
                    <SVFROMDATE>{from_date}</SVFROMDATE>
                    <SVTODATE>{to_date}</SVTODATE>
                    <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="DebitNoteDuplicateCheck" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>Date</FETCH>
                            <FETCH>VoucherNumber</FETCH>
                            <FETCH>Reference</FETCH>
                            <FETCH>Narration</FETCH>
                            <FETCH>PartyLedgerName</FETCH>
                            <FETCH>PartyName</FETCH>
                            <FETCH>VoucherTypeName</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    if not cleaned:
        return []

    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return []

    vouchers: list[dict[str, str]] = []
    seen_keys: set[tuple[str, str, str, str, str]] = set()
    for element in root.iter():
        if not looks_like_voucher_element(element):
            continue
        voucher_date = safe_tally_text(element, "DATE")
        voucher_number = safe_tally_text(element, "VOUCHERNUMBER")
        reference = safe_tally_text(element, "REFERENCE")
        narration = safe_tally_text(element, "NARRATION")
        party = safe_tally_text(element, "PARTYLEDGERNAME") or safe_tally_text(element, "PARTYNAME")
        voucher_type = safe_tally_text(element, "VOUCHERTYPENAME")
        if normalize_lookup_key(voucher_type) not in ("", normalize_lookup_key("Debit Note")):
            continue
        key = (voucher_date, voucher_number, reference, narration, party)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        vouchers.append(
            {
                "date": voucher_date,
                "voucher_number": voucher_number,
                "reference": reference,
                "narration": narration,
                "party": party,
                "voucher_type": voucher_type,
            }
        )
    return vouchers


def find_duplicate_debit_note_in_tally(note: DebitNote) -> dict[str, str] | None:
    normalized_mrr_no = normalize_lookup_key(note.mrr_no)
    normalized_voucher_no = normalize_lookup_key(note.voucher_no)
    for voucher in fetch_debit_note_vouchers_for_duplicate_check(note):
        normalized_narration = normalize_lookup_key(voucher.get("narration"))
        normalized_reference = normalize_lookup_key(voucher.get("reference"))
        normalized_tally_voucher_no = normalize_lookup_key(voucher.get("voucher_number"))
        if normalized_voucher_no and normalized_tally_voucher_no == normalized_voucher_no:
            voucher["duplicate_reason"] = "voucher_number"
            return voucher
        if normalized_mrr_no and normalized_reference == normalized_mrr_no:
            voucher["duplicate_reason"] = "mrr_no_in_reference"
            return voucher
        if normalized_mrr_no and normalized_mrr_no in normalized_narration:
            voucher["duplicate_reason"] = "mrr_no_in_narration"
            return voucher
    return None


def ensure_db_connection(conn) -> None:
    try:
        if conn.is_connected():
            return
    except mysql.connector.Error:
        pass
    conn.reconnect(attempts=3, delay=2)


def mark_duplicate_reconciled(conn, note: DebitNote, duplicate: dict[str, str]) -> None:
    ensure_db_connection(conn)
    tally_voucher_no = duplicate.get("voucher_number") or "-"
    reason = duplicate.get("duplicate_reason") or "duplicate_check"
    remark = f"Debit Note already exists in Tally for MRR {note.mrr_no}. Tally voucher: {tally_voucher_no}. Reason: {reason}."
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE `material_in`
            SET `debitTallySync` = %s, `debitRemarkTally` = %s
            WHERE `id` = %s
            """,
            (datetime.now().isoformat(timespec="seconds"), remark, note.mrr_id),
        )
        conn.commit()
    finally:
        cursor.close()


def mark_posted(conn, note: DebitNote, response_text: str) -> None:
    ensure_db_connection(conn)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE `material_in`
            SET `debitTallySync` = %s, `debitRemarkTally` = %s
            WHERE `id` = %s
            """,
            (datetime.now().isoformat(timespec="seconds"), f"Debit Note posted to Tally. Response: {response_text[:500]}", note.mrr_id),
        )
        conn.commit()
    finally:
        cursor.close()


def mark_failed(conn, note: DebitNote, error_message: str) -> None:
    ensure_db_connection(conn)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE `material_in`
            SET `debitRemarkTally` = %s
            WHERE `id` = %s
            """,
            (f"Debit Note Tally post failed at {datetime.now().isoformat(timespec='seconds')}: {error_message[:700]}", note.mrr_id),
        )
        conn.commit()
    finally:
        cursor.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Post MRR Debit Note from Hostinger DB to Tally")
    parser.add_argument("--debit-note", help="Debit note number, example DN-00038")
    parser.add_argument("--mrr", help="MRR transaction number")
    parser.add_argument("--dry-run", action="store_true", help="Print XML only; do not post to Tally or update DB")
    parser.add_argument("--mark-posted", action="store_true", help="Deprecated; successful posts always update material_in.debitTallySync")
    args = parser.parse_args()

    conn = get_db_connection()
    try:
        row = get_pending_debit_note_row(conn, debit_note_no=args.debit_note, mrr_no=args.mrr)
        if not row:
            print("No debit note MRR found in Hostinger DB for the given filter.")
            return
        note = build_note_from_db_row(conn, row)
        if not args.dry_run:
            note.line.item_name = resolve_tally_stock_item_name(note.line.item_name)
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
        try:
            duplicate = find_duplicate_debit_note_in_tally(note)
            if duplicate:
                mark_duplicate_reconciled(conn, note, duplicate)
                print(
                    "Duplicate found in Tally. Posting skipped. "
                    f"Voucher: {duplicate.get('voucher_number') or '-'} | "
                    f"Reason: {duplicate.get('duplicate_reason') or 'duplicate_check'}"
                )
                print("Hostinger DB updated: material_in.debitTallySync reconciled.")
                return

            response_text = post_to_tally(xml)
            assert_tally_import_success(response_text)
        except (TallyUnavailableError, TallyImportError) as error:
            mark_failed(conn, note, str(error))
            print(f"ERROR: {error}")
            raise SystemExit(1) from error
        print("Tally Response:")
        print(response_text)
        mark_posted(conn, note, response_text)
        print("Hostinger DB updated: material_in.debitTallySync set.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()