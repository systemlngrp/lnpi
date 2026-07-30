export type RealizationTargetRow = {
  dateFrom: string;
  dateTo: string;
  value: number;
  fy?: string;
  month?: string;
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

function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}


function fyRangeToDates(fy: string, month: string) {
  const match = String(fy || "").trim().match(/^(\d{2})-(\d{2})$/);
  if (!match) return null;

  const startYear = 2000 + Number(match[1]);
  const monthIndex = MONTH_OPTIONS.indexOf(month);
  if (monthIndex > 0) {
    const calendarYear = monthIndex >= 4 ? startYear : startYear + 1;
    const start = new Date(calendarYear, monthIndex - 1, 1);
    const end = new Date(calendarYear, monthIndex, 0);
    return { dateFrom: toDateInput(start), dateTo: toDateInput(end) };
  }

  return {
    dateFrom: toDateInput(new Date(startYear, 3, 1)),
    dateTo: toDateInput(new Date(startYear + 1, 2, 31)),
  };
}

export function parseRealizationTargets(raw?: string | null): RealizationTargetRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const value = Number(row?.value || 0);
        const directDateFrom = String(row?.dateFrom || "").trim();
        const directDateTo = String(row?.dateTo || "").trim();
        const parsedDateFrom = parseAppDate(directDateFrom);
        const parsedDateTo = parseAppDate(directDateTo);
        if (parsedDateFrom && parsedDateTo) {
          return {
            dateFrom: toDateInput(parsedDateFrom),
            dateTo: toDateInput(parsedDateTo),
            value,
          };
        }

        const fy = String((row?.fy ?? row?.year) || "").trim();
        const month = String(row?.month || "All").trim() || "All";
        const legacyRange = fyRangeToDates(fy, MONTH_OPTIONS.includes(month) ? month : "All");
        if (!legacyRange) return null;
        return {
          ...legacyRange,
          value,
          fy,
          month: MONTH_OPTIONS.includes(month) ? month : "All",
        };
      })
      .filter((row): row is RealizationTargetRow => Boolean(row) && Number.isFinite(row.value));
  } catch {
    return [];
  }
}

export function findRealizationTargetForDate(targets: RealizationTargetRow[], value?: string | null) {
  const date = parseAppDate(value);
  if (!date) return null;
  const dateValue = normalizeDate(date).getTime();

  return targets.reduce<RealizationTargetRow | null>((selected, row) => {
    const from = parseAppDate(row.dateFrom);
    const to = parseAppDate(row.dateTo);
    if (!from || !to) return selected;

    const fromValue = normalizeDate(from).getTime();
    const toValue = normalizeDate(to).getTime();
    if (dateValue < fromValue || dateValue > toValue) return selected;

    if (!selected) return row;
    const selectedFrom = parseAppDate(selected.dateFrom);
    const selectedFromValue = selectedFrom ? normalizeDate(selectedFrom).getTime() : Number.NEGATIVE_INFINITY;
    return fromValue >= selectedFromValue ? row : selected;
  }, null);
}

export function describeRealizationTarget(row?: RealizationTargetRow | null) {
  if (!row) return "Not set";
  return `${row.dateFrom} to ${row.dateTo}`;
}
