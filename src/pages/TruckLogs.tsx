import React, { useMemo, useState } from "react";
import { Search, Truck as TruckIcon } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Truck, TruckStatusLog } from "../types";
import { formatTruckDateTime, normalizeTruckStatus, TRUCK_STATUS_STYLES } from "../lib/truckStatus";

export function TruckLogs() {
  const [trucks] = useData<Truck>("trucks", []);
  const [truckNo, setTruckNo] = useState("");
  const [logs, setLogs] = useState<TruckStatusLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = useMemo(() => {
    const token = window.localStorage.getItem("authToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchLogs = async () => {
    const value = truckNo.trim();
    if (!value) {
      setLogs([]);
      setError("Enter a truck number to search logs.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/truck-status-logs?truckNo=${encodeURIComponent(value)}`, { headers: authHeaders });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || "Unable to load truck logs.");
      setLogs(Array.isArray(data) ? data as TruckStatusLog[] : []);
    } catch (err) {
      setLogs([]);
      setError((err as Error).message || "Unable to load truck logs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-b border-black pb-4 text-indigo-700">
        <TruckIcon size={26} />
        <h2 className="text-xl font-black uppercase tracking-tight text-black">Truck Logs</h2>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="border-b-2 border-black bg-slate-900 px-4 py-3 text-center text-lg font-black uppercase text-white">
          Truck Status Logs
        </div>
        <div className="border-b-2 border-black bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="space-y-1">
              <span className="text-xs font-black uppercase text-slate-600">Truck Number</span>
              <input
                list="truck-log-trucks"
                value={truckNo}
                onChange={(event) => setTruckNo(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void fetchLogs();
                }}
                placeholder="Enter truck number"
                className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              <datalist id="truck-log-trucks">
                {trucks.map((truck) => <option key={truck.id} value={truck.truckNo} />)}
              </datalist>
            </label>
            <button
              type="button"
              onClick={() => void fetchLogs()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded border-2 border-black bg-blue-700 px-5 py-2 text-sm font-black uppercase text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Search size={16} />
              {loading ? "Searching" : "Search Logs"}
            </button>
          </div>
          {error ? <div className="mt-3 rounded border border-red-700 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="bg-teal-950 text-white">
              <tr className="divide-x divide-black">
                <th className="border border-black px-4 py-3 text-left text-xs font-black uppercase">Vehicle No.</th>
                <th className="border border-black px-4 py-3 text-left text-xs font-black uppercase">Status</th>
                <th className="border border-black px-4 py-3 text-left text-xs font-black uppercase">Date & Time</th>
                <th className="border border-black px-4 py-3 text-left text-xs font-black uppercase">Updated By</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm font-bold text-slate-500">
                    {truckNo.trim() ? "No status logs found for this truck." : "Search a truck number to view status history."}
                  </td>
                </tr>
              ) : logs.map((log, index) => {
                const liveStatus = normalizeTruckStatus(log.liveStatus) || "EMPTY";
                const style = TRUCK_STATUS_STYLES[liveStatus];
                return (
                  <tr key={log.id} className={`${index % 2 === 0 ? "bg-pink-50" : "bg-white"} divide-x divide-black`}>
                    <td className="border border-black px-4 py-2 text-sm font-black uppercase text-blue-800">{log.truckNo}</td>
                    <td className="border border-black px-4 py-2">
                      <span className={`${style.badge} inline-flex min-w-[120px] justify-center border px-2 py-1 text-[11px] font-black uppercase`}>
                        {liveStatus}
                      </span>
                    </td>
                    <td className="border border-black px-4 py-2 text-xs font-bold text-black">{formatTruckDateTime(log.statusUpdatedAt)}</td>
                    <td className="border border-black px-4 py-2 text-xs font-black uppercase text-black">{log.statusUpdatedBy || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
