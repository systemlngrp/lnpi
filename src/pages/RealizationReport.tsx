import React, { useMemo, useState, useEffect } from "react";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Download, FileText, RotateCcw, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { Company, Item, Order, OrderSchedule, Production, Setting } from "../types";
import { formatDate, getFinancialYear } from "../lib/serial";
import { findRealizationTargetForDate, parseRealizationTargets } from "../lib/realizationTargets";
import { useNpdItems } from "../hooks/useNpdItems";
import { Select } from "../components/Select";

type TargetRow = {
  dateFrom: string;
  dateTo: string;
  value: number;
  fy?: string;
  month?: string;
};

type RealizationSourceRow = {
  productionId: string;
  date: string;
  qty: number;
  realizationPerKg: number;
  productionValue: number;
  productionWeight: number;
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
  productionValue: number;
  productionWeight: number;
  average: number;
  rowCount: number;
};


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

function getTargetBadgeClass(value: number, benchmark: number) {
  if (value <= 0) return "border-slate-200 bg-slate-50 text-slate-700";
  if (value >= benchmark) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function realizationAverage(productionValue: number, productionWeight: number) {
  if (!Number.isFinite(productionValue) || !Number.isFinite(productionWeight) || productionWeight <= 0) return 0;
  return Number((productionValue / productionWeight).toFixed(2));
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

function resolveRate(production: Production, order?: Order | null, item?: Item) {
  return positiveNumber(production.rate, order?.rate, (item as any)?.orderRate, item?.rate);
}

function normalizeSalesPerson(value?: string | null) {
  const label = String(value || "").trim().replace(/\s+/g, " ") || "Unknown Sales Person";
  return {
    id: label.toUpperCase(),
    label,
  };
}

function resolveCurrentTarget(targets: TargetRow[]) {
  return findRealizationTargetForDate(targets, toDateInput(new Date()));
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
        const companySalesPerson = normalizeSalesPerson(company?.salesPerson);
        const erpCode = String(production.erpCode || production.masterErp || order?.erpCode || "").trim();
        const item =
          itemById.get(String(production.npdId || "")) ||
          itemById.get(String(production.itemId || "")) ||
          itemById.get(String(order?.npdId || "")) ||
          itemById.get(String(order?.itemId || "")) ||
          itemByErp.get(erpCode);
        const qty = Number(production.qty || 0);
        const rate = resolveRate(production, order, item);
        const totalWeightOfSet = resolveTotalWeightOfSet(production, item);
        const productionValue = Number((qty * rate).toFixed(2));
        const productionWeight = Number((qty * totalWeightOfSet).toFixed(2));
        const realizationPerKg = realizationAverage(productionValue, productionWeight);

        return {
          productionId: production.id,
          date: production.date,
          qty,
          realizationPerKg,
          productionValue,
          productionWeight,
          companyId: company?.id || "",
          companyName: company?.name || "Unknown Company",
          salesPersonId: companySalesPerson.id,
          salesPersonName: companySalesPerson.label,
          jobNo: String(production.transactionNo || production.jobCardNo || "-"),
          dateValue: productionDate ? normalizeDate(productionDate).getTime() : null,
        };
      })
      .filter((row) => row.qty > 0 && row.productionValue > 0 && row.productionWeight > 0 && row.realizationPerKg > 0)
      .filter((row) => {
        if (fromTime != null && (row.dateValue == null || row.dateValue < fromTime)) return false;
        if (toTime != null && (row.dateValue == null || row.dateValue > toTime)) return false;
        if (companyId && row.companyId !== companyId) return false;
        if (salesPersonId && row.salesPersonId !== salesPersonId) return false;
        return true;
      })
      .map(({ dateValue: _dateValue, ...row }) => row);
  }, [companies, companyId, fromDate, npdItems, orders, productions, salesPersonId, schedules, toDate]);

  const companyOptions = useMemo(
    () => [
      { value: "", label: "All Companies" },
      ...companies
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((company) => ({ value: company.id, label: company.name, searchText: company.name })),
    ],
    [companies]
  );

  const salesPersonOptions = useMemo(() => {
    const byId = new Map<string, string>();
    companies.forEach((company) => {
      const salesPerson = normalizeSalesPerson(company.salesPerson);
      if (salesPerson.label === "Unknown Sales Person") return;
      if (!byId.has(salesPerson.id)) byId.set(salesPerson.id, salesPerson.label);
    });
    return [
      { value: "", label: "All Sales Persons" },
      ...Array.from(byId.entries())
        .map(([id, label]) => ({ value: id, label, searchText: label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [companies]);

  const overall = useMemo(() => {
    const totalQty = sourceRows.reduce((sum, row) => sum + row.qty, 0);
    const totalProductionValue = sourceRows.reduce((sum, row) => sum + row.productionValue, 0);
    const totalProductionWeight = sourceRows.reduce((sum, row) => sum + row.productionWeight, 0);
    return {
      totalQty: Number(totalQty.toFixed(2)),
      totalProductionValue: Number(totalProductionValue.toFixed(2)),
      totalProductionWeight: Number(totalProductionWeight.toFixed(2)),
      average: realizationAverage(totalProductionValue, totalProductionWeight),
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
        productionValue: 0,
        productionWeight: 0,
        average: 0,
        rowCount: 0,
      };
      current.qty += row.qty;
      current.productionValue += row.productionValue;
      current.productionWeight += row.productionWeight;
      current.rowCount += 1;
      grouped.set(key, current);
    });
    return Array.from(grouped.values())
      .map((row) => ({ ...row, average: realizationAverage(row.productionValue, row.productionWeight) }))
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
        productionValue: 0,
        productionWeight: 0,
        average: 0,
        rowCount: 0,
      };
      current.qty += row.qty;
      current.productionValue += row.productionValue;
      current.productionWeight += row.productionWeight;
      current.rowCount += 1;
      grouped.set(key, current);
    });
    return Array.from(grouped.values())
      .map((row) => ({ ...row, average: realizationAverage(row.productionValue, row.productionWeight) }))
      .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  }, [sourceRows]);

  const currentTarget = useMemo(() => resolveCurrentTarget(targets), [targets]);
  const currentTargetFy = useMemo(() => currentTarget ? `FY ${getFinancialYear(currentTarget.dateFrom)}` : "Not set", [currentTarget]);

  const selectedSalesPersonLabel = useMemo(() => {
    if (!salesPersonId) return "All";
    return salesPersonOptions.find((option) => option.value === salesPersonId)?.label || salesPersonId;
  }, [salesPersonId, salesPersonOptions]);

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
      { Metric: "Target Date From", Value: currentTarget?.dateFrom ?? "-" },
      { Metric: "Target Date To", Value: currentTarget?.dateTo ?? "-" },
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
    doc.text(`Company: ${companies.find((company) => company.id === companyId)?.name || "All"} | Sales Person: ${selectedSalesPersonLabel}`, 14, 29);

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
          <div className="mt-1 text-sm font-black text-purple-900">{currentTargetFy}</div>
          <div className={`mt-2 text-2xl font-black ${getTargetBadgeClass(currentTarget?.value || 0, overall.average)}`}>
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
          <Select
            id="realization-company-filter"
            options={companyOptions}
            value={companyId}
            onChange={setCompanyId}
            placeholder="All Companies"
          />
          <Select
            id="realization-sales-person-filter"
            options={salesPersonOptions}
            value={salesPersonId}
            onChange={setSalesPersonId}
            placeholder="All Sales Persons"
          />
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
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="bg-indigo-700 text-white">
              <tr className="bg-indigo-700 text-white">
                <th className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">Metric</th>
                {salesRows.map((row) => (
                  <th key={row.id} className="min-w-[150px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-center text-xs font-black uppercase text-white">
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
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="bg-indigo-700 text-white">
              <tr className="bg-indigo-700 text-white">
                <th className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">SL No</th>
                <th className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">Company</th>
                <th className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-right text-xs font-black uppercase text-white">Average Realization/Kg</th>
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

