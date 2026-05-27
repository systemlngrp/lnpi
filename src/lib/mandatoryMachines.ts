import type { Setting } from "../types";
import { normalizeMachineName } from "./productionMachineNames";

export type MandatoryMachinesByType = Record<string, string[]>;

export function parseMandatoryMachinesByType(setting?: Setting | null): MandatoryMachinesByType {
  const raw = setting?.mandatoryMachinesByType;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    const normalized: MandatoryMachinesByType = {};
    for (const [typeName, value] of entries) {
      if (!typeName || typeof typeName !== "string") continue;
      const list = Array.isArray(value) ? value : [];
      const machines = list
        .map((v) => normalizeMachineName(String(v || "")).trim())
        .filter(Boolean);
      const key = typeName.trim();
      if (!key) continue;
      normalized[key] = Array.from(new Set(machines));
      normalized[key.toUpperCase()] = normalized[key];
    }
    return normalized;
  } catch {
    return {};
  }
}

export function getRequiredMachinesForType(mapping: MandatoryMachinesByType, typeName?: string | null) {
  const key = String(typeName || "").trim();
  if (!key) return [];
  return mapping[key] || mapping[key.toUpperCase()] || [];
}
