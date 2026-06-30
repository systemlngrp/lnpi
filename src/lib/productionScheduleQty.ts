import type { Production } from "../types";

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

export function buildProducedQtyByScheduleId(
  productions: Production[],
  phpJobs: Production[] = [],
  plateJobs: Production[] = [],
) {
  const map = new Map<string, number>();
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
      map.set(
        effectiveScheduleId,
        (map.get(effectiveScheduleId) || 0) + Number(production.prodFromFFG || 0),
      );
    });

  return map;
}
