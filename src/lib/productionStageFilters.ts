import { Production } from "../types";

function hasWorkflowValue(value: unknown) {
  if (value === null || value === undefined) return false;
  const asString = String(value).trim();
  if (!asString) return false;
  const asNumber = Number(asString);
  return Number.isFinite(asNumber) ? asNumber > 0 : true;
}

export function isProductionPendingPH(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !production.phTimestamp;
}

export function isProductionPendingConsumption(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && !hasWorkflowValue(production.actualPaperUsed);
}

export function isProductionPendingFFG(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && hasWorkflowValue(production.actualPaperUsed) && !hasWorkflowValue(production.prodFromFFG);
}

export function isProductionReadyForTally(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && hasWorkflowValue(production.actualPaperUsed) && hasWorkflowValue(production.prodFromFFG);
}
