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
  issuedWeight: number;
  returnedWeight: number;
  netIssuedWeight: number;
  availableWeight: number;
  mrrQty: number;
  rate: number;
  valuation: number;
  ageDays: number;
};

const tableColumns = [
  "SL No",
  "MRR Date",
  "MRR No.",
  "Our Reel No.",
  "ERP",
  "Suppliers Name",
  "GSM",
  "Size",
  "BF",
  "Issued",
  "Return",
  "Net Issued",
  "Available Weight",
  "MRR Qty",
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

function getAgeDays(dateStr?: string) {
  if (!dateStr) return 0;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
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
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [suppliers] = useData<Supplier>("suppliers", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [stockYetToIssueOnly, setStockYetToIssueOnly] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [erpFilter, setErpFilter] = useState("");
  const [gsmFilter, setGsmFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [bfFilter, setBfFilter] = useState("");

  const allRows = useMemo<ReelwiseStockRow[]>(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const latestMaterialIn = [...materialIn].sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
      return timeB - timeA;
    });
    const latestRateByMaterial = new Map<string, number>();
    latestMaterialIn.forEach((entry) => {
      entry.lines.forEach((line) => {
        if (!latestRateByMaterial.has(line.itemId)) {
          latestRateByMaterial.set(line.itemId, Number(line.invoiceRate ?? line.rate ?? 0));
        }
      });
    });
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
        const netIssuedWeight = Number((issuedWeight - returnedWeight).toFixed(2));
        const availableWeight = Number(Math.max(0, mrrQty - netIssuedWeight).toFixed(2));
        const latestRate = Number(latestRateByMaterial.get(slip.materialId) ?? material?.openingRate ?? 0);
        const rate = availableWeight > 0 ? Number(latestRate.toFixed(2)) : 0;
        const valuation = availableWeight > 0 ? Number((availableWeight * latestRate).toFixed(2)) : 0;

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
          issuedWeight: Number(issuedWeight.toFixed(2)),
          returnedWeight: Number(returnedWeight.toFixed(2)),
          netIssuedWeight,
          availableWeight,
          mrrQty,
          rate,
          valuation,
          ageDays: getAgeDays(receipt?.date),
        };
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.mrrDate || 0).getTime() - new Date(a.mrrDate || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.ourReelNo.localeCompare(b.ourReelNo);
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
  }, [allRows, availabilityFilter, bfFilter, erpFilter, gsmFilter, maxAge, minAge, searchTerm, sizeFilter, stockYetToIssueOnly]);

  const summary = useMemo(() => {
    return {
      totalStock: rows.reduce((sum, row) => sum + row.mrrQty, 0),
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

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Stock</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{formatQty(summary.totalStock)}</div>
        </div>
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

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[minmax(260px,1.4fr)_repeat(4,minmax(140px,1fr))_repeat(2,minmax(110px,0.8fr))_minmax(180px,1fr)_auto] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search reel / ERP / supplier / MRR / size / GSM / BF"
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <Select value={erpFilter} onChange={setErpFilter} options={erpOptions} placeholder="All ERP" />
          <Select value={gsmFilter} onChange={setGsmFilter} options={gsmOptions} placeholder="All GSM" />
          <Select value={sizeFilter} onChange={setSizeFilter} options={sizeOptions} placeholder="All Size" />
          <Select value={bfFilter} onChange={setBfFilter} options={bfOptions} placeholder="All BF" />
          <input
            type="number"
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
            placeholder="Min age"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="number"
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            placeholder="Max age"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          <div className="grid grid-cols-3 gap-1 rounded border-2 border-black bg-white p-1">
            {[
              { label: "All", value: "all" as const },
              { label: "> 500", value: "gt500" as const },
              { label: "< 500", value: "lt500" as const },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setAvailabilityFilter(option.value)}
                className={`rounded px-2 py-2 text-xs font-black ${availabilityFilter === option.value ? "bg-indigo-600 text-white" : "bg-slate-50 text-black hover:bg-slate-100"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="inline-flex min-h-[42px] items-center gap-2 rounded border-2 border-black bg-white px-3 text-xs font-black uppercase text-black">
            <input
              type="checkbox"
              checked={stockYetToIssueOnly}
              onChange={(e) => setStockYetToIssueOnly(e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Stock yet to issue
          </label>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={handleClearFilters}
              className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
            >
              Clear Filters
            </button>
          ) : null}
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
                  <td colSpan={17} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                    No reel rows match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.slipId} className="hover:bg-slate-50">
                    <td className="px-3 py-3 text-black text-sm border-2 border-black font-bold">{index + 1}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black whitespace-nowrap">{formatReportDate(row.mrrDate)}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black font-bold">{row.mrrNo}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black font-bold">{row.ourReelNo}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.erp}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black min-w-[220px]">{row.supplierName || "-"}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.gsm || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.size || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.bf || ""}</td>
                    <td className="px-3 py-3 text-red-800 text-sm border-2 border-black bg-red-50/40 text-right">{formatQty(row.issuedWeight)}</td>
                    <td className="px-3 py-3 text-cyan-900 text-sm border-2 border-black bg-cyan-50/50 text-right">{formatQty(row.returnedWeight)}</td>
                    <td className="px-3 py-3 text-slate-900 text-sm font-bold border-2 border-black bg-slate-50 text-right">{formatQty(row.netIssuedWeight)}</td>
                    <td className="px-3 py-3 text-emerald-900 text-sm font-bold border-2 border-black bg-emerald-50 text-right">{formatQty(row.availableWeight)}</td>
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50 text-right">{formatQty(row.mrrQty)}</td>
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