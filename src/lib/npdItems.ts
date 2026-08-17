import { Item } from "../types";
import { calculateInternalRapc, calculateInternalUps } from "./internalUps";


export function normalizeConsumableValue(raw: unknown) {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;

  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) return false;

  const truthy = new Set(["1", "true", "yes", "y", "on"]);
  return truthy.has(normalized);
}
export function getNpdItemDisplayName(item?: Partial<Item> | null) {
  return String(item?.name || (item as any)?.itemName || item?.erp || "").trim();
}

export async function fetchNpdItems(pageSize = 10000): Promise<Item[]> {
  const token = window.localStorage.getItem("authToken") || "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`/api/npd?page=1&pageSize=${pageSize}&status=all`, { headers });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch NPD items");
  }

  const result = await response.json();
  const rows = Array.isArray(result?.rows) ? result.rows : [];

  return rows.map((row) => {
    const resolvedId = String(row?.id || row?.npdId || row?.itemId || "").trim();
    return {
      ...row,
      id: resolvedId,
      consumable: normalizeConsumableValue(row?.consumable),
      internalUps: calculateInternalUps(row?.rapcForSingleBox),
      internalRapc: row?.internalRapc ?? calculateInternalRapc(row),
      itemId: resolvedId,
      npdId: resolvedId,
      name: getNpdItemDisplayName(row),
    };
  });
}

