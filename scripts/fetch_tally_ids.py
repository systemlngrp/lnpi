import os
import mysql.connector
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(override=True)

# Configuration
DB_HOST = os.getenv('DB_HOST', '193.203.184.152').strip()
if DB_HOST in ('.', 'localhost'):
    DB_HOST = '127.0.0.1'
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME')
DB_PORT = int(os.getenv('DB_PORT', '3306'))
TALLY_URL = os.getenv('TALLY_URL', 'http://127.0.0.1:9000').strip()

def log_terminal(status, message):
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {status:7} | {message}")

def tally_request(xml_content):
    try:
        response = requests.post(TALLY_URL, data=xml_content, headers={'Content-Type': 'text/xml'})
        if response.status_code == 200:
            return response.text
        else:
            return None
    except Exception as e:
        log_terminal("ERROR", f"Tally connection error: {e}")
        return None

def get_all_tally_items():
    """Fetches all stock items with their GUIDs from Tally."""
    items = {} # name -> guid
    
    xml = """<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <COLLECTIONNAME>StockItem</COLLECTIONNAME>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""

    res = tally_request(xml)
    if not res:
        return items

    try:
        root = ET.fromstring(res)
        for si in root.findall('.//STOCKITEM'):
            guid = si.get('GUID')
            # Try to find name in various places
            name = None
            name_elem = si.find('NAME')
            if name_elem is not None and name_elem.text:
                name = name_elem.text.strip()
            else:
                name_attr = si.get('NAME')
                if name_attr:
                    name = name_attr.strip()
            
            if name and guid:
                items[name.upper()] = guid

    except Exception as e:
        log_terminal("ERROR", f"XML Parsing error: {e}")
        # Fallback regex
        import re
        si_blocks = re.findall(r'<STOCKITEM[^>]*>(.*?)</STOCKITEM>', res, re.DOTALL | re.IGNORECASE)
        for block in si_blocks:
            guid_match = re.search(r'GUID="(.*?)"', block, re.IGNORECASE)
            name_match = re.search(r'<NAME[^>]*>(.*?)</NAME>', block, re.IGNORECASE)
            if guid_match and name_match:
                items[name_match.group(1).strip().upper()] = guid_match.group(1).strip()

    return items

def main():
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            port=DB_PORT
        )
        cursor = conn.cursor(dictionary=True)
    except Exception as e:
        log_terminal("ERROR", f"Database connection failed: {e}")
        return

    log_terminal("INFO", "Fetching all Stock Items from Tally...")
    tally_items = get_all_tally_items()
    
    if not tally_items:
        log_terminal("ERROR", "No items found in Tally. Check connection and company.")
        conn.close()
        return

    log_terminal("INFO", f"Found {len(tally_items)} items in Tally.")

    # Fetch materials that don't have a Tally ID yet
    cursor.execute("SELECT id, name FROM materials WHERE tallyMaterialId IS NULL OR tallyMaterialId = ''")
    pending = cursor.fetchall()
    
    if not pending:
        log_terminal("INFO", "All materials already have Tally IDs. Nothing to fetch.")
        conn.close()
        return

    log_terminal("INFO", f"Checking {len(pending)} materials for matches...")
    linked_count = 0
    
    for mat in pending:
        mat_name_upper = mat['name'].strip().upper()
        if mat_name_upper in tally_items:
            guid = tally_items[mat_name_upper]
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            remark = "Linked existing Tally ID by name."
            
            cursor.execute(
                "UPDATE materials SET tallyMaterialId = %s, tallyTimestamp = %s, tallySyncRemark = %s WHERE id = %s",
                (guid, timestamp, remark, mat['id'])
            )
            log_terminal("SUCCESS", f"Linked: {mat['name']} -> {guid}")
            linked_count += 1
        
    conn.commit()
    log_terminal("INFO", f"Completed. Linked {linked_count} materials.")
    conn.close()

if __name__ == "__main__":
    main()
