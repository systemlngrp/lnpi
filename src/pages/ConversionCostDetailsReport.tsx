import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useData } from "../hooks/useData";
import type {
  FixedDailyExpense,
  FixedMonthlyExpense,
  Invoice,
  InvoiceLineItem,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  Production,
} from "../types";
import { getCurrentFinancialYear } from "../lib/financialYear";
import { resolveMaterialIssueRate } from "../lib/materialMovement";

type FactoryBucket = {
  key: string;
  label: string;
  keywords: string[];
  source: "material" | "fixed" | "both";
};

type MisInputs = {
  paperRate: number;
  salesReturnBasic: number;
  fgWipOpening: number;
  fgWipClosing: number;
  lnpiOpening: number;
  lnpiClosing: number;
  hoSalary: number;
  managementSalary: number;
  allEmi: number;
  miscExpense: number;
};

const factoryBuckets: FactoryBucket[] = [
  { key: "starch", label: "Starch", keywords: ["starch", "corrugation gum", "pasting gum"], source: "material" },
  { key: "borex", label: "Borex", keywords: ["borex", "borax"], source: "material" },
  { key: "caustic", label: "Caustic", keywords: ["caustic"], source: "material" },
  { key: "ink", label: "INK", keywords: ["ink"], source: "material" },
  { key: "strapping", label: "Strapping Roll", keywords: ["strapping", "sutli", "plastic sutli"], source: "material" },
  { key: "fevicol", label: "Fevicol", keywords: ["fevicol"], source: "material" },
  { key: "stitchingWire", label: "Stitching Wire", keywords: ["stitching wire"], source: "material" },
  { key: "diesel", label: "Diesel", keywords: ["diesel"], source: "both" },
  { key: "firewood", label: "Firewood", keywords: ["firewood", "fire wood"], source: "both" },
  { key: "briquettes", label: "Briquettes", keywords: ["briquette"], source: "both" },
  { key: "woodChips", label: "Wood Chips", keywords: ["wood chip"], source: "both" },
  { key: "salary", label: "Total Salary", keywords: ["salary", "wages", "contractual work"], source: "fixed" },
  { key: "dailyCash", label: "Daily Cash Expenses", keywords: ["daily cash", "cash expense", "petty cash"], source: "fixed" },
];

const defaultInputs: MisInputs = {
  paperRate: 31,
  salesReturnBasic: 0,
  fgWipOpening: 0,
  fgWipClosing: 0,
  lnpiOpening: 0,
  lnpiClosing: 0,
  hoSalary: 0,
  managementSalary: 0,
  allEmi: 0,
  miscExpense: 0,
};

function normalizeExpenseLines(value: FixedMonthlyExpense["lines"] | FixedDailyExpense["lines"] | string | undefined) {
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

function toDateOnly(value?: string | Date | null) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const isoDatePrefix = /^(\d{4}-\d{2}-\d{2})[T\s]/.exec(trimmed);
  if (isoDatePrefix) return isoDatePrefix[1];
  const ddmmyyyy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(trimmed);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value?: string | null) {
  const dateValue = toDateOnly(value);
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDateTime(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function isWithinRange(value: string | undefined, fromDate: string, toDate: string) {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const time = normalizeDateTime(parsed);
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (from && time < normalizeDateTime(from)) return false;
  if (to && time > normalizeDateTime(to)) return false;
  return true;
}

function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toDateOnly(from), to: toDateOnly(to) };
}

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatDecimal(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeText(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLoose(value?: string | null) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function getBucketForText(text: string, source: "material" | "fixed") {
  const normalized = normalizeText(text);
  return factoryBuckets.find((bucket) => {
    if (bucket.source !== "both" && bucket.source !== source) return false;
    return bucket.keywords.some((keyword) => normalized.includes(keyword));
  });
}

function getLineAmount(line: MaterialIssueLine, materials: Material[], materialIn: MaterialIn[]) {
  const savedAmount = Number(line.amount || 0);
  if (savedAmount > 0) return savedAmount;
  const qty = Number(line.qty || 0);
  const savedRate = Number(line.rate || 0);
  if (savedRate > 0) return qty * savedRate;
  return resolveMaterialIssueRate(line.materialId, materials, materialIn, qty, { useLatestRateAsOpeningRate: true }).amount;
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

function getProductionFfg(production: Production) {
  return Number(production.prodFromFFG || 0);
}

function getProductionFfgDate(production: Production) {
  return production.ffgTimestamp || production.date;
}

function getProductionUsefulWeight(production: Production) {
  return getProductionFfg(production) * Number(production.sheetWeight || 0);
}

function getExpenseMonthDate(record: FixedMonthlyExpense) {
  const [startYearText] = String(record.fy || getCurrentFinancialYear()).split("-");
  const startYear = 2000 + Number(startYearText || 0);
  const month = Number(record.month || 0);
  const year = month >= 4 ? startYear : startYear + 1;
  return new Date(year, month - 1, 1);
}

function isExpenseInRange(record: FixedMonthlyExpense, fromDate: string, toDate: string) {
  const monthStart = getExpenseMonthDate(record);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (from && normalizeDateTime(monthEnd) < normalizeDateTime(from)) return false;
  if (to && normalizeDateTime(monthStart) > normalizeDateTime(to)) return false;
  return true;
}

export function ConversionCostDetailsReport() {
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [fixedExpenses] = useData<FixedMonthlyExpense>("fixed_monthly_expenses", []);
  const [fixedDailyExpenses] = useData<FixedDailyExpense>("fixed_daily_expenses", []);
  const [productions] = useData<Production>("productions", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [invoiceLines] = useData<InvoiceLineItem>("invoice_line_items", []);

  const currentRange = useMemo(getCurrentMonthRange, []);
  const [fromDate, setFromDate] = useState(currentRange.from);
  const [toDate, setToDate] = useState(currentRange.to);
  const [inputs, setInputs] = useState<MisInputs>(defaultInputs);

  const report = useMemo(() => {
    const issueMap = new Map(materialIssues.map((issue) => [issue.id, issue]));
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));
    const bucketTotals = new Map(factoryBuckets.map((bucket) => [bucket.key, 0]));
    let matchingConsumableIssueLines = 0;

    issueLines.forEach((line) => {
      const issue = issueMap.get(line.materialIssueId);
      const issueType = normalizeLoose(issue?.issueType);
      if (issueType !== "withoutjob" && issueType !== "general") return;
      if (!isWithinRange(issue?.date, fromDate, toDate)) return;
      const material = materialMap.get(line.materialId);
      if (normalizeText(material?.type) !== "other") return;
      matchingConsumableIssueLines += 1;
      const amount = getLineAmount(line, materials, materialIn);
      const bucket = getBucketForText(material?.name, "material");
      if (bucket) bucketTotals.set(bucket.key, (bucketTotals.get(bucket.key) || 0) + amount);
    });

    fixedExpenses.forEach((record) => {
      if (!isExpenseInRange(record, fromDate, toDate)) return;
      normalizeExpenseLines(record.lines).forEach((line) => {
        const amount = Number(line.amount || 0);
        const bucket = getBucketForText(line.expenseName, "fixed");
        if (bucket && bucket.key !== "dailyCash") bucketTotals.set(bucket.key, (bucketTotals.get(bucket.key) || 0) + amount);
      });
    });


    fixedDailyExpenses.forEach((record) => {
      if (!isWithinRange(record.date, fromDate, toDate)) return;
      normalizeExpenseLines(record.lines).forEach((line) => {
        bucketTotals.set("dailyCash", (bucketTotals.get("dailyCash") || 0) + Number(line.amount || 0));
      });
    });
    const factoryRows = factoryBuckets.map((bucket, index) => {
      const amount = round2(bucketTotals.get(bucket.key) || 0);
      return {
        slNo: index + 1,
        label: bucket.label,
        amount,
      };
    });

    const productionRows = productions.filter(
      (production) => production.status !== "Cancelled" && !production.cancelTimestamp && isWithinRange(getProductionFfgDate(production), fromDate, toDate)
    );
    const productionIds = new Set(productionRows.map((production) => production.id));
    const totalProduction = round2(
      productionRows.reduce((sum, production) => sum + getProductionFfg(production), 0)
    );
    const totalActualPaperUsed = round2(productionRows.reduce((sum, production) => sum + Number(production.actualPaperUsed || 0), 0));
    const totalUsefulWeight = round2(productionRows.reduce((sum, production) => sum + getProductionUsefulWeight(production), 0));
    const issuedPaperCost = issueReelLines.reduce((sum, line) => {
      if (!productionIds.has(line.productionId)) return sum;
      const slip = packingSlipMap.get(line.packingSlipId);
      const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
      return sum + Number(line.weightKg || 0) * rate;
    }, 0);
    const returnedPaperCost = returnReelLines.reduce((sum, line) => {
      if (!productionIds.has(line.productionId)) return sum;
      const slip = packingSlipMap.get(line.packingSlipId);
      const rate = getReelRateForSlip({ slip, materialInMap, materialMap });
      return sum + Number(line.weightKg || 0) * rate;
    }, 0);
    const actualPaperUsedCost = round2(issuedPaperCost - returnedPaperCost);
    const totalPayable = round2(factoryRows.reduce((sum, row) => sum + row.amount, 0));
    const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const totalSold = round2(
      invoiceLines.reduce((sum, line) => {
        const invoice = invoiceMap.get(line.invoiceId);
        if (!isWithinRange(invoice?.date, fromDate, toDate)) return sum;
        return sum + Number(line.qty || 0);
      }, 0)
    );
    const totalSaleBasic = round2(
      invoices.filter((invoice) => isWithinRange(invoice.date, fromDate, toDate)).reduce((sum, invoice) => sum + Number(invoice.totalBeforeGst || 0), 0)
    );
    const adjustedSales = round2(
      totalSaleBasic -
        inputs.salesReturnBasic -
        inputs.fgWipOpening +
        inputs.fgWipClosing -
        inputs.lnpiOpening +
        inputs.lnpiClosing
    );
    const paperCost = actualPaperUsedCost;
    const paperCostPerKg = totalActualPaperUsed > 0 ? round2(paperCost / totalActualPaperUsed) : 0;
    const expensePerKg = (payableAmount: number) => (totalActualPaperUsed > 0 ? round2(payableAmount / totalActualPaperUsed) : 0);
    const spPerKg = totalProduction > 0 ? round2(adjustedSales / totalProduction) : 0;
    const factoryConversionPerKg = expensePerKg(totalPayable);
    const result = round2(
      spPerKg -
        paperCostPerKg -
        factoryConversionPerKg -
        expensePerKg(inputs.hoSalary) -
        expensePerKg(inputs.managementSalary) -
        expensePerKg(inputs.allEmi) -
        expensePerKg(inputs.miscExpense)
    );

    return {
      factoryRows,
      matchingConsumableIssueLines,
      totalPayable,
      totalProduction,
      totalActualPaperUsed,
      totalSold,
      wastagePercent: totalActualPaperUsed > 0 && totalUsefulWeight > 0 ? round2(100 - (totalUsefulWeight / totalActualPaperUsed) * 100) : 0,
      totalSaleBasic,
      adjustedSales,
      actualPaperUsedCost,
      paperCost,
      paperCostPerKg,
      paperPercent: adjustedSales > 0 ? round2((paperCost / adjustedSales) * 100) : 0,
      spPerKg,
      factoryConversionPerKg,
      result,
      lossAmount: round2(result * totalProduction),
      expensePerKg,
    };
  }, [
    fixedDailyExpenses,
    fixedExpenses,
    fromDate,
    inputs.allEmi,
    inputs.fgWipClosing,
    inputs.fgWipOpening,
    inputs.hoSalary,
    inputs.lnpiClosing,
    inputs.lnpiOpening,
    inputs.managementSalary,
    inputs.miscExpense,
    inputs.paperRate,
    inputs.salesReturnBasic,
    invoiceLines,
    invoices,
    issueLines,
    materialIn,
    materialIssues,
    materials,
    productions,
    toDate,
  ]);

  const resetReport = () => {
    setFromDate(currentRange.from);
    setToDate(currentRange.to);
    setInputs(defaultInputs);
  };
  const factoryDisplayRows = report.factoryRows;

  const renderInputCell = (key: keyof MisInputs) => (
    <input
      type="number"
      step="any"
      value={inputs[key] || ""}
      onChange={(event) => {
        const value = event.target.value;
        setInputs((prev) => ({
          ...prev,
          [key]: value === "" ? 0 : Number(value),
        }));
      }}
      className="w-full border-0 bg-transparent text-right font-black outline-none focus:bg-white focus:ring-1 focus:ring-gray-900"
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-900 pb-3">
        <h1 className="text-2xl font-black uppercase tracking-tight">Conversion Cost Details</h1>
        <button className="inline-flex items-center gap-2 rounded border border-gray-900 px-3 py-2 text-sm font-bold" type="button" onClick={resetReport}>
          <RotateCcw size={16} /> Reset
        </button>
      </div>

      <div className="border border-gray-900 bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:max-w-xl">
          <label className="text-xs font-black uppercase text-slate-700">
            From Date
            <input className="mt-1 h-9 w-full border border-gray-900 px-2 text-sm font-bold" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="text-xs font-black uppercase text-slate-700">
            To Date
            <input className="mt-1 h-9 w-full border border-gray-900 px-2 text-sm font-bold" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="overflow-x-auto border border-gray-900 bg-white">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-gray-900 bg-teal-700 p-2 text-center text-white" colSpan={4}>
                  FACTORY CONSUMPTION DETAILS
                </th>
              </tr>
              <tr className="bg-orange-100">
                <th className="border border-gray-900 p-2 text-center">Sl No.</th>
                <th className="border border-gray-900 p-2 text-left">Particulars</th>
                <th className="border border-gray-900 p-2 text-right">Payable amount</th>
                <th className="border border-gray-900 p-2 text-right">Cost Per Kg</th>
              </tr>
            </thead>
            <tbody>
              {factoryDisplayRows.map((row) => (
                <tr key={row.label}>
                  <td className="border border-gray-900 p-2 text-center font-bold">{row.slNo}</td>
                  <td className="border border-gray-900 p-2 font-bold">{row.label}</td>
                  <td className="border border-gray-900 p-2 text-right font-bold">{formatMoney(row.amount)}</td>
                  <td className="border border-gray-900 p-2 text-right font-bold">{formatDecimal(report.expensePerKg(row.amount))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-yellow-300 font-black">
                <td className="border border-gray-900 p-2 text-right" colSpan={2}>
                  Total Payable
                </td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(report.totalPayable)}</td>
                <td className="border border-gray-900 p-2 text-right">{formatDecimal(report.factoryConversionPerKg)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="overflow-x-auto border border-gray-900 bg-white">
          <table className="w-full min-w-[610px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-gray-900 bg-red-950 p-2 text-center text-white" colSpan={4}>
                  MIS REPORT
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-rose-200 font-black">
                <td className="border border-gray-900 p-2">FFG Value</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(report.adjustedSales)}</td>
                <td className="border border-gray-900 p-2" colSpan={2} />
              </tr>
              <tr className="bg-rose-200 font-black">
                <td className="border border-gray-900 p-2">Actual Paper Used</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(report.actualPaperUsedCost)}</td>
                <td className="border border-gray-900 p-2" colSpan={2} />
              </tr>
              <tr className="bg-rose-200 font-black">
                <td className="border border-gray-900 p-2">Total Sold Value (Invoiced)</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(report.totalSaleBasic)}</td>
                <td className="border border-gray-900 p-2" colSpan={2} />
              </tr>
              <tr className="bg-rose-200 font-black">
                <td className="border border-gray-900 p-2">Wastage Percent</td>
                <td className="border border-gray-900 p-2 text-right">{formatDecimal(report.wastagePercent)}%</td>
                <td className="border border-gray-900 p-2" />
                <td className="border border-gray-900 p-2" />
              </tr>
              <tr className="bg-rose-300 font-black">
                <td className="border border-gray-900 p-2">Total Sale (Basic)</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(report.totalSaleBasic)}</td>
                <td className="border border-gray-900 p-2" />
                <td className="border border-gray-900 p-2" />
              </tr>
              <tr className="bg-rose-200 font-black">
                <td className="border border-gray-900 p-2">Sales Return (Basic)</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(inputs.salesReturnBasic)}</td>
                <td className="border border-gray-900 p-2" />
                <td className="border border-gray-900 p-2" />
              </tr>
              <tr className="bg-cyan-100 font-black">
                <td className="border border-gray-900 p-2">FG - WIP Opening Valuation</td>
                <td className="border border-gray-900 p-1 text-right">{renderInputCell("fgWipOpening")}</td>
                <td className="border border-gray-900 p-2 text-center">LNPI SALE -Purchase</td>
                <td className="border border-gray-900 p-1 text-right">{renderInputCell("lnpiOpening")}</td>
              </tr>
              <tr className="bg-cyan-100 font-black">
                <td className="border border-gray-900 p-2">FG - WIP Closing Valuation</td>
                <td className="border border-gray-900 p-1 text-right">{renderInputCell("fgWipClosing")}</td>
                <td className="border border-gray-900 p-2" />
                <td className="border border-gray-900 p-1 text-right">{renderInputCell("lnpiClosing")}</td>
              </tr>
              <tr className="bg-cyan-200 font-black">
                <td className="border border-gray-900 p-2">SP/Kg</td>
                <td className="border border-gray-900 p-2 text-right">{formatDecimal(report.spPerKg)}</td>
                <td className="border border-gray-900 p-2" colSpan={2} />
              </tr>
              <tr className="bg-cyan-200 font-black">
                <td className="border border-gray-900 p-2">Paper Cost</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(report.paperCost)}</td>
                <td className="border border-gray-900 p-2" colSpan={2} />
              </tr>
              <tr className="bg-cyan-200 font-black">
                <td className="border border-gray-900 p-2">Paper %</td>
                <td className="border border-gray-900 p-2 text-right">{formatDecimal(report.paperPercent)}%</td>
                <td className="border border-gray-900 p-2" colSpan={2} />
              </tr>
              {[
                ["Factory Conversion Cost", report.totalPayable],
                ["HO Salary", inputs.hoSalary],
                ["Management Salary", inputs.managementSalary],
                ["All EMI", inputs.allEmi],
                ["Donation, Fastags, Misc. Exp", inputs.miscExpense],
              ].map(([label, amount]) => (
                <tr key={String(label)} className="bg-red-100 font-black">
                  <td className="border border-gray-900 p-2">{label}</td>
                  <td className="border border-gray-900 p-2 text-right">{formatMoney(Number(amount))}</td>
                  <td className="border border-gray-900 p-2 text-right text-blue-700" colSpan={2}>
                    {formatDecimal(report.expensePerKg(Number(amount)))}
                  </td>
                </tr>
              ))}
              <tr className="bg-red-500 font-black text-white">
                <td className="border border-gray-900 p-2">RESULT</td>
                <td className="border border-gray-900 p-2 text-center">LOSS</td>
                <td className="border border-gray-900 p-2 text-right" colSpan={2}>
                  {formatDecimal(report.result)}
                </td>
              </tr>
              <tr className="bg-yellow-300 font-black text-red-700">
                <td className="border border-gray-900 p-2">Loss Amount</td>
                <td className="border border-gray-900 p-2 text-right" colSpan={3}>
                  {formatMoney(report.lossAmount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
