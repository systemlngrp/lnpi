import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import { GateEntry, GateEntryPhoto, Supplier } from "../types";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";

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
  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [gateEntryPhotos, setGateEntryPhotos] = useData<GateEntryPhoto>("gate-entry-photos", []);
  const [suppliers] = useData<Supplier>("suppliers", []);

  const [date, setDate] = useState(toInputDate());
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceValue, setInvoiceValue] = useState("");
  const [truckNo, setTruckNo] = useState("");
  const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>(createInitialSlots);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const supplierOptions = useMemo(
    () =>
      [...suppliers]
        .filter((supplier) => supplier.active !== "No")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((supplier) => ({ value: supplier.id, label: supplier.name })),
    [suppliers]
  );

  const hasUploadingPhoto = photoSlots.some((slot) => slot.uploading);

  const resetForm = () => {
    setDate(toInputDate());
    setSupplierId("");
    setInvoiceNo("");
    setInvoiceValue("");
    setTruckNo("");
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
        const response = await fetch("/api/upload-artwork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        invoiceNo: invoiceNo.trim(),
        invoiceValue: Number(invoiceValue || 0),
        truckNo: truckNo.trim(),
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
          <h2 className="text-3xl font-black text-blue-700">Add Gate Entry</h2>
          <button
            type="button"
            onClick={() => navigate("/gate-entry/master")}
            className="rounded-2xl border border-slate-300 px-6 py-3 font-bold text-indigo-700 transition hover:bg-slate-50"
          >
            Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Date" required>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>

            <Field label="Supplier Name" required>
              <Select
                value={supplierId}
                onChange={setSupplierId}
                options={supplierOptions}
                placeholder="Search or Select Supplier..."
                required
              />
            </Field>

            <Field label="Invoice No" required>
              <input
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                required
                placeholder="INV-001"
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>

            <Field label="Invoice Value" required>
              <input
                type="number"
                min="0"
                step="0.01"
                value={invoiceValue}
                onChange={(e) => setInvoiceValue(e.target.value)}
                required
                placeholder="0.00"
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>

            <Field label="Truck No" required className="md:max-w-[420px]">
              <input
                value={truckNo}
                onChange={(e) => setTruckNo(e.target.value.toUpperCase())}
                required
                placeholder="AS-01-XXXX"
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-lg uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>
          </div>

          <div className="space-y-4 rounded-[24px] border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-bold text-blue-700">Upload Photos (Up to 8)</h3>
              <span className="text-xs font-semibold text-slate-500">
                {photoSlots.filter((slot) => slot.filename).length} / {PHOTO_SLOTS} uploaded
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {photoSlots.map((slot, index) => (
                <PhotoUploadCard
                  key={index}
                  slot={slot}
                  index={index}
                  onUpload={handlePhotoUpload}
                  onRemove={() => updateSlot(index, { filename: "", uploading: false })}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => navigate("/gate-entry/master")}
              className="rounded-2xl border border-slate-300 px-6 py-3 font-bold text-indigo-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || hasUploadingPhoto}
              className="rounded-2xl bg-indigo-700 px-8 py-3 font-bold text-white transition hover:bg-indigo-800 disabled:opacity-50"
            >
              {isSubmitting ? <Spinner size={18} className="text-white" /> : "Save Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PhotoUploadCard({
  slot,
  index,
  onUpload,
  onRemove,
}: {
  slot: PhotoSlot;
  index: number;
  onUpload: (index: number, file?: File | null) => Promise<void>;
  onRemove: () => void;
}) {
  const isPdf = slot.filename.toLowerCase().endsWith(".pdf");

  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50">
      <div className="flex h-40 flex-col items-center justify-center gap-3 p-4 text-center">
        {slot.filename ? (
          <>
            {isPdf ? (
              <div className="h-24 w-full flex flex-col items-center justify-center bg-red-50 text-red-700 gap-1 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span className="text-[10px] font-bold uppercase">PDF</span>
              </div>
            ) : (
              <img
                src={`/uploads/${slot.filename}`}
                alt={`Gate entry photo ${index + 1}`}
                className="h-24 w-full rounded-xl object-cover"
              />
            )}
            <span className="text-xs font-medium text-slate-500">Pic {index + 1}</span>
          </>
        ) : (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
              {slot.uploading ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} />}
            </div>
            <span className="text-sm font-medium text-slate-500">Pic {index + 1}</span>
          </>
        )}
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        {slot.filename ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full bg-white p-2 text-red-600 shadow transition hover:bg-red-50"
            title="Remove photo"
          >
            <Trash2 size={16} />
          </button>
        ) : null}
        <label className="cursor-pointer rounded-full bg-white p-2 text-slate-700 shadow transition hover:bg-slate-100">
          <Camera size={16} />
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => void onUpload(index, e.target.files?.[0])}
          />
        </label>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required = false,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label className="font-bold text-blue-700">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {children}
    </div>
  );
}
