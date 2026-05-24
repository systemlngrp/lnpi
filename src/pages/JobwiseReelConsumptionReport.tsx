import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Download, Filter, Search } from "lucide-react";
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

function buildConsumptionPdf(rows: JobwiseReelConsumptionRow[]) {
  const doc = new jsPDF("l", "mm", "a4");
  doc.setFontSize(16);
  doc.text("Jobwise Reel Consumption Report", 14, 14);
  doc.setFontSize(9);
  doc.text(`Generated on ${new Date().toLocaleString("en-GB")}`, 14, 20);

  autoTable(doc, {
    startY: 25,
    head: [[
      "Job No.",
      "Corrugation Date",
      "Job FFG",
      "Job Rate",
      "Job Value",
      "Reel Issued",
      "Reel Returned",
      "Reel Consumed",
      "Consumed Value",
      "GP",
      "GP%",
    ]],
    body: rows.map((row) => [
      row.jobNo,
      formatDate(row.corrugationDate),
      row.jobFfg.toFixed(2),
      row.jobRate.toFixed(2),
      row.jobValue.toFixed(2),
      row.reelIssued.toFixed(2),
      row.reelReturned.toFixed(2),
      row.reelConsumed.toFixed(2),
      row.consumedValue.toFixed(2),
      row.gp.toFixed(2),
      row.gpPercent.toFixed(2),
    ]),
    theme: "grid",
    headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 2, textColor: 0 },
  });

  return doc;
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
        const reelIssued = Number(issued.weight.toFixed(2));
        const reelReturned = Number(returned.weight.toFixed(2));
        const reelConsumed = Number((reelIssued - reelReturned).toFixed(2));
        const consumedValue = Number((issued.value - returned.value).toFixed(2));
        const gp = Number((jobValue - consumedValue).toFixed(2));
        const gpPercent = consumedValue > 0 ? Number(((gp / consumedValue) * 100).toFixed(2)) : 0;

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
    summary.consumedValue > 0 ? Number(((summary.gp / summary.consumedValue) * 100).toFixed(2)) : 0;

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setMinGpPercent("");
    setPositiveConsumptionOnly(false);
  };

  const handleExcel = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(
      rows.map((row) => ({
        "Job No.": row.jobNo,
        "Corrugation Date": formatDate(row.corrugationDate),
        "Job FFG": row.jobFfg,
        "Job Rate": row.jobRate,
        "Job Value": row.jobValue,
        "Reel Issued": row.reelIssued,
        "Reel Returned": row.reelReturned,
        "Reel Consumed": row.reelConsumed,
        "Consumed Value": row.consumedValue,
        GP: row.gp,
        "GP%": row.gpPercent,
      }))
    );
    XLSX.utils.book_append_sheet(workbook, worksheet, "Jobwise Reel Consumption");
    XLSX.writeFile(workbook, "Jobwise_Reel_Consumption_Report.xlsx");
  };

  const handlePdf = () => {
    buildConsumptionPdf(rows).save(`Jobwise_Reel_Consumption_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
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
              <p className="mt-1 text-sm font-medium text-slate-500">
                Corrugation-paper-date jobs with reel issue, return, consumed cost, GP, and cost-based GP%.
              </p>
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
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">Consumed Value</div>
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
              <button
                type="button"
                onClick={handlePdf}
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 text-sm font-bold text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <Download size={16} />
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleExcel}
                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <Download size={16} />
                Download Excel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-sm font-bold text-slate-900">{rows.length} jobs</div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            GP% is calculated on consumed value
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-emerald-950 text-white">
                {[
                  "Job No.",
                  "Corrugation Date",
                  "Job FFG",
                  "Job Rate",
                  "Job Value",
                  "Reel Issued",
                  "Reel Returned",
                  "Reel Consumed",
                  "Consumed Value",
                  "GP",
                  "GP%",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="whitespace-nowrap border-b border-emerald-900 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.18em]"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                    No jobs match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.productionId} className="border-b border-slate-100 text-sm text-slate-700 transition hover:bg-emerald-50/40">
                    <td className="px-4 py-3 font-bold text-slate-900">{row.jobNo}</td>
                    <td className="px-4 py-3">{formatDate(row.corrugationDate)}</td>
                    <td className="px-4 py-3 text-right">{row.jobFfg.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{row.jobRate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.jobValue.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{row.reelIssued.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{row.reelReturned.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700">{row.reelConsumed.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-bold text-violet-700">{row.consumedValue.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">{row.gp.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-black text-emerald-800">{row.gpPercent.toFixed(2)}</td>
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
