import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Production, Item, OrderSchedule, Order, Company } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { Trash2 } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

export function ProductionMaster() {
  const [productions, setProductions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  
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
    .filter(p => {
      const item = items.find(i => i.id === p.itemId);
      const schedule = schedules.find(s => s.id === p.scheduleId);
      const order = orders.find(o => o.id === schedule?.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      
      return p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order?.orderNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (company?.name || "").toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
      return timeB - timeA;
    });

  const exportData = filteredList.map(p => {
    const item = items.find(i => i.id === p.itemId);
    const schedule = schedules.find(s => s.id === p.scheduleId);
    const order = orders.find(o => o.id === schedule?.orderId);
    const company = companies.find(c => c.id === order?.companyId);
    
    return {
      "Job No.": p.transactionNo,
      "Prod Date": formatDate(p.date),
      "Order No.": order?.orderNo || "-",
      "Order Date": order ? formatDate(order.orderDate) : "-",
      "Company": company?.name || "-",
      "Item Name": item?.name || "Unknown",
      "Produced Qty": p.qty,
      "UOM": p.uom,
      "Status": p.status,
      "Remarks": p.remarks
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Master</h2>
        <ExcelExport data={exportData} fileName="Production_Master" />
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search productions..." 
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {filteredList.map((p) => {
                const schedule = schedules.find(s => s.id === p.scheduleId);
                const order = orders.find(o => o.id === schedule?.orderId);
                const company = companies.find(c => c.id === order?.companyId);
                
                return (
                  <div key={p.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                       <div className="flex justify-between items-center">
                          <div className="font-bold text-sm">Job: {p.transactionNo}</div>
                           <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                              p.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                              'bg-amber-100 text-amber-900 border-amber-900'
                          }`}>
                              {p.status}
                          </span>
                      </div>
                      <div className="text-xs text-slate-500">Prod Date: {formatDate(p.date)}</div>
                      {order && (
                        <>
                          <div className="text-xs font-bold text-slate-700">Order: {order.orderNo} ({formatDate(order.orderDate)})</div>
                          <div className="text-xs font-bold text-slate-700">Company: {company?.name || "Unknown"}</div>
                        </>
                      )}
                      <div className="text-sm font-bold">{items.find(i => i.id === p.itemId)?.name || "Unknown"}</div>
                      <div className="text-sm">{p.qty} {p.uom}</div>
                       <button 
                        onClick={() => handleDelete(p.id)} 
                        className={`${deletingId === p.id ? "text-amber-600 animate-pulse bg-amber-50" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center w-full justify-center p-2 mt-2 border border-black`}
                      >
                        <Trash2 size={16} className="mr-1" /> {deletingId === p.id ? "Confirm Delete?" : "Delete"}
                      </button>
                  </div>
                );
            })}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Job No. / Order Info</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Prod Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Produced Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
              <th className="px-6 py-3 text-center text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
              </tr>
            ) : (
              filteredList.map((p) => {
                const schedule = schedules.find(s => s.id === p.scheduleId);
                const order = orders.find(o => o.id === schedule?.orderId);
                const company = companies.find(c => c.id === order?.companyId);
                
                return (
                  <tr key={p.id} className="hover:bg-slate-50 divide-x divide-black">
                    <td className="px-6 py-4 text-sm border border-black">
                      <div className="font-bold text-black">{p.transactionNo}</div>
                      {order && (
                        <div className="mt-1 space-y-0.5">
                          <div className="text-[10px] font-bold text-slate-500 uppercase leading-none">Order: {order.orderNo} ({formatDate(order.orderDate)})</div>
                          <div className="text-[10px] font-bold text-indigo-600 uppercase leading-none">Co: {company?.name || "-"}</div>
                        </div>
                      )}
                    </td>
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
                    <td className="px-6 py-4 text-center text-sm font-medium border border-black whitespace-nowrap">
                      <button 
                        onClick={() => handleDelete(p.id)} 
                        title={deletingId === p.id ? "Click to confirm delete" : "Delete production entry"}
                        className={`${deletingId === p.id ? "text-amber-600 animate-pulse scale-110" : "text-red-600"} hover:text-red-900 transition-all p-1`}
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
