import React, { useMemo, useState } from "react";
import { Spinner } from "../components/Spinner";
import { useData } from "../hooks/useData";
import { GstRateMaster } from "../types";

export function GstRateMasters() {
  const [rates, setRates] = useData<GstRateMaster>("gst_rate_masters", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [active, setActive] = useState<"Yes" | "No">("Yes");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredRates = useMemo(
    () =>
      [...rates]
        .filter((entry) => {
          const q = searchTerm.toLowerCase();
          return entry.name.toLowerCase().includes(q) || String(entry.rate || "").includes(q);
        })
        .sort((a, b) => Number(a.rate || 0) - Number(b.rate || 0) || a.name.localeCompare(b.name)),
    [rates, searchTerm]
  );

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setRate("");
    setActive("Yes");
    setIsFormOpen(true);
  };

  const openEdit = (entry: GstRateMaster) => {
    setEditingId(entry.id);
    setName(entry.name);
    setRate(String(entry.rate ?? ""));
    setActive(entry.active === "No" ? "No" : "Yes");
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setEditingId(null);
    setName("");
    setRate("");
    setActive("Yes");
    setIsFormOpen(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const parsedRate = Number(rate);
    if (!normalizedName || !Number.isFinite(parsedRate)) return;

    const duplicate = rates.some(
      (entry) =>
        entry.id !== editingId &&
        (entry.name.toLowerCase() === normalizedName.toLowerCase() || Number(entry.rate || 0) === parsedRate)
    );
    if (duplicate) {
      alert("A GST rate with the same name or value already exists.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextRow: GstRateMaster = {
        id: editingId || crypto.randomUUID(),
        name: normalizedName,
        rate: parsedRate,
        active,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
      await setRates(editingId ? rates.map((entry) => (entry.id === editingId ? nextRow : entry)) : [nextRow, ...rates]);
      closeForm();
    } catch (error) {
      console.error("Failed to save GST rate:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {isFormOpen ? (
        <div className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-200 max-w-5xl mx-auto">
          <div className="flex justify-between items-start gap-4 mb-8">
            <h2 className="text-3xl font-black text-blue-700">{editingId ? "Edit GST Rate" : "New GST Rate"}</h2>
            <div className="flex items-center gap-3">
              <button type="button" onClick={closeForm} className="px-8 py-3 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition">
                Back
              </button>
              <button type="submit" form="gst-rate-form" disabled={isSubmitting} className="px-8 py-3 rounded-2xl bg-indigo-700 text-white font-bold hover:bg-indigo-800 transition disabled:opacity-50">
                {isSubmitting ? <Spinner size={18} className="text-white" /> : "Save"}
              </button>
            </div>
          </div>
          <form id="gst-rate-form" onSubmit={handleSubmit} className="max-w-xl space-y-5">
            <div className="space-y-2">
              <label className="text-blue-700 font-bold">GST Name <span className="text-red-500">*</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="GST 18%" autoFocus required className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="space-y-2">
              <label className="text-blue-700 font-bold">Rate % <span className="text-red-500">*</span></label>
              <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="18" required className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="space-y-2">
              <label className="text-blue-700 font-bold">Active</label>
              <select value={active} onChange={(e) => setActive(e.target.value === "No" ? "No" : "Yes")} className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap justify-between items-center gap-4">
            <h2 className="text-3xl font-black text-blue-700">GST Rate Master</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search GST rate" className="w-[320px] max-w-full rounded-full border border-slate-300 px-6 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button type="button" onClick={openCreate} className="px-7 py-3 rounded-2xl bg-indigo-700 text-white font-bold hover:bg-indigo-800 transition">
                + GST Rate
              </button>
            </div>
          </div>
          <div className="bg-white rounded-[22px] border border-slate-300 overflow-hidden">
            <div className="px-4 py-3 text-slate-600">Showing {filteredRates.length} entries</div>
            <div className="table-sticky-scroll">
              <table className="min-w-full border-collapse">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-indigo-700 text-white">
                    <th className="px-4 py-4 text-left text-sm font-bold border-2 border-black">Name</th>
                    <th className="px-4 py-4 text-left text-sm font-bold border-2 border-black">Rate %</th>
                    <th className="px-4 py-4 text-left text-sm font-bold border-2 border-black">Active</th>
                    <th className="px-4 py-4 text-right text-sm font-bold border-2 border-black">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRates.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center border-2 border-black">No GST rates found.</td>
                    </tr>
                  ) : (
                    filteredRates.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-5 text-black font-bold border-2 border-black">{entry.name}</td>
                        <td className="px-4 py-5 text-black border-2 border-black">{Number(entry.rate || 0).toFixed(2)}%</td>
                        <td className="px-4 py-5 text-black border-2 border-black">{entry.active || "Yes"}</td>
                        <td className="px-4 py-3 text-right border-2 border-black">
                          <button type="button" onClick={() => openEdit(entry)} className="px-6 py-2 rounded-xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition">
                            Open
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
