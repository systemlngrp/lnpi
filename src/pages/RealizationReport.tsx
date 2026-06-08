import React, { useMemo, useState, useEffect } from "react";

import { TableControls } from "../components/TableControls";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Building2, Calendar, Download, FileText, RotateCcw, TrendingUp, User2 } from "lucide-react";
import { useData } from "../hooks/useData";
import { Company, Order, OrderSchedule, Production, Setting, User } from "../types";
import { formatDate, getFinancialYear } from "../lib/serial";

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

function parseRealizationTargets(raw?: string | null): TargetRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        fy: String((row?.fy ?? row?.year) || "").trim(),
        month: String(row?.month || "All").trim() || "All",
        value: Number(row?.value || 0),
      }))
      .filter((row) => row.fy && Number.isFinite(row.value));
  } catch {
    return [];
  }
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
  const [users] = useData<User>("users", []);
  const [companies] = useData<Company>("companies", []);
  const [settings] = useData<Setting>("settings", []);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [salesPersonId, setSalesPersonId] = useState("");

  const targets = useMemo(() => parseRealizationTargets(settings[0]?.realizationPerKgTargets), [settings]);

  const sourceRows = useMemo<RealizationSourceRow[]>(() => {
    const scheduleMap = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const userMap = new Map(users.map((user) => [user.id, user]));
    const companyMap = new Map(companies.map((company) => [company.id, company]));
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
        const user = order?.orderBy ? userMap.get(order.orderBy) : null;
        const company = order?.companyId ? companyMap.get(order.companyId) : null;
        const qty = Number(production.qty || 0);
        const realizationPerKg = Number(production.realizationPerKg || 0);

        return {
          productionId: production.id,
          date: production.date,
          qty,
          realizationPerKg,
          weightedValue: Number((qty * realizationPerKg).toFixed(2)),
          companyId: company?.id || "",
          companyName: company?.name || "Unknown Company",
          salesPersonId: user?.id || order?.orderBy || "",
          salesPersonName: user?.name || "Unknown Sales Person",
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
  }, [companies, companyId, fromDate, orders, productions, salesPersonId, schedules, toDate, users]);

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
    doc.text(`Company: ${companies.find((company) => company.id === companyId)?.name || "All"} | Sales Person: ${users.find((user) => user.id === salesPersonId)?.name || "All"}`, 14, 29);

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
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_45px_-30px_rgba(15,23,42,0.34)]">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 px-5 py-3 text-white">
          <div className="flex items-center gap-2 text-lg font-black tracking-tight">
            <TrendingUp size={18} />
            Realization Dashboard
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 px-5 py-4 text-white shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-bold uppercase tracking-[0.16em] text-white/85">Overall Realization Per Kg</div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-4xl font-black tracking-tight">{Number(overall.average || 0).toFixed(2)} <span className="text-base font-bold text-white/85">per kg</span></div>
                <div className={`rounded-full border px-4 py-2 text-sm font-black ${getTargetBadgeClass(currentTarget?.value || 0, overall.average)}`}>
                  Current Rate: {currentTarget?.value ?? "-"}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/75">Filtered Qty</div>
                <div className="mt-1 text-2xl font-black tracking-tight">{Number(overall.totalQty || 0).toFixed(2)}</div>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/75">Production Rows</div>
                <div className="mt-1 text-2xl font-black tracking-tight">{overall.rowCount}</div>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/75">Target Period</div>
                <div className="mt-1 text-lg font-black tracking-tight">
                  {currentTarget ? `${currentTarget.month} ${currentTarget.fy}` : "Not set"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[150px_150px_minmax(180px,1fr)_minmax(180px,1fr)_auto_auto_auto]">
              <label className="space-y-1">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  <Calendar size={13} />
                  From
                </span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none"
                />
              </label>

              <label className="space-y-1">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  <Calendar size={13} />
                  To
                </span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none"
                />
              </label>

              <label className="space-y-1">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  <Building2 size={13} />
                  Company
                </span>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none"
                >
                  <option value="">All Companies</option>
                  {companies
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  <User2 size={13} />
                  Sales Person
                </span>
                <select
                  value={salesPersonId}
                  onChange={(e) => setSalesPersonId(e.target.value)}
                  className="h-[42px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold outline-none"
                >
                  <option value="">All Sales Persons</option>
                  {users
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                </select>
              </label>

              <button
                type="button"
                onClick={handleClear}
                className="mt-5 inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-600 px-4 text-sm font-bold text-white hover:bg-slate-700"
              >
                <RotateCcw size={14} />
                Clear
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="mt-5 inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-emerald-600 bg-emerald-500 px-4 text-sm font-bold text-white hover:bg-emerald-600"
              >
                <Download size={14} />
                Excel
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                className="mt-5 inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-rose-600 bg-rose-500 px-4 text-sm font-bold text-white hover:bg-rose-600"
              >
                <FileText size={14} />
                PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-xl font-bold text-slate-900">Sales Person vs Realization</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em]">Metric</th>
                {salesRows.map((row) => (
                  <th key={row.id} className="min-w-[140px] px-4 py-3 text-center text-xs font-black uppercase tracking-[0.16em]">
                    {row.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-t border-slate-200 px-4 py-3 text-sm font-bold text-slate-700">Realization (Rs/Kg)</td>
                {salesRows.map((row) => (
                  <td
                    key={row.id}
                    className={`border-t border-slate-200 px-4 py-3 text-center text-sm font-black ${
                      row.average >= (currentTarget?.value || overall.average || 0)
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {Number(row.average || 0).toFixed(2)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-xl font-bold text-slate-900">Company Average Realization</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em] text-slate-600">SL No</th>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em] text-slate-600">Company</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right text-xs font-black uppercase tracking-[0.16em] text-slate-600">Average Realization/Kg</th>
              </tr>
            </thead>
            <tbody>
              {companyRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    No realization rows found for the selected filters.
                  </td>
                </tr>
              ) : (
                companyRows.map((row, index) => (
                  <tr key={row.id} className="border-t border-slate-200">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-700">{index + 1}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{row.name}</td>
                    <td
                      className={`px-4 py-3 text-right text-sm font-black ${
                        row.average >= (currentTarget?.value || overall.average || 0)
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
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

