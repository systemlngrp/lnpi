import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Calendar, Search, Download, FileText } from "lucide-react";
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
  const companyOptions = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .filter((row) => row.companyId && row.companyName && row.companyName !== "-")
            .map((row) => [row.companyId, row.companyName])
        ).entries()
      )
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
  const monthOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.month)))
        .filter((value) => value && value !== "Invalid Date")
        .sort((a, b) => MONTH_LABELS.indexOf(a) - MONTH_LABELS.indexOf(b)),
    [rows]
  );

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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Hit Vs Miss Report</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">
            Hit: {overall.onTime.toLocaleString()}
          </div>
          <div className="rounded border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700">
            Miss: {overall.delayed.toLocaleString()}
          </div>
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700">
            Open: {overall.open.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded border border-black bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.5fr)_repeat(4,minmax(160px,1fr))_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search order, company, item"
              className="w-full rounded border border-black py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>

          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="">All Companies</option>
            {companyOptions.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

          <select
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            className="rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="">All Items</option>
            {npdItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <select
            value={fyFilter}
            onChange={(e) => setFyFilter(e.target.value)}
            className="rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="">All FY</option>
            {fyOptions.map((fy) => (
              <option key={fy} value={fy}>
                {fy}
              </option>
            ))}
          </select>

          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="rounded border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="">All Months</option>
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>

          <button
            onClick={clearFilters}
            className="rounded border border-black px-3 py-2 text-sm font-bold uppercase hover:bg-slate-50"
          >
            Clear Filters
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(170px,220px)_minmax(170px,220px)_1fr]">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded border border-black py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>

          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded border border-black py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
            >
              <Download size={14} />
              Excel
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100"
            >
              <FileText size={14} />
              PDF
            </button>
          </div>
        </div>
      </div>

      <div className="rounded border border-black bg-white shadow-sm">
        <div className="border-b border-black px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-black">Monthly Summary</h3>
        </div>
        <div className="table-frozen-scroll">
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr>
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
                  <th key={heading} className="border border-black px-3 py-2 text-left font-bold uppercase whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 ? (
                <tr>
                  <td colSpan={17} className="border border-black px-6 py-10 text-center font-medium text-slate-500">
                    No summary rows found for the selected filters.
                  </td>
                </tr>
              ) : (
                summaryRows.map((row) => (
                  <tr key={`${row.fy}-${row.month}`} className="hover:bg-slate-50">
                    <td className="border border-black px-3 py-2">{row.fy}</td>
                    <td className="border border-black px-3 py-2 font-bold">{row.month}</td>
                    <td className="border border-black px-3 py-2 text-right">{row.total.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right text-rose-700">{row.delayed.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{row.delayedPercent.toFixed(2)}%</td>
                    <td className="border border-black px-3 py-2 text-right text-emerald-700">{row.onTime.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{row.onTimePercent.toFixed(2)}%</td>
                    <td className="border border-black px-3 py-2 text-right">{row.bucket0to3.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{percent(row.bucket0to3, row.delayed).toFixed(2)}%</td>
                    <td className="border border-black px-3 py-2 text-right">{row.bucket4to7.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{percent(row.bucket4to7, row.delayed).toFixed(2)}%</td>
                    <td className="border border-black px-3 py-2 text-right">{row.bucket8to10.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{percent(row.bucket8to10, row.delayed).toFixed(2)}%</td>
                    <td className="border border-black px-3 py-2 text-right">{row.bucket11to15.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{percent(row.bucket11to15, row.delayed).toFixed(2)}%</td>
                    <td className="border border-black px-3 py-2 text-right">{row.bucketAbove15.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right">{percent(row.bucketAbove15, row.delayed).toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border border-black bg-white shadow-sm">
        <div className="border-b border-black px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-black">Schedule Details</h3>
        </div>
        <div className="table-frozen-scroll">
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr>
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
                  <th key={heading} className="border border-black px-3 py-2 text-left font-bold uppercase whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="border border-black px-6 py-10 text-center font-medium text-slate-500">
                    No schedules found for the selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="border border-black px-3 py-2">{index + 1}</td>
                    <td className="border border-black px-3 py-2">{row.fy}</td>
                    <td className="border border-black px-3 py-2 font-bold">{row.month}</td>
                    <td className="border border-black px-3 py-2 whitespace-nowrap">{formatDate(row.scheduledDate)}</td>
                    <td className="border border-black px-3 py-2 font-bold">{row.orderNo}</td>
                    <td className="border border-black px-3 py-2">{row.companyName}</td>
                    <td className="border border-black px-3 py-2">{row.itemName}</td>
                    <td className="border border-black px-3 py-2 text-right">{row.scheduledQty.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right text-rose-700">{row.canceledQty.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right font-bold">{row.targetQty.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right text-indigo-700">{row.invoicedQty.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 text-right text-amber-700">{row.pendingQty.toLocaleString()}</td>
                    <td className="border border-black px-3 py-2 whitespace-nowrap">
                      {row.fullInvoiceDate ? formatDate(row.fullInvoiceDate) : "-"}
                    </td>
                    <td
                      className={`border border-black px-3 py-2 font-bold uppercase ${
                        row.status === "Hit"
                          ? "text-emerald-700"
                          : row.status === "Miss"
                            ? "text-rose-700"
                            : "text-amber-700"
                      }`}
                    >
                      {row.hitMissLabel}
                    </td>
                    <td className="border border-black px-3 py-2 text-right">{row.delayDays != null ? row.delayDays : "-"}</td>
                    <td className="border border-black px-3 py-2">{row.delayBucket || "-"}</td>
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
