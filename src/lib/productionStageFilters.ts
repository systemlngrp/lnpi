import { Production } from "../types";

function hasFilledValue(value: unknown) {
  return !(value === null || value === undefined || String(value).trim() === "");
}

function isPendingTallyStatus(production: Production) {
  return production.status === "Pending Tally" && !production.cancelTimestamp;
}

export function isProductionPendingConsumption(production: Production) {
  return isPendingTallyStatus(production) && !hasFilledValue(production.actualPaperUsed);
}

export function isProductionPendingFFG(production: Production) {
  return isPendingTallyStatus(production) && hasFilledValue(production.actualPaperUsed) && !hasFilledValue(production.prodFromFFG);
}

export function isProductionReadyForTally(production: Production) {
  return isPendingTallyStatus(production) && hasFilledValue(production.actualPaperUsed) && hasFilledValue(production.prodFromFFG);
}
