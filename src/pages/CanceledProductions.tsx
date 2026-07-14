import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Production, OrderSchedule, Order, Company } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { RefreshCw } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useNpdItems } from "../hooks/useNpdItems";

export function CanceledProductions() {
  const [productions, setProductions] = useData<Production>("productions", []);
  const npdItems = useNpdItems();
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const handleActivate = async (id: string) => {
    const prod = productions.find(p => p.id === id);
    if (!prod) return;

    if (!window.confirm("Are you sure you want to activate this canceled job? It will return to Pending Consumption.")) return;

    setActivatingId(id);
    try {
      const timestamp = new Date().toISOString();
      
      // 1. Re-activate production entry
      await setProductions(prev => prev.map(p => 
        p.id === id ? { 
          ...p, 
          status: "Pending Consumption", 
          cancelTimestamp: null as any, 
          cancelEmailId: null as any, 
          cancelRemarks: null as any,
          updateTimestamp: timestamp 
        } : p
      ));

      // 2. Re-deduct from schedule producedQty (it was subtracted on cancel)
      if (prod.scheduleId) {
        await setSchedules(prev => prev.map(s => 
          s.id === prod.scheduleId ? {
            ...s,
            producedQty: Number(s.producedQty || 0) + Number(prod.qty || 0),
            updateTimestamp: timestamp,
            updatedBy: "System User (Activate)"
          } : s
        ));
      }
    } catch (err) {
      console.error("Failed to activate production:", err);
    } finally {
      setActivatingId(null);
    }
  };

const canceledProductions = useMemo(() => productions.filter((production) => production.status === "Cancelled"), [productions]);

  const filteredList = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();    return canceledProductions
      .filter((production) => {
        const item = npdItems.find((row) => row.id === production.itemId);
        const schedule = schedules.find((row) => row.id === production.scheduleId);
        const order = orders.find((row) => row.id === schedule?.orderId);
        const company = companies.find((row) => row.id === order?.companyId);        if (!needle) return true;
        return [production.transactionNo, item?.name, order?.orderNo, company?.name].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => b.transactionNo.localeCompare(a.transactionNo, undefined, { numeric: true, sensitivity: "base" }));
  }, [canceledProductions, companies, npdItems, orders, schedules, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Canceled Jobs (Productions)</h2>
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search canceled jobs..." 
      />

      <DataSummaryTiles totalRecords={canceledProductions.length} filteredRecords={filteredList.length} showingRecords={filteredList.length} pageLabel="1 / 1" />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="table-sticky-scroll">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">SL No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Order No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Cancel Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Cancel Reason</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-black font-medium">No canceled jobs found.</td>
                </tr>
              ) : (
                filteredList.map((p, index) => {
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  
                  return (
                    <tr key={p.id} className="hover:bg-red-50 divide-x divide-black transition-colors">
                      <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{index + 1}</td>
                      <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black min-w-[150px]">{npdItems.find(i => i.id === p.itemId)?.name || "Unknown"}</td>
                      <td className="px-4 py-4 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{p.qty} {p.uom}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.cancelTimestamp ? formatDate(p.cancelTimestamp) : "-"}</td>
                      <td className="px-4 py-4 text-xs text-red-700 font-medium border border-black">{p.cancelRemarks || "-"}</td>
                      <td className="px-4 py-4 text-center text-xs font-medium border border-black whitespace-nowrap">
                        <button 
                          onClick={() => handleActivate(p.id)} 
                          disabled={activatingId === p.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 text-white font-black uppercase tracking-widest border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all disabled:opacity-50"
                        >
                          {activatingId === p.id ? <Spinner size={12} /> : <RefreshCw size={12} />}
                          Activate
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
