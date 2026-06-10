import os
import mysql.connector
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

# Configuration
DB_HOST = os.getenv('DB_HOST')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME')
TALLY_URL = os.getenv('TALLY_URL', 'http://localhost:9000')
ERROR_EMAIL = "bizskill17@gmail.com"
EMAIL_SENDER = os.getenv('EMAIL_SENDER')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD')
EMAIL_SMTP_SERVER = os.getenv('EMAIL_SMTP_SERVER', 'smtp.gmail.com')
EMAIL_SMTP_PORT = int(os.getenv('EMAIL_SMTP_PORT', '587'))

STOCK_GROUP_NAME = "Kraft Paper"

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

def check_stock_group(group_name):
    xml = f"""<ENVELOPE>
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
    res = tally_request(xml)
    if res:
        return group_name.upper() in res.upper()
    return False

def get_stock_item_details(item_name):
    xml = f"""<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>List of Accounts</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <ACCOUNTTYPE>StockItem</ACCOUNTTYPE>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""
    res = tally_request(xml)
    if res:
        # Simple string check for now, can be improved with XML parsing
        if f'<NAME>{item_name}</NAME>' in res:
            # Try to extract ERP Code (PARTNO)
            # This is a bit complex with raw XML response of all items.
            # Better to use a specific item query if Tally supports it easily.
            return True, "" # Found, unknown ERP
        return False, None
    return None, None

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
        root = ET.fromstring(res)
        # Tally XML structure is nested
        item = root.find(".//STOCKITEM")
        if item is not None:
            part_no = item.findtext("PARTNO") or ""
            guid = item.get("GUID") or ""
            return True, part_no, guid
    return False, None, None

def create_or_update_item(item_name, erp_code, action="Create"):
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
                        <PARENT>{STOCK_GROUP_NAME}</PARENT>
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

    # Check Stock Group
    if not check_stock_group(STOCK_GROUP_NAME):
        print(f"Stock group '{STOCK_GROUP_NAME}' not found in Tally.")
        # We need to log this for ALL pending materials
        cursor.execute("SELECT * FROM materials WHERE tallyTimestamp IS NULL OR tallyTimestamp = ''")
        pending = cursor.fetchall()
        errors = []
        for item in pending:
            remark = "No stock group found."
            cursor.execute("UPDATE materials SET tallySyncRemark = %s WHERE id = %s", (remark, item['id']))
            log_change(cursor, conn, item['id'], item['name'], item['erpCode'], None, "Check Group", remark, "Failed")
            errors.append({
                'item_name': item['name'],
                'erp_code': item['erpCode'],
                'action': "Check Group",
                'status': "Failed",
                'remark': remark
            })
        send_error_report(errors)
        conn.close()
        return

    cursor.execute("SELECT * FROM materials WHERE tallyTimestamp IS NULL OR tallyTimestamp = ''")
    pending = cursor.fetchall()
    
    sync_errors = []
    
    for item in pending:
        item_name = item['name']
        erp_code = str(item['erpCode']) if item['erpCode'] else ""
        material_id = item['id']
        
        print(f"Processing: {item_name}")
        
        exists, existing_erp, guid = query_tally_item(item_name)
        
        if not exists:
            # Create new
            success, result = create_or_update_item(item_name, erp_code, "Create")
            if success:
                # Re-query to get GUID
                _, _, new_guid = query_tally_item(item_name)
                remark = "New stock item created."
                cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                               (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), new_guid, remark, material_id))
                log_change(cursor, conn, material_id, item_name, erp_code, new_guid, "Create", remark, "Success")
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
        else:
            # Exists
            if not existing_erp:
                # Update ERP No.
                success, result = create_or_update_item(item_name, erp_code, "Alter")
                if success:
                    remark = "ERP No. updated in Tally."
                    cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                                   (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), guid, remark, material_id))
                    log_change(cursor, conn, material_id, item_name, erp_code, guid, "Update", remark, "Success")
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
            else:
                # Already has ERP No. (or it matches/doesn't match, prompt says "if ERP No. is missing")
                remark = "Item exists with ERP No. Skipping."
                cursor.execute("UPDATE materials SET tallyTimestamp = %s, tallyMaterialId = %s, tallySyncRemark = %s WHERE id = %s",
                               (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), guid, remark, material_id))
                log_change(cursor, conn, material_id, item_name, erp_code, guid, "Skip", remark, "Success")

        conn.commit()

    if sync_errors:
        send_error_report(sync_errors)

    conn.close()

if __name__ == "__main__":
    main()
