import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialIn, Item, Supplier } from "../types";
import { formatDate } from "../lib/serial";
import { Trash2, Search } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

export function MaterialInMaster() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIn(materialIn.filter(m => m.id !== id));
    setDeletingId(null);
  };

  const getLineItemsElement = (lines: MaterialIn['lines'] = []) => {
    return (
      <ul className="list-none space-y-1">
        {lines.map((l, idx) => {
          const item = items.find(i => i.id === l.itemId);
          return (
            <li key={idx} className="whitespace-nowrap border-b border-black last:border-0 pb-1 last:pb-0 mb-1 last:mb-0">
              <span className="font-medium text-black">{item?.name || 'Unknown'}</span>
              <span className="ml-2 text-black">[{l.qty} {l.uom} @ ₹{l.rate}]</span>
            </li>
          );
        })}
      </ul>
    );
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  const filteredMaterialIn = materialIn.filter(m => {
    const supplierName = getSupplierName(m.supplierId);
    const itemNames = m.lines.map(l => items.find(i => i.id === l.itemId)?.name || "").join(" ");
    return m.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
           supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
           itemNames.toLowerCase().includes(searchTerm.toLowerCase());
  }).sort((a, b) => {
    const timeA = new Date(a.updateTimestamp || a.timestamp || 0).getTime();
    const timeB = new Date(b.updateTimestamp || b.timestamp || 0).getTime();
    return timeB - timeA;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material In Master</h2>
          <ExcelExport data={filteredMaterialIn} fileName="Material_In_Master" />
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search transaction, supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {filteredMaterialIn.map((m) => (
                <div key={m.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                    <div className="flex justify-between items-center">
                        <div className="font-bold">{m.transactionNo}</div>
                        <span className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${
                            m.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                            'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                            {m.status}
                        </span>
                    </div>
                    <div className="text-xs font-black text-slate-500 uppercase">Date / Supplier</div>
                    <div className="text-sm">{formatDate(m.date)} | {getSupplierName(m.supplierId)}</div>
                    
                    <div className="text-xs font-black text-slate-500 uppercase">Items</div>
                    <div className="text-sm">{getLineItemsElement(m.lines)}</div>
                    
                    <div className="flex justify-between items-center mt-2">
                        <div className="font-bold text-lg">₹{m.totalAmount.toLocaleString()}</div>
                         <button 
                            onClick={() => handleDelete(m.id)} 
                            className={`${deletingId === m.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                            >
                            <Trash2 size={16} className="mr-1" /> {deletingId === m.id ? "Confirm?" : "Delete"}
                        </button>
                    </div>
                </div>
            ))}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Gate Entry No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Items</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Amount</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredMaterialIn.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-black font-medium italic">No material in records found.</td>
              </tr>
            ) : filteredMaterialIn.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{m.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{m.gateEntryNo || ""}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{getSupplierName(m.supplierId)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">
                    {getLineItemsElement(m.lines)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">₹{m.totalAmount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm border border-black whitespace-nowrap">
                    <span className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${
                      m.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                      'bg-amber-100 text-amber-900 border-amber-900'
                    }`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                    <button 
                      onClick={() => handleDelete(m.id)} 
                      className={`${deletingId === m.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === m.id ? "Confirm?" : "Delete"}
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
