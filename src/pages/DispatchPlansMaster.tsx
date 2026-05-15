import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { DispatchPlan, Truck, Order, Company, Item, OrderSchedule } from "../types";
import { formatDate } from "../lib/serial";
import { Trash2 } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

export function DispatchPlansMaster() {
  const [plans, setPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setPlans(plans.filter(p => p.id !== id));
    setDeletingId(null);
  };

  const exportData = plans.map(p => {
    const truck = trucks.find(t => t.id === p.truckId);
    const order = orders.find(o => o.id === p.orderId);
    const company = companies.find(c => c.id === order?.companyId);
    const item = items.find(i => i.id === order?.itemId);
    const schedule = schedules.find(s => s.id === p.scheduleId);

    return {
      "Plan Date": formatDate(p.date),
      "Truck No": truck?.truckNo || "-",
      "Driver": truck?.driverName || "-",
      "Company": company?.name || "-",
      "Order No": order?.orderNo || "-",
      "Item": item?.name || "-",
      "Planned Qty": p.plannedQty,
      "Status": p.status
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Dispatch Plans Master</h2>
        <ExcelExport data={exportData} fileName="Dispatch_Plans_Master" />
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Plan Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Truck / Driver</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Order / Item</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Planned Qty</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black">Status</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {plans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-black font-medium">No dispatch plans found.</td>
                </tr>
              ) : (
                plans.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((p) => {
                  const truck = trucks.find(t => t.id === p.truckId);
                  const order = orders.find(o => o.id === p.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = items.find(i => i.id === order?.itemId);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">
                        <div className="font-bold">{truck?.truckNo || "-"}</div>
                        <div className="text-[10px] text-slate-500 uppercase">{truck?.driverName || "-"}</div>
                      </td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">
                        <div className="font-bold">{order?.orderNo || "-"}</div>
                        <div className="text-[10px] text-slate-500 uppercase">{item?.name || "-"}</div>
                      </td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">
                        {p.plannedQty.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-center text-xs border border-black">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                          p.status === 'Dispatched' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                          'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-xs font-medium border border-black whitespace-nowrap">
                        <button 
                          onClick={() => handleDelete(p.id)} 
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
