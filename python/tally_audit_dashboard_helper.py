import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

try:
    import mysql.connector
except ImportError:
    mysql = None

BASE_DIR = Path(__file__).resolve().parent
LOG_FILE = BASE_DIR / "tally_audit_dashboard_helper.log"
ENV_FILE = BASE_DIR / "tally_audit_dashboard_helper.env"


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_audit_dashboard_helper")
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
def load_env_file(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return

    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            LOGGER.warning("Ignoring invalid env line %s in %s", line_no, path)
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            LOGGER.warning("Ignoring env line %s with empty key in %s", line_no, path)
            continue
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def first_env_value(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return ""


def parse_db_port(value: str) -> int:
    try:
        port = int(value or "3306")
    except ValueError:
        LOGGER.warning("Invalid DB port %s; using 3306", value)
        return 3306
    return port if 1 <= port <= 65535 else 3306


def get_db_config() -> tuple[Any, list[str]]:
    config = {
        "host": first_env_value("LNPI_DB_HOST", "DB_HOST"),
        "user": first_env_value("LNPI_DB_USER", "DB_USER"),
        "password": first_env_value("LNPI_DB_PASSWORD", "DB_PASSWORD"),
        "database": first_env_value("LNPI_DB_NAME", "DB_NAME"),
        "port": parse_db_port(first_env_value("LNPI_DB_PORT", "DB_PORT") or "3306"),
    }
    missing = []
    if not config["host"]:
        missing.append("LNPI_DB_HOST/DB_HOST")
    if not config["user"]:
        missing.append("LNPI_DB_USER/DB_USER")
    if not config["password"]:
        missing.append("LNPI_DB_PASSWORD/DB_PASSWORD")
    if not config["database"]:
        missing.append("LNPI_DB_NAME/DB_NAME")
    return (None, missing) if missing else (config, [])


def get_db_health() -> dict[str, Any]:
    config, missing = get_db_config()
    return {
        "dbConfigured": config is not None,
        "dbHost": config["host"] if config else first_env_value("LNPI_DB_HOST", "DB_HOST") or "",
        "dbName": config["database"] if config else first_env_value("LNPI_DB_NAME", "DB_NAME") or "",
        "dbPort": config["port"] if config else parse_db_port(first_env_value("LNPI_DB_PORT", "DB_PORT") or "3306"),
        "dbMissing": missing,
        "dbConfigFile": str(ENV_FILE),
        "dbDriverAvailable": mysql is not None,
    }


def get_snapshot_id(date_from: str, date_to: str) -> str:
    return f"audit-{date_from or 'all'}-{date_to or 'all'}"


def persist_audit_snapshot(date_from: str, date_to: str, values: dict[str, Any]) -> dict[str, Any]:
    snapshot_id = get_snapshot_id(date_from, date_to)
    config, missing = get_db_config()
    if missing:
        LOGGER.warning("Skipping DB persistence for %s because DB config is missing: %s", snapshot_id, ", ".join(missing))
        return {"dbPersisted": False, "snapshotId": snapshot_id, "dbMissing": missing}
    if mysql is None:
        LOGGER.warning("Skipping DB persistence for %s because mysql-connector-python is not installed", snapshot_id)
        return {"dbPersisted": False, "snapshotId": snapshot_id, "dbMissing": ["mysql-connector-python"]}

    timestamp = str(values.get("fetchedAt") or datetime.now().isoformat(timespec="seconds"))
    params = (
        snapshot_id,
        date_from,
        date_to,
        round_money(float(values.get("invoiceValueTally") or 0)),
        round_money(float(values.get("consumptionValueTally") or 0)),
        round_money(float(values.get("saleValueTally") or 0)),
        round_money(float(values.get("debitNoteTally") or 0)),
        "Tally Audit Helper",
        timestamp,
    )
    sql = """
        INSERT INTO audit_dashboard_snapshots
          (id, dateFrom, dateTo, invoiceValueTally, consumptionValueTally, saleValueTally, debitNoteTally, updatedBy, updateTimestamp)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          dateFrom = VALUES(dateFrom),
          dateTo = VALUES(dateTo),
          invoiceValueTally = VALUES(invoiceValueTally),
          consumptionValueTally = VALUES(consumptionValueTally),
          saleValueTally = VALUES(saleValueTally),
          debitNoteTally = VALUES(debitNoteTally),
          updatedBy = VALUES(updatedBy),
          updateTimestamp = VALUES(updateTimestamp)
    """

    connection = None
    try:
        safe_config = {key: value for key, value in config.items() if key != "password"}
        LOGGER.info("Persisting audit snapshot %s to MySQL %s", snapshot_id, safe_config)
        connection = mysql.connector.connect(**config)
        cursor = connection.cursor()
        cursor.execute(sql, params)
        connection.commit()
        cursor.close()
        LOGGER.info("Audit snapshot %s persisted successfully", snapshot_id)
        return {"dbPersisted": True, "snapshotId": snapshot_id}
    except Exception as error:
        LOGGER.exception("Failed to persist audit snapshot %s: %s", snapshot_id, error)
        return {"dbPersisted": False, "snapshotId": snapshot_id, "dbError": str(error)}
    finally:
        if connection and connection.is_connected():
            connection.close()

load_env_file()

HELPER_HOST = os.getenv("LNPI_AUDIT_HELPER_HOST", "127.0.0.1")
HELPER_PORT = int(os.getenv("LNPI_AUDIT_HELPER_PORT", "8765"))
CONNECT_TIMEOUT = float(os.getenv("LNPI_AUDIT_CONNECT_TIMEOUT", "1.5"))
REQUEST_TIMEOUT = float(os.getenv("LNPI_AUDIT_TALLY_TIMEOUT", "12"))
MAX_REQUEST_BYTES = int(os.getenv("LNPI_AUDIT_MAX_REQUEST_BYTES", "4096"))
VOUCHER_TYPES = {
    "invoiceValueTally": "Purchase",
    "consumptionValueTally": "Consumption Journal",
    "saleValueTally": "Sales",
    "debitNoteTally": "Debit Note",
}
ALLOWED_ORIGIN_PATTERNS = (
    re.compile(r"^https://darkred-lobster-409686\.hostingersite\.com$", re.IGNORECASE),
    re.compile(r"^http://localhost:\d+$", re.IGNORECASE),
    re.compile(r"^http://127\.0\.0\.1:\d+$", re.IGNORECASE),
)


def parse_csv_values(value: str, fallback: list[str]) -> list[str]:
    values = [entry.strip() for entry in str(value or "").split(",") if entry.strip()]
    return values or fallback


def parse_tally_ports() -> list[int]:
    raw_ports = parse_csv_values(os.getenv("LNPI_AUDIT_TALLY_PORTS", ""), ["9000"])
    ports: list[int] = []
    for raw_port in raw_ports:
        try:
            port = int(raw_port)
        except ValueError:
            LOGGER.warning("Ignoring invalid Tally port value: %s", raw_port)
            continue
        if 1 <= port <= 65535:
            ports.append(port)
        else:
            LOGGER.warning("Ignoring out-of-range Tally port value: %s", raw_port)
    return ports or [9000]


def build_tally_url_candidates() -> list[str]:
    hosts = parse_csv_values(os.getenv("LNPI_AUDIT_TALLY_HOSTS", ""), ["localhost"])
    return [f"http://{host}:{port}" for port in parse_tally_ports() for host in hosts]


def escape_xml(value: Any) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def clean_tally_xml(xml_text: str) -> str:
    cleaned = str(xml_text or "")
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", cleaned)
    cleaned = re.sub(r"&#(?:0?[0-8]|1[12]|1[4-9]|2[0-9]|3[01]);", "", cleaned)
    cleaned = re.sub(r"&#x(?:[0-8]|[bBcCeE]|1[0-9A-Fa-f]);", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def normalize_date_for_tally(value: str) -> str:
    text = str(value or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y%m%d")
        except ValueError:
            pass
    raise ValueError(f"Invalid date '{value}'. Expected YYYY-MM-DD.")


def validate_date_range(date_from: str, date_to: str) -> tuple[str, str]:
    tally_from = normalize_date_for_tally(date_from)
    tally_to = normalize_date_for_tally(date_to)
    if tally_from > tally_to:
        raise ValueError("dateFrom cannot be after dateTo.")
    return tally_from, tally_to


def parse_amount(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    text = text.replace(",", "")
    negative = text.startswith("-") or text.endswith("Cr")
    cleaned = re.sub(r"[^0-9.\-]", "", text)
    try:
        amount = float(cleaned or 0)
    except ValueError:
        return 0.0
    return -abs(amount) if negative else amount


def round_money(value: float) -> float:
    return round(float(value or 0), 2)


def build_voucher_collection_xml(voucher_type: str, date_from: str, date_to: str) -> str:
    safe_type = escape_xml(voucher_type)
    return f"""
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Voucher Register</REPORTNAME>
        <STATICVARIABLES>
          <SVFROMDATE>{date_from}</SVFROMDATE>
          <SVTODATE>{date_to}</SVTODATE>
          <VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>
"""


def post_xml_to_url(session: requests.Session, url: str, payload: str) -> str:
    response = session.post(
        url,
        data=payload.encode("utf-8"),
        headers={"Content-Type": "application/xml", "User-Agent": "LNPIAuditTallyHelper/1.1"},
        timeout=(CONNECT_TIMEOUT, REQUEST_TIMEOUT),
    )
    response.raise_for_status()
    return response.text


def is_truthy_tally_flag(value: str) -> bool:
    return str(value or "").strip().lower() in {"yes", "true", "1"}


def child_text(element: ET.Element, names: tuple[str, ...]) -> str:
    wanted = {name.upper() for name in names}
    for child in list(element):
        tag = child.tag.split("}", 1)[-1].upper()
        if tag in wanted:
            return str(child.text or "").strip()
    return ""


def tally_response_error(xml_text: str) -> str:
    cleaned = clean_tally_xml(xml_text)
    if not cleaned:
        return ""
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return ""
    for node in root.iter():
        tag = node.tag.split("}", 1)[-1].upper()
        if tag in {"LINEERROR", "ERROR", "ERRORMSG"} and str(node.text or "").strip():
            return str(node.text or "").strip()
    return ""


def get_voucher_amount(voucher: ET.Element) -> float:
    raw_amount = child_text(voucher, ("LNPIVOUCHERAMOUNT", "AMOUNT"))
    if not raw_amount:
        for amount_node in voucher.iter():
            amount_tag = amount_node.tag.split("}", 1)[-1].upper()
            if amount_tag == "AMOUNT" and amount_node.text:
                raw_amount = amount_node.text
                break
    return abs(parse_amount(raw_amount))


def parse_voucher_total(xml_text: str) -> tuple[float, int]:
    cleaned = clean_tally_xml(xml_text)
    if not cleaned:
        return 0.0, 0
    tally_error = tally_response_error(cleaned)
    if tally_error:
        raise ValueError(f"Tally returned an error: {tally_error}")
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError as error:
        preview = re.sub(r"\s+", " ", cleaned[:300]).strip()
        raise ValueError(f"Unable to parse Tally XML response: {error}. Response preview: {preview}") from error

    total = 0.0
    count = 0
    for voucher in root.iter():
        tag = voucher.tag.split("}", 1)[-1].upper()
        if tag != "VOUCHER":
            continue
        if is_truthy_tally_flag(child_text(voucher, ("ISCANCELLED", "CANCELLED"))):
            continue
        if is_truthy_tally_flag(child_text(voucher, ("ISOPTIONAL", "OPTIONAL"))):
            continue
        total += get_voucher_amount(voucher)
        count += 1
    return round_money(total), count


def fetch_one_voucher_type(url: str, field: str, voucher_type: str, date_from: str, date_to: str) -> tuple[str, str, float, int]:
    xml_text = build_voucher_collection_xml(voucher_type, date_from, date_to)
    with requests.Session() as session:
        response_text = post_xml_to_url(session, url, xml_text)
    total, count = parse_voucher_total(response_text)
    return field, voucher_type, total, count


def fetch_tally_values(date_from: str, date_to: str) -> dict[str, Any]:
    tally_from, tally_to = validate_date_range(date_from, date_to)
    last_errors: list[str] = []
    tally_url_candidates = build_tally_url_candidates()
    LOGGER.info("Fetch requested for app date range %s to %s / Tally range %s to %s", date_from, date_to, tally_from, tally_to)

    for url in tally_url_candidates:
        try:
            LOGGER.info("Trying Tally XML URL %s", url)
            values: dict[str, float] = {}
            counts: dict[str, int] = {}
            with ThreadPoolExecutor(max_workers=len(VOUCHER_TYPES)) as executor:
                futures = [
                    executor.submit(fetch_one_voucher_type, url, field, voucher_type, tally_from, tally_to)
                    for field, voucher_type in VOUCHER_TYPES.items()
                ]
                for future in as_completed(futures):
                    field, voucher_type, total, count = future.result()
                    LOGGER.info("%s total from %s: %.2f across %s voucher(s)", voucher_type, url, total, count)
                    values[field] = total
                    counts[voucher_type] = count
            LOGGER.info("Tally fetch succeeded from %s", url)
            return {
                **values,
                "sourceUrl": url,
                "fetchedAt": datetime.now().isoformat(timespec="seconds"),
                "counts": counts,
            }
        except Exception as error:
            LOGGER.warning("Tally XML URL %s failed: %s", url, error)
            last_errors.append(f"{url}: {error}")

    ports = ", ".join(str(port) for port in parse_tally_ports())
    LOGGER.error("No Tally XML/HTTP endpoint responded. Last errors: %s", " | ".join(last_errors[-4:]))
    raise RuntimeError(f"No Tally XML/HTTP endpoint responded on configured ports ({ports}). " + " | ".join(last_errors[-4:]))


def read_json_request(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    raw_length = handler.headers.get("Content-Length", "0") or "0"
    try:
        length = int(raw_length)
    except ValueError as error:
        raise ValueError("Invalid Content-Length header.") from error
    if length > MAX_REQUEST_BYTES:
        raise ValueError(f"Request body too large. Limit is {MAX_REQUEST_BYTES} bytes.")
    body = handler.rfile.read(length).decode("utf-8") if length else "{}"
    try:
        data = json.loads(body or "{}")
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON body: {error.msg}") from error
    if not isinstance(data, dict):
        raise ValueError("JSON body must be an object.")
    return data


def get_request_date_range(data: dict[str, Any]) -> tuple[str, str]:
    date_from = str(data.get("dateFrom") or "").strip()
    date_to = str(data.get("dateTo") or "").strip()
    if not date_from or not date_to:
        raise ValueError("dateFrom and dateTo are required.")
    validate_date_range(date_from, date_to)
    return date_from, date_to


def status_for_error(error: Exception) -> int:
    if isinstance(error, ValueError):
        return 400
    return 500


def public_error_message(error: Exception) -> str:
    if isinstance(error, requests.RequestException):
        return f"Tally request failed: {error}"
    return str(error)


def allowed_origin(origin: str) -> str:
    if any(pattern.match(origin or "") for pattern in ALLOWED_ORIGIN_PATTERNS):
        return origin
    return "*"


class Handler(BaseHTTPRequestHandler):
    server_version = "LNPIAuditTallyHelper/1.1"

    def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        origin = self.headers.get("Origin", "")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", allowed_origin(origin))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self._send_json(200, {"ok": True})

    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path == "/health":
            LOGGER.info("Health check from %s", self.client_address[0])
            self._send_json(
                200,
                {
                    "ok": True,
                    "helper": self.server_version,
                    "tallyUrls": build_tally_url_candidates(),
                    "connectTimeoutSeconds": CONNECT_TIMEOUT,
                    "readTimeoutSeconds": REQUEST_TIMEOUT,
                    "logFile": str(LOG_FILE),
                    **get_db_health(),
                },
            )
            return
        if path == "/audit-dashboard/tally-values":
            try:
                query = parse_qs(parsed_url.query)
                date_from = str((query.get("dateFrom") or [""])[0]).strip()
                date_to = str((query.get("dateTo") or [""])[0]).strip()
                if not date_from or not date_to:
                    today = datetime.now().strftime("%Y-%m-%d")
                    date_from = date_from or today
                    date_to = date_to or today
                LOGGER.info("Audit dashboard GET fetch request from %s for %s to %s", self.client_address[0], date_from, date_to)
                result = fetch_tally_values(date_from, date_to)
                db_result = persist_audit_snapshot(date_from, date_to, result)
                self._send_json(200, {"ok": True, **result, **db_result})
            except Exception as error:
                LOGGER.exception("Audit dashboard GET fetch failed: %s", error)
                self._send_json(status_for_error(error), {"ok": False, "error": public_error_message(error)})
            return
        self._send_json(404, {"ok": False, "error": "Not found"})
    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/audit-dashboard/tally-values":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return
        try:
            data = read_json_request(self)
            date_from, date_to = get_request_date_range(data)
            LOGGER.info("Audit dashboard fetch request from %s for %s to %s", self.client_address[0], date_from, date_to)
            result = fetch_tally_values(date_from, date_to)
            db_result = persist_audit_snapshot(date_from, date_to, result)
            self._send_json(200, {"ok": True, **result, **db_result})
        except Exception as error:
            LOGGER.exception("Audit dashboard fetch failed: %s", error)
            self._send_json(status_for_error(error), {"ok": False, "error": public_error_message(error)})

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s | %s", self.address_string(), format % args)


def main() -> None:
    server = ThreadingHTTPServer((HELPER_HOST, HELPER_PORT), Handler)
    LOGGER.info("LNPI Audit Tally Helper running at http://%s:%s", HELPER_HOST, HELPER_PORT)
    LOGGER.info("Log file: %s", LOG_FILE)
    LOGGER.info("Checking Tally XML/HTTP candidates when requested: %s", ", ".join(build_tally_url_candidates()))
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        LOGGER.info("Stopped by keyboard interrupt.")
        sys.exit(0)
