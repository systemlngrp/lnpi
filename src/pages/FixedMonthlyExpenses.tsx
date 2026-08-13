import React, { useEffect, useMemo, useState } from "react";
import { Edit, Eye, RotateCcw, Save } from "lucide-react";
import { useData } from "../hooks/useData";
import type { ExpenseMaster, FixedMonthlyExpense, FixedMonthlyExpenseLine } from "../types";
import { FY_MONTHS, getCurrentFinancialYear, getFinancialYearOptions, getMonthName } from "../lib/financialYear";

function newLine(expenseName = "", amount = 0): FixedMonthlyExpenseLine {
  return { id: crypto.randomUUID(), expenseName, amount };
}

function normalizeLines(value: FixedMonthlyExpense["lines"] | string | undefined): FixedMonthlyExpenseLine[] {
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

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FixedMonthlyExpenses() {
  const [records, setRecords] = useData<FixedMonthlyExpense>("fixed_monthly_expenses", []);
  const [expenseMasters] = useData<ExpenseMaster>("expense_masters", []);
  const [fy, setFy] = useState(getCurrentFinancialYear());
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [lines, setLines] = useState<FixedMonthlyExpenseLine[]>([]);
  const [viewRecord, setViewRecord] = useState<(FixedMonthlyExpense & { lines: FixedMonthlyExpenseLine[] }) | null>(null);

  const normalizedRecords = useMemo(
    () => records.map((record) => ({ ...record, lines: normalizeLines(record.lines) })),
    [records]
  );

  const fyOptions = useMemo(
    () => getFinancialYearOptions(normalizedRecords.map((record) => record.fy)),
    [normalizedRecords]
  );

  const expenseOptions = useMemo(() => {
    const names = new Map<string, string>();
    expenseMasters
      .filter((expense) => (expense.type || "Monthly") === "Monthly")
      .forEach((expense) => {
        const name = String(expense.name || "").trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!names.has(key)) names.set(key, name);
      });

    return Array.from(names.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [expenseMasters]);

  const totalAmount = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
    [lines]
  );

  const savedRows = useMemo(() => {
    const monthOrder = new Map(FY_MONTHS.map((entry, index) => [entry.value, index]));
    return normalizedRecords
      .slice()
      .sort((a, b) => b.fy.localeCompare(a.fy) || (monthOrder.get(Number(a.month)) || 0) - (monthOrder.get(Number(b.month)) || 0));
  }, [normalizedRecords]);

  const viewLines = viewRecord ? normalizeLines(viewRecord.lines) : [];
  const viewTotalAmount = viewLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const buildMonthlyLines = (sourceLines: FixedMonthlyExpenseLine[] = []) => {
    const amountByExpense = new Map(sourceLines.map((line) => [line.expenseName.trim().toLowerCase(), Number(line.amount || 0)]));
    return expenseOptions.map((expenseName) => newLine(expenseName, amountByExpense.get(expenseName.toLowerCase()) || 0));
  };

  useEffect(() => {
    const existing = normalizedRecords.find((record) => record.fy === fy && Number(record.month) === Number(month));
    setLines((current) => buildMonthlyLines(existing ? normalizeLines(existing.lines) : current));
  }, [expenseOptions, fy, month, normalizedRecords]);

  const resetForm = () => {
    setFy(getCurrentFinancialYear());
    setMonth(String(new Date().getMonth() + 1));
    setLines(buildMonthlyLines());
  };

  const loadRecord = (record: FixedMonthlyExpense) => {
    setFy(record.fy);
    setMonth(String(record.month));
    setLines(buildMonthlyLines(normalizeLines(record.lines)));
  };

  const updateLine = (id: string, patch: Partial<FixedMonthlyExpenseLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const handleSave = async () => {
    const monthNumber = Number(month);
    const cleanLines = lines
      .map((line) => ({
        ...line,
        expenseName: line.expenseName.trim(),
        amount: Number(line.amount || 0),
      }))
      .filter((line) => line.expenseName || line.amount > 0);

    if (!fy || !monthNumber) {
      alert("Please select FY and Month.");
      return;
    }
    if (!cleanLines.length) {
      alert("Please add at least one expense line.");
      return;
    }

    const existing = normalizedRecords.find((record) => record.fy === fy && Number(record.month) === monthNumber);
    const nextRecord: FixedMonthlyExpense = {
      id: existing?.id || crypto.randomUUID(),
      fy,
      month: monthNumber,
      monthName: getMonthName(monthNumber),
      lines: cleanLines,
      totalAmount: cleanLines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString(),
    };

    await setRecords((current) => {
      const exists = current.some((record) => record.id === nextRecord.id);
      return exists ? current.map((record) => (record.id === nextRecord.id ? nextRecord : record)) : [nextRecord, ...current];
    });
    alert("Fixed monthly expenses saved.");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-900 pb-3">
        <h1 className="text-2xl font-black uppercase tracking-tight">Fixed Monthly Expenses</h1>
        <div className="text-right">
          <p className="text-xs font-bold uppercase text-slate-500">Total Amount</p>
          <p className="text-2xl font-black text-blue-700">{formatMoney(totalAmount)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-900 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">
            FY
            <select className="mt-1 w-full rounded border border-gray-900 p-2" value={fy} onChange={(event) => setFy(event.target.value)}>
              {fyOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            Month
            <select className="mt-1 w-full rounded border border-gray-900 p-2" value={month} onChange={(event) => setMonth(event.target.value)}>
              {FY_MONTHS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-gray-900 p-2 text-left">Expenses</th>
                <th className="border border-gray-900 p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="border border-gray-900 p-2 font-bold text-black">{line.expenseName || "-"}</td>
                  <td className="border border-gray-900 p-2">
                    <input
                      className="w-full rounded border border-slate-300 p-2 text-right"
                      type="number"
                      min="0"
                      step="0.01"
                      value={Number(line.amount || 0) > 0 ? line.amount : ""}
                      onChange={(event) => updateLine(line.id, { amount: Number(event.target.value || 0) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-black">
                <td className="border border-gray-900 p-2 text-right">Total</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white" type="button" onClick={handleSave}>
            <Save size={16} /> Save
          </button>
          <button className="inline-flex items-center gap-2 rounded border border-gray-900 px-4 py-2 text-sm font-bold" type="button" onClick={resetForm}>
            <RotateCcw size={16} /> Clear
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-900 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-gray-900 p-2 text-left">FY</th>
              <th className="border border-gray-900 p-2 text-left">Month</th>
              <th className="border border-gray-900 p-2 text-left">Expenses</th>
              <th className="border border-gray-900 p-2 text-right">Total Amount</th>
              <th className="border border-gray-900 p-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {savedRows.map((record) => (
              <tr key={record.id}>
                <td className="border border-gray-900 p-2 font-bold">{record.fy}</td>
                <td className="border border-gray-900 p-2">{record.monthName || getMonthName(Number(record.month))}</td>
                <td className="border border-gray-900 p-2">{normalizeLines(record.lines).map((line) => line.expenseName).join(", ") || "-"}</td>
                <td className="border border-gray-900 p-2 text-right font-bold">{formatMoney(Number(record.totalAmount || 0))}</td>
                <td className="border border-gray-900 p-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button className="inline-flex items-center gap-2 rounded border border-gray-900 px-3 py-1.5 text-xs font-bold" type="button" onClick={() => setViewRecord(record)} title="View details">
                      <Eye size={14} /> View
                    </button>
                    <button className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white" type="button" onClick={() => loadRecord(record)}>
                      <Edit size={14} /> Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!savedRows.length && (
              <tr>
                <td className="border border-gray-900 p-4 text-center text-slate-500" colSpan={5}>
                  No fixed monthly expenses saved.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {viewRecord ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setViewRecord(null)}>
          <div className="w-full max-w-2xl rounded border-2 border-gray-900 bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-900 px-5 py-4">
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">Fixed Monthly Expenses</h3>
                <p className="mt-1 text-sm font-bold text-slate-600">
                  FY: {viewRecord.fy} | Month: {viewRecord.monthName || getMonthName(Number(viewRecord.month))}
                </p>
              </div>
              <button className="rounded border border-gray-900 px-3 py-1.5 text-sm font-bold hover:bg-slate-100" type="button" onClick={() => setViewRecord(null)}>
                Close
              </button>
            </div>
            <div className="p-5">
              <div className="overflow-hidden rounded border border-gray-900 bg-white">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="w-20 border border-gray-900 p-2 text-left">Sl No</th>
                      <th className="border border-gray-900 p-2 text-left">Expense</th>
                      <th className="w-40 border border-gray-900 p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewLines.map((line, index) => (
                      <tr key={line.id || `${line.expenseName}-${index}`}>
                        <td className="border border-gray-900 p-2 font-bold">{index + 1}</td>
                        <td className="border border-gray-900 p-2">{line.expenseName || "-"}</td>
                        <td className="border border-gray-900 p-2 text-right font-bold">{formatMoney(Number(line.amount || 0))}</td>
                      </tr>
                    ))}
                    {!viewLines.length && (
                      <tr>
                        <td className="border border-gray-900 p-4 text-center text-slate-500" colSpan={3}>
                          No expenses found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-black">
                      <td className="border border-gray-900 p-2 text-right" colSpan={2}>
                        Total
                      </td>
                      <td className="border border-gray-900 p-2 text-right">{formatMoney(Number(viewRecord.totalAmount || 0) || viewTotalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
