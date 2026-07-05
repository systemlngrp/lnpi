import logging
import os
import re
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import mysql.connector
import requests
from requests import exceptions as requests_exceptions


BASE_DIR = Path(__file__).resolve().parents[1]
REQUEST_TIMEOUT = 8
POSTED_BY = "tally_consumption_journal_posting.py"


def resolve_log_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd()


LOG_DIR = resolve_log_dir()
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "consumptionjournallog.log"


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_consumption_journal_posting")
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

TALLY_URL_CANDIDATES = [
    "http://localhost:9004",
    "http://127.0.0.1:9004",
]
ACTIVE_TALLY_URL: str | None = None


def to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except Exception:
        return 0.0


def escape_xml(text: Any) -> str:
    value = "" if text is None else str(text)
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def build_company_static_variables(company_name: str | None) -> str:
    if not company_name:
        return ""
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>"


def compact_xml_for_log(xml_text: str, max_length: int = 1600) -> str:
    compact = re.sub(r"\s+", " ", str(xml_text or "")).strip()
    if len(compact) <= max_length:
        return compact
    return f"{compact[:max_length]}..."


def _parse_tally_date(raw_value: Any) -> datetime | None:
    raw_text = str(raw_value or "").strip()
    if not raw_text:
        return None

    if re.fullmatch(r"\d{8}", raw_text):
        return datetime(int(raw_text[:4]), int(raw_text[4:6]), int(raw_text[6:8]))

    try:
        return datetime.fromisoformat(raw_text.replace("Z", "+00:00"))
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d-%b-%Y",
        "%d-%B-%Y",
    ):
        try:
            return datetime.strptime(raw_text, fmt)
        except ValueError:
            pass

    return None


def format_tally_date(raw_value: Any) -> str:
    parsed = _parse_tally_date(raw_value)
    if parsed:
        return parsed.strftime("%Y%m%d")
    raise RuntimeError(f"Could not resolve voucher date from value {raw_value!r}.")


def post_xml_to_tally(xml_text: str) -> str:
    global ACTIVE_TALLY_URL

    urls_to_try = [ACTIVE_TALLY_URL] if ACTIVE_TALLY_URL else []
    urls_to_try.extend([url for url in TALLY_URL_CANDIDATES if url not in urls_to_try])
    last_error: Exception | None = None

    for url in urls_to_try:
        try:
            response = requests.post(
                url,
                data=xml_text.encode("utf-8"),
                headers={"Content-Type": "application/xml"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            if ACTIVE_TALLY_URL != url:
                LOGGER.info("Connected to Tally at %s", url)
            ACTIVE_TALLY_URL = url
            return response.text
        except requests_exceptions.Timeout as error:
            LOGGER.warning("Tally timed out at %s after %ss", url, REQUEST_TIMEOUT)
            last_error = error
        except requests_exceptions.ConnectionError as error:
            LOGGER.warning("Tally not reachable at %s", url)
            last_error = error
        except requests_exceptions.RequestException as error:
            LOGGER.warning("Tally request failed at %s: %s", url, error)
            last_error = error

    raise RuntimeError(
        "Cannot connect to Tally on port 9004. "
        "Please confirm Tally XML/HTTP is enabled on port 9004."
    ) from last_error


def parse_import_summary(response_text: str) -> dict[str, str]:
    summary: dict[str, str] = {}
    for tag in ("CREATED", "ALTERED", "COMBINED", "IGNORED", "DELETED", "CANCELLED", "ERRORS", "EXCEPTIONS"):
        match = re.search(rf"<{tag}>\s*([^<]+?)\s*</{tag}>", response_text, flags=re.IGNORECASE)
        summary[tag.lower()] = str(match.group(1)).strip() if match else "0"
    return summary


def response_error_message(response_text: str) -> str:
    line_errors = re.findall(r"<LINEERROR>(.*?)</LINEERROR>", response_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned_errors = [re.sub(r"\s+", " ", error).strip() for error in line_errors if str(error).strip()]
    if cleaned_errors:
        return "; ".join(cleaned_errors[:5])

    summary = parse_import_summary(response_text)
    if summary.get("exceptions") not in (None, "", "0") or summary.get("errors") not in (None, "", "0"):
        parts = ", ".join(f"{key}={value}" for key, value in summary.items())
        return f"Tally import failed without LINEERROR ({parts})"

    compact = compact_xml_for_log(response_text, 600)
    return compact or "Unknown Tally response"


def query_tally_item(name_or_alias: str, company_name: str | None = None) -> bool:
    safe_name = escape_xml(name_or_alias)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>OBJECT</TYPE>
            <SUBTYPE>Stock Item</SUBTYPE>
            <ID TYPE="Name">{safe_name}</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    return "<STOCKITEM" in response_text.upper()


def voucher_exists_in_tally(company_name: str | None, voucher_number: str, voucher_type: str) -> bool:
    safe_number = escape_xml(voucher_number)
    safe_type = escape_xml(voucher_type)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>DATA</TYPE>
            <ID>Voucher Number</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVFROMDATE>20240101</SVFROMDATE>
                    <SVTODATE>20991231</SVTODATE>
                    <VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="CheckVoucher" ISMODIFY="No">
                            <TYPE>Voucher</TYPE>
                            <FETCH>VoucherNumber</FETCH>
                            <FILTERS>OnlyTargetVoucher</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="OnlyTargetVoucher">$$StringEqual:$VoucherNumber:"{safe_number}"</SYSTEM>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    try:
        response_text = post_xml_to_tally(xml_text)
    except Exception as error:
        LOGGER.warning("Voucher existence check failed for %s: %s", voucher_number, error)
        return False
    return safe_number in response_text


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def is_non_job_issue(issue_type: Any) -> bool:
    normalized = str(issue_type or "").strip().lower()
    return normalized in ("without job", "withoutjob", "without_job", "general")


def get_pending_non_job_issues(conn) -> list[dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT *
            FROM `material_issues`
            WHERE COALESCE(`consumptionTransactionNo`, '') <> ''
              AND (
                    LOWER(TRIM(COALESCE(`issueType`, ''))) = 'without job'
                 OR LOWER(TRIM(COALESCE(`issueType`, ''))) = 'withoutjob'
                 OR LOWER(TRIM(COALESCE(`issueType`, ''))) = 'without_job'
                 OR LOWER(TRIM(COALESCE(`issueType`, ''))) = 'general'
              )
              AND COALESCE(`tallyTimestamp`, '') = ''
            ORDER BY `date` ASC, `consumptionTransactionNo` ASC, `issueNo` ASC
            """
        )
        return cursor.fetchall()
    finally:
        cursor.close()


def get_latest_material_rate(conn, material_id: str, material_type: str, opening_rate: float) -> float:
    cursor = conn.cursor(dictionary=True)
    try:
        if material_type == "material":
            cursor.execute(
                """
                SELECT pol.rate
                FROM `purchase_order_lines` pol
                INNER JOIN `purchase_orders` po ON po.id = pol.purchaseOrderId
                WHERE pol.materialId = %s
                ORDER BY po.poDate DESC, po.updateTimestamp DESC, po.id DESC
                LIMIT 1
                """,
                (material_id,),
            )
            row = cursor.fetchone()
            latest_rate = to_float((row or {}).get("rate"))
            if latest_rate > 0:
                return latest_rate

            cursor.execute("SELECT `lines` FROM `material_in` ORDER BY `date` DESC, `updateTimestamp` DESC, `id` DESC")
            for row in cursor.fetchall():
                for line in parse_json_lines((row or {}).get("lines")):
                    if str(line.get("materialId") or line.get("itemId") or "").strip() != material_id:
                        continue
                    latest_rate = to_float(line.get("invoiceRate")) or to_float(line.get("rate"))
                    if latest_rate > 0:
                        return latest_rate
        else:
            cursor.execute("SELECT `lines` FROM `material_in` ORDER BY `date` DESC, `updateTimestamp` DESC, `id` DESC")
            for row in cursor.fetchall():
                for line in parse_json_lines((row or {}).get("lines")):
                    if str(line.get("itemId") or line.get("npdId") or "").strip() != material_id:
                        continue
                    latest_rate = to_float(line.get("invoiceRate")) or to_float(line.get("rate"))
                    if latest_rate > 0:
                        return latest_rate
    finally:
        cursor.close()

    return opening_rate


def parse_json_lines(raw_value: Any) -> list[dict[str, Any]]:
    if raw_value is None:
        return []
    if isinstance(raw_value, list):
        return [row for row in raw_value if isinstance(row, dict)]
    text = str(raw_value).strip()
    if not text:
        return []
    try:
        import json

        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [row for row in parsed if isinstance(row, dict)]
    except Exception:
        return []
    return []


def resolve_issue_context(conn, issue: dict[str, Any]) -> dict[str, Any]:
    issue_id = str(issue.get("id") or "").strip()
    if not issue_id:
        raise RuntimeError("Material issue id is missing.")

    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM `materials`")
        materials = {str(row["id"]): row for row in cursor.fetchall()}

        cursor.execute("SELECT * FROM `npd`")
        npd_rows = cursor.fetchall()
        npd_map = {str(row["id"]): row for row in npd_rows}

        cursor.execute(
            """
            SELECT *
            FROM `material_issue_lines`
            WHERE `materialIssueId` = %s
            ORDER BY `id` ASC
            """,
            (issue_id,),
        )
        issue_lines = cursor.fetchall()
    finally:
        cursor.close()

    if not issue_lines:
        raise RuntimeError(f"No issue lines found for non-job issue {issue.get('issueNo')}.")

    lines: list[dict[str, Any]] = []
    for issue_line in issue_lines:
        material_id = str(issue_line.get("materialId") or "").strip()
        material_row = materials.get(material_id)
        npd_row = npd_map.get(material_id)

        if material_row:
            name = str(material_row.get("name") or "").strip()
            erp_code = str(material_row.get("erpCode") or "").strip()
            unit_name = str(issue_line.get("uom") or material_row.get("uom") or "NOS").strip() or "NOS"
            opening_rate = to_float(material_row.get("openingRate"))
            material_type = "material"
        elif npd_row:
            name = str(npd_row.get("itemName") or npd_row.get("name") or "").strip()
            erp_code = str(npd_row.get("erp") or "").strip()
            unit_name = str(issue_line.get("uom") or npd_row.get("uom") or "NOS").strip() or "NOS"
            opening_rate = to_float(npd_row.get("rate"))
            material_type = "npd"
        else:
            raise RuntimeError(
                f"Material name could not be resolved for materialId={material_id} in issue {issue.get('issueNo')}."
            )

        quantity = round(to_float(issue_line.get("qty")), 5)
        if quantity <= 0:
            continue

        tally_name = name
        if not query_tally_item(tally_name):
            if erp_code and query_tally_item(erp_code):
                tally_name = erp_code
                LOGGER.info(
                    "Using ERP/MailingName alias '%s' for issue %s item '%s'.",
                    erp_code,
                    issue.get("issueNo"),
                    name,
                )
            else:
                raise RuntimeError(
                    f"Stock item '{name}' is missing in Tally for issue {issue.get('issueNo')}."
                )

        rate = get_latest_material_rate(conn, material_id, material_type, opening_rate)
        line_entry = {
            "materialId": material_id,
            "name": name,
            "tallyName": tally_name,
            "erpCode": erp_code,
            "uom": unit_name,
            "qty": quantity,
            "rate": rate,
        }
        lines.append(line_entry)

    if not lines:
        raise RuntimeError(f"No positive quantity lines found for non-job issue {issue.get('issueNo')}.")

    return {
        "issue": issue,
        "voucherNo": str(issue.get("consumptionTransactionNo") or "").strip(),
        "voucherDate": format_tally_date(issue.get("date")),
        "referenceNo": str(issue.get("issueNo") or "").strip(),
        "referenceDate": format_tally_date(issue.get("date")),
        "lines": lines,
    }


def format_qty(quantity: float, unit_name: str) -> str:
    qty_text = f"{quantity:.5f}".rstrip("0").rstrip(".")
    if not qty_text:
        qty_text = "0"
    return f"{qty_text} {unit_name}"


def format_rate(rate: float, unit_name: str) -> str:
    rate_text = f"{rate:.5f}".rstrip("0").rstrip(".")
    if not rate_text:
        rate_text = "0"
    return f"{rate_text}/{unit_name}"


def build_consumption_journal_xml(company_name: str | None, context: dict[str, Any]) -> str:
    issue = context["issue"]
    narration = (
        f"Imported from LNPI Non-Job Issue {context['referenceNo']} | "
        f"Type {issue.get('issueType') or 'Without Job'}"
    )
    if str(issue.get("remarks") or "").strip():
        narration = f"{narration} | {str(issue.get('remarks')).strip()}"

    inventory_entries = []
    for line in context["lines"]:
        qty_text = format_qty(to_float(line.get("qty")), str(line.get("uom") or "NOS"))
        rate = to_float(line.get("rate"))
        rate_tag = ""
        if rate > 0:
            rate_tag = f"<RATE>{escape_xml(format_rate(rate, str(line.get('uom') or 'NOS')))}</RATE>"
        inventory_entries.append(
            f"""
            <INVENTORYENTRIESOUT.LIST>
                <STOCKITEMNAME>{escape_xml(line['tallyName'])}</STOCKITEMNAME>
                {rate_tag}
                <ACTUALQTY>{escape_xml(qty_text)}</ACTUALQTY>
                <BILLEDQTY>{escape_xml(qty_text)}</BILLEDQTY>
            </INVENTORYENTRIESOUT.LIST>
            """
        )

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
                    {build_company_static_variables(company_name)}
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <VOUCHER VCHTYPE="Consumption Journal" ACTION="Create" OBJVIEW="Consumption Voucher View">
                        <DATE>{context['voucherDate']}</DATE>
                        <VOUCHERTYPENAME>Consumption Journal</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>{escape_xml(context['voucherNo'])}</VOUCHERNUMBER>
                        <REFERENCE>{escape_xml(context['referenceNo'])}</REFERENCE>
                        <REFERENCEDATE>{context['referenceDate']}</REFERENCEDATE>
                        <PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>
                        <ISINVOICE>No</ISINVOICE>
                        <NARRATION>{escape_xml(narration)}</NARRATION>
                        {''.join(inventory_entries)}
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""


def update_attempt(conn, issue_id: str) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_issues`
        SET `tallyLastAttemptAt` = %s,
            `tallyPostingAttemptCount` = COALESCE(`tallyPostingAttemptCount`, 0) + 1,
            `tallyPostingStatus` = 'Processing',
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (now, now, issue_id),
    )
    conn.commit()
    cursor.close()


def mark_posted(conn, issue_id: str, voucher_no: str, voucher_date: str, remark: str, voucher_type: str = "Consumption Journal") -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_issues`
        SET `tallyTimestamp` = %s,
            `tallyPostingStatus` = 'Posted',
            `tallyVoucherNo` = %s,
            `tallyVoucherDate` = %s,
            `tallyVoucherType` = %s,
            `tallyPostedBy` = %s,
            `tallyPostingRemark` = %s,
            `tallyPostingError` = NULL,
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (now, voucher_no, voucher_date, voucher_type, POSTED_BY, remark, now, issue_id),
    )
    conn.commit()
    cursor.close()


def mark_error(conn, issue_id: str, error_text: str) -> None:
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        """
        UPDATE `material_issues`
        SET `tallyPostingStatus` = 'Error',
            `tallyPostingRemark` = %s,
            `tallyPostingError` = %s,
            `updateTimestamp` = %s
        WHERE `id` = %s
        """,
        (error_text[:5000], error_text[:5000], now, issue_id),
    )
    conn.commit()
    cursor.close()


def process_one_issue(conn, company_name: str | None, issue: dict[str, Any]) -> None:
    issue_id = str(issue.get("id") or "").strip()
    update_attempt(conn, issue_id)

    context = resolve_issue_context(conn, issue)
    if not context["voucherNo"]:
        raise RuntimeError(f"Consumption voucher number is blank for issue {issue.get('issueNo')}.")

    if voucher_exists_in_tally(company_name, context["voucherNo"], "Consumption Journal"):
        mark_posted(
            conn,
            issue_id=issue_id,
            voucher_no=context["voucherNo"],
            voucher_date=context["voucherDate"],
            remark="Consumption Journal already existed in Tally. Local row reconciled.",
        )
        LOGGER.info("Skipping issue %s because Consumption Journal already exists in Tally", issue.get("issueNo"))
        return

    xml_text = build_consumption_journal_xml(company_name, context)
    response_text = post_xml_to_tally(xml_text)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        mark_posted(
            conn,
            issue_id=issue_id,
            voucher_no=context["voucherNo"],
            voucher_date=context["voucherDate"],
            remark=(
                f"Consumption Journal posted successfully. "
                f"Ref={context['referenceNo']}, Lines={len(context['lines'])}"
            ),
        )
        LOGGER.info("Posted Consumption Journal %s successfully", context["voucherNo"])
        return

    LOGGER.error(
        "Tally rejected Consumption Journal %s. Request XML: %s | Response XML: %s",
        context["voucherNo"],
        compact_xml_for_log(xml_text, 2500),
        compact_xml_for_log(response_text, 2500),
    )
    raise RuntimeError(
        f"Tally rejected Consumption Journal {context['voucherNo']}: {response_error_message(response_text)}"
    )


def main() -> None:
    LOGGER.info("Starting Tally Consumption Journal posting")
    LOGGER.info("Tally URL candidates: %s", ", ".join(TALLY_URL_CANDIDATES))
    LOGGER.info("Using active Tally company on port 9004. No SVCURRENTCOMPANY will be sent.")

    conn = get_db_connection()
    try:
        pending_issues = get_pending_non_job_issues(conn)
        LOGGER.info("Found %s eligible non-job issue(s) for Consumption Journal posting", len(pending_issues))
        for issue in pending_issues:
            issue_id = str(issue.get("id") or "").strip()
            issue_no = str(issue.get("issueNo") or "").strip()
            con_no = str(issue.get("consumptionTransactionNo") or "").strip()
            try:
                process_one_issue(conn, None, issue)
            except Exception as error:
                error_text = str(error)
                LOGGER.exception("ERROR in non-job issue %s: %s", issue_no, error_text)
                mark_error(conn, issue_id, error_text)
                LOGGER.error(
                    "Stopping Consumption Journal batch after failure in %s / %s so later CON serials are not posted out of sequence.",
                    issue_no or issue_id,
                    con_no or "blank CON",
                )
                break
    finally:
        conn.close()
        LOGGER.info("Finished Tally Consumption Journal posting")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        LOGGER.exception("Fatal error while posting Tally Consumption Journals: %s", exc)
        sys.exit(1)
