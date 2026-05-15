import React from "react";
import { useData } from "../hooks/useData";
import { OrderSchedule, Order, Company, Item } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";

export function PendingDispatchPlanning() {
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  const filteredSchedules = schedules.filter(s => {
    const scheduledDate = new Date(s.scheduledDate);
    // If invalid date, skip
    if (isNaN(scheduledDate.getTime())) return false;
    
    // Check if scheduledDate is less than equal to tomorrow
    return scheduledDate <= tomorrow && (Number(s.qty || 0) > (Number(s.producedQty || 0) + Number(s.canceledQty || 0)));
  }).sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());

  return (
    <div className="space-y-6">
      <div className="border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Dispatch Planning</h2>
        <p className="text-xs text-slate-500 mt-1 font-bold">Showing scheduled orders up to tomorrow that are pending production</p>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
         <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Scheduled Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Order No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Item Name</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Scheduled Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Produced Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Balance Qty</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-black font-medium">No pending dispatch plans for today or tomorrow.</td>
                </tr>
              ) : (
                filteredSchedules.map((s) => {
                  const order = orders.find(o => o.id === s.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = items.find(i => i.id === order?.itemId);
                  
                  const schedDate = new Date(s.scheduledDate);
                  const isOverdue = schedDate < today;
                  const balance = Number(s.qty || 0) - (Number(s.producedQty || 0) + Number(s.canceledQty || 0));
                  
                  return (
                    <tr key={s.id} className={cn("hover:bg-slate-50 divide-x divide-black", isOverdue && "bg-red-50")}>
                      <td className={cn("px-4 py-4 text-xs font-bold border border-black whitespace-nowrap", isOverdue ? "text-red-600" : "text-black")}>
                        {formatDate(s.scheduledDate)}
                        {isOverdue && <span className="ml-2 text-[8px] uppercase px-1 border border-red-600 rounded">Overdue</span>}
                      </td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{item?.name || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">{s.qty}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-emerald-700 border border-black whitespace-nowrap">{s.producedQty || 0}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-amber-700 border border-black whitespace-nowrap">{balance}</td>
                      <td className="px-4 py-4 text-center text-xs border border-black">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                           (s.producedQty || 0) >= (s.qty || 0) ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                           (s.producedQty || 0) > 0 ? 'bg-amber-100 text-amber-900 border-amber-900' :
                           'bg-slate-100 text-slate-900 border-slate-900'
                        }`}>
                          {(s.producedQty || 0) >= (s.qty || 0) ? 'Ready' : (s.producedQty || 0) > 0 ? 'Partial' : 'Pending'}
                        </span>
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
