import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
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

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
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
  const shiftHoursFor = (_value: Shift) => 12;

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
    machineId,
    machines,
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

  const viewModeOptions = [
    { value: "machineDaily", label: "Daily by machine+shift" },
    { value: "operatorMachineDaily", label: "Daily by operator+machine+shift" },
    { value: "detailed", label: "Detailed" },
  ];

  const shiftOptions = [
    { value: "Day", label: "Day" },
    { value: "Night", label: "Night" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-black pb-3">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Efficiency Report</h2>
          <p className="text-sm text-slate-600 font-medium">Shift based output against machine hourly target</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Overall Efficiency</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">
            {overallEfficiency == null ? "-" : `${formatQty(overallEfficiency)}%`}
          </div>
        </div>
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Qty</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{formatQty(summary.qty)}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Expected Qty</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{formatQty(summary.expected)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Rows</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{rows.length}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-[1_1_300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search job, machine, operator..."
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="min-w-[140px] flex-[0_1_160px] rounded border-2 border-black px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="min-w-[140px] flex-[0_1_160px] rounded border-2 border-black px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          <div className="min-w-[210px] flex-[1_1_220px]"><Select value={viewMode} onChange={(value) => setViewMode(value as ViewMode)} options={viewModeOptions} placeholder="View" /></div>
          <div className="min-w-[150px] flex-[1_1_160px]"><Select value={shift} onChange={(value) => setShift(value as "" | Shift)} options={shiftOptions} placeholder="All Shift" /></div>
          <div className="min-w-[180px] flex-[1_1_200px]"><Select value={machineId} onChange={setMachineId} options={machineOptions} placeholder="All Machine" /></div>
          <div className="min-w-[180px] flex-[1_1_200px]"><Select value={operatorId} onChange={setOperatorId} options={operatorOptions} placeholder="All Operator" /></div>
          <button
            type="button"
            onClick={handleClear}
            className="min-w-[120px] rounded border border-black bg-white px-3 py-2.5 text-sm font-bold text-black hover:bg-slate-50"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border-2 border-black overflow-hidden">
        <div className="flex flex-col gap-1 border-b-2 border-black px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-bold text-black">{rows.length} rows</div>
          <div className="text-xs font-black uppercase tracking-wide text-indigo-700">
            {viewMode === "machineDaily" ? "Machine + shift daily" : viewMode === "operatorMachineDaily" ? "Operator + machine + shift daily" : "Detailed"}
          </div>
        </div>

        <div className="max-h-[calc(100vh-260px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                <th className="min-w-[110px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">Date</th>
                <th className="min-w-[130px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">Job No.</th>
                <th className="min-w-[150px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">Machine</th>
                <th className="min-w-[80px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">Shift</th>
                <th className="min-w-[140px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">Operator</th>
                <th className="min-w-[95px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-right text-xs font-black uppercase">Qty</th>
                <th className="min-w-[95px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-right text-xs font-black uppercase">Max/Hr</th>
                <th className="min-w-[105px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-right text-xs font-black uppercase">Expected</th>
                <th className="min-w-[90px] whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-right text-xs font-black uppercase">Eff%</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="border-2 border-black px-6 py-10 text-center text-sm font-semibold text-black">
                    No matching records.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm font-semibold text-black">
                      {formatDate(row.date)}
                    </td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm font-bold text-black">{row.jobNo || "-"}</td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm font-semibold text-black">{row.machineName}</td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm font-bold text-black">{row.shift}</td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm font-semibold text-black">{row.operatorName}</td>
                    <td className="whitespace-nowrap border-2 border-black bg-emerald-50 px-3 py-3 text-right text-sm font-bold text-emerald-900">
                      {formatQty(row.qty)}
                    </td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-right text-sm font-semibold text-black">
                      {formatQty(row.maxOutputPerHour)}
                    </td>
                    <td className="whitespace-nowrap border-2 border-black bg-purple-50 px-3 py-3 text-right text-sm font-bold text-purple-900">
                      {formatQty(row.expectedQty)}
                    </td>
                    <td className="whitespace-nowrap border-2 border-black bg-amber-50 px-3 py-3 text-right text-sm font-bold text-amber-900">
                      {row.efficiencyPercent == null ? "-" : `${formatQty(row.efficiencyPercent)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="bg-slate-100">
                  <td colSpan={5} className="border-2 border-black px-3 py-3 text-right text-xs font-black uppercase tracking-wide text-black">
                    Totals
                  </td>
                  <td className="whitespace-nowrap border-2 border-black bg-emerald-100 px-3 py-3 text-right text-sm font-black text-emerald-900">
                    {formatQty(summary.qty)}
                  </td>
                  <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-right text-sm font-black text-black">
                    -
                  </td>
                  <td className="whitespace-nowrap border-2 border-black bg-purple-100 px-3 py-3 text-right text-sm font-black text-purple-900">
                    {formatQty(summary.expected)}
                  </td>
                  <td className="whitespace-nowrap border-2 border-black bg-amber-100 px-3 py-3 text-right text-sm font-black text-amber-900">
                    {overallEfficiency == null ? "-" : `${formatQty(overallEfficiency)}%`}
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
