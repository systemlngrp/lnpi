import { LoadingSlip, OrderItemSource, Production } from "../types";

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

function slipLineMatchesRow(line: LoadingSlip["lines"][number], row: MasterRow, source: Extract<OrderItemSource, "PHP" | "PLATE">) {
  const keys = rowKeys(row);
  const lineSource = String(line.itemSource || source).trim().toUpperCase();
  return lineSource === source && keys.includes(normalize(line.itemId));
}

function jobMatchesRow(job: Production, row: MasterRow, source: Extract<OrderItemSource, "PHP" | "PLATE">) {
  const keys = rowKeys(row);
  const jobSource = String(job.itemSource || source).trim().toUpperCase();
  return jobSource === source && keys.includes(normalize(job.itemId));
}

export function buildPhpPlateInventoryRows(masterRows: MasterRow[], jobs: Production[], loadingSlips: LoadingSlip[], source: Extract<OrderItemSource, "PHP" | "PLATE">) {
  return masterRows.map((row) => {
    const output = jobs.reduce((sum, job) => {
      if (job.status === "Cancelled" || job.cancelTimestamp) return sum;
      if (!jobMatchesRow(job, row, source)) return sum;
      return sum + toNumber(job.productionOutputQty);
    }, 0);

    const loadedQty = loadingSlips.reduce((sum, slip) => {
      if (slip.status === "Cancelled") return sum;
      return (
        sum +
        slip.lines.reduce((lineSum, line) => {
          if (!slipLineMatchesRow(line, row, source)) return lineSum;
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
