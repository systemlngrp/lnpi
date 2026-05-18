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
    .sort((a, b) => b.transactionNo.localeCompare(a.transactionNo, undefined, { numeric: true, sensitivity: 'base' }));

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
      "ERP Code": p.erpCode || "-",
      "Company": company?.name || "-",
      "Item Name": item?.name || "Unknown",
      "Produced Qty": p.qty,
      "UOM": p.uom,
      "Status": p.status,
      "No of Parts": p.noOfParts,
      "UPS": p.ups,
      "Length": p.length,
      "Breadth": p.breadth,
      "Height": p.height,
      "Reel Per Calc": p.reelAsPerCalc,
      "Reel Actual Trim": p.reelActualWithTrimming,
      "Cutting Trim": p.cuttingWithTrimming,
      "PLY": p.ply,
      "ID to OD": p.idToOd,
      "Flute": p.flute,
      "Take up Factor": p.takeUpFactor,
      "L1": p.l1,
      "F1": p.f1,
      "L2": p.l2,
      "F2": p.f2,
      "L3": p.l3,
      "GSM": p.gsm,
      "Sheet Wt": p.sheetWeight,
      "Plate Wt": p.plateWeight,
      "Total Paper Wt": p.totalPaperWeight,
      "Rate": p.rate,
      "Total Wt of Set": p.totalWeightOfSet,
      "Realization/KG": p.realizationPerKg,
      "Actual Paper Used": p.actualPaperUsed,
      "Avg Wt": p.avgWeight,
      "Prod (Sheet)": p.prodFromSheetPlant,
      "Prod (FFG)": p.prodFromFFG,
      "Wastage": p.wastage,
      "Prod (Meter)": p.productionInMeter,
      "Planned Prod (Meter)": p.plannedProductionInMeter,
      "ERP Code Reel": p.erpCodeReel,
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
                          <div className="text-xs font-bold text-slate-700">ERP Code: {p.erpCode || "-"}</div>
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
        <div className="overflow-x-auto hidden md:block">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Order No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">ERP Code</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Prod Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Produced Qty</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">B</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">H</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Ply</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Flute</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Total Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Avg Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Wastage</th>
                
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
                </tr>
              ) : (
                filteredList.map((p) => {
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.erpCode || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black min-w-[150px]">{items.find(i => i.id === p.itemId)?.name || "Unknown"}</td>
                      <td className="px-4 py-4 text-right text-xs font-medium text-emerald-700 border border-black whitespace-nowrap">{p.qty} {p.uom}</td>
                      
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.length || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.breadth || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.height || "-"}</td>
                      <td className="px-4 py-4 text-center text-xs text-black border border-black whitespace-nowrap">{p.ply || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.flute || "-"}</td>
                      
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.totalPaperWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.avgWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.wastage || "-"}</td>

                      <td className="px-4 py-4 text-xs border border-black whitespace-nowrap">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                          p.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                          'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-xs font-medium border border-black whitespace-nowrap">
                        <button 
                          onClick={() => handleDelete(p.id)} 
                          title={deletingId === p.id ? "Click to confirm delete" : "Delete production entry"}
                          className={`${deletingId === p.id ? "text-amber-600 animate-pulse scale-110" : "text-red-600"} hover:text-red-900 transition-all p-1`}
                        >
                          <Trash2 size={16} />
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
    </div>
  );
}
