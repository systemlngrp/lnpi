import React, { useMemo, useState } from "react";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Select from "react-select";
import { FileText, RotateCcw, X } from "lucide-react";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import {
  DispatchPlan,
  LoadingSlip,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnReelLine,
  Order,
  OrderSchedule,
  Production,
  PurchaseOrder,
  PurchaseOrderLine,
  RapcRange,
  Setting,
} from "../types";
import { formatDate } from "../lib/serial";
import { getEffectiveRapcRanges } from "../lib/rapcRanges";
import { buildReelStockRows } from "../lib/reelStock";
import type { OrderCatalogItem } from "../lib/orderItems";
import { calculateInternalRapc, calculateInternalUps } from "../lib/internalUps";

type NetFilter =
  | "All"
  | "Positive (>100)"
  | "Negative (< -100)"
  | "All Positive"
  | "All Negative"
  | "Below 100 Absolute"
  | "Above 100 Absolute"
  | "Zero Inputs + Net > 0";
type GroupTypeFilter = "All" | "Positive" | "Negative";
type ChartLimit = "All" | "Top 15" | "Top 30" | "Top 50";
type RapcGroup = number | "Unmapped";

type GroupKey = { rapcRange: RapcGroup; gsm: number };

type ReportRow = GroupKey & {
  totalPaperRequirement: number;
  totalClosingStock: number;
  totalPendingPo: number;
  mil: number;
  netPaperToOrder: number;
  consumption: number;
};

type Summary = Omit<ReportRow, "rapcRange" | "gsm">;
type RangeGsmOption = { value: string; label: string };

const NET_FILTER_OPTIONS: NetFilter[] = ["All", "Positive (>100)", "Negative (< -100)", "All Positive", "All Negative", "Below 100 Absolute", "Above 100 Absolute", "Zero Inputs + Net > 0"];
const GROUP_TYPE_OPTIONS: GroupTypeFilter[] = ["All", "Positive", "Negative"];
const CHART_LIMIT_OPTIONS: ChartLimit[] = ["All", "Top 15", "Top 30", "Top 50"];
const KG_CONVERSION_FACTOR = 1000000000;

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
  return Number(Number(value || 0).toFixed(2));
}

function formatQty(value: number) {
  return round2(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function makeKey(rapcRange: RapcGroup, gsm: number) {
  return `${rapcRange}__${gsm}`;
}

function parseKey(key: string): GroupKey {
  const [rapcRangeRaw, gsmRaw] = key.split("__");
  return { rapcRange: rapcRangeRaw === "Unmapped" ? "Unmapped" : Number(rapcRangeRaw || 0), gsm: Number(gsmRaw || 0) };
}

function getRangeGsmLabel(row: GroupKey) {
  return `${row.rapcRange} - ${row.gsm}`;
}

function resolveRapcValue(input: number, ranges: RapcRange[]): RapcGroup {
  if (!Number.isFinite(input) || input <= 0) return "Unmapped";
  const match = getEffectiveRapcRanges(ranges).find((row) => input >= Number(row.from || 0) && input <= Number(row.to || 0));
  return match ? Number(match.rapcRange || 0) : "Unmapped";
}

function getMaterialRapcInput(material?: Material | null) {
  const rapc = Number((material as any)?.rapc || 0);
  if (rapc > 0) return rapc;
  const size = Number(material?.size || 0);
  return size > 0 ? size * 10 : 0;
}

function addToMap(map: Map<string, number>, row: GroupKey, qty: number) {
  if (!row.gsm || !Number.isFinite(row.gsm) || !Number.isFinite(qty) || qty === 0) return;
  const key = makeKey(row.rapcRange, row.gsm);
  map.set(key, (map.get(key) || 0) + qty);
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function getRawValue(item: OrderCatalogItem | undefined, key: string) {
  return item?.raw?.[key] ?? (item as any)?.[key];
}

function getItemNumber(item: OrderCatalogItem | undefined, ...keys: string[]) {
  return firstPositiveNumber(...keys.map((key) => getRawValue(item, key)));
}

function getFgInternalRapc(item: OrderCatalogItem | undefined, formulaMode?: string) {
  if (item?.source !== "FG") return 0;
  const raw = item.raw || {};
  return firstPositiveNumber(getItemNumber(item, "internalRapc"), calculateInternalRapc(raw, formulaMode));
}

function getFgInternalUps(item: OrderCatalogItem | undefined) {
  if (item?.source !== "FG") return 0;
  return firstPositiveNumber(getItemNumber(item, "internalUps"), calculateInternalUps(getRawValue(item, "rapcForSingleBox")));
}

function buildLeastCostByErp(productions: Production[]) {
  const map = new Map<string, Production>();
  productions.forEach((production) => {
    if (production.status === "Cancelled" || production.cancelTimestamp) return;
    const erp = String(production.erpCode || production.masterErp || "").trim().toLowerCase();
    const gsm = Number(production.gsm || 0);
    if (!erp || !Number.isFinite(gsm) || gsm <= 0) return;
    const current = map.get(erp);
    if (!current || gsm < Number(current.gsm || 0)) map.set(erp, production);
  });
  return map;
}

function calculateLayerWeightKg(args: { cuttingSize: number; rapc: number; gsm: number; ups: number; takeUpFactor?: number }) {
  const { cuttingSize, rapc, gsm, ups } = args;
  if (cuttingSize <= 0 || rapc <= 0 || gsm <= 0 || ups <= 0) return 0;
  const factor = args.takeUpFactor && args.takeUpFactor > 0 ? args.takeUpFactor : 1;
  return (cuttingSize * rapc * gsm * factor) / (KG_CONVERSION_FACTOR * ups);
}

function passesNetFilter(row: ReportRow, filter: NetFilter) {
  const net = row.netPaperToOrder;
  const absoluteNet = Math.abs(net);
  if (filter === "Positive (>100)") return net > 100;
  if (filter === "Negative (< -100)") return net < -100;
  if (filter === "All Positive") return net > 0;
  if (filter === "All Negative") return net < 0;
  if (filter === "Below 100 Absolute") return absoluteNet < 100;
  if (filter === "Above 100 Absolute") return absoluteNet > 100;
  if (filter === "Zero Inputs + Net > 0") {
    return net > 0 && [row.totalPaperRequirement, row.totalClosingStock, row.totalPendingPo, row.mil].some((value) => round2(value) === 0);
  }
  return true;
}

function passesGroupType(row: ReportRow, filter: GroupTypeFilter) {
  if (filter === "Positive") return row.netPaperToOrder > 0;
  if (filter === "Negative") return row.netPaperToOrder < 0;
  return true;
}

function summarizeRows(rows: ReportRow[]): Summary {
  return rows.reduce(
    (acc, row) => ({
      totalPaperRequirement: acc.totalPaperRequirement + row.totalPaperRequirement,
      totalClosingStock: acc.totalClosingStock + row.totalClosingStock,
      totalPendingPo: acc.totalPendingPo + row.totalPendingPo,
      mil: acc.mil + row.mil,
      netPaperToOrder: acc.netPaperToOrder + row.netPaperToOrder,
      consumption: acc.consumption + row.consumption,
    }),
    { totalPaperRequirement: 0, totalClosingStock: 0, totalPendingPo: 0, mil: 0, netPaperToOrder: 0, consumption: 0 }
  );
}

function getChartLimitCount(limit: ChartLimit) {
  if (limit === "Top 15") return 15;
  if (limit === "Top 50") return 50;
  if (limit === "Top 30") return 30;
  return Infinity;
}

export function PaperRequirementReport() {
  const [productions] = useData<Production>("productions", []);
  const [orders] = useData<Order>("orders", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueEntries] = useData<MaterialIssue>("material-issues", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnEntries] = useData<MaterialReturn>("material-returns", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [rapcRanges] = useData<RapcRange>("rapc-ranges", []);
  const [settings] = useData<Setting>("settings", []);
  const { resolveOrderItem } = useOrderItemCatalog();

  const [selectedRangeGsm, setSelectedRangeGsm] = useState<RangeGsmOption | null>(null);
  const [uptoDate, setUptoDate] = useState(() => toDateInput(new Date()));
  const [netFilter, setNetFilter] = useState<NetFilter>("All Positive");
  const [groupType, setGroupType] = useState<GroupTypeFilter>("All");
  const [chartLimit, setChartLimit] = useState<ChartLimit>("Top 30");
  const [detailRow, setDetailRow] = useState<ReportRow | null>(null);

  const filteredTimestamp = useMemo(() => {
    const parsed = parseAppDate(uptoDate);
    return parsed ? normalizeDate(parsed).getTime() : normalizeDate(new Date()).getTime();
  }, [uptoDate]);

  const reportData = useMemo<ReportRow[]>(() => {
    const effectiveRanges = getEffectiveRapcRanges(rapcRanges);
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const issueMap = new Map(issueEntries.map((entry) => [entry.id, entry]));
    const returnMap = new Map(returnEntries.map((entry) => [entry.id, entry]));
    const leastCostByErp = buildLeastCostByErp(productions);
    const reelFormulaMode = settings[0]?.reelAsPerCalculation;

    const invoicedQtyBySchedule = new Map<string, number>();
    const plansById = new Map(dispatchPlans.map((plan) => [plan.id, plan]));
    loadingSlips.forEach((slip) => {
      if (!slip.invoiceId) return;
      (slip.lines || []).forEach((line) => {
        const scheduleId = plansById.get(line.dispatchPlanId)?.scheduleId;
        if (!scheduleId) return;
        invoicedQtyBySchedule.set(scheduleId, (invoicedQtyBySchedule.get(scheduleId) || 0) + Number(line.loadedQty || 0));
      });
    });

    const requirementByKey = new Map<string, number>();
    schedules.forEach((schedule) => {
      const scheduledDate = parseAppDate(schedule.scheduledDate);
      if (!scheduledDate || normalizeDate(scheduledDate).getTime() > filteredTimestamp) return;

      const order = orderMap.get(schedule.orderId);
      if (!order || order.status === "Cancelled") return;
      const pendingQty = Math.max(0, Number(schedule.qty || 0) - Number(schedule.canceledQty || 0) - Number(invoicedQtyBySchedule.get(schedule.id) || 0));
      if (pendingQty <= 0) return;

      const item = resolveOrderItem(order);
      const erp = String(order.erpCode || item?.erp || "").trim().toLowerCase();
      const leastCost = erp ? leastCostByErp.get(erp) : undefined;
      const rapc = firstPositiveNumber(getFgInternalRapc(item, reelFormulaMode), getItemNumber(item, "rapc", "rapcForSingleBox"));
      const rapcRange = resolveRapcValue(rapc, effectiveRanges);
      const cuttingSize = firstPositiveNumber(getItemNumber(item, "cuttingSize", "cuttingWithTrimming", "cuttingSizeLengthPiece"), leastCost?.cuttingWithTrimming);
      const ups = firstPositiveNumber(getFgInternalUps(item), getItemNumber(item, "ups", "noOfUps", "noOfUpsForRapc"));
      const takeUpFactor = firstPositiveNumber(getItemNumber(item, "takeUpFactor", "takeUp"), leastCost?.takeUpFactor) || 1;
      const layers = [
        { gsm: firstPositiveNumber(leastCost?.l1, getItemNumber(item, "l1", "top")), isFlute: false },
        { gsm: firstPositiveNumber(leastCost?.f1, getItemNumber(item, "f1")), isFlute: true },
        { gsm: firstPositiveNumber(leastCost?.l2, getItemNumber(item, "l2")), isFlute: false },
        { gsm: firstPositiveNumber(leastCost?.f2, getItemNumber(item, "f2")), isFlute: true },
        { gsm: firstPositiveNumber(leastCost?.l3, getItemNumber(item, "l3")), isFlute: false },
      ];

      layers.forEach((layer) => {
        const weightPerItem = calculateLayerWeightKg({ cuttingSize, rapc, gsm: layer.gsm, ups, takeUpFactor: layer.isFlute ? takeUpFactor : 1 });
        addToMap(requirementByKey, { rapcRange, gsm: layer.gsm }, weightPerItem * pendingQty);
      });
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
        addToMap(stockByKey, { rapcRange: resolveRapcValue(getMaterialRapcInput(material), effectiveRanges), gsm: Number(material?.gsm || 0) }, row.availableWeight);
      });

    const receivedByPoLine = new Map<string, number>();
    materialIn
      .filter((entry) => {
        const entryDate = parseAppDate(entry.date || entry.timestamp);
        return Boolean(entryDate && normalizeDate(entryDate).getTime() <= filteredTimestamp);
      })
      .forEach((entry) => {
        (entry.lines || []).forEach((line) => {
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
      const pendingQty = Math.max(0, Number(line.qty || 0) - Number(receivedByPoLine.get(line.id) || 0) - Number(line.cancelledQty || 0));
      if (pendingQty <= 0) return;
      addToMap(pendingPoByKey, { rapcRange: resolveRapcValue(getMaterialRapcInput(material), effectiveRanges), gsm: Number(material.gsm || 0) }, pendingQty);
    });

    const consumptionByKey = new Map<string, number>();
    issueReelLines.forEach((line) => {
      const issueDate = parseAppDate(issueMap.get(line.materialIssueId)?.date);
      if (!issueDate || normalizeDate(issueDate).getTime() > filteredTimestamp) return;
      const material = materialMap.get(line.materialId);
      if (!material || material.type !== "Reel") return;
      addToMap(consumptionByKey, { rapcRange: resolveRapcValue(getMaterialRapcInput(material), effectiveRanges), gsm: Number(material.gsm || 0) }, Number(line.weightKg || 0));
    });
    returnReelLines.forEach((line) => {
      const returnDate = parseAppDate(returnMap.get(line.materialReturnId)?.date);
      if (!returnDate || normalizeDate(returnDate).getTime() > filteredTimestamp) return;
      const material = materialMap.get(line.materialId);
      if (!material || material.type !== "Reel") return;
      addToMap(consumptionByKey, { rapcRange: resolveRapcValue(getMaterialRapcInput(material), effectiveRanges), gsm: Number(material.gsm || 0) }, -Number(line.weightKg || 0));
    });

    const allKeys = new Set<string>([
      ...Array.from(requirementByKey.keys()),
      ...Array.from(stockByKey.keys()),
      ...Array.from(pendingPoByKey.keys()),
      ...Array.from(consumptionByKey.keys()),
    ]);

    return Array.from(allKeys)
      .map((key) => {
        const { rapcRange, gsm } = parseKey(key);
        const totalPaperRequirement = round2(requirementByKey.get(key) || 0);
        const totalClosingStock = round2(stockByKey.get(key) || 0);
        const totalPendingPo = round2(pendingPoByKey.get(key) || 0);
        const consumption = round2(Math.max(0, consumptionByKey.get(key) || 0));
        const mil = round2((consumption * 7) / 90);
        const calculatedNetPaperToOrder = totalClosingStock > mil
          ? round2(totalPaperRequirement - totalClosingStock - totalPendingPo)
          : round2((mil - totalClosingStock) + (totalPaperRequirement - totalClosingStock - totalPendingPo));
        const netPaperToOrder = Math.max(0, calculatedNetPaperToOrder);
        return { rapcRange, gsm, totalPaperRequirement, totalClosingStock, totalPendingPo, mil, netPaperToOrder, consumption };
      })
      .filter((row) => row.gsm > 0)
      .sort((a, b) => {
        if (a.rapcRange === "Unmapped" && b.rapcRange !== "Unmapped") return 1;
        if (a.rapcRange !== "Unmapped" && b.rapcRange === "Unmapped") return -1;
        return Number(a.rapcRange) - Number(b.rapcRange) || a.gsm - b.gsm;
      });
  }, [
    dispatchPlans,
    filteredTimestamp,
    issueEntries,
    issueReelLines,
    loadingSlips,
    materialIn,
    materials,
    orders,
    packingSlips,
    productions,
    purchaseOrderLines,
    purchaseOrders,
    rapcRanges,
    resolveOrderItem,
    returnEntries,
    returnReelLines,
    schedules,
    settings,
  ]);

  const rangeOptions = useMemo<RangeGsmOption[]>(() => reportData.map((row) => {
    const label = getRangeGsmLabel(row);
    return { value: label, label };
  }), [reportData]);

  const filteredRows = useMemo(() => reportData.filter((row) => {
    if (selectedRangeGsm && getRangeGsmLabel(row) !== selectedRangeGsm.value) return false;
    if (!passesNetFilter(row, netFilter)) return false;
    if (!passesGroupType(row, groupType)) return false;
    return true;
  }), [groupType, netFilter, reportData, selectedRangeGsm]);

  const summary = useMemo(() => summarizeRows(filteredRows), [filteredRows]);

  const chartRows = useMemo(() => {
    const limit = getChartLimitCount(chartLimit);
    return [...filteredRows]
      .sort((a, b) => Math.abs(b.netPaperToOrder) - Math.abs(a.netPaperToOrder))
      .slice(0, limit)
      .map((row) => ({ ...row, label: getRangeGsmLabel(row) }));
  }, [chartLimit, filteredRows]);

  const handleClear = () => {
    setSelectedRangeGsm(null);
    setUptoDate(toDateInput(new Date()));
    setNetFilter("All Positive");
    setGroupType("All");
    setChartLimit("Top 30");
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text("Paper to Order Report", 14, 16);
    doc.setFontSize(9);
    doc.text(`Upto Date: ${formatDate(uptoDate)} | Range + GSM: ${selectedRangeGsm?.label || "All"} | Net Filter: ${netFilter} | Group Type: ${groupType} | Graph: ${chartLimit}`, 14, 24);

    autoTable(doc, {
      head: [["Metric", "Value"]],
      body: [
        ["Total Paper Requirement", formatQty(summary.totalPaperRequirement)],
        ["Total Closing Stock", formatQty(summary.totalClosingStock)],
        ["Total Pending PO", formatQty(summary.totalPendingPo)],
        ["MIL", formatQty(summary.mil)],
        ["Net Paper to Order", formatQty(summary.netPaperToOrder)],
        ["Total Groups", filteredRows.length],
      ],
      startY: 30,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 55] },
    });

    autoTable(doc, {
      head: [["Chart Rank", "RAPC Range + GSM", "Net Paper to Order"]],
      body: chartRows.map((row, index) => [index + 1, row.label, formatQty(row.netPaperToOrder)]),
      startY: (doc as any).lastAutoTable.finalY + 7,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    autoTable(doc, {
      head: [["RAPC Range", "GSM", "Total Paper Requirement", "Total Closing Stock", "Total Pending PO", "MIL", "Net Paper to Order"]],
      body: [
        ...filteredRows.map((row) => [
          row.rapcRange,
          row.gsm,
          formatQty(row.totalPaperRequirement),
          formatQty(row.totalClosingStock),
          formatQty(row.totalPendingPo),
          formatQty(row.mil),
          formatQty(row.netPaperToOrder),
        ]),
        ["Grand Total", "", formatQty(summary.totalPaperRequirement), formatQty(summary.totalClosingStock), formatQty(summary.totalPendingPo), formatQty(summary.mil), formatQty(summary.netPaperToOrder)],
      ],
      startY: (doc as any).lastAutoTable.finalY + 7,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.8 },
      headStyles: { fillColor: [31, 41, 55] },
    });

    doc.save(`Paper_To_Order_${uptoDate}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Paper To Order View</h2>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Scheduled Orders to Paper Requirement to Stock, Pending PO, MIL and Net Purchase Need</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <MetricTile label="Total Paper Requirement" value={summary.totalPaperRequirement} className="border-blue-300 bg-blue-50 text-blue-900" />
        <MetricTile label="Closing Stock" value={summary.totalClosingStock} className="border-emerald-300 bg-emerald-50 text-emerald-900" />
        <MetricTile label="Pending PO" value={summary.totalPendingPo} className="border-amber-300 bg-amber-50 text-amber-900" />
        <MetricTile label="MIL" value={summary.mil} className="border-violet-300 bg-violet-50 text-violet-900" />
        <MetricTile label="Net Paper To Order" value={summary.netPaperToOrder} className={summary.netPaperToOrder >= 0 ? "border-rose-300 bg-rose-50 text-rose-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"} />
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(150px,0.7fr)_minmax(250px,1.2fr)_repeat(3,minmax(160px,0.8fr))_repeat(2,auto)] xl:items-center">
          <input type="date" value={uptoDate} onChange={(e) => setUptoDate(e.target.value)} title="Upto Date" className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600" />
          <Select
            value={selectedRangeGsm}
            onChange={(option) => setSelectedRangeGsm(option as RangeGsmOption | null)}
            options={rangeOptions}
            isClearable
            placeholder="RAPC Range + GSM"
            menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            menuPosition="fixed"
            styles={{
              control: (provided) => ({ ...provided, minHeight: 42, borderColor: "black", borderWidth: 2, borderRadius: 4 }),
              menu: (provided) => ({ ...provided, zIndex: 9999 }),
              menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
            }}
          />
          <select value={netFilter} onChange={(e) => setNetFilter(e.target.value as NetFilter)} className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600">
            {NET_FILTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={groupType} onChange={(e) => setGroupType(e.target.value as GroupTypeFilter)} className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600">
            {GROUP_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={chartLimit} onChange={(e) => setChartLimit(e.target.value as ChartLimit)} className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600">
            {CHART_LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <button type="button" onClick={handleClear} className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"><RotateCcw size={14} />Clear</button>
          <button type="button" onClick={handleExportPdf} className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded border border-rose-700 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100"><FileText size={14} />PDF</button>
        </div>
      </div>

      <div className="rounded border-2 border-black bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-black uppercase text-black">Net Paper To Order Graph</h3>
          <span className="text-xs font-bold text-slate-500">{chartRows.length.toLocaleString()} group(s)</span>
        </div>
        <div className="h-[420px] min-h-[300px]">
          {chartRows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm font-bold text-slate-500">No chart data for the selected filters.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 30, bottom: 8, left: 70 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => Number(value).toLocaleString()} />
                <YAxis type="category" dataKey="label" width={95} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatQty(Number(value))} labelFormatter={(label) => `RAPC Range + GSM: ${label}`} />
                <Bar dataKey="netPaperToOrder" radius={[0, 4, 4, 0]} onClick={(row) => setDetailRow(row.payload as ReportRow)}>
                  {chartRows.map((row) => <Cell key={row.label} fill={row.netPaperToOrder >= 0 ? "#e11d48" : "#059669"} cursor="pointer" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-250px)] w-full overflow-auto">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-20">
              <tr>
                {["RAPC Range", "GSM", "Total Paper Requirement", "Total Closing Stock", "Total Pending PO", "MIL", "Net Paper To Order"].map((heading) => (
                  <th key={heading} className="sticky top-0 z-20 whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase text-white">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={7} className="border-2 border-black px-6 py-10 text-center text-sm font-medium text-black">No rows found for the selected filters.</td></tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={makeKey(row.rapcRange, row.gsm)} onClick={() => setDetailRow(row)} className="cursor-pointer text-black hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 font-bold">{row.rapcRange}</td>
                    <td className="border-2 border-black px-3 py-3 text-right">{row.gsm}</td>
                    <td className="border-2 border-black bg-blue-50/50 px-3 py-3 text-right">{formatQty(row.totalPaperRequirement)}</td>
                    <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right font-semibold text-emerald-900">{formatQty(row.totalClosingStock)}</td>
                    <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right text-amber-900">{formatQty(row.totalPendingPo)}</td>
                    <td className="border-2 border-black bg-violet-50 px-3 py-3 text-right text-violet-900">{formatQty(row.mil)}</td>
                    <td className={`border-2 border-black px-3 py-3 text-right font-black ${row.netPaperToOrder >= 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`}>{formatQty(row.netPaperToOrder)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredRows.length > 0 ? (
              <tfoot className="sticky bottom-0 z-10 bg-slate-100">
                <tr>
                  <td className="border-2 border-black px-3 py-3 text-sm font-black text-black" colSpan={2}>Grand Total</td>
                  <td className="border-2 border-black bg-blue-50 px-3 py-3 text-right text-sm font-black text-black">{formatQty(summary.totalPaperRequirement)}</td>
                  <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right text-sm font-black text-emerald-900">{formatQty(summary.totalClosingStock)}</td>
                  <td className="border-2 border-black bg-amber-50 px-3 py-3 text-right text-sm font-black text-amber-900">{formatQty(summary.totalPendingPo)}</td>
                  <td className="border-2 border-black bg-violet-50 px-3 py-3 text-right text-sm font-black text-violet-900">{formatQty(summary.mil)}</td>
                  <td className={`border-2 border-black px-3 py-3 text-right text-sm font-black ${summary.netPaperToOrder >= 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900"}`}>{formatQty(summary.netPaperToOrder)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {detailRow ? <CalculationDetailModal row={detailRow} onClose={() => setDetailRow(null)} /> : null}
    </div>
  );
}

function MetricTile({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded border p-4 ${className}`}>
      <div className="text-xs font-black uppercase opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-black">{formatQty(value)}</div>
    </div>
  );
}

function CalculationDetailModal({ row, onClose }: { row: ReportRow; onClose: () => void }) {
  const formula = row.totalClosingStock > row.mil ? "Requirement - Closing Stock - Pending PO" : "(MIL - Closing Stock) + (Requirement - Closing Stock - Pending PO)";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded border-2 border-black bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b-2 border-black p-4">
          <div>
            <h3 className="text-base font-black uppercase text-black">Calculation Details</h3>
            <div className="mt-1 text-sm font-bold text-slate-600">{getRangeGsmLabel(row)}</div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-100" aria-label="Close calculation details" title="Close"><X size={16} /></button>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <DetailValue label="RAPC Range" value={row.rapcRange} />
          <DetailValue label="GSM" value={row.gsm} />
          <DetailValue label="Total Paper Requirement" value={formatQty(row.totalPaperRequirement)} />
          <DetailValue label="Total Closing Stock" value={formatQty(row.totalClosingStock)} />
          <DetailValue label="Total Pending PO" value={formatQty(row.totalPendingPo)} />
          <DetailValue label="MIL" value={formatQty(row.mil)} />
          <DetailValue label="Net Paper to Order" value={formatQty(row.netPaperToOrder)} />
          <DetailValue label="Formula Applied" value={formula} />
        </div>
      </div>
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-black bg-slate-50 p-3">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-black">{value}</div>
    </div>
  );
}
