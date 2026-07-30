import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useData } from "../hooks/useData";
import type {
  FixedMonthlyExpense,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  Production,
} from "../types";
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

function getReelRateForSlip({
  slip,
  materialInMap,
  materialMap,
}: {
  slip?: MaterialInPackingSlip;
  materialInMap: Map<string, MaterialIn>;
  materialMap: Map<string, Material>;
}) {
  if (!slip) return 0;
  const receipt = materialInMap.get(slip.materialInId);
  const line = receipt?.lines.find((entry) => entry.id === slip.materialLineId);
  const material = materialMap.get(slip.materialId);
  return Number(line?.invoiceRate ?? line?.poRate ?? line?.rate ?? material?.openingRate ?? 0);
}
export function ConversionCostMonthWiseReport() {
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [fixedExpenses] = useData<FixedMonthlyExpense>("fixed_monthly_expenses", []);
  const [productions] = useData<Production>("productions", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

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
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));
    const productionMap = new Map(productions.map((production) => [production.id, production]));

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

      const issuedPaperCost = issueReelLines.reduce((sum, line) => {
        const production = productionMap.get(line.productionId);
        if (!production || production.status === "Cancelled" || production.cancelTimestamp) return sum;
        if (getFinancialYearFromDate(production.date) !== fy) return sum;
        const productionMonth = production.date ? new Date(production.date).getMonth() + 1 : 0;
        if (productionMonth !== month.value) return sum;
        const slip = packingSlipMap.get(line.packingSlipId);
        const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
        return sum + Number(line.weightKg || 0) * rate;
      }, 0);

      const returnedPaperCost = returnReelLines.reduce((sum, line) => {
        const production = productionMap.get(line.productionId);
        if (!production || production.status === "Cancelled" || production.cancelTimestamp) return sum;
        if (getFinancialYearFromDate(production.date) !== fy) return sum;
        const productionMonth = production.date ? new Date(production.date).getMonth() + 1 : 0;
        if (productionMonth !== month.value) return sum;
        const slip = packingSlipMap.get(line.packingSlipId);
        const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
        return sum + Number(line.weightKg || 0) * rate;
      }, 0);

      const actualPaperUsedCost = issuedPaperCost - returnedPaperCost;

      return {
        month: month.label,
        monthValue: month.value,
        consumables: round2(consumables),
        fixed: round2(fixed),
        totalConsumption: round2(consumables),
        actualPaperUsedCost: round2(actualPaperUsedCost),
        ratio: actualPaperUsedCost > 0 ? round2(consumables / actualPaperUsedCost) : 0,
      };
    });
  }, [
    fy,
    issueLines,
    issueReelLines,
    materialIn,
    materialIssues,
    materials,
    monthFilter,
    normalizedFixedExpenses,
    packingSlips,
    productions,
    returnReelLines,
  ]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          consumables: sum.consumables + row.consumables,
          fixed: sum.fixed + row.fixed,
          totalConsumption: sum.totalConsumption + row.totalConsumption,
          actualPaperUsedCost: sum.actualPaperUsedCost + row.actualPaperUsedCost,
        }),
        { consumables: 0, fixed: 0, totalConsumption: 0, actualPaperUsedCost: 0 }
      ),
    [rows]
  );

  const totalRatio = totals.actualPaperUsedCost > 0 ? round2(totals.totalConsumption / totals.actualPaperUsedCost) : 0;

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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
        <div className="border border-gray-900 bg-purple-50 p-3">
          <p className="text-xs font-black uppercase text-slate-600">Overall Ratio</p>
          <p className="text-2xl font-black text-purple-700">{formatNumber(totalRatio)}</p>
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
              <th className="border border-gray-900 p-2 text-right">Actual Paper Used Cost</th>
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
                <td className="border border-gray-900 p-2 text-right">{formatMoney(row.actualPaperUsedCost)}</td>
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
              <td className="border border-gray-900 p-2 text-right">{formatMoney(totals.actualPaperUsedCost)}</td>
              <td className="border border-gray-900 p-2 text-right">{formatNumber(totalRatio)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
