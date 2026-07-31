import React, { useEffect, useMemo, useState } from "react";
import { Copy, Search, Truck as TruckIcon } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Company, DispatchPlan, LoadingSlip, Order, Truck, TruckStatusLog } from "../types";
import { formatTruckDateTime, formatTruckDuration, normalizeTruckStatus, TRUCK_LIVE_STATUSES, TRUCK_STATUS_STYLES } from "../lib/truckStatus";
import { Select } from "../components/Select";

function isInternalTruck(truck: Truck) {
  return String(truck.truckType || "").trim().toLowerCase() === "internal";
}

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
  const [vehicleNoFilter, setVehicleNoFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [statusLogs, setStatusLogs] = useState<TruckStatusLog[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);


  
  useEffect(() => {
    const token = window.localStorage.getItem("authToken") || "";
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch("/api/truck-status-logs", { headers })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setStatusLogs(Array.isArray(data) ? data as TruckStatusLog[] : []))
      .catch(() => setStatusLogs([]));
  }, []);

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

  const latestPartyByTruckId = useMemo(() => {
    const map = new Map<string, string>();
    statusLogs.forEach((log) => {
      const truckId = String(log.truckId || "").trim();
      const partyName = String(log.partyName || "").trim();
      if (truckId && partyName && !map.has(truckId)) map.set(truckId, partyName);
    });
    return map;
  }, [statusLogs]);

  const baseRows = useMemo(() => {
    const planById = new Map(dispatchPlans.map((plan) => [plan.id, plan]));
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const companyById = new Map(companies.map((company) => [company.id, company]));

    return trucks.filter(isInternalTruck).map((truck) => {
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
      const latestLogParty = latestPartyByTruckId.get(truck.id) || "";
      return {
        truck,
        liveStatus,
        party: latestLogParty || Array.from(partyNames).filter(Boolean).join(", ") || "-",
      };
    }).sort((a, b) => {
      const statusA = a.liveStatus.localeCompare(b.liveStatus);
      return statusA || a.truck.truckNo.localeCompare(b.truck.truckNo, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [activeSlipsByTruck, companies, dispatchPlans, latestPartyByTruckId, loadingSlips, orders, trucks]);


  const vehicleNoOptions = useMemo(
    () => [
      { value: "", label: "All Vehicle No." },
      ...Array.from(new Set(baseRows.map((row) => String(row.truck.truckNo || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((truckNo) => ({ value: truckNo, label: truckNo, searchText: truckNo })),
    ],
    [baseRows]
  );

  const partyOptions = useMemo(
    () => [
      { value: "", label: "All Party" },
      ...Array.from(new Set(baseRows.map((row) => String(row.party || "").trim()).filter((party) => party && party !== "-")))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .map((party) => ({ value: party, label: party, searchText: party })),
    ],
    [baseRows]
  );

  const rows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return baseRows.filter((row) => {
      if (vehicleNoFilter && row.truck.truckNo !== vehicleNoFilter) return false;
      if (partyFilter && row.party !== partyFilter) return false;
      if (!q) return true;
      return [row.truck.truckNo, row.liveStatus, row.party, row.truck.driverName, row.truck.mobileNo]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [baseRows, partyFilter, searchTerm, vehicleNoFilter]);

  const handleCopyDriverFormLink = async () => {
    const url = new URL("/driver-status", window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 2000);
    } catch (error) {
      console.error("Failed to copy driver form link:", error);
    }
  };

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    TRUCK_LIVE_STATUSES.forEach((status) => map.set(status, 0));
    trucks.filter(isInternalTruck).forEach((truck) => {
      const status = normalizeTruckStatus(truck.liveStatus) || "EMPTY";
      map.set(status, (map.get(status) || 0) + 1);
    });
    return map;
  }, [trucks]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-black pb-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-center gap-3 text-indigo-700">
          <TruckIcon size={26} />
          <h2 className="text-xl font-black uppercase tracking-tight text-black">Company Vehicle Status [Live]</h2>
        </div>
        <div className="grid w-full gap-2 xl:max-w-5xl xl:grid-cols-[minmax(220px,1fr)_minmax(180px,0.75fr)_minmax(220px,0.9fr)_auto] xl:items-start">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search vehicle, status, party, driver..."
              className="min-h-[46px] w-full rounded border-2 border-black bg-white py-2 pl-10 pr-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
          </div>
          <Select
            id="truck-status-vehicle-filter"
            options={vehicleNoOptions}
            value={vehicleNoFilter}
            onChange={setVehicleNoFilter}
            placeholder="All Vehicle No."
          />
          <Select
            id="truck-status-party-filter"
            options={partyOptions}
            value={partyFilter}
            onChange={setPartyFilter}
            placeholder="All Party"
          />
          <div className="flex flex-col items-stretch gap-1">
            <button
              type="button"
              onClick={() => void handleCopyDriverFormLink()}
              className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded border-2 border-black bg-white px-4 py-2 text-sm font-black uppercase text-black hover:bg-slate-50"
            >
              <Copy size={16} />
              {copyFeedback ? "Copied" : "Copy Driver Form Link"}
            </button>
            {copyFeedback ? <div className="text-right text-xs font-black uppercase text-emerald-700">Link copied</div> : null}
          </div>
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

    </div>
  );
}
