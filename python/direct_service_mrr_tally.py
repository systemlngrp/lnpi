"""Post pending Direct Service MRRs to Tally as accounting Purchase vouchers.

Run this script separately from the general MRR runner to avoid processing the
same Direct Service record concurrently.
"""

import json
import logging
import os
import re
import sys
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import mysql.connector
import requests
from requests import exceptions as requests_exceptions


BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
LOG_FILE = BASE_DIR / "direct_service_mrr_tally.log"
DEBUG_XML_DIR = BASE_DIR / "direct_service_tally_xml_debug"
DEBUG_XML_DIR.mkdir(parents=True, exist_ok=True)
MONEY_QUANTUM = Decimal("0.01")
REQUEST_TIMEOUT = 20


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("direct_service_mrr_tally")
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
TALLY_URL_CANDIDATES = list(dict.fromkeys(filter(None, [
    os.getenv("LNPI_TALLY_URL"),
    "http://localhost:9004",
    "http://127.0.0.1:9004",
])))


class TallyUnavailableError(RuntimeError):
    pass


def to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def round_money(value: Any) -> Decimal:
    return Decimal(str(to_float(value))).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def format_money(value: Any) -> str:
    return f"{round_money(value):.2f}"


def escape_xml(value: Any) -> str:
    return (str(value or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;"))


def parse_date(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"\d{8}", text):
        return datetime.strptime(text, "%Y%m%d")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    return None


def resolve_voucher_datetime(mrr: dict[str, Any]) -> datetime:
    for value in (mrr.get("invDate"), mrr.get("date"), mrr.get("timestamp")):
        parsed = parse_date(value)
        if parsed:
            return parsed
    raise RuntimeError("Voucher date could not be resolved from invoice/date fields.")


def format_tally_date(mrr: dict[str, Any]) -> str:
    return resolve_voucher_datetime(mrr).strftime("%Y%m%d")


def get_financial_year_bounds(value: datetime) -> tuple[str, str]:
    start_year = value.year if value.month >= 4 else value.year - 1
    return f"{start_year}0401", f"{start_year + 1}0331"


def build_company_static_variables(company_name: str | None) -> str:
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>" if company_name else ""


def dump_tally_xml(step: str, xml_text: str, voucher_no: str | None = None) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", voucher_no or "general").strip("._-") or "general"
    safe_step = re.sub(r"[^A-Za-z0-9._-]+", "_", step).strip("._-") or "unknown"
    target = DEBUG_XML_DIR / f"{stamp}__{safe_name}__{safe_step}.xml"
    target.write_text(xml_text, encoding="utf-8")
    return target


def post_xml_to_tally(xml_text: str, debug_step: str = "unknown", voucher_no: str | None = None) -> str:
    payload = dump_tally_xml(debug_step, xml_text, voucher_no)
    last_error: Exception | None = None
    for url in TALLY_URL_CANDIDATES:
        try:
            LOGGER.info("Sending Tally XML | step=%s | voucher=%s | url=%s | payload=%s", debug_step, voucher_no or "-", url, payload)
            response = requests.post(url, data=xml_text.encode("utf-8"), headers={"Content-Type": "application/xml"}, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            LOGGER.info("Tally XML completed | step=%s | voucher=%s | response_chars=%s", debug_step, voucher_no or "-", len(response.text))
            return response.text
        except requests_exceptions.RequestException as error:
            last_error = error
            LOGGER.warning("Tally request failed | step=%s | url=%s | error=%s", debug_step, url, error)
    raise TallyUnavailableError(
        f"Cannot connect to Tally at {', '.join(TALLY_URL_CANDIDATES)}. "
        f"Enable Tally XML/HTTP or set LNPI_TALLY_URL. Last error: {last_error}"
    ) from last_error


def check_tally_health(company_name: str | None, reason: str = "health_check") -> None:
    xml_text = f"""<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Company</REPORTNAME>
    <STATICVARIABLES>{build_company_static_variables(company_name)}</STATICVARIABLES>
    </REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>"""
    post_xml_to_tally(xml_text, debug_step=f"health_check:{reason}")


def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as error:
        raise RuntimeError(f"Cannot connect to MySQL at {DB_CONFIG['host']}:{DB_CONFIG['port']}: {error}") from error


def ensure_db_connection(conn):
    try:
        conn.ping(reconnect=True, attempts=3, delay=2)
        return conn
    except mysql.connector.Error:
        try:
            conn.close()
        except Exception:
            pass
        return get_db_connection()


def get_supplier_name(conn, supplier_id: str, _mrr_type: str) -> tuple[str, str]:
    conn = ensure_db_connection(conn)
    cursor = conn.cursor(dictionary=True)
    try:
        for table in ("suppliers", "companies"):
            cursor.execute(f"SELECT `name` FROM `{table}` WHERE `id` = %s LIMIT 1", (supplier_id,))
            row = cursor.fetchone()
            name = str((row or {}).get("name") or "").strip()
            if name:
                return name, table
    finally:
        cursor.close()
    raise RuntimeError(f"Party ledger name is missing for supplierId={supplier_id}.")


def parse_lines(lines_raw: Any) -> list[dict[str, Any]]:
    if isinstance(lines_raw, list):
        return [line for line in lines_raw if isinstance(line, dict)]
    if isinstance(lines_raw, str):
        try:
            parsed = json.loads(lines_raw)
            return [line for line in parsed if isinstance(line, dict)] if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def build_tax_ledger_entries(mrr: dict[str, Any], _lines: list[dict[str, Any]], _voucher_no: str) -> str:
    entries: list[str] = []
    insurance_other = round_money(mrr.get("insurance")) + round_money(mrr.get("otherCharges"))
    for ledger, amount in (
        ("INSURANCE & OTHER EXP. ON PURCHASE", insurance_other),
        ("Input CGST", round_money(mrr.get("totalCgst"))),
        ("Input SGST", round_money(mrr.get("totalSgst"))),
        ("Input IGST", round_money(mrr.get("totalIgst"))),
    ):
        if amount:
            entries.append(f"""<LEDGERENTRIES.LIST><LEDGERNAME>{escape_xml(ledger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-{format_money(amount)}</AMOUNT></LEDGERENTRIES.LIST>""")
    round_off = round_money(mrr.get("roundOff"))
    if round_off:
        entries.append(f"""<LEDGERENTRIES.LIST><LEDGERNAME>Round Off</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>{format_money(-round_off)}</AMOUNT></LEDGERENTRIES.LIST>""")
    return "\n".join(entries)


def mark_mrr_completed(conn, mrr_id: str, remark: str | None = None) -> None:
    cursor = ensure_db_connection(conn).cursor()
    now = datetime.now().isoformat()
    cursor.execute("UPDATE `material_in` SET `tallyTimestamp`=%s, `tallySyncRemark`=%s, `status`='Completed', `updateTimestamp`=%s WHERE `id`=%s", (now, remark, now, mrr_id))
    conn.commit()
    cursor.close()


def update_mrr_tally_remark(conn, mrr_id: str, remark: str) -> None:
    cursor = ensure_db_connection(conn).cursor()
    cursor.execute("UPDATE `material_in` SET `tallySyncRemark`=%s, `updateTimestamp`=%s WHERE `id`=%s", (remark, datetime.now().isoformat(), mrr_id))
    conn.commit()
    cursor.close()


def response_error_message(response_text: str) -> str:
    text = str(response_text or "").strip()
    for pattern in (r"<LINEERROR>(.*?)</LINEERROR>", r"<ERRORS>(.*?)</ERRORS>"):
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return re.sub(r"<[^>]+>", "", match.group(1)).strip()
    return "Tally import failed"


PURCHASE_LEDGER = "FREIGHT INWARD(GTA)"
TDS_LEDGER = "TDS PAYABLE"


def get_pending_direct_service_mrrs(conn):
    conn = ensure_db_connection(conn)
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT `id`, `transactionNo`, `mrrType`, `date`, `timestamp`,
               `invoiceNo`, `invDate`, `supplierId`, `totalAmount`,
               `totalCgst`, `totalSgst`, `totalIgst`, `insurance`,
               `otherCharges`, `roundOff`, `tdsAmount`, `lines`,
               `status`, `tallyTimestamp`
        FROM `material_in`
        WHERE `mrrType` = 'Direct Service'
          AND (`tallyTimestamp` IS NULL OR `tallyTimestamp` = '')
        ORDER BY `timestamp` ASC, `transactionNo` ASC
        """
    )
    rows = cursor.fetchall()
    cursor.close()
    return rows


def direct_service_duplicate_exists(
    company_name: str | None,
    supplier_name: str,
    invoice_no: str,
    voucher_date,
) -> bool:
    """Ask Tally for only the matching Purchase reference and party.

    The general MRR runner exports every Purchase voucher in the financial year
    and filters it in Python. That export can be too large for Tally's HTTP
    server, so this runner applies the filters inside Tally instead.
    """
    from_date, to_date = get_financial_year_bounds(voucher_date)
    safe_supplier = escape_xml(supplier_name)
    safe_invoice = escape_xml(invoice_no)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>DirectServiceDuplicate</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVFROMDATE>{from_date}</SVFROMDATE>
                    <SVTODATE>{to_date}</SVTODATE>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="DirectServiceDuplicate" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>VoucherNumber</FETCH>
                            <FETCH>Reference</FETCH>
                            <FETCH>PartyLedgerName</FETCH>
                            <FILTERS>DirectServicePurchaseFilter</FILTERS>
                            <FILTERS>DirectServicePartyFilter</FILTERS>
                            <FILTERS>DirectServiceReferenceFilter</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="DirectServicePurchaseFilter">$$StringEqual:$VoucherTypeName:"Purchase"</SYSTEM>
                        <SYSTEM TYPE="Formulae" NAME="DirectServicePartyFilter">$$StringEqual:$PartyLedgerName:"{safe_supplier}"</SYSTEM>
                        <SYSTEM TYPE="Formulae" NAME="DirectServiceReferenceFilter">$$StringEqual:$Reference:"{safe_invoice}"</SYSTEM>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(
        xml_text,
        debug_step=f"direct_service_duplicate_check:{supplier_name}",
        voucher_no="-",
    )
    normalized_response = "".join(str(response_text or "").upper().split())
    normalized_invoice = "".join(invoice_no.upper().split())
    return bool(normalized_invoice and normalized_invoice in normalized_response)


def service_line_amount(line: dict[str, Any]) -> Decimal:
    stored_value = line.get("invoiceValue")
    if stored_value not in (None, ""):
        return round_money(stored_value)
    qty = round_money(line.get("invoiceQty") or line.get("qty"))
    rate = round_money(line.get("invoiceRate") or line.get("rate"))
    return (qty * rate).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def calculate_service_total(lines: list[dict[str, Any]]) -> Decimal:
    return sum(
        (
            service_line_amount(line)
            for line in lines
            if str(line.get("lineType") or "") == "Service"
        ),
        Decimal("0"),
    ).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def calculate_gross_components(mrr: dict[str, Any], service_total: Decimal) -> Decimal:
    return (
        service_total
        + round_money(mrr.get("totalCgst"))
        + round_money(mrr.get("totalSgst"))
        + round_money(mrr.get("totalIgst"))
        + round_money(mrr.get("insurance"))
        + round_money(mrr.get("otherCharges"))
        + round_money(mrr.get("roundOff"))
    ).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def validate_direct_service_mrr(
    mrr: dict[str, Any], supplier_name: str, lines: list[dict[str, Any]]
) -> tuple[Decimal, Decimal, Decimal]:
    voucher_no = str(mrr.get("transactionNo") or "").strip()
    invoice_no = str(mrr.get("invoiceNo") or "").strip()
    if not voucher_no:
        raise RuntimeError("Direct Service MRR has no transaction number. Posting stopped.")
    if not supplier_name.strip():
        raise RuntimeError(f"Direct Service voucher {voucher_no} has no supplier ledger. Posting stopped.")
    if not invoice_no:
        raise RuntimeError(f"Direct Service voucher {voucher_no} has no invoice number. Posting stopped.")

    gross_total = round_money(mrr.get("totalAmount"))
    tds_amount = round_money(mrr.get("tdsAmount"))
    service_total = calculate_service_total(lines)
    if service_total <= Decimal("0.00"):
        raise RuntimeError(f"Direct Service voucher {voucher_no} has no positive service value. Posting stopped.")
    if tds_amount < Decimal("0.00"):
        raise RuntimeError(f"Direct Service voucher {voucher_no} has a negative TDS amount. Posting stopped.")
    if tds_amount > gross_total:
        raise RuntimeError(f"Direct Service voucher {voucher_no} TDS exceeds the gross total. Posting stopped.")

    cgst = round_money(mrr.get("totalCgst"))
    sgst = round_money(mrr.get("totalSgst"))
    if cgst != sgst:
        raise RuntimeError(f"Direct Service voucher {voucher_no} has unequal CGST and SGST. Posting stopped.")

    rendered_debits = calculate_gross_components(mrr, service_total)
    if rendered_debits != gross_total:
        raise RuntimeError(
            f"Direct Service voucher {voucher_no} total mismatch "
            f"(debit={rendered_debits}, gross total={gross_total}). Posting stopped."
        )
    supplier_payable = (gross_total - tds_amount).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if supplier_payable + tds_amount != rendered_debits:
        raise RuntimeError(
            f"Direct Service voucher {voucher_no} is out of balance "
            f"(debit={rendered_debits}, credit={supplier_payable + tds_amount}). Posting stopped."
        )
    return service_total, tds_amount, supplier_payable


def build_direct_service_voucher_xml(
    company_name: str | None, mrr: dict[str, Any], supplier_name: str
) -> str:
    voucher_no = str(mrr.get("transactionNo") or "").strip()
    invoice_no = str(mrr.get("invoiceNo") or "").strip()
    gross_total = round_money(mrr.get("totalAmount"))
    lines = parse_lines(mrr.get("lines"))
    service_total, tds_amount, supplier_payable = validate_direct_service_mrr(
        mrr, supplier_name, lines
    )
    tax_entries = build_tax_ledger_entries(mrr, lines, voucher_no)
    tds_entry = ""
    if tds_amount > Decimal("0.00"):
        tds_entry = f"""
                <LEDGERENTRIES.LIST>
                    <LEDGERNAME>{escape_xml(TDS_LEDGER)}</LEDGERNAME>
                    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                    <AMOUNT>{format_money(tds_amount)}</AMOUNT>
                </LEDGERENTRIES.LIST>"""

    narration = (
        f"Imported from LNPI MRR {voucher_no} | Type: Direct Service | "
        f"CONSIGNOR - {supplier_name}, INVOICE NO: {invoice_no}, "
        f"INVOICE VALUE: {gross_total:,.2f}"
    )
    return f"""
<ENVELOPE>
    <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
    <BODY><IMPORTDATA>
        <REQUESTDESC>
            <REPORTNAME>Vouchers</REPORTNAME>
            <STATICVARIABLES>{build_company_static_variables(company_name)}</STATICVARIABLES>
        </REQUESTDESC>
        <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
            <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">
                <DATE>{format_tally_date(mrr)}</DATE>
                <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
                <PARTYNAME>{escape_xml(supplier_name)}</PARTYNAME>
                <PARTYLEDGERNAME>{escape_xml(supplier_name)}</PARTYLEDGERNAME>
                <REFERENCE>{escape_xml(invoice_no)}</REFERENCE>
                <NARRATION>{escape_xml(narration)}</NARRATION>
                <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
                <VCHENTRYMODE>Accounting Invoice</VCHENTRYMODE>
                <ISINVOICE>Yes</ISINVOICE>
                <LEDGERENTRIES.LIST>
                    <LEDGERNAME>{escape_xml(supplier_name)}</LEDGERNAME>
                    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                    <AMOUNT>{format_money(supplier_payable)}</AMOUNT>
                </LEDGERENTRIES.LIST>
                {tds_entry}
                <LEDGERENTRIES.LIST>
                    <LEDGERNAME>{escape_xml(PURCHASE_LEDGER)}</LEDGERNAME>
                    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                    <AMOUNT>-{format_money(service_total)}</AMOUNT>
                </LEDGERENTRIES.LIST>
                {tax_entries}
            </VOUCHER>
        </TALLYMESSAGE></REQUESTDATA>
    </IMPORTDATA></BODY>
</ENVELOPE>
"""


def process_one_direct_service_mrr(conn, company_name: str | None, mrr: dict[str, Any]) -> None:
    conn = ensure_db_connection(conn)
    voucher_no = str(mrr.get("transactionNo") or "").strip()
    invoice_no = str(mrr.get("invoiceNo") or "").strip()
    try:
        supplier_name, source_table = get_supplier_name(
            conn, str(mrr.get("supplierId") or ""), "Direct Service"
        )
        xml_text = build_direct_service_voucher_xml(company_name, mrr, supplier_name)
    except RuntimeError as error:
        update_mrr_tally_remark(conn, str(mrr["id"]), str(error))
        LOGGER.warning("Skipping Direct Service MRR %s: %s", voucher_no, error)
        return

    LOGGER.info(
        "Processing Direct Service MRR %s | party=%s | source=%s | debit=%s",
        voucher_no, supplier_name, source_table, PURCHASE_LEDGER,
    )
    check_tally_health(company_name, reason=f"before_direct_service_mrr:{voucher_no}")
    if direct_service_duplicate_exists(
        company_name=company_name,
        supplier_name=supplier_name,
        invoice_no=invoice_no,
        voucher_date=resolve_voucher_datetime(mrr),
    ):
        remark = (
            "Skipped: duplicate Direct Service supplier invoice found in Tally "
            f"(supplier={supplier_name}, reference={invoice_no})."
        )
        mark_mrr_completed(conn, str(mrr["id"]), remark)
        LOGGER.info("Skipping duplicate Direct Service MRR %s: %s", voucher_no, remark)
        return

    try:
        response_text = post_xml_to_tally(
            xml_text, debug_step="direct_service_purchase_import", voucher_no=voucher_no
        )
    except TallyUnavailableError:
        update_mrr_tally_remark(
            conn,
            str(mrr["id"]),
            f"Tally did not respond while importing Direct Service voucher {voucher_no}.",
        )
        raise

    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        mark_mrr_completed(conn, str(mrr["id"]), "Posted successfully to Tally.")
        LOGGER.info("Posted Direct Service voucher %s successfully", voucher_no)
        return

    remark = response_error_message(response_text)
    if remark == "Tally import failed":
        remark = f"Tally rejected Direct Service voucher {voucher_no}. Check debug XML."
    update_mrr_tally_remark(conn, str(mrr["id"]), remark)
    raise RuntimeError(f"Tally rejected Direct Service voucher {voucher_no}: {response_text}")


def main() -> None:
    LOGGER.info("Starting Direct Service MRR Tally posting")
    LOGGER.info("Tally URL candidates: %s", ", ".join(TALLY_URL_CANDIDATES))
    company_name = None
    conn = get_db_connection()
    try:
        pending_mrrs = get_pending_direct_service_mrrs(conn)
        LOGGER.info("Found %s pending Direct Service MRR(s)", len(pending_mrrs))
        for mrr in pending_mrrs:
            try:
                conn = ensure_db_connection(conn)
                process_one_direct_service_mrr(conn, company_name, mrr)
            except TallyUnavailableError as error:
                LOGGER.error("Tally unavailable while processing %s: %s", mrr.get("transactionNo"), error)
                LOGGER.error(
                    "TallyPrime is not accepting XML requests. In TallyPrime, enable the HTTP/XML "
                    "service on port 9004 (or set LNPI_TALLY_URL to its actual port), then run this script again."
                )
                break
            except Exception as error:
                LOGGER.exception("Direct Service MRR %s failed: %s", mrr.get("transactionNo"), error)
    finally:
        try:
            conn.close()
        except Exception:
            pass
        LOGGER.info("Finished Direct Service MRR Tally posting")


if __name__ == "__main__":
    main()
