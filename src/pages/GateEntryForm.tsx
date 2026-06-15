import { ReactNode, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Select } from "../components/Select";
import { useData } from "../hooks/useData";
import { Company, GateEntry, GateEntryPhoto, GatePass, Supplier } from "../types";

const PHOTO_SLOTS = 8;

type PhotoSlot = {
  filename: string;
  uploading: boolean;
};

function createInitialSlots(): PhotoSlot[] {
  return Array.from({ length: PHOTO_SLOTS }, () => ({ filename: "", uploading: false }));
}

function toInputDate(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

export function GateEntryForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceGatePassId = searchParams.get("sourceGatePassId") || "";
  const purposeFromQuery = searchParams.get("purpose") === "Returnable Receipt" ? "Returnable Receipt" : "Material Receipt";

  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [gateEntryPhotos, setGateEntryPhotos] = useData<GateEntryPhoto>("gate-entry-photos", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [gatePasses] = useData<GatePass>("gate_passes", []);

  const sourceGatePass = gatePasses.find((gatePass) => gatePass.id === sourceGatePassId) || null;

  const [date, setDate] = useState(toInputDate());
  const [supplierId, setSupplierId] = useState(sourceGatePass?.recipientId || "");
  const [purpose, setPurpose] = useState<GateEntry["purpose"]>(purposeFromQuery);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceValue, setInvoiceValue] = useState("");
  const [truckNo, setTruckNo] = useState(sourceGatePass?.truckNo || "");
  const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>(createInitialSlots);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const supplierOptions = useMemo(() => {
    const combined = [
      ...suppliers.filter((s) => s.active !== "No").map((s) => ({ value: s.id, label: s.name })),
      ...companies.map((c) => ({ value: c.id, label: c.name })),
    ];
    return combined.sort((a, b) => a.label.localeCompare(b.label));
  }, [suppliers, companies]);

  const hasUploadingPhoto = photoSlots.some((slot) => slot.uploading);
  const purposeLocked = Boolean(sourceGatePassId);

  const resetForm = () => {
    setDate(toInputDate());
    setSupplierId(sourceGatePass?.recipientId || "");
    setPurpose(purposeFromQuery);
    setInvoiceNo("");
    setInvoiceValue("");
    setTruckNo(sourceGatePass?.truckNo || "");
    setPhotoSlots(createInitialSlots());
  };

  const updateSlot = (index: number, next: Partial<PhotoSlot>) => {
    setPhotoSlots((prev) => prev.map((slot, slotIndex) => (slotIndex === index ? { ...slot, ...next } : slot)));
  };

  const handlePhotoUpload = async (index: number, file?: File | null) => {
    if (!file) return;
    updateSlot(index, { uploading: true });
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const token = window.localStorage.getItem("authToken");
        const response = await fetch("/api/upload-artwork", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ base64: reader.result, filename: file.name }),
        });
        if (!response.ok) throw new Error("Upload failed");
        const result = await response.json();
        updateSlot(index, { filename: result.filename, uploading: false });
      } catch (error) {
        console.error("Failed to upload gate entry photo:", error);
        updateSlot(index, { uploading: false, filename: "" });
        alert("Failed to upload photo.");
      }
    };
    reader.onerror = () => {
      updateSlot(index, { uploading: false });
      alert("Failed to read photo.");
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date || !supplierId || !invoiceNo.trim() || !invoiceValue || !truckNo.trim()) return;
    if (hasUploadingPhoto) {
      alert("Please wait for photo uploads to finish.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const gateEntryId = crypto.randomUUID();
      const nextEntry: GateEntry = {
        id: gateEntryId,
        date,
        supplierId,
        purpose,
        invoiceNo: invoiceNo.trim(),
        invoiceValue: Number(invoiceValue || 0),
        truckNo: truckNo.trim(),
        sourceGatePassId: sourceGatePass?.id,
        sourceGatePassNo: sourceGatePass?.gatePassNo,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const nextPhotos = photoSlots
        .map((slot, index) =>
          slot.filename
            ? ({
                id: crypto.randomUUID(),
                gateEntryId,
                photo: slot.filename,
                slotNo: index + 1,
                updatedBy: "System User",
                updateTimestamp: timestamp,
              } satisfies GateEntryPhoto)
            : null
        )
        .filter((row): row is GateEntryPhoto => row !== null);

      await setGateEntries([nextEntry, ...gateEntries]);
      if (nextPhotos.length > 0) {
        await setGateEntryPhotos([...nextPhotos, ...gateEntryPhotos]);
      }

      resetForm();
      navigate("/gate-entry/master");
    } catch (error) {
      console.error("Failed to save gate entry:", error);
      alert("Failed to save gate entry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black text-blue-700">Add Gate Entry</h2>
            <p className="mt-1 text-sm text-slate-500">Use `Returnable Receipt` only when items are coming back against a returnable gate pass.</p>
          </div>
          <button type="button" onClick={() => navigate("/gate-entry/master")} className="rounded-2xl border border-slate-300 px-6 py-3 font-bold text-indigo-700 transition hover:bg-slate-50">
            Back
          </button>
        </div>

        {sourceGatePass ? (
          <div className="mb-6 rounded-2xl border border-emerald-700 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            Linked Returnable Gate Pass: <span className="font-bold">{sourceGatePass.gatePassNo}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Date" required>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>

            <Field label="Purpose" required>
              {purposeLocked ? (
                <input value={purpose || "Material Receipt"} disabled className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg bg-slate-50" />
              ) : (
                <select value={purpose || "Material Receipt"} onChange={(e) => setPurpose(e.target.value as GateEntry["purpose"])} className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="Material Receipt">Material Receipt</option>
                  <option value="Returnable Receipt">Returnable Receipt</option>
                </select>
              )}
            </Field>

            <Field label="Supplier / Customer Name" required>
              <Select value={supplierId} onChange={setSupplierId} options={supplierOptions} placeholder="Search or Select Supplier / Customer..." required />
            </Field>

            <Field label="Invoice No" required>
              <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} required placeholder="INV-001" className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>

            <Field label="Invoice Value" required>
              <input type="number" min="0" step="0.01" value={invoiceValue} onChange={(e) => setInvoiceValue(e.target.value)} required placeholder="0.00" className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>

            <Field label="Truck No" required className="md:max-w-[420px]">
              <input value={truckNo} onChange={(e) => setTruckNo(e.target.value.toUpperCase())} required placeholder="AS-01-XXXX" className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-xl font-black text-blue-700">Photos / Documents</h3>
              <div className="text-sm text-slate-500">Up to {PHOTO_SLOTS} files</div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {photoSlots.map((slot, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-700">Pic {index + 1}</span>
                    {slot.filename ? (
                      <button type="button" onClick={() => updateSlot(index, { filename: "" })} className="rounded-full border border-slate-300 p-2 text-slate-600 hover:bg-white">
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                  </div>
                  <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40">
                    {slot.uploading ? (
                      <div className="flex flex-col items-center gap-3 text-indigo-700">
                        <Loader2 className="animate-spin" size={22} />
                        <span className="text-sm font-semibold">Uploading...</span>
                      </div>
                    ) : slot.filename ? (
                      <div className="flex flex-col items-center gap-3 text-slate-700">
                        <Camera size={22} />
                        <span className="line-clamp-3 text-sm font-semibold">{slot.filename}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-slate-500">
                        <Camera size={22} />
                        <span className="text-sm font-semibold">Upload File</span>
                      </div>
                    )}
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => handlePhotoUpload(index, e.target.files?.[0])} />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={isSubmitting || hasUploadingPhoto} className="rounded-2xl bg-indigo-700 px-8 py-3 font-bold text-white transition hover:bg-indigo-800 disabled:opacity-50">
              {isSubmitting ? "Saving..." : "Save Gate Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className || ""}>
      <label className="mb-2 block text-blue-700 font-bold">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {children}
    </div>
  );
}
