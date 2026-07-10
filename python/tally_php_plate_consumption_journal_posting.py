import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import tally_consumption_journal_posting as base


POSTED_BY = "tally_php_plate_consumption_journal_posting.py"


def resolve_log_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd()


LOG_DIR = resolve_log_dir()
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "phpplateconsumptionjournallog.log"


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_php_plate_consumption_journal_posting")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    file_handler = logging.FileHandler(LOG_FILE, mode="w", encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    logger.propagate = False
    return logger


LOGGER = setup_logger()
base.LOGGER = LOGGER


JOURNAL_CONFIGS: dict[str, dict[str, str]] = {
    "PHP": {
        "table": "php_loading_slips",
        "voucherField": "phpConsumptionTransactionNo",
        "voucherType": "PHP Consumption Journal",
        "masterTable": "php_item_master",
        "label": "PHP Loading Slip",
    },
    "PLATE": {
        "table": "plate_loading_slips",
        "voucherField": "plateConsumptionTransactionNo",
        "voucherType": "Plate Consumption Journal",
        "masterTable": "plate_item_master",
        "label": "Plate Loading Slip",
    },
}


def current_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_pending_linked_loading_slips(conn, source: str) -> list[dict[str, Any]]:
    config = JOURNAL_CONFIGS[source]
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            f"""
            SELECT *
            FROM `{config["table"]}`
            WHERE COALESCE(NULLIF(TRIM(`fgLoadingId`), ''), '') <> ''
              AND COALESCE(NULLIF(TRIM(`{config["voucherField"]}`), ''), '') <> ''
              AND COALESCE(NULLIF(TRIM(`tallyTimestamp`), ''), '') = ''
              AND UPPER(COALESCE(NULLIF(TRIM(`status`), ''), 'ACTIVE')) <> 'CANCELLED'
            ORDER BY STR_TO_DATE(`date`, '%Y-%m-%d') ASC, `{config["voucherField"]}` ASC, `slipNo` ASC, `id` ASC
            """
        )
        return cursor.fetchall()
    finally:
        cursor.close()


def load_item_master_map(conn, table_name: str) -> dict[str, dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(f"SELECT * FROM `{table_name}`")
        return {str(row.get("id") or "").strip(): row for row in cursor.fetchall()}
    finally:
        cursor.close()


def get_parent_fg_loading_row(conn, fg_loading_id: str) -> dict[str, Any]:
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM `loading_slips` WHERE `id` = %s LIMIT 1", (fg_loading_id,))
        return cursor.fetchone() or {}
    finally:
        cursor.close()


def resolve_loading_context(conn, source: str, slip: dict[str, Any]) -> dict[str, Any]:
    config = JOURNAL_CONFIGS[source]
    slip_id = str(slip.get("id") or "").strip()
    if not slip_id:
        raise RuntimeError(f"{config['label']} id is missing.")

    fg_loading_id = str(slip.get("fgLoadingId") or "").strip()
    if not fg_loading_id:
        raise RuntimeError(f"{config['label']} {slip.get('slipNo')} is not linked to an FG Loading Slip.")

    voucher_no = str(slip.get(config["voucherField"]) or "").strip()
    if not voucher_no:
        raise RuntimeError(f"{config['voucherType']} number is blank for slip {slip.get('slipNo')}.")

    parent_fg = get_parent_fg_loading_row(conn, fg_loading_id)
    parent_fg_slip_no = str(parent_fg.get("slipNo") or "").strip()
    if not parent_fg_slip_no:
        raise RuntimeError(f"FG Loading Slip could not be resolved for linked id {fg_loading_id}.")

    item_master_map = load_item_master_map(conn, config["masterTable"])
    raw_lines = base.parse_json_lines(slip.get("lines"))
    if not raw_lines:
        raise RuntimeError(f"No lines found for {config['label']} {slip.get('slipNo')}.")

    lines: list[dict[str, Any]] = []
    for raw_line in raw_lines:
        quantity = round(base.to_float(raw_line.get("loadedQty")), 5)
        if quantity <= 0:
            continue

        item_id = str(raw_line.get("itemId") or "").strip()
        master_row = item_master_map.get(item_id, {})

        item_name = (
            str(raw_line.get("itemName") or "").strip()
            or str(master_row.get("itemName") or "").strip()
        )
        if not item_name:
            raise RuntimeError(
                f"Item name could not be resolved for itemId={item_id or 'blank'} in slip {slip.get('slipNo')}."
            )

        erp_code = (
            str(raw_line.get("erpCode") or "").strip()
            or str(raw_line.get("masterErp") or "").strip()
            or str(master_row.get("erp") or "").strip()
        )
        unit_name = base.normalize_tally_unit_name(
            raw_line.get("uom") or master_row.get("uom") or "PCS"
        )
        rate = base.to_float(raw_line.get("rate"))
        tally_name = base.ensure_app_group_item_exists(None, item_name, erp_code, unit_name)

        lines.append(
            {
                "itemId": item_id,
                "name": item_name,
                "tallyName": tally_name,
                "erpCode": erp_code,
                "uom": unit_name,
                "qty": quantity,
                "rate": rate,
            }
        )

    if not lines:
        raise RuntimeError(f"No positive quantity lines found for {config['label']} {slip.get('slipNo')}.")

    return {
        "source": source,
        "config": config,
        "slip": slip,
        "parentFgSlipNo": parent_fg_slip_no,
        "companyName": str(parent_fg.get("companyName") or slip.get("companyName") or "").strip(),
        "voucherNo": voucher_no,
        "voucherDate": base.format_tally_date(slip.get("date")),
        "referenceNo": str(slip.get("slipNo") or "").strip(),
        "referenceDate": base.format_tally_date(slip.get("date")),
        "lines": lines,
    }


def build_consumption_journal_xml(company_name: str | None, context: dict[str, Any]) -> str:
    config = context["config"]
    narration = (
        f"Imported from LNPI {config['voucherType']} | "
        f"FG Slip {context['parentFgSlipNo']} | "
        f"{context['companyName'] or 'Company blank'}"
    )
    if str(context["referenceNo"] or "").strip():
        narration = f"{narration} | Source Slip {context['referenceNo']}"

    inventory_entries = []
    for line in context["lines"]:
        qty_text = base.format_qty(base.to_float(line.get("qty")), str(line.get("uom") or "PCS"))
        rate = base.to_float(line.get("rate"))
        rate_tag = ""
        if rate > 0:
            rate_tag = f"<RATE>{base.escape_xml(base.format_rate(rate, str(line.get('uom') or 'PCS')))}</RATE>"

        inventory_entries.append(
            f"""
            <INVENTORYENTRIESOUT.LIST>
                <STOCKITEMNAME>{base.escape_xml(line.get("tallyName") or line.get("name") or "")}</STOCKITEMNAME>
                {rate_tag}
                <ACTUALQTY>{base.escape_xml(qty_text)}</ACTUALQTY>
                <BILLEDQTY>{base.escape_xml(qty_text)}</BILLEDQTY>
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
                        {base.build_company_static_variables(company_name)}
                    </STATICVARIABLES>
                </REQUESTDESC>
                <REQUESTDATA>
                    <TALLYMESSAGE>
                        <VOUCHER VCHTYPE="{base.escape_xml(config['voucherType'])}" ACTION="Create" OBJVIEW="Consumption Voucher View">
                            <DATE>{context['voucherDate']}</DATE>
                            <VOUCHERTYPENAME>{base.escape_xml(config['voucherType'])}</VOUCHERTYPENAME>
                            <VOUCHERNUMBER>{base.escape_xml(context['voucherNo'])}</VOUCHERNUMBER>
                            <REFERENCE>{base.escape_xml(context['referenceNo'])}</REFERENCE>
                            <REFERENCEDATE>{context['referenceDate']}</REFERENCEDATE>
                            <PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>
                            <ISINVOICE>No</ISINVOICE>
                            <NARRATION>{base.escape_xml(narration)}</NARRATION>
                            {''.join(inventory_entries)}
                        </VOUCHER>
                    </TALLYMESSAGE>
                </REQUESTDATA>
            </IMPORTDATA>
        </BODY>
    </ENVELOPE>
    """


def update_attempt(conn, table_name: str, row_id: str) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"""
            UPDATE `{table_name}`
            SET `tallyLastAttemptAt` = %s,
                `tallyPostingAttemptCount` = COALESCE(`tallyPostingAttemptCount`, 0) + 1,
                `tallyPostingStatus` = 'Processing'
            WHERE `id` = %s
            """,
            (current_timestamp(), row_id),
        )
        conn.commit()
    finally:
        cursor.close()


def mark_posted(
    conn,
    table_name: str,
    row_id: str,
    voucher_no: str,
    voucher_date: str,
    remark: str,
    voucher_type: str,
) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"""
            UPDATE `{table_name}`
            SET `tallyTimestamp` = %s,
                `tallyPostingStatus` = 'Posted',
                `tallyVoucherNo` = %s,
                `tallyVoucherDate` = %s,
                `tallyVoucherType` = %s,
                `tallyPostedBy` = %s,
                `tallyPostingRemark` = %s,
                `tallyPostingError` = NULL
            WHERE `id` = %s
            """,
            (
                current_timestamp(),
                voucher_no,
                voucher_date,
                voucher_type,
                POSTED_BY,
                remark,
                row_id,
            ),
        )
        conn.commit()
    finally:
        cursor.close()


def mark_error(conn, table_name: str, row_id: str, error_text: str) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"""
            UPDATE `{table_name}`
            SET `tallyPostingStatus` = 'Error',
                `tallyPostingRemark` = %s,
                `tallyPostingError` = %s
            WHERE `id` = %s
            """,
            (error_text, error_text, row_id),
        )
        conn.commit()
    finally:
        cursor.close()


def process_one_loading_slip(conn, source: str, company_name: str | None, slip: dict[str, Any]) -> None:
    config = JOURNAL_CONFIGS[source]
    slip_id = str(slip.get("id") or "").strip()
    update_attempt(conn, config["table"], slip_id)

    context = resolve_loading_context(conn, source, slip)
    voucher_type = config["voucherType"]
    if base.voucher_exists_in_tally(company_name, context["voucherNo"], voucher_type):
        mark_posted(
            conn,
            table_name=config["table"],
            row_id=slip_id,
            voucher_no=context["voucherNo"],
            voucher_date=context["voucherDate"],
            voucher_type=voucher_type,
            remark=f"{voucher_type} already existed in Tally. Local row reconciled.",
        )
        LOGGER.info(
            "Skipping %s %s because %s already exists in Tally",
            config["label"],
            slip.get("slipNo"),
            voucher_type,
        )
        return

    xml_text = build_consumption_journal_xml(company_name, context)
    response_text = base.post_xml_to_tally(xml_text)
    if "<CREATED>1</CREATED>" in response_text or "<ALTERED>1</ALTERED>" in response_text:
        mark_posted(
            conn,
            table_name=config["table"],
            row_id=slip_id,
            voucher_no=context["voucherNo"],
            voucher_date=context["voucherDate"],
            voucher_type=voucher_type,
            remark=(
                f"{voucher_type} posted successfully. "
                f"Ref={context['referenceNo']}, FG Slip={context['parentFgSlipNo']}, Lines={len(context['lines'])}"
            ),
        )
        LOGGER.info("Posted %s %s successfully", voucher_type, context["voucherNo"])
        return

    LOGGER.error(
        "Tally rejected %s %s. Request XML: %s | Response XML: %s",
        voucher_type,
        context["voucherNo"],
        base.compact_xml_for_log(xml_text, 2500),
        base.compact_xml_for_log(response_text, 2500),
    )
    raise RuntimeError(
        f"Tally rejected {voucher_type} {context['voucherNo']}: {base.response_error_message(response_text)}"
    )


def process_source_batch(conn, source: str) -> None:
    config = JOURNAL_CONFIGS[source]
    pending_slips = get_pending_linked_loading_slips(conn, source)
    LOGGER.info("Found %s eligible %s row(s) for %s posting", len(pending_slips), source, config["voucherType"])

    for slip in pending_slips:
        row_id = str(slip.get("id") or "").strip()
        slip_no = str(slip.get("slipNo") or "").strip()
        voucher_no = str(slip.get(config["voucherField"]) or "").strip()
        try:
            process_one_loading_slip(conn, source, None, slip)
        except Exception as error:
            error_text = str(error)
            LOGGER.exception("ERROR in %s %s: %s", config["label"], slip_no or row_id, error_text)
            mark_error(conn, config["table"], row_id, error_text)
            LOGGER.error(
                "Stopping %s batch after failure in %s / %s so later serials are not posted out of sequence.",
                voucher_type_for_log(config),
                slip_no or row_id,
                voucher_no or f"blank {config['voucherType']}",
            )
            break


def voucher_type_for_log(config: dict[str, str]) -> str:
    return config["voucherType"]


def main() -> None:
    LOGGER.info("Starting Tally PHP/Plate Consumption Journal posting")
    LOGGER.info("Tally URL candidates: %s", ", ".join(base.TALLY_URL_CANDIDATES))
    LOGGER.info("Using active Tally company on port 9004. No SVCURRENTCOMPANY will be sent.")

    conn = base.get_db_connection()
    try:
        process_source_batch(conn, "PHP")
        process_source_batch(conn, "PLATE")
    finally:
        conn.close()
        LOGGER.info("Finished Tally PHP/Plate Consumption Journal posting")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        LOGGER.exception("Fatal error while posting Tally PHP/Plate Consumption Journals: %s", exc)
        sys.exit(1)
