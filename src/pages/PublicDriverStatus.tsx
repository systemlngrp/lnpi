import { useEffect, useMemo, useState } from "react";
import { CheckCircle, RotateCcw, Truck as TruckIcon } from "lucide-react";
import type { Truck } from "../types";
import { Spinner } from "../components/Spinner";

function isAuthVehicleListError(message: string) {
  return /unauthorized|forbidden/i.test(message);
}

const DRIVER_STATUS_OPTIONS = [
  { value: "Reported", label: "Reported" },
  { value: "UNLOADING", label: "UNLOADING" },
  { value: "Released", label: "Released" },
];

export function PublicDriverStatus() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [truckId, setTruckId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedTruck = useMemo(() => trucks.find((truck) => truck.id === truckId), [truckId, trucks]);

  useEffect(() => {
    let mounted = true;
    const fetchTrucks = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/public/trucks");
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.error || "Unable to load vehicles.");
        if (mounted) setTrucks(Array.isArray(data) ? data : []);
      } catch (err) {
        if (mounted) {
          const message = (err as Error).message || "Unable to load vehicles.";
          setError(isAuthVehicleListError(message) ? "" : message);
          setTrucks([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void fetchTrucks();
    return () => { mounted = false; };
  }, []);

  const handleSubmit = async () => {
    if (!truckId || !status) {
      setError("Select vehicle and status.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/public/truck-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truckId, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update status.");
      setMessage("Vehicle status updated successfully.");
      setStatus("");
    } catch (err) {
      setError((err as Error).message || "Unable to update status.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-4 text-black sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-md flex-col justify-center">
        <div className="overflow-hidden rounded border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <div className="border-b-2 border-black bg-indigo-700 px-5 py-5 text-white">
            <div className="flex items-center gap-3">
              <TruckIcon size={30} />
              <div>
                <div className="text-xs font-black uppercase opacity-80">LNPI OPS Portal</div>
                <h1 className="text-2xl font-black uppercase leading-tight">Driver Status</h1>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            {loading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : (
              <>
                {error ? <div className="rounded border border-red-700 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div> : null}
                {message ? <div className="rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{message}</div> : null}
                {!error && trucks.length === 0 ? <div className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">No internal vehicles found in Truck Master.</div> : null}

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase text-slate-600">Vehicle No. *</span>
                  <select
                    value={truckId}
                    onChange={(event) => setTruckId(event.target.value)}
                    className="w-full rounded border-2 border-black bg-white px-4 py-4 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="">Choose vehicle</option>
                    {trucks.map((truck) => (
                      <option key={truck.id} value={truck.id}>{truck.truckNo}</option>
                    ))}
                  </select>
                </label>

                {selectedTruck ? (
                  <div className="rounded border border-black bg-slate-50 px-3 py-2 text-xs font-bold uppercase text-slate-700">
                    Driver: {selectedTruck.driverName || "-"} | Mobile: {selectedTruck.mobileNo || "-"}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="text-xs font-black uppercase text-slate-600">Status *</div>
                  <div className="grid gap-2">
                    {DRIVER_STATUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatus(option.value)}
                        className={`rounded border-2 border-black px-4 py-4 text-left text-base font-black uppercase ${status === option.value ? "bg-indigo-700 text-white" : "bg-white text-black hover:bg-slate-50"}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={saving || !truckId || !status}
                  className="flex w-full items-center justify-center gap-2 rounded border-2 border-black bg-emerald-600 px-5 py-4 text-base font-black uppercase text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Spinner size={20} className="text-white" /> : <CheckCircle size={20} />}
                  Submit
                </button>

                <button
                  type="button"
                  onClick={() => { setTruckId(""); setStatus(""); setError(""); setMessage(""); }}
                  className="flex w-full items-center justify-center gap-2 rounded border border-black bg-white px-4 py-3 text-sm font-black uppercase text-black hover:bg-slate-50"
                >
                  <RotateCcw size={16} />
                  Clear Form
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
