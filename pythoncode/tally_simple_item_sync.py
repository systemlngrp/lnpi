import json
import os
import re
import socket
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


PORTS = [9001, 9002, 9003, 9004]

SHEET_TIMEOUT = 30
TALLY_QUERY_TIMEOUT = 45
TALLY_CREATE_TIMEOUT = 45
RUN_LOG_TIMEOUT = 30
HTTP_RETRIES = 2
RETRY_DELAY_S = 2
LOCK_STALE_SECONDS = 6 * 60 * 60


@dataclass
class SyncConfig:
    sync_name: str
    sheet_url: str
    parent_group: str
    filename: str
    run_log_url: str
    ports: list[int]


@dataclass
class StockItem:
    name: str
    part_no: str = ""


def http_post_xml(url: str, xml: str, timeout_s: int) -> str:
    req = Request(
        url,
        data=xml.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8"},
        method="POST",
    )
    with urlopen(req, timeout=timeout_s) as resp:
        return resp.read().decode("utf-8", errors="replace")


def call_with_retry(action_name: str, fn, retries: int = HTTP_RETRIES, delay_s: int = RETRY_DELAY_S):
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except (URLError, TimeoutError, socket.timeout, OSError) as e:
            last_error = e
            print(f"{action_name} failed on attempt {attempt}/{retries}: {e}")
            if attempt < retries:
                time.sleep(delay_s)
    raise last_error


def fetch_sheet_rows(sheet_url: str, timeout_s: int):
    req = Request(sheet_url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(url: str, payload: dict, timeout_s: int) -> str:
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urlopen(req, timeout=timeout_s) as resp:
        return resp.read().decode("utf-8", errors="replace")


def log_run_event(config: SyncConfig, port: int | str, remarks: str):
    if not config.run_log_url:
        print(f"Run log skipped for port {port}: RUN_LOG_URL is blank")
        return

    payload = {
        "timestamp": datetime.now().isoformat(),
        "filename": config.filename,
        "remarks": remarks,
        "port": str(port),
    }
    try:
        resp = call_with_retry(
            f"Log run event for port {port}",
            lambda: post_json(config.run_log_url, payload, RUN_LOG_TIMEOUT),
        )
        print(f"Run log saved for port {port}: {resp.strip()}")
    except Exception as e:
        print(f"Failed to write run log for port {port}: {e}")


def acquire_single_instance_lock(lock_file: Path) -> bool:
    if lock_file.exists():
        try:
            lock_age_s = time.time() - lock_file.stat().st_mtime
        except OSError:
            lock_age_s = 0

        if lock_age_s > LOCK_STALE_SECONDS:
            try:
                lock_file.unlink()
                print(f"Removed stale lock file: {lock_file}")
            except OSError as e:
                print(f"Could not remove stale lock file {lock_file}: {e}")
                return False
        else:
            print(
                f"Another run is already in progress. Lock file exists at {lock_file}. "
                "Skipping this run."
            )
            return False

    try:
        fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(f"pid={os.getpid()}\n")
            handle.write(f"started_at={datetime.now().isoformat()}\n")
        return True
    except FileExistsError:
        print(
            f"Another run acquired the lock first. Lock file exists at {lock_file}. "
            "Skipping this run."
        )
        return False


def release_single_instance_lock(lock_file: Path):
    try:
        if lock_file.exists():
            lock_file.unlink()
    except OSError as e:
        print(f"Failed to remove lock file {lock_file}: {e}")


def xml_escape(s: str | None) -> str:
    if not s:
        return ""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def normalize_key(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()


def clean_text(s: str) -> str:
    return " ".join((s or "").split()).strip()


def normalize_part_no(value) -> str:
    normalized = clean_text(str(value or ""))
    if not normalized:
        return ""

    if re.fullmatch(r"\d+\.0+", normalized):
        normalized = normalized.split(".", 1)[0]

    return normalized.casefold()


def summarize_tally_response(resp: str) -> str:
    text = resp or ""

    created_match = re.search(r"<CREATED>(\d+)</CREATED>", text, re.IGNORECASE)
    altered_match = re.search(r"<ALTERED>(\d+)</ALTERED>", text, re.IGNORECASE)
    errors_match = re.search(r"<ERRORS>(\d+)</ERRORS>", text, re.IGNORECASE)
    line_errors = re.findall(r"<LINEERROR>(.*?)</LINEERROR>", text, re.IGNORECASE | re.DOTALL)
    line_errors = [clean_text(err) for err in line_errors if clean_text(err)]

    summary_parts = []
    if created_match:
        summary_parts.append(f"CREATED={created_match.group(1)}")
    if altered_match:
        summary_parts.append(f"ALTERED={altered_match.group(1)}")
    if errors_match:
        summary_parts.append(f"ERRORS={errors_match.group(1)}")
    if line_errors:
        summary_parts.append(f"LINEERROR={'; '.join(line_errors[:2])}")

    if summary_parts:
        return ", ".join(summary_parts)

    stripped_xml = clean_text(re.sub(r"<[^>]+>", " ", text))
    if stripped_xml:
        return stripped_xml[:240]

    return "Empty Tally response"


def get_tally_url(port: int) -> str:
    return f"http://localhost:{port}"


def get_current_company(tally_url: str) -> str:
    payload = """
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CompanyInfo</ID>
  </HEADER>
  <BODY>
    <DESC>
      <TDL>
        <TDLMESSAGE>
          <OBJECT NAME="CurrentCompany">
            <LOCALFORMULA>CurrentCompany:##SVCURRENTCOMPANY</LOCALFORMULA>
          </OBJECT>
          <COLLECTION NAME="CompanyInfo">
            <OBJECTS>CurrentCompany</OBJECTS>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
""".strip()

    resp = call_with_retry(
        f"Fetch current company from {tally_url}",
        lambda: http_post_xml(tally_url, payload, TALLY_QUERY_TIMEOUT),
    )

    match = re.search(r"<CURRENTCOMPANY>(.*?)</CURRENTCOMPANY>", resp, re.DOTALL)
    if match:
        return match.group(1).strip()

    lines = re.sub(r"<[^>]+>", "", resp).splitlines()
    lines = [line.strip() for line in lines if line.strip()]
    return lines[-1] if lines else ""


def list_stock_items(tally_url: str, company: str):
    payload = f"""
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>StockItem</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>{xml_escape(company)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="StockItem">
            <TYPE>StockItem</TYPE>
            <FETCH>NAME,PARTNO</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""

    resp = call_with_retry(
        f"Fetch stock items from {tally_url}",
        lambda: http_post_xml(tally_url, payload, TALLY_QUERY_TIMEOUT),
    )
    items = {}

    try:
        root = ET.fromstring(resp)
    except Exception as e:
        print(f"XML Parse Error on {tally_url}: {e}")
        return {}

    for node in root.findall(".//STOCKITEM"):
        name = (node.get("NAME") or "").strip()
        if not name:
            name = (node.findtext("NAME") or "").strip()

        if name:
            items[normalize_key(name)] = StockItem(
                name=name,
                part_no=clean_text(node.findtext("PARTNO") or ""),
            )

    print(f"DEBUG [{tally_url}]: Extracted {len(items)} stock items")
    return items


def build_stock_item_payload(name: str, parent_group: str, part_no: str | None, action: str) -> str:
    part_no_xml = ""
    if part_no:
        part_no_xml = f"""
        <PARTNO>{xml_escape(part_no)}</PARTNO>
        """

    return f"""
      <STOCKITEM NAME="{xml_escape(name)}" ACTION="{action}">
        <NAME.LIST TYPE="String">
          <NAME>{xml_escape(name)}</NAME>
        </NAME.LIST>
        {part_no_xml}
        <PARENT>{xml_escape(parent_group)}</PARENT>
        <BASEUNITS>PCS</BASEUNITS>
      </STOCKITEM>
    """


def save_stock_item(tally_url: str, company: str, name: str, parent_group: str, part_no: str | None):
    payload_body = build_stock_item_payload(name, parent_group, part_no, "Create")

    payload = f"""
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{xml_escape(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          {payload_body}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"""

    return call_with_retry(
        f"Create stock item '{name}' on {tally_url}",
        lambda: http_post_xml(tally_url, payload, TALLY_CREATE_TIMEOUT),
    )


def alter_stock_item_part_no(tally_url: str, company: str, name: str, parent_group: str, part_no: str):
    payload_body = build_stock_item_payload(name, parent_group, part_no, "Alter")

    payload = f"""
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{xml_escape(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          {payload_body}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"""

    return call_with_retry(
        f"Alter stock item '{name}' on {tally_url}",
        lambda: http_post_xml(tally_url, payload, TALLY_CREATE_TIMEOUT),
    )


def iter_sheet_items(rows):
    out = {}
    for row in rows:
        name = str(row.get("Item Name", "")).strip()
        erp_item_code = str(row.get("ERP Item Code", "")).strip()

        if name:
            out[normalize_key(name)] = (name, erp_item_code)

    return out


def run_sync(config: SyncConfig):
    if not config.sheet_url or "PASTE_" in config.sheet_url:
        message = f"{config.sync_name} sheet URL is blank. Paste the Apps Script URL in {config.filename}."
        print(message)
        log_run_event(config, "ALL", message)
        return

    try:
        rows = call_with_retry(
            f"Fetch sheet rows from {config.sheet_url}",
            lambda: fetch_sheet_rows(config.sheet_url, SHEET_TIMEOUT),
        )
    except Exception as e:
        message = f"Run stopped before processing ports: failed to fetch {config.sync_name} sheet data. Error: {e}"
        print(message)
        log_run_event(config, "ALL", message)
        return

    sheet_items = iter_sheet_items(rows)

    print(f"{config.sync_name} sheet items: {len(sheet_items)}")

    for port in config.ports:
        tally_url = get_tally_url(port)
        print(f"\n--- Processing port {port} ---")

        try:
            company = get_current_company(tally_url)
        except Exception as e:
            message = f"Failed to connect to Tally or fetch company. Error: {e}"
            print(f"Failed to connect on port {port}: {e}")
            log_run_event(config, port, message)
            continue

        if not company:
            message = "Connected to Tally, but no active company was detected."
            print(f"No company found on port {port}")
            log_run_event(config, port, message)
            continue

        print(f"Company: '{company}'")

        try:
            tally_items = list_stock_items(tally_url, company)
        except Exception as e:
            message = f"Connected to company '{company}', but failed to fetch stock items. Error: {e}"
            print(f"Failed to fetch stock items on port {port}: {e}")
            log_run_event(config, port, message)
            continue

        print(f"Tally stock items: {len(tally_items)}")

        to_create = []
        to_update = []
        for key, (name, erp_item_code) in sheet_items.items():
            existing_item = tally_items.get(key)
            if existing_item is None:
                to_create.append((name, erp_item_code))
                continue

            if erp_item_code:
                existing_part_no = clean_text(existing_item.part_no)
                if normalize_part_no(existing_part_no) != normalize_part_no(erp_item_code):
                    to_update.append((name, erp_item_code, existing_part_no))

        print(f"To Create: {len(to_create)}")
        print(f"To Update Part No: {len(to_update)}")

        if not to_create and not to_update:
            message = (
                f"Company '{company}': no new {config.sync_name} stock items or part number updates were required. "
                f"Checked {len(sheet_items)} sheet items against {len(tally_items)} Tally items."
            )
            log_run_event(config, port, message)
            continue

        created_count = 0
        altered_count = 0
        failed_items = []

        for name, erp_item_code in to_create:
            print(f"Creating on port {port}: {name} (Part No: {erp_item_code})")
            try:
                resp = save_stock_item(tally_url, company, name, config.parent_group, erp_item_code)
            except Exception as e:
                print(f"Failed on port {port} while creating '{name}': {e}")
                failed_items.append(f"{name} ({e})")
                continue

            if "<CREATED>1</CREATED>" not in resp and "<ALTERED>1</ALTERED>" not in resp:
                failure_reason = summarize_tally_response(resp)
                print(f"Failed on port {port}: {failure_reason}")
                failed_items.append(f"{name} ({failure_reason})")
                continue

            created_count += 1

        for name, erp_item_code, existing_part_no in to_update:
            print(f"Updating part no on port {port}: {name} ({existing_part_no} -> {erp_item_code})")
            try:
                resp = alter_stock_item_part_no(tally_url, company, name, config.parent_group, erp_item_code)
            except Exception as e:
                print(f"Failed on port {port} while updating '{name}': {e}")
                failed_items.append(f"{name} (alter failed: {e})")
                continue

            if "<CREATED>1</CREATED>" not in resp and "<ALTERED>1</ALTERED>" not in resp:
                failure_reason = summarize_tally_response(resp)
                print(f"Alter failed on port {port}: {failure_reason}")
                failed_items.append(f"{name} (alter failed: {failure_reason})")
                continue

            altered_count += 1

        message = (
            f"Company '{company}': processed {len(sheet_items)} sheet items, found {len(to_create)} missing, "
            f"updated {len(to_update)} part numbers, created {created_count}, altered {altered_count}, "
            f"failed {len(failed_items)}."
        )
        if failed_items:
            message += f" Failed items: {', '.join(failed_items[:5])}"
            if len(failed_items) > 5:
                message += f" and {len(failed_items) - 5} more."
        log_run_event(config, port, message)

    print("\nDone")


def run_with_lock(config: SyncConfig, lock_file: Path):
    if acquire_single_instance_lock(lock_file):
        try:
            run_sync(config)
        finally:
            release_single_instance_lock(lock_file)
