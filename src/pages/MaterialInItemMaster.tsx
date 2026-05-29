import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier } from "../types";
import { Edit2, Check, X, Search } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";

export function MaterialInItemMaster() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const handleEditClick = (lineId: string, currentQty: number) => {
    setEditingLineId(lineId);
    setEditQty(currentQty);
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditQty("");
  };

  const handleSaveQty = (parentId: string, lineId: string) => {
    if (editQty === "" || Number(editQty) <= 0) return;

    setIsSubmitting(true);
    setTimeout(() => {
      setMaterialIn(prev => prev.map(m => {
        if (m.id !== parentId) return m;

        const updatedLines = m.lines.map(line => {
          if (line.id !== lineId) return line;
          return {
            ...line,
            qty: Number(editQty),
            value: Number(editQty) * line.rate
          };
        });

        const newTotalAmount = updatedLines.reduce((sum, line) => sum + line.value, 0);

        return {
          ...m,
          lines: updatedLines,
          totalAmount: newTotalAmount
        };
      }));

      setEditingLineId(null);
      setEditQty("");
      setIsSubmitting(false);
    }, 500);
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  // Flatten the data for display
  const allLines = materialIn.flatMap(m => 
    m.lines.map(line => ({
      ...line,
      parentStatus: m.status,
      parentTransactionNo: m.transactionNo,
      parentDate: m.date,
      parentSupplierId: m.supplierId,
      parentId: m.id,
      timestamp: m.timestamp
    }))
  ).filter(line => {
    const itemName = materials.find(i => i.id === line.itemId)?.name || items.find(i => i.id === line.itemId)?.name || "";
    const supplierName = getSupplierName(line.parentSupplierId);
    return itemName.toLowerCase().includes(searchTerm.toLowerCase()) || 
           supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
           line.parentTransactionNo.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material In Item Master</h2>
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search items, trn, supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {allLines.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((lineComponent) => {
               const itemName = materials.find(i => i.id === lineComponent.itemId)?.name || items.find(i => i.id === lineComponent.itemId)?.name || "Unknown";
               const isEditing = editingLineId === lineComponent.id;
               return (
                <div key={lineComponent.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                    <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{lineComponent.parentTransactionNo}</div>
                        <span className={cn(
                          "px-2 py-[2px] rounded text-[11px] font-bold border whitespace-nowrap uppercase tracking-wider",
                          lineComponent.parentStatus === 'Pending PH' ? 'bg-amber-100 text-amber-900 border-amber-900' : 
                          lineComponent.parentStatus === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' :
                          'bg-slate-100 text-slate-900 border-slate-900'
                        )}>
                          {lineComponent.parentStatus}
                        </span>
                    </div>
                    <div className="text-xs text-slate-600">{formatDate(lineComponent.parentDate)} | {getSupplierName(lineComponent.parentSupplierId)}</div>
                    <div className="font-bold">{itemName}</div>
                    <div className="flex justify-between items-center text-sm">
                        <span>{lineComponent.qty} {lineComponent.uom} @ {lineComponent.rate}</span>
                        <span className="font-bold">₹{lineComponent.value.toLocaleString()}</span>
                    </div>
                </div>
               )
            })}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Rate</th>
              <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Value</th>
              <th className="px-4 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {allLines.length === 0 ? (
              <tr>
                 <td colSpan={10} className="px-4 py-8 text-center text-black font-medium italic">No line items found.</td>
              </tr>
            ) : allLines.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((lineComponent) => {
              const itemName = materials.find(i => i.id === lineComponent.itemId)?.name || items.find(i => i.id === lineComponent.itemId)?.name || "Unknown";
              const canEdit = lineComponent.parentStatus === "Pending PH";
              const isEditing = editingLineId === lineComponent.id;

              return (
                <tr key={lineComponent.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                  <td className="px-4 py-4 text-sm font-medium text-black border border-black whitespace-nowrap">
                     {lineComponent.parentTransactionNo}
                  </td>
                  <td className="px-4 py-4 text-sm text-black border border-black whitespace-nowrap">
                     {formatDate(lineComponent.parentDate)}
                  </td>
                  <td className="px-4 py-4 text-sm text-black border border-black">
                     {getSupplierName(lineComponent.parentSupplierId)}
                  </td>
                  <td className="px-4 py-4 text-sm text-black border border-black">{itemName}</td>
                  <td className="px-4 py-4 text-sm border border-black">
                    <span className={cn(
                      "px-2 py-[2px] rounded text-[11px] font-bold border whitespace-nowrap uppercase tracking-wider",
                      lineComponent.parentStatus === 'Pending PH' ? 'bg-amber-100 text-amber-900 border-amber-900' : 
                      lineComponent.parentStatus === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' :
                      'bg-slate-100 text-slate-900 border-slate-900'
                    )}>
                      {lineComponent.parentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm font-bold text-indigo-700 border border-black text-right">
                    {isEditing ? (
                      <input 
                        type="number"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                        className="w-20 border-2 border-indigo-600 rounded p-1 text-black focus:outline-none focus:ring-1 focus:ring-indigo-600 text-right"
                        autoFocus
                      />
                    ) : (
                      lineComponent.qty
                    )}
                  </td>
                  <td className="px-4 py-4 text-sm text-black border border-black text-center">{lineComponent.uom}</td>
                  <td className="px-4 py-4 text-sm text-black border border-black text-right">{lineComponent.rate}</td>
                  <td className="px-4 py-4 text-sm font-medium text-black border border-black text-right whitespace-nowrap">₹{lineComponent.value.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right text-sm border border-black whitespace-nowrap">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleSaveQty(lineComponent.parentId, lineComponent.id)}
                          disabled={isSubmitting}
                          className="p-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition disabled:opacity-50 border border-emerald-700"
                          title="Save"
                        >
                          {isSubmitting ? <Spinner size={16} /> : <Check size={18} />}
                        </button>
                        <button 
                          onClick={handleCancelEdit}
                          disabled={isSubmitting}
                          className="p-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition disabled:opacity-50 border border-red-700"
                          title="Cancel"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ) : (
                      canEdit ? (
                        <button 
                           onClick={() => handleEditClick(lineComponent.id, lineComponent.qty)}
                           className="inline-flex items-center text-indigo-600 hover:text-indigo-800 font-bold"
                        >
                          <Edit2 size={16} className="mr-1" /> Edit Qty
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500 italic font-medium">Locked</span>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
