import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
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
  "MRR Qty",
  "Issued",
  "Return",
  "Net Issued",
  "Available Weight",
  "Rate",
  "Valuation",
  "Age(D days)",
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

export function ReelwiseStockReport() {
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", [], { cacheToLocalStorage: false });
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [suppliers] = useData<Supplier>("suppliers", [], { cacheToLocalStorage: false });

  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [stockYetToIssueOnly, setStockYetToIssueOnly] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [mrrDateFrom, setMrrDateFrom] = useState("");
  const [mrrDateTo, setMrrDateTo] = useState("");
  const [excludeZeroAvailable, setExcludeZeroAvailable] = useState(false);
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
  }, [allRows, availabilityFilter, bfFilter, erpFilter, excludeZeroAvailable, gsmFilter, maxAge, minAge, mrrDateFrom, mrrDateTo, searchTerm, sizeFilter, stockYetToIssueOnly]);

  const summary = useMemo(() => {
    return {
      totalAvailableStock: rows.reduce((sum, row) => sum + row.availableWeight, 0),
      totalReels: rows.filter((row) => row.availableWeight > 0).length,
      totalValuation: rows.reduce((sum, row) => sum + row.valuation, 0),
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
    setExcludeZeroAvailable(false);
    setErpFilter("");
    setGsmFilter("");
    setSizeFilter("");
    setBfFilter("");
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
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_170px_105px_130px_105px]">
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
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50 text-right">{formatQty(row.mrrQty)}</td>
                    <td className="px-3 py-3 text-red-800 text-sm border-2 border-black bg-red-50/40 text-right">{formatQty(row.issuedWeight)}</td>
                    <td className="px-3 py-3 text-cyan-900 text-sm border-2 border-black bg-cyan-50/50 text-right">{formatQty(row.returnedWeight)}</td>
                    <td className="px-3 py-3 text-slate-900 text-sm font-bold border-2 border-black bg-slate-50 text-right">{formatQty(row.netIssuedWeight)}</td>
                    <td className="px-3 py-3 text-emerald-900 text-sm font-bold border-2 border-black bg-emerald-50 text-right">{formatQty(row.availableWeight)}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black text-right">{formatQty(row.rate)}</td>
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50 text-right">{formatQty(row.valuation)}</td>
                    <td className="px-3 py-3 text-amber-900 text-sm border-2 border-black bg-amber-50 text-right">{row.ageDays}</td>
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
