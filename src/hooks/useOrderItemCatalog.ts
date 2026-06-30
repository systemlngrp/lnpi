import { useMemo } from "react";
import { useData } from "./useData";
import { Material, Order, OrderItemSource } from "../types";
import {
  getOrderItemCompositeKey,
  normalizeOrderCatalogItem,
  normalizeOrderItemSource,
  normalizeOrderRecord,
  OrderCatalogItem,
} from "../lib/orderItems";

const getLookupKeys = (source: OrderItemSource, row: any) => {
  const normalizedSource = normalizeOrderItemSource(source);
  const keys = [
    row?.id,
    row?.itemId,
    row?.npdId,
    row?.phpId,
    row?.plateId,
    row?.materialId,
    row?.raw?.id,
    row?.raw?.itemId,
    row?.raw?.npdId,
    row?.raw?.phpId,
    row?.raw?.plateId,
    row?.raw?.materialId,
  ];

  return [...new Set(keys.map((value) => String(value || "").trim()).filter(Boolean))].map((value) =>
    getOrderItemCompositeKey(normalizedSource, value)
  );
};

export function useOrderItemCatalog() {
  const [fgRows] = useData<any>("npd", [], {
    cacheToLocalStorage: false,
    endpointOverride: "/api/npd?page=1&pageSize=10000&status=all",
    storageKey: "npd_order_catalog",
    syncEventKey: "sync-data-npd",
  });
  const [phpRows] = useData<any>("php_item_master", []);
  const [plateRows] = useData<any>("plate_item_master", []);
  const [materialRows] = useData<Material>("materials", []);

  const itemsBySource = useMemo<Record<OrderItemSource, OrderCatalogItem[]>>(
    () => ({
      FG: fgRows.map((row) => normalizeOrderCatalogItem(row, "FG")).filter(Boolean) as OrderCatalogItem[],
      PHP: phpRows.map((row) => normalizeOrderCatalogItem(row, "PHP")).filter(Boolean) as OrderCatalogItem[],
      PLATE: plateRows.map((row) => normalizeOrderCatalogItem(row, "PLATE")).filter(Boolean) as OrderCatalogItem[],
      MATERIAL: materialRows.map((row) => normalizeOrderCatalogItem(row, "MATERIAL")).filter(Boolean) as OrderCatalogItem[],
    }),
    [fgRows, phpRows, plateRows, materialRows]
  );

  const itemMap = useMemo(() => {
    const map = new Map<string, OrderCatalogItem>();
    (Object.keys(itemsBySource) as OrderItemSource[]).forEach((source) => {
      itemsBySource[source].forEach((item) => {
        getLookupKeys(source, item).forEach((key) => {
          if (!map.has(key)) {
            map.set(key, item);
          }
        });
      });
    });
    return map;
  }, [itemsBySource]);

  const findItem = (source: OrderItemSource | undefined, itemId: string | undefined) => {
    const normalizedSource = normalizeOrderItemSource(source);
    const normalizedItemId = String(itemId || "").trim();
    if (!normalizedItemId) return undefined;
    return itemMap.get(getOrderItemCompositeKey(normalizedSource, normalizedItemId));
  };

  const findItemAcrossSources = (
    itemId: string | undefined,
    preferredSource?: OrderItemSource,
    erpCode?: string | number
  ) => {
    const normalizedItemId = String(itemId || "").trim();
    const normalizedErp = String(erpCode || "").trim().toLowerCase();
    const orderedSources = [preferredSource, "FG", "PHP", "PLATE", "MATERIAL"]
      .map((source) => normalizeOrderItemSource(source))
      .filter((source, index, arr) => arr.indexOf(source) === index) as OrderItemSource[];

    if (normalizedItemId) {
      for (const source of orderedSources) {
        const match = findItem(source, normalizedItemId);
        if (match) return match;
      }
    }

    if (normalizedErp) {
      for (const source of orderedSources) {
        const match = (itemsBySource[source] || []).find((item) => {
          const raw = item.raw || {};
          return [item.erp, raw.erpCode, raw.erpItemCode, raw.masterItemNameErpCode]
            .map((value) => String(value || "").trim().toLowerCase())
            .filter(Boolean)
            .includes(normalizedErp);
        });
        if (match) return match;
      }
    }

    return undefined;
  };
  const resolveOrderItem = (order?: Partial<Order> | null) => {
    if (!order) return undefined;
    const normalizedOrder = normalizeOrderRecord(order);
    const lookupCandidates = [
      normalizedOrder.itemId,
      normalizedOrder.itemSource === "FG" ? normalizedOrder.npdId : "",
    ];

    for (const candidate of lookupCandidates) {
      const match = findItem(normalizedOrder.itemSource, String(candidate || ""));
      if (match) return match;
    }

    return undefined;
  };

  return {
    fgItems: itemsBySource.FG,
    phpItems: itemsBySource.PHP,
    plateItems: itemsBySource.PLATE,
    materialItems: itemsBySource.MATERIAL,
    allItems: (Object.values(itemsBySource).flat() as OrderCatalogItem[]).sort((left, right) =>
      `${left.source} ${left.name}`.localeCompare(`${right.source} ${right.name}`, undefined, { sensitivity: "base" })
    ),
    itemsBySource,
    itemMap,
    findItem,
    findItemAcrossSources,
    resolveOrderItem,
  };
}
