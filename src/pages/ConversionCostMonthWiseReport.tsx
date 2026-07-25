import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Consumption, FixedMonthlyExpense, Material, MaterialIn, MaterialIssue, MaterialIssueLine, Production } from "../types";
import { FY_MONTHS, getCurrentFinancialYear, getFinancialYearFromDate, getFinancialYearOptions } from "../lib/financialYear";
import { resolveMaterialIssueRate } from "../lib/materialMovement";

function normalizeExpenseLines(value: FixedMonthlyExpense["lines"] | string | undefined) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isConsumableIssue(issue?: MaterialIssue) {
  const type = String(issue?.issueType || "").toLowerCase();
  return type === "without job" || type === "general";
}

function getLineAmount(line: MaterialIssueLine, materials: Material[], materialIn: MaterialIn[]) {
  const savedAmount = Number(line.amount || 0);
  if (savedAmount > 0) return savedAmount;
  const qty = Number(line.qty || 0);
  const savedRate = Number(line.rate || 0);
  if (savedRate > 0) return qty * savedRate;
  return resolveMaterialIssueRate(line.materialId, materials, materialIn, qty).amount;
}

export function ConversionCostMonthWiseReport() {
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [fixedExpenses] = useData<FixedMonthlyExpense>("fixed_monthly_expenses", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [productions] = useData<Production>("productions", []);

  const [fy, setFy] = useState(getCurrentFinancialYear());
  const [monthFilter, setMonthFilter] = useState("");

  const normalizedFixedExpenses = useMemo(
    () => fixedExpenses.map((record) => ({ ...record, lines: normalizeExpenseLines(record.lines) })),
    [fixedExpenses]
  );

  const fyOptions = useMemo(() => {
    const issueYears = materialIssues.map((issue) => getFinancialYearFromDate(issue.date)).filter(Boolean);
    const fixedYears = normalizedFixedExpenses.map((record) => record.fy);
    return getFinancialYearOptions([...issueYears, ...fixedYears]);
  }, [materialIssues, normalizedFixedExpenses]);

  const rows = useMemo(() => {
    const issueMap = new Map(materialIssues.map((issue) => [issue.id, issue]));

    return FY_MONTHS.filter((month) => !monthFilter || Number(monthFilter) === month.value).map((month) => {
      const consumables = issueLines.reduce((sum, line) => {
        const issue = issueMap.get(line.materialIssueId);
        if (!isConsumableIssue(issue)) return sum;
        if (getFinancialYearFromDate(issue?.date) !== fy) return sum;
        const issueMonth = issue?.date ? new Date(issue.date).getMonth() + 1 : 0;
        if (issueMonth !== month.value) return sum;
        return sum + getLineAmount(line, materials, materialIn);
      }, 0);

      const fixed = normalizedFixedExpenses
        .filter((record) => record.fy === fy && Number(record.month) === month.value)
        .reduce((sum, record) => sum + Number(record.totalAmount || 0), 0);

      const totalConsumption = consumptions.reduce((sum, consumption) => {
        if (consumption.status === "Cancelled") return sum;
        if (getFinancialYearFromDate(consumption.date) !== fy) return sum;
        const consumptionMonth = consumption.date ? new Date(consumption.date).getMonth() + 1 : 0;
        if (consumptionMonth !== month.value) return sum;
        return sum + Number(consumption.qty || 0);
      }, 0);

      const actualPaperUsed = productions.reduce((sum, production) => {
        if (production.status === "Cancelled") return sum;
        if (getFinancialYearFromDate(production.date) !== fy) return sum;
        const productionMonth = production.date ? new Date(production.date).getMonth() + 1 : 0;
        if (productionMonth !== month.value) return sum;
        return sum + Number(production.actualPaperUsed || 0);
      }, 0);

      return {
        month: month.label,
        monthValue: month.value,
        consumables: round2(consumables),
        fixed: round2(fixed),
        totalConsumption: round2(totalConsumption),
        actualPaperUsed: round2(actualPaperUsed),
        ratio: actualPaperUsed > 0 ? round2(totalConsumption / actualPaperUsed) : 0,
      };
    });
  }, [consumptions, fy, issueLines, materialIn, materialIssues, materials, monthFilter, normalizedFixedExpenses, productions]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          consumables: sum.consumables + row.consumables,
          fixed: sum.fixed + row.fixed,
          totalConsumption: sum.totalConsumption + row.totalConsumption,
          actualPaperUsed: sum.actualPaperUsed + row.actualPaperUsed,
        }),
        { consumables: 0, fixed: 0, totalConsumption: 0, actualPaperUsed: 0 }
      ),
    [rows]
  );

  const totalRatio = totals.actualPaperUsed > 0 ? round2(totals.totalConsumption / totals.actualPaperUsed) : 0;

  const clearFilters = () => {
    setFy(getCurrentFinancialYear());
    setMonthFilter("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-900 pb-3">
        <h1 className="text-2xl font-black uppercase tracking-tight">Conversion Cost Month Wise</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded border border-gray-900 p-2 text-sm font-bold" value={fy} onChange={(event) => setFy(event.target.value)}>
            {fyOptions.map((option) => (
              <option key={option} value={option}>
                FY {option}
              </option>
            ))}
          </select>
          <select className="rounded border border-gray-900 p-2 text-sm font-bold" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
            <option value="">All Months</option>
            {FY_MONTHS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
          <button className="inline-flex items-center gap-2 rounded border border-gray-900 px-3 py-2 text-sm font-bold" type="button" onClick={clearFilters}>
            <RotateCcw size={16} /> Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="border border-gray-900 bg-emerald-50 p-3">
          <p className="text-xs font-black uppercase text-slate-600">Consumables</p>
          <p className="text-2xl font-black text-emerald-700">{formatMoney(totals.consumables)}</p>
        </div>
        <div className="border border-gray-900 bg-blue-50 p-3">
          <p className="text-xs font-black uppercase text-slate-600">Fixed And Semi Variable Expenses</p>
          <p className="text-2xl font-black text-blue-700">{formatMoney(totals.fixed)}</p>
        </div>
        <div className="border border-gray-900 bg-amber-50 p-3">
          <p className="text-xs font-black uppercase text-slate-600">Total Conversion Cost</p>
          <p className="text-2xl font-black text-amber-700">{formatMoney(totals.consumables + totals.fixed)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-900 bg-white">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-gray-900 p-2 text-left">Month</th>
              <th className="border border-gray-900 p-2 text-right">Consumables</th>
              <th className="border border-gray-900 p-2 text-right">Fixed and Semi Variable Expenses</th>
              <th className="border border-gray-900 p-2 text-right">Total Consumption</th>
              <th className="border border-gray-900 p-2 text-right">Actual Paper Used</th>
              <th className="border border-gray-900 p-2 text-right">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.monthValue}>
                <td className="border border-gray-900 p-2 font-bold">{row.month}</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(row.consumables)}</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(row.fixed)}</td>
                <td className="border border-gray-900 p-2 text-right">{formatNumber(row.totalConsumption)}</td>
                <td className="border border-gray-900 p-2 text-right">{formatNumber(row.actualPaperUsed)}</td>
                <td className="border border-gray-900 p-2 text-right">{formatNumber(row.ratio)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-900 font-black text-white">
              <td className="border border-gray-900 p-2 text-right">Total</td>
              <td className="border border-gray-900 p-2 text-right">{formatMoney(totals.consumables)}</td>
              <td className="border border-gray-900 p-2 text-right">{formatMoney(totals.fixed)}</td>
              <td className="border border-gray-900 p-2 text-right">{formatNumber(totals.totalConsumption)}</td>
              <td className="border border-gray-900 p-2 text-right">{formatNumber(totals.actualPaperUsed)}</td>
              <td className="border border-gray-900 p-2 text-right">{formatNumber(totalRatio)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
