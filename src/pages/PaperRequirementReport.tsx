import React, { useMemo, useState, useEffect } from "react";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Download, FileText, RotateCcw, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Indent,
  IndentLine,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
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
import { useNpdItems } from "../hooks/useNpdItems";
import { buildReelStockRows } from "../lib/reelStock";

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
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [productions] = useData<Production>("productions", []);
  const npdItems = useNpdItems();
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
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
    const itemMap = new Map(npdItems.map((item) => [item.id, item]));
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
    buildReelStockRows({
      materials,
      materialIn,
      packingSlips,
      issueReelLines,
      returnReelLines,
      includeMaterialIn: (entry) => {
        const entryDate = parseAppDate(entry.date || entry.timestamp);
        return Boolean(entryDate && normalizeDate(entryDate).getTime() <= filteredTimestamp);
      },
      includeIssueLine: (line) => {
        const issueDate = parseAppDate(issueMap.get(line.materialIssueId)?.date);
        return Boolean(issueDate && normalizeDate(issueDate).getTime() <= filteredTimestamp);
      },
      includeReturnLine: (line) => {
        const returnDate = parseAppDate(returnMap.get(line.materialReturnId)?.date);
        return Boolean(returnDate && normalizeDate(returnDate).getTime() <= filteredTimestamp);
      },
    })
      .filter((row) => row.availableWeight > 0)
      .forEach((row) => {
        const material = materialMap.get(row.materialId);
        const rapcRange = resolveRapcValue(getMaterialRapcInput(material), effectiveRanges);
        const gsm = Number(material?.gsm || 0);
        if (!rapcRange || !gsm) return;
        const key = makeKey(rapcRange, gsm);
        stockByKey.set(key, (stockByKey.get(key) || 0) + row.availableWeight);
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
    npdItems,
    materialIn,
    materials,
    packingSlips,
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
    setSearchTerm("");
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

    autoTable(doc, {
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

    autoTable(doc, {
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
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Paper Requirement Report</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Paper Requirement</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{round2(summary.totalPaperRequirement).toLocaleString()}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Closing Stock</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{round2(summary.totalClosingStock).toLocaleString()}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Pending PO</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{round2(summary.totalPendingPo).toLocaleString()}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">MIL</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{round2(summary.mil).toLocaleString()}</div>
        </div>
        <div className={`rounded border p-4 ${summary.netPaperToOrder >= 0 ? "border-rose-300 bg-rose-50" : "border-emerald-300 bg-emerald-50"}`}>
          <div className={`text-xs font-black uppercase ${summary.netPaperToOrder >= 0 ? "text-rose-700" : "text-emerald-700"}`}>Net Paper To Order</div>
          <div className={`mt-1 text-2xl font-black ${summary.netPaperToOrder >= 0 ? "text-rose-900" : "text-emerald-900"}`}>{round2(summary.netPaperToOrder).toLocaleString()}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.1fr)_minmax(220px,1fr)_minmax(140px,0.7fr)_repeat(2,minmax(150px,0.8fr))_repeat(3,auto)] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <select
            value={selectedRangeGsm}
            onChange={(e) => setSelectedRangeGsm(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            {rangeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input
            type="date"
            value={uptoDate}
            onChange={(e) => setUptoDate(e.target.value)}
            title="Upto Date"
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <select
            value={netFilter}
            onChange={(e) => setNetFilter(e.target.value as NetFilter)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            {NET_FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <select
            value={groupType}
            onChange={(e) => setGroupType(e.target.value as GroupTypeFilter)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            {GROUP_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
          >
            <RotateCcw size={14} />
            Clear
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Download size={14} />
            Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-rose-700 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100"
          >
            <FileText size={14} />
            PDF
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-indigo-700 text-white">
                {["RAPC Range", "GSM", "Total Paper Requirement", "Total Closing Stock", "Total Pending PO", "MIL", "Net Paper To Order"].map((heading) => (
                  <th key={heading} className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">
                    No rows found for the selected filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={`${row.rapcRange}-${row.gsm}`} className="text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.rapcRange}</td>
                    <td className="border-2 border-black px-3 py-3">{row.gsm}</td>
                    <td className="border-2 border-black bg-blue-50/50 px-3 py-3 text-right">{row.totalPaperRequirement.toLocaleString()}</td>
                    <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right font-semibold text-emerald-900">{row.totalClosingStock.toLocaleString()}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right text-amber-900">{row.totalPendingPo.toLocaleString()}</td>
                    <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right text-purple-900">{row.mil.toLocaleString()}</td>
                    <td className={`border-2 border-black px-3 py-3 text-right font-black ${row.netPaperToOrder >= 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`}>
                      {row.netPaperToOrder.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredRows.length > 0 ? (
              <tfoot className="sticky bottom-0 z-10 bg-slate-100">
                <tr>
                  <td className="border-2 border-black px-3 py-3 text-sm font-black text-black" colSpan={2}>Grand Total</td>
                  <td className="border-2 border-black bg-blue-50 px-3 py-3 text-right text-sm font-black text-black">{round2(summary.totalPaperRequirement).toLocaleString()}</td>
                  <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right text-sm font-black text-emerald-900">{round2(summary.totalClosingStock).toLocaleString()}</td>
                  <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right text-sm font-black text-amber-900">{round2(summary.totalPendingPo).toLocaleString()}</td>
                  <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right text-sm font-black text-purple-900">{round2(summary.mil).toLocaleString()}</td>
                  <td className={`border-2 border-black px-3 py-3 text-right text-sm font-black ${summary.netPaperToOrder >= 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`}>
                    {round2(summary.netPaperToOrder).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );

}
