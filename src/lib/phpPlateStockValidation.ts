import { buildPhpPlateInventoryRows } from "./phpPlateInventory";
import { LinkedLoadingDetail, LoadingSlip, OrderItemSource, Production } from "../types";

type LinkedSource = Extract<OrderItemSource, "PHP" | "PLATE">;

type MasterRow = {
  id: string;
  itemId?: string | number;
  openingQty?: string | number;
  [key: string]: string | number | boolean | null | undefined;
};

export type PhpPlateStockShortage = {
  source: LinkedSource;
  itemId: string;
  itemName: string;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
};

function round2(value: number) {
  return Number(value.toFixed(2));
}

function getExistingLinkedQtyByItem(
  slips: LoadingSlip[],
  source: LinkedSource,
  parentFgLoadingId?: string
) {
  const map = new Map<string, number>();
  const normalizedParentId = String(parentFgLoadingId || "").trim();
  if (!normalizedParentId) return map;

  slips.forEach((slip) => {
    if (String(slip.status || "Active").trim().toLowerCase() === "cancelled") return;
    if (String(slip.fgLoadingId || "").trim() !== normalizedParentId) return;

    (slip.lines || []).forEach((line) => {
      if (String(line.itemSource || source).trim().toUpperCase() !== source) return;
      const itemId = String(line.itemId || "").trim();
      if (!itemId) return;
      map.set(itemId, round2((map.get(itemId) || 0) + Number(line.loadedQty || 0)));
    });
  });

  return map;
}

function buildRequiredQtyByItem(details: LinkedLoadingDetail[]) {
  const map = new Map<string, { itemName: string; requiredQty: number }>();
  details.forEach((detail) => {
    const itemId = String(detail.itemId || "").trim();
    if (!itemId) return;
    const existing = map.get(itemId);
    map.set(itemId, {
      itemName: String(detail.itemName || existing?.itemName || "Unknown Item").trim() || "Unknown Item",
      requiredQty: round2((existing?.requiredQty || 0) + Number(detail.requiredQty || 0)),
    });
  });
  return map;
}

function buildBalanceMap(
  source: LinkedSource,
  masterRows: MasterRow[],
  jobs: Production[],
  loadingSlips: LoadingSlip[]
) {
  const rows = buildPhpPlateInventoryRows(masterRows, jobs, loadingSlips, source);
  return new Map(
    rows.map((row) => {
      const itemId = String(row.id || row.itemId || "").trim();
      return [itemId, round2(Number(row.balance || 0))] as const;
    })
  );
}

function getSourceShortages(args: {
  source: LinkedSource;
  details: LinkedLoadingDetail[];
  masterRows: MasterRow[];
  jobs: Production[];
  loadingSlips: LoadingSlip[];
  parentFgLoadingId?: string;
}) {
  const { source, details, masterRows, jobs, loadingSlips, parentFgLoadingId } = args;
  if (!details.length) return [];

  const requiredByItem = buildRequiredQtyByItem(details);
  const balanceByItem = buildBalanceMap(source, masterRows, jobs, loadingSlips);
  const existingLinkedQtyByItem = getExistingLinkedQtyByItem(loadingSlips, source, parentFgLoadingId);

  return Array.from(requiredByItem.entries())
    .map(([itemId, required]) => {
      const availableQty = round2((balanceByItem.get(itemId) || 0) + (existingLinkedQtyByItem.get(itemId) || 0));
      const requiredQty = round2(required.requiredQty);
      const shortageQty = round2(requiredQty - availableQty);

      if (shortageQty <= 0.0001) return null;

      return {
        source,
        itemId,
        itemName: required.itemName,
        requiredQty,
        availableQty: Math.max(0, availableQty),
        shortageQty,
      } satisfies PhpPlateStockShortage;
    })
    .filter((row): row is PhpPlateStockShortage => Boolean(row));
}

export function getPhpPlateStockShortages(args: {
  phpDetails?: LinkedLoadingDetail[];
  plateDetails?: LinkedLoadingDetail[];
  phpMasterRows: MasterRow[];
  plateMasterRows: MasterRow[];
  phpJobs: Production[];
  plateJobs: Production[];
  fgLoadingSlips: LoadingSlip[];
  phpLoadingSlips: LoadingSlip[];
  plateLoadingSlips: LoadingSlip[];
  parentFgLoadingId?: string;
}) {
  const {
    phpDetails = [],
    plateDetails = [],
    phpMasterRows,
    plateMasterRows,
    phpJobs,
    plateJobs,
    fgLoadingSlips,
    phpLoadingSlips,
    plateLoadingSlips,
    parentFgLoadingId,
  } = args;

  return [
    ...getSourceShortages({
      source: "PHP",
      details: phpDetails,
      masterRows: phpMasterRows,
      jobs: phpJobs,
      loadingSlips: [...phpLoadingSlips, ...fgLoadingSlips],
      parentFgLoadingId,
    }),
    ...getSourceShortages({
      source: "PLATE",
      details: plateDetails,
      masterRows: plateMasterRows,
      jobs: plateJobs,
      loadingSlips: [...plateLoadingSlips, ...fgLoadingSlips],
      parentFgLoadingId,
    }),
  ];
}

export function buildPhpPlateStockAlertMessage(shortages: PhpPlateStockShortage[]) {
  const lines = ["Please check the stock of PHP and Plate item."];
  shortages.forEach((shortage) => {
    lines.push(
      `${shortage.source} - ${shortage.itemName}: Required ${shortage.requiredQty.toLocaleString()}, Available ${shortage.availableQty.toLocaleString()}, Shortage ${shortage.shortageQty.toLocaleString()}`
    );
  });
  return lines.join("\n");
}
