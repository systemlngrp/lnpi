import React, { useState, useEffect, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Machine, UnitMaster, User } from "../types";
import { Spinner } from "../components/Spinner";
import { TableControls } from "../components/TableControls";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { normalizeMachineName } from "../lib/productionMachineNames";

const DEFAULT_MACHINES = [
  "Corrugation Paper",
  "Corrugation Liner",
  "Printing",
  "Pasting",
  "Rotary",
  "Stitching",
  "Diecuting",
  "Punching",
  "Gluing"
];

export function Machines() {
  const [machines, setMachines, machinesLoading] = useData<Machine>("machines", []);
  const [users] = useData<User>("users", []);
  const [units] = useData<UnitMaster>("units", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [maxOutputPerHour, setMaxOutputPerHour] = useState<number | "">("");
  const [uom, setUom] = useState("");
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const operatorUsers = useMemo(
    () =>
      users
        .filter((user) => user.status !== "Inactive" && user.role === "Operator")
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [users]
  );

  const operatorNameById = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users]);

  const unitOptions = useMemo(
    () =>
      [...units]
        .filter((unit) => unit.active !== "No" && unit.name.trim())
        .map((unit) => unit.name.trim().toUpperCase())
        .filter((unitName, index, list) => list.indexOf(unitName) === index)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [units]
  );

  // Seed defaults once data has finished loading, and only for missing names.
  useEffect(() => {
    if (machinesLoading) return;

    const existing = new Set(
      machines.map((machine) => normalizeMachineName(machine.name).trim().toLowerCase()).filter(Boolean)
    );

    const missing = DEFAULT_MACHINES.filter(
      (machineName) => !existing.has(normalizeMachineName(machineName).trim().toLowerCase())
    );

    if (missing.length === 0) return;

    const timestamp = new Date().toISOString();
    setMachines((prev) => [
      ...prev,
      ...missing.map((machineName) => ({
        id: crypto.randomUUID(),
        name: normalizeMachineName(machineName),
        maxOutputPerHour: 0,
        uom: "",
        updatedBy: "System",
        updateTimestamp: timestamp,
      })),
    ]);
  }, [machines, machinesLoading, setMachines]);

  // Normalize existing machine names to keep reports consistent.
  // Runs after load and only writes when there are actual changes.
  useEffect(() => {
    if (machinesLoading || machines.length === 0) return;
    const normalizedMachines = machines.map((machine) => {
      const normalizedName = normalizeMachineName(machine.name);
      return normalizedName === machine.name ? machine : { ...machine, name: normalizedName };
    });
    const hasChanges = normalizedMachines.some((machine, index) => machine.name !== machines[index].name);
    if (hasChanges) {
      setMachines(normalizedMachines);
    }
  }, [machines, machinesLoading, setMachines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const normalizedName = normalizeMachineName(name);

    if (machines.some(m => normalizeMachineName(m.name).toLowerCase() === normalizedName.toLowerCase() && m.id !== editingId)) {
      alert("Machine already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() };
      const assignedOperatorNames = selectedOperatorIds
        .map((operatorId) => operatorNameById.get(operatorId) || "")
        .filter(Boolean);
      const machineData = { 
        name: normalizedName, 
        maxOutputPerHour: maxOutputPerHour === "" ? 0 : Number(maxOutputPerHour),
        uom: uom.trim().toUpperCase(),
        assignedOperatorIds: selectedOperatorIds,
        assignedOperatorNames,
        ...audit 
      };

      if (editingId) {
        setMachines((prev) => prev.map((m) => (m.id === editingId ? { ...m, ...machineData } : m)));
      } else {
        setMachines((prev) => [...prev, { id: crypto.randomUUID(), ...machineData }]);
      }
      setName("");
      setMaxOutputPerHour("");
      setUom("");
      setSelectedOperatorIds([]);
      setEditingId(null);
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };


  const updateMachineUom = (machineId: string, nextUom: string) => {
    const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() };
    setMachines((prev) =>
      prev.map((machine) =>
        machine.id === machineId ? { ...machine, uom: nextUom.trim().toUpperCase(), ...audit } : machine
      )
    );
  };
  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMachines((prev) => prev.filter((m) => m.id !== id));
    setDeletingId(null);
  };

  const filtered = machines.filter(m => [normalizeMachineName(m.name), m.uom || ""].join(" ").toLowerCase().includes(searchTerm.toLowerCase()));

  const getAssignedOperatorNames = (machine: Machine) => {
    const savedNames = Array.isArray(machine.assignedOperatorNames) ? machine.assignedOperatorNames.filter(Boolean) : [];
    if (savedNames.length > 0) return savedNames;
    return (Array.isArray(machine.assignedOperatorIds) ? machine.assignedOperatorIds : [])
      .map((operatorId) => operatorNameById.get(operatorId) || "")
      .filter(Boolean);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Machines Master</h2>
        {!isFormOpen && (
          <button onClick={() => { setSelectedOperatorIds([]); setIsFormOpen(true); }} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow">
            <Plus size={18} /> Add Machine
          </button>
        )}
      </div>

      {isFormOpen && (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-2xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">{editingId ? "Edit Machine" : "Create Machine"}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Machine Name *</label>
              <input 
                autoFocus
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                required 
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600" 
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Maximum Per Hour</label>
                <input 
                  type="number" 
                  value={maxOutputPerHour} 
                  onChange={(e) => setMaxOutputPerHour(e.target.value === "" ? "" : Number(e.target.value))} 
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600" 
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">UOM</label>
                <select
                  value={uom}
                  onChange={(e) => setUom(e.target.value)}
                  className="border-2 border-black rounded p-2 uppercase text-black focus:outline-none focus:border-indigo-600 bg-white"
                >
                  <option value="">Select UOM</option>
                  {unitOptions.map((unitName) => (
                    <option key={unitName} value={unitName}>{unitName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col space-y-2">
              <label className="font-bold text-black text-sm">Assigned Operators</label>
              <div className="max-h-52 overflow-auto rounded border-2 border-black bg-slate-50 p-3">
                {operatorUsers.length === 0 ? (
                  <div className="text-xs font-bold text-slate-500">No active operator users available.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {operatorUsers.map((operator) => {
                      const checked = selectedOperatorIds.includes(operator.id);
                      return (
                        <label key={operator.id} className="flex items-center gap-2 text-sm font-bold text-black">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedOperatorIds((prev) =>
                                e.target.checked
                                  ? Array.from(new Set([...prev, operator.id]))
                                  : prev.filter((id) => id !== operator.id)
                              );
                            }}
                          />
                          <span>{operator.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex space-x-3 pt-4 border-t border-black">
              <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-8 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save"}
              </button>
              <button type="button" onClick={() => { setIsFormOpen(false); setName(""); setMaxOutputPerHour(""); setUom(""); setSelectedOperatorIds([]); setEditingId(null); }} className="bg-white text-black border-2 border-black px-8 py-2 rounded font-bold hover:bg-slate-50 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search machines..." />
      
      <DataSummaryTiles
        totalRecords={machines.length}
        filteredRecords={filtered.length}
        showingRecords={filtered.length}
        pageLabel="1 / 1"
      />
      
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="table-sticky-scroll">
          <table className="min-w-max divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="border border-black px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">SL No</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Machine Name</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Maximum Per Hour</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">UOM</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Assigned Operators</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Updated By</th>
                <th className="border border-black px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Updated Timestamp</th>
                <th className="border border-black px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-black">
              {machinesLoading ? (
                <tr>
                  <td colSpan={8} className="border border-black px-6 py-8 text-center text-black">
                    <div className="flex justify-center">
                      <Spinner />
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border border-black px-6 py-8 text-center text-black font-medium">
                    No machines found.
                  </td>
                </tr>
              ) : (
                filtered.map((machine, index) => (
                  <tr key={machine.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm font-bold text-black text-right">{index + 1}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm font-bold text-black">{normalizeMachineName(machine.name)}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm text-black">{machine.maxOutputPerHour || 0}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm font-bold uppercase text-black">{machine.uom || "-"}</td>
                    <td className="border border-black px-6 py-4 text-sm text-black">{getAssignedOperatorNames(machine).length > 0 ? getAssignedOperatorNames(machine).join(", ") : "-"}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm text-black">{machine.updatedBy || "-"}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-sm text-black">{machine.updateTimestamp ? new Date(machine.updateTimestamp).toLocaleString() : "-"}</td>
                    <td className="border border-black px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => { setName(normalizeMachineName(machine.name)); setMaxOutputPerHour(machine.maxOutputPerHour || ""); setUom(machine.uom || ""); setSelectedOperatorIds(Array.isArray(machine.assignedOperatorIds) ? machine.assignedOperatorIds : []); setEditingId(machine.id); setIsFormOpen(true); }} className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center">
                        <Edit size={16} className="mr-1" /> Edit
                      </button>
                      <button 
                        onClick={() => handleDelete(machine.id)} 
                        className={`${deletingId === machine.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                      >
                        <Trash2 size={16} className="mr-1" /> {deletingId === machine.id ? "Confirm?" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
