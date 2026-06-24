import { Company, DispatchPlan, LoadingSlip, LoadingSlipLine, Order, OrderItemSource } from "../types";
import type { OrderCatalogItem } from "./orderItems";

export type LoadingSlipLineContext = {
  line: LoadingSlipLine;
  plan?: DispatchPlan;
  order?: Order;
  item?: OrderCatalogItem;
  company?: Company;
  companyId: string;
  companyName: string;
  itemId: string;
  itemName: string;
  erpCode: string;
  masterErp: string;
  orderNo: string;
  itemSource: OrderItemSource;
  rate?: number;
  gstRate?: number;
  uom?: string;
  isDirect: boolean;
};

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

function normalizeSource(value: unknown): OrderItemSource {
  const normalized = normalizeString(value).toUpperCase();
  if (normalized === "PHP") return "PHP";
  if (normalized === "PLATE") return "PLATE";
  if (normalized === "MATERIAL") return "MATERIAL";
  return "FG";
}

export function isDirectLoadingSlip(slip?: Partial<LoadingSlip> | null) {
  return normalizeString(slip?.loadingSource).toUpperCase() === "DIRECT";
}

export function resolveLoadingSlipLineContext({
  slip,
  line,
  plans,
  orders,
  companies,
  resolveOrderItem,
}: {
  slip?: Partial<LoadingSlip> | null;
  line: LoadingSlipLine;
  plans: DispatchPlan[];
  orders: Order[];
  companies?: Company[];
  resolveOrderItem: (order?: Partial<Order> | null) => OrderCatalogItem | undefined;
}): LoadingSlipLineContext {
  const plan = plans.find((row) => row.id === line.dispatchPlanId);
  const order = orders.find((row) => row.id === plan?.orderId);
  const fallbackOrder = line.itemId
    ? ({ itemId: line.itemId, itemSource: line.itemSource || "FG" } as Partial<Order>)
    : undefined;
  const item = resolveOrderItem(order || fallbackOrder || null);
  const company = companies?.find((row) => row.id === (order?.companyId || line.companyId || slip?.companyId));
  const itemSource = normalizeSource(line.itemSource || order?.itemSource || item?.source || "FG");

  return {
    line,
    plan,
    order,
    item,
    company,
    companyId: normalizeString(line.companyId || order?.companyId || slip?.companyId),
    companyName:
      normalizeString(line.companyName) ||
      normalizeString(company?.name) ||
      normalizeString(slip?.companyName) ||
      normalizeString(item?.companyName),
    itemId: normalizeString(line.itemId || order?.itemId || item?.id),
    itemName: normalizeString(line.itemName) || normalizeString(item?.name),
    erpCode: normalizeString(line.erpCode || order?.erpCode || item?.erp),
    masterErp: normalizeString(line.masterErp || item?.raw?.masterItemNameErpCode),
    orderNo: normalizeString(order?.orderNo) || (isDirectLoadingSlip(slip) ? "DIRECT" : "N/A"),
    itemSource,
    rate: Number.isFinite(Number(line.rate)) ? Number(line.rate) : Number.isFinite(Number(item?.rate)) ? Number(item?.rate) : Number.isFinite(Number(order?.rate)) ? Number(order?.rate) : undefined,
    gstRate: Number.isFinite(Number(line.gstRate)) ? Number(line.gstRate) : Number.isFinite(Number(item?.gstRate)) ? Number(item?.gstRate) : undefined,
    uom: normalizeString(line.uom || item?.uom) || undefined,
    isDirect: isDirectLoadingSlip(slip) || !plan,
  };
}

export function summarizeLoadingSlip({
  slip,
  plans,
  orders,
  companies,
  resolveOrderItem,
}: {
  slip: LoadingSlip;
  plans: DispatchPlan[];
  orders: Order[];
  companies?: Company[];
  resolveOrderItem: (order?: Partial<Order> | null) => OrderCatalogItem | undefined;
}) {
  const itemNames = new Set<string>();
  const companyNames = new Set<string>();
  const erpCodes = new Set<string>();

  const lineContexts = (slip.lines || []).map((line) =>
    resolveLoadingSlipLineContext({ slip, line, plans, orders, companies, resolveOrderItem })
  );

  lineContexts.forEach((ctx) => {
    if (ctx.itemName) itemNames.add(ctx.itemName);
    if (ctx.companyName) companyNames.add(ctx.companyName);
    if (ctx.erpCode) erpCodes.add(ctx.erpCode);
  });

  return {
    itemNames: Array.from(itemNames),
    companyNames: Array.from(companyNames),
    erpCodes: Array.from(erpCodes),
    lineContexts,
  };
}
