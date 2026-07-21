import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Machine, Production, ProductionProcessing } from "../types";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { TableControls } from "../components/TableControls";
import { useNavigate } from "react-router-dom";
import { formatDate } from "../lib/serial";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { useAuth } from "../auth/AuthContext";

type EditDraft = {
  date: string;
  productionId: string;
  machineId: string;
  shift: "" | "Day" | "Night";
  qty: string;
};

const blankDraft: EditDraft = {
  date: "",
  productionId: "",
  machineId: "",
  shift: "",
  qty: "",
};

export function ProductionProcessingMaster() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [processing, setProcessing] = useData<ProductionProcessing>("production_processing", []);
  const [productions] = useData<Production>("productions", []);
  const [machines] = useData<Machine>("machines", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(blankDraft);

  const productionOptions = useMemo(() => {
    return [...productions]
      .filter((production) => production.status !== "Cancelled")
      .sort((a, b) => String(b.transactionNo || "").localeCompare(String(a.transactionNo || ""), undefined, { numeric: true, sensitivity: "base" }))
      .map((production) => ({
        value: production.id,
        label: `${String(production.jobCardNo || "").trim() || production.transactionNo} (Qty: ${production.qty})`,
      }));
  }, [productions]);

  const machineOptions = useMemo(() => {
    return [...machines]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((machine) => ({ value: machine.id, label: normalizeMachineName(machine.name) }));
  }, [machines]);

  const startEdit = (item: ProductionProcessing) => {
    setDeletingId(null);
    setEditingId(item.id);
    setEditDraft({
      date: String(item.date || "").slice(0, 10),
      productionId: item.productionId || "",
      machineId: item.machineId || "",
      shift: (item.shift as "Day" | "Night") || "Day",
      qty: String(item.qty || ""),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(blankDraft);
  };

  const handleSaveEdit = (id: string) => {
    const selectedProduction = productions.find((production) => production.id === editDraft.productionId);
    const selectedMachine = machines.find((machine) => machine.id === editDraft.machineId);
    const qtyNumber = Number(editDraft.qty);

    if (!editDraft.date || !selectedProduction || !selectedMachine || !editDraft.shift) {
      alert("Please fill Date, Job No, Machine, and Shift before saving.");
      return;
    }

    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      alert("Please enter a quantity greater than 0.");
      return;
    }

    const auditUserName = user?.name || "System User";
    const normalizedMachineName = normalizeMachineName(selectedMachine.name);
    const timestamp = new Date().toISOString();

    setProcessing((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              date: editDraft.date,
              productionId: selectedProduction.id,
              jobNo: selectedProduction.jobCardNo || selectedProduction.transactionNo,
              machineId: selectedMachine.id,
              machineName: normalizedMachineName,
              shift: editDraft.shift as "Day" | "Night",
              qty: qtyNumber,
              erp: selectedProduction.erpCode || item.erp,
              updatedBy: auditUserName,
              updateTimestamp: timestamp,
            }
          : item
      )
    );
    cancelEdit();
  };

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setEditingId(null);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setProcessing((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  const filtered = useMemo(() => {
    return processing
      .filter((p) => {
        const query = searchTerm.toLowerCase();
        const matchesSearch = (
          String(p.jobNo || "").toLowerCase().includes(query) ||
          (p.machineName || "").toLowerCase().includes(query) ||
          String(p.shift || "Day").toLowerCase().includes(query) ||
          String(p.itemName || "").toLowerCase().includes(query) ||
          String(p.erp || "").toLowerCase().includes(query) ||
          String(p.boxType || "").toLowerCase().includes(query)
        );
        const matchesFrom = !fromDate || String(p.date || "") >= fromDate;
        const matchesTo = !toDate || String(p.date || "") <= toDate;
        return matchesSearch && matchesFrom && matchesTo;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [processing, searchTerm, fromDate, toDate]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Reporting Master</h2>
        <button 
          onClick={() => navigate("/production-processing/form")} 
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
        >
          <Plus size={18} /> New Report
        </button>
      </div>

      <div className="flex flex-nowrap items-center gap-3 overflow-x-auto">
        <div className="min-w-0 flex-1">
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search by Job No, Machine, Item, or ERP..." />
        </div>
        <div className="flex shrink-0 items-end gap-3 rounded border border-black bg-white px-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-600">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded border border-black bg-white px-2 py-1.5 text-sm font-semibold outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-600">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded border border-black bg-white px-2 py-1.5 text-sm font-semibold outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            className="rounded border border-black bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase hover:bg-slate-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Date</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Job No</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Item Name</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">ERP</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Box Type</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Shift</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border border-black">Quantity</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border border-black">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-slate-500 font-medium border border-black">No reporting records found.</td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const isEditing = editingId === item.id;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editDraft.date}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, date: e.target.value }))}
                            className="w-36 rounded border border-black bg-white px-2 py-1.5 text-xs font-semibold outline-none"
                          />
                        ) : (
                          formatDate(item.date)
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">
                        {isEditing ? (
                          <select
                            value={editDraft.productionId}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, productionId: e.target.value }))}
                            className="w-56 rounded border border-black bg-white px-2 py-1.5 text-xs font-semibold outline-none"
                          >
                            <option value="">Select job...</option>
                            {productionOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          item.jobNo
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{item.itemName || "-"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{item.erp || "-"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{item.boxType || "-"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">
                        {isEditing ? (
                          <select
                            value={editDraft.machineId}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, machineId: e.target.value }))}
                            className="w-44 rounded border border-black bg-white px-2 py-1.5 text-xs font-semibold outline-none"
                          >
                            <option value="">Select machine...</option>
                            {machineOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          item.machineName
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">
                        {isEditing ? (
                          <select
                            value={editDraft.shift}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, shift: e.target.value as "" | "Day" | "Night" }))}
                            className="w-28 rounded border border-black bg-white px-2 py-1.5 text-xs font-semibold outline-none"
                          >
                            <option value="">Shift...</option>
                            <option value="Day">Day</option>
                            <option value="Night">Night</option>
                          </select>
                        ) : (
                          item.shift || "Day"
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-right text-emerald-700 border border-black">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="0.00001"
                            value={editDraft.qty}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, qty: e.target.value }))}
                            className="w-28 rounded border border-black bg-white px-2 py-1.5 text-right text-xs font-semibold outline-none"
                          />
                        ) : (
                          Number(item.qty || 0).toLocaleString()
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium border border-black">
                        {isEditing ? (
                          <div className="inline-flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(item.id)}
                              className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:text-emerald-900"
                            >
                              <Save size={16} /> Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="inline-flex items-center gap-1 font-bold text-slate-600 hover:text-black"
                            >
                              <X size={16} /> Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:text-indigo-900"
                            >
                              <Pencil size={16} /> Edit
                            </button>
                            <button 
                              type="button"
                              onClick={() => handleDelete(item.id)} 
                              className={`${deletingId === item.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                            >
                              <Trash2 size={16} className="mr-1" /> {deletingId === item.id ? "Confirm?" : "Delete"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}