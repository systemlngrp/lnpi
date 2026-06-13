import { ProductionProcessing } from "../types";
import { normalizeMachineName } from "./productionMachineNames";

export const PROCESSING_MACHINE_COLUMNS = [
  { key: "paper", label: "Paper", machineNames: ["Corrugation Paper"] },
  { key: "liner", label: "Liner", machineNames: ["Corrugation Liner"] },
  { key: "printing", label: "Printing", machineNames: ["Printing"] },
  { key: "pasting", label: "Pasting", machineNames: ["Pasting"] },
  { key: "stitching", label: "Stitching", machineNames: ["Stitching"] },
  { key: "punching", label: "Punching", machineNames: ["Punching", "Rotary", "Slotting"] },
  { key: "gluing", label: "Gluing", machineNames: ["Gluing"] }
] as const;

export type ProcessingMachineKey = (typeof PROCESSING_MACHINE_COLUMNS)[number]["key"];

export interface ProcessingMachineTotals {
  paper: number;
  liner: number;
  printing: number;
  pasting: number;
  stitching: number;
  punching: number;
  gluing: number;
}

export interface GroupedProcessingRow extends ProcessingMachineTotals {
  productionId: string;
  jobNo: string;
  date: string;
  operatorNames: string[];
  recordIds: string[];
}

const EMPTY_TOTALS: ProcessingMachineTotals = {
  paper: 0,
  liner: 0,
  printing: 0,
  pasting: 0,
  stitching: 0,
  punching: 0,
  gluing: 0
};

export function getEmptyProcessingTotals(): ProcessingMachineTotals {
  return { ...EMPTY_TOTALS };
}

export function buildProcessingTotalsMap(processing: ProductionProcessing[]) {
  const totalsMap = new Map<string, ProcessingMachineTotals>();

  processing.forEach((entry) => {
    if (!entry.productionId) return;
    const current = totalsMap.get(entry.productionId) || getEmptyProcessingTotals();
    const machineColumn = PROCESSING_MACHINE_COLUMNS.find((column) =>
      (column.machineNames as readonly string[]).includes(normalizeMachineName(entry.machineName))
    );

    if (machineColumn) {
      current[machineColumn.key] += Number(entry.qty || 0);
    }

    totalsMap.set(entry.productionId, current);
  });

  return totalsMap;
}

export function groupProcessingByProduction(processing: ProductionProcessing[]) {
  const grouped = new Map<string, GroupedProcessingRow>();

  processing.forEach((entry) => {
    if (!entry.productionId) return;

    const existing = grouped.get(entry.productionId) || {
      productionId: entry.productionId,
      jobNo: String(entry.jobNo || ""),
      date: entry.date,
      operatorNames: [],
      recordIds: [],
      ...getEmptyProcessingTotals()
    };

    const machineColumn = PROCESSING_MACHINE_COLUMNS.find((column) =>
      (column.machineNames as readonly string[]).includes(normalizeMachineName(entry.machineName))
    );

    if (machineColumn) {
      existing[machineColumn.key] += Number(entry.qty || 0);
    }

    if (entry.operatorName && !existing.operatorNames.includes(entry.operatorName)) {
      existing.operatorNames.push(entry.operatorName);
    }

    if (!existing.recordIds.includes(entry.id)) {
      existing.recordIds.push(entry.id);
    }

    if (new Date(entry.date).getTime() > new Date(existing.date).getTime()) {
      existing.date = entry.date;
    }

    grouped.set(entry.productionId, existing);
  });

  return Array.from(grouped.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}
