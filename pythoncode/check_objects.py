import requests

TALLY_URL = "http://127.0.0.1:9000"

def check_ledger(name):
    xml = f"""
<ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <COLLECTIONNAME>Ledger</COLLECTIONNAME>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <LEDGER NAME="{name}" ACTION="Get"></LEDGER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    try:
        res = requests.post(TALLY_URL, data=xml, timeout=5)
        return res.text
    except:
        return "Error"

print("Stitching Wire (Normal):")
# print(check_ledger("Stitching Wire (Normal)"))
# Actually let's just search for it in the list of all ledgers if possible, or just ask Tally if it exists as an object.

def get_object(obj_type, name):
    xml = f"""
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
                    <OBJECT TYPE="{obj_type}" NAME="{name}"></OBJECT>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
"""
    try:
        res = requests.post(TALLY_URL, data=xml, timeout=5)
        return res.text
    except:
        return "Error"

print("Checking Stock Item 'Stitching Wire (Normal)':")
# res = get_object("Stock Item", "Stitching Wire (Normal)")
# if "GUID" in res: print("Exists as Stock Item")
# else: print("Not found as Stock Item")

# print("Checking Ledger 'Stitching Wire (Normal)':")
# res = get_object("Ledger", "Stitching Wire (Normal)")
# if "GUID" in res: print("Exists as Ledger")
# else: print("Not found as Ledger")
