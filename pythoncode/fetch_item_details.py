import requests
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

TALLY_URL = "http://127.0.0.1:9000"

def get_stock_item_details(item_name):
    safe_name = escape(item_name)
    xml_request = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <STOCKITEM NAME="{safe_name}" ACTION="Get">
                    </STOCKITEM>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    try:
        response = requests.post(TALLY_URL, data=xml_request, timeout=10)
        return response.text
    except Exception as e:
        return str(e)

item_name = "1001 - Size: 120 CM X GSM: 150 X BF: 18"
print(f"Fetching details for: {item_name}")
print(get_stock_item_details(item_name))
