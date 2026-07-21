import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Pencil, Plus, X, XCircle } from "lucide-react";
import { useData } from "../hooks/useData";
import { Company, GateEntry, GateEntryPhoto, Supplier } from "../types";
import { hasGateEntryMrr, isGateEntryCancelled } from "../lib/gateEntryState";
import { useAuth } from "../auth/AuthContext";

export function GateEntryMaster() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [gateEntryPhotos] = useData<GateEntryPhoto>("gate-entry-photos", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ filename: string; slotNo: number } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const filteredEntries = useMemo(
    () =>
      [...gateEntries]
        .filter((entry) => {
          const supplierName = getSupplierNameById(entry.supplierId, suppliers, companies);
          const haystack = [
            entry.gateEntryNo,
            supplierName,
            entry.invoiceNo,
            entry.truckNo,
            entry.status,
            entry.cancelReason,
          ]
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

  const selectedEntry = filteredEntries.find((entry) => entry.id === selectedEntryId) || null;
  const selectedPhotos = selectedEntry
    ? gateEntryPhotos
        .filter((photo) => photo.gateEntryId === selectedEntry.id)
        .sort((a, b) => a.slotNo - b.slotNo)
    : [];

  const getSupplierName = (supplierId: string) => getSupplierNameById(supplierId, suppliers, companies);

  const getPhotoCount = (gateEntryId: string) => gateEntryPhotos.filter((photo) => photo.gateEntryId === gateEntryId).length;

  const handleCancel = async (entry: GateEntry) => {
    if (hasGateEntryMrr(entry)) {
      alert("Gate Entry cannot be cancelled after MRR is created.");
      return;
    }
    if (isGateEntryCancelled(entry)) return;

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
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Gate Entry Master</h2>
        <button
          type="button"
          onClick={() => navigate("/gate-entry/form")}
          className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 font-bold text-white transition hover:bg-indigo-700"
        >
          <Plus size={16} /> Add Gate Entry
        </button>
      </div>

      <div className="rounded border border-black bg-white p-4 shadow-sm">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search gate entry no, supplier, invoice no, truck no, status..."
          className="w-full max-w-xl rounded-xl border-2 border-black px-4 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-600"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              {["Gate Entry No", "Date", "Supplier Name", "Invoice No", "Invoice Value", "Truck No", "Status", "MRR No", "Cancel Details", "Photos", "Action"].map((heading) => (
                <th key={heading} className="whitespace-nowrap border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={11} className="border border-black px-6 py-10 text-center font-medium text-black">
                  No gate entries found.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => {
                const cancelled = isGateEntryCancelled(entry);
                const linkedMrr = hasGateEntryMrr(entry);
                const editable = !linkedMrr && !cancelled;
                return (
                  <tr key={entry.id} className={cancelled ? "bg-red-50/50" : "hover:bg-slate-50"}>
                    <td className="border border-black px-4 py-3 text-sm font-semibold text-black">{entry.gateEntryNo || "Syncing..."}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{entry.date}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{getSupplierName(entry.supplierId)}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{entry.invoiceNo}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{Number(entry.invoiceValue || 0).toFixed(2)}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{entry.truckNo}</td>
                    <td className="border border-black px-4 py-3 text-sm font-bold">
                      <span className={cancelled ? "text-red-700" : "text-emerald-700"}>{cancelled ? "Cancelled" : "Active"}</span>
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{entry.mrrNo || "-"}</td>
                    <td className="border border-black px-4 py-3 text-xs text-black">
                      {cancelled ? (
                        <div className="max-w-[260px] space-y-1">
                          <div className="font-bold text-red-800">{entry.cancelReason || "No reason"}</div>
                          <div>{entry.cancelledAt ? new Date(entry.cancelledAt).toLocaleString() : "-"}</div>
                          <div>{entry.cancelledBy || "System User"}</div>
                        </div>
                      ) : "-"}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{getPhotoCount(entry.id)} Photos</td>
                    <td className="border border-black px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedEntryId(entry.id)}
                          className="inline-flex items-center gap-2 rounded border border-black px-3 py-2 text-sm font-semibold text-black transition hover:bg-slate-100"
                        >
                          <Eye size={15} /> View
                        </button>
                        {editable ? (
                          <>
                            <button
                              type="button"
                              onClick={() => navigate(`/gate-entry/form?id=${entry.id}`)}
                              className="inline-flex items-center gap-2 rounded border border-indigo-700 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 transition hover:bg-indigo-100"
                            >
                              <Pencil size={15} /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCancel(entry)}
                              disabled={cancellingId === entry.id}
                              className="inline-flex items-center gap-2 rounded border border-red-700 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-60"
                            >
                              <XCircle size={15} /> {cancellingId === entry.id ? "Cancelling..." : "Cancel"}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
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
                className="rounded-full border border-slate-300 p-2 text-slate-700 transition hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <InfoCard label="Date" value={selectedEntry.date} />
              <InfoCard label="Supplier" value={getSupplierName(selectedEntry.supplierId)} />
              <InfoCard label="Invoice No" value={selectedEntry.invoiceNo} />
              <InfoCard label="Invoice Value" value={Number(selectedEntry.invoiceValue || 0).toFixed(2)} />
              <InfoCard label="Truck No" value={selectedEntry.truckNo} />
              <InfoCard label="Status" value={isGateEntryCancelled(selectedEntry) ? "Cancelled" : "Active"} />
              <InfoCard label="MRR No" value={selectedEntry.mrrNo || "Pending"} />
              <InfoCard label="MRR Date" value={selectedEntry.mrrDate || "Pending"} />
              <InfoCard label="Cancel Reason" value={selectedEntry.cancelReason || "-"} />
              <InfoCard label="Cancelled By" value={selectedEntry.cancelledBy || "-"} />
              <InfoCard label="Cancelled At" value={selectedEntry.cancelledAt ? new Date(selectedEntry.cancelledAt).toLocaleString() : "-"} />
              <InfoCard label="Photos" value={`${selectedPhotos.length}`} />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {selectedPhotos.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-medium text-slate-500">
                  No photos uploaded for this gate entry.
                </div>
              ) : (
                selectedPhotos.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    filename={photo.photo}
                    slotNo={photo.slotNo}
                    onPreview={(filename, photoSlotNo) => setPreviewPhoto({ filename, slotNo: photoSlotNo })}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {previewPhoto ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
          <div className="relative w-full max-w-5xl rounded-2xl bg-white p-3 shadow-2xl">
            <button
              type="button"
              onClick={() => setPreviewPhoto(null)}
              className="absolute right-3 top-3 rounded-full border border-slate-300 bg-white p-2 text-slate-700 transition hover:bg-slate-100"
            >
              <X size={18} />
            </button>
            <img
              src={`/uploads/${previewPhoto.filename}`}
              alt={`Gate entry slot ${previewPhoto.slotNo}`}
              className="max-h-[80vh] w-full rounded-xl object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getSupplierNameById(supplierId: string, suppliers: Supplier[], companies: Company[]) {
  const supplier = suppliers.find((row) => row.id === supplierId);
  if (supplier) return supplier.name;
  const company = companies.find((row) => row.id === supplierId);
  if (company) return company.name;
  return "";
}

function PhotoCard({
  filename,
  slotNo,
  onPreview,
}: {
  filename: string;
  slotNo: number;
  onPreview: (filename: string, slotNo: number) => void;
}) {
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const href = `/uploads/${filename}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      {isPdf ? (
        <div className="flex h-44 w-full flex-col items-center justify-center gap-2 border-b border-slate-200 bg-red-50 text-red-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          <span className="text-xs font-bold uppercase">PDF Document</span>
          <a href={href} target="_blank" rel="noreferrer" className="mt-2 rounded-full bg-red-700 px-3 py-1 text-[10px] uppercase tracking-wider text-white transition hover:bg-red-800">View PDF</a>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onPreview(filename, slotNo)}
          className="block w-full border-b border-slate-200"
        >
          <img
            src={href}
            alt={`Gate entry slot ${slotNo}`}
            className="h-44 w-full cursor-zoom-in object-cover"
          />
        </button>
      )}
      <div className="px-4 py-3 text-sm font-semibold text-slate-600">Pic {slotNo}</div>
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