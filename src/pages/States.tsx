import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StateMaster } from "../types";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";

export function States() {
  const navigate = useNavigate();
  const [states, setStates] = useData<StateMaster>("states", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [active, setActive] = useState<"Yes" | "No">("Yes");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredStates = useMemo(
    () =>
      [...states]
        .filter((state) => state.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [searchTerm, states]
  );

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setActive("Yes");
    setIsFormOpen(true);
  };

  const openEdit = (state: StateMaster) => {
    setEditingId(state.id);
    setName(state.name);
    setActive(state.active === "No" ? "No" : "Yes");
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setEditingId(null);
    setName("");
    setActive("Yes");
    setIsFormOpen(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    const normalizedName = name.trim();
    const duplicate = states.some(
      (state) => state.id !== editingId && state.name.toLowerCase() === normalizedName.toLowerCase()
    );

    if (duplicate) {
      alert("A state with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextState: StateMaster = {
        id: editingId || crypto.randomUUID(),
        name: normalizedName,
        active,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      await setStates(editingId ? states.map((state) => (state.id === editingId ? nextState : state)) : [nextState, ...states]);
      closeForm();
    } catch (error) {
      console.error("Failed to save state:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {isFormOpen ? (
        <div className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-200 max-w-5xl mx-auto">
          <div className="flex justify-between items-start gap-4 mb-8">
            <h2 className="text-3xl font-black text-blue-700">{editingId ? "Edit State" : "New State"}</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={closeForm}
                className="px-8 py-3 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
              >
                Back
              </button>
              <button
                type="submit"
                form="state-form"
                disabled={isSubmitting}
                className="px-8 py-3 rounded-2xl bg-indigo-700 text-white font-bold hover:bg-indigo-800 transition disabled:opacity-50"
              >
                {isSubmitting ? <Spinner size={18} className="text-white" /> : "Save"}
              </button>
            </div>
          </div>

          <form id="state-form" onSubmit={handleSubmit} className="max-w-xl space-y-5">
            <div className="space-y-2">
              <label className="text-blue-700 font-bold">
                State Name <span className="text-red-500">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="State name"
                autoFocus
                required
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-blue-700 font-bold">Active</label>
              <select
                value={active}
                onChange={(e) => setActive(e.target.value === "No" ? "No" : "Yes")}
                className="w-full rounded-2xl border border-slate-300 px-5 py-4 text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap justify-between items-center gap-4">
            <h2 className="text-3xl font-black text-blue-700">State Master</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search state"
                className="w-[280px] max-w-full rounded-full border border-slate-300 px-6 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-7 py-3 rounded-2xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
              >
                Back
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="px-7 py-3 rounded-2xl bg-indigo-700 text-white font-bold hover:bg-indigo-800 transition"
              >
                + State
              </button>
            </div>
          </div>

          <div className="bg-white rounded-[22px] border border-slate-300 overflow-hidden">
            <div className="px-4 py-3 text-slate-600">Showing {filteredStates.length} entries</div>
            <div className="table-sticky-scroll">
              <table className="min-w-full border-collapse">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-indigo-700 text-white">
                    <th className="px-4 py-4 text-left text-sm font-bold border-2 border-black">State</th>
                    <th className="px-4 py-4 text-left text-sm font-bold border-2 border-black">Active</th>
                    <th className="px-4 py-4 text-right text-sm font-bold border-2 border-black">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStates.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-10 text-center border-2 border-black">
                        No states found.
                      </td>
                    </tr>
                  ) : (
                    filteredStates.map((state) => (
                      <tr key={state.id}>
                        <td className="px-4 py-5 text-black font-bold border-2 border-black">{state.name}</td>
                        <td className="px-4 py-5 text-black border-2 border-black">{state.active || "Yes"}</td>
                        <td className="px-4 py-3 text-right border-2 border-black">
                          <button
                            type="button"
                            onClick={() => openEdit(state)}
                            className="px-6 py-2 rounded-xl border border-slate-300 text-indigo-700 font-bold hover:bg-slate-50 transition"
                          >
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
