import React, { useMemo, useState } from "react";
import { Edit, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import type { FixedMonthlyExpense, FixedMonthlyExpenseLine } from "../types";
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

function defaultLines() {
  return [newLine("Salary"), newLine("Rent")];
}

export function FixedMonthlyExpenses() {
  const [records, setRecords] = useData<FixedMonthlyExpense>("fixed_monthly_expenses", []);
  const [fy, setFy] = useState(getCurrentFinancialYear());
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [lines, setLines] = useState<FixedMonthlyExpenseLine[]>(defaultLines);

  const normalizedRecords = useMemo(
    () => records.map((record) => ({ ...record, lines: normalizeLines(record.lines) })),
    [records]
  );

  const fyOptions = useMemo(
    () => getFinancialYearOptions(normalizedRecords.map((record) => record.fy)),
    [normalizedRecords]
  );

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

  const resetForm = () => {
    setFy(getCurrentFinancialYear());
    setMonth(String(new Date().getMonth() + 1));
    setLines(defaultLines());
  };

  const loadRecord = (record: FixedMonthlyExpense) => {
    setFy(record.fy);
    setMonth(String(record.month));
    const loadedLines = normalizeLines(record.lines);
    setLines(loadedLines.length ? loadedLines : defaultLines());
  };

  const updateLine = (id: string, patch: Partial<FixedMonthlyExpenseLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: string) => {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.id !== id) : current));
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
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-gray-900 p-2 text-left">Expenses</th>
                <th className="border border-gray-900 p-2 text-right">Amount</th>
                <th className="w-20 border border-gray-900 p-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="border border-gray-900 p-2">
                    <input
                      className="w-full rounded border border-slate-300 p-2"
                      value={line.expenseName}
                      onChange={(event) => updateLine(line.id, { expenseName: event.target.value })}
                      placeholder="Expense name"
                    />
                  </td>
                  <td className="border border-gray-900 p-2">
                    <input
                      className="w-full rounded border border-slate-300 p-2 text-right"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.amount}
                      onChange={(event) => updateLine(line.id, { amount: Number(event.target.value || 0) })}
                    />
                  </td>
                  <td className="border border-gray-900 p-2 text-center">
                    <button className="rounded border border-red-500 p-2 text-red-600" type="button" onClick={() => removeLine(line.id)} title="Remove">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-black">
                <td className="border border-gray-900 p-2 text-right">Total</td>
                <td className="border border-gray-900 p-2 text-right">{formatMoney(totalAmount)}</td>
                <td className="border border-gray-900 p-2" />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white" type="button" onClick={() => setLines((current) => [...current, newLine()])}>
            <Plus size={16} /> Add Row
          </button>
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
                  <button className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white" type="button" onClick={() => loadRecord(record)}>
                    <Edit size={14} /> Edit
                  </button>
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
    </div>
  );
}
