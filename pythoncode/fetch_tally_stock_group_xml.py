import os
import re
import sys
import requests
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as esc

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def load_runtime_env():
    env_paths = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
    ]
    if load_dotenv:
        for env_path in env_paths:
            if os.path.exists(env_path):
                load_dotenv(env_path, override=True)
                return
        load_dotenv(override=True)


load_runtime_env()

TALLY_URL = os.getenv("TALLY_URL", "http://127.0.0.1:9004").strip()
TALLY_COMPANY = os.getenv("TALLY_COMPANY_NAME", os.getenv("TALLY_COMPANY", "LNPI")).strip()


def post_to_tally(xml_data: str) -> str:
    response = requests.post(
        TALLY_URL,
        data=xml_data.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
        timeout=30,
    )
    response.raise_for_status()
    return response.text


def sanitize_tally_xml(xml_text: str) -> str:
    if not xml_text:
        return xml_text
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)
    return cleaned


def build_stock_group_export_xml(group_name: str, company_name: str) -> str:
    return f"""
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Stock Group</SUBTYPE>
        <ID TYPE="Name">{esc(group_name)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVCURRENTCOMPANY>{esc(company_name)}</SVCURRENTCOMPANY>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
                <FETCH>Parent</FETCH>
                <FETCH>Guid</FETCH>
                <FETCH>BaseUnits</FETCH>
                <FETCH>IsAddable</FETCH>
                <FETCH>ShouldQuantitiesOfItemsBeAdded</FETCH>
                <FETCH>LanguageName.LIST</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>
""".strip()


def print_element_tree(elem, indent=0):
    space = " " * indent
    text = (elem.text or "").strip()
    attrs = " ".join(f'{k}="{v}"' for k, v in elem.attrib.items())
    header = f"{space}<{elem.tag}"
    if attrs:
        header += f" {attrs}"
    header += ">"
    if text:
        header += f" {text}"
    print(header)
    for child in list(elem):
        print_element_tree(child, indent + 2)


def extract_stock_group_fragment(xml_text: str, group_name: str):
    if not xml_text:
        return None

    target_name = group_name.strip().upper()
    blocks = re.findall(r"<STOCKGROUP\b.*?</STOCKGROUP>", xml_text, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks:
        name_match = re.search(r"<NAME[^>]*>(.*?)</NAME>", block, flags=re.IGNORECASE | re.DOTALL)
        if not name_match:
            continue
        found_name = re.sub(r"\s+", " ", name_match.group(1)).strip()
        if found_name.upper() != target_name:
            continue
        return block
    return None


def print_stock_group_summary(response_text: str, group_name: str):
    try:
        root = ET.fromstring(sanitize_tally_xml(response_text))
        stock_groups = root.findall(".//STOCKGROUP")
    except ET.ParseError as exc:
        print(f"XML parse failed even after sanitizing: {exc}")
        stock_groups = []

    if stock_groups:
        for index, stock_group in enumerate(stock_groups, start=1):
            print(f"\nParsed STOCKGROUP #{index}")
            print(f"NAME: {stock_group.findtext('NAME')}")
            print(f"PARENT: {stock_group.findtext('PARENT')}")
            print(f"BASEUNITS: {stock_group.findtext('BASEUNITS')}")
            print(f"ISADDABLE: {stock_group.findtext('ISADDABLE')}")
            print(
                "SHOULDQUANTITIESOFITEMSBEADDED: "
                f"{stock_group.findtext('SHOULDQUANTITIESOFITEMSBEADDED')}"
            )
            print("\nNode tree:")
            print_element_tree(stock_group, indent=2)
        return

    fragment = extract_stock_group_fragment(response_text, group_name)
    if fragment:
        print("\nCould not fully parse XML, but matching STOCKGROUP fragment was found:\n")
        print(fragment)
        return

    print("No matching <STOCKGROUP> node found in response.")


def main():
    if len(sys.argv) < 2:
        print('Usage: python fetch_tally_stock_group_xml.py "Stock Group Name" [Company Name]')
        sys.exit(1)

    group_name = sys.argv[1]
    company_name = sys.argv[2] if len(sys.argv) > 2 else TALLY_COMPANY

    request_xml = build_stock_group_export_xml(group_name, company_name)

    print(f"TALLY_URL: {TALLY_URL}")
    print(f"Company: {company_name}")
    print("\nRequest XML:")
    print(request_xml)

    print("\nResponse XML:")
    response_text = post_to_tally(request_xml)
    print(response_text)

    print("\nParsed summary:")
    print_stock_group_summary(response_text, group_name)


if __name__ == "__main__":
    main()
