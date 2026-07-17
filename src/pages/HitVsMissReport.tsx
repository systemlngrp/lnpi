import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Search, Download, FileText } from "lucide-react";
import { Select } from "../components/Select";
import { useData } from "../hooks/useData";
import { Company, DispatchPlan, Invoice, LoadingSlip, Order, OrderSchedule } from "../types";
import { formatDate, getFinancialYear } from "../lib/serial";
import { useNpdItems } from "../hooks/useNpdItems";

type DelayBucket = "0-3" | "4-7" | "8-10" | "11-15" | ">15" | "";
type RowStatus = "Hit" | "Miss" | "Pending";

type ScheduleReportRow = {
  id: string;
  fy: string;
  month: string;
  scheduledDate: string;
  orderNo: string;
  companyId: string;
  companyName: string;
  itemId: string;
  itemName: string;
  scheduledQty: number;
  canceledQty: number;
  targetQty: number;
  invoicedQty: number;
  pendingQty: number;
  fullInvoiceDate: string;
  status: RowStatus;
  hitMissLabel: "Hit" | "Miss" | "Open";
  delayDays: number | null;
  delayBucket: DelayBucket;
};

type MonthlySummaryRow = {
  fy: string;
  month: string;
  sortDate: string;
  total: number;
  delayed: number;
  delayedPercent: number;
  onTime: number;
  onTimePercent: number;
  open: number;
  bucket0to3: number;
  bucket4to7: number;
  bucket8to10: number;
  bucket11to15: number;
  bucketAbove15: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function normalizeDate(value?: string | null) {
  return String(value || "").slice(0, 10);
}

function getMonthLabel(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return MONTH_LABELS[date.getMonth()] || "Invalid Date";
}

function getDelayBucket(delayDays: number | null): DelayBucket {
  if (delayDays == null || delayDays <= 0) return "";
  if (delayDays <= 3) return "0-3";
  if (delayDays <= 7) return "4-7";
  if (delayDays <= 10) return "8-10";
  if (delayDays <= 15) return "11-15";
  return ">15";
}

function differenceInDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

export function HitVsMissReport() {
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [invoices] = useData<Invoice>("invoices", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [fyFilter, setFyFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const today = normalizeDate(new Date().toISOString());

  const rows = useMemo<ScheduleReportRow[]>(() => {
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const companyMap = new Map(companies.map((company) => [company.id, company]));
    const itemMap = new Map(npdItems.map((item) => [item.id, item]));
    const invoiceDateMap = new Map(
      invoices.map((invoice) => [invoice.id, normalizeDate(invoice.date || invoice.updateTimestamp || "")])
    );
    const planMap = new Map(plans.map((plan) => [plan.id, plan]));
    const invoiceEventsBySchedule = new Map<string, Array<{ invoiceDate: string; qty: number }>>();

    loadingSlips.forEach((slip) => {
      if (slip.status === "Cancelled" || !slip.invoiceId) return;
      const invoiceDate = invoiceDateMap.get(slip.invoiceId) || "";
      if (!invoiceDate) return;

      slip.lines.forEach((line) => {
        const plan = planMap.get(line.dispatchPlanId);
        const scheduleId = plan?.scheduleId;
        if (!scheduleId) return;
        const qty = Number(line.loadedQty || 0);
        if (qty <= 0) return;
        const existing = invoiceEventsBySchedule.get(scheduleId) || [];
        existing.push({ invoiceDate, qty });
        invoiceEventsBySchedule.set(scheduleId, existing);
      });
    });

    return schedules
      .map((schedule) => {
        const scheduledDate = normalizeDate(schedule.scheduledDate);
        if (!scheduledDate) return null;

        const order = orderMap.get(schedule.orderId);
        const company = order?.companyId ? companyMap.get(order.companyId) : null;
        const item = order?.itemId ? itemMap.get(order.itemId) : null;
        const scheduledQty = Number(schedule.qty || 0);
        const canceledQty = Number(schedule.canceledQty || 0);
        const targetQty = Math.max(0, scheduledQty - canceledQty);
        const events = [...(invoiceEventsBySchedule.get(schedule.id) || [])].sort((a, b) =>
          a.invoiceDate.localeCompare(b.invoiceDate)
        );

        let invoicedQty = 0;
        let fullInvoiceDate = "";
        for (const event of events) {
          invoicedQty += Number(event.qty || 0);
          if (!fullInvoiceDate && invoicedQty >= targetQty && targetQty > 0) {
            fullInvoiceDate = event.invoiceDate;
          }
        }

        invoicedQty = Number(invoicedQty.toFixed(2));
        const pendingQty = Math.max(0, Number((targetQty - invoicedQty).toFixed(2)));
        const fy = getFinancialYear(scheduledDate);
        const month = getMonthLabel(scheduledDate);

        let status: RowStatus = "Pending";
        let hitMissLabel: "Hit" | "Miss" | "Open" = "Open";
        let delayDays: number | null = null;

        if (targetQty <= 0) {
          status = "Hit";
          hitMissLabel = "Hit";
        } else if (fullInvoiceDate) {
          if (fullInvoiceDate <= scheduledDate) {
            status = "Hit";
            hitMissLabel = "Hit";
          } else {
            status = "Miss";
            hitMissLabel = "Miss";
            delayDays = differenceInDays(scheduledDate, fullInvoiceDate);
          }
        } else if (scheduledDate < today) {
          status = "Miss";
          hitMissLabel = "Miss";
          delayDays = differenceInDays(scheduledDate, today);
        }

        return {
          id: schedule.id,
          fy,
          month,
          scheduledDate,
          orderNo: order?.orderNo || "-",
          companyId: company?.id || "",
          companyName: company?.name || "-",
          itemId: item?.id || "",
          itemName: item?.name || "-",
          scheduledQty,
          canceledQty,
          targetQty,
          invoicedQty: Math.min(invoicedQty, targetQty || invoicedQty),
          pendingQty,
          fullInvoiceDate,
          status,
          hitMissLabel,
          delayDays,
          delayBucket: getDelayBucket(delayDays),
        } satisfies ScheduleReportRow;
      })
      .filter((row): row is ScheduleReportRow => Boolean(row))
      .filter((row) => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        const matchesSearch =
          !normalizedSearch ||
          row.orderNo.toLowerCase().includes(normalizedSearch) ||
          row.companyName.toLowerCase().includes(normalizedSearch) ||
          row.itemName.toLowerCase().includes(normalizedSearch);
        const matchesCompany = !companyFilter || row.companyId === companyFilter;
        const matchesItem = !itemFilter || row.itemId === itemFilter;
        const matchesFy = !fyFilter || row.fy === fyFilter;
        const matchesMonth = !monthFilter || row.month === monthFilter;
        const matchesFromDate = !fromDate || row.scheduledDate >= fromDate;
        const matchesToDate = !toDate || row.scheduledDate <= toDate;
        return matchesSearch && matchesCompany && matchesItem && matchesFy && matchesMonth && matchesFromDate && matchesToDate;
      })
      .sort((a, b) => {
        const dateCompare = a.scheduledDate.localeCompare(b.scheduledDate);
        if (dateCompare !== 0) return dateCompare;
        return a.orderNo.localeCompare(b.orderNo, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [companies, companyFilter, fromDate, fyFilter, invoices, itemFilter, loadingSlips, monthFilter, npdItems, orders, plans, schedules, searchTerm, toDate, today]);

  const summaryRows = useMemo<MonthlySummaryRow[]>(() => {
    const grouped = new Map<string, MonthlySummaryRow>();

    rows.forEach((row) => {
      if (!row.scheduledDate || row.month === "Invalid Date" || row.fy === "XX-YY") return;

      const key = `${row.fy}__${row.month}`;
      const existing = grouped.get(key) || {
        fy: row.fy,
        month: row.month,
        sortDate: row.scheduledDate,
        total: 0,
        delayed: 0,
        delayedPercent: 0,
        onTime: 0,
        onTimePercent: 0,
        open: 0,
        bucket0to3: 0,
        bucket4to7: 0,
        bucket8to10: 0,
        bucket11to15: 0,
        bucketAbove15: 0,
      };

      existing.total += 1;
      if (row.status === "Hit") existing.onTime += 1;
      if (row.status === "Miss") existing.delayed += 1;
      if (row.status === "Pending") existing.open += 1;

      if (row.delayBucket === "0-3") existing.bucket0to3 += 1;
      if (row.delayBucket === "4-7") existing.bucket4to7 += 1;
      if (row.delayBucket === "8-10") existing.bucket8to10 += 1;
      if (row.delayBucket === "11-15") existing.bucket11to15 += 1;
      if (row.delayBucket === ">15") existing.bucketAbove15 += 1;

      if (row.scheduledDate < existing.sortDate) existing.sortDate = row.scheduledDate;
      grouped.set(key, existing);
    });

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        delayedPercent: percent(row.delayed, row.total),
        onTimePercent: percent(row.onTime, row.total),
      }))
      .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  }, [rows]);

  const overall = useMemo(() => {
    return summaryRows.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        delayed: acc.delayed + row.delayed,
        onTime: acc.onTime + row.onTime,
        open: acc.open + row.open,
        bucket0to3: acc.bucket0to3 + row.bucket0to3,
        bucket4to7: acc.bucket4to7 + row.bucket4to7,
        bucket8to10: acc.bucket8to10 + row.bucket8to10,
        bucket11to15: acc.bucket11to15 + row.bucket11to15,
        bucketAbove15: acc.bucketAbove15 + row.bucketAbove15,
      }),
      {
        total: 0,
        delayed: 0,
        onTime: 0,
        open: 0,
        bucket0to3: 0,
        bucket4to7: 0,
        bucket8to10: 0,
        bucket11to15: 0,
        bucketAbove15: 0,
      }
    );
  }, [summaryRows]);

  const fyOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.fy))).sort(), [rows]);
  const fySelectOptions = useMemo(() => fyOptions.map((fy) => ({ value: fy, label: fy })), [fyOptions]);
  const companyOptions = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .filter((row) => row.companyId && row.companyName && row.companyName !== "-")
            .map((row) => [row.companyId, row.companyName])
        ).entries()
      )
        .map(([id, name]) => ({ id, name, value: id, label: name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
  const itemOptions = useMemo(
    () =>
      npdItems
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({ value: item.id, label: item.name })),
    [npdItems]
  );
  const monthOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.month)))
        .filter((value) => value && value !== "Invalid Date")
        .sort((a, b) => MONTH_LABELS.indexOf(a) - MONTH_LABELS.indexOf(b)),
    [rows]
  );
  const monthSelectOptions = useMemo(() => monthOptions.map((month) => ({ value: month, label: month })), [monthOptions]);

  const clearFilters = () => {
    setSearchTerm("");
    setCompanyFilter("");
    setItemFilter("");
    setFyFilter("");
    setMonthFilter("");
    setFromDate("");
    setToDate("");
  };

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.json_to_sheet(
      summaryRows.map((row) => ({
        FY: row.fy,
        Month: row.month,
        Total: row.total,
        Delayed: row.delayed,
        "Delayed (%)": row.delayedPercent,
        "On Time": row.onTime,
        "On Time (%)": row.onTimePercent,
        Open: row.open,
        "Delay (0-3)": row.bucket0to3,
        "Delay (4-7)": row.bucket4to7,
        "Delay (8-10)": row.bucket8to10,
        "Delay (11-15)": row.bucket11to15,
        "Delay (>15)": row.bucketAbove15,
      }))
    );

    const detailsSheet = XLSX.utils.json_to_sheet(
      rows.map((row, index) => ({
        "S.No": index + 1,
        FY: row.fy,
        Month: row.month,
        "Schedule Date": row.scheduledDate,
        "Order No": row.orderNo,
        Company: row.companyName,
        Item: row.itemName,
        "Sch Qty": row.scheduledQty,
        Canceled: row.canceledQty,
        "Target Qty": row.targetQty,
        "Invoiced Qty": row.invoicedQty,
        "Pending Qty": row.pendingQty,
        "Full Invoice Date": row.fullInvoiceDate,
        Status: row.hitMissLabel,
        "Delay Days": row.delayDays ?? "",
        Bucket: row.delayBucket || "",
      }))
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Monthly Summary");
    XLSX.utils.book_append_sheet(workbook, detailsSheet, "Schedule Details");
    XLSX.writeFile(workbook, "Hit_Vs_Miss_Report.xlsx");
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text("Hit Vs Miss Report", 14, 16);
    doc.setFontSize(10);
    doc.text(
      `Filters: ${companyFilter || "All Companies"} | ${itemFilter || "All Items"} | ${fyFilter || "All FY"} | ${monthFilter || "All Months"}`,
      14,
      24
    );

    autoTable(doc, {
      head: [[
        "FY",
        "Month",
        "Total",
        "Delayed",
        "Delayed (%)",
        "On Time",
        "On Time (%)",
        "Delay (0-3)",
        "Delay (4-7)",
        "Delay (8-10)",
        "Delay (11-15)",
        "Delay (>15)",
      ]],
      body: summaryRows.map((row) => [
        row.fy,
        row.month,
        row.total,
        row.delayed,
        `${row.delayedPercent.toFixed(2)}%`,
        row.onTime,
        `${row.onTimePercent.toFixed(2)}%`,
        row.bucket0to3,
        row.bucket4to7,
        row.bucket8to10,
        row.bucket11to15,
        row.bucketAbove15,
      ]),
      startY: 30,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    autoTable(doc, {
      head: [[
        "S.No",
        "FY",
        "Month",
        "Schedule Date",
        "Order No",
        "Company",
        "Item",
        "Target Qty",
        "Invoiced Qty",
        "Pending Qty",
        "Full Invoice Date",
        "Status",
        "Delay Days",
        "Bucket",
      ]],
      body: rows.map((row, index) => [
        index + 1,
        row.fy,
        row.month,
        formatDate(row.scheduledDate),
        row.orderNo,
        row.companyName,
        row.itemName,
        row.targetQty,
        row.invoicedQty,
        row.pendingQty,
        row.fullInvoiceDate ? formatDate(row.fullInvoiceDate) : "-",
        row.hitMissLabel,
        row.delayDays ?? "-",
        row.delayBucket || "-",
      ]),
      startY: (doc as any).lastAutoTable.finalY + 8,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.8 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    doc.save("Hit_Vs_Miss_Report.pdf");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Hit Vs Miss Report</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Schedules</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{overall.total.toLocaleString()}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Hit</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{overall.onTime.toLocaleString()}</div>
        </div>
        <div className="rounded border border-rose-300 bg-rose-50 p-4">
          <div className="text-xs font-black uppercase text-rose-700">Miss</div>
          <div className="mt-1 text-2xl font-black text-rose-900">{overall.delayed.toLocaleString()}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Open</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{overall.open.toLocaleString()}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_repeat(4,minmax(140px,1fr))]">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search order, company, item"
                className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
              />
            </div>
            <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
            <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
            <Select value={fyFilter} onChange={setFyFilter} options={fySelectOptions} placeholder="All FY" />
            <Select value={monthFilter} onChange={setMonthFilter} options={monthSelectOptions} placeholder="All Months" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              title="From Date"
              className="min-h-[42px] rounded border-2 border-black px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              title="To Date"
              className="min-h-[42px] rounded border-2 border-black px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-[42px] rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
            >
              Clear Filters
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex min-h-[42px] items-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
            >
              <Download size={14} />
              Excel
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex min-h-[42px] items-center gap-2 rounded border border-rose-700 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100"
            >
              <FileText size={14} />
              PDF
            </button>
          </div>
        </div>
      </div>

      <div className="rounded border-2 border-black bg-white shadow-sm">
        <div className="border-b-2 border-black px-3 py-3">
          <h3 className="text-sm font-black uppercase text-black">Monthly Summary</h3>
        </div>
        <div className="max-h-[calc(100vh-310px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                {[
                  "FY",
                  "Month",
                  "Total",
                  "Delayed",
                  "Delayed (%)",
                  "On Time",
                  "On Time (%)",
                  "Delay (0-3)",
                  "Delay (0-3)%",
                  "Delay (4-7)",
                  "Delay (4-7)%",
                  "Delay (8-10)",
                  "Delay (8-10)%",
                  "Delay (11-15)",
                  "Delay (11-15)%",
                  "Delay (>15)",
                  "Delay (>15)%",
                ].map((heading) => (
                  <th key={heading} className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 ? (
                <tr>
                  <td colSpan={17} className="border-2 border-black px-6 py-10 text-center font-medium text-black">
                    No summary rows found for the selected filters.
                  </td>
                </tr>
              ) : (
                summaryRows.map((row) => (
                  <tr key={`${row.fy}-${row.month}`} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3">{row.fy}</td>
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.month}</td>
                    <td className="border-2 border-black bg-blue-50/50 px-3 py-3 text-right font-semibold">{row.total.toLocaleString()}</td>
                    <td className="border-2 border-black bg-rose-50 px-3 py-3 text-right font-bold text-rose-800">{row.delayed.toLocaleString()}</td>
                    <td className="border-2 border-black bg-rose-50/60 px-3 py-3 text-right text-rose-800">{row.delayedPercent.toFixed(2)}%</td>
                    <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right font-bold text-emerald-900">{row.onTime.toLocaleString()}</td>
                    <td className="border-2 border-black bg-emerald-50/60 px-3 py-3 text-right text-emerald-900">{row.onTimePercent.toFixed(2)}%</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right">{row.bucket0to3.toLocaleString()}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right">{percent(row.bucket0to3, row.delayed).toFixed(2)}%</td>
                    <td className="border-2 border-black bg-orange-50 px-3 py-3 text-right">{row.bucket4to7.toLocaleString()}</td>
                    <td className="border-2 border-black bg-orange-50 px-3 py-3 text-right">{percent(row.bucket4to7, row.delayed).toFixed(2)}%</td>
                    <td className="border-2 border-black bg-red-50 px-3 py-3 text-right">{row.bucket8to10.toLocaleString()}</td>
                    <td className="border-2 border-black bg-red-50 px-3 py-3 text-right">{percent(row.bucket8to10, row.delayed).toFixed(2)}%</td>
                    <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right">{row.bucket11to15.toLocaleString()}</td>
                    <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right">{percent(row.bucket11to15, row.delayed).toFixed(2)}%</td>
                    <td className="border-2 border-black bg-slate-100 px-3 py-3 text-right">{row.bucketAbove15.toLocaleString()}</td>
                    <td className="border-2 border-black bg-slate-100 px-3 py-3 text-right">{percent(row.bucketAbove15, row.delayed).toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border-2 border-black bg-white shadow-sm">
        <div className="border-b-2 border-black px-3 py-3">
          <h3 className="text-sm font-black uppercase text-black">Schedule Details</h3>
        </div>
        <div className="max-h-[calc(100vh-310px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                {[
                  "S.No",
                  "FY",
                  "Month",
                  "Schedule Date",
                  "Order No",
                  "Company",
                  "Item",
                  "Sch Qty",
                  "Canceled",
                  "Target Qty",
                  "Invoiced Qty",
                  "Pending Qty",
                  "Full Invoice Date",
                  "Status",
                  "Delay Days",
                  "Bucket",
                ].map((heading) => (
                  <th key={heading} className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="border-2 border-black px-6 py-10 text-center font-medium text-black">
                    No schedules found for the selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.id} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3">{index + 1}</td>
                    <td className="border-2 border-black px-3 py-3">{row.fy}</td>
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.month}</td>
                    <td className="border-2 border-black px-3 py-3 whitespace-nowrap">{formatDate(row.scheduledDate)}</td>
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.orderNo}</td>
                    <td className="border-2 border-black px-3 py-3">{row.companyName}</td>
                    <td className="border-2 border-black px-3 py-3 min-w-[260px]">{row.itemName}</td>
                    <td className="border-2 border-black bg-blue-50/50 px-3 py-3 text-right">{row.scheduledQty.toLocaleString()}</td>
                    <td className="border-2 border-black bg-rose-50 px-3 py-3 text-right text-rose-800">{row.canceledQty.toLocaleString()}</td>
                    <td className="border-2 border-black bg-slate-50 px-3 py-3 text-right font-bold">{row.targetQty.toLocaleString()}</td>
                    <td className="border-2 border-black bg-indigo-50 px-3 py-3 text-right text-indigo-800">{row.invoicedQty.toLocaleString()}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right text-amber-900">{row.pendingQty.toLocaleString()}</td>
                    <td className="border-2 border-black px-3 py-3 whitespace-nowrap">{row.fullInvoiceDate ? formatDate(row.fullInvoiceDate) : "-"}</td>
                    <td
                      className={`border-2 border-black px-3 py-3 font-black uppercase ${row.status === "Hit" ? "bg-emerald-50 text-emerald-900" : row.status === "Miss" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"}`}
                    >
                      {row.hitMissLabel}
                    </td>
                    <td className="border-2 border-black px-3 py-3 text-right">{row.delayDays != null ? row.delayDays : "-"}</td>
                    <td className="border-2 border-black px-3 py-3">{row.delayBucket || "-"}</td>
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
