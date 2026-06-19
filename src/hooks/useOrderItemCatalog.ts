import { useMemo } from "react";
import { useData } from "./useData";
import { Order, OrderItemSource } from "../types";
import {
  getOrderItemCompositeKey,
  normalizeOrderCatalogItem,
  normalizeOrderItemSource,
  normalizeOrderRecord,
  OrderCatalogItem,
} from "../lib/orderItems";

export function useOrderItemCatalog() {
  const [fgRows] = useData<any>("npd", []);
  const [phpRows] = useData<any>("php_item_master", []);
  const [plateRows] = useData<any>("plate_item_master", []);

  const itemsBySource = useMemo<Record<OrderItemSource, OrderCatalogItem[]>>(
    () => ({
      FG: fgRows.map((row) => normalizeOrderCatalogItem(row, "FG")).filter(Boolean) as OrderCatalogItem[],
      PHP: phpRows.map((row) => normalizeOrderCatalogItem(row, "PHP")).filter(Boolean) as OrderCatalogItem[],
      PLATE: plateRows.map((row) => normalizeOrderCatalogItem(row, "PLATE")).filter(Boolean) as OrderCatalogItem[],
    }),
    [fgRows, phpRows, plateRows]
  );

  const itemMap = useMemo(() => {
    const map = new Map<string, OrderCatalogItem>();
    (Object.keys(itemsBySource) as OrderItemSource[]).forEach((source) => {
      itemsBySource[source].forEach((item) => {
        map.set(getOrderItemCompositeKey(source, item.id), item);
      });
    });
    return map;
  }, [itemsBySource]);

  const findItem = (source: OrderItemSource | undefined, itemId: string | undefined) => {
    const normalizedSource = normalizeOrderItemSource(source);
    return itemMap.get(getOrderItemCompositeKey(normalizedSource, String(itemId || "").trim()));
  };

  const resolveOrderItem = (order?: Partial<Order> | null) => {
    if (!order) return undefined;
    const normalizedOrder = normalizeOrderRecord(order);
    return findItem(normalizedOrder.itemSource, normalizedOrder.itemId);
  };

  return {
    fgItems: itemsBySource.FG,
    phpItems: itemsBySource.PHP,
    plateItems: itemsBySource.PLATE,
    itemsBySource,
    itemMap,
    findItem,
    resolveOrderItem,
  };
}
