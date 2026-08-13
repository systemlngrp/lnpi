import type {
  Company,
  DispatchPlan,
  GateEntry,
  GatePass,
  Indent,
  IndentLine,
  Invoice,
  LoadingSlip,
  Machine,
  Material,
  MaterialIn,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Order,
  OrderSchedule,
  Production,
  ProductionProcessing,
  PurchaseOrder,
  PurchaseOrderLine,
  SampleRequest,
  Setting,
} from "../types";
import { deriveGatePassState, hasSavedReturnableReceiptGateEntry, isReturnableGatePass } from "./gatePassState";
import { canCreateMrrForGateEntry } from "./gateEntryState";
import { parseMandatoryMachinesByType } from "./mandatoryMachines";
import { buildProductionCorrugatedSheetUsageMap, buildProductionMaterialUsageMap, getProductionActualPaperUsed, hasProductionCorrugatedSheetUsage } from "./productionMaterialUsage";
import { getRequiredMachinesForProduction } from "./productionType";
import { normalizeMachineName } from "./productionMachineNames";
import { buildScheduleConsumptionByScheduleId } from "./productionScheduleQty";
import { isProductionPendingConsumption, isProductionPendingFFG, isProductionPendingPH, isProductionReadyForTally } from "./productionStageFilters";
import { withIndentTotals } from "./indentTotals";

type OrderCatalogItem = {
  id: string;
  erp?: string | number;
  name?: string;
  raw?: Record<string, unknown>;
};
type PendingTaskUser = {
  id?: string;
  name?: string;
  role?: string;
};


export type PendingTaskRow = {
  name: string;
  countKey: string;
  count: number;
  section: PendingTaskSection;
};

export type PendingTaskSection = "Purchase" | "Orders" | "Jobs" | "Sales" | "Gate Pass";

export type PendingTaskGroup = {
  section: PendingTaskSection;
  rows: PendingTaskRow[];
  sectionTotal: number;
};

export const PENDING_TASK_DEFINITIONS = [
  { section: "Purchase", name: "Indent Pending", countKey: "/indent/pending" },
  { section: "Purchase", name: "Pending PO Items", countKey: "/purchase-orders/pending-indent-lines" },
  { section: "Purchase", name: "Purchase Order Pending Approval", countKey: "/purchase-orders/pending-approval" },
  { section: "Purchase", name: "Pending Material Receipt", countKey: "/material-receipt/pending-mrr" },
  { section: "Purchase", name: "Pending MRR Approvals", countKey: "/material-receipt/approvals" },
  { section: "Purchase", name: "Pending MRR Tally Posting", countKey: "/material-receipt/pending-tally" },
  { section: "Purchase", name: "Pending Debit Note", countKey: "/material-receipt/pending-debit-note" },
  { section: "Purchase", name: "Pending Credit Note", countKey: "/material-receipt/pending-credit-note" },
  { section: "Jobs", name: "Pending Non-Job Material Issue", countKey: "/material-movement/pending-non-job-issue" },
  { section: "Jobs", name: "Pending Consumption Tally Posting", countKey: "/material-movement/pending-consumption-tally" },
  { section: "Orders", name: "Pending Salesman Approval", countKey: "/orders/pending-ph" },
  { section: "Orders", name: "Pending Scheduling", countKey: "/orders/pending-scheduling" },
  { section: "Jobs", name: "Pending Production Plan", countKey: "/production/pending" },
  { section: "Jobs", name: "Pending NPD", countKey: "/production/pending-npd" },
  { section: "Jobs", name: "Pending Material Issue", countKey: "/production/pending-consumption" },
  { section: "Jobs", name: "Pending FG", countKey: "/production/pending-ffg" },
  { section: "Jobs", name: "Pending Printing", countKey: "/production/pending-printing" },
  { section: "Jobs", name: "Pending Production Tally Entry", countKey: "/production/pending-tally" },
  { section: "Jobs", name: "Pending Job Closure", countKey: "/production/pending-job-closure" },
  { section: "Jobs", name: "Pending Machine Processing", countKey: "/production/pending-machine-processing" },
  { section: "Jobs", name: "Pending PHP Planning", countKey: "/production/php/pending-planning" },
  { section: "Jobs", name: "Pending Plate Planning", countKey: "/production/plate/pending-planning" },
  { section: "Jobs", name: "Pending PHP/Plate Sequencing", countKey: "/production/php-plate/pending-sequencing" },
  { section: "Jobs", name: "Pending PHP/Plate Production", countKey: "/production/php-plate/pending-production" },
  { section: "Jobs", name: "Pending Samples", countKey: "/samples/pending" },
  { section: "Sales", name: "Pending Dispatch Planning", countKey: "/dispatch/pending-planning" },
  { section: "Sales", name: "Pending Loading", countKey: "/loading/pending" },
  { section: "Sales", name: "Pending PHP Loading Tally", countKey: "/loading/php/pending-tally" },
  { section: "Sales", name: "Pending Plate Loading Tally", countKey: "/loading/plate/pending-tally" },
  { section: "Sales", name: "Pending Invoicing", countKey: "/billing/pending" },
  { section: "Sales", name: "Pending Billing Tally Posting", countKey: "/billing/pending-tally" },
  { section: "Gate Pass", name: "Pending Returnable Gate Pass Items", countKey: "/gate-pass/pending-returnable" },
] as const;

const PENDING_TASK_SECTION_ORDER: PendingTaskSection[] = ["Purchase", "Orders", "Jobs", "Sales", "Gate Pass"];
export type BuildPendingTaskCountsArgs = {
  materialIn: MaterialIn[];
  productions: Production[];
  phpJobMaster: Production[];
  plateJobMaster: Production[];
  materials: Material[];
  orders: Order[];
  npdItems: Array<{ id: string; erp?: string | number; name?: string; boxType?: string; rapc?: string | number }>;
  materialIssues: MaterialIssue[];
  materialIssueLines: MaterialIssueLine[];
  materialIssueReelLines: MaterialIssueReelLine[];
  materialReturns: MaterialReturn[];
  materialReturnLines: MaterialReturnLine[];
  materialReturnReelLines: MaterialReturnReelLine[];
  sampleRequests: SampleRequest[];
  indents: Indent[];
  indentLines: IndentLine[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines?: PurchaseOrderLine[];
  gateEntries: GateEntry[];
  schedules: OrderSchedule[];
  dispatchPlans: DispatchPlan[];
  loadingSlips: LoadingSlip[];
  phpLoadingSlips: LoadingSlip[];
  plateLoadingSlips: LoadingSlip[];
  invoices: Invoice[];
  gatePasses?: GatePass[];
  companies?: Company[];
  machines?: Machine[];
  processing?: ProductionProcessing[];
  settings?: Setting[];
  consumptions?: Array<{ status?: string }>;
  pendingJobClosureCount?: number;
  user?: PendingTaskUser | null;
  resolveOrderItem?: (order?: Order) => OrderCatalogItem | undefined;
  findItemAcrossSources?: (itemId: string, source?: string, erpCode?: string | number) => OrderCatalogItem | undefined;
  itemsBySource?: Record<string, OrderCatalogItem[]>;
};

const isPendingPH = (status?: string | null) => !status || status === "Pending PH";
const normalizeDate = (value?: string | null) => String(value || "").slice(0, 10);
const isWithoutJobIssue = (issueType?: string | null) => {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
};

function parseLocalYmd(dateStr?: string) {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function normalizeErpCode(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function toOptionalNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function findItemByErp(items: OrderCatalogItem[], erpCode: string) {
  const normalizedErp = normalizeErpCode(erpCode);
  if (!normalizedErp) return undefined;
  return items.find((item) => {
    const raw = item.raw || {};
    return [item.erp, raw.erpItemCode, raw.masterItemNameErpCode].some(
      (value) => normalizeErpCode(value) === normalizedErp
    );
  });
}

function getSetsPerBox(item?: OrderCatalogItem) {
  return toOptionalNumber(item?.raw?.numberOfSetsPerBox);
}

function getPendingFgQty(schedule: OrderSchedule, producedQty: number) {
  return Math.max(
    Number(schedule.qty || 0) - Number(producedQty || 0) - Number(schedule.canceledQty || 0),
    0
  );
}

function getScheduledQty(schedule: OrderSchedule) {
  return Math.max(Number(schedule.qty || 0) - Number(schedule.canceledQty || 0), 0);
}

function getPendingNonJobIssueCount(materialIssues: MaterialIssue[], productions: Production[]) {
  const firstJobDate = productions.map((p) => normalizeDate(p.date)).filter(Boolean).sort()[0];
  if (!firstJobDate) return 0;

  const today = new Date().toISOString().slice(0, 10);
  const issuesByDate = new Set(
    materialIssues.filter((i) => isWithoutJobIssue(i.issueType)).map((i) => normalizeDate(i.date)).filter(Boolean)
  );

  let count = 0;
  const cursor = new Date(`${firstJobDate}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    if (!issuesByDate.has(d)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function getPendingProductionPlanCount(schedules: OrderSchedule[], productions: Production[], phpJobs: Production[], plateJobs: Production[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() + 2);
  cutoffDate.setHours(23, 59, 59, 999);

  const consumptionByScheduleId = buildScheduleConsumptionByScheduleId(productions, phpJobs, plateJobs);
  const getPendingProductionQty = (schedule: OrderSchedule) =>
    Math.max(
      Number(schedule.qty || 0) - Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0) - Number(schedule.canceledQty || 0),
      0
    );

  return schedules.filter((schedule) => {
    if (getPendingProductionQty(schedule) <= 0) return false;
    const scheduledDate = parseLocalYmd(schedule.scheduledDate);
    if (!scheduledDate) return false;
    return scheduledDate.getTime() <= cutoffDate.getTime();
  }).length;
}

function getPendingLinkedPlanningCount(
  source: "PHP" | "PLATE",
  schedules: OrderSchedule[],
  orders: Order[],
  fgProductions: Production[],
  phpJobs: Production[],
  plateJobs: Production[],
  resolveOrderItem?: (order?: Order) => OrderCatalogItem | undefined,
  itemsBySource: Record<string, OrderCatalogItem[]> = {}
) {
  const sourceItems = itemsBySource[source] || [];
  const jobRows = source === "PHP" ? phpJobs : plateJobs;
  const plannedQtyByScheduleId = new Map<string, number>();

  jobRows.forEach((row) => {
    if (!row.scheduleId) return;
    if (row.status === "Cancelled" || row.cancelTimestamp) return;
    const effectiveQty = Math.max(0, Number(row.plannedQty || row.qty || 0));
    if (effectiveQty <= 0) return;
    plannedQtyByScheduleId.set(row.scheduleId, (plannedQtyByScheduleId.get(row.scheduleId) || 0) + effectiveQty);
  });

  return schedules.filter((schedule) => {
    const order = orders.find((row) => row.id === schedule.orderId);
    const fgItem = resolveOrderItem?.(order);
    const scheduledQty = getScheduledQty(schedule);
    const isDirectSourceOrder = order?.itemSource === source;
    const scheduleErp = String(order?.erpCode || fgItem?.erp || "").trim();
    const linkedItem = isDirectSourceOrder
      ? sourceItems.find((item) => item.id === String(order?.itemId || "").trim())
      : findItemByErp(sourceItems, scheduleErp);
    const setsPerBox = getSetsPerBox(linkedItem);
    const requiredQty = isDirectSourceOrder ? scheduledQty : linkedItem && setsPerBox ? Number((scheduledQty * setsPerBox).toFixed(2)) : 0;
    const alreadyPlannedQty = Number(plannedQtyByScheduleId.get(schedule.id) || 0);
    const remainingQty = Math.max(0, Number((requiredQty - alreadyPlannedQty).toFixed(2)));

    if (scheduledQty <= 0 || !linkedItem || remainingQty <= 0) return false;
    return isDirectSourceOrder || Boolean(setsPerBox);
  }).length;
}

function getPendingSequencingCount(phpJobs: Production[], plateJobs: Production[]) {
  return [...phpJobs, ...plateJobs]
    .filter((job) => job.status !== "Cancelled")
    .filter((job) => String(job.scheduledDate || "").trim() && String(job.shift || "").trim() && String(job.methodology || "").trim())
    .filter((job) => !String(job.sequence || "").trim()).length;
}

function getPendingPhpPlateProductionCount(phpJobs: Production[], plateJobs: Production[]) {
  return [...phpJobs, ...plateJobs]
    .filter((job) => job.status !== "Cancelled")
    .filter((job) => String(job.scheduledDate || "").trim() && String(job.shift || "").trim() && String(job.sequence || "").trim())
    .filter((job) => !String(job.jobCompletionTimeOutput || "").trim() || !(Number(job.productionOutputQty || 0) > 0)).length;
}

function getPendingMachineProcessingCount(
  productions: Production[],
  machines: Machine[] = [],
  processing: ProductionProcessing[] = [],
  settings: Setting[] = [],
  findItemAcrossSources?: (itemId: string, source?: string, erpCode?: string | number) => OrderCatalogItem | undefined,
  user?: PendingTaskUser | null,
  machineNameFilter?: string
) {
  if (machines.length === 0) return 0;
  const normalizedMachineNameFilter = machineNameFilter ? normalizeMachineName(machineNameFilter) : "";
  const mandatoryMachinesMapping = parseMandatoryMachinesByType(settings[0]);
  const isMachineAssignedToOperator = (machine: Machine) => {
    if (user?.role !== "Operator") return true;
    const assignedIds = Array.isArray(machine.assignedOperatorIds) ? machine.assignedOperatorIds : [];
    const assignedNames = Array.isArray(machine.assignedOperatorNames) ? machine.assignedOperatorNames : [];
    const normalizedUserName = String(user.name || "").trim().toLowerCase();
    return assignedIds.includes(String(user.id || "")) || assignedNames.some((name) => String(name || "").trim().toLowerCase() === normalizedUserName);
  };
  const visibleMachineIds = new Set(machines.filter(isMachineAssignedToOperator).map((machine) => machine.id));

  return productions
    .filter((p) => p.status !== "Completed" && p.status !== "Cancelled" && !p.cancelTimestamp && !p.tallyTimestamp)
    .reduce((count, production) => {
      const item = findItemAcrossSources?.(String(production.itemId || "").trim(), production.itemSource, production.erpCode);
      const requiredMachines = Array.from(
        new Set(
          getRequiredMachinesForProduction(production, item, mandatoryMachinesMapping, machines)
            .map((machineName) => normalizeMachineName(machineName))
            .filter(Boolean)
        )
      );
      const pendingForProduction = requiredMachines.filter((machineName) => {
        const normalizedRequiredMachine = normalizeMachineName(machineName);
        if (normalizedMachineNameFilter && normalizedRequiredMachine !== normalizedMachineNameFilter) return false;
        const machine = machines.find((m) => normalizeMachineName(m.name) === normalizedRequiredMachine);
        if (!machine || !visibleMachineIds.has(machine.id)) return false;
        const reportedForThisMachine = processing
          .filter((row) => row.productionId === production.id && row.machineId === machine.id)
          .reduce((sum, row) => sum + Number(row.qty || 0), 0);
        const pending = Math.max(0, Number(production.qty || 0) - reportedForThisMachine);
        return reportedForThisMachine <= 0 && pending > 0;
      }).length;
      return count + pendingForProduction;
    }, 0);
}

function getPendingReturnableGatePassCount(gatePasses: GatePass[] = [], gateEntries: GateEntry[], materialIn: MaterialIn[]) {
  return gatePasses
    .filter((gatePass) => isReturnableGatePass(gatePass))
    .filter((gatePass) => !hasSavedReturnableReceiptGateEntry(gatePass, gateEntries))
    .filter((gatePass) => {
      const state = deriveGatePassState(gatePass, materialIn);
      return state === "Open" || state === "Partially Returned";
    }).length;
}

export function buildPendingTaskCounts(args: BuildPendingTaskCountsArgs): Record<string, number> {
  const purchaseOrderLines = args.purchaseOrderLines || [];
  const receivedQtyByPoLineId = new Map<string, number>();
  args.materialIn.forEach((entry) => {
    (entry.lines || []).forEach((line) => {
      if (!line?.poLineId) return;
      receivedQtyByPoLineId.set(
        line.poLineId,
        Number(receivedQtyByPoLineId.get(line.poLineId) || 0) + Number(line.actualQty || line.qty || 0),
      );
    });
  });
  const getPoLineCancelledQty = (line: PurchaseOrderLine) => Math.max(0, Number(line.cancelledQty || 0));
  const getPoLinePendingQty = (line: PurchaseOrderLine) =>
    Math.max(0, Number(line.qty || 0) - Number(receivedQtyByPoLineId.get(line.id) || 0) - getPoLineCancelledQty(line));
  const normalizedIndents = args.indents.map((indent) =>
    withIndentTotals(indent, args.indentLines.filter((line) => line.indentId === indent.id))
  );
  const productionUsageMap = buildProductionMaterialUsageMap(
    args.materialIssues,
    args.materialIssueLines,
    args.materialReturns,
    args.materialReturnLines,
    args.materialIssueReelLines,
    args.materialReturnReelLines
  );
  const productionCorrugatedSheetUsageMap = buildProductionCorrugatedSheetUsageMap(
    args.materials,
    args.materialIssues,
    args.materialIssueLines,
    args.materialReturns,
    args.materialReturnLines
  );
  const pendingConsumptionTallyCount = args.materialIssues.filter(
    (issue) =>
      isWithoutJobIssue(issue.issueType) &&
      String(issue.consumptionTransactionNo || "").trim() !== "" &&
      String(issue.tallyTimestamp || "").trim() === ""
  ).length;
  const pendingPhpLoadingTallyCount = args.phpLoadingSlips.filter(
    (slip) =>
      String(slip.phpConsumptionTransactionNo || "").trim() !== "" &&
      String(slip.tallyTimestamp || "").trim() === "" &&
      String(slip.status || "Active").trim().toLowerCase() !== "cancelled"
  ).length;
  const pendingPlateLoadingTallyCount = args.plateLoadingSlips.filter(
    (slip) =>
      String(slip.plateConsumptionTransactionNo || "").trim() !== "" &&
      String(slip.tallyTimestamp || "").trim() === "" &&
      String(slip.status || "Active").trim().toLowerCase() !== "cancelled"
  ).length;

  return {
    "/material-receipt/approvals": args.materialIn.filter((m) => ["Pending PH", "Pending Accounts", "Pending MD"].includes(m.status)).length,
    "/material-receipt/pending-ph-approval": args.materialIn.filter((m) => m.status === "Pending PH").length,
    "/material-receipt/pending-accounts-approval": args.materialIn.filter((m) => m.status === "Pending Accounts").length,
    "/material-receipt/pending-md-approval": args.materialIn.filter((m) => m.status === "Pending MD").length,
    "/material-receipt/pending-tally": args.materialIn.filter((m) => m.status === "Pending Tally" && String(m.mrrType || "").trim().toLowerCase() !== "rejection in").length,
    "/production/pending": getPendingProductionPlanCount(args.schedules, args.productions, args.phpJobMaster, args.plateJobMaster),
    "/production/pending-npd": args.schedules.filter((schedule) => {
      const order = args.orders.find((row) => row.id === schedule.orderId);
      if (!order || order.status === "Cancelled") return false;
      const item = args.npdItems.find((row) => row.id === String(order.itemId || "").trim());
      if (!item) return false;
      const boxType = String(item.boxType || "").trim();
      const rapcValue = String(item.rapc ?? "").trim();
      return !boxType && !rapcValue;
    }).length,
    "/production/pending-consumption": args.productions.filter((p) =>
      isProductionPendingConsumption(p, getProductionActualPaperUsed(p, productionUsageMap), hasProductionCorrugatedSheetUsage(p, productionCorrugatedSheetUsageMap))
    ).length,
    "/production/pending-ffg": args.productions.filter((p) =>
      isProductionPendingFFG(p, getProductionActualPaperUsed(p, productionUsageMap), hasProductionCorrugatedSheetUsage(p, productionCorrugatedSheetUsageMap))
    ).length,
    "/production/pending-tally": args.productions.filter((p) =>
      isProductionReadyForTally(p, getProductionActualPaperUsed(p, productionUsageMap), hasProductionCorrugatedSheetUsage(p, productionCorrugatedSheetUsageMap))
    ).length,
    "/production/pending-job-closure": args.pendingJobClosureCount || 0,
    "/production/pending-machine-processing": getPendingMachineProcessingCount(
      args.productions,
      args.machines,
      args.processing,
      args.settings,
      args.findItemAcrossSources,
      args.user
    ),
    "/production/pending-printing": getPendingMachineProcessingCount(
      args.productions,
      args.machines,
      args.processing,
      args.settings,
      args.findItemAcrossSources,
      args.user,
      "Printing"
    ),
    "/production/php/pending-planning": getPendingLinkedPlanningCount(
      "PHP",
      args.schedules,
      args.orders,
      args.productions,
      args.phpJobMaster,
      args.plateJobMaster,
      args.resolveOrderItem,
      args.itemsBySource
    ),
    "/production/plate/pending-planning": getPendingLinkedPlanningCount(
      "PLATE",
      args.schedules,
      args.orders,
      args.productions,
      args.phpJobMaster,
      args.plateJobMaster,
      args.resolveOrderItem,
      args.itemsBySource
    ),
    "/production/php-plate/pending-sequencing": getPendingSequencingCount(args.phpJobMaster, args.plateJobMaster),
    "/production/php-plate/pending-production": getPendingPhpPlateProductionCount(args.phpJobMaster, args.plateJobMaster),
    "/indent/pending": normalizedIndents.filter((i) => i.status === "Pending").length,
    "/purchase-orders/pending-indent-lines": args.indentLines.filter((line) =>
      normalizedIndents.some((indent) => indent.id === line.indentId && indent.status === "Approved") &&
      Number(line.qty || 0) - Number(line.cancelledQty || 0) - Number(line.orderedQty || 0) > 0
    ).length,
    "/purchase-orders/pending-approval": args.purchaseOrders.filter((po) => po.status === "Pending Approval").length,
    "/purchase-orders/item-not-received": purchaseOrderLines.filter((line) => getPoLinePendingQty(line) > 0).length,
    "/purchase-orders/item-cancelled": purchaseOrderLines.filter((line) => getPoLineCancelledQty(line) > 0).length,
    "/material-receipt/pending-mrr": args.gateEntries.filter(canCreateMrrForGateEntry).length,
    "/material-receipt/pending-debit-note": args.materialIn.filter((m) => m.debitNote && !m.tallyTimestamp).length,
    "/material-receipt/pending-credit-note": args.materialIn.filter((m) => m.mrrType === "Rejection In" && !m.creditTallyTimestamp).length,
    "/material-movement/pending-non-job-issue": getPendingNonJobIssueCount(args.materialIssues, args.productions),
    "/material-movement/pending-consumption-tally": pendingConsumptionTallyCount,
    "/loading/php/pending-tally": pendingPhpLoadingTallyCount,
    "/loading/plate/pending-tally": pendingPlateLoadingTallyCount,
    "/samples/pending": args.sampleRequests.filter((s) => !s.jobCardNo && !s.cancelTimestamp).length,
    "/orders/pending-ph": args.orders.filter((o) => isPendingPH(o.status)).length,
    "/orders/pending-scheduling": args.orders.filter((o) => o.status === "Pending Scheduling").length,
    "/dispatch/pending-planning": args.schedules.filter((schedule) => {
      if (!schedule?.scheduledDate) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      const schedDate = new Date(schedule.scheduledDate);
      const alreadyPlanned = args.dispatchPlans
        .filter((plan) => plan.scheduleId === schedule.id)
        .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
      const balance = Number(schedule.qty || 0) - alreadyPlanned;
      return !Number.isNaN(schedDate.getTime()) && schedDate <= tomorrow && balance > 0;
    }).length,
    "/loading/pending": args.dispatchPlans.filter((plan) => {
      const pending = Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0);
      return pending > 0;
    }).length,
    "/billing/pending": args.loadingSlips.filter((slip) => !slip.invoiceId && slip.status !== "Cancelled").length,
    "/billing/pending-tally": args.invoices.filter((invoice) => !invoice.tallyTimestamp).length,
    "/gate-pass/pending-returnable": getPendingReturnableGatePassCount(args.gatePasses, args.gateEntries, args.materialIn),
    "/orders/upcoming": args.schedules.filter((schedule) => {
      if (!schedule?.scheduledDate) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() + 2);
      cutoffDate.setHours(23, 59, 59, 999);
      const consumptionByScheduleId = buildScheduleConsumptionByScheduleId(args.productions, args.phpJobMaster, args.plateJobMaster);
      const getPendingProductionQty = (row: OrderSchedule) =>
        Math.max(
          Number(row.qty || 0) - Number(consumptionByScheduleId.get(row.id)?.effectiveConsumedQty || 0) - Number(row.canceledQty || 0),
          0
        );
      const scheduledDate = parseLocalYmd(schedule.scheduledDate);
      if (!scheduledDate) return false;
      return scheduledDate.getTime() > cutoffDate.getTime() && getPendingProductionQty(schedule) > 0;
    }).length,
    "/plant-head": args.materialIn.filter((m) => isPendingPH(m.status)).length +
      args.productions.filter(isProductionPendingPH).length +
      args.orders.filter((o) => isPendingPH(o.status)).length +
      (args.consumptions || []).filter((c) => isPendingPH(c.status)).length,
  };
}

export function getPendingTaskRows(counts: Record<string, number>): PendingTaskRow[] {
  return PENDING_TASK_DEFINITIONS.map((task) => ({
    ...task,
    count: counts[task.countKey] || 0,
  }));
}

export function getPendingTaskGroups(counts: Record<string, number>) {
  const rows = getPendingTaskRows(counts).filter((row) => row.count > 0);
  const groups = PENDING_TASK_SECTION_ORDER.map((section) => {
    const sectionRows = rows.filter((row) => row.section === section);
    return {
      section,
      rows: sectionRows,
      sectionTotal: sectionRows.reduce((sum, row) => sum + row.count, 0),
    };
  }).filter((group) => group.rows.length > 0);

  return {
    groups,
    grandTotal: groups.reduce((sum, group) => sum + group.sectionTotal, 0),
  };
}
