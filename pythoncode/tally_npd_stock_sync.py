import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime
import requests
import mysql.connector

# =========================
# CONFIG — edit here if needed
# =========================
DB_HOST     = "193.203.184.152"
DB_PORT     = 3306
DB_USER     = "u380633007_lnpidata"
DB_PASSWORD = "!Office1@"
DB_NAME     = "u380633007_lnpidata"
TALLY_URL   = "http://127.0.0.1:9004"

# =========================
# TALLY XML HELPERS
# =========================

def sanitize_tally_xml(xml_text: str) -> str:
    if not xml_text:
        return xml_text
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    return cleaned

def parse_tally_stock(text: str) -> float:
    if not text:
        return 0.0
    text_clean = text.replace(',', '').strip()
    match = re.search(r'(-?\d+(?:\.\d+)?)', text_clean)
    if not match:
        return 0.0
    val = float(match.group(1))
    if "cr" in text_clean.lower():
        val = -abs(val)
    return val

def fetch_tally_stocks() -> dict:
    xml_request = """<ENVELOPE>
      <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Collection</TYPE>
        <ID>StockItemClosingStock</ID>
      </HEADER>
      <BODY>
        <DESC>
          <STATICVARIABLES>
            <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          </STATICVARIABLES>
          <TDL>
            <TDLMESSAGE>
              <COLLECTION NAME="StockItemClosingStock">
                <TYPE>StockItem</TYPE>
                <FETCH>Name</FETCH>
                <FETCH>ClosingBalance</FETCH>
              </COLLECTION>
            </TDLMESSAGE>
          </TDL>
        </DESC>
      </BODY>
    </ENVELOPE>"""

    print(f"Connecting to Tally at {TALLY_URL}...")
    try:
        response = requests.post(
            TALLY_URL,
            data=xml_request.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8"},
            timeout=30
        )
        response.raise_for_status()
    except Exception as e:
        print(f"  ERROR: Failed to connect to Tally: {e}")
        return {}

    cleaned_xml = sanitize_tally_xml(response.text)
    try:
        root = ET.fromstring(cleaned_xml)
    except ET.ParseError as e:
        print(f"  ERROR: XML parse failed: {e}")
        return {}

    stocks = {}
    for item in root.findall(".//STOCKITEM"):
        name = (item.get("NAME") or item.findtext("NAME") or "").strip()
        closing_bal = (item.findtext("CLOSINGBALANCE") or "").strip()
        if name:
            stocks[name.lower()] = parse_tally_stock(closing_bal)

    return stocks

# =========================
# DATABASE OPERATIONS
# =========================

def get_db_connection():
    return mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME
    )

def sync_and_compare(stocks: dict):
    """
    1. Fetch all active NPD items with their App Balance from DB.
    2. Update tallyStock + tallyTimestamp for matched items.
    3. Print a comparison report: Item Name | App Qty (Balance) | Tally Stock | Difference | Status
    """
    print(f"\nConnecting to MySQL {DB_NAME} at {DB_HOST}...")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
    except Exception as e:
        print(f"  ERROR: Cannot connect to database: {e}")
        return

    # Fetch itemName + balance (app qty) for all active NPD items
    try:
        cursor.execute(
            "SELECT id, itemName, COALESCE(balance, 0) as balance FROM npd WHERE syncStatus = 'active'"
        )
        npd_items = cursor.fetchall()
    except Exception as e:
        print(f"  ERROR: Failed to fetch NPD items: {e}")
        conn.close()
        return

    print(f"  Found {len(npd_items)} active NPD items.\n")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updated_count = 0
    matched_count = 0
    unmatched_count = 0

    # Build comparison rows
    comparison_rows = []

    for npd_id, item_name, app_balance in npd_items:
        normalized_name = (item_name or "").strip().lower()
        app_qty = float(app_balance or 0)

        if normalized_name in stocks:
            tally_qty = stocks[normalized_name]
            matched_count += 1
            # Update DB
            try:
                cursor.execute(
                    "UPDATE npd SET tallyStock = %s, tallyTimestamp = %s WHERE id = %s",
                    (tally_qty, now_str, npd_id)
                )
                updated_count += 1
            except Exception as e:
                print(f"  WARN: Could not update {item_name}: {e}")

            diff = tally_qty - app_qty
            status = "MATCH" if abs(diff) < 0.01 else "DIFF"
            comparison_rows.append((item_name, app_qty, tally_qty, diff, status))
        else:
            unmatched_count += 1
            # Not found in Tally — still include in report
            comparison_rows.append((item_name, app_qty, None, None, "NOT IN TALLY"))

    conn.commit()
    cursor.close()
    conn.close()

    # =========================================
    # PRINT COMPARISON REPORT
    # =========================================
    col_w = 55  # item name column width
    print("=" * (col_w + 60))
    print(f"  NPD ITEM STOCK COMPARISON  |  Synced at: {now_str}")
    print("=" * (col_w + 60))
    print(f"  {'ITEM NAME':<{col_w}} {'APP QTY (Balance)':>18} {'TALLY STOCK':>13} {'DIFFERENCE':>12} {'STATUS':>12}")
    print("-" * (col_w + 60))

    matched_rows = [r for r in comparison_rows if r[4] != "NOT IN TALLY" and ((r[2] or 0) > 0 or (r[1] or 0) > 0)]
    unmatched_rows = [r for r in comparison_rows if r[4] == "NOT IN TALLY" and (r[1] or 0) > 0]

    # Sort: DIFF items first, then MATCH, then NOT IN TALLY
    matched_rows.sort(key=lambda r: (r[4] == "MATCH", r[0]))

    for item_name, app_qty, tally_qty, diff, status in matched_rows:
        tally_str = f"{tally_qty:>12.2f}"
        diff_str  = f"{diff:>+12.2f}"
        flag      = "<-- DIFF" if status == "DIFF" else ""
        print(f"  {item_name:<{col_w}} {app_qty:>18.2f} {tally_str} {diff_str} {status:>10}  {flag}")

    if unmatched_rows:
        print(f"\n  -- {len(unmatched_rows)} items not found in Tally --")
        for item_name, app_qty, _, __, ___ in unmatched_rows[:20]:
            print(f"  {item_name:<{col_w}} {app_qty:>18.2f} {'N/A':>13} {'N/A':>12} {'NOT IN TALLY':>12}")
        if len(unmatched_rows) > 20:
            print(f"  ... and {len(unmatched_rows) - 20} more not shown")

    print("=" * (col_w + 60))
    print(f"  SUMMARY:  Total NPD items: {len(npd_items)}")
    print(f"            Matched in Tally: {matched_count}  |  Not in Tally: {unmatched_count}")
    print(f"            DB Updated:  {updated_count} items")
    diff_count = sum(1 for r in matched_rows if r[4] == "DIFF")
    match_count = sum(1 for r in matched_rows if r[4] == "MATCH")
    print(f"            Stock Match: {match_count}  |  Stock Diff: {diff_count}")
    print("=" * (col_w + 60))


# =========================
# MAIN
# =========================

if __name__ == "__main__":
    stocks = fetch_tally_stocks()
    if stocks:
        print(f"  Fetched {len(stocks)} stock items from Tally.")
        sync_and_compare(stocks)
    else:
        print("  No stock items retrieved from Tally. Is Tally open and XML/HTTP enabled on port 9004?")



