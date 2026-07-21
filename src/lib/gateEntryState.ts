import type { GateEntry } from "../types";

export function hasGateEntryMrr(entry?: Pick<GateEntry, "mrrId" | "mrrNo" | "mrrDate"> | null) {
  return Boolean(
    String(entry?.mrrId || "").trim() ||
    String(entry?.mrrNo || "").trim() ||
    String(entry?.mrrDate || "").trim()
  );
}

export function isGateEntryCancelled(entry?: Pick<GateEntry, "status" | "cancelledAt"> | null) {
  return String(entry?.status || "").trim().toLowerCase() === "cancelled" || Boolean(String(entry?.cancelledAt || "").trim());
}

export function canCreateMrrForGateEntry(entry?: GateEntry | null) {
  return Boolean(entry) && !isGateEntryCancelled(entry) && !hasGateEntryMrr(entry);
}