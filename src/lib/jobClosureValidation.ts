import type { Machine, Production, ProductionProcessing } from "../types";
import type { MandatoryMachinesByType } from "./mandatoryMachines";
import { getProductionEffectiveType, getRequiredMachinesForProduction } from "./productionType";
import { normalizeMachineName } from "./productionMachineNames";

export type JobClosureStatus = {
  canClose: boolean;
  reasons: string[];
  required: string[];
  done: number;
  missing: string[];
};

type BuildJobClosureStatusMapArgs = {
  productions: Production[];
  processing: ProductionProcessing[];
  mandatoryMachinesByType: MandatoryMachinesByType;
  machines: Machine[];
  resolveProductionItem: (production: Production) => any;
};

function isCorrugationLiner(name?: string | null) {
  return normalizeMachineName(name || "").trim().toLowerCase() === "corrugation liner";
}

function isProcessingEntryComplete(entry: ProductionProcessing) {
  const qtyValue = Number(entry.qty || 0);
  if (!Number.isFinite(qtyValue) || qtyValue <= 0) return false;
  if (!String(entry.machineId || "").trim()) return false;
  if (!String(entry.operatorId || "").trim()) return false;
  if (!String(entry.shift || "").trim()) return false;
  if (!String(entry.date || "").trim()) return false;
  return true;
}

function getIncompleteProcessingFields(entry: ProductionProcessing) {
  const fields: string[] = [];
  const qtyValue = Number(entry.qty || 0);
  if (!Number.isFinite(qtyValue) || qtyValue <= 0) fields.push("Qty");
  if (!String(entry.machineId || "").trim()) fields.push("Machine");
  if (!String(entry.operatorId || "").trim()) fields.push("Operator");
  if (!String(entry.shift || "").trim()) fields.push("Shift");
  if (!String(entry.date || "").trim()) fields.push("Date");
  return fields;
}

export function buildJobClosureStatusMap({
  productions,
  processing,
  mandatoryMachinesByType,
  machines,
  resolveProductionItem,
}: BuildJobClosureStatusMapArgs) {
  const result = new Map<string, JobClosureStatus>();

  productions.forEach((production) => {
    const item = resolveProductionItem(production);
    const effectiveType = getProductionEffectiveType(production, item);
    const required = getRequiredMachinesForProduction(production, item, mandatoryMachinesByType, machines)
      .map((machineName) => normalizeMachineName(machineName))
      .filter(Boolean);
    const uniqueRequired = Array.from(new Set(required));
    const records = processing.filter((entry) => entry.productionId === production.id);
    const planQty = Number(production.qty || 0);
    const reasons: string[] = [];
    const missing: string[] = [];
    let done = 0;

    if (uniqueRequired.length === 0) {
      reasons.push(`No required process steps configured for Type: ${String(effectiveType || "-")}`);
    }

    uniqueRequired.forEach((machineName) => {
      const stepRecords = records.filter((entry) => normalizeMachineName(entry.machineName) === machineName);
      if (stepRecords.length === 0) {
        missing.push(machineName);
        reasons.push(`Missing processing step: ${machineName}`);
        return;
      }

      const incompleteFields = Array.from(
        new Set(stepRecords.flatMap((entry) => getIncompleteProcessingFields(entry))),
      );

      if (incompleteFields.length > 0 || !stepRecords.every(isProcessingEntryComplete)) {
        missing.push(machineName);
        reasons.push(`Incomplete processing entry: ${machineName} (${incompleteFields.join(", ")})`);
        return;
      }

      done += 1;

      if (!isCorrugationLiner(machineName) && planQty > 0) {
        const stepQty = stepRecords.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
        if (stepQty > planQty) {
          reasons.push(`Qty exceeds Plan Qty for ${machineName} (Plan ${planQty}, Reported ${stepQty})`);
        }
      }
    });

    result.set(production.id, {
      canClose: reasons.length === 0,
      reasons,
      required: uniqueRequired,
      done,
      missing,
    });
  });

  return result;
}

export function formatJobCloseBlockedMessage(status?: Pick<JobClosureStatus, "reasons"> | null) {
  const reasons = status?.reasons?.length ? status.reasons : ["Processing data is incomplete."];
  return `Job Close is blocked:\n- ${reasons.join("\n- ")}`;
}
