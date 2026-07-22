import { useMemo, useState } from "react";
import { CheckCircle, RotateCcw, Truck as TruckIcon } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Company, Truck, TruckLiveStatus } from "../types";
import { TRUCK_LIVE_STATUSES } from "../lib/truckStatus";
import { Spinner } from "../components/Spinner";

function isInternalTruck(truck: Truck) {
  return String(truck.truckType || "").trim().toLowerCase() === "internal";
}

export function VehicleLiveUpdate() {
  const [trucks] = useData<Truck>("trucks", []);
  const [companies] = useData<Company>("companies", []);
  const [truckId, setTruckId] = useState("");
  const [liveStatus, setLiveStatus] = useState<TruckLiveStatus | "">("");
  const [partyName, setPartyName] = useState("");
  const [driverName, setDriverName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const internalTrucks = useMemo(() => trucks.filter(isInternalTruck), [trucks]);
  const partyOptions = useMemo(
    () => companies.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })),
    [companies]
  );
  const selectedTruck = useMemo(() => internalTrucks.find((truck) => truck.id === truckId), [internalTrucks, truckId]);

  const authHeaders = useMemo(() => {
    const token = window.localStorage.getItem("authToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const handleTruckChange = (value: string) => {
    setTruckId(value);
    const truck = internalTrucks.find((row) => row.id === value);
    setDriverName(truck?.driverName || "");
  };

  const resetForm = () => {
    setTruckId("");
    setLiveStatus("");
    setPartyName("");
    setDriverName("");
    setError("");
    setMessage("");
  };

  const handleSubmit = async () => {
    if (!truckId || !liveStatus) {
      setError("Select vehicle and status.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/truck-live-update", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ truckId, liveStatus, partyName, driverName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update vehicle status.");
      setMessage("Vehicle live status updated.");
      setLiveStatus("");
      setPartyName("");
    } catch (err) {
      setError((err as Error).message || "Unable to update vehicle status.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-b border-black pb-4 text-indigo-700">
        <TruckIcon size={26} />
        <h2 className="text-xl font-black uppercase tracking-tight text-black">Vehicle Live Update</h2>
      </div>

      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="border-b-2 border-black bg-indigo-700 px-5 py-5 text-white">
          <div className="flex items-center gap-3">
            <TruckIcon size={30} />
            <div>
              <div className="text-xs font-black uppercase opacity-80">LNPI OPS Portal</div>
              <h3 className="text-2xl font-black uppercase leading-tight">Office Vehicle Update</h3>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {error ? <div className="rounded border border-red-700 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div> : null}
          {message ? <div className="rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{message}</div> : null}
          {internalTrucks.length === 0 ? <div className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">No internal vehicles found in Truck Master.</div> : null}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase text-slate-600">Vehicle No. *</span>
              <select
                value={truckId}
                onChange={(event) => handleTruckChange(event.target.value)}
                className="w-full rounded border-2 border-black bg-white px-4 py-4 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              >
                <option value="">Choose vehicle</option>
                {internalTrucks.map((truck) => (
                  <option key={truck.id} value={truck.id}>{truck.truckNo}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-black uppercase text-slate-600">Live Status *</span>
              <select
                value={liveStatus}
                onChange={(event) => setLiveStatus(event.target.value as TruckLiveStatus)}
                className="w-full rounded border-2 border-black bg-white px-4 py-4 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              >
                <option value="">Select status</option>
                {TRUCK_LIVE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>

            {selectedTruck ? (
              <div className="rounded border border-black bg-slate-50 px-3 py-3 text-xs font-bold uppercase text-slate-700 md:col-span-2">
                Driver: {selectedTruck.driverName || "-"} | Mobile: {selectedTruck.mobileNo || "-"}
              </div>
            ) : null}

            <label className="block space-y-2">
              <span className="text-xs font-black uppercase text-slate-600">Party</span>
              <input
                list="vehicle-live-update-companies"
                value={partyName}
                onChange={(event) => setPartyName(event.target.value)}
                className="w-full rounded border-2 border-black bg-white px-4 py-4 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
                placeholder="Search party"
              />
              <datalist id="vehicle-live-update-companies">
                {partyOptions.map((company) => <option key={company.id} value={company.name} />)}
              </datalist>
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-black uppercase text-slate-600">Driver Name</span>
              <input
                value={driverName}
                onChange={(event) => setDriverName(event.target.value)}
                className="w-full rounded border-2 border-black bg-white px-4 py-4 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
                placeholder="Driver name"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !truckId || !liveStatus}
              className="flex w-full items-center justify-center gap-2 rounded border-2 border-black bg-emerald-600 px-5 py-4 text-base font-black uppercase text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Spinner size={20} className="text-white" /> : <CheckCircle size={20} />}
              Submit
            </button>

            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded border border-black bg-white px-4 py-3 text-sm font-black uppercase text-black hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw size={16} />
              Clear Form
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}