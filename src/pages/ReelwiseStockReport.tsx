import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Search, FileText, Download } from "lucide-react";
import { Select } from "../components/Select";
import { ExcelExport } from "../components/ExcelExport";
import { useData } from "../hooks/useData";
import { downloadMrrReelLabelsPdf } from "../lib/mrrReelLabelsPdf";
import {
  Company,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  Setting,
  Supplier,
} from "../types";
import { buildReelStockRows, type ReelStockCalculationRow } from "../lib/reelStock";

type AvailabilityFilter = "all" | "gt500" | "lt500";
type ReelwiseStockRow = ReelStockCalculationRow;

const tableColumns = [
  "SL No",
  "MRR No.",
  "Our Reel No.",
  "ERP",
  "Suppliers Name",
  "GSM",
  "Size",
  "BF",
  "Opening Qty",
  "MRR Qty",
  "Issued",
  "Return",
  "Net Issued",
  "Available Weight",
  "Rate",
  "Valuation",
  "Age(D days)",
  "Download",
];

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

function makeOptions(values: Array<string | number>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
}

function safeFileName(value: string) {
  return String(value || "Reelwise_Stock_Report")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "Reelwise_Stock_Report";
}

export function ReelwiseStockReport() {
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", [], { cacheToLocalStorage: false });
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [suppliers] = useData<Supplier>("suppliers", [], { cacheToLocalStorage: false });
  const [companies] = useData<Company>("companies", [], { cacheToLocalStorage: false });
  const [settings] = useData<Setting>("settings", [], { cacheToLocalStorage: false });

  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [stockYetToIssueOnly, setStockYetToIssueOnly] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [mrrDateFrom, setMrrDateFrom] = useState("");
  const [mrrDateTo, setMrrDateTo] = useState("");
  const [excludeZeroAvailable, setExcludeZeroAvailable] = useState(false);
  const [mrrFilter, setMrrFilter] = useState("");
  const [erpFilter, setErpFilter] = useState("");
  const [gsmFilter, setGsmFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [bfFilter, setBfFilter] = useState("");

  const allRows = useMemo<ReelwiseStockRow[]>(() => {
    return buildReelStockRows({
      materials,
      materialIn,
      packingSlips,
      issueReelLines,
      returnReelLines,
      suppliers,
    });
  }, [issueReelLines, materialIn, materials, packingSlips, returnReelLines, suppliers]);

  const mrrOptions = useMemo(() => makeOptions(allRows.map((row) => row.mrrNo)), [allRows]);
  const erpOptions = useMemo(() => makeOptions(allRows.map((row) => row.erp)), [allRows]);
  const gsmOptions = useMemo(() => makeOptions(allRows.map((row) => row.gsm || "")), [allRows]);
  const sizeOptions = useMemo(() => makeOptions(allRows.map((row) => row.size || "")), [allRows]);
  const bfOptions = useMemo(() => makeOptions(allRows.map((row) => row.bf || "")), [allRows]);

  const rows = useMemo<ReelwiseStockRow[]>(() => {
    const loweredSearch = searchTerm.trim().toLowerCase();
    const minAgeNumber = Number(minAge || 0);
    const maxAgeNumber = Number(maxAge || 0);
    const fromMs = mrrDateFrom ? new Date(mrrDateFrom).getTime() : null;
    const toMs = mrrDateTo ? new Date(mrrDateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    return allRows.filter((row) => {
      if (
        loweredSearch &&
        ![
          row.ourReelNo,
          row.erp,
          row.supplierName,
          row.mrrNo,
          row.gsm,
          row.size,
          row.bf,
        ].some((value) => String(value || "").toLowerCase().includes(loweredSearch))
      ) {
        return false;
      }

      if (mrrFilter && row.mrrNo !== mrrFilter) return false;
      if (availabilityFilter === "gt500" && row.availableWeight <= 500) return false;
      if (availabilityFilter === "lt500" && row.availableWeight >= 500) return false;
      if (stockYetToIssueOnly && !(row.issuedWeight === 0 && row.availableWeight > 0)) return false;
      if (excludeZeroAvailable && row.availableWeight <= 0) return false;
      if (fromMs != null && new Date(row.mrrDate || 0).getTime() < fromMs) return false;
      if (toMs != null && new Date(row.mrrDate || 0).getTime() > toMs) return false;
      if (minAge && row.ageDays < minAgeNumber) return false;
      if (maxAge && row.ageDays > maxAgeNumber) return false;
      if (erpFilter && row.erp !== erpFilter) return false;
      if (gsmFilter && String(row.gsm) !== gsmFilter) return false;
      if (sizeFilter && String(row.size) !== sizeFilter) return false;
      if (bfFilter && String(row.bf) !== bfFilter) return false;

      return true;
    }).sort((a, b) => {
      const availabilityDiff = Number(a.availableWeight <= 0) - Number(b.availableWeight <= 0);
      if (availabilityDiff !== 0) return availabilityDiff;
      const dateDiff = new Date(b.mrrDate || 0).getTime() - new Date(a.mrrDate || 0).getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.ourReelNo.localeCompare(b.ourReelNo);
    });
  }, [allRows, availabilityFilter, bfFilter, erpFilter, excludeZeroAvailable, gsmFilter, maxAge, minAge, mrrDateFrom, mrrDateTo, mrrFilter, searchTerm, sizeFilter, stockYetToIssueOnly]);

  const summary = useMemo(() => {
    return {
      totalAvailableStock: rows.reduce((sum, row) => sum + row.availableWeight, 0),
      totalReels: rows.filter((row) => row.availableWeight > 0).length,
      totalValuation: rows.reduce((sum, row) => sum + row.valuation, 0),
      totalMrrQty: rows.reduce((sum, row) => sum + row.mrrQty, 0),
      totalOpeningQty: rows.reduce((sum, row) => sum + row.openingQty, 0),
      totalIssued: rows.reduce((sum, row) => sum + row.issuedWeight, 0),
      totalReturned: rows.reduce((sum, row) => sum + row.returnedWeight, 0),
      totalNetIssued: rows.reduce((sum, row) => sum + row.netIssuedWeight, 0),
    };
  }, [rows]);


  const hasActiveFilters = Boolean(
    searchTerm ||
    availabilityFilter !== "all" ||
    stockYetToIssueOnly ||
    minAge ||
    maxAge ||
    mrrDateFrom ||
    mrrDateTo ||
    mrrFilter ||
    excludeZeroAvailable ||
    erpFilter ||
    gsmFilter ||
    sizeFilter ||
    bfFilter
  );

  const handleClearFilters = () => {
    setSearchTerm("");
    setAvailabilityFilter("all");
    setStockYetToIssueOnly(false);
    setMinAge("");
    setMaxAge("");
    setMrrDateFrom("");
    setMrrDateTo("");
    setMrrFilter("");
    setExcludeZeroAvailable(false);
    setErpFilter("");
    setGsmFilter("");
    setSizeFilter("");
    setBfFilter("");
  };


  const excelRows = useMemo(
    () => rows.map((row, index) => ({
      "SL No": index + 1,
      "MRR No.": row.mrrNo,
      "Our Reel No.": row.ourReelNo,
      ERP: row.erp,
      "Suppliers Name": row.supplierName || "-",
      GSM: row.gsm || "",
      Size: row.size || "",
      BF: row.bf || "",
      "Opening Qty": Number(formatQty(row.openingQty)),
      "MRR Qty": Number(formatQty(row.mrrQty)),
      Issued: Number(formatQty(row.issuedWeight)),
      Return: Number(formatQty(row.returnedWeight)),
      "Net Issued": Number(formatQty(row.netIssuedWeight)),
      "Available Weight": Number(formatQty(row.availableWeight)),
      Rate: Number(formatQty(row.rate)),
      Valuation: Number(formatQty(row.valuation)),
      "Age(D days)": row.ageDays,
    })),
    [rows]
  );
  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Reelwise Stock Report", 14, 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString("en-GB")}`, 14, 20);
    doc.text(`Rows: ${rows.length}`, 270, 20, { align: "right" });

    autoTable(doc, {
      startY: 24,
      theme: "grid",
      headStyles: { fillColor: [67, 56, 202] },
      styles: { fontSize: 7.4, cellPadding: 1.6, lineColor: [0, 0, 0], lineWidth: 0.1 },
      head: [[
        "SL No",
        "MRR No.",
        "Our Reel No.",
        "ERP",
        "Supplier",
        "GSM",
        "Size",
        "BF",
        "Opening Qty",
        "MRR Qty",
        "Issued",
        "Return",
        "Net Issued",
        "Available Weight",
        "Rate",
        "Valuation",
        "Age(D days)",
      ]],
      body: rows.map((row, index) => [
        String(index + 1),
        row.mrrNo,
        row.ourReelNo,
        row.erp,
        row.supplierName || "-",
        String(row.gsm || ""),
        String(row.size || ""),
        String(row.bf || ""),
        formatQty(row.openingQty),
        formatQty(row.mrrQty),
        formatQty(row.issuedWeight),
        formatQty(row.returnedWeight),
        formatQty(row.netIssuedWeight),
        formatQty(row.availableWeight),
        formatQty(row.rate),
        formatQty(row.valuation),
        String(row.ageDays),
      ]),
      columnStyles: {
        0: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
        10: { halign: "right" },
        11: { halign: "right" },
        12: { halign: "right" },
        13: { halign: "right" },
        14: { halign: "right" },
        15: { halign: "right" },
        16: { halign: "right" },
      },
    });

    const fileDate = new Date().toISOString().slice(0, 10);
    doc.save(`${safeFileName(`Reelwise_Stock_Report_${fileDate}`)}.pdf`);
  };

  const handleExportRowPdf = async (row: ReelwiseStockRow) => {
    if (row.isOpening) {
      alert("QR label PDF is available only for MRR reel rows.");
      return;
    }

    const slip = packingSlips.find((entry) => entry.id === row.slipId);
    if (!slip) {
      alert("Packing slip not found for this reel.");
      return;
    }

    const mrr = materialIn.find((entry) => entry.id === slip.materialInId);
    if (!mrr) {
      alert("MRR not found for this reel.");
      return;
    }

    try {
      const qrPayload = JSON.stringify({
        reelNo: row.ourReelNo,
        weight: Number(row.availableWeight || 0).toFixed(2),
      });

      await downloadMrrReelLabelsPdf({
        mrr,
        packingSlips: [slip],
        materials,
        suppliers,
        companies,
        setting: settings[0] || null,
        paperSize: "A4",
        qrPayloadByPackingSlipId: {
          [slip.id]: qrPayload,
        },
        weightKgByPackingSlipId: {
          [slip.id]: Number(row.availableWeight || 0),
        },
      });
    } catch (error) {
      console.error("Failed to generate reel QR label PDF", error);
      alert(error instanceof Error ? error.message : "Failed to generate reel QR label PDF.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-black pb-3">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Reelwise Stock Report</h2>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Total Available Stock</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{formatQty(summary.totalAvailableStock)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Total Reels</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{summary.totalReels}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Total Valuation</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{formatQty(summary.totalValuation)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-2">
        <div className="grid gap-2">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_150px_170px_105px_130px_105px]">
            <div className="relative w-full min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search reel / ERP / supplier / MRR / size / GSM / BF"
                className="h-[34px] w-full rounded border-2 border-black pl-8 pr-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>
            <div className="min-w-0"><Select compact value={mrrFilter} onChange={setMrrFilter} options={mrrOptions} placeholder="All MRR" /></div>
            <div className="min-w-0"><Select compact value={erpFilter} onChange={setErpFilter} options={erpOptions} placeholder="All ERP" /></div>
            <div className="min-w-0"><Select compact value={gsmFilter} onChange={setGsmFilter} options={gsmOptions} placeholder="All GSM" /></div>
            <div className="min-w-0"><Select compact value={sizeFilter} onChange={setSizeFilter} options={sizeOptions} placeholder="All Size" /></div>
            <div className="min-w-0"><Select compact value={bfFilter} onChange={setBfFilter} options={bfOptions} placeholder="All BF" /></div>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[130px_130px_90px_90px_150px_145px_155px_90px] xl:items-center">
            <input
              type="date"
              value={mrrDateFrom}
              onChange={(e) => setMrrDateFrom(e.target.value)}
              title="MRR Date From"
              className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
            <input
              type="date"
              value={mrrDateTo}
              onChange={(e) => setMrrDateTo(e.target.value)}
              title="MRR Date To"
              className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
            <input
              type="number"
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
              placeholder="Min age"
              className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
            <input
              type="number"
              value={maxAge}
              onChange={(e) => setMaxAge(e.target.value)}
              placeholder="Max age"
              className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
            <div className="grid h-[34px] grid-cols-3 gap-1 rounded border-2 border-black bg-white p-1">
              {[
                { label: "All", value: "all" as const },
                { label: "> 500", value: "gt500" as const },
                { label: "< 500", value: "lt500" as const },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAvailabilityFilter(option.value)}
                  className={`rounded px-1 text-[11px] font-black ${availabilityFilter === option.value ? "bg-indigo-600 text-white" : "bg-slate-50 text-black hover:bg-slate-100"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="inline-flex h-[34px] min-w-0 items-center gap-1.5 rounded border-2 border-black bg-white px-2 text-[10px] font-black uppercase leading-tight text-black">
              <input
                type="checkbox"
                checked={stockYetToIssueOnly}
                onChange={(e) => setStockYetToIssueOnly(e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
              />
              <span className="truncate">Stock yet to issue</span>
            </label>
            <label className="inline-flex h-[34px] min-w-0 items-center gap-1.5 rounded border-2 border-black bg-white px-2 text-[10px] font-black uppercase leading-tight text-black">
              <input
                type="checkbox"
                checked={excludeZeroAvailable}
                onChange={(e) => setExcludeZeroAvailable(e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
              />
              <span className="truncate">Exclude 0 Available</span>
            </label>
            <div className="flex items-center gap-2">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="h-[34px] rounded border border-black bg-white px-2 text-[11px] font-bold text-black hover:bg-slate-50"
                >
                  Clear
                </button>
              ) : (
                <div className="hidden xl:block" />
              )}
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex h-[34px] items-center gap-1.5 rounded border border-rose-700 bg-rose-50 px-2.5 text-[11px] font-bold text-rose-800 hover:bg-rose-100"
              >
                <FileText size={13} />
                PDF
              </button>
              <ExcelExport data={excelRows} fileName="Reelwise_Stock_Report" sheetName="Reelwise Stock" className="h-[34px] px-2.5 py-0 text-[11px]" />
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white rounded shadow-sm border-2 border-black overflow-hidden">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {tableColumns.map((heading) => (
                  <th key={heading} className="bg-indigo-700 px-3 py-3 text-left text-xs font-black border-2 border-black whitespace-nowrap uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
              {rows.length > 0 ? (
                <tr className="bg-slate-100 text-black">
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100" colSpan={8}>TOTAL ({rows.length})</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-blue-100 text-blue-900">{formatQty(summary.totalOpeningQty)}</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-purple-100 text-purple-900">{formatQty(summary.totalMrrQty)}</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-red-100 text-red-900">-</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-cyan-100 text-cyan-900">-</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-slate-100">{formatQty(summary.totalNetIssued)}</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-emerald-100 text-emerald-900">{formatQty(summary.totalAvailableStock)}</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-slate-100">-</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-purple-100 text-purple-900">{formatQty(summary.totalValuation)}</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-slate-100">-</th>
                  <th className="px-3 py-3 text-right text-sm font-black border-2 border-black bg-slate-100">-</th>
                </tr>
              ) : null}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={tableColumns.length} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                    No reel rows match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.slipId} className="hover:bg-slate-50">
                    <td className="px-3 py-3 text-black text-sm border-2 border-black font-bold">{index + 1}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black font-bold">{row.mrrNo}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black font-bold">{row.ourReelNo}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.erp}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black min-w-[220px]">{row.supplierName || "-"}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.gsm || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.size || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.bf || ""}</td>
                    <td className="px-3 py-3 text-blue-900 text-sm font-bold border-2 border-black bg-blue-50 text-right">{formatQty(row.openingQty)}</td>
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50 text-right">{formatQty(row.mrrQty)}</td>
                    <td className="px-3 py-3 text-red-800 text-sm border-2 border-black bg-red-50/40 text-right">{formatQty(row.issuedWeight)}</td>
                    <td className="px-3 py-3 text-cyan-900 text-sm border-2 border-black bg-cyan-50/50 text-right">{formatQty(row.returnedWeight)}</td>
                    <td className="px-3 py-3 text-slate-900 text-sm font-bold border-2 border-black bg-slate-50 text-right">{formatQty(row.netIssuedWeight)}</td>
                    <td className="px-3 py-3 text-emerald-900 text-sm font-bold border-2 border-black bg-emerald-50 text-right">{formatQty(row.availableWeight)}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black text-right">{formatQty(row.rate)}</td>
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50 text-right">{formatQty(row.valuation)}</td>
                    <td className="px-3 py-3 text-amber-900 text-sm border-2 border-black bg-amber-50 text-right">{row.ageDays}</td>
                    <td className="px-2 py-2 text-center border-2 border-black bg-white">
                      <button
                        type="button"
                        onClick={() => handleExportRowPdf(row)}
                        className="inline-flex items-center gap-1 rounded border border-indigo-700 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100"
                        title="Download reel QR label PDF"
                      >
                        <Download size={12} />
                        QR PDF
                      </button>
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
