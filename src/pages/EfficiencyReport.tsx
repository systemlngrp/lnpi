import React, { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { Machine, ProductionProcessing, User } from "../types";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { formatDate } from "../lib/serial";

type ViewMode = "detailed" | "machineDaily" | "operatorMachineDaily";
type Shift = "Day" | "Night";

type EfficiencyRow = {
  id: string;
  date: string;
  jobNo: string;
  machineId: string;
  machineName: string;
  shift: Shift;
  operatorId: string;
  operatorName: string;
  qty: number;
  maxOutputPerHour: number;
  shiftHours: number;
  expectedQty: number;
  efficiencyPercent: number | null;
};

function safePercent(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function EfficiencyReport() {
  const [machines] = useData<Machine>("machines", []);
  const [users] = useData<User>("users", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);

  const [viewMode, setViewMode] = useState<ViewMode>("machineDaily");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [machineId, setMachineId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [shift, setShift] = useState<"" | Shift>("");
  const [dayShiftHoursInput, setDayShiftHoursInput] = useState("12");
  const [nightShiftHoursInput, setNightShiftHoursInput] = useState("12");

  const dayShiftHours = useMemo(() => {
    const value = Number(dayShiftHoursInput);
    return Number.isFinite(value) && value > 0 ? value : 12;
  }, [dayShiftHoursInput]);

  const nightShiftHours = useMemo(() => {
    const value = Number(nightShiftHoursInput);
    return Number.isFinite(value) && value > 0 ? value : 12;
  }, [nightShiftHoursInput]);

  const shiftHoursFor = (value: Shift) => (value === "Night" ? nightShiftHours : dayShiftHours);

  const rows = useMemo<EfficiencyRow[]>(() => {
    const machineMap = new Map(machines.map((machine) => [machine.id, machine]));
    const operatorMap = new Map(users.map((user) => [user.id, user]));

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo).getTime() : null;

    const base = processing
      .filter((entry) => {
        if (machineId && entry.machineId !== machineId) return false;
        if (operatorId && entry.operatorId !== operatorId) return false;
        if (shift && String(entry.shift || "Day") !== shift) return false;
        if (fromMs != null && new Date(entry.date).getTime() < fromMs) return false;
        if (toMs != null && new Date(entry.date).getTime() > toMs) return false;
        if (!normalizedSearch) return true;
        const job = String(entry.jobNo || "").toLowerCase();
        const machine = String(entry.machineName || "").toLowerCase();
        const operator = String(entry.operatorName || "").toLowerCase();
        return job.includes(normalizedSearch) || machine.includes(normalizedSearch) || operator.includes(normalizedSearch);
      })
      .map((entry) => {
        const machine = machineMap.get(entry.machineId);
        const operator = operatorMap.get(entry.operatorId);
        const maxOutputPerHour = Number(machine?.maxOutputPerHour || 0);
        const entryShift = (entry.shift || "Day") as Shift;
        const shiftHours = shiftHoursFor(entryShift);
        const expectedQty = maxOutputPerHour * shiftHours;
        return {
          id: entry.id,
          date: entry.date,
          jobNo: String(entry.jobNo || ""),
          machineId: entry.machineId,
          machineName: normalizeMachineName(entry.machineName || machine?.name || ""),
          shift: entryShift,
          operatorId: entry.operatorId,
          operatorName: operator?.name || entry.operatorName || "-",
          qty: Number(entry.qty || 0),
          maxOutputPerHour,
          shiftHours,
          expectedQty: Number(expectedQty.toFixed(2)),
          efficiencyPercent: safePercent(Number(entry.qty || 0), expectedQty),
        } satisfies EfficiencyRow;
      });

    if (viewMode === "detailed") {
      return [...base].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const grouped = new Map<string, EfficiencyRow & { operatorNames: Set<string>; jobNos: Set<string> }>();
    for (const entry of base) {
      const key =
        viewMode === "operatorMachineDaily"
          ? `${entry.date}__${entry.operatorId}__${entry.machineId}__${entry.shift}`
          : `${entry.date}__${entry.machineId}__${entry.shift}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          ...entry,
          id: key,
          jobNo: entry.jobNo ? entry.jobNo : "-",
          operatorName: entry.operatorName || "-",
          operatorNames: new Set(entry.operatorName ? [entry.operatorName] : []),
          jobNos: new Set(entry.jobNo ? [entry.jobNo] : []),
        });
        continue;
      }

      current.qty += entry.qty;
      current.jobNos.add(entry.jobNo);
      current.operatorNames.add(entry.operatorName);
      current.jobNo = current.jobNos.size <= 1 ? [...current.jobNos][0] : `${current.jobNos.size} jobs`;
      current.operatorName =
        current.operatorNames.size <= 1 ? [...current.operatorNames][0] : `${current.operatorNames.size} operators`;
    }

    const finalized = [...grouped.values()].map((entry) => {
      const shiftHours = shiftHoursFor(entry.shift);
      const expectedQty = entry.maxOutputPerHour * shiftHours;
      return {
        ...entry,
        shiftHours,
        qty: Number(entry.qty.toFixed(2)),
        expectedQty: Number(expectedQty.toFixed(2)),
        efficiencyPercent: safePercent(entry.qty, expectedQty),
      };
    });

    return finalized.sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      if (viewMode === "operatorMachineDaily") {
        const operatorDiff = a.operatorName.localeCompare(b.operatorName);
        if (operatorDiff !== 0) return operatorDiff;
      }
      const machineDiff = a.machineName.localeCompare(b.machineName);
      if (machineDiff !== 0) return machineDiff;
      return a.shift.localeCompare(b.shift);
    });
  }, [
    dateFrom,
    dateTo,
    dayShiftHours,
    machineId,
    machines,
    nightShiftHours,
    operatorId,
    processing,
    searchTerm,
    shift,
    users,
    viewMode,
  ]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.qty += row.qty;
        acc.expected += row.expectedQty;
        return acc;
      },
      { qty: 0, expected: 0 }
    );
  }, [rows]);

  const overallEfficiency = safePercent(summary.qty, summary.expected);

  const handleClear = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setMachineId("");
    setOperatorId("");
    setShift("");
    setDayShiftHoursInput("12");
    setNightShiftHoursInput("12");
    setViewMode("machineDaily");
  };

  const machineOptions = useMemo(() => {
    return [...machines]
      .sort((a, b) => normalizeMachineName(a.name).localeCompare(normalizeMachineName(b.name)))
      .map((machine) => ({ value: machine.id, label: normalizeMachineName(machine.name) }));
  }, [machines]);

  const operatorOptions = useMemo(() => {
    return [...users].sort((a, b) => a.name.localeCompare(b.name)).map((user) => ({ value: user.id, label: user.name }));
  }, [users]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
              <Filter size={14} />
              Reports
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-slate-900">Efficiency Report</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Downloads removed (only shown in Delivery Book) */}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-12">
          <div className="flex h-[52px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-4">
            <Search size={16} className="text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search job, machine, operator..."
              className="ml-3 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-2">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">From</div>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm font-semibold text-slate-800 outline-none"
            />
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-2">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">To</div>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm font-semibold text-slate-800 outline-none"
            />
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-2">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 whitespace-nowrap">Day hrs</div>
            <input
              type="number"
              value={dayShiftHoursInput}
              onChange={(e) => setDayShiftHoursInput(e.target.value)}
              className="w-20 text-right text-sm font-semibold text-slate-800 outline-none"
              min={0}
              step={0.5}
            />
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-2">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 whitespace-nowrap">Night hrs</div>
            <input
              type="number"
              value={nightShiftHoursInput}
              onChange={(e) => setNightShiftHoursInput(e.target.value)}
              className="w-20 text-right text-sm font-semibold text-slate-800 outline-none"
              min={0}
              step={0.5}
            />
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-3">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">View</div>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="text-sm font-semibold text-slate-800 outline-none"
            >
              <option value="machineDaily">Daily by machine+shift</option>
              <option value="operatorMachineDaily">Daily by operator+machine+shift</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm xl:col-span-3">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Shift</div>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value as "" | Shift)}
              className="text-sm font-semibold text-slate-800 outline-none"
            >
              <option value="">All</option>
              <option value="Day">Day</option>
              <option value="Night">Night</option>
            </select>
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm md:col-span-1 xl:col-span-2">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Machine</div>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="max-w-[220px] truncate text-right text-sm font-semibold text-slate-800 outline-none"
            >
              <option value="">All</option>
              {machineOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm md:col-span-1 xl:col-span-2">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Operator</div>
            <select
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              className="max-w-[220px] truncate text-right text-sm font-semibold text-slate-800 outline-none"
            >
              <option value="">All</option>
              {operatorOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 md:col-span-2 xl:col-span-2">
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex h-[52px] w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-slate-900">{rows.length} rows</div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Overall efficiency: {overallEfficiency == null ? "-" : `${overallEfficiency.toFixed(2)}%`}
              </div>
            </div>
            <div className="flex gap-4 text-right text-sm font-semibold text-slate-700">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Total Qty</div>
                <div className="text-slate-900">{summary.qty.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Expected Qty</div>
                <div className="text-slate-900">{summary.expected.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-teal-950 text-white">
                {["Date", "Job No.", "Machine", "Shift", "Operator", "Qty", "Max/Hr", "Expected", "Eff%"].map((label) => (
                  <th
                    key={label}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.16em]"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    No matching records.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {formatDate(row.date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-bold text-slate-900">{row.jobNo || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">{row.machineName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-bold text-slate-900">{row.shift}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">{row.operatorName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold text-teal-700">
                      {row.qty.toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-slate-900">
                      {row.maxOutputPerHour.toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-slate-900">
                      {row.expectedQty.toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold text-slate-900">
                      {row.efficiencyPercent == null ? "-" : `${row.efficiencyPercent.toFixed(2)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
