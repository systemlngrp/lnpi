import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Consumption } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { Trash2 } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";

export function ConsumptionMaster() {
  const [consumptions, setConsumptions] = useData<Consumption>("consumptions", []);
  const npdItems = useNpdItems();
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setConsumptions(consumptions.filter(c => c.id !== id));
    setDeletingId(null);
  };

  const filteredList = consumptions
    .filter(c => 
      c.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (npdItems.find(i => i.id === c.itemId)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Consumption Master</h2>
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search consumptions..." 
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {filteredList.map((c) => (
                <div key={c.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                     <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{c.transactionNo}</div>
                         <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                            c.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                            'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                            {c.status}
                        </span>
                    </div>
                    <div className="text-xs text-slate-500">{formatDate(c.date)}</div>
                    <div className="text-sm font-bold">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</div>
                    <div className="text-sm">{c.qty} {c.uom}</div>
                     <button 
                      onClick={() => handleDelete(c.id)} 
                      className={`${deletingId === c.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center w-full justify-center p-2 mt-2 border border-black`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === c.id ? "Confirm?" : "Delete"}
                    </button>
                </div>
            ))}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Consumed Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">History</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-black font-medium">No consumptions found.</td>
              </tr>
            ) : (
              filteredList.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 divide-x divide-black">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{c.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(c.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-amber-700 border border-black">{c.qty}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{c.uom}</td>
                  <td className="px-6 py-4 text-sm border border-black">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                      c.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                      'bg-amber-100 text-amber-900 border-amber-900'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-black border border-black italic">
                    {c.phTimestamp && (
                      <div className="mb-2">
                        <div className="font-bold uppercase text-[9px] text-slate-500">PH Appr:</div>
                        {formatDate(c.phTimestamp)}
                      </div>
                    )}
                    {c.tallyTimestamp && (
                      <div>
                        <div className="font-bold uppercase text-[9px] text-slate-500">Tally Entry:</div>
                        {formatDate(c.tallyTimestamp)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                    <button 
                      onClick={() => handleDelete(c.id)} 
                      className={`${deletingId === c.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === c.id ? "Confirm?" : "Delete"}
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
