import { getFinancialYear } from "./serial";

export type RealizationTargetRow = {
  fy: string;
  month: string;
  value: number;
};

const MONTH_OPTIONS = ["All", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseAppDate(value?: string | null) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const onlyDate = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) {
    const [year, month, day] = onlyDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthLabelFromDate(date: Date) {
  return MONTH_OPTIONS[date.getMonth() + 1] || "All";
}

export function parseRealizationTargets(raw?: string | null): RealizationTargetRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        fy: String((row?.fy ?? row?.year) || "").trim(),
        month: String(row?.month || "All").trim() || "All",
        value: Number(row?.value || 0),
      }))
      .filter((row) => row.fy && Number.isFinite(row.value));
  } catch {
    return [];
  }
}

export function findRealizationTargetForDate(targets: RealizationTargetRow[], value?: string | null) {
  const date = parseAppDate(value);
  if (!date) return null;
  const fy = getFinancialYear(toDateInput(date));
  const month = monthLabelFromDate(date);
  const exact = targets.find((row) => row.fy === fy && row.month === month);
  if (exact) return exact;
  return targets.find((row) => row.fy === fy && row.month === "All") || null;
}
