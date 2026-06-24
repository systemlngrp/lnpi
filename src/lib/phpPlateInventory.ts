import { LoadingSlip, Production } from "../types";

type MasterRow = {
  id: string;
  itemId?: string | number;
  openingQty?: string | number;
  [key: string]: string | number | boolean | null | undefined;
};

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowKeys(row: MasterRow) {
  return [...new Set([row.id, row.itemId].map((value) => normalize(value)).filter(Boolean))];
}

function slipLineMatchesRow(line: LoadingSlip["lines"][number], row: MasterRow) {
  const keys = rowKeys(row);
  return keys.includes(normalize(line.itemId));
}

function jobMatchesRow(job: Production, row: MasterRow) {
  const keys = rowKeys(row);
  return keys.includes(normalize(job.itemId));
}

export function buildPhpPlateInventoryRows(masterRows: MasterRow[], jobs: Production[], loadingSlips: LoadingSlip[]) {
  return masterRows.map((row) => {
    const output = jobs.reduce((sum, job) => {
      if (job.status === "Cancelled" || job.cancelTimestamp) return sum;
      if (!jobMatchesRow(job, row)) return sum;
      return sum + toNumber(job.productionOutputQty);
    }, 0);

    const loadedQty = loadingSlips.reduce((sum, slip) => {
      if (slip.status === "Cancelled") return sum;
      return (
        sum +
        slip.lines.reduce((lineSum, line) => {
          if (!slipLineMatchesRow(line, row)) return lineSum;
          return lineSum + toNumber(line.loadedQty);
        }, 0)
      );
    }, 0);

    const openingQty = toNumber(row.openingQty);
    return {
      ...row,
      openingQty,
      output,
      loadedQty,
      balance: openingQty + output - loadedQty,
    };
  });
}
