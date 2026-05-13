import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Production, Item } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { Trash2 } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

export function ProductionMaster() {
  const [productions, setProductions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setProductions(productions.filter(p => p.id !== id));
    setDeletingId(null);
  };

  const filteredList = productions
    .filter(p => 
      p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (items.find(i => i.id === p.itemId)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Master</h2>
        <ExcelExport data={filteredList} fileName="Production_Master" />
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search productions..." 
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {filteredList.map((p) => (
                <div key={p.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                     <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{p.transactionNo}</div>
                         <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                            p.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                            'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                            {p.status}
                        </span>
                    </div>
                    <div className="text-xs text-slate-500">{formatDate(p.date)}</div>
                    <div className="text-sm font-bold">{items.find(i => i.id === p.itemId)?.name || "Unknown"}</div>
                    <div className="text-sm">{p.qty} {p.uom}</div>
                     <button 
                      onClick={() => handleDelete(p.id)} 
                      className={`${deletingId === p.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center w-full justify-center p-2 mt-2 border border-black`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === p.id ? "Confirm?" : "Delete"}
                    </button>
                </div>
            ))}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Produced Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">History</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
              </tr>
            ) : (
              filteredList.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 divide-x divide-black">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{p.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{items.find(i => i.id === p.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-emerald-700 border border-black">{p.qty}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{p.uom}</td>
                  <td className="px-6 py-4 text-sm border border-black">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                      p.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                      'bg-amber-100 text-amber-900 border-amber-900'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-black border border-black italic">
                    {p.phTimestamp && (
                      <div className="mb-2">
                        <div className="font-bold uppercase text-[9px] text-slate-500">PH Appr:</div>
                        {formatDate(p.phTimestamp)}
                      </div>
                    )}
                    {p.tallyTimestamp && (
                      <div>
                        <div className="font-bold uppercase text-[9px] text-slate-500">Tally Entry:</div>
                        {formatDate(p.tallyTimestamp)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                    <button 
                      onClick={() => handleDelete(p.id)} 
                      className={`${deletingId === p.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === p.id ? "Confirm?" : "Delete"}
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
