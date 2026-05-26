import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ArrowUpDown,
  Circle,
  Download,
  Filter,
  Mail,
  Search,
} from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnReelLine,
  Supplier,
} from "../types";

type AvailabilityFilter = "all" | "gt500" | "lt500";

type ReelwiseStockRow = {
  slipId: string;
  mrrDate: string;
  mrrNo: string;
  ourReelNo: string;
  erp: string;
  supplierName: string;
  gsm: number;
  size: number;
  bf: number;
  issuedDate: string;
  issuedWeight: number;
  returnedDate: string;
  returnedWeight: number;
  availableWeight: number;
  mrrQty: number;
  ageDays: number;
};

function formatReportDate(dateStr?: string) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return String(dateStr);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function getAgeDays(dateStr?: string) {
  if (!dateStr) return 0;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function buildReelwisePdf(rows: ReelwiseStockRow[]) {
  const doc = new jsPDF("l", "mm", "a4");
  doc.setFontSize(16);
  doc.text("Reelwise Stock Report", 14, 14);
  doc.setFontSize(9);
  doc.text(`Generated on ${new Date().toLocaleString("en-GB")}`, 14, 20);

  autoTable(doc, {
    startY: 25,
    head: [[
      "SL No",
      "MRR DATE",
      "MRR No.",
      "Our Reel No.",
      "ERP",
      "Suppliers Name",
      "GSM",
      "SIZE",
      "BF",
      "ISSUED DATE",
      "ISSUED WEIGHT",
      "RETURNED DATE",
      "RETURNED WEIGHT",
      "Available Weight",
      "MRR QTY",
      "AGE(D days)",
    ]],
    body: rows.map((row, index) => [
      index + 1,
      formatReportDate(row.mrrDate),
      row.mrrNo,
      row.ourReelNo,
      row.erp,
      row.supplierName,
      row.gsm || "",
      row.size || "",
      row.bf || "",
      formatReportDate(row.issuedDate),
      row.issuedWeight.toFixed(2),
      formatReportDate(row.returnedDate),
      row.returnedWeight.toFixed(2),
      row.availableWeight.toFixed(2),
      row.mrrQty.toFixed(2),
      row.ageDays,
    ]),
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 7, cellPadding: 1.8, textColor: 0 },
  });

  return doc;
}

export function ReelwiseStockReport() {
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [suppliers] = useData<Supplier>("suppliers", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [stockYetToIssueOnly, setStockYetToIssueOnly] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");

  const rows = useMemo<ReelwiseStockRow[]>(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const issueMap = new Map(materialIssues.map((entry) => [entry.id, entry]));
    const returnMap = new Map(materialReturns.map((entry) => [entry.id, entry]));

    return packingSlips
      .map((slip) => {
        const material = materialMap.get(slip.materialId);
        const receipt = materialInMap.get(slip.materialInId);
        const supplier = receipt ? supplierMap.get(receipt.supplierId) : undefined;
        const relatedIssueLines = issueReelLines.filter((line) => line.packingSlipId === slip.id);
        const relatedReturnLines = returnReelLines.filter((line) => line.packingSlipId === slip.id);

        const issuedWeight = relatedIssueLines.reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
        const returnedWeight = relatedReturnLines.reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
        const mrrQty = Number(slip.weightKg || 0);
        const availableWeight = Number(Math.max(0, mrrQty - issuedWeight - returnedWeight).toFixed(2));

        const issueDates = relatedIssueLines
          .map((line) => issueMap.get(line.materialIssueId)?.date || "")
          .filter(Boolean)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        const returnDates = relatedReturnLines
          .map((line) => returnMap.get(line.materialReturnId)?.date || "")
          .filter(Boolean)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

        return {
          slipId: slip.id,
          mrrDate: receipt?.date || "",
          mrrNo: receipt?.transactionNo || "",
          ourReelNo: slip.ourReelNo || "",
          erp: String(material?.erpCode || ""),
          supplierName: supplier?.name || "",
          gsm: Number(material?.gsm || 0),
          size: Number(material?.size || 0),
          bf: Number(material?.bf || 0),
          issuedDate: issueDates[0] || "",
          issuedWeight: Number(issuedWeight.toFixed(2)),
          returnedDate: returnDates[0] || "",
          returnedWeight: Number(returnedWeight.toFixed(2)),
          availableWeight,
          mrrQty,
          ageDays: getAgeDays(receipt?.date),
        };
      })
      .filter((row) => {
        const loweredSearch = searchTerm.trim().toLowerCase();
        if (
          loweredSearch &&
          ![
            row.ourReelNo,
            row.erp,
            row.supplierName,
          ].some((value) => value.toLowerCase().includes(loweredSearch))
        ) {
          return false;
        }

        if (availabilityFilter === "gt500" && row.availableWeight <= 500) return false;
        if (availabilityFilter === "lt500" && row.availableWeight >= 500) return false;
        if (stockYetToIssueOnly && !(row.issuedWeight === 0 && row.availableWeight > 0)) return false;

        const minAgeNumber = Number(minAge || 0);
        const maxAgeNumber = Number(maxAge || 0);
        if (minAge && row.ageDays < minAgeNumber) return false;
        if (maxAge && row.ageDays > maxAgeNumber) return false;

        return true;
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.mrrDate || 0).getTime() - new Date(a.mrrDate || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.ourReelNo.localeCompare(b.ourReelNo);
      });
  }, [
    availabilityFilter,
    issueReelLines,
    materialIn,
    materialIssues,
    materialReturns,
    materials,
    maxAge,
    minAge,
    packingSlips,
    returnReelLines,
    searchTerm,
    stockYetToIssueOnly,
    suppliers,
  ]);

  const summary = useMemo(() => {
    const notIssuedRows = rows.filter((row) => row.issuedWeight === 0 && row.availableWeight > 0);
    return {
      reelNotIssuedWeight: notIssuedRows.reduce((sum, row) => sum + row.availableWeight, 0),
      reelIssuedWeight: rows.reduce((sum, row) => sum + row.issuedWeight, 0),
      erpNotIssuedCount: new Set(notIssuedRows.map((row) => row.erp).filter(Boolean)).size,
    };
  }, [rows]);

  const handleClearFilters = () => {
    setSearchTerm("");
    setAvailabilityFilter("all");
    setStockYetToIssueOnly(false);
    setMinAge("");
    setMaxAge("");
  };

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(
      rows.map((row, index) => ({
        "SL No": index + 1,
        "MRR DATE": formatReportDate(row.mrrDate),
        "MRR No.": row.mrrNo,
        "Our Reel No.": row.ourReelNo,
        ERP: row.erp,
        "Suppliers Name": row.supplierName,
        GSM: row.gsm,
        SIZE: row.size,
        BF: row.bf,
        "ISSUED DATE": formatReportDate(row.issuedDate),
        "ISSUED WEIGHT": row.issuedWeight,
        "RETURNED DATE": formatReportDate(row.returnedDate),
        "RETURNED WEIGHT": row.returnedWeight,
        "Available Weight": row.availableWeight,
        "MRR QTY": row.mrrQty,
        "AGE(D days)": row.ageDays,
      }))
    );
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reelwise Stock");
    XLSX.writeFile(workbook, "Reelwise_Stock_Report.xlsx");
  };

  const handleDownloadPdf = () => {
    buildReelwisePdf(rows).save(`Reelwise_Stock_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleSendPdf = async () => {
    const doc = buildReelwisePdf(rows);
    const blob = doc.output("blob");
    const file = new File([blob], `Reelwise_Stock_Report_${new Date().toISOString().slice(0, 10)}.pdf`, {
      type: "application/pdf",
    });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Reelwise Stock Report",
        text: "Sharing reelwise stock report.",
      });
      return;
    }

    doc.save(file.name);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">
              <ArrowUpDown size={14} />
              Reports
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Reelwise Stock Report</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Reel-by-reel stock position using MRR receipts, job issues, returns, and ageing.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[540px]">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Reels Not Issued</div>
              <div className="mt-2 text-2xl font-black text-emerald-950">{summary.reelNotIssuedWeight.toFixed(2)}</div>
              <div className="text-xs font-medium text-emerald-700">Available weight</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Reels Issued</div>
              <div className="mt-2 text-2xl font-black text-amber-950">{summary.reelIssuedWeight.toFixed(2)}</div>
              <div className="text-xs font-medium text-amber-700">Issued weight</div>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">ERP Not Issued</div>
              <div className="mt-2 text-2xl font-black text-violet-950">{summary.erpNotIssuedCount}</div>
              <div className="text-xs font-medium text-violet-700">Unique ERPs</div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.5fr)_repeat(4,minmax(140px,0.8fr))]">
              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <Search size={14} />
                  Search
                </span>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <Search size={16} className="text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Reel / ERP / Supplier"
                    className="w-full border-0 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                  />
                </div>
              </label>

              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <Filter size={14} />
                  Available Wt
                </span>
                <div className="flex h-[52px] flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  {[
                    { label: "All", value: "all" as const },
                    { label: "> 500", value: "gt500" as const },
                    { label: "< 500", value: "lt500" as const },
                  ].map((option) => (
                    <label key={option.value} className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-600">
                      <input
                        type="radio"
                        name="availabilityFilter"
                        value={option.value}
                        checked={availabilityFilter === option.value}
                        onChange={() => setAvailabilityFilter(option.value)}
                        className="hidden"
                      />
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${availabilityFilter === option.value ? "border-sky-600 bg-sky-600" : "border-slate-300 bg-white"}`}>
                        {availabilityFilter === option.value ? <Circle size={8} className="fill-white text-white" /> : null}
                      </span>
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Age &gt;=</span>
                <input
                  type="number"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  placeholder="Min days"
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Age &lt;=</span>
                <input
                  type="number"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder="Max days"
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Stock Mode</span>
                <div className="flex h-[52px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
                  <label className="inline-flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={stockYetToIssueOnly}
                      onChange={(e) => setStockYetToIssueOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    Stock yet to issue
                  </label>
                </div>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex h-[52px] items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-white px-5 text-sm font-bold text-sky-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-50"
              >
                <Download size={16} />
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 text-sm font-bold text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <Download size={16} />
                Download Excel
              </button>
              <button
                type="button"
                onClick={handleSendPdf}
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-sky-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700"
              >
                <Mail size={16} />
                Send PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-sm font-bold text-slate-900">{rows.length} reel rows</div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            Reel-level receipt, issue, return, and ageing position
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-950 text-white">
                {[
                  "SL No",
                  "MRR DATE",
                  "MRR No.",
                  "Our Reel No.",
                  "ERP",
                  "Suppliers Name",
                  "GSM",
                  "SIZE",
                  "BF",
                  "ISSUED DATE",
                  "ISSUED WEIGHT",
                  "RETURNED DATE",
                  "RETURNED WEIGHT",
                  "Available Weight",
                  "MRR QTY",
                  "AGE(D days)",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="whitespace-nowrap border-b border-slate-800 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em]"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                    No reel rows match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.slipId} className="border-b border-slate-100 text-sm text-slate-700 transition hover:bg-sky-50/40">
                    <td className="px-4 py-3 font-bold text-slate-900">{index + 1}</td>
                    <td className="px-4 py-3">{formatReportDate(row.mrrDate)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.mrrNo}</td>
                    <td className="px-4 py-3 font-bold text-slate-900">{row.ourReelNo}</td>
                    <td className="px-4 py-3">{row.erp}</td>
                    <td className="px-4 py-3 min-w-[220px]">{row.supplierName}</td>
                    <td className="px-4 py-3">{row.gsm || ""}</td>
                    <td className="px-4 py-3">{row.size || ""}</td>
                    <td className="px-4 py-3">{row.bf || ""}</td>
                    <td className="px-4 py-3">{formatReportDate(row.issuedDate)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-700">{row.issuedWeight.toFixed(2)}</td>
                    <td className="px-4 py-3">{formatReportDate(row.returnedDate)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-700">{row.returnedWeight.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-black text-emerald-700">{row.availableWeight.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{row.mrrQty.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{row.ageDays}</td>
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
