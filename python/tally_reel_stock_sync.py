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
ROOT_ENV_FILE = BASE_DIR.parent / ".env"
ENV_FILE = BASE_DIR / "tally_reel_stock_sync.env"
DEFAULT_TALLY_URL = "http://127.0.0.1:9004"
NUMBER_TOLERANCE = 0.01

COLOR_ALIASES = {
    "ns": "natural",
    "natural": "natural",
    "lg": "red",
    "red": "red",
}


def load_env_file(path: Path, override: bool = False) -> None:
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
        value = value.strip().strip('"').strip("'")
        if override:
            os.environ[key] = value
        else:
            os.environ.setdefault(key, value)


def load_env_files() -> None:
    load_env_file(ROOT_ENV_FILE)
    load_env_file(ENV_FILE, override=True)


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
            + f". Add DB_HOST, DB_USER, DB_PASSWORD, DB_NAME to {ROOT_ENV_FILE}, "
            + f"or create {ENV_FILE} with LNPI_DB_HOST, LNPI_DB_USER, LNPI_DB_PASSWORD, LNPI_DB_NAME."
        )
    return config


def clean_xml(text: str) -> str:
    if not text:
        return ""
    cleaned = str(text).lstrip("\ufeff")
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", cleaned)
    cleaned = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)", "&amp;", cleaned)
    return cleaned.strip()


def normalize_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def normalize_color(value: Any) -> str:
    text = normalize_key(value)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if not text:
        return ""

    for part in text.split():
        if part in COLOR_ALIASES:
            return COLOR_ALIASES[part]
    return COLOR_ALIASES.get(text, text)


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def find_number(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return parse_number(match.group(1)) if match else None


def same_number(left: Any, right: Any) -> bool:
    left_number = parse_number(left)
    right_number = parse_number(right)
    if left_number is None or right_number is None:
        return False
    return abs(left_number - right_number) <= NUMBER_TOLERANCE


def spec_key(color: Any, bf: Any, size: Any, gsm: Any) -> tuple[str, float, float, float] | None:
    color_key = normalize_color(color)
    bf_number = parse_number(bf)
    size_number = parse_number(size)
    gsm_number = parse_number(gsm)
    if not color_key or bf_number is None or size_number is None or gsm_number is None:
        return None
    return (color_key, round(bf_number, 2), round(size_number, 2), round(gsm_number, 2))


def spec_label(key: tuple[str, float, float, float] | None) -> str:
    if not key:
        return "unparsed spec"
    color, bf, size, gsm = key
    color_label = "Natural" if color == "natural" else "Red" if color == "red" else color
    return f"{color_label} / {bf:g} BF / {size:g} CM / {gsm:g} GSM"


def parse_tally_reel_spec(name: Any) -> dict[str, Any]:
    text = str(name or "").strip()
    normalized = re.sub(r"\s+", " ", text)
    first_token = normalized.split(" ", 1)[0] if normalized else ""
    spec = {
        "color": normalize_color(first_token),
        "bf": find_number(r"(\d+(?:\.\d+)?)\s*BF\b", normalized),
        "size": find_number(r"(\d+(?:\.\d+)?)\s*CM\b", normalized),
        "gsm": find_number(r"(\d+(?:\.\d+)?)\s*GSM\b", normalized),
    }
    spec["specKey"] = spec_key(spec["color"], spec["bf"], spec["size"], spec["gsm"])
    return spec


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
    tally_url = first_env_value("REEL_TALLY_URL", "TALLY_REEL_STOCK_URL") or DEFAULT_TALLY_URL
    print(f"Fetching Tally closing stock from {tally_url}")
    response = requests.post(
        tally_url,
        data=build_tally_stock_xml().encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8"},
        timeout=30,
    )
    try:
        response.raise_for_status()
    except Exception as error:
        raise RuntimeError(f"Failed to connect to Tally on {tally_url}. Check Tally is open and XML/HTTP is enabled on port 9004. {error}") from error

    try:
        root = ET.fromstring(clean_xml(response.text))
    except ET.ParseError as error:
        raise RuntimeError(f"Tally returned invalid XML for closing stock: {error}") from error

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
                **parse_tally_reel_spec(name),
            }
        )
    return rows


def aggregate_tally_specs(tally_items: list[dict[str, Any]]) -> dict[tuple[str, float, float, float], dict[str, Any]]:
    aggregates: dict[tuple[str, float, float, float], dict[str, Any]] = {}
    for item in tally_items:
        key = item.get("specKey")
        if not key:
            continue
        aggregate = aggregates.setdefault(
            key,
            {
                "name": item.get("name") or "",
                "partNo": item.get("partNo") or "",
                "closingStock": 0.0,
                "items": [],
                "specKey": key,
            },
        )
        aggregate["closingStock"] += float(item.get("closingStock") or 0)
        aggregate["items"].append(item)
    return aggregates


def material_spec_key(material: dict[str, Any]) -> tuple[str, float, float, float] | None:
    return spec_key(material.get("color"), material.get("bf"), material.get("size"), material.get("gsm"))


def match_tally_item(
    material: dict[str, Any],
    tally_items: list[dict[str, Any]],
    tally_spec_totals: dict[tuple[str, float, float, float], dict[str, Any]],
) -> tuple[dict[str, Any] | None, str]:
    erp_key = normalize_key(material.get("erpCode"))
    name_key = normalize_key(material.get("name"))

    if erp_key:
        for item in tally_items:
            if normalize_key(item.get("partNo")) == erp_key:
                return item, "part_no_equals_erp"

    key = material_spec_key(material)
    if key and key in tally_spec_totals:
        return tally_spec_totals[key], "spec_equals_material"

    if erp_key:
        for item in tally_items:
            if normalize_key(item.get("name")) == erp_key:
                return item, "name_equals_erp"

    if name_key:
        for item in tally_items:
            if normalize_key(item.get("name")) == name_key:
                return item, "name_exact"

    return None, "unmatched"


def ensure_material_tally_columns(cursor: Any) -> None:
    cursor.execute("SHOW COLUMNS FROM `materials`")
    existing = {str(row.get("Field") if isinstance(row, dict) else row[0]) for row in cursor.fetchall()}
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

    load_env_files()
    db_config = get_db_config()
    print(f"Loaded DB config from {ROOT_ENV_FILE}: {db_config['host']}:{db_config['port']} / {db_config['database']} / user={db_config['user']} / password=***")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    connection = mysql.connector.connect(**db_config)
    try:
        cursor = connection.cursor(dictionary=True)
        ensure_material_tally_columns(cursor)
        cursor.execute("SELECT id, erpCode, name, size, gsm, bf, color FROM `materials` WHERE `type` = 'Reel'")
        materials = cursor.fetchall()
        print(f"Fetched reel materials from DB: {len(materials)}")

        if not materials:
            print("No reel materials found in DB. Nothing to update.")
            connection.commit()
            cursor.close()
            return

        tally_items = fetch_tally_stock_items()
        tally_spec_totals = aggregate_tally_specs(tally_items)

        updates = []
        comparison_rows = []
        unmatched = 0
        for material in materials:
            tally_item, match_rule = match_tally_item(material, tally_items, tally_spec_totals)
            if not tally_item:
                unmatched += 1
                comparison_rows.append((material.get("name") or "", material.get("erpCode") or "", None, None, "NOT IN TALLY"))
                continue

            tally_qty = round(float(tally_item["closingStock"] or 0), 2)
            item_count = len(tally_item.get("items") or [tally_item])
            matched_spec = tally_item.get("specKey") or material_spec_key(material)
            comparison_rows.append((material.get("name") or "", material.get("erpCode") or "", tally_qty, match_rule, "MATCHED"))

            if match_rule == "spec_equals_material":
                suffix = "s" if item_count != 1 else ""
                remark = f"Matched Tally spec {spec_label(matched_spec)} from {item_count} item{suffix}."
            else:
                remark = f"Matched Tally item '{tally_item['name']}' by {match_rule}."

            updates.append(
                (
                    tally_qty,
                    now,
                    remark,
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
        print(f"Parsed Tally reel specs: {len(tally_spec_totals)}")
        print(f"Reel materials checked: {len(materials)}")
        print(f"Materials updated: {len(updates)}")
        print(f"Unmatched reel materials: {unmatched}")
        print("=" * 120)
        print(f"  MATERIAL REEL STOCK TALLY SYNC | Synced at: {now}")
        print("=" * 120)
        print(f"  {'ERP':<16} {'MATERIAL NAME':<65} {'TALLY STOCK':>14} {'MATCH RULE':<22} STATUS")
        print("-" * 120)
        for material_name, erp_code, tally_qty, match_rule, status in comparison_rows:
            tally_text = "N/A" if tally_qty is None else f"{tally_qty:,.2f}"
            print(f"  {str(erp_code):<16} {str(material_name)[:65]:<65} {tally_text:>14} {str(match_rule or '-'):<22} {status}")
        print("=" * 120)
    finally:
        if connection.is_connected():
            connection.close()


if __name__ == "__main__":
    try:
        sync_reel_tally_stock()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
