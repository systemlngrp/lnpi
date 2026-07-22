import { useMemo, useState } from "react";
import { CheckCircle, Truck as TruckIcon } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Company, Truck, TruckLiveStatus } from "../types";
import { TRUCK_LIVE_STATUSES } from "../lib/truckStatus";
import { Spinner } from "../components/Spinner";

export function VehicleLiveUpdate() {
  const [trucks] = useData<Truck>("trucks", []);
  const [companies] = useData<Company>("companies", []);
  const [truckId, setTruckId] = useState("");
  const [liveStatus, setLiveStatus] = useState<TruckLiveStatus | "">("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [partyName, setPartyName] = useState("");
  const [driverName, setDriverName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedTruck = useMemo(() => trucks.find((truck) => truck.id === truckId), [truckId, trucks]);

  const authHeaders = useMemo(() => {
    const token = window.localStorage.getItem("authToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const handleTruckChange = (value: string) => {
    setTruckId(value);
    const truck = trucks.find((row) => row.id === value);
    if (truck && !driverName.trim()) setDriverName(truck.driverName || "");
  };

  const resetForm = () => {
    setTruckId("");
    setLiveStatus("");
    setInvoiceNo("");
    setPartyName("");
    setDriverName("");
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
        body: JSON.stringify({ truckId, liveStatus, invoiceNo, partyName, driverName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update vehicle status.");
      setMessage("Vehicle live status updated.");
      resetForm();
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

      {error ? <div className="rounded border border-red-700 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-700 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}

      <div className="max-w-5xl overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="border-b-2 border-black bg-slate-900 px-4 py-3 text-lg font-black uppercase text-white">
          Update Current Vehicle Status
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-black uppercase text-slate-600">Vehicle No. *</span>
            <select
              value={truckId}
              onChange={(event) => handleTruckChange(event.target.value)}
              className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
            >
              <option value="">Select vehicle</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>{truck.truckNo}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-black uppercase text-slate-600">Live Status *</span>
            <select
              value={liveStatus}
              onChange={(event) => setLiveStatus(event.target.value as TruckLiveStatus)}
              className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
            >
              <option value="">Select status</option>
              {TRUCK_LIVE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-black uppercase text-slate-600">Invoice No.</span>
            <input
              value={invoiceNo}
              onChange={(event) => setInvoiceNo(event.target.value)}
              className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              placeholder="Invoice no."
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-black uppercase text-slate-600">Party</span>
            <input
              list="vehicle-live-update-companies"
              value={partyName}
              onChange={(event) => setPartyName(event.target.value)}
              className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              placeholder="Party name"
            />
            <datalist id="vehicle-live-update-companies">
              {companies.map((company) => <option key={company.id} value={company.name} />)}
            </datalist>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-black uppercase text-slate-600">Driver Name</span>
            <input
              value={driverName}
              onChange={(event) => setDriverName(event.target.value)}
              className="w-full rounded border-2 border-black bg-white px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
              placeholder="Driver name"
            />
          </label>

          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !truckId || !liveStatus}
              className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded border-2 border-black bg-emerald-600 px-5 py-2 text-sm font-black uppercase text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Spinner size={16} className="text-white" /> : <CheckCircle size={16} />}
              Submit
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded border-2 border-black bg-white px-5 py-2 text-sm font-black uppercase text-black hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {selectedTruck ? (
        <div className="max-w-5xl rounded border border-black bg-slate-50 px-4 py-3 text-sm font-bold uppercase text-black">
          Selected: {selectedTruck.truckNo} | Driver: {selectedTruck.driverName || "-"} | Mobile: {selectedTruck.mobileNo || "-"}
        </div>
      ) : null}
    </div>
  );
}
