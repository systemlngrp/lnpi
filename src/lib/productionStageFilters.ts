import { Production } from "../types";
import { hasWorkflowValue } from "./productionMaterialUsage";

export function isProductionPendingPH(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !production.phTimestamp;
}

export function isProductionPendingConsumption(production: Production, actualPaperUsed = production.actualPaperUsed) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && !hasWorkflowValue(actualPaperUsed);
}

export function isProductionPendingFFG(production: Production, actualPaperUsed = production.actualPaperUsed) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && hasWorkflowValue(actualPaperUsed) && !hasWorkflowValue(production.prodFromFFG);
}

export function isProductionReadyForTally(production: Production, actualPaperUsed = production.actualPaperUsed) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && hasWorkflowValue(actualPaperUsed) && hasWorkflowValue(production.prodFromFFG);
}
