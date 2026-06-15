import os
import re
import requests
import xml.etree.ElementTree as ET

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    load_dotenv(override=True)

TALLY_URL = os.getenv("TALLY_URL", "http://127.0.0.1:9000").strip()
ITEM_NAME = "Himanshu"


def tally_request(xml_content: str):
    try:
        response = requests.post(
            TALLY_URL,
            data=xml_content,
            headers={"Content-Type": "text/xml"},
            timeout=20,
        )
        if response.status_code == 200:
            return response.text
        print(f"HTTP error from Tally: {response.status_code}")
        return None
    except Exception as error:
        print(f"Connection error: {error}")
        return None


def sanitize_tally_xml(xml_text: str) -> str:
    if not xml_text:
        return xml_text
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    return cleaned


def extract_item_from_text(xml_text: str, item_name: str):
    if not xml_text:
        return None

    upper_name = item_name.strip().upper()
    blocks = re.findall(r"<STOCKITEM\b.*?</STOCKITEM>", xml_text, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks:
        name_match = re.search(r"<NAME[^>]*>(.*?)</NAME>", block, flags=re.IGNORECASE | re.DOTALL)
        if not name_match:
            continue
        found_name = re.sub(r"\s+", " ", name_match.group(1)).strip()
        if found_name.upper() != upper_name:
            continue
        parent_match = re.search(r"<PARENT[^>]*>(.*?)</PARENT>", block, flags=re.IGNORECASE | re.DOTALL)
        guid_match = re.search(r'GUID="(.*?)"', block, flags=re.IGNORECASE)
        return {
            "name": found_name,
            "parent": re.sub(r"\s+", " ", parent_match.group(1)).strip() if parent_match else "Group not found",
            "guid": guid_match.group(1).strip() if guid_match else None,
        }

    return None


def check_item_in_tally(item_name: str):
    xml = f"""<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Stock Item</SUBTYPE>
        <ID TYPE="Name">{item_name}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
                <FETCH>Parent</FETCH>
                <FETCH>GUID</FETCH>
                <FETCH>PartNo</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>"""

    fallback_xml = """<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>List of Stock Items</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""

    for request_xml, mode in ((xml, "direct"), (fallback_xml, "list")):
        result = tally_request(request_xml)
        if not result:
            continue

        if "UNKNOWN REQUEST" in result.upper() and mode == "direct":
            continue

        try:
            root = ET.fromstring(sanitize_tally_xml(result))
            stock_item = root.find(".//STOCKITEM")
            if stock_item is None and mode == "list":
                text_match = extract_item_from_text(result, item_name)
                if text_match:
                    print(f"'{text_match['name']}' is PRESENT in Tally.")
                    print(f"Group: {text_match['parent']}")
                    print(f"GUID: {text_match['guid'] or 'Not available'}")
                    return
                continue
            if stock_item is None:
                continue

            name_elem = stock_item.find("NAME")
            parent_elem = stock_item.find("PARENT")
            guid = stock_item.get("GUID")

            found_name = name_elem.text.strip() if name_elem is not None and name_elem.text else item_name
            parent = parent_elem.text.strip() if parent_elem is not None and parent_elem.text else "Group not found"

            print(f"'{found_name}' is PRESENT in Tally.")
            print(f"Group: {parent}")
            print(f"GUID: {guid or 'Not available'}")
            return
        except Exception:
            text_match = extract_item_from_text(result, item_name)
            if text_match:
                print(f"'{text_match['name']}' is PRESENT in Tally.")
                print(f"Group: {text_match['parent']}")
                print(f"GUID: {text_match['guid'] or 'Not available'}")
                return

    print(f"'{item_name}' is NOT present in Tally.")


if __name__ == "__main__":
    print(f"Checking in Tally at: {TALLY_URL}")
    check_item_in_tally(ITEM_NAME)
