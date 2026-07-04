import logging
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from tkinter import END, BOTH, LEFT, RIGHT, VERTICAL, X, Y, StringVar, Tk, messagebox
from tkinter import ttk
from typing import Any

import requests
from requests import exceptions as requests_exceptions


REQUEST_TIMEOUT = 8
DEFAULT_TALLY_PORT = "9004"
SELECTED_TALLY_PORT = DEFAULT_TALLY_PORT
ACTIVE_TALLY_URL: str | None = None


def build_tally_url_candidates(port: str) -> list[str]:
    clean_port = str(port or DEFAULT_TALLY_PORT).strip() or DEFAULT_TALLY_PORT
    return [
        f"http://localhost:{clean_port}",
        f"http://127.0.0.1:{clean_port}",
    ]


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


LOG_FILE = app_dir() / "tally_stock_item_bulk_updater.log"


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("tally_stock_item_bulk_updater")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    logger.propagate = False
    return logger


LOGGER = setup_logger()


def escape_xml(text: Any) -> str:
    value = "" if text is None else str(text)
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def clean_tally_xml(xml_content: str | bytes) -> str:
    if isinstance(xml_content, bytes):
        text = xml_content.decode("utf-8", errors="ignore")
    else:
        text = str(xml_content or "")
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    text = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)", "&amp;", text)
    text = re.sub(r"&#(?!\d+;)", "&amp;#", text)
    text = re.sub(r"&#x(?![0-9A-Fa-f]+;)", "&amp;#x", text)
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", text)
    return text.strip()


def is_target_stock_item(item_name: str, stock_group: str) -> bool:
    normalized_name = str(item_name or "").strip()
    normalized_group = str(stock_group or "").strip().upper()
    starts_with_seven_digit_code = bool(re.match(r"^\d{7}(?!\d)", normalized_name))
    return starts_with_seven_digit_code or normalized_group == "KRAFT PAPER"


def extract_first_matching_tag(block: str, tag_names: list[str]) -> str:
    for tag_name in tag_names:
        escaped_tag = re.escape(tag_name)
        match = re.search(rf"<{escaped_tag}\b[^>]*>(.*?)</{escaped_tag}>", block, re.IGNORECASE | re.DOTALL)
        if match:
            return re.sub(r"\s+", " ", str(match.group(1) or "")).strip()
    return ""


def extract_stock_items_from_text(response_text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    blocks = re.findall(r"<STOCKITEM\b[^>]*>.*?</STOCKITEM>", response_text or "", re.IGNORECASE | re.DOTALL)
    for block in blocks:
        name_match = re.search(r'NAME="([^"]+)"', block, re.IGNORECASE)
        if not name_match:
            name_match = re.search(r"<NAME[^>]*>(.*?)</NAME>", block, re.IGNORECASE | re.DOTALL)
        name = str(name_match.group(1) if name_match else "").strip()

        group = extract_first_matching_tag(block, ["PARENT", "GROUP"])
        unit = extract_first_matching_tag(block, ["BASEUNITS"])
        part_no = extract_first_matching_tag(block, ["PARTNO", "PARTNUMBER"])
        if not name or not is_target_stock_item(name, group):
            continue
        rows.append(
            {
                "name": re.sub(r"\s+", " ", name).strip(),
                "group": group,
                "unit": unit,
                "partNo": part_no,
            }
        )
    return rows


def post_xml_to_tally(xml_text: str) -> str:
    global ACTIVE_TALLY_URL

    tally_url_candidates = build_tally_url_candidates(SELECTED_TALLY_PORT)
    urls_to_try = [ACTIVE_TALLY_URL] if ACTIVE_TALLY_URL else []
    urls_to_try.extend([url for url in tally_url_candidates if url not in urls_to_try])
    last_error: Exception | None = None

    for url in urls_to_try:
        try:
            response = requests.post(
                url,
                data=xml_text.encode("utf-8"),
                headers={"Content-Type": "application/xml"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            ACTIVE_TALLY_URL = url
            return response.text
        except requests_exceptions.Timeout as error:
            last_error = error
        except requests_exceptions.ConnectionError as error:
            last_error = error
        except requests_exceptions.RequestException as error:
            last_error = error

    urls_text = ", ".join(urls_to_try)
    raise RuntimeError(
        f"Cannot connect to Tally on {urls_text}. "
        f"Please ensure Tally XML/HTTP is enabled on port {SELECTED_TALLY_PORT}."
    ) from last_error


def build_company_static_variables(company_name: str | None) -> str:
    if not company_name:
        return ""
    return f"<SVCURRENTCOMPANY>{escape_xml(company_name)}</SVCURRENTCOMPANY>"


def parse_import_summary(response_text: str) -> dict[str, str]:
    summary: dict[str, str] = {}
    for tag in ["CREATED", "ALTERED", "COMBINED", "IGNORED", "DELETED", "CANCELLED", "ERRORS", "EXCEPTIONS"]:
        match = re.search(rf"<{tag}>(.*?)</{tag}>", response_text or "", re.IGNORECASE)
        if match:
            summary[tag.lower()] = match.group(1).strip()
    return summary


def response_error_message(response_text: str) -> str:
    response_text = (response_text or "").strip()
    if not response_text:
        return "Empty response from Tally"

    line_error = re.search(r"<LINEERROR>(.*?)</LINEERROR>", response_text, re.IGNORECASE | re.DOTALL)
    if line_error:
        return line_error.group(1).strip()

    summary = parse_import_summary(response_text)
    if summary:
        details = ", ".join(f"{key}={value}" for key, value in summary.items())
        return f"Tally import failed without LINEERROR ({details})"

    cleaned = re.sub(r"<[^>]+>", " ", response_text)
    cleaned = " ".join(cleaned.split())
    return cleaned[:250] if cleaned else "Failed to import"


def get_current_tally_company() -> str | None:
    xml_text = """
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>DATA</TYPE>
            <ID>List of Companies</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    patterns = [
        r"<SVCURRENTCOMPANY>(.*?)</SVCURRENTCOMPANY>",
        r"<CMPNAME>(.*?)</CMPNAME>",
        r"<NAME>(.*?)</NAME>",
    ]
    for pattern in patterns:
        company_names = re.findall(pattern, response_text, flags=re.IGNORECASE | re.DOTALL)
        company_names = [name.strip() for name in company_names if name.strip()]
        if company_names:
            return company_names[0]
    return None


def fetch_stock_items(company_name: str | None) -> list[dict[str, str]]:
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>StockItems</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="StockItems">
                            <TYPE>StockItem</TYPE>
                            <FETCH>Name</FETCH>
                            <FETCH>Parent</FETCH>
                            <FETCH>BaseUnits</FETCH>
                            <FETCH>PartNo</FETCH>
                            <FETCH>PartNumber</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError as error:
        LOGGER.warning("XML parse failed for stock items, falling back to regex extraction: %s", error)
        rows = extract_stock_items_from_text(response_text)
        if rows:
            rows.sort(key=lambda row: row["name"].upper())
            return rows
        raise RuntimeError(f"Could not parse stock item response from Tally: {error}") from error

    rows: list[dict[str, str]] = []
    for item in root.findall(".//STOCKITEM"):
        name = str(item.get("NAME") or item.findtext("NAME") or "").strip()
        group = str(item.findtext("PARENT") or "").strip()
        part_no = str(item.findtext("PARTNO") or item.findtext("PARTNUMBER") or "").strip()
        if not name or not is_target_stock_item(name, group):
            continue
        rows.append(
            {
                "name": name,
                "group": group,
                "unit": str(item.findtext("BASEUNITS") or "").strip(),
                "partNo": part_no,
            }
        )

    rows.sort(key=lambda row: row["name"].upper())
    return rows


def fetch_names_from_collection(company_name: str | None, collection_name: str, object_type: str) -> list[str]:
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <VERSION>1</VERSION>
            <TALLYREQUEST>EXPORT</TALLYREQUEST>
            <TYPE>COLLECTION</TYPE>
            <ID>{escape_xml(collection_name)}</ID>
        </HEADER>
        <BODY>
            <DESC>
                <STATICVARIABLES>
                    {build_company_static_variables(company_name)}
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
                <TDL>
                    <TDLMESSAGE>
                        <COLLECTION NAME="{escape_xml(collection_name)}">
                            <TYPE>{escape_xml(object_type)}</TYPE>
                            <FETCH>Name</FETCH>
                        </COLLECTION>
                    </TDLMESSAGE>
                </TDL>
            </DESC>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    cleaned = clean_tally_xml(response_text)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        cleaned_names = re.findall(r'NAME="([^"]+)"', response_text or "", re.IGNORECASE)
        if cleaned_names:
            return sorted(set(name.strip() for name in cleaned_names if name.strip()), key=lambda value: value.upper())
        return []

    tag_name = "STOCKGROUP" if object_type.lower() == "stockgroup" else "UNIT"
    names: list[str] = []
    for row in root.findall(f".//{tag_name}"):
        name = str(row.get("NAME") or row.findtext("NAME") or "").strip()
        if name:
            names.append(name)
    return sorted(set(names), key=lambda value: value.upper())


def update_stock_item(company_name: str | None, item_name: str, new_group: str, new_unit: str) -> tuple[bool, str]:
    safe_name = escape_xml(item_name)
    field_lines: list[str] = []
    if new_group.strip():
        field_lines.append(f"<PARENT>{escape_xml(new_group)}</PARENT>")
    if new_unit.strip():
        field_lines.append(f"<BASEUNITS>{escape_xml(new_unit)}</BASEUNITS>")
    if not field_lines:
        return False, "Nothing to update"
    fields_xml = "\n                            ".join(field_lines)
    xml_text = f"""
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>Import Data</TALLYREQUEST>
        </HEADER>
        <BODY>
            <IMPORTDATA>
                <REQUESTDESC>
                    <REPORTNAME>All Masters</REPORTNAME>
                    <STATICVARIABLES>
                        {build_company_static_variables(company_name)}
                    </STATICVARIABLES>
                </REQUESTDESC>
                <REQUESTDATA>
                    <TALLYMESSAGE xmlns:UDF="TallyUDF">
                        <STOCKITEM NAME="{safe_name}" ACTION="Alter">
                            <NAME.LIST>
                                <NAME>{safe_name}</NAME>
                            </NAME.LIST>
                            {fields_xml}
                        </STOCKITEM>
                    </TALLYMESSAGE>
                </REQUESTDATA>
            </IMPORTDATA>
        </BODY>
    </ENVELOPE>
    """
    response_text = post_xml_to_tally(xml_text)
    if "<ALTERED>1</ALTERED>" in response_text or "<CREATED>1</CREATED>" in response_text:
        return True, "Success"
    return False, response_error_message(response_text)


class StockItemBulkUpdaterApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("Tally Stock Item Bulk Updater")
        self.root.geometry("1200x700")

        self.company_name = get_current_tally_company()
        self.items: list[dict[str, str]] = []
        self.group_names: list[str] = []
        self.unit_names: list[str] = []
        self.selected_item_names: set[str] = set()
        self._syncing_selection = False

        self.port_var = StringVar(value=SELECTED_TALLY_PORT)
        self.company_text = StringVar(value=f"Company: {self.company_name or 'Selected company in Tally'}")
        self.name_filter = StringVar()
        self.group_filter = StringVar()
        self.unit_filter = StringVar()
        self.partno_filter = StringVar()
        self.target_group = StringVar()
        self.target_unit = StringVar()
        self.status_text = StringVar(value="Ready")

        self._build_ui()
        self.refresh_reference_data()
        self.refresh_items()

    def _build_ui(self) -> None:
        top_frame = ttk.Frame(self.root, padding=10)
        top_frame.pack(fill=X)

        ttk.Label(top_frame, textvariable=self.company_text).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 8))
        ttk.Label(top_frame, text="Port").grid(row=0, column=4, sticky="e", pady=(0, 8))
        self.port_combo = ttk.Combobox(
            top_frame,
            textvariable=self.port_var,
            width=10,
            values=("9004", "9000", "9001", "9002", "9003", "9005"),
        )
        self.port_combo.grid(row=0, column=5, sticky="w", padx=(6, 12), pady=(0, 8))
        ttk.Button(top_frame, text="Use Port", command=self.apply_port_change).grid(row=0, column=6, sticky="w", pady=(0, 8))

        ttk.Label(top_frame, text="Name").grid(row=1, column=0, sticky="w")
        name_entry = ttk.Entry(top_frame, textvariable=self.name_filter, width=34)
        name_entry.grid(row=1, column=1, sticky="w", padx=(6, 12))
        name_entry.bind("<KeyRelease>", lambda _event: self.apply_filter())

        ttk.Label(top_frame, text="Group").grid(row=1, column=2, sticky="w")
        group_entry = ttk.Entry(top_frame, textvariable=self.group_filter, width=22)
        group_entry.grid(row=1, column=3, sticky="w", padx=(6, 12))
        group_entry.bind("<KeyRelease>", lambda _event: self.apply_filter())

        ttk.Label(top_frame, text="Unit").grid(row=1, column=4, sticky="w")
        unit_entry = ttk.Entry(top_frame, textvariable=self.unit_filter, width=12)
        unit_entry.grid(row=1, column=5, sticky="w", padx=(6, 12))
        unit_entry.bind("<KeyRelease>", lambda _event: self.apply_filter())

        ttk.Label(top_frame, text="Part No.").grid(row=1, column=6, sticky="w")
        partno_entry = ttk.Entry(top_frame, textvariable=self.partno_filter, width=18)
        partno_entry.grid(row=1, column=7, sticky="w", padx=(6, 12))
        partno_entry.bind("<KeyRelease>", lambda _event: self.apply_filter())

        action_frame = ttk.Frame(top_frame)
        action_frame.grid(row=2, column=0, columnspan=8, sticky="w", pady=(10, 0))
        ttk.Button(action_frame, text="Clear Filters", command=self.clear_filters).pack(side=LEFT, padx=(0, 4))
        ttk.Button(action_frame, text="Refresh Items", command=self.refresh_items).pack(side=LEFT, padx=4)
        ttk.Button(action_frame, text="Refresh Groups/Units", command=self.refresh_reference_data).pack(side=LEFT, padx=4)
        ttk.Button(action_frame, text="Select All", command=self.select_all).pack(side=LEFT, padx=4)
        ttk.Button(action_frame, text="Unselect All", command=self.clear_selection).pack(side=LEFT, padx=4)

        middle_frame = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        middle_frame.pack(fill=BOTH, expand=True)

        columns = ("name", "group", "unit", "partNo")
        self.tree = ttk.Treeview(middle_frame, columns=columns, show="headings", selectmode="extended")
        self.tree.heading("name", text="Stock Item Name")
        self.tree.heading("group", text="Stock Group")
        self.tree.heading("unit", text="Unit")
        self.tree.heading("partNo", text="Part No.")
        self.tree.column("name", width=520)
        self.tree.column("group", width=220)
        self.tree.column("unit", width=120)
        self.tree.column("partNo", width=140)
        self.tree.pack(side=LEFT, fill=BOTH, expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.on_tree_selection_changed)

        scrollbar = ttk.Scrollbar(middle_frame, orient=VERTICAL, command=self.tree.yview)
        scrollbar.pack(side=RIGHT, fill=Y)
        self.tree.configure(yscrollcommand=scrollbar.set)

        bottom_frame = ttk.Frame(self.root, padding=10)
        bottom_frame.pack(fill=X)

        ttk.Label(bottom_frame, text="New Group").pack(side=LEFT)
        self.group_combo = ttk.Combobox(bottom_frame, textvariable=self.target_group, width=28)
        self.group_combo.pack(side=LEFT, padx=(6, 14))

        ttk.Label(bottom_frame, text="New Unit").pack(side=LEFT)
        self.unit_combo = ttk.Combobox(bottom_frame, textvariable=self.target_unit, width=12)
        self.unit_combo.pack(side=LEFT, padx=(6, 14))

        ttk.Button(bottom_frame, text="Update Selected Items", command=self.update_selected_items).pack(side=LEFT, padx=4)

        status_frame = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        status_frame.pack(fill=X)
        ttk.Label(status_frame, textvariable=self.status_text).pack(side=LEFT)

    def set_status(self, text: str) -> None:
        self.status_text.set(text)
        self.root.update_idletasks()

    def update_company_label(self) -> None:
        self.company_text.set(f"Company: {self.company_name or 'Selected company in Tally'}")

    def apply_port_change(self) -> None:
        global SELECTED_TALLY_PORT, ACTIVE_TALLY_URL

        requested_port = self.port_var.get().strip()
        if not requested_port.isdigit():
            messagebox.showwarning("Invalid Port", "Enter a valid numeric Tally port.")
            return

        SELECTED_TALLY_PORT = requested_port
        ACTIVE_TALLY_URL = None

        try:
            self.set_status(f"Connecting to Tally on port {SELECTED_TALLY_PORT}...")
            self.company_name = get_current_tally_company()
            self.update_company_label()
            self.refresh_reference_data()
            self.refresh_items()
            self.set_status(f"Connected using port {SELECTED_TALLY_PORT}.")
        except Exception as error:
            LOGGER.exception("Failed to switch Tally port to %s: %s", SELECTED_TALLY_PORT, error)
            messagebox.showerror("Port Change Failed", str(error))
            self.set_status(f"Failed to connect on port {SELECTED_TALLY_PORT}.")

    def refresh_reference_data(self) -> None:
        try:
            self.set_status("Loading groups and units from Tally...")
            self.group_names = fetch_names_from_collection(self.company_name, "StockGroups", "StockGroup")
            self.unit_names = fetch_names_from_collection(self.company_name, "Units", "Unit")
            self.group_combo["values"] = self.group_names
            self.unit_combo["values"] = self.unit_names
            self.set_status(f"Loaded {len(self.group_names)} groups and {len(self.unit_names)} units.")
        except Exception as error:
            LOGGER.exception("Failed to refresh reference data: %s", error)
            messagebox.showerror("Reference Load Failed", str(error))
            self.set_status("Failed to load groups/units.")

    def refresh_items(self) -> None:
        try:
            self.set_status("Loading stock items from Tally...")
            self.items = fetch_stock_items(self.company_name)
            self.apply_filter()
            self.set_status(
                f"Loaded {len(self.items)} stock items matching: 7-digit start or group KRAFT PAPER."
            )
        except Exception as error:
            LOGGER.exception("Failed to refresh stock items: %s", error)
            messagebox.showerror("Stock Item Load Failed", str(error))
            self.set_status("Failed to load stock items.")

    def apply_filter(self) -> None:
        for item_id in self.tree.get_children():
            self.tree.delete(item_id)

        name_filter = self.name_filter.get().strip().upper()
        group_filter = self.group_filter.get().strip().upper()
        unit_filter = self.unit_filter.get().strip().upper()
        partno_filter = self.partno_filter.get().strip().upper()
        filtered = [
            row
            for row in self.items
            if (not name_filter or name_filter in row["name"].upper())
            and (not group_filter or group_filter in row["group"].upper())
            and (not unit_filter or unit_filter in row["unit"].upper())
            and (not partno_filter or partno_filter in row["partNo"].upper())
        ]

        for row in filtered:
            self.tree.insert("", END, values=(row["name"], row["group"], row["unit"], row["partNo"]))

        visible_selected_ids = [
            item_id
            for item_id in self.tree.get_children()
            if str(self.tree.item(item_id, "values")[0]) in self.selected_item_names
        ]
        self._syncing_selection = True
        try:
            self.tree.selection_set(visible_selected_ids)
        finally:
            self._syncing_selection = False

        self.set_status(
            f"Showing {len(filtered)} of {len(self.items)} stock items. Selected: {len(self.selected_item_names)}."
        )

    def clear_filters(self) -> None:
        self.name_filter.set("")
        self.group_filter.set("")
        self.unit_filter.set("")
        self.partno_filter.set("")
        self.apply_filter()

    def select_all(self) -> None:
        for item_id in self.tree.get_children():
            item_name = str(self.tree.item(item_id, "values")[0])
            if item_name:
                self.selected_item_names.add(item_name)
        self.apply_filter()

    def clear_selection(self) -> None:
        self.selected_item_names.clear()
        self._syncing_selection = True
        try:
            self.tree.selection_remove(self.tree.selection())
        finally:
            self._syncing_selection = False
        self.set_status(f"Showing {len(self.tree.get_children())} visible stock items. Selected: 0.")

    def on_tree_selection_changed(self, _event: object | None = None) -> None:
        if self._syncing_selection:
            return
        visible_names = {
            str(self.tree.item(item_id, "values")[0])
            for item_id in self.tree.get_children()
            if self.tree.item(item_id, "values")
        }
        selected_visible_names = {
            str(self.tree.item(item_id, "values")[0])
            for item_id in self.tree.selection()
            if self.tree.item(item_id, "values")
        }
        self.selected_item_names.difference_update(visible_names)
        self.selected_item_names.update(selected_visible_names)
        self.set_status(
            f"Showing {len(self.tree.get_children())} visible stock items. Selected: {len(self.selected_item_names)}."
        )

    def update_selected_items(self) -> None:
        if not self.selected_item_names:
            messagebox.showwarning("No Selection", "Select at least one stock item.")
            return

        new_group = self.target_group.get().strip()
        new_unit = self.target_unit.get().strip()
        if not new_group and not new_unit:
            messagebox.showwarning("Nothing To Update", "Enter or select a target stock group, unit, or both.")
            return

        item_names = sorted(self.selected_item_names, key=lambda value: value.upper())
        update_parts: list[str] = []
        if new_group:
            update_parts.append(f"group '{new_group}'")
        if new_unit:
            update_parts.append(f"unit '{new_unit}'")
        update_text = " and ".join(update_parts)
        confirm = messagebox.askyesno(
            "Confirm Bulk Update",
            f"Update {len(item_names)} selected stock item(s) with {update_text}?",
        )
        if not confirm:
            return

        updated = 0
        failures: list[str] = []
        for index, item_name in enumerate(item_names, start=1):
            self.set_status(f"Updating {index}/{len(item_names)}: {item_name}")
            success, result = update_stock_item(self.company_name, item_name, new_group, new_unit)
            if success:
                updated += 1
                LOGGER.info("Updated stock item '%s' -> group='%s', unit='%s'", item_name, new_group, new_unit)
            else:
                failures.append(f"{item_name}: {result}")
                LOGGER.error("Failed to update stock item '%s': %s", item_name, result)

        self.refresh_items()
        if failures:
            preview = "\n".join(failures[:10])
            messagebox.showwarning(
                "Bulk Update Completed With Errors",
                f"Updated {updated} item(s). Failed {len(failures)} item(s).\n\n{preview}",
            )
            self.set_status(f"Updated {updated} item(s), failed {len(failures)}.")
            return

        messagebox.showinfo("Bulk Update Completed", f"Updated {updated} stock item(s) successfully.")
        self.set_status(f"Updated {updated} stock item(s) successfully.")


def main() -> None:
    LOGGER.info("Starting Tally Stock Item Bulk Updater")
    root = Tk()
    try:
        StockItemBulkUpdaterApp(root)
        root.mainloop()
    finally:
        LOGGER.info("Closing Tally Stock Item Bulk Updater")


if __name__ == "__main__":
    main()
