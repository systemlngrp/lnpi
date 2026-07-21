import type {
  DispatchPlan,
  Invoice,
  Item,
  LoadingSlip,
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
  OperationDashboardMetricGroup,
  OperationDashboardSummary,
  Order,
  OrderSchedule,
  Production,
  ProductionProcessing,
} from "../types";
import {
  buildProductionCorrugatedSheetUsageMap,
  buildProductionMaterialUsageMap,
  getProductionActualPaperUsed,
  hasProductionCorrugatedSheetUsage,
} from "./productionMaterialUsage";
import { PROCESSING_MACHINE_COLUMNS } from "./productionProcessingSummary";
import { isProductionReadyForTally } from "./productionStageFilters";
import { buildReelStockRows } from "./reelStock";

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
  scrapSoldQty?: number;
  items: Item[];
  materials: Material[];
  materialIn: MaterialIn[];
  packingSlips: MaterialInPackingSlip[];
  processing: ProductionProcessing[];
  materialIssues: MaterialIssue[];
  materialIssueLines: MaterialIssueLine[];
  issueReelLines: MaterialIssueReelLine[];
  materialReturns: MaterialReturn[];
  materialReturnLines: MaterialReturnLine[];
  returnReelLines: MaterialReturnReelLine[];
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
  if (!parsed) return false;
  if (!safeRange) return true;
  const target = normalizeDateValue(parsed);
  return target >= safeRange.fromTime && target <= safeRange.toTime;
}

function isSameAppDate(dateStr: string | undefined, compareValue: string) {
  const parsed = parseAppDate(dateStr);
  const compareDate = parseAppDate(compareValue);
  if (!parsed || !compareDate) return false;
  return normalizeDateValue(parsed) === normalizeDateValue(compareDate);
}

function getRangeLabel(dateRange: OperationDashboardDateRange) {
  if (!dateRange.from && !dateRange.to) return "All Dates";
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

function sumPlanQty(rows: OrderSchedule[]) {
  return rows.reduce((sum, schedule) => sum + Number(schedule.qty || 0), 0);
}

function sumProductionPlanQty(rows: Production[]) {
  return rows.reduce((sum, production) => sum + Number(production.qty || 0), 0);
}

function sumProductionPlanValue(rows: Production[], schedules: OrderSchedule[], orders: Order[]) {
  return rows.reduce((sum, production) => {
    const schedule = schedules.find((entry) => entry.id === production.scheduleId);
    const order = orders.find((entry) => entry.id === schedule?.orderId);
    const rate = Number(production.rate || order?.rate || 0);
    return sum + Number(production.qty || 0) * rate;
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

function getFgStockTotal(items: Item[]) {
  return items
    .filter((item) => item.itemType === "FG")
    .reduce((sum, item) => sum + Number(item.balance || 0), 0);
}

function getReelStockTotals(
  materials: Material[],
  materialIn: MaterialIn[],
  packingSlips: MaterialInPackingSlip[],
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const rows = buildReelStockRows({
    materials,
    materialIn,
    packingSlips,
    issueReelLines,
    returnReelLines,
  });

  return rows.reduce(
    (acc, row) => {
      acc.availableWeight += row.availableWeight;
      if (row.availableWeight > 0) acc.noOfReels += 1;
      return acc;
    },
    { availableWeight: 0, noOfReels: 0 }
  );
}

export function buildOperationDashboardSummary(args: BuildOperationDashboardSummaryArgs): OperationDashboardSummary {
  const safeRange = getSafeRange(args.dateRange);
  const rangeLabel = getRangeLabel(args.dateRange);
  const today = getLocalDateInputValue(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getLocalDateInputValue(tomorrowDate);
  const { previousRange, nextRange, comparisonLabel, nextLabel } = getComparisonCards(
    args.dateRange,
    args.invoices,
    args.productions
  );
  const previousSafeRange = getSafeRange(previousRange);
  const nextSafeRange = getSafeRange(nextRange);

  const filteredProductions = safeRange
    ? args.productions.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.productions;
  const previousProductions = previousSafeRange
    ? args.productions.filter((entry) => isDateWithinRange(entry.date, previousSafeRange))
    : [];
  const filteredSchedules = safeRange
    ? args.schedules.filter((entry) => isDateWithinRange(entry.scheduledDate, safeRange))
    : args.schedules;
  const todayProductions = args.productions.filter((entry) => isSameAppDate(entry.date, today));
  const tomorrowProductions = args.productions.filter((entry) => isSameAppDate(entry.date, tomorrow));
  const nextSchedules = nextSafeRange
    ? args.schedules.filter((entry) => isDateWithinRange(entry.scheduledDate, nextSafeRange))
    : [];
  const filteredDispatchPlans = safeRange
    ? args.dispatchPlans.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.dispatchPlans;
  const filteredLoadingSlips = safeRange
    ? args.loadingSlips.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.loadingSlips;
  const filteredInvoices = safeRange
    ? args.invoices.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.invoices;
  const todayInvoices = args.invoices.filter((entry) => isSameAppDate(entry.date, today));
  const previousInvoices = previousSafeRange
    ? args.invoices.filter((entry) => isDateWithinRange(entry.date, previousSafeRange))
    : [];
  const filteredProcessing = safeRange
    ? args.processing.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.processing;
  const filteredMaterialIssues = safeRange
    ? args.materialIssues.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.materialIssues;
  const filteredMaterialReturns = safeRange
    ? args.materialReturns.filter((entry) => isDateWithinRange(entry.date, safeRange))
    : args.materialReturns;
  const usageMap = buildProductionMaterialUsageMap(
    filteredMaterialIssues,
    args.materialIssueLines,
    filteredMaterialReturns,
    args.materialReturnLines,
    args.issueReelLines,
    args.returnReelLines
  );
  const corrugatedSheetUsageMap = buildProductionCorrugatedSheetUsageMap(
    args.materials,
    filteredMaterialIssues,
    args.materialIssueLines,
    filteredMaterialReturns,
    args.materialReturnLines
  );

  const totalProduction = sumProductionQty(filteredProductions);
  const previousProduction = sumProductionQty(previousProductions);
  const totalProductionMeter = sumProductionMeter(filteredProductions);
  const totalPlanValue = sumPlanValue(filteredSchedules, args.orders);
  const todayPlanQty = sumProductionPlanQty(todayProductions);
  const todayPlanValue = sumProductionPlanValue(todayProductions, args.schedules, args.orders);
  const tomorrowPlanQty = sumProductionPlanQty(tomorrowProductions);
  const tomorrowPlanValue = sumProductionPlanValue(tomorrowProductions, args.schedules, args.orders);
  const nextPlanValue = sumPlanValue(nextSchedules, args.orders);
  const totalActualPaperUsed = getActualPaperUsed(filteredProductions, usageMap);
  const totalScrapSoldQty = Number(args.scrapSoldQty || 0);
  const totalWastage = totalActualPaperUsed > 0 ? (totalScrapSoldQty / totalActualPaperUsed) * 100 : 0;
  const totalPlanPaper = getPlanPaperTotal(filteredProductions);
  const totalSale = filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);
  const todaySalesValue = todayInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);
  const previousSale = previousInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);
  const pendingPlanningRows = getPendingPlanningRows(filteredSchedules, args.dispatchPlans);
  const pendingPlanningValue = sumPendingPlanningValue(filteredSchedules, args.dispatchPlans, args.orders);
  const dispatchPlannedQty = sumDispatchPlanQty(filteredDispatchPlans);
  const dispatchLoadedQty = sumDispatchLoadedQty(filteredDispatchPlans);
  const loadingSlipQty = sumLoadingQty(filteredLoadingSlips);
  const processingTotals = getProcessingTotals(filteredProcessing);
  const fgStockTotal = getFgStockTotal(args.items);
  const reelStockTotals = getReelStockTotals(
    args.materials,
    args.materialIn,
    args.packingSlips,
    args.issueReelLines,
    args.returnReelLines
  );
  const activeJobs = filteredProductions.filter((row) => row.status !== "Cancelled" && !row.cancelTimestamp).length;
  const cancelledJobs = filteredProductions.filter((row) => row.status === "Cancelled" || !!row.cancelTimestamp).length;
  const pendingTallyJobs = filteredProductions.filter((row) =>
    isProductionReadyForTally(row, getProductionActualPaperUsed(row, usageMap), hasProductionCorrugatedSheetUsage(row, corrugatedSheetUsageMap))
  ).length;
  const pendingConsumptionJobs = filteredProductions.filter((row) => row.status === "Pending Consumption").length;
  const wipQty = Math.max(0, totalProduction - loadingSlipQty);

  const groups: OperationDashboardMetricGroup[] = [
    {
      id: "production",
      title: "Operation",
      cards: [
        makeCard({ id: "production", label: "Production", value: totalProduction, format: "number" }),
        makeCard({ id: "linearMeter", label: "Linear Meter", value: totalProductionMeter, format: "number" }),
        makeCard({ id: "actualPaperUsed", label: "Actual Paper Used", value: totalActualPaperUsed, format: "number", decimals: 2 }),
        makeCard({ id: "scrapSoldQty", label: "Total Scrap Sold", value: totalScrapSoldQty, format: "number", decimals: 2 }),
        makeCard({ id: "wastage", label: "Total Wastage", value: totalWastage, format: "percent" }),
        makeCard({ id: "planPaper", label: "Plan Paper", value: totalPlanPaper, format: "number" }),
        makeCard({ id: "activeJobs", label: "Active Jobs", value: activeJobs, format: "number" }),
        makeCard({ id: "pendingTally", label: "Pending Tally Jobs", value: pendingTallyJobs, format: "number" }),
      ],
    },
    {
      id: "dispatch",
      title: "Dispatch",
      cards: [
        makeCard({ id: "dispatchPlannedQty", label: "Dispatch Planned Qty", value: dispatchPlannedQty, format: "number" }),
        makeCard({ id: "dispatchLoadedQty", label: "Dispatch Loaded Qty", value: dispatchLoadedQty, format: "number" }),
        makeCard({ id: "loadingQty", label: "Loading Slip Qty", value: loadingSlipQty, format: "number" }),
        makeCard({ id: "pendingPlanningValue", label: "Pending Dispatch Value", value: pendingPlanningValue, format: "currency" }),
      ],
    },
    {
      id: "sales",
      title: "Sales",
      cards: [
        makeCard({ id: "totalSales", label: "Total Sales", value: totalSale, format: "currency" }),
        makeCard({ id: "todaySalesValue", label: "Today Sales Value", value: todaySalesValue, format: "currency" }),
        makeCard({ id: "invoiceCount", label: "Invoices", value: filteredInvoices.length, format: "number" }),
      ],
    },
  ];

  return {
    rangeLabel,
    comparisonLabel,
    groups,
  };
}

