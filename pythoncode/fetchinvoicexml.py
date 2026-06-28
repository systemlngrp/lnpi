import requests

# Point this to your runtime port (from your second script: 9004)
TALLY_URL = "http://127.0.0.1:9004" 

def fetch_raw_tally_invoice_schema(invoice_number):
    # This explicit TDL request extracts ALL tags, including unpopulated default properties
    xml_request = f"""<ENVELOPE>
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
                    <VOUCHER VOUCHERNUMBER="{invoice_number}" ACTION="Get" />
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""

    try:
        response = requests.post(
            TALLY_URL,
            data=xml_request.encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=30,
        )
        if response.status_code == 200:
            # Save it to a file so you can inspect every hidden tag block
            with open("raw_tally_invoice_dump.xml", "w", encoding="utf-8") as f:
                f.write(response.text)
            print("SUCCESS: Raw invoice XML dumped safely into 'raw_tally_invoice_dump.xml'")
        else:
            print(f"FAILED: Server status code {response.status_code}")
    except Exception as e:
        print(f"Network error: {e}")

if __name__ == "__main__":
    # Run against an existing voucher that you manually typed inside Tally
    fetch_raw_tally_invoice_schema("LNPI/26-27/00325")
