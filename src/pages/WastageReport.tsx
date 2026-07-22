import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Download, FileText, RotateCcw, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import type { Company, Invoice, InvoiceLineItem } from "../types";
import { formatDate } from "../lib/serial";
import { formatCurrency } from "../lib/utils";
import { buildScrapInvoiceRows, summarizeScrapInvoiceRows } from "../lib/wastageReport";

function formatQty(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WastageReport() {
  const [invoices] = useData<Invoice>("invoices", []);
  const [lineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [companies] = useData<Company>("companies", []);
  const { findItem, findItemAcrossSources } = useOrderItemCatalog();

  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [companyId, setCompanyId] = useState("");

  const reportRows = useMemo(
    () =>
      buildScrapInvoiceRows({
        invoices,
        lineItems,
        companies,
        filters: { fromDate, toDate, companyId, searchTerm },
        findItem,
        findItemAcrossSources,
      }),
    [companies, companyId, findItem, findItemAcrossSources, fromDate, invoices, lineItems, searchTerm, toDate]
  );

  const summary = useMemo(() => summarizeScrapInvoiceRows(reportRows), [reportRows]);

  const companyOptions = useMemo(
    () => companies.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [companies]
  );

  const exportRows = useMemo(
    () =>
      reportRows.map((row, index) => ({
        "SL No": index + 1,
        "Invoice No": row.invoiceNo,
        "Invoice Date": formatDate(row.invoiceDate),
        Company: row.companyName,
        ERP: row.erp || "-",
        "Item Name": row.itemName,
        Qty: Number(row.qty.toFixed(2)),
        Rate: Number(row.rate.toFixed(2)),
        "Taxable Amount": Number(row.taxableAmount.toFixed(2)),
        CGST: Number(row.cgst.toFixed(2)),
        SGST: Number(row.sgst.toFixed(2)),
        IGST: Number(row.igst.toFixed(2)),
        "Total Amount": Number(row.totalAmount.toFixed(2)),
      })),
    [reportRows]
  );

  const handleClear = () => {
    setSearchTerm("");
    setFromDate("");
    setToDate("");
    setCompanyId("");
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Metric: "Total Scrap Qty", Value: Number(summary.totalQty.toFixed(2)) },
        { Metric: "Taxable Value", Value: Number(summary.taxableAmount.toFixed(2)) },
        { Metric: "GST Value", Value: Number(summary.gstValue.toFixed(2)) },
        { Metric: "Total Invoiced Value", Value: Number(summary.totalAmount.toFixed(2)) },
        { Metric: "Invoice Count", Value: summary.invoiceCount },
      ]),
      "Summary"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), "Scrap Items");
    XLSX.writeFile(wb, `Wastage_Report_${fromDate || "all"}_${toDate || "all"}.xlsx`);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text("Wastage Report", 14, 16);
    doc.setFontSize(10);
    doc.text(`From: ${fromDate ? formatDate(fromDate) : "All"} | To: ${toDate ? formatDate(toDate) : "All"}`, 14, 23);
    doc.text(`Company: ${companies.find((company) => company.id === companyId)?.name || "All"}`, 14, 29);

    autoTable(doc, {
      head: [["Metric", "Value"]],
      body: [
        ["Total Scrap Qty", formatQty(summary.totalQty)],
        ["Taxable Value", formatMoney(summary.taxableAmount)],
        ["GST Value", formatMoney(summary.gstValue)],
        ["Total Invoiced Value", formatMoney(summary.totalAmount)],
        ["Invoice Count", summary.invoiceCount],
      ],
      startY: 34,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [35, 52, 78] },
    });

    autoTable(doc, {
      head: [["Invoice", "Date", "Company", "ERP", "Item", "Qty", "Rate", "Taxable", "CGST", "SGST", "IGST", "Total"]],
      body: exportRows.map((row) => [
        row["Invoice No"],
        row["Invoice Date"],
        row.Company,
        row.ERP,
        row["Item Name"],
        row.Qty,
        row.Rate,
        row["Taxable Amount"],
        row.CGST,
        row.SGST,
        row.IGST,
        row["Total Amount"],
      ]),
      startY: (doc as any).lastAutoTable.finalY + 8,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [35, 52, 78] },
    });

    doc.save(`Wastage_Report_${fromDate || "all"}_${toDate || "all"}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Wastage Report</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <SummaryCard label="Total Scrap Qty" value={formatQty(summary.totalQty)} tone="border-cyan-300 bg-cyan-50 text-cyan-900" />
        <SummaryCard label="Taxable Value" value={formatCurrency(summary.taxableAmount)} tone="border-emerald-300 bg-emerald-50 text-emerald-900" />
        <SummaryCard label="GST Value" value={formatCurrency(summary.gstValue)} tone="border-amber-300 bg-amber-50 text-amber-900" />
        <SummaryCard label="Total Invoiced Value" value={formatCurrency(summary.totalAmount)} tone="border-indigo-300 bg-indigo-50 text-indigo-900" />
        <SummaryCard label="Invoice Count" value={summary.invoiceCount.toLocaleString("en-IN")} tone="border-rose-300 bg-rose-50 text-rose-900" />
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_repeat(2,minmax(130px,0.7fr))_minmax(180px,1fr)_repeat(3,auto)] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search invoice, company, ERP, item..."
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            title="From"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            title="To"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <select
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">All Companies</option>
            {companyOptions.map((company) => (
              <option key={company.id} value={company.id}>{company.name}</option>
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

      <div className="rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-310px)] w-full overflow-auto">
          <table className="w-full min-w-[1400px] border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                <th className="border-2 border-black px-3 py-3 text-left text-xs font-black uppercase">Invoice No</th>
                <th className="border-2 border-black px-3 py-3 text-left text-xs font-black uppercase">Date</th>
                <th className="border-2 border-black px-3 py-3 text-left text-xs font-black uppercase">Company</th>
                <th className="border-2 border-black px-3 py-3 text-left text-xs font-black uppercase">ERP</th>
                <th className="border-2 border-black px-3 py-3 text-left text-xs font-black uppercase">Item Name</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">Qty</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">Rate</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">Taxable</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">CGST</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">SGST</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">IGST</th>
                <th className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase">Total</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No scrap invoice lines found for the selected filters.
                  </td>
                </tr>
              ) : (
                reportRows.map((row, index) => (
                  <tr key={`${row.invoiceId}-${index}-${row.itemName}`} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="border-2 border-black px-3 py-2 font-bold">{row.invoiceNo}</td>
                    <td className="border-2 border-black px-3 py-2 whitespace-nowrap">{formatDate(row.invoiceDate)}</td>
                    <td className="border-2 border-black px-3 py-2 font-semibold">{row.companyName}</td>
                    <td className="border-2 border-black px-3 py-2 font-bold text-slate-700">{row.erp || "-"}</td>
                    <td className="border-2 border-black px-3 py-2 font-bold uppercase">{row.itemName}</td>
                    <td className="border-2 border-black px-3 py-2 text-right">{formatQty(row.qty)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right">{formatMoney(row.rate)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right">{formatMoney(row.taxableAmount)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right">{formatMoney(row.cgst)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right">{formatMoney(row.sgst)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right">{formatMoney(row.igst)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right font-black text-indigo-800">{formatMoney(row.totalAmount)}</td>
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

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded border p-4 ${tone}`}>
      <div className="text-xs font-black uppercase opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}