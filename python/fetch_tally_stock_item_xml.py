import argparse
import re
import sys
import xml.dom.minidom
from pathlib import Path

import requests


REQUEST_TIMEOUT = 15


def escape_xml(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def clean_tally_xml(xml_text: str) -> str:
    cleaned = str(xml_text or "")
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", cleaned)
    cleaned = re.sub(r"&#(?:0?[0-8]|1[12]|1[4-9]|2[0-9]|3[01]);", "", cleaned)
    cleaned = re.sub(r"&#x(?:[0-8]|[bBcCeE]|1[0-9A-Fa-f]);", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def build_tally_urls(port: str) -> list[str]:
    clean_port = str(port or "9004").strip() or "9004"
    return [
        f"http://localhost:{clean_port}",
        f"http://127.0.0.1:{clean_port}",
    ]


def build_request_xml(item_name: str, company_name: str | None) -> str:
    company_xml = ""
    if company_name and company_name.strip():
        company_xml = f"<SVCURRENTCOMPANY>{escape_xml(company_name.strip())}</SVCURRENTCOMPANY>"

    return f"""<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Object</TYPE>
        <SUBTYPE>Stock Item</SUBTYPE>
        <ID TYPE="Name">{escape_xml(item_name)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                {company_xml}
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <FETCHLIST>
                <FETCH>Name</FETCH>
                <FETCH>GUID</FETCH>
                <FETCH>Parent</FETCH>
                <FETCH>PartNo</FETCH>
                <FETCH>PartNumber</FETCH>
                <FETCH>BaseUnits</FETCH>
                <FETCH>MailingName.LIST</FETCH>
                <FETCH>LanguageName.LIST</FETCH>
            </FETCHLIST>
        </DESC>
    </BODY>
</ENVELOPE>"""


def fetch_from_tally(item_name: str, company_name: str | None, port: str) -> tuple[str, str]:
    payload = build_request_xml(item_name, company_name)
    last_error: Exception | None = None

    for url in build_tally_urls(port):
        try:
            response = requests.post(
                url,
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/xml"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            return url, response.text
        except Exception as error:
            last_error = error

    raise RuntimeError(f"Could not connect to Tally on port {port}.") from last_error


def pretty_print_xml(xml_text: str) -> str:
    cleaned = clean_tally_xml(xml_text)
    try:
        parsed = xml.dom.minidom.parseString(cleaned.encode("utf-8"))
        return parsed.toprettyxml(indent="  ")
    except Exception:
        return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch raw XML structure of a Stock Item from Tally.")
    parser.add_argument("item_name", help="Exact stock item name in Tally")
    parser.add_argument("--company", help="Tally company name", default="")
    parser.add_argument("--port", help="Tally XML port", default="9004")
    parser.add_argument(
        "--output",
        help="Optional output XML file path. Default: current folder / stock_item_xml_<safe_name>.xml",
        default="",
    )
    args = parser.parse_args()

    url, response_text = fetch_from_tally(args.item_name, args.company, args.port)
    formatted_xml = pretty_print_xml(response_text)

    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", args.item_name).strip("_") or "stock_item"
    output_path = Path(args.output) if args.output else Path.cwd() / f"stock_item_xml_{safe_name}.xml"
    output_path.write_text(formatted_xml, encoding="utf-8")

    print(f"Connected to Tally at: {url}")
    print(f"Stock item requested: {args.item_name}")
    if args.company:
        print(f"Company: {args.company}")
    print(f"Saved XML to: {output_path}")
    print()
    print(formatted_xml)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}")
        sys.exit(1)
