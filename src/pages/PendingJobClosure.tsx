import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TableControls } from "../components/TableControls";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";

type PendingJobClosureRow = {
  productionId: string;
  jobNo: string;
  orderNo?: string;
  itemName?: string;
  companyName?: string;
  typeName?: string;
  planQty: number;
  planDate?: string;
  blockingReasons: string[];
  missingSteps: { stepKey: string; machineName: string; machineId?: string }[];
  missingFields: { stepKey: string; machineName: string; machineId?: string; fields: string[] }[];
  qtyStatus: { planQty: number; processedQty: number; exceededBy: number };
  groupMachineName: string;
  groupMachineId?: string;
};

export function PendingJobClosure() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PendingJobClosureRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/get-pending-job-closure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as PendingJobClosureRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError((err as Error).message || "Failed to load pending job closure list.");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const haystack = [
        r.groupMachineName,
        r.jobNo,
        r.orderNo,
        r.companyName,
        r.itemName,
        r.typeName,
        ...(r.blockingReasons || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, searchTerm]);

  const grouped = useMemo(() => {
    const map = new Map<string, PendingJobClosureRow[]>();
    filtered.forEach((row) => {
      const key = row.groupMachineName || "Unassigned";
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const toggleExpanded = (productionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productionId)) next.delete(productionId);
      else next.add(productionId);
      return next;
    });
  };

  const getDeepLink = (row: PendingJobClosureRow) => {
    const target =
      row.missingSteps?.[0] ||
      (row.missingFields?.[0]
        ? { machineId: row.missingFields[0].machineId, machineName: row.missingFields[0].machineName }
        : null);
    const params = new URLSearchParams({ productionId: row.productionId });
    if (target?.machineId) params.set("machineId", target.machineId);
    return `/production-processing/form?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Job Closure</h2>
          <div className="text-xs text-slate-600">Jobs blocked from closure with reasons and actions.</div>
        </div>
        <button
          onClick={() => void load()}
          className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition"
          disabled={isLoading}
        >
          {isLoading ? <Spinner size={18} className="text-white" /> : "Refresh"}
        </button>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search jobs, machines, reasons..." />

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded font-medium">{error}</div>
      ) : null}

      <div className="space-y-4">
        {isLoading && rows.length === 0 ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : grouped.length === 0 ? (
          <div className="bg-white border border-black p-6 text-center font-medium text-slate-600">No pending job closures.</div>
        ) : (
          grouped.map(([machineGroup, groupRows]) => (
            <div key={machineGroup} className="bg-white border border-black rounded shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-slate-100 border-b border-black font-bold uppercase text-xs tracking-wider flex justify-between">
                <div>Machine: {machineGroup}</div>
                <div className="text-slate-600">Jobs: {groupRows.length}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="bg-white">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase">Job No</th>
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase">Company</th>
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase">Item</th>
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase">Type</th>
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase">Plan Date</th>
                      <th className="px-4 py-2 text-right text-[10px] font-bold uppercase">Plan Qty</th>
                      <th className="px-4 py-2 text-left text-[10px] font-bold uppercase">Blocked</th>
                      <th className="px-4 py-2 text-right text-[10px] font-bold uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {groupRows.map((row) => {
                      const isOpen = expanded.has(row.productionId);
                      return (
                        <React.Fragment key={row.productionId}>
                          <tr className="divide-x divide-black hover:bg-slate-50">
                            <td className="px-4 py-2 text-sm font-bold">{row.jobNo}</td>
                            <td className="px-4 py-2 text-sm">{row.companyName || "-"}</td>
                            <td className="px-4 py-2 text-sm">{row.itemName || "-"}</td>
                            <td className="px-4 py-2 text-sm">{row.typeName || "-"}</td>
                            <td className="px-4 py-2 text-sm">{formatDate(row.planDate || "") || "-"}</td>
                            <td className="px-4 py-2 text-sm text-right font-bold">{Number(row.planQty || 0).toLocaleString()}</td>
                            <td className="px-4 py-2 text-xs">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(row.productionId)}
                                className="underline font-bold text-indigo-700"
                              >
                                {row.blockingReasons?.length || 0} reason(s)
                              </button>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => navigate(getDeepLink(row))}
                                className="bg-indigo-600 text-white px-3 py-1 rounded border border-black text-xs font-bold hover:bg-indigo-700 transition"
                              >
                                Open Processing
                              </button>
                            </td>
                          </tr>
                          {isOpen ? (
                            <tr>
                              <td colSpan={8} className="px-4 py-3 bg-slate-50 border-t border-black">
                                <div className="space-y-2">
                                  <div className="text-xs font-bold uppercase text-slate-600">Blocking Reasons</div>
                                  <ul className="list-disc pl-5 text-sm text-slate-900 space-y-1">
                                    {(row.blockingReasons || []).map((r, idx) => (
                                      <li key={idx}>{r}</li>
                                    ))}
                                  </ul>
                                  {row.missingSteps?.length ? (
                                    <div className="text-xs text-slate-700">
                                      <span className="font-bold">Missing Steps:</span>{" "}
                                      {row.missingSteps.map((s) => s.machineName).join(", ")}
                                    </div>
                                  ) : null}
                                  {row.missingFields?.length ? (
                                    <div className="text-xs text-slate-700">
                                      <span className="font-bold">Missing Fields:</span>{" "}
                                      {row.missingFields
                                        .map((s) => `${s.machineName} (${(s.fields || []).join(", ")})`)
                                        .join(" | ")}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

