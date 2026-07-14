import React, { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  Production,
  ProductionProcessing,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
} from "../types";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { formatDate } from "../lib/serial";

type JobwiseReelConsumptionRow = {
  productionId: string;
  jobNo: string;
  corrugationDate: string;
  jobFfg: number;
  jobRate: number;
  jobValue: number;
  reelIssued: number;
  reelReturned: number;
  reelConsumed: number;
  consumedValue: number;
  gp: number;
  gpPercent: number;
};

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

export function JobwiseReelConsumptionReport() {
  const [productions] = useData<Production>("productions", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minGpPercent, setMinGpPercent] = useState("");
  const [positiveConsumptionOnly, setPositiveConsumptionOnly] = useState(false);

  const rows = useMemo<JobwiseReelConsumptionRow[]>(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));

    const corrugationDateMap = new Map<string, string>();
    processing.forEach((entry) => {
      if (normalizeMachineName(entry.machineName) !== "Corrugation Paper") return;
      const existing = corrugationDateMap.get(entry.productionId);
      if (!existing || new Date(entry.date).getTime() < new Date(existing).getTime()) {
        corrugationDateMap.set(entry.productionId, entry.date);
      }
    });

    const issuedByProduction = new Map<string, { weight: number; value: number }>();
    issueReelLines.forEach((line) => {
      const current = issuedByProduction.get(line.productionId) || { weight: 0, value: 0 };
      const slip = packingSlipMap.get(line.packingSlipId);
      const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
      current.weight += Number(line.weightKg || 0);
      current.value += Number(line.weightKg || 0) * rate;
      issuedByProduction.set(line.productionId, current);
    });

    const returnedByProduction = new Map<string, { weight: number; value: number }>();
    returnReelLines.forEach((line) => {
      const current = returnedByProduction.get(line.productionId) || { weight: 0, value: 0 };
      const slip = packingSlipMap.get(line.packingSlipId);
      const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
      current.weight += Number(line.weightKg || 0);
      current.value += Number(line.weightKg || 0) * rate;
      returnedByProduction.set(line.productionId, current);
    });

    return productions
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
      .map((production) => {
        const issued = issuedByProduction.get(production.id) || { weight: 0, value: 0 };
        const returned = returnedByProduction.get(production.id) || { weight: 0, value: 0 };
        const jobFfg = Number(production.prodFromFFG || 0);
        const jobRate = Number(production.rate || 0);
        const jobValue = jobFfg * jobRate;
        const reelIssued = Number(Number(issued.weight || 0).toFixed(2));
        const reelReturned = Number(Number(returned.weight || 0).toFixed(2));
        const reelConsumed = Number((reelIssued - reelReturned).toFixed(2));
        const consumedValue = Number(Number(issued.value - returned.value || 0).toFixed(2));
        const gp = Number(Number(jobValue - consumedValue || 0).toFixed(2));
        const gpPercent = jobValue > 0 ? Number(((gp / jobValue) * 100).toFixed(2)) : 0;

        return {
          productionId: production.id,
          jobNo: String(production.transactionNo || production.jobCardNo || ""),
          corrugationDate: corrugationDateMap.get(production.id) || "",
          jobFfg,
          jobRate,
          jobValue: Number(jobValue.toFixed(2)),
          reelIssued,
          reelReturned,
          reelConsumed,
          consumedValue,
          gp,
          gpPercent,
        };
      })
      .filter((row) => {
        const search = searchTerm.trim().toLowerCase();
        if (search && !row.jobNo.toLowerCase().includes(search)) return false;
        if (dateFrom && (!row.corrugationDate || new Date(row.corrugationDate).getTime() < new Date(dateFrom).getTime())) return false;
        if (dateTo && (!row.corrugationDate || new Date(row.corrugationDate).getTime() > new Date(dateTo).getTime())) return false;
        if (minGpPercent && row.gpPercent < Number(minGpPercent || 0)) return false;
        if (positiveConsumptionOnly && row.reelConsumed <= 0) return false;
        return true;
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.corrugationDate || 0).getTime() - new Date(a.corrugationDate || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.jobNo.localeCompare(b.jobNo);
      });
  }, [
    dateFrom,
    dateTo,
    issueReelLines,
    materialIn,
    materials,
    minGpPercent,
    packingSlips,
    positiveConsumptionOnly,
    processing,
    productions,
    returnReelLines,
    searchTerm,
  ]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        jobValue: acc.jobValue + row.jobValue,
        reelConsumed: acc.reelConsumed + row.reelConsumed,
        consumedValue: acc.consumedValue + row.consumedValue,
        gp: acc.gp + row.gp,
      }),
      { jobValue: 0, reelConsumed: 0, consumedValue: 0, gp: 0 }
    );
  }, [rows]);

  const averageGpPercent =
    summary.jobValue > 0 ? Number(((summary.gp / summary.jobValue) * 100).toFixed(2)) : 0;

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setMinGpPercent("");
    setPositiveConsumptionOnly(false);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">
              <Filter size={14} />
              Reports
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Jobwise Reel Consumption Report</h2>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[720px]">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">Total Job Value</div>
              <div className="mt-2 text-2xl font-black text-sky-950">{summary.jobValue.toFixed(2)}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Reel Consumed</div>
              <div className="mt-2 text-2xl font-black text-amber-950">{summary.reelConsumed.toFixed(2)}</div>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">Actual Consumed Value</div>
              <div className="mt-2 text-2xl font-black text-violet-950">{summary.consumedValue.toFixed(2)}</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Average GP%</div>
              <div className="mt-2 text-2xl font-black text-emerald-950">{averageGpPercent.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_repeat(4,minmax(140px,0.8fr))]">
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
                    placeholder="Job No."
                    className="w-full border-0 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                  />
                </div>
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Date From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Date To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Min GP%</span>
                <input
                  type="number"
                  value={minGpPercent}
                  onChange={(e) => setMinGpPercent(e.target.value)}
                  placeholder="0"
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>

              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Consumption Mode</span>
                <div className="flex h-[52px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
                  <label className="inline-flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={positiveConsumptionOnly}
                      onChange={(e) => setPositiveConsumptionOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Positive consumption only
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex h-[52px] items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-md">
        <div className="table-frozen-scroll">
          <table className="min-w-[1180px] w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-blue-700 text-white shadow-sm">
                {[
                  "Job No.",
                  "Corrugation Date",
                  "Job FFG",
                  "Job Rate",
                  "Job Value",
                  "Reel Issued",
                  "Reel Returned",
                  "Reel Consumed",
                  "Actual Consumed Value",
                  "GP",
                  "GP%",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="sticky top-0 z-20 whitespace-nowrap border-r border-blue-950 border-b border-blue-950 bg-blue-700 px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.14em] text-white last:border-r-0"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="border-t border-slate-300 px-6 py-12 text-center text-sm font-semibold text-slate-500">
                    No jobs match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.productionId} className="border-t border-slate-300 text-[12px] text-slate-700 transition odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/70">
                    <td className="border-r border-slate-300 px-3 py-2.5 font-bold text-slate-900">{row.jobNo}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5">{formatDate(row.corrugationDate)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right">{Number(row.jobFfg || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right">{Number(row.jobRate || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-semibold text-slate-900">{Number(row.jobValue || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right">{Number(row.reelIssued || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right">{Number(row.reelReturned || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-bold text-amber-700">{Number(row.reelConsumed || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-bold text-violet-700">{Number(row.consumedValue || 0).toFixed(2)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-bold text-emerald-700">{Number(row.gp || 0).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right font-black text-emerald-800">{Number(row.gpPercent || 0).toFixed(2)}</td>
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
