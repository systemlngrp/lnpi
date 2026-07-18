import React, { useEffect, useMemo, useState } from "react";
import { Search, Truck as TruckIcon } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Company, DispatchPlan, LoadingSlip, Order, Truck, TruckStatusLog } from "../types";
import { formatTruckDateTime, formatTruckDuration, normalizeTruckStatus, TRUCK_LIVE_STATUSES, TRUCK_STATUS_STYLES } from "../lib/truckStatus";

function getSortTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}


export function TruckStatusReport() {
  const [trucks] = useData<Truck>("trucks", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [logTruckNo, setLogTruckNo] = useState("");
  const [logs, setLogs] = useState<TruckStatusLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const authHeaders = useMemo(() => {
    const token = window.localStorage.getItem("authToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchTruckLogs = async () => {
    const truckNo = logTruckNo.trim();
    if (!truckNo) {
      setLogs([]);
      setLogsError("Enter a truck number to search logs.");
      return;
    }

    setLogsLoading(true);
    setLogsError("");
    try {
      const response = await fetch(`/api/truck-status-logs?truckNo=${encodeURIComponent(truckNo)}`, { headers: authHeaders });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || "Unable to load truck logs.");
      setLogs(Array.isArray(data) ? data as TruckStatusLog[] : []);
    } catch (err) {
      setLogs([]);
      setLogsError((err as Error).message || "Unable to load truck logs.");
    } finally {
      setLogsLoading(false);
    }
  };

  const activeSlipsByTruck = useMemo(() => {
    const map = new Map<string, LoadingSlip>();
    [...loadingSlips]
      .filter((slip) => slip.status !== "Cancelled" && String(slip.truckId || "").trim())
      .sort((a, b) => getSortTime(b.updateTimestamp || b.date) - getSortTime(a.updateTimestamp || a.date))
      .forEach((slip) => {
        if (!map.has(slip.truckId)) map.set(slip.truckId, slip);
      });
    return map;
  }, [loadingSlips]);

  const rows = useMemo(() => {
    const planById = new Map(dispatchPlans.map((plan) => [plan.id, plan]));
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const companyById = new Map(companies.map((company) => [company.id, company]));

    return trucks.map((truck) => {
      const slip = activeSlipsByTruck.get(truck.id);
      const partyNames = new Set<string>();

      if (slip?.companyName) partyNames.add(slip.companyName);
      if (slip?.companyId) {
        const company = companyById.get(slip.companyId);
        if (company?.name) partyNames.add(company.name);
      }

      (slip?.lines || []).forEach((line) => {
        if (line.companyName) partyNames.add(line.companyName);
        if (line.companyId) {
          const company = companyById.get(line.companyId);
          if (company?.name) partyNames.add(company.name);
        }
        const plan = planById.get(line.dispatchPlanId);
        const order = plan ? orderById.get(plan.orderId) : undefined;
        const company = order ? companyById.get(order.companyId) : undefined;
        if (company?.name) partyNames.add(company.name);
      });

      const liveStatus = normalizeTruckStatus(truck.liveStatus) || "EMPTY";
      return {
        truck,
        liveStatus,
        party: Array.from(partyNames).filter(Boolean).join(", ") || "-",
      };
    }).filter((row) => {
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return [row.truck.truckNo, row.liveStatus, row.party, row.truck.driverName, row.truck.mobileNo]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    }).sort((a, b) => {
      const statusA = a.liveStatus.localeCompare(b.liveStatus);
      return statusA || a.truck.truckNo.localeCompare(b.truck.truckNo, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [activeSlipsByTruck, companies, dispatchPlans, loadingSlips, orders, searchTerm, trucks]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    TRUCK_LIVE_STATUSES.forEach((status) => map.set(status, 0));
    trucks.forEach((truck) => {
      const status = normalizeTruckStatus(truck.liveStatus) || "EMPTY";
      map.set(status, (map.get(status) || 0) + 1);
    });
    return map;
  }, [trucks]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-black pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3 text-indigo-700">
          <TruckIcon size={26} />
          <h2 className="text-xl font-black uppercase tracking-tight text-black">Company Vehicle Status [Live]</h2>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search vehicle, status, party, driver..."
            className="w-full rounded border-2 border-black bg-white py-2 pl-10 pr-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-9">
        {TRUCK_LIVE_STATUSES.map((status) => {
          const style = TRUCK_STATUS_STYLES[status];
          return (
            <div key={status} className={`${style.tile} min-h-[58px] border-2 border-black px-3 py-2 text-center shadow-sm`}>
              <div className="text-[11px] font-black uppercase leading-tight">{style.label}</div>
              <div className="text-xl font-black">{counts.get(status) || 0}</div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="border-b-2 border-black bg-blue-900 px-4 py-3 text-center text-lg font-black uppercase text-white">
          Company Vehicle Status [Live]
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 z-30 bg-teal-950 text-white">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-black uppercase border border-black">Vehicle No.</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase border border-black">Live Status</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase border border-black">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase border border-black">Party</th>
                <th className="px-4 py-3 text-right text-xs font-black uppercase border border-black">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase border border-black">Driver Name</th>
                <th className="px-4 py-3 text-left text-xs font-black uppercase border border-black">Driver Number</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm font-bold text-slate-500">No trucks found.</td>
                </tr>
              ) : rows.map(({ truck, liveStatus, party }, index) => {
                const style = TRUCK_STATUS_STYLES[liveStatus];
                const duration = formatTruckDuration(truck.statusUpdatedAt, now);
                const longDuration = duration !== "-" && Number(duration.split(":")[0]) >= 24;
                return (
                  <tr key={truck.id} className={`${index % 2 === 0 ? "bg-pink-50" : "bg-white"} divide-x divide-black hover:bg-slate-50`}>
                    <td className="border border-black px-4 py-2 text-sm font-black uppercase text-blue-800">{truck.truckNo}</td>
                    <td className="border border-black px-4 py-2">
                      <span className={`${style.badge} inline-flex min-w-[120px] justify-center border px-2 py-1 text-[11px] font-black uppercase`}>
                        {liveStatus}
                      </span>
                    </td>
                    <td className="border border-black px-4 py-2 text-xs font-bold text-black">{formatTruckDateTime(truck.statusUpdatedAt)}</td>
                    <td className="border border-black px-4 py-2 text-xs font-bold uppercase text-black">
                      <div className="max-w-[280px] whitespace-normal break-words">{party}</div>
                    </td>
                    <td className={`${longDuration ? "bg-red-600 text-white" : "text-black"} border border-black px-4 py-2 text-right text-xs font-black`}>{duration}</td>
                    <td className="border border-black px-4 py-2 text-xs font-black uppercase text-black">{truck.driverName || "-"}</td>
                    <td className="border border-black px-4 py-2 text-xs font-black text-black">{truck.mobileNo || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                list="truck-status-log-trucks"
                value={logTruckNo}
                onChange={(e) => setLogTruckNo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void fetchTruckLogs();
                }}
                placeholder="Enter truck number"
                className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              <datalist id="truck-status-log-trucks">
                {trucks.map((truck) => <option key={truck.id} value={truck.truckNo} />)}
              </datalist>
            </label>
            <button
              type="button"
              onClick={() => void fetchTruckLogs()}
              disabled={logsLoading}
              className="inline-flex items-center justify-center gap-2 rounded border-2 border-black bg-blue-700 px-5 py-2 text-sm font-black uppercase text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Search size={16} />
              {logsLoading ? "Searching" : "Search Logs"}
            </button>
          </div>
          {logsError ? <div className="mt-3 rounded border border-red-700 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{logsError}</div> : null}
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
                    {logTruckNo.trim() ? "No status logs found for this truck." : "Search a truck number to view status history."}
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