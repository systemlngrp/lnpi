import requests
import xml.etree.ElementTree as ET

TALLY_URL = "http://127.0.0.1:9000"

def get_units():
    xml_request = """
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
                <COLLECTIONNAME>Unit</COLLECTIONNAME>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    try:
        response = requests.post(TALLY_URL, data=xml_request, timeout=10)
        return response.text
    except Exception as e:
        return str(e)

print(get_units())
