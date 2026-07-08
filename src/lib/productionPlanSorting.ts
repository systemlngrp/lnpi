import { Production } from "../types";

type ProductionPlanSortRow = Production & {
  productionPlanCompanyName?: string;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function getCompanyName(row: ProductionPlanSortRow) {
  return normalizeText(row.productionPlanCompanyName || row.companyName);
}

function getFluteBatch(row: ProductionPlanSortRow) {
  return normalizeText(row.fluteBatches);
}

function getReel(row: ProductionPlanSortRow) {
  return toNumber(row.reelActualWithTrimming);
}

function sortByCompanyThenReelDesc(a: ProductionPlanSortRow, b: ProductionPlanSortRow) {
  return (
    getCompanyName(a).localeCompare(getCompanyName(b), undefined, { sensitivity: "base" }) ||
    getReel(b) - getReel(a)
  );
}

function sortByReelDesc(a: ProductionPlanSortRow, b: ProductionPlanSortRow) {
  return getReel(b) - getReel(a);
}

function mergeSmallRowsNearClosestReel(bigRows: ProductionPlanSortRow[], smallRows: ProductionPlanSortRow[]) {
  const merged = [...bigRows];
  if (merged.length === 0) return [...smallRows];

  smallRows.forEach((smallRow) => {
    const smallReel = getReel(smallRow);
    let closestIndex = 0;
    let closestDifference = Number.POSITIVE_INFINITY;

    merged.forEach((row, index) => {
      const difference = Math.abs(getReel(row) - smallReel);
      if (difference < closestDifference) {
        closestDifference = difference;
        closestIndex = index;
      }
    });

    merged.splice(closestIndex + 1, 0, smallRow);
  });

  return merged;
}

function groupMergedRowsByCompany(rows: ProductionPlanSortRow[]) {
  const grouped = new Map<string, ProductionPlanSortRow[]>();
  rows.forEach((row) => {
    const companyName = getCompanyName(row);
    const key = companyName.toLowerCase();
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });

  return Array.from(grouped.values())
    .sort((a, b) => {
      const maxA = Math.max(...a.map(getReel));
      const maxB = Math.max(...b.map(getReel));
      return maxB - maxA || getCompanyName(a[0]).localeCompare(getCompanyName(b[0]), undefined, { sensitivity: "base" });
    })
    .flat();
}

export function sortProductionPlanRows<T extends ProductionPlanSortRow>(rows: T[]): T[] {
  const groupedByFlute = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = getFluteBatch(row).toLowerCase();
    groupedByFlute.set(key, [...(groupedByFlute.get(key) || []), row]);
  });

  return Array.from(groupedByFlute.values())
    .sort((a, b) => getFluteBatch(a[0]).localeCompare(getFluteBatch(b[0]), undefined, { sensitivity: "base" }))
    .flatMap((batchRows) => {
      const bigRows = batchRows
        .filter((row) => toNumber(row.plannedProductionInMeter) > 200)
        .sort(sortByCompanyThenReelDesc);
      const smallRows = batchRows
        .filter((row) => toNumber(row.plannedProductionInMeter) <= 200)
        .sort(sortByReelDesc);
      const mergedRows = mergeSmallRowsNearClosestReel(bigRows, smallRows);
      return groupMergedRowsByCompany(mergedRows);
    }) as T[];
}
