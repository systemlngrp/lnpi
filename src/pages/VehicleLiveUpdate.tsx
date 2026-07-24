import { useMemo, useState } from "react";
import { CheckCircle, ChevronDown, RotateCcw, Truck as TruckIcon } from "lucide-react";
import { useData } from "../hooks/useData";
import type { Company, Truck, TruckLiveStatus } from "../types";
import { TRUCK_LIVE_STATUSES } from "../lib/truckStatus";
import { Spinner } from "../components/Spinner";

type SearchableOption = {
  value: string;
  label: string;
};

type SearchableDropdownProps = {
  label: string;
  value: string;
  placeholder: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
};

function isInternalTruck(truck: Truck) {
  return String(truck.truckType || "").trim().toLowerCase() === "internal";
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function SearchableDropdown({ label, value, placeholder, options, onChange }: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const query = normalizeText(searchQuery);
  const filteredOptions = useMemo(
    () => options.filter((option) => normalizeText(option.label).includes(query)).slice(0, 80),
    [options, query]
  );

  return (
    <label className="relative block space-y-2">
      <span className="text-xs font-black uppercase text-slate-600">{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setSearchQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setSearchQuery("");
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          className="w-full rounded border-2 border-black bg-white px-4 py-4 pr-11 text-base font-black uppercase focus:outline-none focus:ring-2 focus:ring-indigo-600"
          placeholder={placeholder}
          autoComplete="off"
        />
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-700" />
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          {filteredOptions.length > 0 ? filteredOptions.map((option) => (
            <button
              key={`${label}-${option.value}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setSearchQuery("");
                setOpen(false);
              }}
              className="block w-full border-b border-slate-200 px-4 py-3 text-left text-sm font-black uppercase text-black hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
            >
              <span className="block truncate">{option.label}</span>
            </button>
          )) : (
            <div className="px-4 py-3 text-sm font-bold uppercase text-slate-500">No results found</div>
          )}
        </div>
      ) : null}
    </label>
  );
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
  const partyOptions = useMemo<SearchableOption[]>(
    () => companies
      .map((company) => String(company.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name })),
    [companies]
  );
  const driverOptions = useMemo<SearchableOption[]>(() => {
    const names = new Map<string, string>();
    internalTrucks.forEach((truck) => {
      const name = String(truck.driverName || "").trim();
      if (name && !names.has(normalizeText(name))) names.set(normalizeText(name), name);
    });
    return Array.from(names.values())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name }));
  }, [internalTrucks]);

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

      <div className="mx-auto w-full max-w-md overflow-visible rounded border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <div className="rounded-t-sm border-b-2 border-black bg-indigo-700 px-5 py-5 text-white">
          <div className="flex items-center gap-3">
            <TruckIcon size={30} />
            <h3 className="text-2xl font-black uppercase leading-tight">Office Vehicle Update</h3>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {error ? <div className="rounded border border-red-700 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div> : null}
          {message ? <div className="rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{message}</div> : null}
          {internalTrucks.length === 0 ? <div className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">No internal vehicles found in Truck Master.</div> : null}

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

          <SearchableDropdown
            label="Party"
            value={partyName}
            placeholder="Search party"
            options={partyOptions}
            onChange={setPartyName}
          />

          <SearchableDropdown
            label="Driver Name"
            value={driverName}
            placeholder="Search driver"
            options={driverOptions}
            onChange={setDriverName}
          />

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
  );
}
