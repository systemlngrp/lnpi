import json
import logging
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

BASE_DIR = Path(__file__).resolve().parent
LOG_FILE = BASE_DIR / "tally_audit_dashboard_helper.log"


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

HELPER_HOST = "127.0.0.1"
HELPER_PORT = 8765
REQUEST_TIMEOUT = 8
TALLY_URL_CANDIDATES = [
    f"http://{host}:{port}"
    for port in range(9000, 9005)
    for host in ("localhost", "127.0.0.1")
]
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
    <VERSION>1</VERSION>
    <TALLYREQUEST>EXPORT</TALLYREQUEST>
    <TYPE>COLLECTION</TYPE>
    <ID>LnpiAuditVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVFROMDATE>{date_from}</SVFROMDATE>
        <SVTODATE>{date_to}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LnpiAuditVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Date</FETCH>
            <FETCH>VoucherNumber</FETCH>
            <FETCH>VoucherTypeName</FETCH>
            <FETCH>IsCancelled</FETCH>
            <FETCH>IsOptional</FETCH>
            <FETCH>Amount</FETCH>
            <COMPUTE>LnpiVoucherAmount:$Amount</COMPUTE>
            <FILTERS>LnpiAuditVoucherType</FILTERS>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="LnpiAuditVoucherType">$$StringEqual:$VoucherTypeName:"{safe_type}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""


def post_xml_to_url(url: str, payload: str) -> str:
    response = requests.post(
        url,
        data=payload.encode("utf-8"),
        headers={"Content-Type": "application/xml"},
        timeout=REQUEST_TIMEOUT,
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


def parse_voucher_total(xml_text: str) -> tuple[float, int]:
    cleaned = clean_tally_xml(xml_text)
    if not cleaned:
        return 0.0, 0
    root = ET.fromstring(cleaned)
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
        raw_amount = child_text(voucher, ("LNPIVOUCHERAMOUNT", "AMOUNT"))
        if not raw_amount:
            for amount_node in voucher.iter():
                amount_tag = amount_node.tag.split("}", 1)[-1].upper()
                if amount_tag == "AMOUNT" and amount_node.text:
                    raw_amount = amount_node.text
                    break
        total += abs(parse_amount(raw_amount))
        count += 1
    return round_money(total), count


def fetch_tally_values(date_from: str, date_to: str) -> dict[str, Any]:
    tally_from = normalize_date_for_tally(date_from)
    tally_to = normalize_date_for_tally(date_to)
    last_errors: list[str] = []
    LOGGER.info("Fetch requested for app date range %s to %s / Tally range %s to %s", date_from, date_to, tally_from, tally_to)

    for url in TALLY_URL_CANDIDATES:
        try:
            LOGGER.info("Trying Tally XML URL %s", url)
            values: dict[str, float] = {}
            counts: dict[str, int] = {}
            for field, voucher_type in VOUCHER_TYPES.items():
                xml_text = build_voucher_collection_xml(voucher_type, tally_from, tally_to)
                response_text = post_xml_to_url(url, xml_text)
                total, count = parse_voucher_total(response_text)
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

    LOGGER.error("No Tally XML/HTTP port responded from 9000 to 9004. Last errors: %s", " | ".join(last_errors[-4:]))
    raise RuntimeError("No Tally XML/HTTP port responded from 9000 to 9004. " + " | ".join(last_errors[-4:]))


def allowed_origin(origin: str) -> str:
    if any(pattern.match(origin or "") for pattern in ALLOWED_ORIGIN_PATTERNS):
        return origin
    return "*"


class Handler(BaseHTTPRequestHandler):
    server_version = "LNPIAuditTallyHelper/1.0"

    def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        origin = self.headers.get("Origin", "")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", allowed_origin(origin))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self._send_json(200, {"ok": True})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            LOGGER.info("Health check from %s", self.client_address[0])
            self._send_json(200, {"ok": True, "helper": self.server_version, "ports": list(range(9000, 9005)), "logFile": str(LOG_FILE)})
            return
        self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/audit-dashboard/tally-values":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            body = self.rfile.read(length).decode("utf-8") if length else "{}"
            data = json.loads(body or "{}")
            date_from = str(data.get("dateFrom") or "").strip()
            date_to = str(data.get("dateTo") or "").strip()
            if not date_from or not date_to:
                raise ValueError("dateFrom and dateTo are required.")
            LOGGER.info("Audit dashboard fetch request from %s for %s to %s", self.client_address[0], date_from, date_to)
            result = fetch_tally_values(date_from, date_to)
            self._send_json(200, {"ok": True, **result})
        except Exception as error:
            LOGGER.exception("Audit dashboard fetch failed: %s", error)
            self._send_json(500, {"ok": False, "error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s | %s", self.address_string(), format % args)


def main() -> None:
    server = ThreadingHTTPServer((HELPER_HOST, HELPER_PORT), Handler)
    LOGGER.info("LNPI Audit Tally Helper running at http://%s:%s", HELPER_HOST, HELPER_PORT)
    LOGGER.info("Log file: %s", LOG_FILE)
    LOGGER.info("Checking Tally XML/HTTP on localhost ports 9000 to 9004 when requested.")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        LOGGER.info("Stopped by keyboard interrupt.")
        sys.exit(0)
