import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnReelLine,
  Production,
  ProductionProcessing,
} from "../types";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { formatDate } from "../lib/serial";

type JobsInProgressRow = {
  productionId: string;
  jobNo: string;
  productionDate: string;
  corrugationDate: string;
  erpCode: string;
  plannedQty: number;
  ffgQty: number;
  reelIssued: number;
  reelReturned: number;
  reelConsumed: number;
  consumedValue: number;
};

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
}

function hasFfgValue(production: Production) {
  const value = production.prodFromFFG;
  if (value === null || value === undefined) return false;
  const asString = String(value).trim();
  if (!asString) return false;
  const asNumber = Number(asString);
  return Number.isFinite(asNumber) ? asNumber > 0 : true;
}

function getReelRateForSlip({
  slip,
  materialInMap,
  materialMap,
}: {
  slip?: MaterialInPackingSlip;
  materialInMap: Map<string, MaterialIn>;
  materialMap: Map<string, Material>;
}) {
  if (!slip) return 0;
  const receipt = materialInMap.get(slip.materialInId);
  const line = receipt?.lines.find((entry) => entry.id === slip.materialLineId);
  const material = materialMap.get(slip.materialId);
  return Number(line?.invoiceRate ?? line?.poRate ?? line?.rate ?? material?.openingRate ?? 0);
}

export function JobsInProgressReport() {
  const [productions] = useData<Production>("productions", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minConsumed, setMinConsumed] = useState("");

  const rows = useMemo<JobsInProgressRow[]>(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));
    const issueProductionMap = new Map(
      materialIssues
        .filter((issue) => issue.issueType === "Job" && issue.productionId)
        .map((issue) => [issue.id, issue.productionId as string])
    );
    const returnProductionMap = new Map(
      materialReturns
        .filter((entry) => entry.returnType === "Job" && entry.productionId)
        .map((entry) => [entry.id, entry.productionId as string])
    );

    const corrugationDateMap = new Map<string, string>();
    processing.forEach((entry) => {
      if (!normalizeMachineName(entry.machineName).startsWith("Corrugation")) return;
      const existing = corrugationDateMap.get(entry.productionId);
      if (!existing || new Date(entry.date).getTime() > new Date(existing).getTime()) {
        corrugationDateMap.set(entry.productionId, entry.date);
      }
    });

    const issuedByProduction = new Map<string, { weight: number; value: number }>();
    issueReelLines.forEach((line) => {
      const productionId = line.productionId || issueProductionMap.get(line.materialIssueId);
      if (!productionId) return;
      const current = issuedByProduction.get(productionId) || { weight: 0, value: 0 };
      const slip = packingSlipMap.get(line.packingSlipId);
      const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
      current.weight += Number(line.weightKg || 0);
      current.value += Number(line.weightKg || 0) * rate;
      issuedByProduction.set(productionId, current);
    });

    const returnedByProduction = new Map<string, { weight: number; value: number }>();
    returnReelLines.forEach((line) => {
      const productionId = line.productionId || returnProductionMap.get(line.materialReturnId);
      if (!productionId) return;
      const current = returnedByProduction.get(productionId) || { weight: 0, value: 0 };
      const slip = packingSlipMap.get(line.packingSlipId);
      const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
      current.weight += Number(line.weightKg || 0);
      current.value += Number(line.weightKg || 0) * rate;
      returnedByProduction.set(productionId, current);
    });

    const query = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo).getTime() : null;
    const minConsumedValue = Number(minConsumed || 0);

    return productions
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp && !hasFfgValue(production))
      .map((production) => {
        const issued = issuedByProduction.get(production.id) || { weight: 0, value: 0 };
        const returned = returnedByProduction.get(production.id) || { weight: 0, value: 0 };
        const reelIssued = Number(Number(issued.weight || 0).toFixed(2));
        const reelReturned = Number(Number(returned.weight || 0).toFixed(2));
        const reelConsumed = Number((reelIssued - reelReturned).toFixed(2));
        const consumedValue = Number(Number(issued.value - returned.value || 0).toFixed(2));
        return {
          productionId: production.id,
          jobNo: String(production.transactionNo || production.jobCardNo || ""),
          productionDate: production.date || "",
          corrugationDate: corrugationDateMap.get(production.id) || "",
          erpCode: String(production.erpCode || production.masterErp || ""),
          plannedQty: Number(production.qty || production.plannedQty || 0),
          ffgQty: Number(production.prodFromFFG || 0),
          reelIssued,
          reelReturned,
          reelConsumed,
          consumedValue,
        };
      })
      .filter((row) => {
        if (row.reelConsumed <= 0) return false;
        if (query && ![row.jobNo, row.erpCode].some((value) => String(value || "").toLowerCase().includes(query))) return false;
        const dateValue = row.corrugationDate || row.productionDate;
        if (fromMs != null && (!dateValue || new Date(dateValue).getTime() < fromMs)) return false;
        if (toMs != null && (!dateValue || new Date(dateValue).getTime() > toMs)) return false;
        if (minConsumed && row.reelConsumed < minConsumedValue) return false;
        return true;
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.corrugationDate || b.productionDate || 0).getTime() - new Date(a.corrugationDate || a.productionDate || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [dateFrom, dateTo, issueReelLines, materialIn, materialIssues, materialReturns, materials, minConsumed, packingSlips, processing, productions, returnReelLines, searchTerm]);

  const summary = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          jobs: acc.jobs + 1,
          plannedQty: acc.plannedQty + row.plannedQty,
          reelConsumed: acc.reelConsumed + row.reelConsumed,
          consumedValue: acc.consumedValue + row.consumedValue,
        }),
        { jobs: 0, plannedQty: 0, reelConsumed: 0, consumedValue: 0 }
      ),
    [rows]
  );

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setMinConsumed("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Jobs In Progress</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Jobs</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{summary.jobs}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Planned Qty</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{formatQty(summary.plannedQty)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Reel Consumed</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{formatQty(summary.reelConsumed)}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Consumed Value</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{formatQty(summary.consumedValue)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-[1_1_300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search job no. / ERP"
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Date From"
            className="min-w-[150px] flex-[0_1_170px] rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Date To"
            className="min-w-[150px] flex-[0_1_170px] rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="number"
            value={minConsumed}
            onChange={(e) => setMinConsumed(e.target.value)}
            placeholder="Min consumed"
            className="min-w-[150px] flex-[0_1_170px] rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <button
            type="button"
            onClick={handleClear}
            className="min-h-[42px] rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                {[
                  "Job No.",
                  "Production Date",
                  "Corrugation Date",
                  "ERP",
                  "Planned Qty",
                  "FFG",
                  "Reel Issued",
                  "Reel Returned",
                  "Reel Consumed",
                  "Consumed Value",
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
                  <td colSpan={10} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No jobs in progress match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.productionId} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.jobNo}</td>
                    <td className="border-2 border-black px-3 py-3 whitespace-nowrap">{formatDate(row.productionDate)}</td>
                    <td className="border-2 border-black px-3 py-3 whitespace-nowrap">{formatDate(row.corrugationDate)}</td>
                    <td className="border-2 border-black px-3 py-3">{row.erpCode || "-"}</td>
                    <td className="border-2 border-black px-3 py-3 text-right font-semibold">{formatQty(row.plannedQty)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right font-semibold">{formatQty(row.ffgQty)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{formatQty(row.reelIssued)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{formatQty(row.reelReturned)}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right font-bold text-amber-800">{formatQty(row.reelConsumed)}</td>
                    <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right font-bold text-purple-900">{formatQty(row.consumedValue)}</td>
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
