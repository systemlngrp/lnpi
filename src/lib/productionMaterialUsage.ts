import {
  Material,
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

export function hasPaperNotRequiredBypass(
  production: Pick<Production, "paperNotRequired" | "paperNotRequiredReason">
) {
  return Boolean(production.paperNotRequired) && String(production.paperNotRequiredReason || "").trim().length > 0;
}

function normalizeMaterialText(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isCorrugatedSheetMaterial(material?: Pick<Material, "name"> | null) {
  const normalizedName = normalizeMaterialText(material?.name);
  return normalizedName.includes("corrugated sheet");
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

export function buildProductionCorrugatedSheetUsageMap(
  materials: Pick<Material, "id" | "name">[],
  materialIssues: MaterialIssue[],
  materialIssueLines: MaterialIssueLine[],
  materialReturns: MaterialReturn[],
  materialReturnLines: MaterialReturnLine[]
) {
  const materialMap = new Map(materials.map((material) => [material.id, material]));
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

  materialIssueLines.forEach((line) => {
    const material = materialMap.get(line.materialId);
    if (!isCorrugatedSheetMaterial(material)) return;
    const productionId = issueProductionMap.get(line.materialIssueId);
    if (!productionId) return;
    totals.set(productionId, (totals.get(productionId) || 0) + Number(line.qty || 0));
  });

  materialReturnLines.forEach((line) => {
    const material = materialMap.get(line.materialId);
    if (!isCorrugatedSheetMaterial(material)) return;
    const productionId = returnProductionMap.get(line.materialReturnId);
    if (!productionId) return;
    totals.set(productionId, (totals.get(productionId) || 0) - Number(line.qty || 0));
  });

  totals.forEach((value, key) => {
    totals.set(key, Math.max(0, Number(value.toFixed(5))));
  });

  return totals;
}

export function hasProductionCorrugatedSheetUsage(
  production: Pick<Production, "id">,
  usageMap?: Map<string, number>
) {
  return Number(usageMap?.get(production.id) || 0) > 0;
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
  timestamp: string,
  hasCorrugatedSheetUsage = false
) {
  if (production.cancelTimestamp || production.status === "Cancelled") {
    return { ...production, actualPaperUsed };
  }
  if (production.tallyTimestamp || production.status === "Completed") {
    return { ...production, actualPaperUsed };
  }

  const normalizedUsage = Math.max(0, Number(actualPaperUsed || 0));
  const bypassedPaperIssue = hasPaperNotRequiredBypass(production);
  const hasEligibleMaterialIssue = normalizedUsage > 0 || hasCorrugatedSheetUsage || bypassedPaperIssue;
  let status: Production["status"] = "Pending Consumption";

  if (hasEligibleMaterialIssue && hasWorkflowValue(production.prodFromFFG)) {
    status = "Pending Tally";
  } else if (hasEligibleMaterialIssue) {
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

