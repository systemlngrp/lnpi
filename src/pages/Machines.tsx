import React, { useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Machine } from "../types";
import { Spinner } from "../components/Spinner";
import { TableControls } from "../components/TableControls";

const DEFAULT_MACHINES = [
  "Corrugation Finger",
  "Corrugation Linear",
  "Printing",
  "Pasting",
  "Rotary",
  "Stitching",
  "Punching",
  "Gluing"
];

export function Machines() {
  const [machines, setMachines] = useData<Machine>("machines", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Initialize default machines if list is empty
  useEffect(() => {
    if (machines.length === 0) {
      const initial = DEFAULT_MACHINES.map(m => ({
        id: crypto.randomUUID(),
        name: m,
        updatedBy: "System",
        updateTimestamp: new Date().toISOString()
      }));
      setMachines(initial);
    }
  }, [machines.length, setMachines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (machines.some(m => m.name.toLowerCase() === name.trim().toLowerCase() && m.id !== editingId)) {
      alert("Machine already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() };
      if (editingId) {
        setMachines(machines.map(m => m.id === editingId ? { ...m, name: name.trim(), ...audit } : m));
      } else {
        setMachines([...machines, { id: crypto.randomUUID(), name: name.trim(), ...audit }]);
      }
      setName("");
      setEditingId(null);
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMachines(machines.filter(m => m.id !== id));
    setDeletingId(null);
  };

  const filtered = machines.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Machines Master</h2>
        {!isFormOpen && (
          <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow">
            <Plus size={18} /> Add Machine
          </button>
        )}
      </div>

      {isFormOpen && (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-md">
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
            <div className="flex space-x-3 pt-4 border-t border-black">
              <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-8 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save"}
              </button>
              <button type="button" onClick={() => { setIsFormOpen(false); setName(""); setEditingId(null); }} className="bg-white text-black border-2 border-black px-8 py-2 rounded font-bold hover:bg-slate-50 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search machines..." />
      
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Machine Name</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider md:block hidden">Updated</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {filtered.map((machine) => (
              <tr key={machine.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black">{machine.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500 md:block hidden">
                  {machine.updatedBy}<br />{new Date(machine.updateTimestamp || "").toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button onClick={() => { setName(machine.name); setEditingId(machine.id); setIsFormOpen(true); }} className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center">
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
