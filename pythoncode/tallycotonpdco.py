
import requests
import json
import re
from xml.etree import ElementTree as ET


def remove_invalid_xml_chars(xml_text):
    if not xml_text:
        return xml_text

    def is_valid_xml_char(codepoint):
        return (
            codepoint in (0x9, 0xA, 0xD)
            or 0x20 <= codepoint <= 0xD7FF
            or 0xE000 <= codepoint <= 0xFFFD
            or 0x10000 <= codepoint <= 0x10FFFF
        )

    def replace_invalid_reference(match):
        hex_value, dec_value = match.groups()
        try:
            codepoint = int(hex_value, 16) if hex_value is not None else int(dec_value, 10)
        except Exception:
            return ""
        return match.group(0) if is_valid_xml_char(codepoint) else ""

    xml_text = re.sub(r"&#x([0-9A-Fa-f]+);|&#([0-9]+);", replace_invalid_reference, xml_text)
    xml_text = "".join(ch for ch in xml_text if is_valid_xml_char(ord(ch)))
    return xml_text
# =====================================================
# CONFIG
# =====================================================

TALLY_URL = "http://localhost:9000"

WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwuicOCUuGYXuL_uIC4smTfL2vb-7rwahwtzdcVe2tqiVmUQmjk1wD5QQS2GKNl1RL2/exec"


# =====================================================
# HELPERS
# =====================================================

def clean_text(value):
    if value is None:
        return ""

    value = str(value).strip()

    value = re.sub(r"\s+", " ", value)

    if value.lower() in ["none", "null", "nan"]:
        return ""

    return value


def get_xml_text(parent, tag):
    """
    Safely get text from XML tag.
    """
    element = parent.find(".//" + tag)
    if element is not None and element.text:
        return clean_text(element.text)
    return ""


def get_first_available_value(parent, tags):
    for tag in tags:
        value = get_xml_text(parent, tag)
        if value:
            return value
    return ""


def get_address(ledger):
    """
    Tally address normally comes in multiple ADDRESS.LIST lines.
    This function joins them into one address.
    """
    address_lines = []

    for addr in ledger.findall(".//ADDRESS.LIST/ADDRESS"):
        if addr.text:
            address_lines.append(clean_text(addr.text))

    return " ".join(address_lines)


def get_gstin(ledger):
    """
    Tally GSTIN may come under different tag names depending on version/configuration.
    """
    possible_tags = [
        "PARTYGSTIN",
        "GSTIN",
        "GSTREGISTRATIONNUMBER"
    ]

    for tag in possible_tags:
        value = get_xml_text(ledger, tag)
        if value:
            return value

    return ""


def get_pan(ledger):
    """
    PAN field may come under INCOMETAXNUMBER in Tally.
    """
    possible_tags = [
        "INCOMETAXNUMBER",
        "PAN",
        "PANNUMBER"
    ]

    for tag in possible_tags:
        value = get_xml_text(ledger, tag)
        if value:
            return value

    return ""


def get_contact_number(ledger):
    possible_tags = [
        "LEDGERMOBILE",
        "MOBILENO",
        "PHONENUMBER",
        "LEDGERPHONE"
    ]

    for tag in possible_tags:
        value = get_xml_text(ledger, tag)
        if value:
            return value

    return ""


def get_email(ledger):
    possible_tags = [
        "EMAIL",
        "EMAILID",
        "LEDGEREMAIL"
    ]

    for tag in possible_tags:
        value = get_xml_text(ledger, tag)
        if value:
            return value

    return ""


# =====================================================
# TALLY XML REQUEST
# =====================================================

def build_tally_ledger_xml():
    """
    Fetch all ledgers from currently open company in Tally.
    """
    return """
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Collection</TYPE>
        <ID>Ledger Collection</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <TDL>
                <TDLMESSAGE>
                    <COLLECTION NAME="Ledger Collection" ISMODIFY="No">
                        <TYPE>Ledger</TYPE>
                        <FETCH>
                            NAME,
                            PARENT,
                            ADDRESS,
                            STATENAME,
                            PINCODE,
                            COUNTRYNAME,
                            PARTYGSTIN,
                            GSTIN,
                            GSTREGISTRATIONNUMBER,
                            INCOMETAXNUMBER,
                            LEDGERMOBILE,
                            MOBILENO,
                            PHONENUMBER,
                            LEDGERPHONE,
                            EMAIL,
                            EMAILID,
                            LEDGEREMAIL,
                            CONTACTPERSON
                        </FETCH>
                    </COLLECTION>
                </TDLMESSAGE>
            </TDL>
        </DESC>
    </BODY>
</ENVELOPE>
"""


def fetch_ledgers_from_tally():
    xml_request = build_tally_ledger_xml()

    try:
        response = requests.post(
            TALLY_URL,
            data=xml_request.encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=60
        )

        response.raise_for_status()

    except requests.exceptions.ConnectionError:
        raise Exception(
            "Could not connect to Tally on port 9000. "
            "Please make sure Tally is open and ODBC/HTTP port 9000 is enabled."
        )

    except requests.exceptions.Timeout:
        raise Exception("Tally request timed out.")

    except Exception as e:
        raise Exception(f"Error while connecting to Tally: {e}")

    return response.text


# =====================================================
# PARSE TALLY XML
# =====================================================

def parse_ledgers(xml_text):
    records = []

    # Save raw response for checking
    with open("tally_raw_response.xml", "w", encoding="utf-8", errors="ignore") as f:
        f.write(xml_text)

    print("Cleaning invalid XML characters...")

    # IMPORTANT: clean before parsing
    xml_text = remove_invalid_xml_chars(xml_text)

    # Save cleaned response for checking
    with open("tally_clean_response.xml", "w", encoding="utf-8", errors="ignore") as f:
        f.write(xml_text)

    try:
        root = ET.fromstring(xml_text)

    except ET.ParseError as e:
        raise Exception(
            f"Could not parse Tally XML even after cleaning: {e}. "
            f"Open tally_clean_response.xml and check near the error line."
        )

    ledgers = root.findall(".//LEDGER")

    for ledger in ledgers:
        company_name = clean_text(ledger.attrib.get("NAME", ""))

        if not company_name:
            company_name = get_xml_text(ledger, "NAME")

        if not company_name:
            continue

        parent = get_xml_text(ledger, "PARENT")

        address = get_address(ledger)
        state = get_xml_text(ledger, "STATENAME")
        pin_code = get_xml_text(ledger, "PINCODE")

        gst_no = get_first_available_value(
            ledger,
            [
                "PARTYGSTIN",
                "GSTIN",
                "GSTREGISTRATIONNUMBER"
            ]
        )

        pan_no = get_first_available_value(
            ledger,
            [
                "INCOMETAXNUMBER",
                "PAN",
                "PANNUMBER"
            ]
        )

        email = get_first_available_value(
            ledger,
            [
                "EMAIL",
                "EMAILID",
                "LEDGEREMAIL"
            ]
        )

        contact_number = get_first_available_value(
            ledger,
            [
                "LEDGERMOBILE",
                "MOBILENO",
                "PHONENUMBER",
                "LEDGERPHONE"
            ]
        )

        contact_person = get_xml_text(ledger, "CONTACTPERSON")

        gst_type = "Registered" if gst_no else "Unregistred/Consumer"

        record = {
            "company": company_name,
            "address": address,
            "district": "",
            "state": state,
            "gstNo": gst_no,
            "email": email,
            "contactPerson": contact_person,
            "contactNumber": contact_number,
            "id": "",
            "pinCode": pin_code,
            "gstType": gst_type,
            "panNo": pan_no
        }

        records.append(record)

    return records

# =====================================================
# SEND DATA TO APPS SCRIPT WEB APP
# =====================================================

def send_to_web_app(records):
    payload = {
        "action": "syncCompanies",
        "onlyBlankUpdates": True,
        "records": records
    }

    response = requests.post(
        WEB_APP_URL,
        data=json.dumps(payload),
        headers={"Content-Type": "application/json"},
        timeout=180
    )

    try:
        return response.json()
    except Exception:
        return {
            "success": False,
            "statusCode": response.status_code,
            "responseText": response.text
        }


# =====================================================
# MAIN
# =====================================================

def main():
    print("Connecting to Tally on port 9000...")

    xml_text = fetch_ledgers_from_tally()

    print("Tally data fetched successfully.")

    records = parse_ledgers(xml_text)

    print(f"Total ledgers fetched from Tally: {len(records)}")

    if not records:
        print("No ledger data found from Tally.")
        return

    print("Sending data to Apps Script Web App...")

    result = send_to_web_app(records)

    print("\n===== SYNC RESULT =====")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
