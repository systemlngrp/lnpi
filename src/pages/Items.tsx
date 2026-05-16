import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Item, ItemGroup } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { TableControls } from "../components/TableControls";

export function Items() {
  const [items, setItems] = useData<Item>("items", []);
  const [groups, setGroups] = useData<ItemGroup>("item-groups", []);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [uom, setUom] = useState("");
  const [erp, setErp] = useState<string>("");
  const [gstRate, setGstRate] = useState<string>("18");
  const [searchTerm, setSearchTerm] = useState("");

  const uomOptions = [
    { value: "KG", label: "KG" },
    { value: "PCs", label: "PCs" },
    { value: "Metre", label: "Metre" },
    { value: "Liter", label: "Liter" },
  ];

  const groupOptions = groups.map(g => ({ value: g.id, label: g.name }));

  const [showQuickGroup, setShowQuickGroup] = useState(false);
  const [quickGroupName, setQuickGroupName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setItems(items.filter(i => i.id !== id));
    setDeletingId(null);
  };

  const handleCreateNewGroup = () => {
    setShowQuickGroup(true);
  };

  const handleQuickGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickGroupName.trim()) return;

    if (groups.some(g => g.name.toLowerCase() === quickGroupName.trim().toLowerCase())) {
      alert("Group already exists.");
      return;
    }

    const newGroup: ItemGroup = { 
      id: crypto.randomUUID(), 
      name: quickGroupName.trim(),
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString()
    };
    setGroups([...groups, newGroup]);
    setGroupId(newGroup.id);
    setQuickGroupName("");
    setShowQuickGroup(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !groupId || !uom) return;

    // ERP must be integer if provided
    if (erp && !/^[0-9]+$/.test(erp)) {
      alert("ERP must be a whole number without decimals.");
      return;
    }

    const isDuplicate = items.some(i => 
      i.name.toLowerCase() === name.trim().toLowerCase() && i.id !== editingId
    );

    if (isDuplicate) {
      alert("An item with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as any;
      const erpValue = erp ? parseInt(erp, 10) : undefined;
      if (editingId) {
        setItems(items.map(img => img.id === editingId ? { ...img, name: name.trim(), groupId, uom, erp: erpValue, gstRate: parseFloat(gstRate) || 0, ...audit } : img));
      } else {
        setItems([...items, { id: crypto.randomUUID(), name: name.trim(), groupId, uom, erp: erpValue, gstRate: parseFloat(gstRate) || 0, ...audit } as Item]);
      }
      
      setName("");
      setGroupId("");
      setUom("");
      setErp("");
      setGstRate("18");
      setEditingId(null);
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  const filteredItems = items
    .filter(i => 
      i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (groups.find(g => g.id === i.groupId)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || 0).getTime();
      const timeB = new Date(b.updateTimestamp || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Items Master</h2>
        {!isFormOpen && (
          <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow">
            <Plus size={18} /> Add New Item
          </button>
        )}
      </div>

      {showQuickGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded border-2 border-black max-w-sm w-full shadow-2xl">
            <h3 className="font-bold text-black uppercase mb-4">Quick Add Group</h3>
            <form onSubmit={handleQuickGroupSubmit} className="space-y-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-xs uppercase">Group Name</label>
                <input 
                  autoFocus
                  type="text" 
                  value={quickGroupName}
                  onChange={(e) => setQuickGroupName(e.target.value)}
                  className="border-2 border-black p-2 rounded focus:outline-none focus:border-indigo-600"
                  placeholder="Enter name..."
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded font-bold border border-black flex-1">Add</button>
                <button type="button" onClick={() => setShowQuickGroup(false)} className="bg-slate-200 text-black px-4 py-2 rounded font-bold border border-black flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isFormOpen ? (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">{editingId ? "Edit Item" : "Create Item"}</h3>
          <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Item Name *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Item Group *</label>
              <Select value={groupId} onChange={setGroupId} onAdd={handleCreateNewGroup} options={groupOptions} placeholder="Select Item Group..." required />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">UOM *</label>
              <Select value={uom} onChange={setUom} options={uomOptions} placeholder="Select UOM..." required />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">ERP (whole number)</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={erp}
                onChange={(e) => {
                  // allow only digits
                  const v = e.target.value.replace(/[^0-9]/g, "");
                  setErp(v);
                }}
                placeholder="Enter ERP (no decimals)"
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">GST Rate (%) *</label>
              <select 
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                required
              >
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </div>
            <div className="flex space-x-3 pt-2">
              <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-2 rounded font-bold border border-black min-w-[100px]">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit"}
              </button>
              <button type="button" onClick={() => setIsFormOpen(false)} className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-50 transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search items..." />
          <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {filteredItems.map((item) => (
                    <div key={item.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                        <div className="flex justify-between items-center">
                             <div>
                                <div className="text-xs font-black text-slate-500 uppercase">Item</div>
                                <div className="text-sm font-bold">{item.name}</div>
                             </div>
                             <div className="flex items-center gap-2">
                                 <button onClick={() => { setName(item.name); setGroupId(item.groupId); setUom(item.uom); setErp(item.erp?.toString() || ""); setGstRate((item.gstRate ?? 18).toString()); setEditingId(item.id); setIsFormOpen(true); }} className="text-indigo-600 hover:text-indigo-900 font-bold"><Edit size={16} /></button>
                                 <button 
                                      onClick={() => handleDelete(item.id)} 
                                      className={`${deletingId === item.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold`}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                             </div>
                        </div>
                        <div className="flex gap-4">
                            <div>
                                <div className="text-xs font-black text-slate-500 uppercase">Group</div>
                                <div className="text-sm">{groups.find(g => g.id === item.groupId)?.name || "Unknown"}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">UOM</div>
                              <div className="text-sm">{item.uom}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">GST</div>
                              <div className="text-sm">{item.gstRate ?? 18}%</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">ERP</div>
                              <div className="text-sm">{item.erp ?? ""}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
              <thead className="bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                      <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
                      <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Group</th>
                      <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
                      <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">GST</th>
                      <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">ERP</th>
                      <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
                    </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                    {filteredItems.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-8 text-center text-black font-medium">No items found.</td></tr>
                    ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                      <td className="px-6 py-4 text-sm font-medium text-black border border-black">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{groups.find(g => g.id === item.groupId)?.name || "Unknown"}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{item.uom}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{item.gstRate ?? 18}%</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{item.erp ?? ""}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                            <button onClick={() => { setName(item.name); setGroupId(item.groupId); setUom(item.uom); setErp(item.erp?.toString() || ""); setGstRate((item.gstRate ?? 18).toString()); setEditingId(item.id); setIsFormOpen(true); }} className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center"><Edit size={16} className="mr-1" /> Edit</button>
                        <button 
                          onClick={() => handleDelete(item.id)} 
                          className={`${deletingId === item.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                        >
                          <Trash2 size={16} className="mr-1" /> {deletingId === item.id ? "Confirm?" : "Delete"}
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
