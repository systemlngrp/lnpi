import requests

TALLY_URL = "http://127.0.0.1:9000"

xml_request = """
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>List of Companies</REPORTNAME>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""

try:
    response = requests.post(TALLY_URL, data=xml_request, timeout=10)
    print(response.text)
except Exception as e:
    print(e)
