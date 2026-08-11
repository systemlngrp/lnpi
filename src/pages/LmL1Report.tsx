import { useMemo, useState } from "react";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Download, FileText, RotateCcw, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { Order } from "../types";
import { formatDate } from "../lib/serial";

type LmL1Row = {
  id: string;
  itemName: string;
  orderQty: number;
  rapc: number;
  ups: number;
  cuttingWithTrimming: number;
  flute: string;
  takeUpFactor: number;
  gsm: number;
  year: number;
  month: string;
  orderDate: string;
  l1: number;
  sheetWeightL1: number;
  orderWeightL1: number;
  f1: number;
  sheetWeightF1: number;
  orderWeightF1: number;
  l2: number;
  sheetWeightL2: number;
  orderWeightL2: number;
  f2: number;
  sheetWeightF2: number;
  orderWeightF2: number;
  l3: number;
  sheetWeightL3: number;
  orderWeightL3: number;
  sum: number;
  rapcGroup: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const REPORT_COLUMNS = [
  "Item Name",
  "Order Qty",
  "RAPC",
  "Ups",
  "CUTTING with TRIMMING",
  "FLUTE",
  "Take up Factor",
  "GSM",
  "Year",
  "Month",
  "L1",
  "Sheet Weight of L1",
  "Order Quantity * Sheet Weight (L1)",
  "F1",
  "Sheet Weight of F1",
  "Order Quantity * Sheet Weight (F1)",
  "L2",
  "Sheet Weight of L2",
  "Order Quantity * Sheet Weight (L2)",
  "F2",
  "Sheet Weight of F2",
  "Order Quantity * Sheet Weight (F2)",
  "L3",
  "Sheet Weight of L3",
  "Order Quantity * Sheet Weight (L3)",
  "Sum",
  "RAPC Group",
] as const;

function parseAppDate(value?: string | null) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const onlyDate = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) {
    const [year, month, day] = onlyDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = toNumber(value);
    if (numeric > 0) return numeric;
  }
  return 0;
}

function round(value: number, decimals: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimals));
}

function sheetWeight(rapc: number, cutting: number, gsm: number, ups: number, takeUpFactor = 1) {
  if (rapc <= 0 || cutting <= 0 || gsm <= 0 || ups <= 0 || takeUpFactor <= 0) return 0;
  return (rapc * cutting * gsm * takeUpFactor) / (1000000000 * ups);
}

function formatNumber(value: number, decimals = 2) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function getRowExport(row: LmL1Row) {
  return {
    "Item Name": row.itemName,
    "Order Qty": row.orderQty,
    RAPC: row.rapc,
    Ups: row.ups,
    "CUTTING with TRIMMING": row.cuttingWithTrimming,
    FLUTE: row.flute,
    "Take up Factor": row.takeUpFactor,
    GSM: row.gsm,
    Year: row.year,
    Month: row.month,
    L1: row.l1,
    "Sheet Weight of L1": row.sheetWeightL1,
    "Order Quantity * Sheet Weight (L1)": row.orderWeightL1,
    F1: row.f1,
    "Sheet Weight of F1": row.sheetWeightF1,
    "Order Quantity * Sheet Weight (F1)": row.orderWeightF1,
    L2: row.l2,
    "Sheet Weight of L2": row.sheetWeightL2,
    "Order Quantity * Sheet Weight (L2)": row.orderWeightL2,
    F2: row.f2,
    "Sheet Weight of F2": row.sheetWeightF2,
    "Order Quantity * Sheet Weight (F2)": row.orderWeightF2,
    L3: row.l3,
    "Sheet Weight of L3": row.sheetWeightL3,
    "Order Quantity * Sheet Weight (L3)": row.orderWeightL3,
    Sum: row.sum,
    "RAPC Group": row.rapcGroup,
  };
}

export function LmL1Report() {
  const [orders] = useData<Order>("orders", []);
  const { resolveOrderItem } = useOrderItemCatalog();

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [yearFilter, setYearFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");

  const rows = useMemo<LmL1Row[]>(() => {
    return orders
      .filter((order) => order.status !== "Cancelled")
      .map((order) => {
        const item = resolveOrderItem(order);
        const raw = item?.raw || {};
        const orderDate = parseAppDate(order.orderDate);
        const orderQty = toNumber(order.qty);
        const rapc = firstPositiveNumber(raw.rapc, raw.rapcForSingleBox);
        const ups = firstPositiveNumber(raw.ups, raw.dieCutUps);
        const cuttingWithTrimming = firstPositiveNumber(raw.cuttingWithTrimming, raw.cuttingSize, raw.cuttingSizeLengthPiece);
        const takeUpFactor = firstPositiveNumber(raw.takeUpFactor, raw.takeUp);
        const l1 = toNumber(raw.l1);
        const f1 = toNumber(raw.f1);
        const l2 = toNumber(raw.l2);
        const f2 = toNumber(raw.f2);
        const l3 = toNumber(raw.l3);
        const gsm = firstPositiveNumber(raw.size);

        if (!item || !orderDate || orderQty <= 0 || rapc <= 0 || ups <= 0 || cuttingWithTrimming <= 0) return null;
        if (![l1, f1, l2, f2, l3].some((value) => value > 0)) return null;

        const sheetWeightL1 = round(sheetWeight(rapc, cuttingWithTrimming, l1, ups), 3);
        const sheetWeightF1 = round(sheetWeight(rapc, cuttingWithTrimming, f1, ups, takeUpFactor), 3);
        const sheetWeightL2 = round(sheetWeight(rapc, cuttingWithTrimming, l2, ups), 4);
        const sheetWeightF2 = round(sheetWeight(rapc, cuttingWithTrimming, f2, ups, takeUpFactor), 3);
        const sheetWeightL3 = round(sheetWeight(rapc, cuttingWithTrimming, l3, ups), 3);
        const orderWeightL1 = round(orderQty * sheetWeightL1, 2);
        const orderWeightF1 = round(orderQty * sheetWeightF1, 2);
        const orderWeightL2 = round(orderQty * sheetWeightL2, 2);
        const orderWeightF2 = round(orderQty * sheetWeightF2, 2);
        const orderWeightL3 = round(orderQty * sheetWeightL3, 2);

        return {
          id: order.id,
          itemName: item.name,
          orderQty,
          rapc,
          ups,
          cuttingWithTrimming,
          flute: String(raw.flute || "").trim(),
          takeUpFactor,
          gsm,
          year: orderDate.getFullYear(),
          month: MONTHS[orderDate.getMonth()],
          orderDate: order.orderDate,
          l1,
          sheetWeightL1,
          orderWeightL1,
          f1,
          sheetWeightF1,
          orderWeightF1,
          l2,
          sheetWeightL2,
          orderWeightL2,
          f2,
          sheetWeightF2,
          orderWeightF2,
          l3,
          sheetWeightL3,
          orderWeightL3,
          sum: round(orderWeightL1 + orderWeightF1 + orderWeightL2 + orderWeightF2 + orderWeightL3, 2),
          rapcGroup: Math.ceil(rapc / 25) * 25,
        };
      })
      .filter((row): row is LmL1Row => Boolean(row))
      .sort((a, b) => b.year - a.year || MONTHS.indexOf(b.month) - MONTHS.indexOf(a.month) || a.itemName.localeCompare(b.itemName));
  }, [orders, resolveOrderItem]);

  const yearOptions = useMemo(() => ["All", ...Array.from(new Set(rows.map((row) => String(row.year)))).sort((a, b) => Number(b) - Number(a))], [rows]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const from = parseAppDate(dateFrom);
    const to = parseAppDate(dateTo);
    const fromTime = from ? normalizeDate(from).getTime() : null;
    const toTime = to ? normalizeDate(to).getTime() : null;

    return rows.filter((row) => {
      const orderDate = parseAppDate(row.orderDate);
      const orderTime = orderDate ? normalizeDate(orderDate).getTime() : null;
      if (fromTime != null && (orderTime == null || orderTime < fromTime)) return false;
      if (toTime != null && (orderTime == null || orderTime > toTime)) return false;
      if (yearFilter !== "All" && String(row.year) !== yearFilter) return false;
      if (monthFilter !== "All" && row.month !== monthFilter) return false;
      if (!q) return true;
      return [row.itemName, row.flute, row.rapc, row.rapcGroup, row.year, row.month].some((value) =>
        String(value || "").toLowerCase().includes(q)
      );
    });
  }, [dateFrom, dateTo, monthFilter, rows, searchTerm, yearFilter]);

  const summary = useMemo(
    () => ({
      totalOrderQty: filteredRows.reduce((sum, row) => sum + row.orderQty, 0),
      totalPaperWeight: round(filteredRows.reduce((sum, row) => sum + row.sum, 0), 2),
      rowCount: filteredRows.length,
      uniqueRapcGroups: new Set(filteredRows.map((row) => row.rapcGroup)).size,
    }),
    [filteredRows]
  );

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setYearFilter("All");
    setMonthFilter("All");
  };

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        "Date From": dateFrom || "All",
        "Date To": dateTo || "All",
        Year: yearFilter,
        Month: monthFilter,
        "Row Count": summary.rowCount,
        "Total Order Qty": summary.totalOrderQty,
        "Total Paper Weight Sum": summary.totalPaperWeight,
        "Unique RAPC Groups": summary.uniqueRapcGroups,
      },
    ]);
    const detailSheet = XLSX.utils.json_to_sheet(filteredRows.map(getRowExport));
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "LM-L1");
    XLSX.writeFile(workbook, `LM_L1_Report_${dateFrom || "all"}_${dateTo || "all"}.xlsx`);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text("LM-L1 Report", 14, 16);
    doc.setFontSize(9);
    doc.text(`Date: ${dateFrom ? formatDate(dateFrom) : "All"} to ${dateTo ? formatDate(dateTo) : "All"} | Year: ${yearFilter} | Month: ${monthFilter}`, 14, 23);

    autoTable(doc, {
      head: [["Metric", "Value"]],
      body: [
        ["Total Order Qty", summary.totalOrderQty],
        ["Total Paper Weight Sum", summary.totalPaperWeight],
        ["Rows", summary.rowCount],
        ["Unique RAPC Groups", summary.uniqueRapcGroups],
      ],
      startY: 28,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55] },
    });

    autoTable(doc, {
      head: [REPORT_COLUMNS as unknown as string[]],
      body: filteredRows.map((row) => Object.values(getRowExport(row))),
      startY: (doc as any).lastAutoTable.finalY + 6,
      theme: "grid",
      styles: { fontSize: 5, cellPadding: 1 },
      headStyles: { fillColor: [31, 41, 55] },
    } as any);

    doc.save(`LM_L1_Report_${dateFrom || "all"}_${dateTo || "all"}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">LM-L1 Report</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Order Qty</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{summary.totalOrderQty.toLocaleString()}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Total Paper Weight Sum</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{formatNumber(summary.totalPaperWeight)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Rows</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{summary.rowCount.toLocaleString()}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Unique RAPC Groups</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{summary.uniqueRapcGroups.toLocaleString()}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_repeat(4,minmax(140px,0.7fr))_repeat(3,auto)] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search item, flute, RAPC..."
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            title="Date From"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            title="Date To"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <select
            value={yearFilter}
            onChange={(event) => setYearFilter(event.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option === "All" ? "All Years" : option}</option>
            ))}
          </select>
          <select
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            {["All", ...MONTHS].map((option) => (
              <option key={option} value={option}>{option === "All" ? "All Months" : option}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
          >
            <RotateCcw size={14} />
            Clear
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Download size={14} />
            Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-rose-700 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100"
          >
            <FileText size={14} />
            PDF
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                {REPORT_COLUMNS.map((heading) => (
                  <th key={heading} className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={REPORT_COLUMNS.length} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No LM-L1 rows found for the selected filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="text-black hover:bg-slate-50">
                    {Object.values(getRowExport(row)).map((value, index) => (
                      <td key={`${row.id}-${REPORT_COLUMNS[index]}`} className={`border-2 border-black px-3 py-3 ${typeof value === "number" ? "text-right" : "whitespace-normal break-words"}`}>
                        {typeof value === "number" ? (index === 11 || index === 14 || index === 17 || index === 20 || index === 23 ? formatNumber(value, index === 17 ? 4 : 3) : formatNumber(value, 2).replace(/\.00$/, "")) : value}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {filteredRows.length > 0 ? (
              <tfoot className="sticky bottom-0 z-10 bg-slate-100">
                <tr>
                  <td className="border-2 border-black px-3 py-3 text-sm font-black text-black" colSpan={1}>Grand Total</td>
                  <td className="border-2 border-black px-3 py-3 text-right text-sm font-black text-black">{summary.totalOrderQty.toLocaleString()}</td>
                  <td className="border-2 border-black px-3 py-3" colSpan={23}></td>
                  <td className="border-2 border-black px-3 py-3 text-right text-sm font-black text-black">{formatNumber(summary.totalPaperWeight)}</td>
                  <td className="border-2 border-black px-3 py-3"></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
