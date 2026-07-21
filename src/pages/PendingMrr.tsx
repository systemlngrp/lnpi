import { useMemo, useState } from "react";
import { Eye, XCircle } from "lucide-react";
import { useData } from "../hooks/useData";
import { Company, GateEntry, GateEntryPhoto, Supplier } from "../types";
import { useNavigate } from "react-router-dom";
import { canCreateMrrForGateEntry, hasGateEntryMrr } from "../lib/gateEntryState";
import { useAuth } from "../auth/AuthContext";

export function PendingMrr() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [gateEntryPhotos] = useData<GateEntryPhoto>("gate-entry-photos", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const pendingEntries = useMemo(
    () =>
      [...gateEntries]
        .filter((entry) => canCreateMrrForGateEntry(entry))
        .filter((entry) => {
          const s = suppliers.find((supplier) => supplier.id === entry.supplierId);
          const c = companies.find((company) => company.id === entry.supplierId);
          const supplierName = s ? s.name : (c ? c.name : "");
          const haystack = [entry.gateEntryNo, supplierName, entry.invoiceNo, entry.truckNo]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchTerm.toLowerCase());
        })
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
          return timeB - timeA;
        }),
    [gateEntries, searchTerm, suppliers, companies]
  );

  const selectedEntry = pendingEntries.find((entry) => entry.id === selectedEntryId) || null;
  const selectedPhotos = selectedEntry
    ? gateEntryPhotos.filter((photo) => photo.gateEntryId === selectedEntry.id).sort((a, b) => a.slotNo - b.slotNo)
    : [];

  const getSupplierName = (supplierId: string) => {
    const s = suppliers.find((supplier) => supplier.id === supplierId);
    if (s) return s.name;
    const c = companies.find((company) => company.id === supplierId);
    if (c) return c.name;
    return "";
  };
  const getPhotoCount = (gateEntryId: string) => gateEntryPhotos.filter((photo) => photo.gateEntryId === gateEntryId).length;

  const handleCancel = async (entry: GateEntry) => {
    if (hasGateEntryMrr(entry)) {
      alert("Gate Entry cannot be cancelled after MRR is created.");
      return;
    }

    const reason = window.prompt(`Enter cancellation reason for ${entry.gateEntryNo || "this Gate Entry"}:`);
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) return;

    const timestamp = new Date().toISOString();
    const actor = user?.name || "System User";
    setCancellingId(entry.id);
    try {
      await setGateEntries((prev) =>
        prev.map((row) =>
          row.id === entry.id
            ? {
                ...row,
                status: "Cancelled",
                cancelReason: trimmedReason,
                cancelledAt: timestamp,
                cancelledBy: actor,
                updatedBy: actor,
                updateTimestamp: timestamp,
              }
            : row
        )
      );
      if (selectedEntryId === entry.id) setSelectedEntryId(null);
    } catch (error) {
      console.error("Failed to cancel gate entry:", error);
      alert("Failed to cancel Gate Entry. Please try again.");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Pending Material Receipt</h2>
          <p className="mt-1 text-sm text-slate-500">Gate entries where material receipt has not yet been created.</p>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-4 shadow-sm">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search gate entry no, supplier/customer, invoice no, truck no..."
          className="w-full max-w-xl rounded-xl border-2 border-black px-4 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              {["Gate Entry No", "Date", "Supplier/Customer", "Invoice No", "Invoice Value", "Truck No", "Photos", "Action"].map((heading) => (
                <th key={heading} className="whitespace-nowrap border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pendingEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className="border border-black px-6 py-10 text-center font-medium text-black">
                  No pending MRR gate entries found.
                </td>
              </tr>
            ) : (
              pendingEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="border border-black px-4 py-3 text-sm font-semibold text-black">{entry.gateEntryNo || "Syncing..."}</td>
                  <td className="border border-black px-4 py-3 text-sm text-black">{entry.date}</td>
                  <td className="border border-black px-4 py-3 text-sm text-black">{getSupplierName(entry.supplierId)}</td>
                  <td className="border border-black px-4 py-3 text-sm text-black">{entry.invoiceNo}</td>
                  <td className="border border-black px-4 py-3 text-sm text-black">{Number(entry.invoiceValue || 0).toFixed(2)}</td>
                  <td className="border border-black px-4 py-3 text-sm text-black">{entry.truckNo}</td>
                  <td className="border border-black px-4 py-3 text-sm text-black">{getPhotoCount(entry.id)} Photos</td>
                  <td className="border border-black px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/material-in/form?gateEntryId=${entry.id}`)}
                        className="inline-flex items-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                      >
                        Create MRR
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedEntryId(entry.id)}
                        className="inline-flex items-center gap-2 rounded border border-black px-3 py-2 text-sm font-semibold text-black transition hover:bg-slate-100"
                      >
                        <Eye size={15} /> View
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCancel(entry)}
                        disabled={cancellingId === entry.id}
                        className="inline-flex items-center gap-2 rounded border border-red-700 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-60"
                      >
                        <XCircle size={15} /> {cancellingId === entry.id ? "Cancelling..." : "Cancel"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-[24px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-black text-blue-700">{selectedEntry.gateEntryNo || "Gate Entry"}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {getSupplierName(selectedEntry.supplierId)} | Invoice {selectedEntry.invoiceNo} | Truck {selectedEntry.truckNo}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntryId(null)}
                className="rounded-full border border-slate-300 px-3 py-2 text-slate-700 transition hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <InfoCard label="Date" value={selectedEntry.date} />
              <InfoCard label="Supplier" value={getSupplierName(selectedEntry.supplierId)} />
              <InfoCard label="Invoice No" value={selectedEntry.invoiceNo} />
              <InfoCard label="Invoice Value" value={Number(selectedEntry.invoiceValue || 0).toFixed(2)} />
              <InfoCard label="Truck No" value={selectedEntry.truckNo} />
              <InfoCard label="MRR No" value={selectedEntry.mrrNo || "Pending"} />
              <InfoCard label="MRR Date" value={selectedEntry.mrrDate || "Pending"} />
              <InfoCard label="Photos" value={`${selectedPhotos.length}`} />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {selectedPhotos.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-medium text-slate-500">
                  No photos uploaded for this gate entry.
                </div>
              ) : (
                selectedPhotos.map((photo) => (
                  <div key={photo.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    {photo.photo && photo.photo.toLowerCase().endsWith(".pdf") ? (
                      <div className="h-44 w-full flex flex-col items-center justify-center bg-red-50 text-red-700 gap-2 border-b border-slate-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        <span className="text-xs font-bold uppercase">PDF Document</span>
                        <a href={`/uploads/${photo.photo}`} target="_blank" rel="noreferrer" className="mt-2 text-[10px] bg-red-700 text-white px-3 py-1 rounded-full uppercase tracking-wider hover:bg-red-800 transition">View PDF</a>
                      </div>
                    ) : (
                      <img
                        src={`/uploads/${photo.photo}`}
                        alt={`Gate entry slot ${photo.slotNo}`}
                        className="h-44 w-full object-cover"
                      />
                    )}
                    <div className="px-4 py-3 text-sm font-semibold text-slate-600">Pic {photo.slotNo}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value || "-"}</div>
    </div>
  );
}