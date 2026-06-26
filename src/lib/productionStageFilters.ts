import { Production } from "../types";
import { hasPaperNotRequiredBypass, hasWorkflowValue } from "./productionMaterialUsage";

export function isProductionPendingPH(production: Production) {
  return false;
}

export function getProductionDisplayStatus(production: Production) {
  if (production.status === "Pending PH") {
    return "Pending Consumption";
  }
  return production.status;
}

function isFgUnlocked(production: Production, actualPaperUsed: unknown, hasCorrugatedSheetUsage = false) {
  return hasWorkflowValue(actualPaperUsed) || hasCorrugatedSheetUsage || hasPaperNotRequiredBypass(production);
}

export function isProductionPendingConsumption(
  production: Production,
  actualPaperUsed = production.actualPaperUsed,
  hasCorrugatedSheetUsage = false
) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !isFgUnlocked(production, actualPaperUsed, hasCorrugatedSheetUsage);
}

export function isProductionPendingFFG(
  production: Production,
  actualPaperUsed = production.actualPaperUsed,
  hasCorrugatedSheetUsage = false
) {
  return !production.cancelTimestamp && !production.tallyTimestamp && isFgUnlocked(production, actualPaperUsed, hasCorrugatedSheetUsage) && !hasWorkflowValue(production.prodFromFFG);
}

export function isProductionReadyForTally(
  production: Production,
  actualPaperUsed = production.actualPaperUsed,
  hasCorrugatedSheetUsage = false
) {
  return !production.cancelTimestamp && !production.tallyTimestamp && isFgUnlocked(production, actualPaperUsed, hasCorrugatedSheetUsage) && hasWorkflowValue(production.prodFromFFG);
}

