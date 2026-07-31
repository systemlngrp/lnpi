import { getFinancialYearFromDate } from "./financialYear";

export const DISPATCH_PLAN_PREFIX = "DP";

export function formatDispatchPlanNo(fy: string, sequence: number) {
  return `${DISPATCH_PLAN_PREFIX}/${fy}/${String(sequence).padStart(5, "0")}`;
}

export function parseDispatchPlanSequence(planNo?: string | null, date?: string | null) {
  const value = String(planNo || "").trim();
  const newFormat = value.match(/^DP\/(\d{2}-\d{2})\/(\d+)$/i);
  if (newFormat) {
    return {
      fy: newFormat[1],
      sequence: Number.parseInt(newFormat[2], 10),
    };
  }

  const legacyFormat = value.match(/^DP-(\d+)$/i);
  if (legacyFormat) {
    return {
      fy: getFinancialYearFromDate(date),
      sequence: Number.parseInt(legacyFormat[1], 10),
    };
  }

  return null;
}

export function getNextDispatchPlanNo(existingPlans: Array<{ planNo?: string | null; date?: string | null }>, date: string) {
  const fy = getFinancialYearFromDate(date);
  const maxSequence = existingPlans.reduce((max, plan) => {
    const parsed = parseDispatchPlanSequence(plan.planNo, plan.date);
    if (!parsed || parsed.fy !== fy || !Number.isFinite(parsed.sequence)) return max;
    return Math.max(max, parsed.sequence);
  }, 0);

  return {
    fy,
    sequence: maxSequence + 1,
    planNo: formatDispatchPlanNo(fy, maxSequence + 1),
  };
}
