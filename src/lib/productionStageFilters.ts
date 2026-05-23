import { Production } from "../types";

function hasFilledValue(value: unknown) {
  return !(value === null || value === undefined || String(value).trim() === "");
}

export function isProductionPendingPH(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !production.phTimestamp;
}

export function isProductionPendingConsumption(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && !hasFilledValue(production.actualPaperUsed);
}

export function isProductionPendingFFG(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && hasFilledValue(production.actualPaperUsed) && !hasFilledValue(production.prodFromFFG);
}

export function isProductionReadyForTally(production: Production) {
  return !production.cancelTimestamp && !production.tallyTimestamp && !!production.phTimestamp && hasFilledValue(production.actualPaperUsed) && hasFilledValue(production.prodFromFFG);
}
