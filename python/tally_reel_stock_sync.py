import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

try:
    import mysql.connector
except ImportError:
    mysql = None


BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / "tally_reel_stock_sync.env"
DEFAULT_TALLY_URL = "http://127.0.0.1:9004"


def load_env_file(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return

    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            print(f"Ignoring invalid env line {line_no} in {path}")
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            print(f"Ignoring env line {line_no} with empty key in {path}")
            continue
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def first_env_value(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def parse_port(value: str, default: int) -> int:
    try:
        port = int(value or str(default))
    except ValueError:
        return default
    return port if 1 <= port <= 65535 else default


def get_db_config() -> dict[str, Any]:
    config = {
        "host": first_env_value("LNPI_DB_HOST", "DB_HOST"),
        "user": first_env_value("LNPI_DB_USER", "DB_USER"),
        "password": first_env_value("LNPI_DB_PASSWORD", "DB_PASSWORD"),
        "database": first_env_value("LNPI_DB_NAME", "DB_NAME"),
        "port": parse_port(first_env_value("LNPI_DB_PORT", "DB_PORT"), 3306),
    }
    missing = [key for key in ("host", "user", "password", "database") if not config[key]]
    if missing:
        raise RuntimeError(
            "Missing DB config in env file or environment: "
            + ", ".join(missing)
            + f". Create {ENV_FILE} with LNPI_DB_HOST, LNPI_DB_USER, LNPI_DB_PASSWORD, LNPI_DB_NAME."
        )
    return config


def clean_xml(text: str) -> str:
    cleaned = str(text or "").lstrip("\ufeff")
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", cleaned)
    cleaned = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)", "&amp;", cleaned)
    return cleaned.strip()


def normalize_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def parse_qty(value: Any) -> float:
    text = str(value or "").replace(",", "").strip()
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return 0.0
    qty = float(match.group(0))
    return -abs(qty) if "cr" in text.casefold() else qty


def child_text(element: ET.Element, *names: str) -> str:
    wanted = {name.upper() for name in names}
    for child in list(element):
        tag = child.tag.split("}", 1)[-1].upper()
        if tag in wanted:
            return str(child.text or "").strip()
    return ""


def build_tally_stock_xml() -> str:
    return """
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LNPIReelClosingStock</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LNPIReelClosingStock">
            <TYPE>StockItem</TYPE>
            <FETCH>Name</FETCH>
            <FETCH>PartNo</FETCH>
            <FETCH>PartNumber</FETCH>
            <FETCH>ClosingBalance</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""


def fetch_tally_stock_items() -> list[dict[str, Any]]:
    tally_url = first_env_value("TALLY_URL") or DEFAULT_TALLY_URL
    response = requests.post(
        tally_url,
        data=build_tally_stock_xml().encode("utf-8"),
        headers={"Content-Type": "application/xml"},
        timeout=60,
    )
    response.raise_for_status()

    root = ET.fromstring(clean_xml(response.text))
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in root.iter():
        if item.tag.split("}", 1)[-1].upper() != "STOCKITEM":
            continue
        name = str(item.get("NAME") or child_text(item, "NAME")).strip()
        if not name:
            continue
        key = normalize_key(name)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "name": name,
                "partNo": child_text(item, "PARTNO", "PARTNUMBER"),
                "closingStock": parse_qty(child_text(item, "CLOSINGBALANCE")),
            }
        )
    return rows


def match_tally_item(material: dict[str, Any], tally_items: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    erp_key = normalize_key(material.get("erpCode"))
    name_key = normalize_key(material.get("name"))

    if erp_key:
        for item in tally_items:
            if normalize_key(item.get("partNo")) == erp_key:
                return item, "part_no_equals_erp"
        for item in tally_items:
            if normalize_key(item.get("name")) == erp_key:
                return item, "name_equals_erp"
        for item in tally_items:
            if normalize_key(item.get("name")).startswith(erp_key):
                return item, "name_starts_with_erp"

    if name_key:
        for item in tally_items:
            if normalize_key(item.get("name")) == name_key:
                return item, "name_exact"

    return None, "unmatched"


def ensure_material_tally_columns(cursor: Any) -> None:
    cursor.execute("SHOW COLUMNS FROM `materials`")
    existing = {str(row[0]) for row in cursor.fetchall()}
    required = {
        "tallyStock": "DECIMAL(15,2) NULL",
        "tallyTimestamp": "VARCHAR(255) NULL",
        "tallySyncRemark": "TEXT",
    }
    for column, column_type in required.items():
        if column not in existing:
            cursor.execute(f"ALTER TABLE `materials` ADD COLUMN `{column}` {column_type}")


def sync_reel_tally_stock() -> None:
    if mysql is None:
        raise RuntimeError("mysql-connector-python is not installed. Run: pip install mysql-connector-python")

    load_env_file()
    db_config = get_db_config()
    tally_items = fetch_tally_stock_items()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    connection = mysql.connector.connect(**db_config)
    try:
        cursor = connection.cursor(dictionary=True)
        ensure_material_tally_columns(cursor)
        cursor.execute("SELECT id, erpCode, name FROM `materials` WHERE `type` = 'Reel'")
        materials = cursor.fetchall()

        updates = []
        unmatched = 0
        for material in materials:
            tally_item, match_rule = match_tally_item(material, tally_items)
            if not tally_item:
                unmatched += 1
                continue
            updates.append(
                (
                    round(float(tally_item["closingStock"] or 0), 2),
                    now,
                    f"Matched Tally item '{tally_item['name']}' by {match_rule}.",
                    material["id"],
                )
            )

        if updates:
            cursor.executemany(
                """
                UPDATE `materials`
                SET `tallyStock` = %s,
                    `tallyTimestamp` = %s,
                    `tallySyncRemark` = %s
                WHERE `id` = %s
                """,
                updates,
            )
        connection.commit()
        cursor.close()

        print(f"Fetched Tally stock items: {len(tally_items)}")
        print(f"Reel materials checked: {len(materials)}")
        print(f"Materials updated: {len(updates)}")
        print(f"Unmatched reel materials: {unmatched}")
    finally:
        if connection.is_connected():
            connection.close()


if __name__ == "__main__":
    try:
        sync_reel_tally_stock()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
