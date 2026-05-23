import { Production } from "../types";

function hasFilledValue(value: unknown) {
  return !(value === null || value === undefined || String(value).trim() === "");
}

export function isProductionPendingConsumption(production: Production) {
  return (
    !production.cancelTimestamp &&
    (
      production.status === "Pending Consumption" ||
      (production.status === "Pending Tally" && !hasFilledValue(production.actualPaperUsed))
    )
  );
}

export function isProductionPendingFFG(production: Production) {
  return (
    !production.cancelTimestamp &&
    (
      production.status === "Pending FFG" ||
      (
        production.status === "Pending Tally" &&
        hasFilledValue(production.actualPaperUsed) &&
        !hasFilledValue(production.prodFromFFG)
      )
    )
  );
}

export function isProductionReadyForTally(production: Production) {
  return (
    production.status === "Pending Tally" &&
    !production.cancelTimestamp &&
    hasFilledValue(production.actualPaperUsed) &&
    hasFilledValue(production.prodFromFFG)
  );
}
