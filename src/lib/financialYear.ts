export const FY_MONTHS = [
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
];

export function getCurrentFinancialYear() {
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

export function getFinancialYearFromDate(dateValue?: string | null) {
  const parsed = dateValue ? new Date(dateValue) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  const month = parsed.getMonth() + 1;
  const year = parsed.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

export function getMonthName(month: number) {
  return FY_MONTHS.find((entry) => entry.value === month)?.label || "";
}

export function getFinancialYearOptions(extraYears: string[] = []) {
  const current = getCurrentFinancialYear();
  const currentStart = Number(`20${current.slice(0, 2)}`);
  const options = new Set<string>(extraYears.filter(Boolean));
  for (let offset = -2; offset <= 2; offset += 1) {
    const start = currentStart + offset;
    options.add(`${String(start).slice(-2)}-${String(start + 1).slice(-2)}`);
  }
  return [...options].sort((a, b) => b.localeCompare(a));
}
