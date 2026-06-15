import os
import json
from datetime import datetime
import xml.sax.saxutils as saxutils

def esc(value):
    if value is None:
        return ""
    return saxutils.escape(str(value))

def to_float(value):
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except Exception:
        return 0.0

def format_tally_date(value):
    return "20260610"

mrr = {
    "invoiceNo": "86",
    "transactionNo": "MI/26-27/00003",
    "date": "2026-06-10",
    "invDate": "2026-06-10",
    "insurance": 0,
    "otherCharges": 0,
    "totalCgst": 0,
    "totalSgst": 0,
    "totalIgst": 0
}

supplier_name = "Some Supplier" # Placeholder
item_lines = [
    {
        "itemName": "Stitching Wire (Normal)",
        "qty": 100.6,
        "uom": "KG",
        "rate": 116,
        "cost": 116
    },
    {
        "itemName": "Plastic Sutli",
        "qty": 50,
        "uom": "KG",
        "rate": 70,
        "cost": 70
    }
]

VOUCHER_TYPE_NAME = "Purchase"
PURCHASE_LEDGER_NAME = "Purchase"
DEFAULT_GODOWN_NAME = "Main Location"
DEFAULT_BATCH_NAME = "Primary Batch"
TALLY_COMPANY_NAME = "Laxmi Narayan Packaging Industries"

invoice_no = mrr.get("invoiceNo") or mrr.get("transactionNo")
invoice_date = format_tally_date(mrr.get("invDate") or mrr.get("date"))
transaction_no = mrr.get("transactionNo")

insurance = to_float(mrr.get("insurance"))
other_charges = to_float(mrr.get("otherCharges"))
cgst = to_float(mrr.get("totalCgst"))
sgst = to_float(mrr.get("totalSgst"))
igst = to_float(mrr.get("totalIgst"))

inventory_xml = ""
total_item_amount = 0.0

for line in item_lines:
    item_name = line.get("itemName") or ""
    qty = to_float(line.get("qty"))
    uom = line.get("uom") or ""
    rate = to_float(line.get("rate"))
    cost = to_float(line.get("cost"))

    amount = round(qty * rate, 2)
    total_item_amount += amount

    inventory_xml += f"""
                    <ALLINVENTORYENTRIES.LIST>
                        <STOCKITEMNAME>{esc(item_name)}</STOCKITEMNAME>
                        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                        <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>

                        <ACTUALQTY>{qty} {esc(uom)}</ACTUALQTY>
                        <BILLEDQTY>{qty} {esc(uom)}</BILLEDQTY>
                        <RATE>{rate}/{esc(uom)}</RATE>
                        <AMOUNT>-{amount}</AMOUNT>

                        <ACCOUNTINGALLOCATIONS.LIST>
                            <LEDGERNAME>{esc(PURCHASE_LEDGER_NAME)}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-{amount}</AMOUNT>
                        </ACCOUNTINGALLOCATIONS.LIST>

                        <BATCHALLOCATIONS.LIST>
                            <GODOWNNAME>{esc(DEFAULT_GODOWN_NAME)}</GODOWNNAME>
                            <BATCHNAME>{esc(DEFAULT_BATCH_NAME)}</BATCHNAME>
                            <AMOUNT>-{amount}</AMOUNT>
                            <ACTUALQTY>{qty} {esc(uom)}</ACTUALQTY>
                            <BILLEDQTY>{qty} {esc(uom)}</BILLEDQTY>
                        </BATCHALLOCATIONS.LIST>

                        <UDF:COST.LIST DESC="`COST`" ISLIST="YES" TYPE="Number">
                            <UDF:COST>{cost}</UDF:COST>
                        </UDF:COST.LIST>
                    </ALLINVENTORYENTRIES.LIST>
    """

total_item_amount = round(total_item_amount, 2)
total_invoice_amount = round(total_item_amount + insurance + other_charges + cgst + sgst + igst, 2)

ledger_entries_xml = f"""
                    <LEDGERENTRIES.LIST>
                        <LEDGERNAME>{esc(supplier_name)}</LEDGERNAME>
                        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                        <AMOUNT>{total_invoice_amount}</AMOUNT>

                        <BILLALLOCATIONS.LIST>
                            <NAME>{esc(invoice_no)}</NAME>
                            <BILLTYPE>New Ref</BILLTYPE>
                            <AMOUNT>{total_invoice_amount}</AMOUNT>
                        </BILLALLOCATIONS.LIST>
                    </LEDGERENTRIES.LIST>
"""

xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{esc(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="{esc(VOUCHER_TYPE_NAME)}" ACTION="Create">
                        <DATE>{invoice_date}</DATE>
                        <VOUCHERTYPENAME>{esc(VOUCHER_TYPE_NAME)}</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>{esc(invoice_no)}</VOUCHERNUMBER>
                        <REFERENCE>{esc(transaction_no)}</REFERENCE>
                        <PARTYLEDGERNAME>{esc(supplier_name)}</PARTYLEDGERNAME>
                        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
                        <ISINVOICE>Yes</ISINVOICE>
                        {inventory_xml}
                        {ledger_entries_xml}
                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""

print(xml)
