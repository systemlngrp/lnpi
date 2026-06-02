import type {
  DispatchPlan,
  Invoice,
  LoadingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialReturn,
  MaterialReturnLine,
  OperationDashboardMetricCard,
  OperationDashboardMetricGroup,
  OperationDashboardSummary,
  Order,
  OrderSchedule,
  Production,
  ProductionProcessing,
} from "../types";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "./productionMaterialUsage";
import { PROCESSING_MACHINE_COLUMNS } from "./productionProcessingSummary";
import { isProductionReadyForTally } from "./productionStageFilters";

export type OperationDashboardDateRange = {
  from: string;
  to: string;
};

type BuildOperationDashboardSummaryArgs = {
  dateRange: OperationDashboardDateRange;
  productions: Production[];
  schedules: OrderSchedule[];
  orders: Order[];
  dispatchPlans: DispatchPlan[];
  loadingSlips: LoadingSlip[];
  invoices: Invoice[];
  processing: ProductionProcessing[];
  materialIssues: MaterialIssue[];
  materialIssueLines: MaterialIssueLine[];
  materialReturns: MaterialReturn[];
  materialReturnLines: MaterialReturnLine[];
};

function makeCard(card: OperationDashboardMetricCard): OperationDashboardMetricCard {
  return { status: "ready", ...card };
}

export function parseAppDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = String(dateStr).trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split("/").map(Number);
    return new Date(year, month - 1, day);
  }

  const datePartMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (datePartMatch) {
    const [, year, month, day] = datePartMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDateValue(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function getLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(value: string) {
  const parsed = parseAppDate(value);
  if (!parsed) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

export function getSafeRange(dateRange: OperationDashboardDateRange) {
  const from = parseAppDate(dateRange.from);
  const to = parseAppDate(dateRange.to);
  if (!from || !to) return null;

  const fromTime = normalizeDateValue(from);
  const toTime = normalizeDateValue(to);
  return fromTime <= toTime
    ? { fromTime, toTime, fromDate: from, toDate: to }
    : { fromTime: toTime, toTime: fromTime, fromDate: to, toDate: from };
}

export function isDateWithinRange(dateStr: string | undefined, safeRange: ReturnType<typeof getSafeRange>) {
  const parsed = parseAppDate(dateStr);
  if (!parsed || !safeRange) return false;
  const target = normalizeDateValue(parsed);
  return target >= safeRange.fromTime && target <= safeRange.toTime;
}

function getRangeLabel(dateRange: OperationDashboardDateRange) {
  return `${formatDisplayDate(dateRange.from)} to ${formatDisplayDate(dateRange.to)}`;
}

function getShiftedRange(dateRange: OperationDashboardDateRange, dayOffset: number): OperationDashboardDateRange {
  const safeRange = getSafeRange(dateRange);
  if (!safeRange) return dateRange;
  const from = new Date(safeRange.fromDate);
  const to = new Date(safeRange.toDate);
  from.setDate(from.getDate() + dayOffset);
  to.setDate(to.getDate() + dayOffset);
  return {
    from: getLocalDateInputValue(from),
    to: getLocalDateInputValue(to),
  };
}

function getRangeSpanDays(dateRange: OperationDashboardDateRange) {
  const safeRange = getSafeRange(dateRange);
  if (!safeRange) return 0;
  return Math.round((safeRange.toTime - safeRange.fromTime) / 86400000) + 1;
}

function getPlanPaper(production: Production) {
  const total = Number(production.totalJobWeight || 0);
  if (total > 0) return total;
  const top = Number(production.topPaperWeightKg || 0);
  const liner = Number(production.linerWeightKg || 0);
  const sum = top + liner;
  return sum > 0 ? sum : 0;
}

function sumProductionQty(rows: Production[]) {
  return rows
    .filter((entry) => entry.status !== "Cancelled" && !entry.cancelTimestamp)
    .reduce((sum, entry) => sum + Number(entry.prodFromFFG || entry.qty || 0), 0);
}

function sumProductionMeter(rows: Production[]) {
  return rows
    .filter((entry) => entry.status !== "Cancelled" && !entry.cancelTimestamp)
    .reduce((sum, entry) => sum + Number(entry.productionInMeter || 0), 0);
}

function sumPlanValue(rows: OrderSchedule[], orders: Order[]) {
  return rows.reduce((sum, schedule) => {
    const order = orders.find((row) => row.id === schedule.orderId);
    return sum + Number(schedule.qty || 0) * Number(order?.rate || 0);
  }, 0);
}

function getPendingPlanningRows(rows: OrderSchedule[], dispatchPlans: DispatchPlan[]) {
  return rows.filter((schedule) => {
    const plannedQty = dispatchPlans
      .filter((plan) => plan.scheduleId === schedule.id)
      .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
    const balanceQty = Number(schedule.qty || 0) - Number(schedule.canceledQty || 0) - plannedQty;
    return balanceQty > 0;
  });
}

function sumPendingPlanningValue(rows: OrderSchedule[], dispatchPlans: DispatchPlan[], orders: Order[]) {
  return getPendingPlanningRows(rows, dispatchPlans).reduce((sum, schedule) => {
    const plannedQty = dispatchPlans
      .filter((plan) => plan.scheduleId === schedule.id)
      .reduce((innerSum, plan) => innerSum + Number(plan.plannedQty || 0), 0);
    const balanceQty = Math.max(0, Number(schedule.qty || 0) - Number(schedule.canceledQty || 0) - plannedQty);
    const order = orders.find((row) => row.id === schedule.orderId);
    return sum + balanceQty * Number(order?.rate || 0);
  }, 0);
}

function sumLoadingQty(rows: LoadingSlip[]) {
  return rows
    .filter((slip) => slip.status !== "Cancelled")
    .reduce(
      (sum, slip) =>
        sum +
        slip.lines.reduce((lineSum, line) => lineSum + Number(line.loadedQty || 0), 0) +
        Number(slip.extraItemsQty || 0),
      0
    );
}

function sumDispatchPlanQty(rows: DispatchPlan[]) {
  return rows.reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
}

function sumDispatchLoadedQty(rows: DispatchPlan[]) {
  return rows.reduce((sum, plan) => sum + Number(plan.loadedQty || 0), 0);
}

function getWastagePercent(rows: Production[], usageMap: Map<string, number>) {
  const validRows = rows.filter((entry) => entry.status !== "Cancelled" && !entry.cancelTimestamp);
  const totalActualPaperUsed = validRows.reduce(
    (sum, entry) => sum + Number(getProductionActualPaperUsed(entry, usageMap) || 0),
    0
  );
  const totalUsefulWeight = validRows.reduce(
    (sum, entry) => sum + Number(entry.prodFromFFG || 0) * Number(entry.sheetWeight || 0),
    0
  );
  return totalActualPaperUsed > 0
    ? Math.max(0, 100 - (totalUsefulWeight / totalActualPaperUsed) * 100)
    : 0;
}

function getActualPaperUsed(rows: Production[], usageMap: Map<string, number>) {
  return rows
    .filter((entry) => entry.status !== "Cancelled" && !entry.cancelTimestamp)
    .reduce((sum, entry) => sum + Number(getProductionActualPaperUsed(entry, usageMap) || 0), 0);
}

function getPlanPaperTotal(rows: Production[]) {
  return rows
    .filter((entry) => entry.status !== "Cancelled" && !entry.cancelTimestamp)
    .reduce((sum, entry) => sum + getPlanPaper(entry), 0);
}

function getComparisonCards(dateRange: OperationDashboardDateRange, invoices: Invoice[], productions: Production[]) {
  const spanDays = getRangeSpanDays(dateRange);
  const previousRange = getShiftedRange(dateRange, -spanDays);
  const nextRange = getShiftedRange(dateRange, spanDays);
  return {
    previousRange,
    nextRange,
    comparisonLabel: getRangeLabel(previousRange),
    nextLabel: getRangeLabel(nextRange),
    previousSale: (rows: Invoice[]) => rows.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0),
    previousProduction: (rows: Production[]) => sumProductionQty(rows),
  };
}

function getProcessingTotals(rows: ProductionProcessing[]) {
  const totals = {
    paper: 0,
    liner: 0,
    printing: 0,
    pasting: 0,
    stitching: 0,
    punching: 0,
    gluing: 0,
  };

  rows.forEach((row) => {
    const machineColumn = PROCESSING_MACHINE_COLUMNS.find((column) =>
      (column.machineNames as readonly string[]).includes(row.machineName)
    );
    if (!machineColumn) return;
    totals[machineColumn.key] += Number(row.qty || 0);
  });

  return totals;
}

export function buildOperationDashboardSummary(args: BuildOperationDashboardSummaryArgs): OperationDashboardSummary {
  const safeRange = getSafeRange(args.dateRange);
  const rangeLabel = getRangeLabel(args.dateRange);
  const { previousRange, nextRange, comparisonLabel, nextLabel } = getComparisonCards(
    args.dateRange,
    args.invoices,
    args.productions
  );
  const previousSafeRange = getSafeRange(previousRange);
  const nextSafeRange = getSafeRange(nextRange);

  const filteredProductions = args.productions.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const previousProductions = args.productions.filter((entry) => isDateWithinRange(entry.date, previousSafeRange));
  const filteredSchedules = args.schedules.filter((entry) => isDateWithinRange(entry.scheduledDate, safeRange));
  const nextSchedules = args.schedules.filter((entry) => isDateWithinRange(entry.scheduledDate, nextSafeRange));
  const filteredDispatchPlans = args.dispatchPlans.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const filteredLoadingSlips = args.loadingSlips.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const filteredInvoices = args.invoices.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const previousInvoices = args.invoices.filter((entry) => isDateWithinRange(entry.date, previousSafeRange));
  const filteredProcessing = args.processing.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const filteredMaterialIssues = args.materialIssues.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const filteredMaterialReturns = args.materialReturns.filter((entry) => isDateWithinRange(entry.date, safeRange));
  const usageMap = buildProductionMaterialUsageMap(
    filteredMaterialIssues,
    args.materialIssueLines,
    filteredMaterialReturns,
    args.materialReturnLines
  );

  const totalProduction = sumProductionQty(filteredProductions);
  const previousProduction = sumProductionQty(previousProductions);
  const totalProductionMeter = sumProductionMeter(filteredProductions);
  const totalPlanValue = sumPlanValue(filteredSchedules, args.orders);
  const nextPlanValue = sumPlanValue(nextSchedules, args.orders);
  const totalWastage = getWastagePercent(filteredProductions, usageMap);
  const totalActualPaperUsed = getActualPaperUsed(filteredProductions, usageMap);
  const totalPlanPaper = getPlanPaperTotal(filteredProductions);
  const totalSale = filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);
  const previousSale = previousInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);
  const pendingPlanningRows = getPendingPlanningRows(filteredSchedules, args.dispatchPlans);
  const pendingPlanningValue = sumPendingPlanningValue(filteredSchedules, args.dispatchPlans, args.orders);
  const dispatchPlannedQty = sumDispatchPlanQty(filteredDispatchPlans);
  const dispatchLoadedQty = sumDispatchLoadedQty(filteredDispatchPlans);
  const loadingSlipQty = sumLoadingQty(filteredLoadingSlips);
  const processingTotals = getProcessingTotals(filteredProcessing);
  const activeJobs = filteredProductions.filter((row) => row.status !== "Cancelled" && !row.cancelTimestamp).length;
  const cancelledJobs = filteredProductions.filter((row) => row.status === "Cancelled" || !!row.cancelTimestamp).length;
  const pendingTallyJobs = filteredProductions.filter((row) =>
    isProductionReadyForTally(row, getProductionActualPaperUsed(row, usageMap))
  ).length;
  const pendingConsumptionJobs = filteredProductions.filter((row) => row.status === "Pending Consumption").length;
  const wipQty = Math.max(0, totalProduction - loadingSlipQty);

  const groups: OperationDashboardMetricGroup[] = [
    {
      id: "headline",
      title: "Production Planning",
      cards: [
        makeCard({ id: "production", label: "Range Production", value: totalProduction, format: "number" }),
        makeCard({ id: "previousProduction", label: "Previous Range Production", value: previousProduction, format: "number" }),
        makeCard({ id: "planValue", label: "Range Plan Value", value: totalPlanValue, format: "currency" }),
        makeCard({ id: "nextPlanValue", label: "Next Range Plan Value", value: nextPlanValue, format: "currency" }),
        makeCard({ id: "linearMeter", label: "Range Linear Meter", value: totalProductionMeter, format: "number" }),
        makeCard({ id: "wastage", label: "Total Wastage", value: totalWastage, format: "percent" }),
      ],
    },
    {
      id: "dispatch",
      title: "Dispatch & Sales",
      cards: [
        makeCard({ id: "rangeSale", label: "Range Sale", value: totalSale, format: "currency" }),
        makeCard({ id: "previousSale", label: "Previous Range Sale", value: previousSale, format: "currency" }),
        makeCard({ id: "dispatchPlannedQty", label: "Dispatch Planned Qty", value: dispatchPlannedQty, format: "number" }),
        makeCard({ id: "dispatchLoadedQty", label: "Dispatch Loaded Qty", value: dispatchLoadedQty, format: "number" }),
        makeCard({ id: "loadingQty", label: "Loading Slip Qty", value: loadingSlipQty, format: "number" }),
        makeCard({ id: "invoiceCount", label: "Invoices", value: filteredInvoices.length, format: "number" }),
      ],
    },
    {
      id: "workflow",
      title: "Workflow & Due",
      cards: [
        makeCard({ id: "pendingPlanningCount", label: "Pending Dispatch Plans", value: pendingPlanningRows.length, format: "number" }),
        makeCard({ id: "pendingPlanningValue", label: "Pending Dispatch Value", value: pendingPlanningValue, format: "currency" }),
        makeCard({ id: "wipQty", label: "WIP Qty", value: wipQty, format: "number", note: "Production minus active loading qty" }),
        makeCard({ id: "activeJobs", label: "Active Jobs", value: activeJobs, format: "number" }),
        makeCard({ id: "cancelledJobs", label: "Cancelled Jobs", value: cancelledJobs, format: "number" }),
        makeCard({ id: "pendingTally", label: "Pending Tally Jobs", value: pendingTallyJobs, format: "number" }),
      ],
    },
    {
      id: "operations",
      title: "Operations Summary",
      cards: [
        makeCard({ id: "paper", label: "Paper", value: processingTotals.paper, format: "number" }),
        makeCard({ id: "liner", label: "Liner", value: processingTotals.liner, format: "number" }),
        makeCard({ id: "printing", label: "Printing", value: processingTotals.printing, format: "number" }),
        makeCard({ id: "pasting", label: "Pasting", value: processingTotals.pasting, format: "number" }),
        makeCard({ id: "stitching", label: "Stitching", value: processingTotals.stitching, format: "number" }),
        makeCard({ id: "processingEntries", label: "Processing Entries", value: filteredProcessing.length, format: "number" }),
      ],
    },
    {
      id: "stock",
      title: "Stock & Materials",
      cards: [
        makeCard({ id: "actualPaperUsed", label: "Actual Paper Used", value: totalActualPaperUsed, format: "number" }),
        makeCard({ id: "planPaper", label: "Plan Paper", value: totalPlanPaper, format: "number" }),
        makeCard({ id: "pendingConsumption", label: "Pending Consumption", value: pendingConsumptionJobs, format: "number" }),
        { id: "fgStock", label: "FG Stock", value: null, status: "unavailable", note: "Pending stock formula/data source" },
        { id: "starch", label: "Starch / Consumables", value: null, status: "unavailable", note: "Pending consumable inventory model" },
        { id: "reelStock", label: "Reel Stock Buckets", value: null, status: "unavailable", note: "Use dedicated stock reports for now" },
      ],
    },
  ];

  return {
    rangeLabel,
    comparisonLabel,
    groups,
  };
}
