import { Production } from "../types";
import { hasWorkflowValue } from "./productionMaterialUsage";

export function isProductionPendingPH(production: Production) {
  return false;
}

export function getProductionDisplayStatus(production: Production) {
  if (production.status === "Pending PH") {
    return "Pending Consumption";
  }
  return production.status;
}

export function isProductionPendingConsumption(production: Production, actualPaperUsed = production.actualPaperUsed) {
  // PH approval is not required for issuing material.
  // Any open job without actual paper usage is eligible for "Pending Material Issue".
  return !production.cancelTimestamp && !production.tallyTimestamp && !hasWorkflowValue(actualPaperUsed);
}

export function isProductionPendingFFG(production: Production, actualPaperUsed = production.actualPaperUsed) {
  return !production.cancelTimestamp && !production.tallyTimestamp && hasWorkflowValue(actualPaperUsed) && !hasWorkflowValue(production.prodFromFFG);
}

export function isProductionReadyForTally(production: Production, actualPaperUsed = production.actualPaperUsed) {
  return !production.cancelTimestamp && !production.tallyTimestamp && hasWorkflowValue(actualPaperUsed) && hasWorkflowValue(production.prodFromFFG);
}
