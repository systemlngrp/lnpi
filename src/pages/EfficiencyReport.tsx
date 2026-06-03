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
    const machineByNormalizedName = new Map(
      machines.map((machine) => [normalizeMachineName(machine.name).toLowerCase(), machine])
    );
    const operatorMap = new Map(users.map((user) => [user.id, user]));
    const operatorByNormalizedName = new Map(users.map((user) => [String(user.name || "").trim().toLowerCase(), user]));

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(dateTo).getTime() : null;

    const base = processing
      .map((entry) => {
        const normalizedMachine = normalizeMachineName(entry.machineName || "").trim();
        const machine =
          machineMap.get(entry.machineId) ||
          machineByNormalizedName.get(normalizedMachine.toLowerCase());
        const normalizedOperatorName = String(entry.operatorName || "").trim();
        const operator =
          operatorMap.get(entry.operatorId) ||
          operatorByNormalizedName.get(normalizedOperatorName.toLowerCase());
        const resolvedMachineId = machine?.id || entry.machineId || normalizedMachine;
        const resolvedOperatorId = operator?.id || entry.operatorId || normalizedOperatorName || "-";
        const maxOutputPerHour = Number(machine?.maxOutputPerHour || 0);
        const entryShift = (entry.shift || "Day") as Shift;
        const shiftHours = shiftHoursFor(entryShift);
        const expectedQty = maxOutputPerHour * shiftHours;
        return {
          id: entry.id,
          date: entry.date,
          jobNo: String(entry.jobNo || ""),
          machineId: resolvedMachineId,
          machineName: normalizedMachine || normalizeMachineName(machine?.name || "") || "-",
          shift: entryShift,
          operatorId: resolvedOperatorId,
          operatorName: operator?.name || normalizedOperatorName || "-",
          qty: Number(entry.qty || 0),
          maxOutputPerHour,
          shiftHours,
          expectedQty: Number(expectedQty.toFixed(2)),
          efficiencyPercent: safePercent(Number(entry.qty || 0), expectedQty),
        } satisfies EfficiencyRow;
      })
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
      });

    if (viewMode === "detailed") {
      return [...base].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const grouped = new Map<string, EfficiencyRow & { operatorNames: Set<string>; jobNos: Set<string> }>();
    for (const entry of base) {
      const key =
        viewMode === "operatorMachineDaily"
          ? `${entry.date}__${entry.operatorId || entry.operatorName}__${entry.machineId || entry.machineName}__${entry.shift}`
          : `${entry.date}__${entry.machineId || entry.machineName}__${entry.shift}`;
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
      <div className="overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-[0_18px_45px_-28px_rgba(15,23,42,0.24)]">
        <div className="relative px-4 py-4 md:px-5 md:py-5">
          <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.12),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_38%),linear-gradient(180deg,_rgba(248,250,252,0.9),_rgba(255,255,255,0))]" />
          <div className="relative flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">
                <Filter size={14} />
                Reports
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-950 md:text-[1.75rem]">Efficiency Report</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                  Shift based
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                  Machine view
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600">
                  Operator view
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[390px]">
              <div className="rounded-[18px] border border-teal-200 bg-[linear-gradient(135deg,rgba(240,253,250,1),rgba(236,254,255,0.86))] px-3 py-2.5 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">Overall Efficiency</div>
                <div className="mt-1.5 text-[2rem] font-black tracking-tight leading-none text-teal-950">
                  {overallEfficiency == null ? "-" : `${overallEfficiency.toFixed(2)}%`}
                </div>
                <div className="mt-1 text-[11px] font-semibold text-teal-700">Current filtered output</div>
              </div>
              <div className="rounded-[18px] border border-sky-200 bg-[linear-gradient(135deg,rgba(239,246,255,1),rgba(240,249,255,0.9))] px-3 py-2.5 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">Total Qty</div>
                <div className="mt-1.5 text-[2rem] font-black tracking-tight leading-none text-sky-950">{summary.qty.toFixed(2)}</div>
                <div className="mt-1 text-[11px] font-semibold text-sky-700">Reported quantity</div>
              </div>
              <div className="rounded-[18px] border border-violet-200 bg-[linear-gradient(135deg,rgba(245,243,255,1),rgba(250,245,255,0.92))] px-3 py-2.5 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">Expected Qty</div>
                <div className="mt-1.5 text-[2rem] font-black tracking-tight leading-none text-violet-950">{summary.expected.toFixed(2)}</div>
                <div className="mt-1 text-[11px] font-semibold text-violet-700">Shift based target</div>
              </div>
            </div>
          </div>

          <div className="relative mt-4 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.86),rgba(255,255,255,1))] p-3 md:p-4">
            <div className="mb-3 flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Filter Console</div>
                <div className="mt-1 text-xs font-semibold text-slate-700">Date, view, shift, machine, and operator filters.</div>
              </div>
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-100"
              >
                Clear Filters
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
              <label className="space-y-2 xl:col-span-4">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <Search size={14} />
                  Search
                </span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100">
                  <Search size={16} className="text-teal-500" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search job, machine, operator..."
                    className="ml-3 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
              </label>

              <label className="space-y-2 xl:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">From</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  />
                </div>
              </label>

              <label className="space-y-2 xl:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">To</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100">
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  />
                </div>
              </label>

              <label className="space-y-2 xl:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 whitespace-nowrap">Day hrs</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100">
                  <input
                    type="number"
                    value={dayShiftHoursInput}
                    onChange={(e) => setDayShiftHoursInput(e.target.value)}
                    className="w-full bg-transparent text-right text-sm font-semibold text-slate-800 outline-none"
                    min={0}
                    step={0.5}
                  />
                </div>
              </label>

              <label className="space-y-2 xl:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 whitespace-nowrap">Night hrs</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm transition focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100">
                  <input
                    type="number"
                    value={nightShiftHoursInput}
                    onChange={(e) => setNightShiftHoursInput(e.target.value)}
                    className="w-full bg-transparent text-right text-sm font-semibold text-slate-800 outline-none"
                    min={0}
                    step={0.5}
                  />
                </div>
              </label>

              <label className="space-y-2 xl:col-span-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">View</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
                  <select
                    value={viewMode}
                    onChange={(e) => setViewMode(e.target.value as ViewMode)}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="machineDaily">Daily by machine+shift</option>
                    <option value="operatorMachineDaily">Daily by operator+machine+shift</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </div>
              </label>

              <label className="space-y-2 xl:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Shift</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value as "" | Shift)}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="">All</option>
                    <option value="Day">Day</option>
                    <option value="Night">Night</option>
                  </select>
                </div>
              </label>

              <label className="space-y-2 xl:col-span-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Machine</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
                  <select
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="">All</option>
                    {machineOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="space-y-2 xl:col-span-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Operator</span>
                <div className="flex h-[48px] items-center rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
                  <select
                    value={operatorId}
                    onChange={(e) => setOperatorId(e.target.value)}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="">All</option>
                    {operatorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_14px_34px_-26px_rgba(15,23,42,0.28)]">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">{rows.length} rows</div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Efficiency view: {viewMode === "machineDaily" ? "Machine + shift daily" : viewMode === "operatorMachineDaily" ? "Operator + machine + shift daily" : "Detailed"}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-right text-sm font-semibold text-slate-700 md:min-w-[320px]">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Overall Eff%</div>
              <div className="text-slate-900">{overallEfficiency == null ? "-" : overallEfficiency.toFixed(2)}</div>
            </div>
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

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-[linear-gradient(90deg,#042f2e,#0f766e,#134e4a)] text-white">
                <th className="min-w-[110px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em]">Date</th>
                <th className="min-w-[130px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em]">Job No.</th>
                <th className="min-w-[150px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em]">Machine</th>
                <th className="min-w-[80px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em]">Shift</th>
                <th className="min-w-[140px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em]">Operator</th>
                <th className="min-w-[95px] whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.16em]">Qty</th>
                <th className="min-w-[95px] whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.16em]">Max/Hr</th>
                <th className="min-w-[105px] whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.16em]">Expected</th>
                <th className="min-w-[90px] whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.16em]">Eff%</th>
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
                  <tr key={row.id} className="border-t border-slate-200 transition hover:bg-teal-50/45">
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
                      {formatDate(row.date)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm font-bold text-slate-900">{row.jobNo || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">{row.machineName}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm font-bold text-slate-900">{row.shift}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">{row.operatorName}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold text-teal-700">
                      {row.qty.toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold text-slate-900">
                      {row.maxOutputPerHour.toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold text-slate-900">
                      {row.expectedQty.toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold text-slate-900">
                      {row.efficiencyPercent == null ? "-" : `${row.efficiencyPercent.toFixed(2)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-black uppercase tracking-[0.16em] text-slate-600">
                    Totals
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-black text-teal-700">
                    {summary.qty.toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold text-slate-900">
                    -
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-black text-slate-900">
                    {summary.expected.toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-black text-slate-900">
                    {overallEfficiency == null ? "-" : `${overallEfficiency.toFixed(2)}%`}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
