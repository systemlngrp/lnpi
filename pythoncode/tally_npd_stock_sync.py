import os
import sys
import re
import xml.etree.ElementTree as ET
from datetime import datetime
import requests
import mysql.connector
from dotenv import load_dotenv

# Load configuration from .env file
def load_runtime_env():
    env_paths = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            load_dotenv(env_path, override=True)
            return
    load_dotenv(override=True)

load_runtime_env()

DB_HOST = os.getenv('DB_HOST', '127.0.0.1').strip()
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME')
DB_PORT = int(os.getenv('DB_PORT', '3306'))
TALLY_URL = os.getenv('TALLY_URL', 'http://127.0.0.1:9000').strip()

def sanitize_tally_xml(xml_text: str) -> str:
    if not xml_text:
        return xml_text
    # Remove invalid XML entities/characters which Tally sometimes produces
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    return cleaned

def parse_tally_stock(text: str) -> float:
    if not text:
        return 0.0
    # Strip commas and whitespace
    text_clean = text.replace(',', '').strip()
    match = re.search(r'(-?\d+(?:\.\d+)?)', text_clean)
    if not match:
        return 0.0
    val = float(match.group(1))
    # If the text contains "Cr" or "CR" (credit balance for stock is negative)
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
        print(f"Failed to fetch stock items from Tally: {e}")
        return {}

    cleaned_xml = sanitize_tally_xml(response.text)
    try:
        root = ET.fromstring(cleaned_xml)
    except ET.ParseError as e:
        print(f"XML parse failed: {e}")
        return {}

    stocks = {}
    for item in root.findall(".//STOCKITEM"):
        name = (item.get("NAME") or item.findtext("NAME") or "").strip()
        closing_bal = (item.findtext("CLOSINGBALANCE") or "").strip()
        if name:
            stocks[name.lower()] = parse_tally_stock(closing_bal)
            
    return stocks

def update_db(stocks: dict):
    if not all([DB_HOST, DB_USER, DB_PASSWORD, DB_NAME]):
        print("Missing database credentials in .env file.")
        return

    print(f"Connecting to MySQL database {DB_NAME} at {DB_HOST}...")
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME
        )
        cursor = conn.cursor()
    except Exception as e:
        print(f"Failed to connect to database: {e}")
        return

    # Fetch all NPD items to match names
    try:
        cursor.execute("SELECT id, itemName FROM npd WHERE syncStatus = 'active'")
        npd_items = cursor.fetchall()
    except Exception as e:
        print(f"Failed to fetch NPD items from database: {e}")
        conn.close()
        return

    print(f"Found {len(npd_items)} active NPD items. Matching and updating stocks...")
    updated_count = 0
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for npd_id, item_name in npd_items:
        normalized_name = (item_name or "").strip().lower()
        if normalized_name in stocks:
            stock_qty = stocks[normalized_name]
            try:
                cursor.execute(
                    "UPDATE npd SET tallyStock = %s, tallyTimestamp = %s WHERE id = %s",
                    (stock_qty, now_str, npd_id)
                )
                updated_count += 1
            except Exception as e:
                print(f"Failed to update stock for {item_name}: {e}")

    conn.commit()
    cursor.close()
    conn.close()
    print(f"Successfully updated {updated_count} NPD items with Tally Stock value at {now_str}.")

if __name__ == "__main__":
    stocks = fetch_tally_stocks()
    if stocks:
        print(f"Fetched {len(stocks)} stock items from Tally.")
        update_db(stocks)
    else:
        print("No stock items retrieved from Tally.")
