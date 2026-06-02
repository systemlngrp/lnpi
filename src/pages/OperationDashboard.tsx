import React, { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useData } from "../hooks/useData";
import type {
  Company,
  DispatchPlan,
  Invoice,
  Item,
  LoadingSlip,
  LoadingSlipLine,
  MaterialIssue,
  MaterialIssueLine,
  MaterialReturn,
  MaterialReturnLine,
  OperationDashboardMetricCard,
  OperationDashboardSummary,
  Order,
  OrderSchedule,
  Production,
  ProductionProcessing,
  Setting,
} from "../types";
import { TableControls } from "../components/TableControls";
import { ExcelExport } from "../components/ExcelExport";
import { exportsAllowed } from "../lib/exportPolicy";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "../lib/productionMaterialUsage";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";
import { getRequiredMachinesForType, parseMandatoryMachinesByType } from "../lib/mandatoryMachines";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { formatDate } from "../lib/serial";
import { cn, formatCurrency, formatNumber } from "../lib/utils";
import {
  buildOperationDashboardSummary,
  formatDisplayDate,
  getLocalDateInputValue,
  getSafeRange,
  isDateWithinRange,
} from "../lib/operationDashboard";

type ColumnId =
  | "jobNo"
  | "orderNo"
  | "erpCode"
  | "company"
  | "planDate"
  | "itemName"
  | "type"
  | "mandatory"
  | "plannedQty"
  | "loadedQty"
  | "paper"
  | "liner"
  | "print"
  | "paste"
  | "stitch"
  | "punch"
  | "glue"
  | "l"
  | "b"
  | "h"
  | "lOd"
  | "wOd"
  | "hOd"
  | "flap"
  | "deckle"
  | "cutting"
  | "ply"
  | "flute"
  | "top"
  | "gsm"
  | "leastGsm"
  | "color1"
  | "color2"
  | "printingColor"
  | "paperReq"
  | "topPaperWtKg"
  | "linerWtKg"
  | "totalJobWt"
  | "lineReq"
  | "totalWt"
  | "avgWt"
  | "wastage"
  | "realPerKg"
  | "processingStatus"
  | "status"
  | "jobCloser"
  | "closeDate"
  | "actualPaperUsed"
  | "wastagePct";

type ProcessingTotals = {
  paper: number;
  liner: number;
  printing: number;
  pasting: number;
  stitching: number;
  punching: number;
  gluing: number;
};

type OperationRow = {
  production: Production;
  item?: Item;
  schedule?: OrderSchedule;
  order?: Order;
  company?: Company;
  mandatoryCell: React.ReactNode;
  processingStatusText: string;
  processingTotals: ProcessingTotals;
  loadedQty: number;
  leastGsm: number | null;
  actualPaperUsed: number;
  planPaper: number;
  wastagePct: number | null;
};

type ColumnDef = {
  id: ColumnId;
  label: string;
  align?: "left" | "center" | "right";
  className?: string;
  render: (row: OperationRow) => React.ReactNode;
};

type SummaryCardConfig = {
  id: string;
  className?: string;
  tone: string;
  valueTone?: string;
};

type SummaryGroupConfig = {
  groupId: string;
  className?: string;
  gridClassName: string;
  cards: SummaryCardConfig[];
};

const STORAGE_HIDDEN_KEY = "lnpi.operationDashboard.columns.hidden.v2";
const STORAGE_ORDER_KEY = "lnpi.operationDashboard.columns.order.v2";

const SUMMARY_GROUP_CONFIGS: SummaryGroupConfig[] = [
  {
    groupId: "headline",
    className: "lg:col-span-2",
    gridClassName: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
    cards: [
      { id: "production", tone: "bg-[#00d4ff]" },
      { id: "previousProduction", tone: "bg-[#c8f7ff]" },
      { id: "planValue", tone: "bg-[#ffe8a3]" },
      { id: "nextPlanValue", tone: "bg-[#f5d6ff]" },
      { id: "linearMeter", tone: "bg-[#8f7cc9] text-white", valueTone: "text-white" },
      { id: "wastage", tone: "bg-[#ff1e1e] text-white", valueTone: "text-white" },
    ],
  },
  {
    groupId: "dispatch",
    className: "lg:col-span-2",
    gridClassName: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
    cards: [
      { id: "rangeSale", tone: "bg-[#16e0eb]" },
      { id: "previousSale", tone: "bg-[#efc3c3]" },
      { id: "dispatchPlannedQty", tone: "bg-[#ff6b6b] text-white", valueTone: "text-white" },
      { id: "dispatchLoadedQty", tone: "bg-[#294f92] text-white", valueTone: "text-white" },
      { id: "loadingQty", tone: "bg-[#6a54b6] text-white", valueTone: "text-white" },
      { id: "invoiceCount", tone: "bg-[#fff38f]" },
    ],
  },
  {
    groupId: "workflow",
    className: "lg:col-span-2",
    gridClassName: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
    cards: [
      { id: "pendingPlanningCount", tone: "bg-[#ffffff]" },
      { id: "pendingPlanningValue", tone: "bg-[#ff8b8b] text-white", valueTone: "text-white" },
      { id: "wipQty", tone: "bg-[#00e5ef]" },
      { id: "activeJobs", tone: "bg-[#b08a00] text-white", valueTone: "text-white" },
      { id: "cancelledJobs", tone: "bg-[#f4f4f4]" },
      { id: "pendingTally", tone: "bg-[#d7f7c8]" },
    ],
  },
  {
    groupId: "operations",
    className: "lg:col-span-1",
    gridClassName: "grid-cols-1 md:grid-cols-2 xl:grid-cols-2",
    cards: [
      { id: "paper", tone: "bg-[#1f1fff] text-white", valueTone: "text-white" },
      { id: "liner", tone: "bg-[#0014ff] text-white", valueTone: "text-white" },
      { id: "printing", tone: "bg-[#f9ef00]" },
      { id: "pasting", tone: "bg-[#f9ef00]" },
      { id: "stitching", tone: "bg-[#f9ef00]" },
      { id: "processingEntries", tone: "bg-[#ffffff]" },
    ],
  },
  {
    groupId: "stock",
    className: "lg:col-span-1",
    gridClassName: "grid-cols-1 md:grid-cols-2 xl:grid-cols-2",
    cards: [
      { id: "actualPaperUsed", tone: "bg-[#ffffff]" },
      { id: "planPaper", tone: "bg-[#ffffff]" },
      { id: "pendingConsumption", tone: "bg-[#fff38f]" },
      { id: "fgStock", tone: "bg-[#f8f8f8]" },
      { id: "starch", tone: "bg-[#f8f8f8]" },
      { id: "reelStock", tone: "bg-[#f8f8f8]" },
    ],
  },
];

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getPlanPaper(p: Production) {
  const total = Number(p.totalJobWeight || 0);
  if (total > 0) return total;
  const top = Number(p.topPaperWeightKg || 0);
  const liner = Number(p.linerWeightKg || 0);
  const sum = top + liner;
  return sum > 0 ? sum : 0;
}

function formatMetricValue(card: OperationDashboardMetricCard) {
  if (card.status === "unavailable" || card.value === null) return "Pending";
  if (card.format === "currency") return formatCurrency(card.value);
  if (card.format === "percent") return `${Number(card.value || 0).toFixed(2)}%`;
  const text = formatNumber(card.value, false);
  return card.unit ? `${text} ${card.unit}` : text;
}

function getDefaultRange() {
  const today = getLocalDateInputValue(new Date());
  return { from: today, to: today };
}

function getSummaryCard(summary: OperationDashboardSummary, cardId: string) {
  return summary.groups.flatMap((group) => group.cards).find((card) => card.id === cardId) || null;
}

export function OperationDashboard() {
  const [productions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [invoices] = useData<Invoice>("invoices", []);

  const allowExports = exportsAllowed();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState(getDefaultRange);

  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement | null>(null);

  const columns: ColumnDef[] = useMemo(() => ([
    { id: "jobNo", label: "Job No.", className: "font-bold", render: (r) => r.production.transactionNo },
    { id: "orderNo", label: "Order No.", render: (r) => r.order?.orderNo || "-" },
    { id: "erpCode", label: "ERP Code", render: (r) => r.production.erpCode || "-" },
    { id: "company", label: "Company", render: (r) => r.company?.name || "-" },
    { id: "planDate", label: "Plan Date", render: (r) => formatDate(r.production.date) },
    { id: "itemName", label: "Item Name", className: "min-w-[150px]", render: (r) => r.item?.name || "Unknown" },
    { id: "type", label: "Type", render: (r) => r.item?.typeName || "-" },
    { id: "mandatory", label: "Mandatory", render: (r) => r.mandatoryCell },
    { id: "plannedQty", label: "Planned Qty", align: "right", className: "font-medium text-emerald-700", render: (r) => `${r.production.qty ?? "-"} ${r.production.uom || ""}`.trim() },
    { id: "loadedQty", label: "Loaded Qty", align: "right", className: "font-bold text-amber-700 bg-amber-50/40", render: (r) => Number(r.loadedQty || 0).toLocaleString() },
    { id: "paper", label: "Paper", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.paper || 0).toLocaleString() },
    { id: "liner", label: "Liner", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.liner || 0).toLocaleString() },
    { id: "print", label: "Print", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.printing || 0).toLocaleString() },
    { id: "paste", label: "Paste", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.pasting || 0).toLocaleString() },
    { id: "stitch", label: "Stitch", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.stitching || 0).toLocaleString() },
    { id: "punch", label: "Punch", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.punching || 0).toLocaleString() },
    { id: "glue", label: "Glue", align: "right", className: "font-bold text-indigo-700 bg-indigo-50/30", render: (r) => Number(r.processingTotals.gluing || 0).toLocaleString() },
    { id: "l", label: "L", align: "right", render: (r) => r.production.length || "-" },
    { id: "b", label: "B", align: "right", render: (r) => r.production.breadth || "-" },
    { id: "h", label: "H", align: "right", render: (r) => r.production.height || "-" },
    { id: "lOd", label: "L (OD)", align: "right", className: "font-medium text-indigo-600", render: (r) => r.item?.lOd || "-" },
    { id: "wOd", label: "W (OD)", align: "right", className: "font-medium text-indigo-600", render: (r) => r.item?.wOd || "-" },
    { id: "hOd", label: "H (OD)", align: "right", className: "font-medium text-indigo-600", render: (r) => r.item?.hOd || "-" },
    { id: "flap", label: "Flap", align: "right", render: (r) => r.item?.flap || "-" },
    { id: "deckle", label: "Deckle", align: "right", render: (r) => r.item?.deckleSize || "-" },
    { id: "cutting", label: "Cutting", align: "right", render: (r) => r.item?.cuttingSize || "-" },
    { id: "ply", label: "Ply", align: "center", render: (r) => r.production.ply || "-" },
    { id: "flute", label: "Flute", render: (r) => r.production.flute || "-" },
    { id: "top", label: "Top", align: "right", render: (r) => r.production.top || "-" },
    { id: "gsm", label: "GSM", align: "right", className: "font-medium text-indigo-700", render: (r) => r.production.gsm || "-" },
    { id: "leastGsm", label: "Least GSM", align: "right", className: "font-black text-emerald-700", render: (r) => (r.leastGsm === null ? "-" : r.leastGsm) },
    { id: "color1", label: "Color 1", render: (r) => r.production.color1 || "-" },
    { id: "color2", label: "Color 2", render: (r) => r.production.color2 || "-" },
    { id: "printingColor", label: "Printing Color", render: (r) => r.production.printingColor || "-" },
    { id: "paperReq", label: "Paper Req.", align: "right", render: (r) => r.production.paperRequiredNos || "-" },
    { id: "topPaperWtKg", label: "Top Paper Wt (KG)", align: "right", render: (r) => r.production.topPaperWeightKg || "-" },
    { id: "linerWtKg", label: "Liner Wt (KG)", align: "right", render: (r) => r.production.linerWeightKg || "-" },
    { id: "totalJobWt", label: "Total Job Wt", align: "right", render: (r) => r.production.totalJobWeight || "-" },
    { id: "lineReq", label: "Line Req.", align: "right", render: (r) => r.production.lineRequiredNos || "-" },
    { id: "totalWt", label: "Total Wt", align: "right", render: (r) => r.production.totalPaperWeight || "-" },
    { id: "avgWt", label: "Avg Wt", align: "right", render: (r) => r.production.avgWeight || "-" },
    { id: "wastage", label: "Wastage", align: "right", render: (r) => r.production.wastage || "-" },
    { id: "realPerKg", label: "Real/KG", align: "right", className: "font-bold text-indigo-700", render: (r) => (Number(r.production.realizationPerKg || 0) ? Number(r.production.realizationPerKg || 0).toFixed(2) : "-") },
    { id: "processingStatus", label: "Processing Status", className: "text-indigo-600 font-bold max-w-[200px] truncate", render: (r) => r.processingStatusText },
    {
      id: "status",
      label: "Status",
      render: (r) => (
        <span
          className={cn(
            "px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider",
            r.production.status === "Completed"
              ? "bg-emerald-100 text-emerald-900 border-emerald-900"
              : r.production.status === "Cancelled"
                ? "bg-red-100 text-red-900 border-red-900"
                : "bg-amber-100 text-amber-900 border-amber-900"
          )}
        >
          {r.production.status || "-"}
        </span>
      ),
    },
    { id: "jobCloser", label: "Job Closer", render: (r) => r.production.closeBy || "-" },
    { id: "closeDate", label: "Close Date", render: (r) => r.production.closeDate || "-" },
    { id: "actualPaperUsed", label: "Actual Paper Used", align: "right", className: "font-bold text-indigo-700", render: (r) => r.actualPaperUsed.toFixed(2) },
    { id: "wastagePct", label: "Wastage %", align: "right", className: "font-bold", render: (r) => (r.wastagePct === null ? "-" : `${r.wastagePct.toFixed(2)}%`) },
  ]), []);

  const defaultOrder: ColumnId[] = useMemo(
    () => columns.map((c) => c.id),
    [columns]
  );

  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(() => {
    const saved = safeJsonParse<ColumnId[]>(window.localStorage.getItem(STORAGE_HIDDEN_KEY));
    return new Set(Array.isArray(saved) ? saved : []);
  });

  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    const saved = safeJsonParse<ColumnId[]>(window.localStorage.getItem(STORAGE_ORDER_KEY));
    if (!Array.isArray(saved) || saved.length === 0) return defaultOrder;
    const known = new Set(defaultOrder);
    const filtered = saved.filter((id) => known.has(id));
    const missing = defaultOrder.filter((id) => !filtered.includes(id));
    return [...filtered, ...missing];
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_HIDDEN_KEY, JSON.stringify(Array.from(hiddenColumns)));
  }, [hiddenColumns]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    if (!isColumnsOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (columnsPanelRef.current && columnsPanelRef.current.contains(target)) return;
      setIsColumnsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isColumnsOpen]);

  const safeRange = useMemo(() => getSafeRange(dateRange), [dateRange]);

  const filteredProductions = useMemo(
    () => productions.filter((entry) => isDateWithinRange(entry.date, safeRange)),
    [productions, safeRange]
  );

  const processingTotalsMap = useMemo(() => {
    const map = new Map<string, ProcessingTotals>();
    processing.forEach((row) => {
      const totals = map.get(row.productionId) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
      const machineColumn = PROCESSING_MACHINE_COLUMNS.find((col) =>
        (col.machineNames as readonly string[]).includes(row.machineName)
      );
      if (machineColumn) totals[machineColumn.key] += Number(row.qty || 0);
      map.set(row.productionId, totals);
    });
    return map;
  }, [processing]);

  const processingMachinesMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    processing.forEach((row) => {
      const set = map.get(row.productionId) || new Set<string>();
      set.add(normalizeMachineName(row.machineName));
      map.set(row.productionId, set);
    });
    return map;
  }, [processing]);

  const mandatoryMachinesByType = useMemo(() => parseMandatoryMachinesByType(settings[0]), [settings]);

  const loadedQtyByProductionId = useMemo(() => {
    const map = new Map<string, number>();
    const getJobAllocations = (line: LoadingSlipLine) =>
      Array.isArray(line.allocations)
        ? line.allocations.filter((allocation) => allocation.sourceType === "job")
        : [];

    loadingSlips
      .filter((slip) => slip.status !== "Cancelled")
      .forEach((slip) => {
        slip.lines.forEach((line) => {
          getJobAllocations(line).forEach((allocation) => {
            map.set(allocation.jobId, (map.get(allocation.jobId) || 0) + Number(allocation.qty || 0));
          });
        });
      });
    return map;
  }, [loadingSlips]);

  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach((p) => {
      if (p.status === "Cancelled" || p.cancelTimestamp) return;
      const erp = String(p.erpCode || "").trim();
      const gsm = Number(p.gsm || 0);
      if (erp && gsm > 0) {
        if (!map.has(erp) || gsm < map.get(erp)!) map.set(erp, gsm);
      }
    });
    return map;
  }, [productions]);

  const filteredMaterialIssues = useMemo(
    () => materialIssues.filter((entry) => isDateWithinRange(entry.date, safeRange)),
    [materialIssues, safeRange]
  );
  const filteredMaterialReturns = useMemo(
    () => materialReturns.filter((entry) => isDateWithinRange(entry.date, safeRange)),
    [materialReturns, safeRange]
  );

  const productionUsageMap = useMemo(() => {
    return buildProductionMaterialUsageMap(filteredMaterialIssues, materialIssueLines, filteredMaterialReturns, materialReturnLines);
  }, [filteredMaterialIssues, materialIssueLines, filteredMaterialReturns, materialReturnLines]);

  const getProcessingSummary = (productionId: string) => {
    const records = processing.filter((p) => p.productionId === productionId);
    if (records.length === 0) return "Pending";
    const machines = Array.from(new Set(records.map((r) => r.machineName))).join(", ");
    const totalQty = records.reduce((sum, r) => sum + Number(r.qty || 0), 0);
    return `${machines} (${totalQty})`;
  };

  const getMandatoryStatus = (productionId: string, typeName?: string) => {
    const required = getRequiredMachinesForType(mandatoryMachinesByType, typeName);
    if (required.length === 0) return { required, done: 0, missing: [] as string[] };
    const doneSet = processingMachinesMap.get(productionId) || new Set<string>();
    const missing = required.filter((name) => !doneSet.has(normalizeMachineName(name)));
    return { required, done: required.length - missing.length, missing };
  };

  const rows: OperationRow[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return filteredProductions
      .map((p) => {
        const schedule = schedules.find((s) => s.id === p.scheduleId);
        const order = orders.find((o) => o.id === schedule?.orderId);
        const company = companies.find((c) => c.id === order?.companyId);
        const item = items.find((i) => i.id === p.itemId);

        const mandatory = getMandatoryStatus(p.id, item?.typeName);
        const mandatoryCell =
          mandatory.required.length === 0
            ? "-"
            : mandatory.missing.length === 0
              ? <span className="font-black text-emerald-700">Done {mandatory.done}/{mandatory.required.length}</span>
              : (
                <div className="space-y-1">
                  <div className="font-black text-amber-700">Pending {mandatory.done}/{mandatory.required.length}</div>
                  <div className="text-[10px] font-semibold text-slate-600 whitespace-normal max-w-[240px]">
                    Missing: {mandatory.missing.join(", ")}
                  </div>
                </div>
              );

        const processingTotals =
          processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
        const processingStatusText = getProcessingSummary(p.id);
        const loadedQty = Number(loadedQtyByProductionId.get(p.id) || 0);
        const erp = String(p.erpCode || "").trim();
        const leastGsm = erp ? (erpLeastGsmMap.get(erp) ?? null) : null;

        const actualPaperUsed = getProductionActualPaperUsed(p, productionUsageMap);
        const planPaper = getPlanPaper(p);
        const wastagePct = planPaper > 0 ? ((actualPaperUsed - planPaper) / planPaper) * 100 : null;

        return {
          production: p,
          item,
          schedule,
          order,
          company,
          mandatoryCell,
          processingStatusText,
          processingTotals,
          loadedQty,
          leastGsm,
          actualPaperUsed,
          planPaper,
          wastagePct,
        };
      })
      .filter((row) => {
        if (!q) return true;
        const blob = [
          row.production.transactionNo,
          row.item?.name || "",
          row.order?.orderNo || "",
          row.company?.name || "",
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      })
      .sort((a, b) => b.production.transactionNo.localeCompare(a.production.transactionNo, undefined, { numeric: true, sensitivity: "base" }));
  }, [
    filteredProductions,
    schedules,
    orders,
    companies,
    items,
    processingTotalsMap,
    loadedQtyByProductionId,
    erpLeastGsmMap,
    processingMachinesMap,
    mandatoryMachinesByType,
    processing,
    productionUsageMap,
    searchTerm,
  ]);

  const totals = useMemo(() => {
    const sumActual = rows.reduce((sum, row) => sum + Number(row.actualPaperUsed || 0), 0);
    const sumPlan = rows.reduce((sum, row) => sum + Number(row.planPaper || 0), 0);
    const overallWastagePct = sumPlan > 0 ? ((sumActual - sumPlan) / sumPlan) * 100 : null;
    return { sumActual, sumPlan, overallWastagePct };
  }, [rows]);

  const summary = useMemo(
    () =>
      buildOperationDashboardSummary({
        dateRange,
        productions,
        schedules,
        orders,
        dispatchPlans,
        loadingSlips,
        invoices,
        processing,
        materialIssues,
        materialIssueLines,
        materialReturns,
        materialReturnLines,
      }),
    [
      dateRange,
      productions,
      schedules,
      orders,
      dispatchPlans,
      loadingSlips,
      invoices,
      processing,
      materialIssues,
      materialIssueLines,
      materialReturns,
      materialReturnLines,
    ]
  );

  const columnById = useMemo(() => {
    const map = new Map<ColumnId, ColumnDef>();
    columns.forEach((c) => map.set(c.id, c));
    return map;
  }, [columns]);

  const visibleColumnIds = useMemo(() => {
    const known = new Set(columns.map((c) => c.id));
    return columnOrder.filter((id) => known.has(id) && !hiddenColumns.has(id));
  }, [columnOrder, columns, hiddenColumns]);

  const visibleColumns = useMemo(() => {
    return visibleColumnIds.map((id) => columnById.get(id)!).filter(Boolean);
  }, [visibleColumnIds, columnById]);

  const exportData = useMemo(() => {
    return rows.map((r) => ({
      "Job No.": r.production.transactionNo || "-",
      "Order No.": r.order?.orderNo || "-",
      "ERP Code": r.production.erpCode || "-",
      Company: r.company?.name || "-",
      "Plan Date": formatDate(r.production.date),
      "Item Name": r.item?.name || "-",
      Type: r.item?.typeName || "-",
      "Planned Qty": `${r.production.qty ?? "-"} ${r.production.uom || ""}`.trim(),
      "Loaded Qty": r.loadedQty,
      Paper: r.processingTotals.paper,
      Liner: r.processingTotals.liner,
      Print: r.processingTotals.printing,
      Paste: r.processingTotals.pasting,
      Stitch: r.processingTotals.stitching,
      Punch: r.processingTotals.punching,
      Glue: r.processingTotals.gluing,
      L: r.production.length ?? "-",
      B: r.production.breadth ?? "-",
      H: r.production.height ?? "-",
      "L (OD)": r.item?.lOd ?? "-",
      "W (OD)": r.item?.wOd ?? "-",
      "H (OD)": r.item?.hOd ?? "-",
      Flap: r.item?.flap ?? "-",
      Deckle: r.item?.deckleSize ?? "-",
      Cutting: r.item?.cuttingSize ?? "-",
      Ply: r.production.ply ?? "-",
      Flute: r.production.flute ?? "-",
      Top: r.production.top ?? "-",
      GSM: r.production.gsm ?? "-",
      "Least GSM": r.leastGsm === null ? "-" : r.leastGsm,
      "Color 1": r.production.color1 ?? "-",
      "Color 2": r.production.color2 ?? "-",
      "Printing Color": r.production.printingColor ?? "-",
      "Paper Req.": r.production.paperRequiredNos ?? "-",
      "Top Paper Wt (KG)": r.production.topPaperWeightKg ?? "-",
      "Liner Wt (KG)": r.production.linerWeightKg ?? "-",
      "Total Job Wt": r.production.totalJobWeight ?? "-",
      "Line Req.": r.production.lineRequiredNos ?? "-",
      "Total Wt": r.production.totalPaperWeight ?? "-",
      "Avg Wt": r.production.avgWeight ?? "-",
      Wastage: r.production.wastage ?? "-",
      "Real/KG": Number(r.production.realizationPerKg || 0) ? Number(r.production.realizationPerKg || 0).toFixed(2) : "-",
      "Processing Status": r.processingStatusText,
      Status: r.production.status || "-",
      "Job Closer": r.production.closeBy || "-",
      "Close Date": r.production.closeDate || "-",
      "Actual Paper Used": Number(r.actualPaperUsed.toFixed(5)),
      "Wastage %": r.wastagePct === null ? "-" : Number(r.wastagePct.toFixed(5)),
    }));
  }, [rows]);

  const onToggleColumn = (id: ColumnId) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onResetColumns = () => {
    setHiddenColumns(new Set());
    setColumnOrder(defaultOrder);
  };

  const onDragStart = (id: ColumnId) => (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (targetId: ColumnId) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain") as ColumnId;
    if (!sourceId || sourceId === targetId) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(sourceId);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, sourceId);
      return next;
    });
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  return (
    <div className="space-y-4">
      <div className="border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="bg-cyan-400 px-4 py-2 text-center text-xl font-black tracking-tight text-red-700">|| श्री गणेशाय नमः ||</div>
        <div className="border-t-2 border-black px-4 py-4 bg-[linear-gradient(180deg,#fffdf5_0%,#eef6ff_55%,#f8f6ff_100%)]">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">Operation Dashboard</h2>
              <div className="mt-1 text-xs font-bold text-slate-600">Range snapshot for {summary.rangeLabel}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <DateInput label="From" value={dateRange.from} onChange={(value) => setDateRange((prev) => ({ ...prev, from: value }))} />
              <DateInput label="To" value={dateRange.to} onChange={(value) => setDateRange((prev) => ({ ...prev, to: value }))} />
              {allowExports ? (
                <ExcelExport data={exportData} fileName={`Operation_Dashboard_${dateRange.from}_${dateRange.to}`} />
              ) : null}
              <button
                type="button"
                onClick={() => setIsColumnsOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border-2 border-black rounded text-[11px] font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-none transition"
              >
                <SlidersHorizontal size={14} strokeWidth={3} />
                Columns
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {SUMMARY_GROUP_CONFIGS.map((groupConfig) => {
              const group = summary.groups.find((entry) => entry.id === groupConfig.groupId);
              if (!group) return null;
              return (
                <section
                  key={group.id}
                  className={cn("rounded border-2 border-black bg-white overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]", groupConfig.className)}
                >
                  <div className="bg-slate-900 px-3 py-2 text-sm font-black uppercase tracking-widest text-white">{group.title}</div>
                  <div className={cn("grid gap-0", groupConfig.gridClassName)}>
                    {groupConfig.cards.map((cardConfig) => {
                      const card = getSummaryCard(summary, cardConfig.id);
                      if (!card) return null;
                      return <SummaryMetricCard key={card.id} card={card} config={cardConfig} />;
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border-2 border-black rounded p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Actual Paper Used</div>
          <div className="text-2xl font-black text-indigo-700 tabular-nums">{totals.sumActual.toFixed(2)}</div>
        </div>
        <div className="bg-white border-2 border-black rounded p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Plan Paper</div>
          <div className="text-2xl font-black tabular-nums">{totals.sumPlan.toFixed(2)}</div>
        </div>
        <div className="bg-white border-2 border-black rounded p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Overall Wastage %</div>
          <div
            className={cn(
              "text-2xl font-black tabular-nums",
              totals.overallWastagePct !== null && totals.overallWastagePct > 0 ? "text-red-600" : "text-emerald-700"
            )}
          >
            {totals.overallWastagePct === null ? "-" : `${totals.overallWastagePct.toFixed(2)}%`}
          </div>
        </div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search jobs, items, parties..." />

      {isColumnsOpen ? (
        <div ref={columnsPanelRef} className="bg-white border-2 border-black rounded p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between gap-3 border-b border-black pb-2 mb-3">
            <div className="text-xs font-black uppercase tracking-widest">Show / Hide Columns</div>
            <button
              type="button"
              onClick={onResetColumns}
              className="text-[10px] font-black uppercase px-3 py-1 border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-none transition"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {columns.map((c) => {
              const checked = !hiddenColumns.has(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleColumn(c.id)}
                    className="h-4 w-4 border-2 border-black"
                  />
                  <span className="truncate" title={c.label}>{c.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] font-bold text-slate-600">Tip: drag table headers to reorder columns.</div>
        </div>
      ) : null}

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3 bg-slate-100 border-b border-black">
          <h3 className="font-bold text-sm uppercase tracking-tight text-black">Production Master View</h3>
          <div className="text-xs font-bold text-slate-600">{rows.length} records</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-max w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                {visibleColumns.map((c) => (
                  <th
                    key={c.id}
                    draggable
                    onDragStart={onDragStart(c.id)}
                    onDragOver={onDragOver}
                    onDrop={onDrop(c.id)}
                    className={cn(
                      "px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap select-none cursor-move",
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                    )}
                    title="Drag to reorder"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length || 1} className="px-6 py-8 text-center text-black font-medium">
                    No productions found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.production.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                    {visibleColumns.map((c) => {
                      const value = c.render(row);
                      const title = typeof value === "string" ? value : c.id === "processingStatus" ? row.processingStatusText : undefined;
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            "px-4 py-4 text-xs text-black border border-black whitespace-nowrap",
                            c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                            c.className
                          )}
                          title={title}
                        >
                          {value}
                        </td>
                      );
                    })}
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

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-none border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col">
        <span className="text-[10px] font-black text-black uppercase tracking-tighter leading-none mb-1.5 opacity-60">{label}</span>
        <input
          type="date"
          className="text-sm font-black bg-transparent border-none p-0 focus:ring-0 leading-tight uppercase cursor-pointer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="mt-1 text-[10px] font-black text-slate-500 tracking-wide">{formatDisplayDate(value)}</span>
      </div>
    </div>
  );
}

function SummaryMetricCard({ card, config }: { card: OperationDashboardMetricCard; config: SummaryCardConfig }) {
  return (
    <div className={cn("min-h-[110px] border-t-2 border-black first:border-t-0 md:border-l-2 md:[&:nth-child(odd)]:border-l-0 xl:border-l-2 px-4 py-4", config.tone, config.className)}>
      <div className="text-[11px] font-black uppercase tracking-tight text-current">{card.label}</div>
      <div className={cn("mt-3 text-3xl font-black leading-none tracking-tight", config.valueTone)}>{formatMetricValue(card)}</div>
      <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-current/70">
        {card.note || (card.status === "unavailable" ? "Pending data source" : "")}
      </div>
    </div>
  );
}
