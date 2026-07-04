import argparse
import re
import sys
import xml.dom.minidom
from pathlib import Path

import requests


REQUEST_TIMEOUT = 20
DEFAULT_PORT = "9004"


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


def build_tally_urls() -> list[str]:
    return [
        f"http://localhost:{DEFAULT_PORT}",
        f"http://127.0.0.1:{DEFAULT_PORT}",
    ]


def build_request_xml(voucher_number: str, company_name: str | None) -> str:
    company_xml = ""
    if company_name and company_name.strip():
        company_xml = f"<SVCURRENTCOMPANY>{escape_xml(company_name.strip())}</SVCURRENTCOMPANY>"

    safe_number = escape_xml(voucher_number)
    return f"""<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    {company_xml}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <SVFROMDATE>20240101</SVFROMDATE>
                    <SVTODATE>20991231</SVTODATE>
                    <VOUCHERTYPENAME>Manufacturing Journal</VOUCHERTYPENAME>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <VOUCHER VCHTYPE="Manufacturing Journal" VOUCHERNUMBER="{safe_number}" ACTION="Get" />
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""


def fetch_from_tally(voucher_number: str, company_name: str | None) -> tuple[str, str]:
    payload = build_request_xml(voucher_number, company_name)
    last_error: Exception | None = None

    for url in build_tally_urls():
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

    raise RuntimeError(f"Could not connect to Tally on port {DEFAULT_PORT}.") from last_error


def pretty_print_xml(xml_text: str) -> str:
    cleaned = clean_tally_xml(xml_text)
    try:
        parsed = xml.dom.minidom.parseString(cleaned.encode("utf-8"))
        return parsed.toprettyxml(indent="  ")
    except Exception:
        return cleaned


def contains_voucher(xml_text: str, voucher_number: str) -> bool:
    xml_upper = str(xml_text or "").upper()
    voucher_upper = str(voucher_number or "").strip().upper()
    return "<VOUCHER" in xml_upper and voucher_upper in xml_upper


def prompt_if_missing(voucher_number: str | None) -> str:
    if voucher_number and voucher_number.strip():
        return voucher_number.strip()
    entered = input("Enter Manufacturing Journal number: ").strip()
    if not entered:
        raise RuntimeError("Manufacturing Journal number is required.")
    return entered


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch raw XML structure of a Manufacturing Journal from Tally.")
    parser.add_argument("voucher_number", nargs="?", help="Manufacturing Journal voucher number in Tally")
    parser.add_argument("--company", help="Optional Tally company name", default="")
    parser.add_argument(
        "--output",
        help="Optional output XML file path. Default: current folder / manufacturing_journal_xml_<safe_number>.xml",
        default="",
    )
    args = parser.parse_args()

    voucher_number = prompt_if_missing(args.voucher_number)
    url, response_text = fetch_from_tally(voucher_number, args.company)
    formatted_xml = pretty_print_xml(response_text)

    if not contains_voucher(response_text, voucher_number):
        print("WARNING: Tally response did not clearly contain the requested Manufacturing Journal.")
        print("Please confirm the voucher number exists in the currently open company and is a Manufacturing Journal.")
        print()

    safe_number = re.sub(r"[^A-Za-z0-9._-]+", "_", voucher_number).strip("_") or "manufacturing_journal"
    output_path = (
        Path(args.output)
        if args.output
        else Path.cwd() / f"manufacturing_journal_xml_{safe_number}.xml"
    )
    output_path.write_text(formatted_xml, encoding="utf-8")

    print(f"Connected to Tally at: {url}")
    print(f"Manufacturing Journal requested: {voucher_number}")
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
