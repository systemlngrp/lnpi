import React, { useMemo, useState, useEffect } from "react";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Download, FileText, RotateCcw, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { Company, Item, Order, OrderSchedule, Production, Setting } from "../types";
import { formatDate, getFinancialYear } from "../lib/serial";
import { parseRealizationTargets } from "../lib/realizationTargets";
import { useNpdItems } from "../hooks/useNpdItems";

type TargetRow = {
  fy: string;
  month: string;
  value: number;
};

type RealizationSourceRow = {
  productionId: string;
  date: string;
  qty: number;
  realizationPerKg: number;
  weightedValue: number;
  companyId: string;
  companyName: string;
  salesPersonId: string;
  salesPersonName: string;
  jobNo: string;
};

type RealizationSummaryRow = {
  id: string;
  name: string;
  qty: number;
  weightedValue: number;
  average: number;
  rowCount: number;
};

const MONTH_OPTIONS = ["All", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthLabelFromDate(date: Date) {
  return MONTH_OPTIONS[date.getMonth() + 1] || "All";
}

function getTargetBadgeClass(value: number, benchmark: number) {
  if (value <= 0) return "border-slate-200 bg-slate-50 text-slate-700";
  if (value >= benchmark) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function weightedAverage(weightedValue: number, qty: number) {
  if (!Number.isFinite(weightedValue) || !Number.isFinite(qty) || qty <= 0) return 0;
  return Number((weightedValue / qty).toFixed(2));
}

function positiveNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = Number(value || 0);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function gramsToKg(value: number) {
  return value > 0 ? value / 1000 : 0;
}

function resolveTotalWeightOfSet(production: Production, item?: Item) {
  const savedTotalWeight = positiveNumber(production.totalWeightOfSet);
  if (savedTotalWeight > 0) return savedTotalWeight;

  const productionSheetWeight = positiveNumber(production.sheetWeight, production.weightPerPcSetReq);
  const productionPlateWeight = positiveNumber(production.plateWeight);
  if (productionSheetWeight + productionPlateWeight > 0) {
    return productionSheetWeight + productionPlateWeight;
  }

  const itemSheetWeightGms = positiveNumber(
    (item as any)?.calculatedWeightPerBox,
    (item as any)?.standardWeightGms,
    (item as any)?.weightPerPcSetReq,
    (item as any)?.weightPerPcReq
  );
  const itemPlateWeightGms = positiveNumber((item as any)?.platePhpWeight);
  const itemPlateWeightKg = positiveNumber(item?.plateWeight, gramsToKg(itemPlateWeightGms));
  return gramsToKg(itemSheetWeightGms) + itemPlateWeightKg;
}

function resolveRealizationPerKg(production: Production, order?: Order | null, item?: Item) {
  const savedRealization = positiveNumber(production.realizationPerKg);
  if (savedRealization > 0) return Number(savedRealization.toFixed(2));

  const rate = positiveNumber(production.rate, order?.rate, (item as any)?.orderRate, item?.rate);
  const totalWeightOfSet = resolveTotalWeightOfSet(production, item);
  if (rate <= 0 || totalWeightOfSet <= 0) return 0;
  return Number((rate / totalWeightOfSet).toFixed(2));
}

function findTargetForDate(targets: TargetRow[], date: Date) {
  const fy = getFinancialYear(toDateInput(date));
  const month = monthLabelFromDate(date);
  const exact = targets.find((row) => row.fy === fy && row.month === month);
  if (exact) return exact;
  return targets.find((row) => row.fy === fy && row.month === "All") || null;
}

function resolveTargetForRange(targets: TargetRow[], fromDate: string, toDate: string) {
  if (targets.length === 0) return null;

  const today = normalizeDate(new Date());
  const from = parseAppDate(fromDate);
  const to = parseAppDate(toDate);
  const start = normalizeDate(from || today);
  const end = normalizeDate(to || from || today);
  const safeStart = start.getTime() <= end.getTime() ? start : end;
  const safeEnd = start.getTime() <= end.getTime() ? end : start;

  let cursor = new Date(safeStart);
  let lastMatch: TargetRow | null = null;
  while (cursor.getTime() <= safeEnd.getTime()) {
    const match = findTargetForDate(targets, cursor);
    if (match) lastMatch = match;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  if (lastMatch) return lastMatch;

  const fallbackForToday = findTargetForDate(targets, today);
  if (fallbackForToday) return fallbackForToday;

  return targets[targets.length - 1] || null;
}

export function RealizationReport() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [productions] = useData<Production>("productions", []);
  const [orders] = useData<Order>("orders", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [companies] = useData<Company>("companies", []);
  const [settings] = useData<Setting>("settings", []);
  const npdItems = useNpdItems();

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [salesPersonId, setSalesPersonId] = useState("");

  const targets = useMemo(() => parseRealizationTargets(settings[0]?.realizationPerKgTargets), [settings]);

  const sourceRows = useMemo<RealizationSourceRow[]>(() => {
    const scheduleMap = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const companyMap = new Map(companies.map((company) => [company.id, company]));
    const itemById = new Map(npdItems.map((item) => [item.id, item]));
    const itemByErp = new Map(
      npdItems
        .map((item) => [String(item.erp || "").trim(), item] as const)
        .filter(([erp]) => Boolean(erp))
    );
    const from = parseAppDate(fromDate);
    const to = parseAppDate(toDate);
    const fromTime = from ? normalizeDate(from).getTime() : null;
    const toTime = to ? normalizeDate(to).getTime() : null;

    return productions
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
      .map((production) => {
        const productionDate = parseAppDate(production.date);
        const schedule = production.scheduleId ? scheduleMap.get(production.scheduleId) : null;
        const order = schedule ? orderMap.get(schedule.orderId) : null;
        const company = order?.companyId ? companyMap.get(order.companyId) : null;
        const companySalesPerson = String(company?.salesPerson || "").trim() || "Unknown Sales Person";
        const erpCode = String(production.erpCode || production.masterErp || order?.erpCode || "").trim();
        const item =
          itemById.get(String(production.npdId || "")) ||
          itemById.get(String(production.itemId || "")) ||
          itemById.get(String(order?.npdId || "")) ||
          itemById.get(String(order?.itemId || "")) ||
          itemByErp.get(erpCode);
        const qty = Number(production.qty || 0);
        const realizationPerKg = resolveRealizationPerKg(production, order, item);

        return {
          productionId: production.id,
          date: production.date,
          qty,
          realizationPerKg,
          weightedValue: Number((qty * realizationPerKg).toFixed(2)),
          companyId: company?.id || "",
          companyName: company?.name || "Unknown Company",
          salesPersonId: companySalesPerson,
          salesPersonName: companySalesPerson,
          jobNo: String(production.transactionNo || production.jobCardNo || "-"),
          dateValue: productionDate ? normalizeDate(productionDate).getTime() : null,
        };
      })
      .filter((row) => Number.isFinite(row.realizationPerKg) && row.realizationPerKg >= 0 && row.qty > 0)
      .filter((row) => {
        if (fromTime != null && (row.dateValue == null || row.dateValue < fromTime)) return false;
        if (toTime != null && (row.dateValue == null || row.dateValue > toTime)) return false;
        if (companyId && row.companyId !== companyId) return false;
        if (salesPersonId && row.salesPersonId !== salesPersonId) return false;
        return true;
      })
      .map(({ dateValue: _dateValue, ...row }) => row);
  }, [companies, companyId, fromDate, npdItems, orders, productions, salesPersonId, schedules, toDate]);

  const salesPersonOptions = useMemo(
    () =>
      Array.from(
        new Set(companies.map((company) => String(company.salesPerson || "").trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [companies]
  );

  const overall = useMemo(() => {
    const totalQty = sourceRows.reduce((sum, row) => sum + row.qty, 0);
    const totalWeighted = sourceRows.reduce((sum, row) => sum + row.weightedValue, 0);
    return {
      totalQty: Number(totalQty.toFixed(2)),
      totalWeighted: Number(totalWeighted.toFixed(2)),
      average: weightedAverage(totalWeighted, totalQty),
      rowCount: sourceRows.length,
    };
  }, [sourceRows]);

  const salesRows = useMemo<RealizationSummaryRow[]>(() => {
    const grouped = new Map<string, RealizationSummaryRow>();
    sourceRows.forEach((row) => {
      const key = row.salesPersonId || row.salesPersonName;
      const current = grouped.get(key) || {
        id: key,
        name: row.salesPersonName,
        qty: 0,
        weightedValue: 0,
        average: 0,
        rowCount: 0,
      };
      current.qty += row.qty;
      current.weightedValue += row.weightedValue;
      current.rowCount += 1;
      grouped.set(key, current);
    });
    return Array.from(grouped.values())
      .map((row) => ({ ...row, average: weightedAverage(row.weightedValue, row.qty) }))
      .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  }, [sourceRows]);

  const companyRows = useMemo<RealizationSummaryRow[]>(() => {
    const grouped = new Map<string, RealizationSummaryRow>();
    sourceRows.forEach((row) => {
      const key = row.companyId || row.companyName;
      const current = grouped.get(key) || {
        id: key,
        name: row.companyName,
        qty: 0,
        weightedValue: 0,
        average: 0,
        rowCount: 0,
      };
      current.qty += row.qty;
      current.weightedValue += row.weightedValue;
      current.rowCount += 1;
      grouped.set(key, current);
    });
    return Array.from(grouped.values())
      .map((row) => ({ ...row, average: weightedAverage(row.weightedValue, row.qty) }))
      .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  }, [sourceRows]);

  const currentTarget = useMemo(() => resolveTargetForRange(targets, fromDate, toDate), [fromDate, targets, toDate]);

  const handleClear = () => {
    setSearchTerm("");
    setFromDate("");
    setToDate("");
    setCompanyId("");
    setSalesPersonId("");
  };

  const summaryExport = useMemo(
    () => [
      { Metric: "Overall Realization/KG", Value: overall.average },
      { Metric: "Total Qty", Value: overall.totalQty },
      { Metric: "Filtered Production Rows", Value: overall.rowCount },
      { Metric: "Target Rate", Value: currentTarget?.value ?? "-" },
      { Metric: "Target FY", Value: currentTarget?.fy ?? "-" },
      { Metric: "Target Month", Value: currentTarget?.month ?? "-" },
    ],
    [currentTarget, overall]
  );

  const salesExport = useMemo(
    () =>
      salesRows.map((row, index) => ({
        "SL No": index + 1,
        "Sales Person": row.name,
        "Weighted Realization/Kg": row.average,
        "Total Qty": Number(row.qty.toFixed(2)),
        Rows: row.rowCount,
      })),
    [salesRows]
  );

  const companyExport = useMemo(
    () =>
      companyRows.map((row, index) => ({
        "SL No": index + 1,
        Company: row.name,
        "Average Realization/Kg": row.average,
        "Total Qty": Number(row.qty.toFixed(2)),
        Rows: row.rowCount,
      })),
    [companyRows]
  );

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryExport), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesExport), "SalesPerson");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(companyExport), "Company");
    XLSX.writeFile(wb, `Realization_Report_${fromDate || "all"}_${toDate || "all"}.xlsx`);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("p", "mm", "a4");
    doc.setFontSize(16);
    doc.text("Realization Report", 14, 16);
    doc.setFontSize(10);
    doc.text(`From: ${fromDate ? formatDate(fromDate) : "All"} | To: ${toDate ? formatDate(toDate) : "All"}`, 14, 23);
    doc.text(`Company: ${companies.find((company) => company.id === companyId)?.name || "All"} | Sales Person: ${salesPersonId || "All"}`, 14, 29);

    autoTable(doc, {
      head: [["Metric", "Value"]],
      body: summaryExport.map((row) => [row.Metric, row.Value]),
      startY: 34,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [35, 52, 78] },
    });

    autoTable(doc, {
      head: [["Sales Person", "Realization/Kg", "Total Qty", "Rows"]],
      body: salesExport.map((row) => [row["Sales Person"], row["Weighted Realization/Kg"], row["Total Qty"], row.Rows]),
      startY: (doc as any).lastAutoTable.finalY + 8,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [35, 52, 78] },
    });

    autoTable(doc, {
      head: [["SL No", "Company", "Average Realization/Kg", "Total Qty"]],
      body: companyExport.map((row) => [row["SL No"], row.Company, row["Average Realization/Kg"], row["Total Qty"]]),
      startY: (doc as any).lastAutoTable.finalY + 8,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [35, 52, 78] },
    });

    doc.save(`Realization_Report_${fromDate || "all"}_${toDate || "all"}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Realization Report</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Overall Realization Per Kg</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{Number(overall.average || 0).toFixed(2)}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Filtered Qty</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{Number(overall.totalQty || 0).toFixed(2)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Production Rows</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{overall.rowCount}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Target Period</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{currentTarget ? `${currentTarget.month} ${currentTarget.fy}` : "Not set"}</div>
          <div className={`mt-1 inline-flex rounded border px-2 py-1 text-xs font-black ${getTargetBadgeClass(currentTarget?.value || 0, overall.average)}`}>
            Current Rate: {currentTarget?.value ?? "-"}
          </div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_repeat(2,minmax(130px,0.7fr))_minmax(180px,1fr)_minmax(180px,1fr)_repeat(3,auto)] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search realization..."
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            title="From"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            title="To"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">All Companies</option>
            {companies
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
          </select>
          <select
            value={salesPersonId}
            onChange={(e) => setSalesPersonId(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">All Sales Persons</option>
            {salesPersonOptions.map((salesPerson) => (
              <option key={salesPerson} value={salesPerson}>{salesPerson}</option>
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

      <div className="space-y-3 rounded border-2 border-black bg-white p-3 shadow-sm">
        <div className="text-sm font-black uppercase text-black">Sales Person vs Realization</div>
        <div className="max-h-[calc(100vh-300px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                <th className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">Metric</th>
                {salesRows.map((row) => (
                  <th key={row.id} className="sticky top-0 z-20 min-w-[150px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-center text-xs font-black uppercase text-white">
                    {row.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="text-black hover:bg-slate-50">
                <td className="border-2 border-black px-3 py-3 font-bold">Realization (Rs/Kg)</td>
                {salesRows.map((row) => (
                  <td
                    key={row.id}
                    className={`border-2 border-black px-3 py-3 text-center font-black ${row.average >= (currentTarget?.value || overall.average || 0) ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"}`}
                  >
                    {Number(row.average || 0).toFixed(2)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 rounded border-2 border-black bg-white p-3 shadow-sm">
        <div className="text-sm font-black uppercase text-black">Company Average Realization</div>
        <div className="max-h-[calc(100vh-300px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                <th className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">SL No</th>
                <th className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">Company</th>
                <th className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-right text-xs font-black uppercase text-white">Average Realization/Kg</th>
              </tr>
            </thead>
            <tbody>
              {companyRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No realization rows found for the selected filters.
                  </td>
                </tr>
              ) : (
                companyRows.map((row, index) => (
                  <tr key={row.id} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 font-bold">{index + 1}</td>
                    <td className="border-2 border-black px-3 py-3 font-semibold">{row.name}</td>
                    <td
                      className={`border-2 border-black px-3 py-3 text-right font-black ${row.average >= (currentTarget?.value || overall.average || 0) ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"}`}
                    >
                      {Number(row.average || 0).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

}

