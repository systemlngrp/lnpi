import requests
import xml.etree.ElementTree as ET

TALLY_URL = "http://127.0.0.1:9000"

def get_voucher_details(vch_no):
    xml_request = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <VOUCHER VOUCHERNUMBER="{vch_no}" ACTION="Get">
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    try:
        response = requests.post(TALLY_URL, data=xml_request, timeout=5)
        return response.text
    except Exception as e:
        return str(e)

print(get_voucher_details("86"))
