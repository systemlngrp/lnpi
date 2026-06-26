import html
import json
import re
import sys
import threading
import webbrowser
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen


APP_HOST = "127.0.0.1"
APP_PORT = 9071
DEFAULT_TALLY_PORT = "9000"
REQUEST_TIMEOUT_SECONDS = 25
BROWSER_URL = f"http://{APP_HOST}:{APP_PORT}"


HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tally Duplicate Part No Finder</title>
  <style>
    :root {
      --ink: #172033;
      --muted: #5d677a;
      --paper: #f7f3e8;
      --panel: #fffdf8;
      --line: #1f2937;
      --accent: #cf5f2c;
      --accent-soft: #ffe0cf;
      --ok: #0f766e;
      --warn: #b45309;
      --shadow: 8px 8px 0 rgba(23, 32, 51, 0.18);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, #fff5db 0, #fff5db 14%, transparent 15%),
        linear-gradient(135deg, #f4efe2 0%, #e9eef7 100%);
      min-height: 100vh;
    }

    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 24px auto;
      background: var(--panel);
      border: 3px solid var(--line);
      box-shadow: var(--shadow);
      border-radius: 18px;
      overflow: hidden;
    }

    .hero {
      padding: 24px;
      border-bottom: 3px solid var(--line);
      background:
        linear-gradient(135deg, rgba(207, 95, 44, 0.16), rgba(23, 32, 51, 0.04)),
        var(--paper);
    }

    .hero h1 {
      margin: 0 0 8px;
      font-size: clamp(1.4rem, 2.5vw, 2rem);
      line-height: 1.1;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .hero p {
      margin: 0;
      color: var(--muted);
      max-width: 760px;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: end;
      padding: 20px 24px;
      border-bottom: 1px solid #d6d6d6;
      background: white;
    }

    .field {
      min-width: 180px;
      flex: 0 1 220px;
    }

    .field label {
      display: block;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 6px;
      color: var(--muted);
    }

    .field input {
      width: 100%;
      padding: 12px 14px;
      border: 2px solid var(--line);
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      background: #fffdfa;
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    button {
      appearance: none;
      border: 2px solid var(--line);
      border-radius: 10px;
      padding: 12px 18px;
      font-size: 14px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      background: white;
      color: var(--ink);
      box-shadow: 4px 4px 0 rgba(23, 32, 51, 0.16);
    }

    button.primary {
      background: var(--accent);
      color: white;
    }

    button:disabled {
      opacity: 0.6;
      cursor: wait;
      box-shadow: none;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 16px 24px 0;
    }

    .pill {
      border: 2px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 800;
      background: #fff;
    }

    .status {
      margin: 16px 24px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 2px solid var(--line);
      background: #fff;
      font-weight: 700;
    }

    .status.info { color: var(--ink); }
    .status.ok { color: var(--ok); background: #ecfdf5; }
    .status.warn { color: var(--warn); background: #fff7ed; }
    .status.error { color: #b91c1c; background: #fef2f2; }

    .table-wrap {
      padding: 0 24px 24px;
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 820px;
      background: white;
      border: 2px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
    }

    thead th {
      background: #1f2937;
      color: white;
      text-align: left;
      padding: 12px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-right: 1px solid rgba(255, 255, 255, 0.12);
    }

    tbody td {
      padding: 12px;
      border-top: 1px solid #d7dce5;
      vertical-align: top;
      font-size: 14px;
    }

    tbody tr:nth-child(even) {
      background: #fafaf8;
    }

    .part-cell {
      font-weight: 800;
      color: var(--accent);
      white-space: nowrap;
    }

    .stock-list {
      margin: 0;
      padding-left: 18px;
    }

    .stock-list li + li {
      margin-top: 6px;
    }

    .empty {
      padding: 32px 24px 40px;
      text-align: center;
      color: var(--muted);
      font-weight: 700;
    }

    @media (max-width: 720px) {
      .shell { width: min(100vw - 18px, 1180px); margin: 10px auto; }
      .hero, .controls { padding-left: 16px; padding-right: 16px; }
      .meta, .status, .table-wrap { margin-left: 16px; margin-right: 16px; padding-left: 0; padding-right: 0; }
      .table-wrap { margin-bottom: 20px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <h1>Tally Duplicate Part No Finder</h1>
      <p>Fetch stock items directly from Tally on the selected port and show only those Part No values that are attached to more than one stock item.</p>
    </div>

    <div class="controls">
      <div class="field">
        <label for="portInput">Tally Port</label>
        <input id="portInput" type="text" value="9000" inputmode="numeric" />
      </div>
      <div class="actions">
        <button id="fetchBtn" class="primary" type="button">Fetch Items</button>
        <button id="clearBtn" type="button">Clear</button>
      </div>
    </div>

    <div class="meta" id="meta"></div>
    <div class="status info" id="status">Choose a Tally port and click Fetch Items.</div>

    <div class="table-wrap">
      <table id="resultsTable" hidden>
        <thead>
          <tr>
            <th style="width: 22%;">Part No.</th>
            <th style="width: 43%;">Stock Item</th>
            <th style="width: 35%;">Stock Group</th>
          </tr>
        </thead>
        <tbody id="resultsBody"></tbody>
      </table>
      <div class="empty" id="emptyState">No data loaded yet.</div>
    </div>
  </div>

  <script>
    const portInput = document.getElementById("portInput");
    const fetchBtn = document.getElementById("fetchBtn");
    const clearBtn = document.getElementById("clearBtn");
    const statusBox = document.getElementById("status");
    const meta = document.getElementById("meta");
    const resultsTable = document.getElementById("resultsTable");
    const resultsBody = document.getElementById("resultsBody");
    const emptyState = document.getElementById("emptyState");

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function setStatus(kind, text) {
      statusBox.className = "status " + kind;
      statusBox.textContent = text;
    }

    function setLoading(active) {
      fetchBtn.disabled = active;
      fetchBtn.textContent = active ? "Fetching..." : "Fetch Items";
    }

    function clearResults() {
      meta.innerHTML = "";
      resultsBody.innerHTML = "";
      resultsTable.hidden = true;
      emptyState.hidden = false;
      emptyState.textContent = "No data loaded yet.";
      setStatus("info", "Choose a Tally port and click Fetch Items.");
    }

    function renderMeta(summary) {
      meta.innerHTML = [
        `<div class="pill">Port: ${escapeHtml(summary.port)}</div>`,
        `<div class="pill">Total Stock Items: ${escapeHtml(summary.total_stock_items)}</div>`,
        `<div class="pill">Duplicate Part Nos: ${escapeHtml(summary.duplicate_part_numbers)}</div>`,
        `<div class="pill">Rows Shown: ${escapeHtml(summary.rows_shown)}</div>`
      ].join("");
    }

    function renderRows(rows) {
      resultsBody.innerHTML = rows.map((row) => {
        const stockItems = row.stock_items.map((entry) => `<li>${escapeHtml(entry.stock_item)}</li>`).join("");
        const stockGroups = row.stock_items.map((entry) => `<li>${escapeHtml(entry.stock_group || "-")}</li>`).join("");
        return `
          <tr>
            <td class="part-cell">${escapeHtml(row.part_no)}</td>
            <td><ul class="stock-list">${stockItems}</ul></td>
            <td><ul class="stock-list">${stockGroups}</ul></td>
          </tr>
        `;
      }).join("");
      resultsTable.hidden = false;
      emptyState.hidden = true;
    }

    async function fetchRows() {
      const port = portInput.value.trim() || "9000";
      setLoading(true);
      setStatus("info", `Fetching stock items from Tally on port ${port}...`);

      try {
        const response = await fetch(`/api/duplicate-part-nos?port=${encodeURIComponent(port)}`);
        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Failed to fetch data from Tally.");
        }

        renderMeta(data.summary);

        if (!data.rows.length) {
          resultsBody.innerHTML = "";
          resultsTable.hidden = true;
          emptyState.hidden = false;
          emptyState.textContent = "No duplicate Part No values were found for this Tally port.";
          setStatus("warn", "Fetch completed, but no duplicate Part No values were found.");
          return;
        }

        renderRows(data.rows);
        setStatus("ok", `Fetched ${data.summary.total_stock_items} stock items and found ${data.summary.duplicate_part_numbers} duplicate Part No values.`);
      } catch (error) {
        resultsBody.innerHTML = "";
        resultsTable.hidden = true;
        emptyState.hidden = false;
        emptyState.textContent = "Could not load data.";
        setStatus("error", error.message || "Unexpected error while fetching data.");
      } finally {
        setLoading(false);
      }
    }

    fetchBtn.addEventListener("click", fetchRows);
    clearBtn.addEventListener("click", clearResults);
    portInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        fetchRows();
      }
    });
  </script>
</body>
</html>
"""


def sanitize_tally_xml(xml_text: str) -> str:
    cleaned = re.sub(r"&#x0*([0-8BCEF]|1[0-9A-F]);", "", xml_text or "", flags=re.IGNORECASE)
    return re.sub(r"&#([0-8]|1[0-9]|2[0-9]|30|31);", "", cleaned, flags=re.IGNORECASE)


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def build_stock_item_request() -> str:
    return """<ENVELOPE>
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
        <FETCHLIST>
          <FETCH>Name</FETCH>
          <FETCH>PartNo</FETCH>
          <FETCH>Parent</FETCH>
        </FETCHLIST>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>"""


def tally_post(port: str, xml_payload: str) -> str:
    url = f"http://127.0.0.1:{port.strip()}"
    request = Request(
        url,
        data=xml_payload.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8"},
        method="POST",
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_first_tag(block: str, tag_names: list[str]) -> str:
    for tag_name in tag_names:
        escaped_tag = re.escape(tag_name)
        pattern = rf"<{escaped_tag}\b[^>]*>(.*?)</{escaped_tag}>"
        match = re.search(pattern, block, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return collapse_whitespace(html.unescape(match.group(1)))
    return ""


def parse_stock_items(xml_text: str) -> list[dict[str, str]]:
    cleaned_xml = sanitize_tally_xml(xml_text)
    blocks = re.findall(r"<STOCKITEM\b.*?</STOCKITEM>", cleaned_xml, flags=re.IGNORECASE | re.DOTALL)
    rows: list[dict[str, str]] = []

    for block in blocks:
        stock_item = extract_first_tag(block, ["NAME", "LANGUAGENAME.LIST"])
        part_no = extract_first_tag(block, ["PARTNO", "PARTNUMBER"])
        stock_group = extract_first_tag(block, ["PARENT", "GROUP"])

        if not stock_item or not part_no:
            continue

        rows.append(
            {
                "stock_item": stock_item,
                "part_no": part_no,
                "stock_group": stock_group or "-",
            }
        )

    return rows


def build_duplicate_part_no_rows(stock_items: list[dict[str, str]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)

    for item in stock_items:
        grouped[item["part_no"]].append(item)

    duplicate_rows: list[dict[str, object]] = []
    for part_no, items in grouped.items():
        distinct_names = {collapse_whitespace(entry["stock_item"]).upper() for entry in items if entry["stock_item"]}
        if len(distinct_names) <= 1:
            continue

        sorted_items = sorted(
            items,
            key=lambda entry: (
                collapse_whitespace(entry["stock_item"]).upper(),
                collapse_whitespace(entry["stock_group"]).upper(),
            ),
        )

        duplicate_rows.append(
            {
                "part_no": part_no,
                "stock_items": sorted_items,
            }
        )

    duplicate_rows.sort(key=lambda row: collapse_whitespace(str(row["part_no"])).upper())
    return duplicate_rows


def fetch_duplicate_part_numbers(port: str) -> dict[str, object]:
    if not port.strip().isdigit():
        raise ValueError("Port must be numeric.")

    response_text = tally_post(port, build_stock_item_request())
    stock_items = parse_stock_items(response_text)
    duplicate_rows = build_duplicate_part_no_rows(stock_items)

    return {
        "rows": duplicate_rows,
        "summary": {
            "port": port.strip(),
            "total_stock_items": len(stock_items),
            "duplicate_part_numbers": len(duplicate_rows),
            "rows_shown": sum(len(row["stock_items"]) for row in duplicate_rows),
        },
    }


class TallyDuplicatePartNoHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/":
            body = HTML_PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/duplicate-part-nos":
            self.handle_api(parsed.query)
            return

        self.send_json(404, {"ok": False, "error": "Not found."})

    def handle_api(self, query: str) -> None:
        params = parse_qs(query)
        port = params.get("port", [DEFAULT_TALLY_PORT])[0]

        try:
            payload = fetch_duplicate_part_numbers(port)
            self.send_json(200, {"ok": True, **payload})
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
        except HTTPError as error:
            self.send_json(502, {"ok": False, "error": f"Tally returned HTTP {error.code} on port {port}."})
        except URLError as error:
            reason = getattr(error, "reason", error)
            self.send_json(502, {"ok": False, "error": f"Could not connect to Tally on port {port}: {reason}"})
        except Exception as error:
            self.send_json(500, {"ok": False, "error": f"Unexpected error: {error}"})

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


def main() -> int:
    server = ThreadingHTTPServer((APP_HOST, APP_PORT), TallyDuplicatePartNoHandler)
    print(f"Tally duplicate Part No app running at {BROWSER_URL}")
    print("Opening browser...")
    print("Press Ctrl+C to stop.")

    threading.Timer(1.0, lambda: webbrowser.open(BROWSER_URL)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
