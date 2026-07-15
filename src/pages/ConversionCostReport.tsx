import React, { useMemo, useState } from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  Production,
  ProductionProcessing,
} from "../types";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { formatDate } from "../lib/serial";

type ConversionCostRow = {
  id: string;
  erpCode: string;
  itemName: string;
  jobCount: number;
  jobNos: string[];
  producedQty: number;
  jobValue: number;
  reelConsumedKg: number;
  reelConsumedValue: number;
  orderCostPerKg: number | null;
  reelConsumableCostPerKg: number | null;
  differencePerKg: number | null;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function safeDivide(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round2(numerator / denominator);
}

function formatNumber(value: number | null | undefined) {
  if (value == null) return "-";
  return Number(value || 0).toFixed(2);
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

export function ConversionCostReport() {
  const [productions] = useData<Production>("productions", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const { findItemAcrossSources } = useOrderItemCatalog();

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const rows = useMemo<ConversionCostRow[]>(() => {
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

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo).getTime() : null;
    const grouped = new Map<string, ConversionCostRow & { jobNoSet: Set<string> }>();

    productions
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
      .forEach((production) => {
        const corrugationDate = corrugationDateMap.get(production.id) || "";
        const corrugationMs = corrugationDate ? new Date(corrugationDate).getTime() : null;
        if (fromMs != null && (corrugationMs == null || corrugationMs < fromMs)) return;
        if (toMs != null && (corrugationMs == null || corrugationMs > toMs)) return;

        const resolvedItem = findItemAcrossSources(
          production.itemId,
          production.itemSource,
          production.erpCode ?? production.masterErp
        );
        const erpCode = String(production.erpCode ?? production.masterErp ?? resolvedItem?.erp ?? "").trim() || "Unmapped";
        const itemName = String(resolvedItem?.name || production.companyName || production.itemId || "Unmapped Item").trim();
        const jobNo = String(production.transactionNo || production.jobCardNo || "").trim();

        const searchText = `${erpCode} ${itemName} ${jobNo}`.toLowerCase();
        if (normalizedSearch && !searchText.includes(normalizedSearch)) return;

        const issued = issuedByProduction.get(production.id) || { weight: 0, value: 0 };
        const returned = returnedByProduction.get(production.id) || { weight: 0, value: 0 };
        const producedQty = Number(production.prodFromFFG || 0);
        const jobValue = producedQty * Number(production.rate || 0);
        const reelConsumedKg = Number(issued.weight || 0) - Number(returned.weight || 0);
        const reelConsumedValue = Number(issued.value || 0) - Number(returned.value || 0);
        const key = `${erpCode}__${itemName}`;
        const current =
          grouped.get(key) ||
          ({
            id: key,
            erpCode,
            itemName,
            jobCount: 0,
            jobNos: [],
            jobNoSet: new Set<string>(),
            producedQty: 0,
            jobValue: 0,
            reelConsumedKg: 0,
            reelConsumedValue: 0,
            orderCostPerKg: null,
            reelConsumableCostPerKg: null,
            differencePerKg: null,
          } satisfies ConversionCostRow & { jobNoSet: Set<string> });

        current.jobCount += 1;
        if (jobNo) current.jobNoSet.add(jobNo);
        current.producedQty += producedQty;
        current.jobValue += jobValue;
        current.reelConsumedKg += reelConsumedKg;
        current.reelConsumedValue += reelConsumedValue;
        grouped.set(key, current);
      });

    return [...grouped.values()]
      .map((row) => {
        const orderCostPerKg = safeDivide(row.jobValue, row.reelConsumedKg);
        const reelConsumableCostPerKg = safeDivide(row.reelConsumedValue, row.reelConsumedKg);
        return {
          ...row,
          jobNos: [...row.jobNoSet].sort((a, b) => a.localeCompare(b)),
          producedQty: round2(row.producedQty),
          jobValue: round2(row.jobValue),
          reelConsumedKg: round2(row.reelConsumedKg),
          reelConsumedValue: round2(row.reelConsumedValue),
          orderCostPerKg,
          reelConsumableCostPerKg,
          differencePerKg:
            orderCostPerKg != null && reelConsumableCostPerKg != null
              ? round2(orderCostPerKg - reelConsumableCostPerKg)
              : null,
        };
      })
      .sort((a, b) => a.erpCode.localeCompare(b.erpCode, undefined, { numeric: true }) || a.itemName.localeCompare(b.itemName));
  }, [
    dateFrom,
    dateTo,
    findItemAcrossSources,
    issueReelLines,
    materialIn,
    materials,
    packingSlips,
    processing,
    productions,
    returnReelLines,
    searchTerm,
  ]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        jobCount: acc.jobCount + row.jobCount,
        producedQty: acc.producedQty + row.producedQty,
        jobValue: acc.jobValue + row.jobValue,
        reelConsumedKg: acc.reelConsumedKg + row.reelConsumedKg,
        reelConsumedValue: acc.reelConsumedValue + row.reelConsumedValue,
      }),
      { jobCount: 0, producedQty: 0, jobValue: 0, reelConsumedKg: 0, reelConsumedValue: 0 }
    );
  }, [rows]);

  const summaryOrderCostPerKg = safeDivide(summary.jobValue, summary.reelConsumedKg);
  const summaryReelCostPerKg = safeDivide(summary.reelConsumedValue, summary.reelConsumedKg);
  const summaryDifferencePerKg =
    summaryOrderCostPerKg != null && summaryReelCostPerKg != null
      ? round2(summaryOrderCostPerKg - summaryReelCostPerKg)
      : null;

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)]">
        <div className="bg-gradient-to-r from-slate-950 via-sky-900 to-teal-800 px-5 py-4 text-white">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">
                <Filter size={14} />
                Reports
              </div>
              <h2 className="text-2xl font-black tracking-tight">Conversion Cost Report</h2>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[560px]">
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">Order Cost / KG</div>
                <div className="mt-1 text-2xl font-black">{formatNumber(summaryOrderCostPerKg)}</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">Reel Cost / KG</div>
                <div className="mt-1 text-2xl font-black">{formatNumber(summaryReelCostPerKg)}</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">Diff / KG</div>
                <div className="mt-1 text-2xl font-black">{formatNumber(summaryDifferencePerKg)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-5">
            <SummaryCard label="ERP Items" value={rows.length.toLocaleString()} tone="sky" />
            <SummaryCard label="Jobs" value={summary.jobCount.toLocaleString()} tone="emerald" />
            <SummaryCard label="Produced Qty" value={round2(summary.producedQty).toLocaleString()} tone="violet" />
            <SummaryCard label="Job Value" value={round2(summary.jobValue).toLocaleString()} tone="amber" />
            <SummaryCard label="Reel Consumed KG" value={round2(summary.reelConsumedKg).toLocaleString()} tone="rose" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_minmax(160px,0.75fr)_minmax(160px,0.75fr)_auto]">
              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <Search size={14} />
                  Search
                </span>
                <div className="flex h-[48px] items-center rounded-xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
                  <Search size={16} className="text-sky-500" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search ERP, item, or job..."
                    className="ml-3 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Date From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="h-[48px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Date To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="h-[48px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
                >
                  <RotateCcw size={16} />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-md">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">{rows.length} ERP-wise rows</div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Date filter uses first Corrugation Paper processing date
          </div>
        </div>
        <div className="table-frozen-scroll">
          <table className="min-w-[1320px] w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-blue-700 text-white shadow-sm">
                {[
                  "ERP Code",
                  "Item",
                  "Jobs",
                  "Job Nos.",
                  "Produced Qty",
                  "Job Value",
                  "Reel Consumed KG",
                  "Reel Consumed Value",
                  "Order Cost / KG",
                  "Reel Consumable Cost / KG",
                  "Diff / KG",
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
                    No ERP-wise conversion cost rows match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-300 text-[12px] text-slate-700 transition odd:bg-white even:bg-slate-50/70 hover:bg-sky-50/70">
                    <td className="border-r border-slate-300 px-3 py-2.5 font-black text-slate-950">{row.erpCode}</td>
                    <td className="min-w-[260px] border-r border-slate-300 px-3 py-2.5 font-semibold text-slate-900">{row.itemName}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-bold">{row.jobCount}</td>
                    <td className="max-w-[240px] border-r border-slate-300 px-3 py-2.5 text-slate-600">
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={row.jobNos.join(", ")}>
                        {row.jobNos.slice(0, 4).join(", ")}
                        {row.jobNos.length > 4 ? ` +${row.jobNos.length - 4}` : ""}
                      </span>
                    </td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right">{formatNumber(row.producedQty)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-semibold text-slate-900">{formatNumber(row.jobValue)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-bold text-amber-700">{formatNumber(row.reelConsumedKg)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-bold text-violet-700">{formatNumber(row.reelConsumedValue)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-black text-sky-700">{formatNumber(row.orderCostPerKg)}</td>
                    <td className="border-r border-slate-300 px-3 py-2.5 text-right font-black text-rose-700">{formatNumber(row.reelConsumableCostPerKg)}</td>
                    <td className="px-3 py-2.5 text-right font-black text-emerald-700">{formatNumber(row.differencePerKg)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-black bg-slate-100">
                  <td className="border-r border-black px-3 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-slate-700" colSpan={2}>
                    Totals
                  </td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-slate-900">{summary.jobCount}</td>
                  <td className="border-r border-black px-3 py-2.5 text-sm font-semibold text-slate-900">-</td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-slate-900">{formatNumber(summary.producedQty)}</td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-slate-900">{formatNumber(summary.jobValue)}</td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-amber-700">{formatNumber(summary.reelConsumedKg)}</td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-violet-700">{formatNumber(summary.reelConsumedValue)}</td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-sky-700">{formatNumber(summaryOrderCostPerKg)}</td>
                  <td className="border-r border-black px-3 py-2.5 text-right text-sm font-black text-rose-700">{formatNumber(summaryReelCostPerKg)}</td>
                  <td className="px-3 py-2.5 text-right text-sm font-black text-emerald-700">{formatNumber(summaryDifferencePerKg)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "sky" | "emerald" | "violet" | "amber" | "rose" }) {
  const toneClass = {
    sky: "border-sky-200 bg-sky-50 text-sky-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    violet: "border-violet-200 bg-violet-50 text-violet-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    rose: "border-rose-200 bg-rose-50 text-rose-950",
  }[tone];

  const labelClass = {
    sky: "text-sky-700",
    emerald: "text-emerald-700",
    violet: "text-violet-700",
    amber: "text-amber-700",
    rose: "text-rose-700",
  }[tone];

  return (
    <div className={`rounded-xl border px-4 py-2.5 ${toneClass}`}>
      <div className={`text-[11px] font-bold uppercase tracking-[0.16em] ${labelClass}`}>{label}</div>
      <div className="mt-1.5 text-[1.75rem] font-black leading-none">{value}</div>
    </div>
  );
}
