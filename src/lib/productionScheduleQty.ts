import type { Production } from "../types";

export type ScheduleConsumptionSummary = {
  plannedQty: number;
  actualProducedQty: number;
  plannedWithoutFfgQty: number;
  effectiveConsumedQty: number;
};

function buildLinkedScheduleMap(rows: Production[]) {
  const map = new Map<string, string>();
  rows.forEach((row) => {
    const jobId = String(row.id || "").trim();
    const scheduleId = String(row.scheduleId || "").trim();
    if (!jobId || !scheduleId) return;
    map.set(jobId, scheduleId);
  });
  return map;
}

function hasFilledFfgValue(production: Production) {
  const value = Number(production.prodFromFFG);
  return Number.isFinite(value) && value > 0;
}

export function buildScheduleConsumptionByScheduleId(
  productions: Production[],
  phpJobs: Production[] = [],
  plateJobs: Production[] = [],
) {
  const map = new Map<string, ScheduleConsumptionSummary>();
  const phpScheduleByJobId = buildLinkedScheduleMap(phpJobs);
  const plateScheduleByJobId = buildLinkedScheduleMap(plateJobs);

  productions
    .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
    .forEach((production) => {
      const directScheduleId = String(production.scheduleId || "").trim();
      const phpLinkedScheduleId = String(
        phpScheduleByJobId.get(String(production.phpScheduledJobId || "").trim()) || "",
      ).trim();
      const plateLinkedScheduleId = String(
        plateScheduleByJobId.get(String(production.plateScheduledJobId || "").trim()) || "",
      ).trim();
      const effectiveScheduleId = directScheduleId || phpLinkedScheduleId || plateLinkedScheduleId;
      if (!effectiveScheduleId) return;

      const current = map.get(effectiveScheduleId) || {
        plannedQty: 0,
        actualProducedQty: 0,
        plannedWithoutFfgQty: 0,
        effectiveConsumedQty: 0,
      };

      if (hasFilledFfgValue(production)) {
        current.actualProducedQty += Number(production.prodFromFFG || 0);
      } else {
        current.plannedWithoutFfgQty += Number(production.qty || 0);
      }

      current.plannedQty = current.actualProducedQty + current.plannedWithoutFfgQty;
      current.effectiveConsumedQty = current.actualProducedQty + current.plannedWithoutFfgQty;
      map.set(effectiveScheduleId, current);
    });

  return map;
}
