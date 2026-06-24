import { Order, OrderItemSource } from "../types";

export type OrderCatalogItem = {
  id: string;
  source: OrderItemSource;
  name: string;
  erp: string;
  companyName: string;
  rate?: number;
  gstRate?: number;
  uom?: string;
  boxType?: string;
  raw: any;
};

export function normalizeOrderItemSource(value: unknown): OrderItemSource {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PHP") return "PHP";
  if (normalized === "PLATE") return "PLATE";
  if (normalized === "MATERIAL") return "MATERIAL";
  return "FG";
}

export function getOrderItemSourceLabel(source: OrderItemSource) {
  if (source === "PHP") return "PHP ITEM";
  if (source === "PLATE") return "PLATE ITEM";
  if (source === "MATERIAL") return "MATERIAL";
  return "FG ITEM";
}

export function getOrderItemCompositeKey(source: OrderItemSource, itemId: string) {
  return `${normalizeOrderItemSource(source)}::${String(itemId || "").trim()}`;
}

export function getOrderItemDisplayName(item?: Partial<OrderCatalogItem> | null) {
  return String(item?.name || item?.erp || "").trim();
}

const toFiniteNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

export function normalizeOrderCatalogItem(row: any, source: OrderItemSource): OrderCatalogItem | null {
  const normalizedSource = normalizeOrderItemSource(source);
  const id = String(
    row?.id ||
      row?.npdId ||
      row?.itemId ||
      row?.materialId ||
      row?.erpItemCode ||
      row?.masterItemNameErpCode ||
      ""
  ).trim();

  if (!id) return null;

  const name = String(
    row?.name ||
      row?.itemName ||
      row?.masterItemNameErpCode ||
      row?.erpItemCode ||
      row?.erp ||
      row?.erpCode ||
      ""
  ).trim();

  const erp = String(
    row?.erp ??
      row?.erpCode ??
      row?.erpItemCode ??
      row?.masterItemNameErpCode ??
      ""
  ).trim();

  const companyName = String(
    row?.customerName ||
      row?.customer ||
      row?.companyName ||
      row?.company ||
      ""
  ).trim();

  return {
    id,
    source: normalizedSource,
    name: name || erp || id,
    erp,
    companyName,
    rate: toFiniteNumber(row?.rate),
    gstRate: toFiniteNumber(row?.gstRate),
    uom: String(row?.uom || "").trim() || undefined,
    boxType: String(row?.boxType || "").trim() || undefined,
    raw: row,
  };
}

export function normalizeOrderRecord<T extends Partial<Order>>(order: T): T & { itemSource: OrderItemSource } {
  return {
    ...order,
    itemSource: normalizeOrderItemSource(order?.itemSource),
  };
}
