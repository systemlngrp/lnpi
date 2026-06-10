import requests
import xml.etree.ElementTree as ET
import os
from dotenv import load_dotenv

load_dotenv(override=True)

TALLY_URL = os.getenv('TALLY_URL', 'http://127.0.0.1:9009').strip()

def list_groups():
    print(f"Connecting to Tally at: {TALLY_URL}...")
    
    xml = """<ENVELOPE>
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

    try:
        response = requests.post(TALLY_URL, data=xml, headers={'Content-Type': 'text/xml'})
        if response.status_code != 200:
            print(f"Error: Tally returned status code {response.status_code}")
            return

        res = response.text
        print("\n--- Raw Response (First 500 chars) ---")
        print(res[:500])
        print("--------------------------------------\n")

        print("Available Stock Groups in Tally:")
        found = False
        try:
            root = ET.fromstring(res)
            # Tally XML often puts names in <NAME> tags
            for name in root.findall('.//NAME'):
                if name.text:
                    print(f" - {name.text.strip()}")
                    found = True
        except Exception as e:
            print(f"XML Parsing error: {e}")
            # Fallback string search if XML parsing fails
            import re
            names = re.findall(r'<NAME>(.*?)</NAME>', res)
            for n in names:
                print(f" - {n.strip()}")
                found = True

        if not found:
            print("No stock groups found in the response.")

    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    list_groups()
