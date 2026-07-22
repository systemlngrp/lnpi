"""Tally Stock Item + latest purchase fetcher.

Run with:
    python tally_stock_purchase_fetcher.py

Tally must be running locally with XML/HTTP enabled.  The application asks for
the port (normally 9004), then displays and exports these fields:
ERP Item Name, Stock Group, HSN, Unit, Last Supplier, Last Purchase Date and
Last Purchase Rate.
"""

from __future__ import annotations

import csv
import re
import threading
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, Y, StringVar, Tk, filedialog, messagebox
from tkinter import ttk
from typing import Iterable

import requests


DEFAULT_PORT = "9000"
TIMEOUT_SECONDS = 90
COLUMNS = (
    ("item_name", "ERP Item Name", 42),
    ("stock_group", "Stock Group", 24),
    ("hsn", "HSN", 16),
    ("unit", "Unit", 12),
    ("last_supplier", "Last Supplier", 32),
    ("last_purchase_date", "Last Purchase Date", 17),
    ("last_purchase_rate", "Last Purchase Rate", 18),
)


@dataclass
class StockPurchaseRow:
    item_name: str
    stock_group: str = ""
    hsn: str = ""
    unit: str = ""
    last_supplier: str = ""
    last_purchase_date: str = ""
    last_purchase_rate: str = ""


def xml_escape(value: object) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def is_valid_xml_char(codepoint: int) -> bool:
    return (
        codepoint in (0x09, 0x0A, 0x0D)
        or 0x20 <= codepoint <= 0xD7FF
        or 0xE000 <= codepoint <= 0xFFFD
        or 0x10000 <= codepoint <= 0x10FFFF
    )


def clean_xml(value: str) -> str:
    text = str(value or "").lstrip("\ufeff")

    def clean_char_ref(match: re.Match[str]) -> str:
        raw = match.group(1)
        try:
            codepoint = int(raw[1:], 16) if raw.lower().startswith("x") else int(raw, 10)
        except ValueError:
            return ""
        return match.group(0) if is_valid_xml_char(codepoint) else ""

    text = re.sub(r"&#(x[0-9A-Fa-f]+|\d+);", clean_char_ref, text)
    text = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)", "&amp;", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text.strip()

def find_text(element: ET.Element, *tag_names: str) -> str:
    wanted = {name.upper() for name in tag_names}
    for child in element.iter():
        if child.tag.upper() in wanted and (child.text or "").strip():
            return (child.text or "").strip()
    return ""


def parse_tally_date(value: str) -> datetime | None:
    text = str(value or "").strip()
    for pattern in ("%Y%m%d", "%d-%b-%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            pass
    return None


def display_date(value: str) -> str:
    parsed = parse_tally_date(value)
    return parsed.strftime("%d-%m-%Y") if parsed else str(value or "").strip()


def parse_rate(value: str) -> float | None:
    match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", str(value or ""))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def format_rate(value: str) -> str:
    numeric = parse_rate(value)
    return f"{numeric:,.4f}".rstrip("0").rstrip(".") if numeric is not None else str(value or "").strip()


class TallyClient:
    def __init__(self, port: str, company: str = "") -> None:
        port = str(port or "").strip()
        if not port.isdigit() or not 1 <= int(port) <= 65535:
            raise ValueError("Enter a valid Tally port number (for example, 9004).")
        self.port = port
        self.company = company.strip()
        self.active_url = ""

    def post(self, request_xml: str) -> str:
        urls = [f"http://localhost:{self.port}", f"http://127.0.0.1:{self.port}"]
        if self.active_url:
            urls = [self.active_url] + [url for url in urls if url != self.active_url]
        last_error: Exception | None = None
        for url in urls:
            try:
                response = requests.post(
                    url,
                    data=request_xml.encode("utf-8"),
                    headers={"Content-Type": "application/xml; charset=utf-8"},
                    timeout=TIMEOUT_SECONDS,
                )
                response.raise_for_status()
                self.active_url = url
                return response.text
            except requests.RequestException as error:
                last_error = error
        raise RuntimeError(
            f"Could not connect to Tally on port {self.port}. Start Tally, open the company, "
            "and enable XML/HTTP connectivity."
        ) from last_error

    def static_variables(self) -> str:
        company = f"<SVCURRENTCOMPANY>{xml_escape(self.company)}</SVCURRENTCOMPANY>" if self.company else ""
        return f"""{company}
            <SVFROMDATE>20000101</SVFROMDATE>
            <SVTODATE>20991231</SVTODATE>
            <SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT>"""

    def companies_xml(self) -> str:
        return """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>EXPORT</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>CompaniesForPurchaseReport</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES><SVEXPORTFORMAT>$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="CompaniesForPurchaseReport" ISMODIFY="No">
        <TYPE>Company</TYPE>
        <FETCH>Name</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>"""

    def stock_items_xml(self) -> str:
        return f"""<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>EXPORT</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>StockItemsForPurchaseReport</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>{self.static_variables()}</STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="StockItemsForPurchaseReport" ISMODIFY="No">
        <TYPE>StockItem</TYPE>
        <FETCH>Name</FETCH><FETCH>Parent</FETCH><FETCH>BaseUnits</FETCH><FETCH>HSNCode</FETCH>
        <FETCH>GSTDetails.List</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>"""

    def purchase_vouchers_xml(self) -> str:
        return f"""<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>EXPORT</TALLYREQUEST><TYPE>COLLECTION</TYPE><ID>PurchaseVouchersForStockReport</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>{self.static_variables()}</STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="PurchaseVouchersForStockReport" ISMODIFY="No">
        <TYPE>Voucher</TYPE>
        <FETCH>Date</FETCH><FETCH>VoucherTypeName</FETCH><FETCH>PartyLedgerName</FETCH>
        <FETCH>AllInventoryEntries.List</FETCH>
        <FILTERS>OnlyPurchaseVouchers</FILTERS>
      </COLLECTION>
      <SYSTEM TYPE="Formulae" NAME="OnlyPurchaseVouchers">$$IsPurchase:$VoucherTypeName</SYSTEM>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>"""

    def fetch_company_names(self) -> list[str]:
        return parse_company_names(self.post(self.companies_xml()))

    def fetch_rows(self) -> list[StockPurchaseRow]:
        selected_company = self.company
        if not selected_company:
            companies = self.fetch_company_names()
            if len(companies) == 1:
                self.company = companies[0]
                selected_company = self.company

        stock_response = self.post(self.stock_items_xml())
        stock_items = parse_stock_items(stock_response)
        if not stock_items:
            company_text = f" for company '{selected_company}'" if selected_company else ""
            raise RuntimeError(
                f"Tally connected on port {self.port}, but returned 0 stock items{company_text}. "
                "Open the inventory company in the same Tally instance that has XML/HTTP enabled, "
                "or enter the exact company name shown in Tally. Also confirm stock-item masters exist."
            )

        purchase_response = self.post(self.purchase_vouchers_xml())
        latest_purchase = parse_latest_purchases(purchase_response)
        for row in stock_items:
            purchase = latest_purchase.get(row.item_name.casefold())
            if purchase:
                row.last_supplier, row.last_purchase_date, row.last_purchase_rate = purchase
        return sorted(stock_items, key=lambda row: row.item_name.casefold())


def parse_stock_items(xml_text: str) -> list[StockPurchaseRow]:
    try:
        root = ET.fromstring(clean_xml(xml_text))
    except ET.ParseError as error:
        raise RuntimeError(f"Tally returned unreadable stock-item XML: {error}") from error

    rows: list[StockPurchaseRow] = []
    seen: set[str] = set()
    for item in root.findall(".//STOCKITEM"):
        name = str(item.get("NAME") or find_text(item, "NAME")).strip()
        key = name.casefold()
        if not name or key in seen:
            continue
        seen.add(key)
        rows.append(
            StockPurchaseRow(
                item_name=name,
                stock_group=find_text(item, "PARENT"),
                hsn=find_text(item, "HSNCODE", "HSN"),
                unit=find_text(item, "BASEUNITS"),
            )
        )
    return rows

def parse_company_names(xml_text: str) -> list[str]:
    try:
        root = ET.fromstring(clean_xml(xml_text))
    except ET.ParseError:
        return []

    names: list[str] = []
    seen: set[str] = set()
    for company in root.findall(".//COMPANY"):
        name = str(company.get("NAME") or find_text(company, "NAME")).strip()
        key = name.casefold()
        if name and key not in seen:
            names.append(name)
            seen.add(key)
    return names
def iter_inventory_entries(voucher: ET.Element) -> Iterable[ET.Element]:
    for entry in voucher.iter():
        if entry.tag.upper().endswith("INVENTORYENTRIES.LIST"):
            yield entry


def parse_latest_purchases(xml_text: str) -> dict[str, tuple[str, str, str]]:
    try:
        root = ET.fromstring(clean_xml(xml_text))
    except ET.ParseError as error:
        raise RuntimeError(f"Tally returned unreadable purchase-voucher XML: {error}") from error

    latest: dict[str, tuple[datetime, str, str, str]] = {}
    for voucher in root.findall(".//VOUCHER"):
        voucher_type = find_text(voucher, "VOUCHERTYPENAME")
        # This check also protects the result when a Tally installation ignores the TDL filter.
        if "purchase" not in voucher_type.casefold():
            continue
        voucher_date = parse_tally_date(find_text(voucher, "DATE"))
        if voucher_date is None:
            continue
        supplier = find_text(voucher, "PARTYLEDGERNAME", "PARTYNAME")
        for entry in iter_inventory_entries(voucher):
            item_name = find_text(entry, "STOCKITEMNAME")
            if not item_name:
                continue
            rate = format_rate(find_text(entry, "RATE"))
            key = item_name.casefold()
            previous = latest.get(key)
            if previous is None or voucher_date >= previous[0]:
                latest[key] = (voucher_date, supplier, display_date(voucher_date.strftime("%Y%m%d")), rate)
    return {key: (supplier, purchase_date, rate) for key, (_, supplier, purchase_date, rate) in latest.items()}


class StockPurchaseApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("Tally Stock Purchase Fetcher")
        self.root.geometry("1280x720")
        self.root.minsize(980, 580)
        self.rows: list[StockPurchaseRow] = []
        self.port_var = StringVar(value=DEFAULT_PORT)
        self.company_var = StringVar()
        self.search_var = StringVar()
        self.status_var = StringVar(value="Enter the Tally port and click Fetch Data.")
        self._build_ui()

    def _build_ui(self) -> None:
        style = ttk.Style(self.root)
        style.configure("Header.TLabel", font=("Segoe UI", 16, "bold"))
        style.configure("Status.TLabel", padding=(4, 8))

        top = ttk.Frame(self.root, padding=16)
        top.pack(fill=X)
        ttk.Label(top, text="Tally Stock Item Purchase Fetcher", style="Header.TLabel").pack(anchor="w")
        ttk.Label(top, text="Fetch master data and the most recent purchase details for every stock item.").pack(anchor="w", pady=(3, 12))

        controls = ttk.LabelFrame(top, text="Connection", padding=12)
        controls.pack(fill=X)
        ttk.Label(controls, text="Tally XML Port *").grid(row=0, column=0, sticky="w")
        ttk.Entry(controls, textvariable=self.port_var, width=12).grid(row=1, column=0, sticky="w", padx=(0, 14))
        ttk.Label(controls, text="Company (optional; blank = company open in Tally)").grid(row=0, column=1, sticky="w")
        ttk.Entry(controls, textvariable=self.company_var, width=46).grid(row=1, column=1, sticky="ew", padx=(0, 14))
        self.fetch_button = ttk.Button(controls, text="Fetch Data", command=self.fetch_data)
        self.fetch_button.grid(row=1, column=2, sticky="e")
        controls.columnconfigure(1, weight=1)

        actions = ttk.Frame(self.root, padding=(16, 0, 16, 8))
        actions.pack(fill=X)
        ttk.Label(actions, text="Search:").pack(side=LEFT)
        search = ttk.Entry(actions, textvariable=self.search_var, width=42)
        search.pack(side=LEFT, padx=(6, 12))
        self.search_var.trace_add("write", lambda *_: self.populate_table())
        ttk.Button(actions, text="Export CSV", command=self.export_csv).pack(side=RIGHT)

        table_frame = ttk.Frame(self.root, padding=(16, 0, 16, 0))
        table_frame.pack(fill=BOTH, expand=True)
        column_ids = [column_id for column_id, _, _ in COLUMNS]
        self.table = ttk.Treeview(table_frame, columns=column_ids, show="headings", selectmode="browse")
        for column_id, label, width in COLUMNS:
            self.table.heading(column_id, text=label, command=lambda field=column_id: self.sort_by(field))
            self.table.column(column_id, width=width * 7, minwidth=90, anchor="w")
        vertical = ttk.Scrollbar(table_frame, orient="vertical", command=self.table.yview)
        horizontal = ttk.Scrollbar(table_frame, orient="horizontal", command=self.table.xview)
        self.table.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        self.table.pack(side=LEFT, fill=BOTH, expand=True)
        vertical.pack(side=RIGHT, fill=Y)
        horizontal.pack(side="bottom", fill=X)

        ttk.Label(self.root, textvariable=self.status_var, relief="sunken", style="Status.TLabel").pack(fill=X, side="bottom")

    def fetch_data(self) -> None:
        try:
            TallyClient(self.port_var.get(), self.company_var.get())
        except ValueError as error:
            messagebox.showerror("Invalid port", str(error), parent=self.root)
            return
        self.fetch_button.configure(state="disabled")
        self.status_var.set("Connecting to Tally and downloading stock items...")
        threading.Thread(target=self._fetch_worker, daemon=True).start()

    def _fetch_worker(self) -> None:
        try:
            client = TallyClient(self.port_var.get(), self.company_var.get())
            rows = client.fetch_rows()
            self.root.after(0, lambda rows=rows: self._fetch_complete(rows))
        except Exception as error:
            message = str(error)
            self.root.after(0, lambda message=message: self._fetch_failed(message))

    def _fetch_complete(self, rows: list[StockPurchaseRow]) -> None:
        self.rows = rows
        self.populate_table()
        self.fetch_button.configure(state="normal")
        self.status_var.set(f"Fetched {len(rows):,} stock items from Tally on port {self.port_var.get().strip()}.")

    def _fetch_failed(self, error: str) -> None:
        self.fetch_button.configure(state="normal")
        self.status_var.set("Fetch failed.")
        messagebox.showerror("Could not fetch from Tally", error, parent=self.root)

    def filtered_rows(self) -> list[StockPurchaseRow]:
        query = self.search_var.get().strip().casefold()
        if not query:
            return self.rows
        return [row for row in self.rows if query in " ".join(asdict(row).values()).casefold()]

    def populate_table(self) -> None:
        self.table.delete(*self.table.get_children())
        for row in self.filtered_rows():
            self.table.insert("", END, values=[getattr(row, column_id) for column_id, _, _ in COLUMNS])

    def sort_by(self, field: str) -> None:
        self.rows.sort(key=lambda row: getattr(row, field).casefold())
        self.populate_table()

    def export_csv(self) -> None:
        rows = self.filtered_rows()
        if not rows:
            messagebox.showinfo("Nothing to export", "Fetch data first, or change the search filter.", parent=self.root)
            return
        target = filedialog.asksaveasfilename(
            parent=self.root,
            title="Export stock purchase data",
            defaultextension=".csv",
            initialfile=f"tally_stock_purchase_{datetime.now():%Y%m%d_%H%M}.csv",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not target:
            return
        with Path(target).open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.writer(file)
            writer.writerow([label for _, label, _ in COLUMNS])
            writer.writerows(
                [getattr(row, column_id) for column_id, _, _ in COLUMNS]
                for row in rows
            )
        self.status_var.set(f"Exported {len(rows):,} row(s) to {target}")


def main() -> None:
    root = Tk()
    StockPurchaseApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
