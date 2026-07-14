import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialGroup } from "../types";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { TableControls } from "../components/TableControls";

export function MaterialGroups() {
  const [groups, setGroups] = useData<MaterialGroup>("material-groups", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setEditingId(null);
    setIsFormOpen(false);
  };

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setGroups(groups.filter((group) => group.id !== id));
    setDeletingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const normalizedName = name.trim();
    const isDuplicate = groups.some(
      (group) => group.name.toLowerCase() === normalizedName.toLowerCase() && group.id !== editingId
    );

    if (isDuplicate) {
      alert("A material group with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = {
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString(),
      };

      if (editingId) {
        setGroups(groups.map((group) => (group.id === editingId ? { ...group, name: normalizedName, ...audit } : group)));
      } else {
        setGroups([...groups, { id: crypto.randomUUID(), name: normalizedName, ...audit }]);
      }

      setIsSubmitting(false);
      resetForm();
    }, 300);
  };

  const filteredGroups = groups
    .filter((group) => group.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
      const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
      return timeB - timeA || a.name.localeCompare(b.name);
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Groups Master</h2>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
          >
            <Plus size={18} /> Add New Group
          </button>
        )}
      </div>

      {isFormOpen ? (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">
            {editingId ? "Edit Material Group" : "Create Material Group"}
          </h3>
          <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="flex flex-col space-y-1">
              <label htmlFor="material-group-name" className="font-bold text-black">
                Group Name *
              </label>
              <input
                id="material-group-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>
            <div className="flex space-x-3 pt-2 items-center">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition border border-black min-w-[100px]"
              >
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search groups..." />
          <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
            <div className="block md:hidden space-y-4 p-2">
              {filteredGroups.map((group) => (
                <div key={group.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                  <div className="flex justify-between items-center">
                    <div className="font-bold">{group.name}</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setName(group.name);
                          setEditingId(group.id);
                          setIsFormOpen(true);
                        }}
                        className="text-indigo-600 hover:text-indigo-900 font-bold"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(group.id)}
                        className={`${deletingId === group.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
              <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                  <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Group Name</th>
                  <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-6 py-8 text-center text-black font-medium">
                      No material groups found.
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map((group) => (
                    <tr key={group.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-6 py-4 text-sm text-black border border-black">{group.name}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                        <button
                          onClick={() => {
                            setName(group.name);
                            setEditingId(group.id);
                            setIsFormOpen(true);
                          }}
                          className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center"
                        >
                          <Edit size={16} className="mr-1" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(group.id)}
                          className={`${deletingId === group.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                        >
                          <Trash2 size={16} className="mr-1" /> {deletingId === group.id ? "Confirm?" : "Delete"}
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
