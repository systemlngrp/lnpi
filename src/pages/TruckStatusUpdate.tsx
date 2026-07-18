import React, { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle, Clock, Phone, Truck as TruckIcon, User } from "lucide-react";
import type { Truck, TruckLiveStatus } from "../types";
import { formatTruckDateTime, formatTruckDuration, normalizeTruckStatus, TRUCK_DRIVER_UPDATE_STATUSES, TRUCK_STATUS_STYLES } from "../lib/truckStatus";
import { Spinner } from "../components/Spinner";

function getDriverSelectableStatus(value?: string | null): TruckLiveStatus | "" {
  const status = normalizeTruckStatus(value);
  return status && TRUCK_DRIVER_UPDATE_STATUSES.includes(status) ? status : "";
}

const PARTY_VISIBLE_STATUSES = new Set<TruckLiveStatus>(["LOADING", "IN-TRANSIT", "REPORTED TO PARTY", "UNLOADING"]);

export function TruckStatusUpdate() {
  const [truck, setTruck] = useState<Truck | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<TruckLiveStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  const authHeaders = useMemo(() => {
    const token = window.localStorage.getItem("authToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchStatus = async (background = false) => {
    try {
      if (!background) setLoading(true);
      const response = await fetch("/api/truck-driver/status", { headers: authHeaders });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to load truck status.");
      }
      const data = await response.json();
      const nextTruck = data.truck as Truck;
      setTruck(nextTruck);
      setSelectedStatus(getDriverSelectableStatus(nextTruck.liveStatus));
      setError("");
    } catch (err) {
      setError((err as Error).message || "Unable to load truck status.");
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    const refreshId = window.setInterval(() => void fetchStatus(true), 30000);
    const tickId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(refreshId);
      window.clearInterval(tickId);
    };
  }, []);

  const handleSave = async () => {
    if (!selectedStatus) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/truck-driver/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ liveStatus: selectedStatus }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update truck status.");
      setTruck(data.truck as Truck);
      setSelectedStatus(getDriverSelectableStatus(data.truck?.liveStatus));
      setMessage("Status updated live.");
    } catch (err) {
      setError((err as Error).message || "Unable to update truck status.");
    } finally {
      setSaving(false);
    }
  };

  const status = normalizeTruckStatus(truck?.liveStatus) || "EMPTY";
  const style = TRUCK_STATUS_STYLES[status];
  const partyName = String(truck?.partyName || "").trim();
  const showPartyName = PARTY_VISIBLE_STATUSES.has(status) && Boolean(partyName);

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-2 sm:space-y-6 sm:px-0">
      <div className="border-b border-black pb-4">
        <div className="flex items-center gap-3 text-indigo-700">
          <TruckIcon size={28} />
          <h2 className="text-xl font-black uppercase tracking-tight text-black">Truck Status Update</h2>
        </div>
      </div>

      {error ? <div className="rounded border border-red-700 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-700 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}

      <div className="bg-white border-2 border-black rounded shadow-sm overflow-hidden">
        <div className={`${style.tile} border-b-2 border-black px-5 py-5`}>
          <div className="text-xs font-black uppercase tracking-wide opacity-80">Current Live Status</div>
          <div className="mt-1 break-words text-2xl font-black uppercase tracking-tight sm:text-3xl">{status}</div>
        </div>

        <div className="grid grid-cols-1 gap-0 divide-y divide-black md:grid-cols-2 md:divide-x md:divide-y-0">
          <Info label="Vehicle No." value={truck?.truckNo || "-"} icon={<TruckIcon size={18} />} />
          <Info label="Driver" value={truck?.driverName || "-"} icon={<User size={18} />} />
          <Info label="Mobile" value={truck?.mobileNo || "-"} icon={<Phone size={18} />} />
          <Info label="Duration" value={formatTruckDuration(truck?.statusUpdatedAt, now)} icon={<Clock size={18} />} />
        </div>

        {showPartyName ? (
          <div className="border-t-2 border-black">
            <Info label="Party Name" value={partyName} icon={<Building2 size={18} />} wide />
          </div>
        ) : null}

        <div className="border-t-2 border-black p-3 space-y-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <label className="space-y-1">
              <span className="text-xs font-black uppercase text-slate-600">Update Status</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as TruckLiveStatus)}
                className="w-full rounded border-2 border-black bg-white px-4 py-3 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600 sm:text-sm"
              >
                <option value="">Select status</option>
                {TRUCK_DRIVER_UPDATE_STATUSES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!selectedStatus || saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded border-2 border-black bg-emerald-600 px-6 py-3 text-sm font-black uppercase text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
            >
              {saving ? <Spinner size={18} className="text-white" /> : <CheckCircle size={18} />}
              Save Status
            </button>
          </div>
          <div className="text-xs font-bold text-slate-600">Last updated: {formatTruckDateTime(truck?.statusUpdatedAt)}</div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, icon, wide = false }: { label: string; value: string; icon: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-4 sm:p-5 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded border border-black bg-slate-100 text-indigo-700">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase text-slate-500">{label}</div>
        <div className="break-words text-sm font-black uppercase leading-snug text-black">{value}</div>
      </div>
    </div>
  );
}