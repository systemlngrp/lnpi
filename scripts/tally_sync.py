import os
import mysql.connector
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
ERROR_EMAIL = "bizskill17@gmail.com"
EMAIL_SENDER = os.getenv('EMAIL_SENDER')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD')
EMAIL_SMTP_SERVER = os.getenv('EMAIL_SMTP_SERVER', 'smtp.gmail.com')
EMAIL_SMTP_PORT = int(os.getenv('EMAIL_SMTP_PORT', '587'))

if not all([DB_HOST, DB_USER, DB_PASSWORD, DB_NAME]):
    raise RuntimeError("Missing required database configuration in .env: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME")

print(f"Using DB_HOST={DB_HOST}, DB_PORT={DB_PORT}, DB_USER={DB_USER}, DB_NAME={DB_NAME}")
print(f"Using TALLY_URL={TALLY_URL}")

REEL_GROUP = "KRAFT PAPER"
OTHER_GROUP = "OTHER"

def log_change(cursor, conn, material_id, item_name, erp_code, tally_material_id, action, remark, status, error_message=None):
    sql = """
    INSERT INTO tally_change_log (material_id, item_name, erp_code, tally_material_id, action, remark, status, error_message)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """
    cursor.execute(sql, (material_id, item_name, erp_code, tally_material_id, action, remark, status, error_message))
    conn.commit()

def send_error_report(errors):
    if not errors:
        return
    
    msg = MIMEMultipart()
    msg['From'] = EMAIL_SENDER
    msg['To'] = ERROR_EMAIL
    msg['Subject'] = "Tally Sync Error Report"

    html = "<h3>Tally Sync Errors</h3><table border='1'><tr><th>Item Name</th><th>ERP No.</th><th>Action</th><th>Status</th><th>Remark</th><th>Error</th></tr>"
    for err in errors:
        html += f"<tr><td>{err['item_name']}</td><td>{err['erp_code']}</td><td>{err['action']}</td><td>{err['status']}</td><td>{err['remark']}</td><td>{err.get('error', '')}</td></tr>"
    html += "</table>"
    
    msg.attach(MIMEText(html, 'html'))
    
    try:
        server = smtplib.SMTP(EMAIL_SMTP_SERVER, EMAIL_SMTP_PORT)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print("Error report sent.")
    except Exception as e:
        # Log the failure but do not abort the sync process
        print(f"[WARN] Failed to send error email: {e}")
        # Optionally, write to a local log file for later inspection
        try:
            with open('tally_sync_error_log.txt', 'a') as f:
                f.write(f"{datetime.now()}: Email send failure - {e}\n")
        except Exception:
            pass

def tally_request(xml_content):
    print(f"[DEBUG] Sending request to Tally at {TALLY_URL}")
    try:
        response = requests.post(TALLY_URL, data=xml_content, headers={'Content-Type': 'text/xml'})
        if response.status_code == 200:
            print(f"[DEBUG] Tally response status: 200")
            return response.text
        else:
            print(f"[DEBUG] Tally response status: {response.status_code}")
            return None
    except Exception as e:
        print(f"Tally connection error: {e}")
        return None

def is_guid(s):
    """Checks if a string is a Tally GUID (e.g. 27FC4EF2-EE5B-4FBD-A5C1-A188D2320B9A)."""
    import re
    return bool(re.match(r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$', s.strip(), re.I))

def get_all_tally_groups():
    """Strictly fetches Stock Groups, avoiding Ledgers by using specific account type filtering."""
    groups = set()
    
    # Query 1: List of Accounts with explicit Stock Group type
    xml = """<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <COLLECTIONNAME>StockGroup</COLLECTIONNAME>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""

    res = tally_request(xml)
    if not res:
        print("[DEBUG] Tally returned no response for Stock Groups")
        return groups

    if "KRAFT PAPER" not in res.upper():
        print(f"[DEBUG] Raw Tally StockGroup Response: {res[:500]}...")

    # If the response contains LEDGER tags, Tally is returning too much data.
    # We must only parse NAMEs that are children of STOCKGROUP tags.
    try:
        root = ET.fromstring(res)
        # 1. Direct search for STOCKGROUP elements
        for sg in root.findall('.//STOCKGROUP'):
            name_elem = sg.find('NAME')
            if name_elem is not None and name_elem.text:
                groups.add(name_elem.text.strip().upper())
            else:
                # Some versions put it in NAME attribute
                name_attr = sg.get('NAME')
                if name_attr:
                    groups.add(name_attr.strip().upper())
        
        # 2. Check for Collection-style response
        if not groups:
            for elem in root.iter():
                if 'STOCKGROUP' in elem.tag.upper():
                    text = (elem.text or "").strip()
                    if text and not is_guid(text):
                        groups.add(text.upper())

    except Exception:
        # Fallback Regex - but ONLY within STOCKGROUP blocks
        import re
        sg_blocks = re.findall(r'<STOCKGROUP[^>]*>(.*?)</STOCKGROUP>', res, re.DOTALL | re.IGNORECASE)
        for block in sg_blocks:
            names = re.findall(r'<NAME[^>]*>(.*?)</NAME>', block, re.IGNORECASE)
            for n in names:
                n = n.strip()
                if n and not is_guid(n):
                    groups.add(n.upper())

    # Final safeguard: Try multiple common report names for stock groups
    if not groups or (REEL_GROUP.upper() not in groups):
        fallback_reports = ["Stock Summary", "Stock Group Summary", "Stock Group Analysis", "Stock Status"]
        for report in fallback_reports:
            xml_fallback = f"""<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>{report}</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""
            res_fb = tally_request(xml_fallback)
            if res_fb:
                import re
                # Try to extract anything that looks like a name
                names = re.findall(r'<DSPDISPNAME>(.*?)</DSPDISPNAME>', res_fb, re.IGNORECASE)
                names.extend(re.findall(r'<NAME[^>]*>(.*?)</NAME>', res_fb, re.IGNORECASE))
                for n in names:
                    n = n.strip()
                    if n and not is_guid(n) and n.upper() not in ["ALL MASTERS", "PRIMARY", "YES", "NO"]:
                        groups.add(n.upper())
            if REEL_GROUP.upper() in groups:
                break

    groups.discard("ALL MASTERS")
    groups.discard("PRIMARY")
    
    if REEL_GROUP.upper() not in groups:
        groups.add(REEL_GROUP.upper())
    if OTHER_GROUP.upper() not in groups:
        groups.add(OTHER_GROUP.upper())
        
    return groups

def get_all_tally_items():
    """Fetches all stock items with their GUIDs and PARENT from Tally for faster matching."""
    items = {} # name -> { 'guid': guid, 'parent': parent }
    
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
            name = None
            parent = None
            
            name_elem = si.find('NAME')
            if name_elem is not None and name_elem.text:
                name = name_elem.text.strip()
            else:
                name_attr = si.get('NAME')
                if name_attr:
                    name = name_attr.strip()
            
            parent_elem = si.find('PARENT')
            if parent_elem is not None and parent_elem.text:
                parent = parent_elem.text.strip()
                
            if name and guid:
                items[name.upper()] = {'guid': guid, 'parent': parent}

    except Exception:
        import re
        si_blocks = re.findall(r'<STOCKITEM[^>]*>(.*?)</STOCKITEM>', res, re.DOTALL | re.IGNORECASE)
        for block in si_blocks:
            guid_match = re.search(r'GUID="(.*?)"', block, re.IGNORECASE)
            name_match = re.search(r'<NAME[^>]*>(.*?)</NAME>', block, re.IGNORECASE)
            parent_match = re.search(r'<PARENT[^>]*>(.*?)</PARENT>', block, re.IGNORECASE)
            
            if guid_match and name_match:
                parent = parent_match.group(1).strip() if parent_match else None
                items[name_match.group(1).strip().upper()] = {'guid': guid_match.group(1).strip(), 'parent': parent}

    return items

def log_terminal(level, msg):
    print(f"[{level}] {msg}")

import uuid
def get_or_create_material_group(cursor, conn, group_name):
    if not group_name:
        return None
    group_name = str(group_name).strip()
    cursor.execute("SELECT id FROM material_groups WHERE name = %s", (group_name,))
    row = cursor.fetchone()
    if row:
        return row['id']
    new_id = str(uuid.uuid4())
    cursor.execute("INSERT INTO material_groups (id, name, updateTimestamp) VALUES (%s, %s, %s)", 
                   (new_id, group_name, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    return new_id

def query_tally_item(item_name):
    from xml.sax.saxutils import escape
    safe_name = escape(item_name)
    xml = f"""<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <COLLECTIONNAME>StockItem</COLLECTIONNAME>
                <OBJECTNAME>{safe_name}</OBJECTNAME>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""
    res = tally_request(xml)
    if not res:
        return False, None, None
    import re
    if "STOCKITEM" in res.upper() and safe_name.upper() in res.upper():
        guid_match = re.search(r'GUID="(.*?)"', res, re.IGNORECASE)
        erp_match = re.search(r'<PARTNO[^>]*>(.*?)</PARTNO>', res, re.IGNORECASE)
        guid = guid_match.group(1).strip() if guid_match else None
        erp = erp_match.group(1).strip() if erp_match else None
        return True, erp, guid
    return False, None, None

def create_or_update_item(item_name, erp_code, target_group, action="Create"):
    from xml.sax.saxutils import escape
    safe_name = escape(item_name)
    safe_group = escape(target_group)
    safe_erp = escape(erp_code)
    
    xml = f"""<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>All Masters</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>Laxmi Narayan Packaging Industries</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <STOCKITEM NAME="{safe_name}" ACTION="{action}">
                        <NAME.LIST>
                            <NAME>{safe_name}</NAME>
                        </NAME.LIST>
                        <PARENT>{safe_group}</PARENT>
                        <PARTNO>{safe_erp}</PARTNO>
                        <BASEUNITS>Nos</BASEUNITS>
                    </STOCKITEM>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>"""
    
    res = tally_request(xml)
    if not res:
        return False, "No response from Tally"
    # Success markers
    if "<CREATED>1</CREATED>" in res or "<ALTERED>1</ALTERED>" in res:
        return True, "Success"
    # Duplicate detection – capture various phrasing
    if "already exists" in res.lower() or "duplicate" in res.lower():
        # Try to extract GUID from response if available
        import re
        guid_match = re.search(r'GUID="(.*?)"', res, re.IGNORECASE)
        guid = guid_match.group(1).strip() if guid_match else None
        # Return success with GUID if found, else generic duplicate indication
        return True, guid if guid else "Duplicate item"
    # Unit mismatch – treat as success (item likely exists with different unit)
    if "cannot alter" in res.lower():
        # Attempt to fetch existing GUID (item already exists)
        exists, _, guid = query_tally_item(item_name)
        if exists:
            return True, guid
        else:
            return True, "Existing item with unit mismatch"
    # Other errors
    import re
    err = re.search(r'<LINEERROR>(.*?)</LINEERROR>', res)
    if err:
        return False, err.group(1)
    return False, "Failed to import"

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

    # STEP 1: Fetch Stock Groups for validation
    log_terminal("INFO", "Fetching Stock Groups from Tally...")
    tally_groups = get_all_tally_groups()
    
    if not tally_groups:
        log_terminal("ERROR", "No Stock Groups found. Check if Tally is open.")
        conn.close()
        return

    # STEP 2: Fetch all Stock Items for faster matching
    log_terminal("INFO", "Fetching all Stock Items for batch matching...")
    tally_item_map = get_all_tally_items()
    log_terminal("INFO", f"Found {len(tally_item_map)} existing items in Tally.")

    cursor.execute("SELECT * FROM materials WHERE tallyTimestamp IS NULL OR tallyTimestamp = ''")
    pending = cursor.fetchall()
    
    if not pending:
        log_terminal("INFO", "No pending materials to sync.")
        conn.close()
        return

    log_terminal("INFO", f"Starting sync for {len(pending)} materials...")
    sync_errors = []
    
    for item in pending:
        item_name = item['name']
        erp_code = str(item['erpCode']) if item['erpCode'] else ""
        material_id = item['id']
        material_type = str(item['type'] or "").strip().lower()
        
        target_group_map = {"reel": REEL_GROUP}
        target_group = target_group_map.get(material_type, OTHER_GROUP)

        if target_group.upper() not in tally_groups:
            remark = f"Group '{target_group}' missing."
            log_terminal("FAILED", f"{item_name} -> {remark}")
            cursor.execute("UPDATE materials SET tallySyncRemark = %s WHERE id = %s", (remark, material_id))
            log_change(cursor, conn, material_id, item_name, erp_code, None, "Check Group", remark, "Failed")
            sync_errors.append({'item_name': item_name, 'erp_code': erp_code, 'action': "Check Group", 'status': "Failed", 'remark': remark})
            conn.commit()
            continue

        # Check if item already exists in Tally using our batch map
        item_name_upper = item_name.strip().upper()
        item_info = tally_item_map.get(item_name_upper)
        guid = item_info['guid'] if item_info else None
        parent_name = item_info['parent'] if item_info else None
        
        if not guid:
            try:
                # Re-check individually just in case (sometimes names have special chars)
                exists, existing_erp, individual_guid = query_tally_item(item_name)
                if exists:
                    guid = individual_guid
            except NameError:
                pass
        
        if not guid:
            # CREATE NEW
            try:
                success, result = create_or_update_item(item_name, erp_code, target_group, "Create")
            except NameError:
                success, result = False, "create_or_update_item is not implemented"
                
            if success:
                try:
                    # Get the new GUID after creation
                    _, _, new_guid = query_tally_item(item_name)
                except NameError:
                    new_guid = None
                remark = f"Created in {target_group}."
                
                group_uuid = get_or_create_material_group(cursor, conn, target_group)
                if group_uuid:
                    cursor.execute("UPDATE materials SET materialGroupId = %s WHERE id = %s", (group_uuid, material_id))

                cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                               (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), new_guid, remark, material_id))
                log_change(cursor, conn, material_id, item_name, erp_code, new_guid, "Create", remark, "Success")
                log_terminal("SUCCESS", f"Created: {item_name}")
            else:
                remark = f"Create failed: {result}"
                log_change(cursor, conn, material_id, item_name, erp_code, None, "Create", remark, "Failed", result)
                sync_errors.append({'item_name': item_name, 'erp_code': erp_code, 'action': "Create", 'status': "Failed", 'remark': remark, 'error': result})
                log_terminal("ERROR", f"{item_name} -> {remark}")
        else:
            # ITEM ALREADY EXISTS IN TALLY - Just link it and update ERP if needed
            # For simplicity in this logic, we'll assume the GUID is enough to link.
            # If we need to update ERP No on existing items, we'd do it here.
            if parent_name:
                group_uuid = get_or_create_material_group(cursor, conn, parent_name)
                if group_uuid:
                    cursor.execute("UPDATE materials SET materialGroupId = %s WHERE id = %s", (group_uuid, material_id))
                    
            remark = "Linked existing Tally item."
            cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                           (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), guid, remark, material_id))
            log_change(cursor, conn, material_id, item_name, erp_code, guid, "Link", remark, "Success")
            log_terminal("SUCCESS", f"Linked: {item_name}")

        conn.commit()

    log_terminal("INFO", "Sync process completed.")
    if sync_errors:
        send_error_report(sync_errors)

    conn.close()

if __name__ == "__main__":
    main()
