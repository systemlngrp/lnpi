import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { TableControls } from "../components/TableControls";
import { ColorMaster } from "../types";

export function ColorMasters() {
  const [colors, setColors] = useData<ColorMaster>("color_masters", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setColors(colors.filter((color) => color.id !== id));
    setDeletingId(null);
  };

  const resetForm = () => {
    setName("");
    setEditingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const isDuplicate = colors.some(
      (color) => color.name.toLowerCase() === name.trim().toLowerCase() && color.id !== editingId
    );

    if (isDuplicate) {
      alert("A color with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = {
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString(),
      };

      if (editingId) {
        setColors(colors.map((color) => (color.id === editingId ? { ...color, name: name.trim(), ...audit } : color)));
      } else {
        setColors([...colors, { id: crypto.randomUUID(), name: name.trim(), ...audit }]);
      }

      resetForm();
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  const filteredColors = colors
    .filter((color) => color.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
      const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
      return timeB - timeA || a.name.localeCompare(b.name);
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Color Master</h2>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
          >
            <Plus size={18} /> Add New Color
          </button>
        )}
      </div>

      {isFormOpen ? (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">
            {editingId ? "Edit Color" : "Create Color"}
          </h3>
          <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="flex flex-col space-y-1">
              <label htmlFor="name" className="font-bold text-black">Color Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>
            <div className="flex space-x-3 pt-2 items-center">
              <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition border border-black min-w-[100px]">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
              </button>
              <button type="button" onClick={() => { setIsFormOpen(false); resetForm(); }} className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-50 transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search colors..." />
          <div className="bg-white rounded shadow-sm border border-black table-sticky-scroll">
            <div className="block md:hidden space-y-4 p-2">
              {filteredColors.map((color) => (
                <div key={color.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                  <div className="flex justify-between items-center">
                    <div className="font-bold">{color.name}</div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setName(color.name); setEditingId(color.id); setIsFormOpen(true); }} className="text-indigo-600 hover:text-indigo-900 font-bold"><Edit size={16} /></button>
                      <button onClick={() => handleDelete(color.id)} className={`${deletingId === color.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold`}><Trash2 size={16} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
              <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                  <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Color Name</th>
                  <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredColors.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-6 py-8 text-center text-black font-medium">No colors found.</td>
                  </tr>
                ) : (
                  filteredColors.map((color) => (
                    <tr key={color.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-6 py-4 text-sm text-black border border-black">{color.name}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                        <button onClick={() => { setName(color.name); setEditingId(color.id); setIsFormOpen(true); }} className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center">
                          <Edit size={16} className="mr-1" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(color.id)}
                          className={`${deletingId === color.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                        >
                          <Trash2 size={16} className="mr-1" /> {deletingId === color.id ? "Confirm?" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
