import {
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Production,
} from "../types";

export function hasWorkflowValue(value: unknown) {
  if (value === null || value === undefined) return false;
  const asString = String(value).trim();
  if (!asString) return false;
  const asNumber = Number(asString);
  return Number.isFinite(asNumber) ? asNumber > 0 : true;
}

export function buildProductionMaterialUsageMap(
  materialIssues: MaterialIssue[],
  materialIssueLines: MaterialIssueLine[],
  materialReturns: MaterialReturn[],
  materialReturnLines: MaterialReturnLine[],
  materialIssueReelLines: MaterialIssueReelLine[] = [],
  materialReturnReelLines: MaterialReturnReelLine[] = []
) {
  const issueProductionMap = new Map(
    materialIssues
      .filter((issue) => issue.issueType === "Job" && issue.productionId)
      .map((issue) => [issue.id, issue.productionId as string])
  );
  const returnProductionMap = new Map(
    materialReturns
      .filter((entry) => entry.returnType === "Job" && entry.productionId)
      .map((entry) => [entry.id, entry.productionId as string])
  );

  const totals = new Map<string, number>();
  const existingIssueLineIds = new Set(materialIssueLines.map((line) => line.id));
  const existingReturnLineIds = new Set(materialReturnLines.map((line) => line.id));

  materialIssueLines.forEach((line) => {
    const productionId = issueProductionMap.get(line.materialIssueId);
    if (!productionId) return;
    totals.set(productionId, (totals.get(productionId) || 0) + Number(line.qty || 0));
  });

  materialReturnLines.forEach((line) => {
    const productionId = returnProductionMap.get(line.materialReturnId);
    if (!productionId) return;
    totals.set(productionId, (totals.get(productionId) || 0) - Number(line.qty || 0));
  });

  materialIssueReelLines.forEach((line) => {
    if (existingIssueLineIds.has(line.materialIssueLineId)) return;
    const productionId = line.productionId || issueProductionMap.get(line.materialIssueId);
    if (!productionId) return;
    totals.set(productionId, (totals.get(productionId) || 0) + Number(line.weightKg || 0));
  });

  materialReturnReelLines.forEach((line) => {
    if (existingReturnLineIds.has(line.materialReturnLineId)) return;
    const productionId = line.productionId || returnProductionMap.get(line.materialReturnId);
    if (!productionId) return;
    totals.set(productionId, (totals.get(productionId) || 0) - Number(line.weightKg || 0));
  });

  totals.forEach((value, key) => {
    totals.set(key, Math.max(0, Number(value.toFixed(5))));
  });

  return totals;
}

export function getProductionActualPaperUsed(
  production: Production,
  usageMap?: Map<string, number>
) {
  if (usageMap?.has(production.id)) {
    return usageMap.get(production.id) || 0;
  }
  return Number(production.actualPaperUsed || 0);
}

export function syncProductionWorkflowFromUsage(
  production: Production,
  actualPaperUsed: number,
  timestamp: string
) {
  if (production.cancelTimestamp || production.status === "Cancelled") {
    return { ...production, actualPaperUsed };
  }
  if (production.tallyTimestamp || production.status === "Completed") {
    return { ...production, actualPaperUsed };
  }

  const normalizedUsage = Math.max(0, Number(actualPaperUsed || 0));
  let status: Production["status"] = "Pending Consumption";

  if (normalizedUsage > 0 && hasWorkflowValue(production.prodFromFFG)) {
    status = "Pending Tally";
  } else if (normalizedUsage > 0) {
    status = "Pending FFG";
  }

  return {
    ...production,
    actualPaperUsed: normalizedUsage,
    status,
    updatedBy: "System User",
    updateTimestamp: timestamp,
  };
}
