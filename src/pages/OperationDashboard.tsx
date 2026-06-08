import React, { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, ClipboardList, CheckCircle, XCircle } from "lucide-react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type {
  Company,
  DispatchPlan,
  Invoice,
  Item,
  LoadingSlip,
  LoadingSlipLine,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
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
  | "srNo"
  | "jobNo"
  | "orderNo"
  | "erpCode"
  | "company"
  | "planDate"
  | "itemName"
  | "sample"
  | "type"
  | "mandatory"
  | "plannedQty"
  | "ups"
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
  | "ply"
  | "flute"
  | "l1"
  | "f1"
  | "l2"
  | "f2"
  | "l3"
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
  | "reelCalc"
  | "reelTrim"
  | "cuttingTrim"
  | "plannedProdM"
  | "sheetWt"
  | "fluteBatch"
  | "rate"
  | "value"
  | "prodFromFFG"
  | "actualPaperUsed"
  | "jobCloser"
  | "closeDate"
  | "actions";

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
  srNo: number;
  production: Production;
  item?: Item;
  schedule?: OrderSchedule;
  order?: Order;
  company?: Company;
  mandatoryCell: React.ReactNode;
  processingTotals: ProcessingTotals;
  loadedQty: number;
  leastGsm: number | null;
  actualPaperUsed: number;
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
  columns: number;
  cards: SummaryCardConfig[];
};

type ClosedJobFilter = "all" | "yes" | "no";

const STORAGE_HIDDEN_KEY = "lnpi.operationDashboard.columns.hidden.v2";
const STORAGE_ORDER_KEY = "lnpi.operationDashboard.columns.order.v2";

const SUMMARY_GROUP_CONFIGS: SummaryGroupConfig[] = [
  {
    groupId: "headline",
    className: "xl:col-span-6",
    gridClassName: "grid-cols-4",
    columns: 4,
    cards: [
      { id: "production", tone: "bg-cyan-50", valueTone: "text-cyan-800" },
      { id: "actualPaperUsed", tone: "bg-violet-50", valueTone: "text-violet-800" },
      { id: "todayPlanQty", tone: "bg-amber-50", valueTone: "text-amber-800" },
      { id: "todayPlanValue", tone: "bg-rose-50", valueTone: "text-rose-800" },
      { id: "tomorrowPlanQty", tone: "bg-sky-50", valueTone: "text-sky-800" },
      { id: "tomorrowPlanValue", tone: "bg-fuchsia-50", valueTone: "text-fuchsia-800" },
      { id: "linearMeter", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
      { id: "wastage", tone: "bg-orange-50", valueTone: "text-orange-800" },
    ],
  },
  {
    groupId: "dispatch",
    className: "xl:col-span-6",
    gridClassName: "grid-cols-4",
    columns: 4,
    cards: [
      { id: "totalSales", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
      { id: "todaySalesValue", tone: "bg-teal-50", valueTone: "text-teal-800" },
      { id: "dispatchPlannedQty", tone: "bg-indigo-50", valueTone: "text-indigo-800" },
      { id: "dispatchLoadedQty", tone: "bg-blue-50", valueTone: "text-blue-800" },
      { id: "loadingQty", tone: "bg-violet-50", valueTone: "text-violet-800" },
      { id: "invoiceCount", tone: "bg-yellow-50", valueTone: "text-yellow-800" },
      { id: "pendingPlanningValue", tone: "bg-pink-50", valueTone: "text-pink-800" },
    ],
  },
  {
    groupId: "workflow",
    className: "xl:col-span-4",
    gridClassName: "grid-cols-3",
    columns: 3,
    cards: [
      { id: "pendingPlanningCount", tone: "bg-amber-50", valueTone: "text-amber-800" },
      { id: "wipQty", tone: "bg-cyan-50", valueTone: "text-cyan-800" },
      { id: "activeJobs", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
      { id: "cancelledJobs", tone: "bg-rose-50", valueTone: "text-rose-800" },
      { id: "pendingTally", tone: "bg-lime-50", valueTone: "text-lime-800" },
    ],
  },
  {
    groupId: "operations",
    className: "xl:col-span-4",
    gridClassName: "grid-cols-3",
    columns: 3,
    cards: [
      { id: "paper", tone: "bg-indigo-50", valueTone: "text-indigo-800" },
      { id: "liner", tone: "bg-blue-50", valueTone: "text-blue-800" },
      { id: "printing", tone: "bg-yellow-50", valueTone: "text-yellow-800" },
      { id: "pasting", tone: "bg-orange-50", valueTone: "text-orange-800" },
      { id: "stitching", tone: "bg-fuchsia-50", valueTone: "text-fuchsia-800" },
      { id: "processingEntries", tone: "bg-slate-100", valueTone: "text-slate-800" },
    ],
  },
  {
    groupId: "stock",
    className: "xl:col-span-4",
    gridClassName: "grid-cols-3",
    columns: 3,
    cards: [
      { id: "planPaper", tone: "bg-cyan-50", valueTone: "text-cyan-800" },
      { id: "pendingConsumption", tone: "bg-amber-50", valueTone: "text-amber-800" },
      { id: "fgStock", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
      { id: "reelStock", tone: "bg-violet-50", valueTone: "text-violet-800" },
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
  const text =
    typeof card.decimals === "number"
      ? Number(card.value || 0).toLocaleString("en-IN", { minimumFractionDigits: card.decimals, maximumFractionDigits: card.decimals })
      : formatNumber(card.value, false);
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [productions, setProductions] = useData<Production>("productions", []);
  const npdItems = useNpdItems();
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [invoices] = useData<Invoice>("invoices", []);

  const allowExports = exportsAllowed();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState(getDefaultRange);
  const [closedJobFilter, setClosedJobFilter] = useState<ClosedJobFilter>("no");

  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement | null>(null);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancelModalJobId, setCancelModalJobId] = useState<string | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelSubmittingId, setCancelSubmittingId] = useState<string | null>(null);

  const updateCloseMeta = async (id: string, patch: Partial<Pick<Production, "closeBy" | "closeDate">>) => {
    const resolvedPatch = { ...patch };
    if (resolvedPatch.closeBy === "Yes" && !resolvedPatch.closeDate) {
      alert("Close Date is mandatory when Closer is Yes.");
      return;
    }
    const timestamp = new Date().toISOString();
    await setProductions((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              ...resolvedPatch,
              updateTimestamp: timestamp,
              updatedBy: user?.name || "System User",
            }
          : p
      )
    );
  };

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

  const jobClosureStatusMap = useMemo(() => {
    const isCorrugationLiner = (name?: string | null) =>
      String(normalizeMachineName(name || "")).trim().toLowerCase() === "corrugation liner";

    const result = new Map<string, { canClose: boolean; reasons: string[] }>();
    productions.forEach((production) => {
      const item = npdItems.find((i) => i.id === String(production.itemId || "").trim());
      const boxType = (item as any)?.boxType;
      const requiredMachines = getRequiredMachinesForType(mandatoryMachinesByType, boxType).map((m) =>
        normalizeMachineName(m)
      );
      const records = processing.filter((entry) => entry.productionId === production.id);
      const planQty = Number(production.qty || 0);
      const reasons: string[] = [];
      if (requiredMachines.length === 0) {
        reasons.push(`No required process steps configured for Type: ${String(boxType || "-")}`);
      }
      const isEntryComplete = (entry: ProductionProcessing) => {
        const qtyValue = Number(entry.qty || 0);
        if (!Number.isFinite(qtyValue) || qtyValue <= 0) return false;
        if (!String(entry.machineId || "").trim()) return false;
        if (!String(entry.operatorId || "").trim()) return false;
        if (!String(entry.shift || "").trim()) return false;
        if (!String(entry.date || "").trim()) return false;
        return true;
      };
      requiredMachines.forEach((machineName) => {
        const normalized = normalizeMachineName(machineName);
        const stepRecords = records.filter((r) => normalizeMachineName(r.machineName) === normalized);
        if (stepRecords.length === 0) {
          reasons.push(`Missing processing step: ${normalized}`);
          return;
        }
        if (!stepRecords.some(isEntryComplete)) {
          reasons.push(`Incomplete processing entry: ${normalized}`);
        }
        if (!isCorrugationLiner(normalized) && planQty > 0) {
          const stepQty = stepRecords.reduce((sum, r) => sum + Number(r.qty || 0), 0);
          if (stepQty > planQty) {
            reasons.push(`Qty exceeds Plan Qty for ${normalized} (Plan ${planQty}, Reported ${stepQty})`);
          }
        }
      });
      result.set(production.id, { canClose: reasons.length === 0, reasons });
    });
    return result;
  }, [productions, npdItems, processing, mandatoryMachinesByType]);

  const handleCloseJob = async (id: string) => {
    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Completed" || target.status === "Cancelled") return;
    const closureStatus = jobClosureStatusMap.get(id);
    if (!closureStatus?.canClose) {
      const reasons = closureStatus?.reasons?.length ? closureStatus.reasons : ["Processing data is incomplete."];
      alert(`Job Close is blocked:\n- ${reasons.join("\n- ")}`);
      return;
    }
    if (closingId !== id) {
      setClosingId(id);
      setTimeout(() => setClosingId(null), 3000);
      return;
    }
    const timestamp = new Date().toISOString();
    const closeDate = new Date().toISOString().split("T")[0];
    try {
      await setProductions((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "Completed",
                tallyTimestamp: p.tallyTimestamp || timestamp,
                closeBy: p.closeBy || "Yes",
                closeDate: p.closeDate || closeDate,
                updateTimestamp: timestamp,
                updatedBy: user?.name || "System User",
              }
            : p
        )
      );
    } catch (err) {
      console.error("Failed to close job:", err);
    } finally {
      setClosingId(null);
    }
  };

  const openCancelModal = (id: string) => {
    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Cancelled") return;
    setCancelModalJobId(id);
    setCancelRemarks("");
    setCancelError("");
  };

  const handleCancelJob = async () => {
    const id = cancelModalJobId;
    if (!id) return;
    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Cancelled") return;
    const reason = cancelRemarks.trim();
    if (!reason) {
      setCancelError("Cancel reason is mandatory.");
      return;
    }
    const timestamp = new Date().toISOString();
    setCancelSubmittingId(id);
    try {
      await setProductions((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "Cancelled",
                cancelTimestamp: timestamp,
                cancelEmailId: user?.email || "System User",
                cancelRemarks: reason,
                updateTimestamp: timestamp,
                updatedBy: user?.name || "System User",
              }
            : p
        )
      );
      if (target.scheduleId) {
        await setSchedules((prev) =>
          prev.map((schedule) =>
            schedule.id === target.scheduleId
              ? {
                  ...schedule,
                  producedQty: Math.max(0, Number(schedule.producedQty || 0) - Number(target.qty || 0)),
                  updateTimestamp: timestamp,
                  updatedBy: user?.name || "System User",
                }
              : schedule
          )
        );
      }
      alert("Job cancelled successfully.");
      setCancelModalJobId(null);
      setCancelRemarks("");
    } catch (err) {
      console.error("Failed to cancel job:", err);
    } finally {
      setCancelSubmittingId(null);
    }
  };

  const columns: ColumnDef[] = useMemo(() => ([
    { id: "srNo", label: "Sr. No.", render: (r) => r.srNo },
    { id: "jobNo", label: "Job No.", className: "font-bold", render: (r) => r.production.transactionNo },
    { id: "orderNo", label: "Order No.", render: (r) => r.order?.orderNo || "-" },
    { id: "erpCode", label: "ERP Code", render: (r) => r.production.erpCode || "-" },
    { id: "company", label: "Company", render: (r) => r.company?.name || "-" },
    { id: "planDate", label: "Plan Date", render: (r) => formatDate(r.production.date) },
    { id: "itemName", label: "Item Name", className: "min-w-[150px]", render: (r) => r.item?.name || "Unknown" },
    { id: "sample", label: "Sample", render: (r) => ((r.item as any)?.isSample ? "Yes" : "-") },
    { id: "type", label: "Type", render: (r) => (r.item as any)?.boxType || "-" },
    { id: "mandatory", label: "Mandatory", render: (r) => r.mandatoryCell },
    { id: "plannedQty", label: "Planned Qty", align: "right", className: "font-medium text-emerald-700", render: (r) => `${r.production.qty ?? "-"} ${r.production.uom || ""}`.trim() },
    { id: "ups", label: "UPS", align: "center", render: (r) => r.production.ups || (r.item as any)?.ups || "-" },
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

    { id: "ply", label: "Ply", align: "center", render: (r) => r.production.ply || "-" },
    { id: "flute", label: "Flute", render: (r) => r.production.flute || "-" },
    { id: "l1", label: "L1", align: "right", render: (r) => r.production.l1 || (r.item as any)?.l1 || "-" },
    { id: "f1", label: "F1", align: "right", render: (r) => r.production.f1 || (r.item as any)?.f1 || "-" },
    { id: "l2", label: "L2", align: "right", render: (r) => r.production.l2 || (r.item as any)?.l2 || "-" },
    { id: "f2", label: "F2", align: "right", render: (r) => r.production.f2 || (r.item as any)?.f2 || "-" },
    { id: "l3", label: "L3", align: "right", render: (r) => r.production.l3 || (r.item as any)?.l3 || "-" },
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
    { id: "reelCalc", label: "Reel (Calc)", align: "right", render: (r) => (r.production as any).reelAsPerCalc || "-" },
    { id: "reelTrim", label: "Reel Trim", align: "right", render: (r) => (r.production as any).reelActualWithTrimming || "-" },
    { id: "cuttingTrim", label: "Cutting Trim", align: "right", render: (r) => (r.production as any).cuttingWithTrimming || r.item?.cuttingSize || "-" },
    { id: "plannedProdM", label: "Planned Prod (M)", align: "right", render: (r) => r.production.plannedProductionInMeter ?? "-" },
    { id: "sheetWt", label: "Sheet Wt", align: "right", render: (r) => r.production.sheetWeight || "-" },
    { id: "fluteBatch", label: "Flute Batch", render: (r) => r.production.fluteBatches || "-" },
    { id: "rate", label: "Rate", align: "right", render: (r) => (Number(r.production.rate) ? Number(r.production.rate).toFixed(2) : (r.production.rate || "-")) },
    { id: "value", label: "Value", align: "right", render: (r) => (Number(r.production.qty || 0) && Number(r.production.rate || 0) ? (Number(r.production.qty || 0) * Number(r.production.rate || 0)).toLocaleString() : "-") },

    { id: "prodFromFFG", label: "Production FFG", align: "right", className: "font-bold text-black bg-indigo-50/20", render: (r) => Number(r.production.prodFromFFG || 0).toLocaleString() },
    { id: "actualPaperUsed", label: "Actual Paper (KG)", align: "right", className: "font-bold text-emerald-700 bg-emerald-50/30", render: (r) => Number(r.actualPaperUsed || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    { id: "jobCloser", label: "Job Closer", render: (r) => (
      <select
        value={r.production.closeBy || ""}
        disabled={!Number(r.actualPaperUsed || 0) || !Number(r.production.prodFromFFG || 0)}
        onChange={(e) => {
          const nextValue = e.target.value;
          const today = new Date().toISOString().split("T")[0];
          void setProductions((prev) =>
            prev.map((row) =>
              row.id === r.production.id
                ? {
                    ...row,
                    closeBy: nextValue,
                    closeDate: nextValue === "Yes" ? row.closeDate || today : row.closeDate,
                  }
                : row
            )
          );
        }}
        onBlur={(e) => void updateCloseMeta(r.production.id, { closeBy: e.target.value, closeDate: r.production.closeDate })}
        className="w-24 border border-black rounded px-1 py-0.5 text-[10px] bg-white disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        <option value=""></option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    ) },
    { id: "closeDate", label: "Close Date", render: (r) => (
      <input
        type="date"
        value={(r.production.closeDate || "").split("T")[0]}
        disabled={!Number(r.actualPaperUsed || 0) || !Number(r.production.prodFromFFG || 0)}
        onChange={(e) => void setProductions((prev) => prev.map((row) => (row.id === r.production.id ? { ...row, closeDate: e.target.value } : row)))}
        onBlur={(e) => void updateCloseMeta(r.production.id, { closeDate: e.target.value, closeBy: r.production.closeBy })}
        className={`w-28 border rounded px-1 py-0.5 text-[10px] disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 ${r.production.closeBy === "Yes" && !r.production.closeDate ? "border-red-600" : "border-black"}`}
        required={r.production.closeBy === "Yes"}
      />
    ) },
    { id: "actions", label: "Actions", align: "center", render: (r) => (
      <div className="flex items-center justify-center gap-2">
        <button 
          onClick={() => navigate(`/production-processing/form?productionId=${r.production.id}`)}
          title="Report Processing"
          className="text-indigo-600 hover:text-indigo-900 transition-all p-1"
        >
          <ClipboardList size={14} />
        </button>
        {r.production.status !== "Completed" && r.production.status !== "Cancelled" && jobClosureStatusMap.get(r.production.id)?.canClose ? (
          <button
            onClick={() => handleCloseJob(r.production.id)}
            title={closingId === r.production.id ? "Click to confirm close" : "Close job"}
            className={`transition-all p-1 ${
              closingId === r.production.id
                ? "text-amber-600 animate-pulse scale-110"
                : "text-emerald-700 hover:text-emerald-900"
            }`}
          >
            <CheckCircle size={14} />
          </button>
        ) : null}
        {r.production.status !== "Completed" && r.production.status !== "Cancelled" && (
          <button 
            onClick={() => openCancelModal(r.production.id)} 
            title="Cancel job"
            className="text-red-600 hover:text-red-900 transition-all p-1"
          >
            <XCircle size={14} />
          </button>
        )}
      </div>
    ) },
  ]), [navigate, setProductions, updateCloseMeta, jobClosureStatusMap, closingId, handleCloseJob, openCancelModal]);

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
    () => (safeRange ? productions.filter((entry) => isDateWithinRange(entry.date, safeRange)) : productions),
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
    () => (safeRange ? materialIssues.filter((entry) => isDateWithinRange(entry.date, safeRange)) : materialIssues),
    [materialIssues, safeRange]
  );
  const filteredMaterialReturns = useMemo(
    () => (safeRange ? materialReturns.filter((entry) => isDateWithinRange(entry.date, safeRange)) : materialReturns),
    [materialReturns, safeRange]
  );

  const productionUsageMap = useMemo(() => {
    return buildProductionMaterialUsageMap(
      filteredMaterialIssues,
      materialIssueLines,
      filteredMaterialReturns,
      materialReturnLines,
      issueReelLines,
      returnReelLines
    );
  }, [filteredMaterialIssues, materialIssueLines, filteredMaterialReturns, materialReturnLines, issueReelLines, returnReelLines]);

  const getProcessingSummary = (productionId: string) => {
    const records = processing.filter((p) => p.productionId === productionId);
    if (records.length === 0) return "Pending";
    const machines = Array.from(new Set(records.map((r) => r.machineName))).join(", ");
    const totalQty = records.reduce((sum, r) => sum + Number(r.qty || 0), 0);
    return `${machines} (${totalQty})`;
  };

  const getMandatoryStatus = (productionId: string, boxType?: string) => {
    const required = getRequiredMachinesForType(mandatoryMachinesByType, boxType);
    if (required.length === 0) return { required, done: 0, missing: [] as string[] };
    const doneSet = processingMachinesMap.get(productionId) || new Set<string>();
    const missing = required.filter((name) => !doneSet.has(normalizeMachineName(name)));
    return { required, done: required.length - missing.length, missing };
  };

  const rows: OperationRow[] = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    const sorted = filteredProductions
      .map((p) => {
        const schedule = schedules.find((s) => s.id === p.scheduleId);
        const order = orders.find((o) => o.id === schedule?.orderId);
        const company = companies.find((c) => c.id === order?.companyId);
        const item = npdItems.find((i) => i.id === p.itemId);

        const mandatory = getMandatoryStatus(p.id, (item as any)?.boxType);
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
          srNo: 0,
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
        const isClosedJob = Boolean(row.production.closeDate || row.production.closeBy || row.production.status === "Completed");
        if (closedJobFilter === "yes" && !isClosedJob) return false;
        if (closedJobFilter === "no" && isClosedJob) return false;

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

    return sorted.map((row, idx) => ({ ...row, srNo: idx + 1 }));
  }, [
    filteredProductions,
    schedules,
    orders,
    companies,
    npdItems,
    processingTotalsMap,
    loadedQtyByProductionId,
    erpLeastGsmMap,
    processingMachinesMap,
    mandatoryMachinesByType,
    processing,
    productionUsageMap,
    searchTerm,
    closedJobFilter,
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
        items: npdItems,
        materials,
        materialIn,
        packingSlips,
        processing,
        materialIssues,
        materialIssueLines,
        issueReelLines,
        materialReturns,
        materialReturnLines,
        returnReelLines,
      }),
    [
      dateRange,
      productions,
      schedules,
      orders,
      dispatchPlans,
      loadingSlips,
      invoices,
      npdItems,
      materials,
      materialIn,
      packingSlips,
      processing,
      materialIssues,
      materialIssueLines,
      issueReelLines,
      materialReturns,
      materialReturnLines,
      returnReelLines,
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
      "Sr. No.": r.srNo,
      "Job No.": r.production.transactionNo || "-",
      "Order No.": r.order?.orderNo || "-",
      "ERP Code": r.production.erpCode || "-",
      Company: r.company?.name || "-",
      "Plan Date": formatDate(r.production.date),
      "Item Name": r.item?.name || "-",
      Sample: (r.item as any)?.isSample ? "Yes" : "-",
      Type: (r.item as any)?.boxType || "-",
      "Planned Qty": `${r.production.qty ?? "-"} ${r.production.uom || ""}`.trim(),
      UPS: r.production.ups || (r.item as any)?.ups || "-",
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
      Ply: r.production.ply ?? "-",
      Flute: r.production.flute ?? "-",
      L1: r.production.l1 || (r.item as any)?.l1 || "-",
      F1: r.production.f1 || (r.item as any)?.f1 || "-",
      L2: r.production.l2 || (r.item as any)?.l2 || "-",
      F2: r.production.f2 || (r.item as any)?.f2 || "-",
      L3: r.production.l3 || (r.item as any)?.l3 || "-",
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
      "Reel (Calc)": (r.production as any).reelAsPerCalc || "-",
      "Reel Trim": (r.production as any).reelActualWithTrimming || "-",
      "Cutting Trim": (r.production as any).cuttingWithTrimming || r.item?.cuttingSize || "-",
      "Planned Prod (M)": r.production.plannedProductionInMeter ?? "-",
      "Sheet Wt": r.production.sheetWeight || "-",
      "Flute Batch": r.production.fluteBatches || "-",
      Rate: Number(r.production.rate) ? Number(r.production.rate).toFixed(2) : (r.production.rate || "-"),
      Value: Number(r.production.qty || 0) && Number(r.production.rate || 0) ? (Number(r.production.qty || 0) * Number(r.production.rate || 0)).toLocaleString() : "-",
      "Production FFG": Number(r.production.prodFromFFG || 0),
      "Actual Paper (KG)": Number(r.actualPaperUsed.toFixed(2)),
      "Job Closer": r.production.closeBy || "-",
      "Close Date": r.production.closeDate || "-",
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

  const cancelTarget = cancelModalJobId ? productions.find((p) => p.id === cancelModalJobId) : null;
  const cancelTargetSchedule = cancelTarget?.scheduleId ? schedules.find((s) => s.id === cancelTarget.scheduleId) : null;
  const cancelTargetOrder = cancelTargetSchedule ? orders.find((o) => o.id === cancelTargetSchedule.orderId) : null;
  const cancelTargetItem = cancelTarget ? npdItems.find((i) => i.id === String(cancelTarget.itemId || "").trim()) : null;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[5px_5px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-white px-1.5 py-1.5 md:px-2">
          <div className="flex flex-col gap-1.5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-[22px] font-black uppercase tracking-tight text-slate-950 md:text-[24px]">Operation Dashboard</h2>
            </div>
            <div className="flex flex-wrap items-stretch justify-end gap-1">
              <DateInput value={dateRange.from} onChange={(value) => setDateRange((prev) => ({ ...prev, from: value }))} />
              <DateInput value={dateRange.to} onChange={(value) => setDateRange((prev) => ({ ...prev, to: value }))} />
              <button
                type="button"
                onClick={() => setDateRange({ from: "", to: "" })}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-md border-2 border-slate-900 bg-rose-50 px-2.5 py-1 text-[10px] font-black uppercase text-rose-700 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
              >
                Clear
              </button>
              <div className="flex items-center gap-1.5 rounded-md border-2 border-slate-900 bg-white px-2.5 py-1 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]">
                <label htmlFor="closed-job-filter-top" className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">
                  Closed Job
                </label>
                <select
                  id="closed-job-filter-top"
                  value={closedJobFilter}
                  onChange={(event) => setClosedJobFilter(event.target.value as ClosedJobFilter)}
                    className="rounded border border-slate-900 bg-white px-1.5 py-0.5 text-xs font-bold outline-none"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              {allowExports ? (
                <ExcelExport data={exportData} fileName={`Operation_Dashboard_${dateRange.from}_${dateRange.to}`} />
              ) : null}
              <button
                type="button"
                onClick={() => setIsColumnsOpen((v) => !v)}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-md border-2 border-slate-900 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
              >
                <SlidersHorizontal size={14} strokeWidth={3} />
                Columns
              </button>
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-1 gap-1.5 xl:grid-cols-12">
              {SUMMARY_GROUP_CONFIGS.map((groupConfig) => {
                const group = summary.groups.find((entry) => entry.id === groupConfig.groupId);
                if (!group) return null;
                return (
                  <section
                    key={group.id}
                    className={cn("overflow-hidden rounded-lg border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]", groupConfig.className)}
                  >
                    <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">{group.title}</div>
                    <div className={cn("grid gap-0", groupConfig.gridClassName)}>
                      {groupConfig.cards.map((cardConfig) => {
                        const card = getSummaryCard(summary, cardConfig.id);
                        if (!card) return null;
                        return (
                          <SummaryMetricCard
                            key={card.id}
                            card={card}
                            config={cardConfig}
                            index={groupConfig.cards.findIndex((entry) => entry.id === cardConfig.id)}
                            total={groupConfig.cards.length}
                            columns={groupConfig.columns}
                          />
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center">
        <div className="flex-1 rounded-lg border-2 border-slate-900 bg-white p-1 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search jobs, items, parties..." />
        </div>
      </div>

      {isColumnsOpen ? (
        <div ref={columnsPanelRef} className="rounded-md border-2 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
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

      <div className="overflow-hidden rounded-lg border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="flex items-center justify-between border-b border-slate-900 bg-slate-100 px-3 py-2">
          <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-black">Production Master View</h3>
          <div className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-black text-indigo-700">{rows.length} records</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-max w-full border-collapse">
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
                      "px-2 py-1.5 text-left text-[10px] font-black uppercase text-slate-900 border-b border-r border-black whitespace-nowrap select-none cursor-move bg-slate-100",
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                      c.id === "paper" || c.id === "liner" || c.id === "print" || c.id === "paste" || c.id === "stitch" || c.id === "punch" || c.id === "glue" ? "bg-indigo-50 text-indigo-900" :
                      c.id === "loadedQty" ? "bg-amber-50" :
                      c.id === "prodFromFFG" ? "bg-indigo-50/50" :
                      c.id === "actualPaperUsed" ? "bg-emerald-50 text-emerald-900" : ""
                    )}
                    title="Drag to reorder"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length || 1} className="px-6 py-7 text-center text-sm font-medium text-black">
                    No productions found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.production.id} className="divide-x divide-black border-b border-black/80 transition-colors odd:bg-white even:bg-slate-50/40 hover:bg-sky-50/50">
                    {visibleColumns.map((c) => {
                      const value = c.render(row);
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            "px-2 py-1.5 text-[10px] text-black border-r border-black/90 align-top",
                            c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                            c.id === "itemName" ? "whitespace-normal min-w-[150px]" : "whitespace-nowrap",
                            c.id === "paper" || c.id === "liner" || c.id === "print" || c.id === "paste" || c.id === "stitch" || c.id === "punch" || c.id === "glue" ? "bg-indigo-50/30" :
                            c.id === "loadedQty" ? "bg-amber-50/40" :
                            c.id === "prodFromFFG" ? "bg-indigo-50/20" :
                            c.id === "actualPaperUsed" ? "bg-emerald-50/30" : "",
                            c.className
                          )}
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

      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCancelModalJobId(null)}>
          <div className="w-full max-w-lg rounded border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-black px-5 py-4">
              <h3 className="text-lg font-black uppercase tracking-tight text-black">Cancel Job</h3>
              <div className="mt-2 text-xs font-bold text-slate-600">
                Job: {cancelTarget.transactionNo} | Order: {cancelTargetOrder?.orderNo || "-"} | Item: {cancelTargetItem?.name || "Unknown"}
              </div>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="text-sm font-medium text-slate-700">
                This will return{" "}
                <span className="font-black text-red-700">
                  {Number(cancelTarget.qty || 0).toLocaleString()} {cancelTarget.uom || ""}
                </span>{" "}
                to Pending Production Plan.
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-wider text-black">
                  Cancel Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  autoFocus
                  rows={4}
                  value={cancelRemarks}
                  onChange={(e) => {
                    setCancelRemarks(e.target.value);
                    if (cancelError) setCancelError("");
                  }}
                  placeholder="Enter cancellation reason"
                  className={`w-full rounded border-2 px-3 py-2 text-sm text-black outline-none ${cancelError ? "border-red-600" : "border-black"}`}
                />
                {cancelError ? <div className="text-xs font-bold text-red-600">{cancelError}</div> : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-black px-5 py-4">
              <button
                onClick={() => setCancelModalJobId(null)}
                disabled={Boolean(cancelSubmittingId)}
                className="rounded border border-black px-4 py-2 text-sm font-bold text-black hover:bg-slate-50 disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={() => void handleCancelJob()}
                disabled={Boolean(cancelSubmittingId)}
                className="rounded border border-black bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelSubmittingId === cancelTarget.id ? "Cancelling..." : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-h-[34px] items-center rounded-md border-2 border-slate-900 bg-slate-50 px-2 py-0.5 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]">
      <input
        type="date"
        className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-black leading-tight uppercase text-slate-900 focus:ring-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SummaryMetricCard({
  card,
  config,
  index,
  total,
  columns,
}: {
  card: OperationDashboardMetricCard;
  config: SummaryCardConfig;
  index: number;
  total: number;
  columns: number;
}) {
  const colIndex = index % columns;
  const rowIndex = Math.floor(index / columns);
  const totalRows = Math.ceil(total / columns);
  const isLastColumn = colIndex === columns - 1;
  const isLastRow = rowIndex === totalRows - 1;

  return (
    <div
      className={cn(
        "flex min-h-[50px] flex-col justify-between px-1.5 py-1",
        !isLastColumn && "border-r border-black",
        !isLastRow && "border-b border-black",
        config.tone,
        config.className
      )}
    >
      <div className="text-[6px] font-black uppercase tracking-[0.06em] text-slate-700">{card.label}</div>
      <div className={cn("mt-0 text-[15px] font-black leading-none tracking-tight text-black", config.valueTone)}>{formatMetricValue(card)}</div>
      <div className="mt-0 text-[6px] font-semibold uppercase tracking-[0.04em] text-slate-500">
        {card.note || (card.status === "unavailable" ? "Pending data source" : "")}
      </div>
    </div>
  );
}
