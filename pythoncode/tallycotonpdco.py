
import requests
import json
import re
import logging
import time
from xml.etree import ElementTree as ET


GSTIN_PATTERN = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b", re.IGNORECASE)
LOGGER = logging.getLogger("tallycotonpdco")
WEB_APP_CONNECT_TIMEOUT = 30
WEB_APP_READ_TIMEOUT = 300
WEB_APP_BATCH_SIZE = 200
WEB_APP_MAX_RETRIES = 3
TARGET_LEDGER_GROUP = "Sundry Debtors"


def configure_logging():
    if LOGGER.handlers:
        return

    LOGGER.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    LOGGER.addHandler(stream_handler)

    file_handler = logging.FileHandler("tallycotonpdco.log", encoding="utf-8")
    file_handler.setFormatter(formatter)
    LOGGER.addHandler(file_handler)


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


def normalize_name_key(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def normalize_gstin(value):
    value = clean_text(value).upper().replace(" ", "")
    match = GSTIN_PATTERN.search(value)
    return match.group(0) if match else value


def get_xml_text(parent, tag):
    """
    Safely get text from XML tag.
    """
    element = parent.find(".//" + tag)
    if element is not None and element.text:
        return clean_text(element.text)
    return ""


def get_xml_text_from_possible_tags(parent, tags):
    for tag in tags:
        value = get_xml_text(parent, tag)
        if value:
            return value
    return ""


def get_first_available_value(parent, tags):
    return get_xml_text_from_possible_tags(parent, tags)


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
        "GSTREGISTRATIONNUMBER",
        "LEDGERGSTIN",
        "LEDGSTIN",
        "VATIN",
        "GSTINUIN",
        "GSTINORUNIQUEID",
    ]

    value = get_xml_text_from_possible_tags(ledger, possible_tags)
    if value:
        return normalize_gstin(value)

    nested_tag_groups = [
        [
            "GSTREGDETAILS.LIST/GSTIN",
            "GSTREGDETAILS.LIST/GSTINUIN",
            "GSTREGDETAILS.LIST/GSTINORUNIQUEID",
            "GSTDETAILS.LIST/GSTIN",
            "GSTDETAILS.LIST/GSTINUIN",
            "LEDGSTREGDETAILS.LIST/GSTIN",
            "LEDGSTREGDETAILS.LIST/GSTINUIN",
            "LEDGERGSTREGDETAILS.LIST/GSTIN",
            "LEDGERGSTREGDETAILS.LIST/GSTINUIN",
        ],
        [
            "GSTREGDETAILS/GSTIN",
            "GSTREGDETAILS/GSTINUIN",
            "GSTDETAILS/GSTIN",
            "GSTDETAILS/GSTINUIN",
        ],
    ]

    for tag_group in nested_tag_groups:
        value = get_xml_text_from_possible_tags(ledger, tag_group)
        if value:
            return normalize_gstin(value)

    for element in ledger.iter():
        tag_name = str(element.tag or "").upper()
        text_value = clean_text(element.text)
        if not text_value:
            continue
        if (
            "GSTIN" in tag_name
            or "GSTREGISTRATIONNUMBER" in tag_name
            or "PARTYGSTIN" in tag_name
            or "GSTINUIN" in tag_name
        ):
            normalized = normalize_gstin(text_value)
            if normalized:
                return normalized
        if GSTIN_PATTERN.search(text_value):
            return normalize_gstin(text_value)

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

    return get_xml_text_from_possible_tags(ledger, possible_tags)


def get_contact_number(ledger):
    possible_tags = [
        "LEDGERMOBILE",
        "MOBILENO",
        "PHONENUMBER",
        "LEDGERPHONE"
    ]

    return get_xml_text_from_possible_tags(ledger, possible_tags)


def get_email(ledger):
    possible_tags = [
        "EMAIL",
        "EMAILID",
        "LEDGEREMAIL"
    ]

    return get_xml_text_from_possible_tags(ledger, possible_tags)


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
                        <CHILDOF>{target_group}</CHILDOF>
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
                            LEDGERGSTIN,
                            LEDGSTIN,
                            VATIN,
                            GSTINUIN,
                            GSTINORUNIQUEID,
                            GSTREGDETAILS,
                            GSTDETAILS,
                            LEDGSTREGDETAILS,
                            LEDGERGSTREGDETAILS,
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
""".format(target_group=TARGET_LEDGER_GROUP)


def fetch_ledgers_from_tally():
    xml_request = build_tally_ledger_xml()
    LOGGER.info("Connecting to Tally at %s", TALLY_URL)

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

    LOGGER.info("Received response from Tally with status %s", response.status_code)
    return response.text


# =====================================================
# PARSE TALLY XML
# =====================================================

def parse_ledgers(xml_text):
    records = []
    gst_found = 0
    gst_missing = 0
    skipped_non_target_group = 0

    # Save raw response for checking
    with open("tally_raw_response.xml", "w", encoding="utf-8", errors="ignore") as f:
        f.write(xml_text)

    LOGGER.info("Saved raw Tally XML to tally_raw_response.xml")
    LOGGER.info("Cleaning invalid XML characters")

    # IMPORTANT: clean before parsing
    xml_text = remove_invalid_xml_chars(xml_text)

    # Save cleaned response for checking
    with open("tally_clean_response.xml", "w", encoding="utf-8", errors="ignore") as f:
        f.write(xml_text)
    LOGGER.info("Saved cleaned Tally XML to tally_clean_response.xml")

    try:
        root = ET.fromstring(xml_text)

    except ET.ParseError as e:
        raise Exception(
            f"Could not parse Tally XML even after cleaning: {e}. "
            f"Open tally_clean_response.xml and check near the error line."
        )

    ledgers = root.findall(".//LEDGER")
    LOGGER.info("Found %s ledger nodes in Tally XML", len(ledgers))

    for ledger in ledgers:
        company_name = clean_text(ledger.attrib.get("NAME", ""))

        if not company_name:
            company_name = get_xml_text(ledger, "NAME")

        if not company_name:
            continue

        parent = get_xml_text(ledger, "PARENT")
        if normalize_name_key(parent) != normalize_name_key(TARGET_LEDGER_GROUP):
            skipped_non_target_group += 1
            continue

        address = get_address(ledger)
        state = get_xml_text(ledger, "STATENAME")
        pin_code = get_xml_text(ledger, "PINCODE")

        gst_no = get_gstin(ledger)
        if gst_no:
            gst_found += 1
        else:
            gst_missing += 1
            LOGGER.warning("GST missing in Tally for company: %s", company_name)

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

    LOGGER.info(
        "Prepared %s records from %s | GST found: %s | GST missing: %s | Skipped other groups: %s",
        len(records),
        TARGET_LEDGER_GROUP,
        gst_found,
        gst_missing,
        skipped_non_target_group
    )
    return records

# =====================================================
# SEND DATA TO APPS SCRIPT WEB APP
# =====================================================

def send_to_web_app(records):
    session = requests.Session()
    batch_results = []
    aggregated = {
        "success": True,
        "message": "Company sync completed",
        "result": {
            "totalRecordsReceived": 0,
            "checked": 0,
            "matched": 0,
            "notFound": 0,
            "cellsUpdated": 0,
            "cellsSame": 0,
            "cellsSkippedBlank": 0,
            "batchesProcessed": 0
        }
    }

    if not records:
        return aggregated

    for batch_number, start in enumerate(range(0, len(records), WEB_APP_BATCH_SIZE), start=1):
        batch_records = records[start:start + WEB_APP_BATCH_SIZE]
        payload = {
            "action": "syncCompanies",
            "onlyBlankUpdates": True,
            "records": batch_records
        }

        LOGGER.info(
            "Sending batch %s with %s records to Apps Script Web App",
            batch_number,
            len(batch_records)
        )

        result = post_batch_to_web_app(session, payload, batch_number)
        batch_results.append(result)

        if not result.get("success"):
            aggregated["success"] = False
            aggregated["message"] = f"Batch {batch_number} failed"
            aggregated["batchResults"] = batch_results
            return aggregated

        merge_batch_result(aggregated["result"], result.get("result") or {})
        aggregated["result"]["batchesProcessed"] = batch_number

    aggregated["batchResults"] = batch_results
    return aggregated


def post_batch_to_web_app(session, payload, batch_number):
    last_error = None

    for attempt in range(1, WEB_APP_MAX_RETRIES + 1):
        try:
            response = session.post(
                WEB_APP_URL,
                data=json.dumps(payload),
                headers={"Content-Type": "application/json"},
                timeout=(WEB_APP_CONNECT_TIMEOUT, WEB_APP_READ_TIMEOUT)
            )

            response.raise_for_status()

            result = response.json()
            LOGGER.info(
                "Apps Script response received successfully for batch %s on attempt %s",
                batch_number,
                attempt
            )
            return result

        except requests.exceptions.ReadTimeout as err:
            last_error = err
            LOGGER.warning(
                "Apps Script read timeout for batch %s on attempt %s/%s",
                batch_number,
                attempt,
                WEB_APP_MAX_RETRIES
            )
        except requests.exceptions.RequestException as err:
            last_error = err
            LOGGER.warning(
                "Apps Script request failed for batch %s on attempt %s/%s: %s",
                batch_number,
                attempt,
                WEB_APP_MAX_RETRIES,
                err
            )
        except ValueError as err:
            LOGGER.exception(
                "Failed to parse Apps Script JSON response for batch %s",
                batch_number
            )
            return {
                "success": False,
                "message": f"Invalid JSON response for batch {batch_number}: {err}"
            }

        if attempt < WEB_APP_MAX_RETRIES:
            wait_seconds = attempt * 2
            LOGGER.info("Retrying batch %s after %s seconds", batch_number, wait_seconds)
            time.sleep(wait_seconds)

    LOGGER.exception("Apps Script sync failed for batch %s", batch_number, exc_info=last_error)
    return {
        "success": False,
        "message": f"Apps Script sync failed for batch {batch_number}: {last_error}"
    }


def merge_batch_result(total, batch):
    for key in [
        "totalRecordsReceived",
        "checked",
        "matched",
        "notFound",
        "cellsUpdated",
        "cellsSame",
        "cellsSkippedBlank"
    ]:
        total[key] = total.get(key, 0) + int(batch.get(key, 0))


# =====================================================
# MAIN
# =====================================================

def main():
    configure_logging()
    LOGGER.info("Starting Tally company sync")

    xml_text = fetch_ledgers_from_tally()

    LOGGER.info("Tally data fetched successfully")

    records = parse_ledgers(xml_text)

    LOGGER.info("Total ledgers parsed from Tally: %s", len(records))

    if not records:
        LOGGER.warning("No ledger data found from Tally")
        return

    result = send_to_web_app(records)

    LOGGER.info("Sync completed")
    print("\n===== SYNC RESULT =====")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
