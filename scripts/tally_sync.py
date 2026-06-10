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
        print(f"Failed to send email: {e}")

def tally_request(xml_content):
    try:
        response = requests.post(TALLY_URL, data=xml_content, headers={'Content-Type': 'text/xml'})
        if response.status_code == 200:
            return response.text
        else:
            return None
    except Exception as e:
        print(f"Tally connection error: {e}")
        return None

def is_guid(s):
    """Checks if a string is a Tally GUID (e.g. 27FC4EF2-EE5B-4FBD-A5C1-A188D2320B9A)."""
    import re
    return bool(re.match(r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$', s.strip(), re.I))

def get_all_tally_groups():
    """Fetches all stock group names from Tally."""
    groups = set()
    # 1. Try List of Stock Groups
    xml1 = """<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>List of Stock Groups</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""

    # 2. Try List of Accounts with StockGroup
    xml2 = """<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>List of Accounts</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <ACCOUNTTYPE>StockGroup</ACCOUNTTYPE>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""

    for xml in [xml1, xml2]:
        res = tally_request(xml)
        if not res:
            continue
        try:
            root = ET.fromstring(res)
            # Find all NAME tags
            for name in root.findall('.//NAME'):
                if name.text:
                    val = name.text.strip()
                    if val and not is_guid(val):
                        groups.add(val.upper())
            
            # Also check attributes
            for elem in root.iter():
                for attr_name, attr_val in elem.attrib.items():
                    if 'NAME' in attr_name.upper() and attr_val and not is_guid(attr_val):
                        groups.add(attr_val.strip().upper())

        except ET.ParseError:
            import re
            # Extract anything between <NAME> and </NAME>
            names = re.findall(r'<NAME[^>]*>(.*?)</NAME>', res)
            for n in names:
                n = n.strip()
                if n and not is_guid(n):
                    groups.add(n.upper())
    
    return groups

def query_tally_item(item_name):
    # Specific query for one item
    xml = f"""<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Stock Item View</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <SVSTOCKITEMNAME>{item_name}</SVSTOCKITEMNAME>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""
    res = tally_request(xml)
    if res and '<STOCKITEM' in res:
        try:
            root = ET.fromstring(res)
            item = root.find(".//STOCKITEM")
            if item is not None:
                part_no = item.findtext("PARTNO") or ""
                guid = item.get("GUID") or ""
                return True, part_no, guid
        except:
            if f'<NAME>{item_name}</NAME>' in res:
                return True, "", ""
    return False, None, None

def create_or_update_item(item_name, erp_code, group_name, action="Create"):
    xml = f"""<ENVELOPE>
    <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>All Masters</REPORTNAME>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <STOCKITEM NAME="{item_name}" ACTION="{action}">
                        <NAME.LIST>
                            <NAME>{item_name}</NAME>
                        </NAME.LIST>
                        <PARENT>{group_name}</PARENT>
                        <PARTNO>{erp_code}</PARTNO>
                        <BASEUNITS>Nos</BASEUNITS>
                    </STOCKITEM>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>"""
    res = tally_request(xml)
    if res and '<CREATED>1</CREATED>' in res:
        return True, "Created"
    if res and '<ALTERED>1</ALTERED>' in res:
        return True, "Altered"
    return False, res

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
        print(f"Database connection error: {e}")
        return

    # STEP 1: Fetch all groups from Tally first
    print("\nFetching available Stock Groups from Tally...")
    tally_groups = get_all_tally_groups()
    
    if not tally_groups:
        print("ERROR: Could not fetch any Stock Groups from Tally. Please check Tally connection and if a company is open.")
        conn.close()
        return

    print(f"Found {len(tally_groups)} groups: {', '.join(sorted(tally_groups))}")

    cursor.execute("SELECT * FROM materials WHERE tallyTimestamp IS NULL OR tallyTimestamp = ''")
    pending = cursor.fetchall()
    
    if not pending:
        print("No pending materials to sync.")
        conn.close()
        return

    sync_errors = []
    
    for item in pending:
        item_name = item['name']
        erp_code = str(item['erpCode']) if item['erpCode'] else ""
        material_id = item['id']
        material_type = str(item['type'] or "").strip().lower()
        
        # STEP 2: Determine target group and check if it exists in the fetched list
        target_group = REEL_GROUP if material_type == "reel" else OTHER_GROUP
        
        # Case-insensitive check against fetched groups
        if target_group.upper() not in tally_groups:
            remark = f"Stock group '{target_group}' not found in Tally. Available: {', '.join(sorted(tally_groups))[:100]}..."
            print(f"FAILED: {item_name} -> {remark}")
            cursor.execute("UPDATE materials SET tallySyncRemark = %s WHERE id = %s", (remark, material_id))
            log_change(cursor, conn, material_id, item_name, erp_code, None, "Check Group", remark, "Failed")
            sync_errors.append({
                'item_name': item_name,
                'erp_code': erp_code,
                'action': "Check Group",
                'status': "Failed",
                'remark': remark
            })
            conn.commit()
            continue

        print(f"Syncing: {item_name} -> Group: {target_group}")
        
        exists, existing_erp, guid = query_tally_item(item_name)
        
        if not exists:
            # Create new
            success, result = create_or_update_item(item_name, erp_code, target_group, "Create")
            if success:
                _, _, new_guid = query_tally_item(item_name)
                remark = f"New stock item created in {target_group}."
                cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                               (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), new_guid, remark, material_id))
                log_change(cursor, conn, material_id, item_name, erp_code, new_guid, "Create", remark, "Success")
                print(f"SUCCESS: Created {item_name}")
            else:
                remark = "Failed to create stock item."
                log_change(cursor, conn, material_id, item_name, erp_code, None, "Create", remark, "Failed", result)
                sync_errors.append({
                    'item_name': item_name,
                    'erp_code': erp_code,
                    'action': "Create",
                    'status': "Failed",
                    'remark': remark,
                    'error': result
                })
                print(f"ERROR: Failed to create {item_name}")
        else:
            # Exists
            if not existing_erp:
                # Update ERP No.
                success, result = create_or_update_item(item_name, erp_code, target_group, "Alter")
                if success:
                    remark = "ERP No. updated in Tally."
                    cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                                   (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), guid, remark, material_id))
                    log_change(cursor, conn, material_id, item_name, erp_code, guid, "Update", remark, "Success")
                    print(f"SUCCESS: Updated {item_name}")
                else:
                    remark = "Failed to update ERP No."
                    log_change(cursor, conn, material_id, item_name, erp_code, guid, "Update", remark, "Failed", result)
                    sync_errors.append({
                        'item_name': item_name,
                        'erp_code': erp_code,
                        'action': "Update",
                        'status': "Failed",
                        'remark': remark,
                        'error': result
                    })
                    print(f"ERROR: Failed to update {item_name}")
            else:
                remark = "Item exists with ERP No. Skipping."
                cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                               (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), guid, remark, material_id))
                log_change(cursor, conn, material_id, item_name, erp_code, guid, "Skip", remark, "Success")
                print(f"SKIP: {item_name} (Already synced)")

        conn.commit()

    if sync_errors:
        send_error_report(sync_errors)

    conn.close()

if __name__ == "__main__":
    main()
