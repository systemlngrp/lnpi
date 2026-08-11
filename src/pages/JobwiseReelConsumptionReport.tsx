import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { ExcelExport } from "../components/ExcelExport";
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

  const rows = useMemo<JobwiseReelConsumptionRow[]>(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));

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
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp && Number(production.prodFromFFG || 0) > 0)
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


  const excelRows = useMemo(
    () => [
      ...(rows.length > 0 ? [{
        "Job No.": "TOTAL",
        "Corrugation Date": "",
        "Job FFG": "",
        "Job Rate": "",
        "Job Value": Number(summary.jobValue.toFixed(2)),
        "Reel Issued": "",
        "Reel Returned": "",
        "Reel Consumed": Number(summary.reelConsumed.toFixed(2)),
        "Actual Consumed Value": Number(summary.consumedValue.toFixed(2)),
        GP: Number(summary.gp.toFixed(2)),
        "GP%": Number(averageGpPercent.toFixed(2)),
      }] : []),
      ...rows.map((row) => ({
        "Job No.": row.jobNo,
        "Corrugation Date": formatDate(row.corrugationDate),
        "Job FFG": Number(row.jobFfg || 0),
        "Job Rate": Number(row.jobRate || 0),
        "Job Value": Number(row.jobValue || 0),
        "Reel Issued": Number(row.reelIssued || 0),
        "Reel Returned": Number(row.reelReturned || 0),
        "Reel Consumed": Number(row.reelConsumed || 0),
        "Actual Consumed Value": Number(row.consumedValue || 0),
        GP: Number(row.gp || 0),
        "GP%": Number(row.gpPercent || 0),
      })),
    ],
    [averageGpPercent, rows, summary]
  );
  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setMinGpPercent("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Jobwise Reel Consumption Report</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Job Value</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{summary.jobValue.toFixed(2)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Reel Consumed</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{summary.reelConsumed.toFixed(2)}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Actual Consumed Value</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{summary.consumedValue.toFixed(2)}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Average GP%</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{averageGpPercent.toFixed(2)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_repeat(3,minmax(130px,0.8fr))_auto] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search job no."
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Date From"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Date To"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />

          <input
            type="number"
            value={minGpPercent}
            onChange={(e) => setMinGpPercent(e.target.value)}
            placeholder="Min GP%"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[42px] rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
            >
              Clear Filters
            </button>
            <ExcelExport data={excelRows} fileName="Jobwise_Reel_Consumption_Report" sheetName="Jobwise Consumption" />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
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
                    className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No jobs match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.productionId} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.jobNo}</td>
                    <td className="border-2 border-black px-3 py-3 whitespace-nowrap">{formatDate(row.corrugationDate)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{Number(row.jobFfg || 0).toFixed(2)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{Number(row.jobRate || 0).toFixed(2)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right font-semibold">{Number(row.jobValue || 0).toFixed(2)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{Number(row.reelIssued || 0).toFixed(2)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{Number(row.reelReturned || 0).toFixed(2)}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right font-bold text-amber-800">{Number(row.reelConsumed || 0).toFixed(2)}</td>
                    <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right font-bold text-purple-900">{Number(row.consumedValue || 0).toFixed(2)}</td>
                    <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right font-bold text-emerald-900">{Number(row.gp || 0).toFixed(2)}</td>
                    <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right font-black text-emerald-900">{Number(row.gpPercent || 0).toFixed(2)}</td>
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
