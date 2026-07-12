import argparse
import re
import sys
import xml.dom.minidom
import xml.etree.ElementTree as ET
from pathlib import Path

import requests


REQUEST_TIMEOUT = 8
DEFAULT_PORT = "9004"
DEFAULT_VOUCHER_TYPE = "Purchase"


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
    return [
        f"http://localhost:{port}",
        f"http://127.0.0.1:{port}",
    ]


def build_request_xml(voucher_number: str, company_name: str | None) -> str:
    company_xml = ""
    if company_name and company_name.strip():
        company_xml = f"<SVCURRENTCOMPANY>{escape_xml(company_name.strip())}</SVCURRENTCOMPANY>"

    safe_type = escape_xml(DEFAULT_VOUCHER_TYPE)
    voucher_type_xml = f"<VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>"
    voucher_type_attr = f' VCHTYPE="{safe_type}"'

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
                    <SVFROMDATE>20200101</SVFROMDATE>
                    <SVTODATE>20991231</SVTODATE>
                    {voucher_type_xml}
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE>
                    <VOUCHER VOUCHERNUMBER="{safe_number}"{voucher_type_attr} ACTION="Get" />
                </TALLYMESSAGE>
            </REQUESTDATA>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>"""


def build_lookup_xml(voucher_number: str, company_name: str | None) -> str:
    company_xml = ""
    if company_name and company_name.strip():
        company_xml = f"<SVCURRENTCOMPANY>{escape_xml(company_name.strip())}</SVCURRENTCOMPANY>"

    safe_number = escape_xml(voucher_number)
    safe_type = escape_xml(DEFAULT_VOUCHER_TYPE)
    return f"""<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>EXPORT</TALLYREQUEST>
        <TYPE>COLLECTION</TYPE>
        <ID>VoucherLookup</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                {company_xml}
                <SVFROMDATE>20200101</SVFROMDATE>
                <SVTODATE>20991231</SVTODATE>
                <VOUCHERTYPENAME>{safe_type}</VOUCHERTYPENAME>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <TDL>
                <TDLMESSAGE>
                    <COLLECTION NAME="VoucherLookup" ISMODIFY="No">
                        <TYPE>Voucher</TYPE>
                        <FETCH>Date</FETCH>
                        <FETCH>VoucherNumber</FETCH>
                        <FETCH>MasterID</FETCH>
                        <FETCH>GUID</FETCH>
                        <FETCH>VoucherKey</FETCH>
                        <FETCH>RemoteID</FETCH>
                        <FETCH>PartyLedgerName</FETCH>
                        <FILTERS>OnlyTargetVoucher</FILTERS>
                    </COLLECTION>
                    <SYSTEM TYPE="Formulae" NAME="OnlyTargetVoucher">
                        $$StringEqual:$VoucherNumber:"{safe_number}"
                    </SYSTEM>
                </TDLMESSAGE>
            </TDL>
        </DESC>
    </BODY>
</ENVELOPE>"""


def build_object_export_xml(id_type: str, id_value: str, company_name: str | None) -> str:
    company_xml = ""
    if company_name and company_name.strip():
        company_xml = f"<SVCURRENTCOMPANY>{escape_xml(company_name.strip())}</SVCURRENTCOMPANY>"

    return f"""<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>EXPORT</TALLYREQUEST>
        <TYPE>OBJECT</TYPE>
        <SUBTYPE>Voucher</SUBTYPE>
        <ID TYPE="{escape_xml(id_type)}">{escape_xml(id_value)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                {company_xml}
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
        </DESC>
    </BODY>
</ENVELOPE>"""


def post_xml(payload: str, port: str) -> tuple[str, str]:
    last_error: Exception | None = None

    for url in build_tally_urls(port):
        try:
            print(f"Trying Tally URL: {url}", flush=True)
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
            print(f"Failed on {url}: {error}", flush=True)

    raise RuntimeError(
        f"Could not fetch {DEFAULT_VOUCHER_TYPE} voucher XML from Tally on port {port}. "
        f"Last error: {last_error}"
    ) from last_error


def _safe_xml_text(element: ET.Element | None, tag_name: str) -> str:
    if element is None:
        return ""
    child = element.find(tag_name)
    if child is None:
        return ""
    return str(child.text or "").strip()


def parse_lookup_ids(xml_text: str) -> dict[str, str]:
    cleaned = clean_tally_xml(xml_text)
    if not cleaned:
        return {}
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return {}

    for element in root.iter():
        values = {
            "MasterID": _safe_xml_text(element, "MASTERID"),
            "GUID": _safe_xml_text(element, "GUID"),
            "VoucherKey": _safe_xml_text(element, "VOUCHERKEY"),
            "RemoteID": _safe_xml_text(element, "REMOTEID"),
            "VoucherNumber": _safe_xml_text(element, "VOUCHERNUMBER"),
        }
        if values["VoucherNumber"] and any(values[key] for key in ("MasterID", "GUID", "VoucherKey", "RemoteID")):
            return values
    return {}


def fetch_from_tally(voucher_number: str, company_name: str | None, port: str) -> tuple[str, str]:
    print("Step 1: Looking up voucher internal IDs...", flush=True)
    lookup_url, lookup_response = post_xml(build_lookup_xml(voucher_number, company_name), port)
    lookup_ids = parse_lookup_ids(lookup_response)
    if lookup_ids:
        print(
            "Lookup success: "
            f"MasterID={lookup_ids.get('MasterID') or '-'} | "
            f"GUID={lookup_ids.get('GUID') or '-'} | "
            f"VoucherKey={lookup_ids.get('VoucherKey') or '-'}",
            flush=True,
        )
        for id_type, lookup_key in (("MasterID", "MasterID"), ("GUID", "GUID"), ("VoucherKey", "VoucherKey"), ("RemoteID", "RemoteID")):
            id_value = lookup_ids.get(lookup_key) or ""
            if not id_value:
                continue
            print(f"Step 2: Exporting voucher object by {id_type}...", flush=True)
            object_url, object_response = post_xml(build_object_export_xml(id_type, id_value, company_name), port)
            if contains_voucher(object_response, voucher_number):
                return object_url, object_response
        print("Object export by internal IDs did not return the voucher. Falling back to direct voucher request...", flush=True)
    else:
        print("Lookup did not return internal IDs. Falling back to direct voucher request...", flush=True)

    return post_xml(build_request_xml(voucher_number, company_name), port)


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


def sanitize_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip()).strip("_") or "voucher"


def prompt_if_missing(voucher_number: str | None) -> str:
    if voucher_number and voucher_number.strip():
        return voucher_number.strip()
    entered = input("Enter Tally voucher number: ").strip()
    if not entered:
        raise RuntimeError("Voucher number is required.")
    return entered


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch raw XML structure of a Purchase voucher by voucher number.")
    parser.add_argument("voucher_number", nargs="?", help="Purchase voucher number in Tally")
    parser.add_argument("--company", help="Optional Tally company name", default="")
    parser.add_argument("--port", help=f"Tally XML port. Default: {DEFAULT_PORT}", default=DEFAULT_PORT)
    parser.add_argument(
        "--output",
        help="Optional output XML file path. Default: current folder / tally_purchase_voucher_xml_<number>.xml",
        default="",
    )
    args = parser.parse_args()

    voucher_number = prompt_if_missing(args.voucher_number)
    print(
        f"Fetching {DEFAULT_VOUCHER_TYPE} voucher XML for voucher number {voucher_number} from port {args.port}...",
        flush=True,
    )
    url, response_text = fetch_from_tally(voucher_number, args.company, args.port)
    formatted_xml = pretty_print_xml(response_text)

    if not contains_voucher(response_text, voucher_number):
        print("WARNING: Tally response did not clearly contain the requested Purchase voucher.")
        print("Please confirm the voucher number exists in the currently open company.")
        print()

    safe_number = sanitize_name(voucher_number)
    output_path = (
        Path(args.output)
        if args.output
        else Path.cwd() / f"tally_purchase_voucher_xml_{safe_number}.xml"
    )
    output_path.write_text(formatted_xml, encoding="utf-8")

    print(f"Connected to Tally at: {url}")
    print(f"Voucher requested: {voucher_number}")
    print(f"Voucher type: {DEFAULT_VOUCHER_TYPE}")
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
