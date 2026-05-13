import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Supplier } from "../types";
import { Spinner } from "../components/Spinner";

export function Suppliers() {
  const [suppliers, setSuppliers, isLoading] = useData<Supplier>("suppliers", []);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Duplicate check
    const isDuplicate = suppliers.some(s => 
      s.name.toLowerCase() === name.trim().toLowerCase() && s.id !== editingId
    );

    if (isDuplicate) {
      alert("A supplier with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() };
      if (editingId) {
        setSuppliers(suppliers.map(s => s.id === editingId ? { ...s, name: name.trim(), ...audit } : s));
      } else {
        setSuppliers([...suppliers, { id: crypto.randomUUID(), name: name.trim(), ...audit }]);
      }
      
      setName("");
      setEditingId(null);
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setSuppliers(suppliers.filter(s => s.id !== id));
    setDeletingId(null);
  };

  const handleEdit = (supplier: Supplier) => {
    setName(supplier.name);
    setEditingId(supplier.id);
    setIsFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Suppliers Master</h2>
        <button
          onClick={() => {
            setIsFormOpen(!isFormOpen);
            if (isFormOpen) {
              setEditingId(null);
              setName("");
            }
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition flex items-center"
        >
          {isFormOpen ? "Close Form" : <><Plus size={20} className="mr-2" /> Add New Supplier</>}
        </button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-black space-y-4 max-w-xl">
          <div className="flex flex-col space-y-1">
            <label htmlFor="name" className="font-bold text-black">
              Supplier Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
            />
          </div>
          <div className="flex space-x-3 pt-2 items-center">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center min-w-[100px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                setEditingId(null);
                setName("");
              }}
              disabled={isSubmitting}
              className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-100 transition disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4">
            {suppliers.sort((a, b) => {
                const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                return timeB - timeA || a.name.localeCompare(b.name);
            }).map((supplier) => (
                <div key={supplier.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex justify-between items-center">
                        <div className="text-sm font-bold">{supplier.name}</div>
                        <div className="flex items-center gap-2">
                             <button
                                onClick={() => handleEdit(supplier)}
                                disabled={isSubmitting}
                                className="text-indigo-600 hover:text-indigo-900 flex items-center disabled:opacity-50 font-bold"
                            >
                                <Edit size={16} />
                            </button>
                            <button
                                onClick={() => handleDelete(supplier.id)}
                                className={`${deletingId === supplier.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold flex items-center`}
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-6 py-8 text-center text-black font-medium tracking-wide">
                  {isSubmitting ? <div className="flex justify-center"><Spinner /></div> : 'No suppliers found. Click "Add New Supplier" to create one.'}
                </td>
              </tr>
            ) : (
              suppliers.sort((a, b) => {
                const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                return timeB - timeA || a.name.localeCompare(b.name);
              }).map((supplier) => (
                <tr key={supplier.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{supplier.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium border border-black">
                    <button
                      onClick={() => handleEdit(supplier)}
                      disabled={isSubmitting}
                      className="text-indigo-600 hover:text-indigo-900 inline-flex items-center mr-4 disabled:opacity-50 font-bold"
                    >
                      <Edit size={16} className="mr-1" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(supplier.id)}
                      className={`${deletingId === supplier.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === supplier.id ? "Confirm?" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
