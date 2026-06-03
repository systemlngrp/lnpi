import React, { useMemo, useState } from "react";
import {
  ArrowUpDown,
  Circle,
  Filter,
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
    const receivedByMaterial = packingSlips.reduce<Map<string, number>>((acc, slip) => {
      acc.set(slip.materialId, (acc.get(slip.materialId) || 0) + Number(slip.weightKg || 0));
      return acc;
    }, new Map());

    return packingSlips
      .map((slip) => {
        const material = materialMap.get(slip.materialId);
        const receipt = materialInMap.get(slip.materialInId);
        const supplier = receipt ? supplierMap.get(receipt.supplierId) : undefined;
        const relatedIssueLines = issueReelLines.filter((line) => line.packingSlipId === slip.id);
        const relatedReturnLines = returnReelLines.filter((line) => line.packingSlipId === slip.id);

        const issuedWeight = relatedIssueLines.reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
        const returnedWeight = relatedReturnLines.reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
        const openingBalance = Math.max(0, Number(material?.openingQty || 0) - Number(receivedByMaterial.get(slip.materialId) || 0));
        const reelQty = Number(slip.weightKg || 0);
        const mrrQty = Number((openingBalance + reelQty).toFixed(2));
        const availableWeight = Number(Math.max(0, mrrQty - issuedWeight + returnedWeight).toFixed(2));

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

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[32px] border border-slate-200/90 bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28)]">
        <div className="relative px-5 py-5 md:px-7 md:py-6">
          <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_38%),linear-gradient(180deg,_rgba(248,250,252,0.95),_rgba(255,255,255,0))]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">
              <ArrowUpDown size={14} />
              Reports
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-black tracking-tight text-slate-950 md:text-[2rem]">Reelwise Stock Report</h2>
                <p className="max-w-2xl text-sm font-medium leading-6 text-slate-600 md:text-[15px]">
                  Track reel-by-reel stock with a cleaner operational view across receipts, issues, returns, and ageing so dispatch and stores teams can act faster.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                  Live stock lens
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                  Age-based filtering
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                  Reel-level traceability
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[600px]">
              <div className="rounded-[24px] border border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,1),rgba(240,253,250,0.86))] px-4 py-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Reels Not Issued</div>
                <div className="mt-3 text-4xl font-black tracking-tight text-emerald-950">{summary.reelNotIssuedWeight.toFixed(2)}</div>
                <div className="mt-1 text-xs font-semibold text-emerald-700">Available weight</div>
              </div>
              <div className="rounded-[24px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,1),rgba(255,247,237,0.9))] px-4 py-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Reels Issued</div>
                <div className="mt-3 text-4xl font-black tracking-tight text-amber-950">{summary.reelIssuedWeight.toFixed(2)}</div>
                <div className="mt-1 text-xs font-semibold text-amber-700">Issued weight</div>
              </div>
              <div className="rounded-[24px] border border-violet-200 bg-[linear-gradient(135deg,rgba(245,243,255,1),rgba(250,245,255,0.92))] px-4 py-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">ERP Not Issued</div>
                <div className="mt-3 text-4xl font-black tracking-tight text-violet-950">{summary.erpNotIssuedCount}</div>
                <div className="mt-1 text-xs font-semibold text-violet-700">Unique ERPs</div>
              </div>
            </div>
          </div>

          <div className="relative mt-6 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.86),rgba(255,255,255,1))] p-4 md:p-5">
            <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Filter Console</div>
                <div className="mt-1 text-sm font-semibold text-slate-700">Refine the reel ledger by stock position, ageing, and issue state.</div>
              </div>
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
              >
                Clear Filters
              </button>
            </div>

            <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(320px,1.5fr)_minmax(220px,1fr)_minmax(160px,0.7fr)_minmax(160px,0.7fr)_minmax(220px,1fr)]">
              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <Search size={14} />
                  Search
                </span>
                <div className="flex h-[56px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100">
                  <Search size={16} className="text-sky-500" />
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
                <div className="grid min-h-[56px] grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  {[
                    { label: "All", value: "all" as const },
                    { label: "> 500", value: "gt500" as const },
                    { label: "< 500", value: "lt500" as const },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${
                        availabilityFilter === option.value
                          ? "bg-sky-600 text-white shadow-sm"
                          : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <input
                        type="radio"
                        name="availabilityFilter"
                        value={option.value}
                        checked={availabilityFilter === option.value}
                        onChange={() => setAvailabilityFilter(option.value)}
                        className="hidden"
                      />
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${availabilityFilter === option.value ? "border-white/70 bg-white/15" : "border-slate-300 bg-white"}`}>
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
                  className="h-[56px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </label>

              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Age &lt;=</span>
                <input
                  type="number"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder="Max days"
                  className="h-[56px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </label>

              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Stock Mode</span>
                <div className="flex h-[56px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
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
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_45px_-30px_rgba(15,23,42,0.34)]">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">{rows.length} reel rows</div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            Reel-level receipt, issue, return, and ageing position
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Available: {summary.reelNotIssuedWeight.toFixed(2)} | Issued: {summary.reelIssuedWeight.toFixed(2)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-[linear-gradient(90deg,#020617,#0f172a,#111827)] text-white">
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
                  <tr key={row.slipId} className="border-b border-slate-100 text-sm text-slate-700 transition hover:bg-sky-50/50">
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
