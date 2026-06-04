import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { Calendar, Download, FileText, Filter, RotateCcw } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Indent,
  IndentLine,
  Item,
  Material,
  MaterialIn,
  MaterialIssue,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnReelLine,
  Production,
  PurchaseOrder,
  PurchaseOrderLine,
  RapcRange,
} from "../types";
import { formatDate } from "../lib/serial";
import { getEffectiveRapcRanges } from "../lib/rapcRanges";

type GroupTypeFilter = "All" | "Top" | "A-Flute" | "A-Backing" | "B-Flute" | "B-Backing";
type NetFilter = "All" | "Need To Order" | "Surplus";
type RequirementGroup = {
  rapcRange: number;
  gsm: number;
  groupType: Exclude<GroupTypeFilter, "All">;
  requirement: number;
};

type ReportRow = {
  rapcRange: number;
  gsm: number;
  totalPaperRequirement: number;
  totalClosingStock: number;
  totalPendingPo: number;
  mil: number;
  netPaperToOrder: number;
};

const GROUP_TYPE_OPTIONS: GroupTypeFilter[] = ["All", "Top", "A-Flute", "A-Backing", "B-Flute", "B-Backing"];
const NET_FILTER_OPTIONS: NetFilter[] = ["All", "Need To Order", "Surplus"];

function parseAppDate(value?: string | null) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const onlyDate = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) {
    const [year, month, day] = onlyDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function makeKey(rapcRange: number, gsm: number) {
  return `${rapcRange}__${gsm}`;
}

function resolveRapcValue(input: number, ranges: RapcRange[]) {
  const match = getEffectiveRapcRanges(ranges).find((row) => input >= Number(row.from || 0) && input <= Number(row.to || 0));
  return Number(match?.rapcRange || 0);
}

function getMaterialRapcInput(material?: Material | null) {
  const rapc = Number(material?.rapc || 0);
  if (rapc > 0) return rapc;
  const size = Number(material?.size || 0);
  return size > 0 ? size * 10 : 0;
}

export function PaperRequirementReport() {
  const [productions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [issueEntries] = useData<MaterialIssue>("material-issues", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnEntries] = useData<MaterialReturn>("material-returns", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [indents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [rapcRanges] = useData<RapcRange>("rapc-ranges", []);

  const [selectedRangeGsm, setSelectedRangeGsm] = useState("All");
  const [uptoDate, setUptoDate] = useState(() => toDateInput(new Date()));
  const [netFilter, setNetFilter] = useState<NetFilter>("All");
  const [groupType, setGroupType] = useState<GroupTypeFilter>("All");

  const filteredTimestamp = useMemo(() => {
    const parsed = parseAppDate(uptoDate);
    return parsed ? normalizeDate(parsed).getTime() : normalizeDate(new Date()).getTime();
  }, [uptoDate]);

  const reportData = useMemo(() => {
    const effectiveRanges = getEffectiveRapcRanges(rapcRanges);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const issueMap = new Map(issueEntries.map((entry) => [entry.id, entry]));
    const returnMap = new Map(returnEntries.map((entry) => [entry.id, entry]));
    const indentMap = new Map(indents.map((indent) => [indent.id, indent]));

    const requirementRows: RequirementGroup[] = [];
    productions
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
      .forEach((production) => {
        const productionDate = parseAppDate(production.date);
        if (!productionDate || normalizeDate(productionDate).getTime() > filteredTimestamp) return;

        const item = itemMap.get(production.itemId);
        const rapcInput = Number(item?.rapc || 0);
        const rapcRange = resolveRapcValue(rapcInput, effectiveRanges);
        if (!rapcRange) return;

        const topWeight = Number(production.topPaperWeightKg || 0);
        const linerWeight = Number(production.linerWeightKg || 0);
        const topGsm = Number(production.top || production.l1 || item?.l1 || 0);
        const takeUpFactor = Number(production.takeUpFactor || item?.takeUpFactor || 0);
        const f1 = Number(production.f1 || item?.f1 || 0);
        const l2 = Number(production.l2 || item?.l2 || 0);
        const f2 = Number(production.f2 || item?.f2 || 0);
        const l3 = Number(production.l3 || item?.l3 || 0);

        if (topWeight > 0 && topGsm > 0) {
          requirementRows.push({
            rapcRange,
            gsm: topGsm,
            groupType: "Top",
            requirement: topWeight,
          });
        }

        const weightedParts = [
          { gsm: f1, groupType: "A-Flute" as const, weightFactor: f1 * takeUpFactor },
          { gsm: l2, groupType: "A-Backing" as const, weightFactor: l2 },
          { gsm: f2, groupType: "B-Flute" as const, weightFactor: f2 * takeUpFactor },
          { gsm: l3, groupType: "B-Backing" as const, weightFactor: l3 },
        ].filter((row) => row.gsm > 0 && row.weightFactor > 0);

        const totalWeightFactor = weightedParts.reduce((sum, row) => sum + row.weightFactor, 0);
        if (linerWeight > 0 && totalWeightFactor > 0) {
          weightedParts.forEach((row) => {
            requirementRows.push({
              rapcRange,
              gsm: row.gsm,
              groupType: row.groupType,
              requirement: (linerWeight * row.weightFactor) / totalWeightFactor,
            });
          });
        }
      });

    const requirementByKey = new Map<string, number>();
    requirementRows
      .filter((row) => groupType === "All" || row.groupType === groupType)
      .forEach((row) => {
        const key = makeKey(row.rapcRange, row.gsm);
        requirementByKey.set(key, (requirementByKey.get(key) || 0) + Number(row.requirement || 0));
      });

    const stockByKey = new Map<string, number>();
    materials
      .filter((material) => material.type === "Reel")
      .forEach((material) => {
        const rapcRange = resolveRapcValue(getMaterialRapcInput(material), effectiveRanges);
        const gsm = Number(material.gsm || 0);
        if (!rapcRange || !gsm) return;

        const receipts = materialIn
          .filter((entry) => {
            const entryDate = parseAppDate(entry.date || entry.timestamp);
            return entryDate && normalizeDate(entryDate).getTime() <= filteredTimestamp;
          })
          .reduce((sum, entry) => {
            const line = entry.lines.find((row) => row.itemId === material.id);
            return sum + Number(line?.actualQty ?? line?.qty ?? 0);
          }, 0);

        const issued = issueReelLines.reduce((sum, line) => {
          if (line.materialId !== material.id) return sum;
          const issueDate = parseAppDate(issueMap.get(line.materialIssueId)?.date);
          if (!issueDate || normalizeDate(issueDate).getTime() > filteredTimestamp) return sum;
          return sum + Number(line.weightKg || 0);
        }, 0);

        const returned = returnReelLines.reduce((sum, line) => {
          if (line.materialId !== material.id) return sum;
          const returnDate = parseAppDate(returnMap.get(line.materialReturnId)?.date);
          if (!returnDate || normalizeDate(returnDate).getTime() > filteredTimestamp) return sum;
          return sum + Number(line.weightKg || 0);
        }, 0);

        const available = Number(material.openingQty || 0) + receipts + returned - issued;
        const key = makeKey(rapcRange, gsm);
        stockByKey.set(key, (stockByKey.get(key) || 0) + Math.max(0, available));
      });

    const receivedByPoLine = new Map<string, number>();
    materialIn
      .filter((entry) => {
        const entryDate = parseAppDate(entry.date || entry.timestamp);
        return entryDate && normalizeDate(entryDate).getTime() <= filteredTimestamp;
      })
      .forEach((entry) => {
        entry.lines.forEach((line) => {
          if (!line.poLineId) return;
          receivedByPoLine.set(line.poLineId, (receivedByPoLine.get(line.poLineId) || 0) + Number(line.actualQty ?? line.qty ?? 0));
        });
      });

    const poMap = new Map(purchaseOrders.map((order) => [order.id, order]));
    const pendingPoByKey = new Map<string, number>();
    purchaseOrderLines.forEach((line) => {
      const po = poMap.get(line.purchaseOrderId);
      const poDate = parseAppDate(po?.poDate);
      if (!po || po.status !== "Approved" || !poDate || normalizeDate(poDate).getTime() > filteredTimestamp) return;
      const material = materialMap.get(line.materialId);
      if (!material || material.type !== "Reel") return;
      const rapcRange = resolveRapcValue(getMaterialRapcInput(material), effectiveRanges);
      const gsm = Number(material.gsm || 0);
      if (!rapcRange || !gsm) return;
      const pendingQty = Math.max(0, Number(line.qty || 0) - Number(receivedByPoLine.get(line.id) || 0));
      const key = makeKey(rapcRange, gsm);
      pendingPoByKey.set(key, (pendingPoByKey.get(key) || 0) + pendingQty);
    });

    const milByKey = new Map<string, number>();
    indentLines.forEach((line) => {
      const indent = indentMap.get(line.indentId);
      const indentDate = parseAppDate(indent?.requisitionDate || indent?.requiredDate);
      if (!indentDate || normalizeDate(indentDate).getTime() > filteredTimestamp) return;
      const material = materialMap.get(line.materialId);
      if (!material || material.type !== "Reel") return;
      const rapcRange = resolveRapcValue(getMaterialRapcInput(material), effectiveRanges);
      const gsm = Number(material.gsm || 0);
      if (!rapcRange || !gsm) return;
      const balanceQty = Math.max(0, Number(line.balanceQty || 0));
      const key = makeKey(rapcRange, gsm);
      milByKey.set(key, (milByKey.get(key) || 0) + balanceQty);
    });

    const allKeys = new Set<string>([
      ...Array.from(requirementByKey.keys()),
      ...Array.from(stockByKey.keys()),
      ...Array.from(pendingPoByKey.keys()),
      ...Array.from(milByKey.keys()),
    ]);

    const rows = Array.from(allKeys)
      .map((key) => {
        const [rapcRangeRaw, gsmRaw] = key.split("__");
        const rapcRange = Number(rapcRangeRaw || 0);
        const gsm = Number(gsmRaw || 0);
        const totalPaperRequirement = round2(requirementByKey.get(key) || 0);
        const totalClosingStock = round2(stockByKey.get(key) || 0);
        const totalPendingPo = round2(pendingPoByKey.get(key) || 0);
        const mil = round2(milByKey.get(key) || 0);
        const netPaperToOrder = round2(totalPaperRequirement - totalClosingStock - totalPendingPo);

        return {
          rapcRange,
          gsm,
          totalPaperRequirement,
          totalClosingStock,
          totalPendingPo,
          mil,
          netPaperToOrder,
        };
      })
      .filter((row) => row.rapcRange > 0 && row.gsm > 0)
      .sort((a, b) => a.rapcRange - b.rapcRange || a.gsm - b.gsm);

    return rows;
  }, [
    filteredTimestamp,
    groupType,
    indentLines,
    indents,
    issueEntries,
    issueReelLines,
    items,
    materialIn,
    materials,
    productions,
    purchaseOrderLines,
    purchaseOrders,
    rapcRanges,
    returnEntries,
    returnReelLines,
  ]);

  const rangeOptions = useMemo(() => {
    const options = reportData.map((row) => `${row.rapcRange} - ${row.gsm}`);
    return ["All", ...Array.from(new Set(options))];
  }, [reportData]);

  const filteredRows = useMemo(() => {
    return reportData.filter((row) => {
      if (selectedRangeGsm !== "All" && `${row.rapcRange} - ${row.gsm}` !== selectedRangeGsm) return false;
      if (netFilter === "Need To Order" && row.netPaperToOrder <= 0) return false;
      if (netFilter === "Surplus" && row.netPaperToOrder >= 0) return false;
      return true;
    });
  }, [netFilter, reportData, selectedRangeGsm]);

  const summary = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => ({
        totalPaperRequirement: acc.totalPaperRequirement + row.totalPaperRequirement,
        totalClosingStock: acc.totalClosingStock + row.totalClosingStock,
        totalPendingPo: acc.totalPendingPo + row.totalPendingPo,
        mil: acc.mil + row.mil,
        netPaperToOrder: acc.netPaperToOrder + row.netPaperToOrder,
      }),
      { totalPaperRequirement: 0, totalClosingStock: 0, totalPendingPo: 0, mil: 0, netPaperToOrder: 0 }
    );
  }, [filteredRows]);

  const exportRows = useMemo(
    () =>
      filteredRows.map((row) => ({
        "RAPC Range": row.rapcRange,
        GSM: row.gsm,
        "Total Paper Requirement": row.totalPaperRequirement,
        "Total Closing Stock": row.totalClosingStock,
        "Total Pending PO": row.totalPendingPo,
        MIL: row.mil,
        "Net Paper to Order": row.netPaperToOrder,
      })),
    [filteredRows]
  );

  const handleClear = () => {
    setSelectedRangeGsm("All");
    setUptoDate(toDateInput(new Date()));
    setNetFilter("All");
    setGroupType("All");
  };

  const handleExportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        "Upto Date": uptoDate,
        "Range + GSM": selectedRangeGsm,
        "Group Type": groupType,
        "Net Filter": netFilter,
        "Total Range": filteredRows.length,
        "Total Paper Requirement": round2(summary.totalPaperRequirement),
        "Total Closing Stock": round2(summary.totalClosingStock),
        "Total Pending PO": round2(summary.totalPendingPo),
        MIL: round2(summary.mil),
        "Net Paper to Order": round2(summary.netPaperToOrder),
      },
    ]);
    const detailSheet = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Details");
    XLSX.writeFile(workbook, `Paper_Requirement_Report_${uptoDate}.xlsx`);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text("Paper Requirement Report", 14, 16);
    doc.setFontSize(10);
    doc.text(
      `Upto Date: ${formatDate(uptoDate)} | Range + GSM: ${selectedRangeGsm} | Group Type: ${groupType} | Net Filter: ${netFilter}`,
      14,
      24
    );

    (doc as any).autoTable({
      head: [["Metric", "Value"]],
      body: [
        ["Total Paper Requirement", round2(summary.totalPaperRequirement)],
        ["Total Closing Stock", round2(summary.totalClosingStock)],
        ["Total Pending PO", round2(summary.totalPendingPo)],
        ["MIL", round2(summary.mil)],
        ["Net Paper to Order", round2(summary.netPaperToOrder)],
        ["Total Range", filteredRows.length],
      ],
      startY: 30,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 55] },
    });

    (doc as any).autoTable({
      head: [["RAPC Range", "GSM", "Total Paper Requirement", "Total Closing Stock", "Total Pending PO", "MIL", "Net Paper to Order"]],
      body: filteredRows.map((row) => [
        row.rapcRange,
        row.gsm,
        row.totalPaperRequirement,
        row.totalClosingStock,
        row.totalPendingPo,
        row.mil,
        row.netPaperToOrder,
      ]),
      startY: (doc as any).lastAutoTable.finalY + 8,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 55] },
    });

    doc.save(`Paper_Requirement_Report_${uptoDate}.pdf`);
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_45px_-30px_rgba(15,23,42,0.34)]">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-sky-900 px-5 py-3 text-white">
          <div className="flex items-center gap-2 text-lg font-black tracking-tight">
            <Filter size={18} />
            Paper Requirement Analysis
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700">Total Paper Requirement</div>
              <div className="mt-1.5 text-[2rem] font-black leading-none text-sky-950">{round2(summary.totalPaperRequirement).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Closing Stock</div>
              <div className="mt-1.5 text-[2rem] font-black leading-none text-emerald-950">{round2(summary.totalClosingStock).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">Pending PO</div>
              <div className="mt-1.5 text-[2rem] font-black leading-none text-amber-950">{round2(summary.totalPendingPo).toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-700">MIL</div>
              <div className="mt-1.5 text-[2rem] font-black leading-none text-violet-950">{round2(summary.mil).toLocaleString()}</div>
            </div>
            <div className={`rounded-xl border px-4 py-2.5 ${summary.netPaperToOrder >= 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className={`text-[11px] font-bold uppercase tracking-[0.16em] ${summary.netPaperToOrder >= 0 ? "text-rose-700" : "text-emerald-700"}`}>Net Paper to Order</div>
              <div className={`mt-1.5 text-[2rem] font-black leading-none ${summary.netPaperToOrder >= 0 ? "text-rose-950" : "text-emerald-950"}`}>{round2(summary.netPaperToOrder).toLocaleString()}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
            <div className="mb-3 flex flex-col gap-3 border-b border-slate-200 pb-3 xl:flex-row xl:items-center xl:justify-end">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
                >
                  <RotateCcw size={16} />
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-5 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
                >
                  <Download size={16} />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-5 text-sm font-bold text-rose-700 shadow-sm transition hover:bg-rose-100"
                >
                  <FileText size={16} />
                  PDF
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_minmax(180px,0.85fr)_minmax(170px,0.8fr)_minmax(170px,0.8fr)]">
              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">RAPC Range + GSM</span>
                <select
                  value={selectedRangeGsm}
                  onChange={(e) => setSelectedRangeGsm(e.target.value)}
                  className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  {rangeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <Calendar size={14} />
                  Upto Date
                </span>
                <input
                  type="date"
                  value={uptoDate}
                  onChange={(e) => setUptoDate(e.target.value)}
                  className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Net Filter</span>
                <select
                  value={netFilter}
                  onChange={(e) => setNetFilter(e.target.value as NetFilter)}
                  className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  {NET_FILTER_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Group Type</span>
                <select
                  value={groupType}
                  onChange={(e) => setGroupType(e.target.value as GroupTypeFilter)}
                  className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  {GROUP_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-blue-700 text-white">
                  <tr>
                    {["RAPC RANGE", "GSM", "Total Paper Requirement", "Total Closing Stock", "Total Pending PO", "MIL", "Net Paper to Order"].map((heading) => (
                      <th key={heading} className="border-r border-black px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em] whitespace-nowrap last:border-r-0">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-sm font-medium text-slate-500">
                        No rows found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={`${row.rapcRange}-${row.gsm}`} className="border-t border-black text-sm text-slate-700 transition hover:bg-sky-50/40">
                        <td className="border-r border-black px-4 py-3 font-semibold text-slate-900">{row.rapcRange}</td>
                        <td className="border-r border-black px-4 py-3">{row.gsm}</td>
                        <td className="border-r border-black px-4 py-3">{row.totalPaperRequirement.toLocaleString()}</td>
                        <td className="border-r border-black px-4 py-3">{row.totalClosingStock.toLocaleString()}</td>
                        <td className="border-r border-black px-4 py-3">{row.totalPendingPo.toLocaleString()}</td>
                        <td className="border-r border-black px-4 py-3">{row.mil.toLocaleString()}</td>
                        <td className={`px-4 py-3 font-bold ${row.netPaperToOrder >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {row.netPaperToOrder.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredRows.length > 0 ? (
                  <tfoot className="border-t border-black bg-slate-100">
                    <tr>
                      <td className="border-r border-black px-4 py-3 text-sm font-black text-slate-900" colSpan={2}>Grand Total</td>
                      <td className="border-r border-black px-4 py-3 text-sm font-black text-slate-900">{round2(summary.totalPaperRequirement).toLocaleString()}</td>
                      <td className="border-r border-black px-4 py-3 text-sm font-black text-slate-900">{round2(summary.totalClosingStock).toLocaleString()}</td>
                      <td className="border-r border-black px-4 py-3 text-sm font-black text-slate-900">{round2(summary.totalPendingPo).toLocaleString()}</td>
                      <td className="border-r border-black px-4 py-3 text-sm font-black text-slate-900">{round2(summary.mil).toLocaleString()}</td>
                      <td className={`px-4 py-3 text-sm font-black ${summary.netPaperToOrder >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {round2(summary.netPaperToOrder).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
