import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import type {
  Company,
  Consumption,
  DispatchPlan,
  GateEntry,
  GatePass,
  Invoice,
  InvoiceLineItem,
  Indent,
  IndentLine,
  Item,
  Machine,
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
  PurchaseOrder,
  Production,
  ProductionProcessing,
  SampleRequest,
  Setting,
} from "../types";
import { ExcelExport } from "../components/ExcelExport";
import { exportsAllowed } from "../lib/exportPolicy";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "../lib/productionMaterialUsage";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";
import { formatDate } from "../lib/serial";
import { cn, formatCurrency, formatNumber } from "../lib/utils";
import {
  buildOperationDashboardSummary,
  getSafeRange,
  isDateWithinRange,
} from "../lib/operationDashboard";
import { buildPendingTaskCounts, getPendingTaskGroups } from "../lib/pendingTaskCounts";
import { buildScrapInvoiceRows, summarizeScrapInvoiceRows } from "../lib/wastageReport";

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
  processingTotals: ProcessingTotals;
  loadedQty: number;
  leastGsm: number | null;
  actualPaperUsed: number;
};

type SummaryCardConfig = {
  id: string;
  tone: string;
  valueTone?: string;
};

type SummaryGroupConfig = {
  groupId: string;
  cards: SummaryCardConfig[];
};

type ClosedJobFilter = "all" | "yes" | "no";

const SUMMARY_GROUP_CONFIGS: SummaryGroupConfig[] = [
  {
    groupId: "production",
      cards: [
        { id: "production", tone: "bg-cyan-50", valueTone: "text-cyan-800" },
        { id: "linearMeter", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
        { id: "todayPlanQty", tone: "bg-amber-50", valueTone: "text-amber-800" },
        { id: "todayPlanValue", tone: "bg-rose-50", valueTone: "text-rose-800" },
        { id: "tomorrowPlanQty", tone: "bg-sky-50", valueTone: "text-sky-800" },
        { id: "tomorrowPlanValue", tone: "bg-fuchsia-50", valueTone: "text-fuchsia-800" },
        { id: "actualPaperUsed", tone: "bg-violet-50", valueTone: "text-violet-800" },
        { id: "scrapSoldQty", tone: "bg-teal-50", valueTone: "text-teal-800" },
        { id: "wastage", tone: "bg-orange-50", valueTone: "text-orange-800" },
        { id: "planPaper", tone: "bg-indigo-50", valueTone: "text-indigo-800" },
        { id: "activeJobs", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
        { id: "pendingTally", tone: "bg-lime-50", valueTone: "text-lime-800" }
      ],
  },
  {
    groupId: "dispatch",
    cards: [
      { id: "dispatchPlannedQty", tone: "bg-indigo-50", valueTone: "text-indigo-800" },
      { id: "dispatchLoadedQty", tone: "bg-blue-50", valueTone: "text-blue-800" },
      { id: "loadingQty", tone: "bg-violet-50", valueTone: "text-violet-800" },
      { id: "pendingPlanningValue", tone: "bg-pink-50", valueTone: "text-pink-800" },
    ],
  },
  {
    groupId: "sales",
    cards: [
      { id: "totalSales", tone: "bg-emerald-50", valueTone: "text-emerald-800" },
      { id: "todaySalesValue", tone: "bg-teal-50", valueTone: "text-teal-800" },
      { id: "invoiceCount", tone: "bg-yellow-50", valueTone: "text-yellow-800" },
    ],
  },
];

const PROCESSING_MACHINE_CARD_ORDER = [
  "Corrugation Paper",
  "Corrugation Liner",
  "Printing",
  "Pasting",
  "Rotary",
  "Slotting",
  "Stitching",
  "Punching",
  "Gluing",
] as const;

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
  return { from: "", to: "" };
}

function getSummaryCard(summary: OperationDashboardSummary, cardId: string) {
  return summary.groups.flatMap((group) => group.cards).find((card) => card.id === cardId) || null;
}

export function OperationDashboard() {
  const navigate = useNavigate();
  const [productions] = useData<Production>("productions", []);
  const [phpJobMaster] = useData<Production>("php_job_master", []);
  const [plateJobMaster] = useData<Production>("plate_job_master", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem, findItem, findItemAcrossSources, itemsBySource } = useOrderItemCatalog();
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [gateEntries] = useData<GateEntry>("gate-entries", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [invoiceLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [sampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [indents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [phpLoadingSlips] = useData<LoadingSlip>("php_loading_slips", []);
  const [plateLoadingSlips] = useData<LoadingSlip>("plate_loading_slips", []);
  const [gatePasses] = useData<GatePass>("gate_passes", []);
  const [machines] = useData<Machine>("machines", []);
  const [settings] = useData<Setting>("settings", []);

  const allowExports = exportsAllowed();
  const [dateRange, setDateRange] = useState(getDefaultRange);
  const [closedJobFilter, setClosedJobFilter] = useState<ClosedJobFilter>("no");
  const [pendingJobClosureCount, setPendingJobClosureCount] = useState<number>(0);
  const operationExportFileName =
    dateRange.from && dateRange.to
      ? `Operation_Dashboard_${dateRange.from}_${dateRange.to}`
      : "Operation_Dashboard_All_Dates";

  useEffect(() => {
    const refreshPendingJobClosureCount = async () => {
      try {
        const token = window.localStorage.getItem("authToken") || "";
        const response = await fetch("/api/get-pending-job-closure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        setPendingJobClosureCount(Array.isArray(rows) ? rows.length : 0);
      } catch {
        setPendingJobClosureCount(0);
      }
    };

    void refreshPendingJobClosureCount();
  }, []);

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

  const scrapInvoiceSummary = useMemo(() => {
    const scrapRows = buildScrapInvoiceRows({
      invoices,
      lineItems: invoiceLineItems,
      companies,
      filters: { fromDate: dateRange.from, toDate: dateRange.to },
      findItem,
      findItemAcrossSources,
    });
    return summarizeScrapInvoiceRows(scrapRows);
  }, [companies, dateRange.from, dateRange.to, findItem, findItemAcrossSources, invoiceLineItems, invoices]);
  const rows: OperationRow[] = useMemo(() => {
    const sorted = filteredProductions
      .map((p) => {
        const schedule = schedules.find((s) => s.id === p.scheduleId);
        const order = orders.find((o) => o.id === schedule?.orderId);
        const company = companies.find((c) => c.id === order?.companyId);
        const item = npdItems.find((i) => i.id === p.itemId);

        const processingTotals =
          processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
        const loadedQty = Number(loadedQtyByProductionId.get(p.id) || 0);
        const erp = String(p.erpCode || "").trim();
        const leastGsm = erp ? (erpLeastGsmMap.get(erp) ?? null) : null;

        const actualPaperUsed = getProductionActualPaperUsed(p, productionUsageMap);

        return {
          srNo: 0,
          production: p,
          item,
          schedule,
          order,
          company,
          processingTotals,
          loadedQty,
          leastGsm,
          actualPaperUsed,
        };
      })
      .filter((row) => {
        const isClosedJob = Boolean(row.production.closeDate || row.production.closeBy || row.production.status === "Completed");
        if (closedJobFilter === "yes" && !isClosedJob) return false;
        if (closedJobFilter === "no" && isClosedJob) return false;

        return true;
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
    productionUsageMap,
    closedJobFilter,
  ]);

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
        scrapSoldQty: scrapInvoiceSummary.totalQty,
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
      scrapInvoiceSummary.totalQty,
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

  const pendingTaskSummary = useMemo(() => {
    const counts = buildPendingTaskCounts({
      materialIn,
      productions,
      phpJobMaster,
      plateJobMaster,
      materials,
      orders,
      npdItems,
      consumptions,
      materialIssues,
      materialIssueLines,
      materialIssueReelLines: issueReelLines,
      materialReturns,
      materialReturnLines,
      materialReturnReelLines: returnReelLines,
      sampleRequests,
      indents,
      indentLines,
      purchaseOrders,
      gateEntries,
      schedules,
      dispatchPlans,
      loadingSlips,
      phpLoadingSlips,
      plateLoadingSlips,
      invoices,
      gatePasses,
      machines,
      processing,
      settings,
      pendingJobClosureCount,
      resolveOrderItem,
      findItemAcrossSources,
      itemsBySource,
    });
    return getPendingTaskGroups(counts);
  }, [
    materialIn,
    productions,
    phpJobMaster,
    plateJobMaster,
    materials,
    orders,
    npdItems,
    consumptions,
    materialIssues,
    materialIssueLines,
    issueReelLines,
    materialReturns,
    materialReturnLines,
    returnReelLines,
    sampleRequests,
    indents,
    indentLines,
    purchaseOrders,
    gateEntries,
    schedules,
    dispatchPlans,
    loadingSlips,
    phpLoadingSlips,
    plateLoadingSlips,
    invoices,
    gatePasses,
    machines,
    processing,
    settings,
    pendingJobClosureCount,
    resolveOrderItem,
    findItemAcrossSources,
    itemsBySource,
  ]);
  const processingMachineCards = useMemo(() => {
    const machineMap = new Map<string, { qty: number; entries: number }>();

    processing
      .filter((entry) => (safeRange ? isDateWithinRange(entry.date, safeRange) : true))
      .forEach((entry) => {
        const machineName = normalizeMachineName(entry.machineName || "").trim();
        if (!machineName) return;
        const current = machineMap.get(machineName) || { qty: 0, entries: 0 };
        current.qty += Number(entry.qty || 0);
        current.entries += 1;
        machineMap.set(machineName, current);
      });

    const cards: OperationDashboardMetricCard[] = PROCESSING_MACHINE_CARD_ORDER.map((machineName) => {
      const totals = machineMap.get(machineName) || { qty: 0, entries: 0 };
      return {
        id: `processing-${machineName.toLowerCase().replace(/\s+/g, "-")}`,
        label: machineName,
        value: totals.qty,
        format: "number" as const,
        note: `${totals.entries} entr${totals.entries === 1 ? "y" : "ies"}`,
        status: "ready" as const,
      };
    });

    machineMap.forEach((totals, machineName) => {
      if (PROCESSING_MACHINE_CARD_ORDER.includes(machineName as (typeof PROCESSING_MACHINE_CARD_ORDER)[number])) return;
      cards.push({
        id: `processing-${machineName.toLowerCase().replace(/\s+/g, "-")}`,
        label: machineName,
        value: totals.qty,
        format: "number" as const,
        note: `${totals.entries} entr${totals.entries === 1 ? "y" : "ies"}`,
        status: "ready" as const,
      });
    });

    return cards;
  }, [processing, safeRange]);

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
      "Liner Req.": r.production.lineRequiredNos ?? "-",
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

  return (
    <div className="space-y-4">
      {/* Top Banner Control Section */}
      <div className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-white px-3 py-3">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-slate-950 md:text-2xl">
                Operation Dashboard
              </h2>
            </div>
            <div className="flex flex-wrap items-stretch justify-end gap-1.5">
              <DateInput value={dateRange.from} onChange={(value) => setDateRange((prev) => ({ ...prev, from: value }))} />
              <DateInput value={dateRange.to} onChange={(value) => setDateRange((prev) => ({ ...prev, to: value }))} />
              <button
                type="button"
                onClick={() => setDateRange({ from: "", to: "" })}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-md border-2 border-slate-900 bg-rose-50 px-3 py-1 text-[10px] font-black uppercase text-rose-700 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none cursor-pointer font-sans"
              >
                Clear
              </button>
              <div className="flex items-center gap-1.5 rounded-md border-2 border-slate-900 bg-white px-3 py-1 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]">
                <label htmlFor="closed-job-filter-top" className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">
                  Closed Job
                </label>
                <select
                  id="closed-job-filter-top"
                  value={closedJobFilter}
                  onChange={(event) => setClosedJobFilter(event.target.value as ClosedJobFilter)}
                  className="rounded border border-slate-900 bg-white px-1.5 py-0.5 text-xs font-bold outline-none cursor-pointer font-sans"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              {allowExports ? (
                <ExcelExport data={exportData} fileName={operationExportFileName} />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Main Metric Sections in single row panels */}
      <div className="space-y-4">
        {SUMMARY_GROUP_CONFIGS.map((groupConfig) => {
          const group = summary.groups.find((entry) => entry.id === groupConfig.groupId);
          if (!group) return null;
          return (
            <section
              key={group.id}
              className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]"
            >
              {/* Section Heading */}
              <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900">
                {group.title}
              </div>
              {/* Single Horizontal Row of Bordered Blocks */}
              <div className="flex overflow-x-auto divide-x divide-slate-900 scrollbar-thin">
                {groupConfig.cards.map((cardConfig) => {
                  const card = getSummaryCard(summary, cardConfig.id);
                  if (!card) return null;
                  return (
                    <SummaryMetricCard
                      key={card.id}
                      card={card}
                      config={cardConfig}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900">
          Production Processing
        </div>
        <div className="flex overflow-x-auto divide-x divide-slate-900 scrollbar-thin">
          {processingMachineCards.map((card, index) => (
            <SummaryMetricCard
              key={card.id}
              card={card}
              config={{
                id: card.id,
                tone: index % 2 === 0 ? "bg-cyan-50" : "bg-emerald-50",
                valueTone: index % 2 === 0 ? "text-cyan-800" : "text-emerald-800",
              }}
            />
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="flex items-center justify-between gap-3 bg-red-700 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900">
          <span>Pending Tasks</span>
          <span className="rounded border border-white/30 bg-white/10 px-2 py-0.5 text-right text-[10px] tracking-[0.12em]">
            Total Pending: {pendingTaskSummary.grandTotal.toLocaleString("en-IN")}
          </span>
        </div>
        <div className="bg-white text-xs">
          {pendingTaskSummary.groups.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
              No pending tasks found.
            </div>
          ) : (
            <div className="divide-y-2 divide-slate-900">
              {pendingTaskSummary.groups.map((group) => (
                <div key={group.section}>
                  <div className="flex items-center justify-between gap-3 bg-slate-900 px-3 py-2 text-white">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em]">{group.section}</span>
                    <span className="text-sm font-black">{group.sectionTotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="grid grid-cols-1 border-t-2 border-slate-900 sm:grid-cols-2 xl:grid-cols-4">
                    {group.rows.map((row, index) => (
                      <button
                        key={row.countKey}
                        type="button"
                        onClick={() => navigate(row.countKey)}
                        className={cn(
                          "flex min-h-[54px] items-center justify-between gap-3 border-b border-slate-900 px-3 py-2 text-left transition hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:border-r",
                          index % 2 === 0 ? "bg-white" : "bg-slate-50"
                        )}
                      >
                        <span className="min-w-0 text-[11px] font-bold uppercase tracking-wide text-slate-900 underline-offset-2">
                          {row.name}
                        </span>
                        <span className="shrink-0 text-sm font-black text-indigo-700">
                          {row.count.toLocaleString("en-IN")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {pendingTaskSummary.grandTotal > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t-2 border-slate-900 bg-indigo-50 px-3 py-2">
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-900">Total Pending</span>
              <span className="text-base font-black text-indigo-800">
                {pendingTaskSummary.grandTotal.toLocaleString("en-IN")}
              </span>
            </div>
          ) : null}
        </div>
      </section>

    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-h-[34px] items-center rounded-md border-2 border-slate-900 bg-slate-50 px-2.5 py-0.5 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]">
      <input
        type="date"
        className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-black leading-tight uppercase text-slate-900 focus:ring-0 outline-none font-sans"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SummaryMetricCard({
  card,
  config,
}: {
  card: OperationDashboardMetricCard;
  config: SummaryCardConfig;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between p-3.5 min-w-[155px] flex-1 bg-white transition-colors hover:bg-slate-50/50",
        config.tone
      )}
    >
      <div>
        <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 leading-none font-sans">
          {card.label}
        </div>
        <div className={cn("mt-2.5 text-base font-black leading-none tracking-tight text-slate-950 font-sans", config.valueTone)}>
          {formatMetricValue(card)}
        </div>
      </div>
      {card.note && (
        <div className="mt-2 text-[8px] font-bold uppercase tracking-wide text-slate-500 leading-none font-sans">
          {card.note}
        </div>
      )}
    </div>
  );
}
