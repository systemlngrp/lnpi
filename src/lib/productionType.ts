import type { Machine, Production, Setting } from "../types";
import type { MandatoryMachinesByType } from "./mandatoryMachines";
import { getRequiredMachinesForType } from "./mandatoryMachines";
import { normalizeMachineName } from "./productionMachineNames";

type ProductionLikeItem = {
  boxType?: string;
  raw?: any;
};

export function getProductionEffectiveType(
  production?: Pick<Production, "itemSource"> | null,
  item?: ProductionLikeItem | null
) {
  const source = String(production?.itemSource || "FG").trim().toUpperCase();
  if (source === "PHP") return "PHP";
  if (source === "PLATE") return "PLATE";
  return String(item?.boxType || item?.raw?.boxType || item?.raw?.typeName || "").trim();
}

export function getAllMachineNames(machines: Machine[]) {
  return Array.from(
    new Set(
      machines
        .map((machine) => normalizeMachineName(machine.name))
        .filter(Boolean)
    )
  );
}

export function getRequiredMachinesForProduction(
  production: Pick<Production, "itemSource">,
  item: ProductionLikeItem | null | undefined,
  mapping: MandatoryMachinesByType,
  machines: Machine[]
) {
  const source = String(production.itemSource || "FG").trim().toUpperCase();
  if (source === "PHP" || source === "PLATE") {
    return getAllMachineNames(machines);
  }
  return getRequiredMachinesForType(mapping, getProductionEffectiveType(production, item));
}
