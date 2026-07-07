import { LinkedLoadingDetail, LoadingSlip, Order, OrderItemSource, PackingDetail } from "../types";
import type { OrderCatalogItem } from "./orderItems";

type LinkedSource = Extract<OrderItemSource, "PHP" | "PLATE">;

function normalizeSource(value: unknown): OrderItemSource {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PHP") return "PHP";
  if (normalized === "PLATE") return "PLATE";
  if (normalized === "MATERIAL") return "MATERIAL";
  return "FG";
}

function normalizeErpCode(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function compactErpCode(value: unknown) {
  return normalizeErpCode(value).replace(/[^a-z0-9]/g, "");
}

function digitErpCode(value: unknown) {
  return normalizeErpCode(value).replace(/\D/g, "");
}

function erpCodesMatch(source: unknown, candidate: unknown) {
  const sourceText = normalizeErpCode(source);
  const candidateText = normalizeErpCode(candidate);
  if (!sourceText || !candidateText) return false;
  if (sourceText === candidateText) return true;

  const sourceCompact = compactErpCode(sourceText);
  const candidateCompact = compactErpCode(candidateText);
  if (!sourceCompact || !candidateCompact) return false;
  if (sourceCompact === candidateCompact) return true;
  if (sourceCompact.length >= 4 && candidateCompact.includes(sourceCompact)) return true;
  if (candidateCompact.length >= 4 && sourceCompact.includes(candidateCompact)) return true;

  const sourceDigits = digitErpCode(sourceText);
  const candidateDigits = digitErpCode(candidateText);
  return sourceDigits.length >= 4 && sourceDigits === candidateDigits;
}

function toPositiveNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function round2(value: number) {
  return parseFloat(value.toFixed(2));
}

function clonePackingDetails(rows?: PackingDetail[]) {
  return Array.isArray(rows)
    ? rows.map((row) => ({
        extra: Number(row.extra || 0),
        bundles: Number(row.bundles || 0),
        packSize: Number(row.packSize || 0),
        quantity: Number(row.quantity || 0),
      }))
    : undefined;
}

export function findLinkedItemByErp(items: OrderCatalogItem[], erpCode: unknown) {
  const normalizedErp = normalizeErpCode(erpCode);
  if (!normalizedErp) return undefined;
  return items.find((item) => {
    const raw = item.raw || {};
    return [
      item.erp,
      raw.erp,
      raw.erpCode,
      raw.erpItemCode,
      raw.masterErp,
      raw.masterErpCode,
      raw.masterItemNameErpCode,
    ].some((value) => erpCodesMatch(normalizedErp, value));
  });
}

export function findLinkedItemByMasterErp(items: OrderCatalogItem[], erpCode: unknown) {
  const normalizedErp = normalizeErpCode(erpCode);
  if (!normalizedErp) return undefined;
  return items.find((item) => normalizeErpCode(item.raw?.masterItemNameErpCode) === normalizedErp);
}

export function getLinkedSetsPerBox(item?: OrderCatalogItem) {
  return toPositiveNumber(item?.raw?.numberOfSetsPerBox);
}

export function buildLinkedLoadingDetailsFromSlip({
  slip,
  source,
  plans,
  orders,
  resolveOrderItem,
  sourceItems,
  existingDetails,
}: {
  slip: LoadingSlip;
  source: LinkedSource;
  plans: Array<Pick<any, "id" | "orderId">>;
  orders: Order[];
  resolveOrderItem: (order?: Partial<Order> | null) => OrderCatalogItem | undefined;
  sourceItems: OrderCatalogItem[];
  existingDetails?: LinkedLoadingDetail[];
}) {
  const detailsByItemId = new Map<string, LinkedLoadingDetail>();
  const existingDetailsByItemId = new Map((existingDetails || []).map((detail) => [detail.itemId, detail]));

  slip.lines.forEach((line) => {
    const plan = plans.find((row) => row.id === line.dispatchPlanId);
    const order = orders.find((row) => row.id === plan?.orderId);
    const fgItem = resolveOrderItem(order || (line.itemId ? ({ itemId: line.itemId, itemSource: line.itemSource || "FG" } as Partial<Order>) : null));
    const lineSource = normalizeSource(line.itemSource || order?.itemSource || fgItem?.source || "FG");
    if (lineSource !== "FG") return;

    const scheduleErp = String(line.erpCode || order?.erpCode || fgItem?.erp || "").trim();
    const linkedItem = findLinkedItemByMasterErp(sourceItems, scheduleErp);
    const setsPerBox = getLinkedSetsPerBox(linkedItem);
    if (!linkedItem || !setsPerBox) return;

    const requiredQty = round2(Number(line.loadedQty || 0) * setsPerBox);
    if (!(requiredQty > 0)) return;

    const raw = linkedItem.raw || {};
    const existing = detailsByItemId.get(linkedItem.id);
    if (existing) {
      existing.requiredQty = round2(existing.requiredQty + requiredQty);
      return;
    }

    const existingDetail = existingDetailsByItemId.get(linkedItem.id);
    detailsByItemId.set(linkedItem.id, {
      source,
      itemId: linkedItem.id,
      itemName: linkedItem.name,
      companyName: String(line.companyName || linkedItem.companyName || "").trim() || undefined,
      erpCode: scheduleErp || String(raw.erpItemCode || linkedItem.erp || "").trim() || undefined,
      masterErp: String(raw.masterItemNameErpCode || "").trim() || undefined,
      setsPerBox,
      requiredQty,
      packingDetails: clonePackingDetails(existingDetail?.packingDetails),
      extraItemsQty: existingDetail?.extraItemsQty,
    });
  });

  return Array.from(detailsByItemId.values());
}
