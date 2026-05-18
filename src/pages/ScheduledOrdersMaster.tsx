import React, { useMemo } from "react";
import { useData } from "../hooks/useData";
import { 
  OrderSchedule, 
  Order, 
  Production, 
  DispatchPlan, 
  LoadingSlip, 
  Company,
  Item
} from "../types";
import { formatDate } from "../lib/serial";

export function ScheduledOrdersMaster() {
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [productions] = useData<Production>("productions", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const detailedSchedules = useMemo(() => {
    return schedules.map(s => {
      const order = orders.find(o => o.id === s.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      const item = items.find(i => i.id === order?.itemId);

      // 1. Produced (from productions table linked to this schedule)
      const produced = productions
        .filter(p => p.scheduleId === s.id && p.status !== "Cancelled")
        .reduce((sum, p) => sum + (Number(p.qty) || 0), 0);

      // 2. Loaded (from loading slips via dispatch plans)
      const schedulePlans = plans.filter(p => p.scheduleId === s.id);
      const planIds = new Set(schedulePlans.map(p => p.id));
      
      let loaded = 0;
      let invoiced = 0;

      loadingSlips.forEach(ls => {
        ls.lines.forEach(line => {
          if (planIds.has(line.dispatchPlanId)) {
            const qty = Number(line.loadedQty) || 0;
            loaded += qty;
            
            // 3. Invoiced: If the loading slip has an invoiceId, it counts as invoiced
            if (ls.invoiceId) {
              invoiced += qty;
            }
          }
        });
      });

      return {
        ...s,
        orderNo: order?.orderNo || "-",
        companyName: company?.name || "-",
        itemName: item?.name || "-",
        produced,
        loaded,
        invoiced,
        pendingInvoice: Math.max(produced - invoiced, 0)
      };
    }).sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));
  }, [schedules, orders, companies, items, productions, plans, loadingSlips]);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase tracking-tight">Scheduled Orders Master (Detailed View)</h2>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black text-xs">
            <thead className="bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-3 py-2 border border-black text-left whitespace-nowrap">S.No</th>
                <th className="px-3 py-2 border border-black text-left whitespace-nowrap">Sch. Date</th>
                <th className="px-3 py-2 border border-black text-left whitespace-nowrap">Order No</th>
                <th className="px-3 py-2 border border-black text-left">Company</th>
                <th className="px-3 py-2 border border-black text-left">Item Name</th>
                <th className="px-3 py-2 border border-black text-right whitespace-nowrap bg-indigo-50">Sch. Qty</th>
                <th className="px-3 py-2 border border-black text-right whitespace-nowrap bg-emerald-50">Produced</th>
                <th className="px-3 py-2 border border-black text-right whitespace-nowrap bg-amber-50">Loaded</th>
                <th className="px-3 py-2 border border-black text-right whitespace-nowrap bg-purple-50">Invoiced</th>
                <th className="px-3 py-2 border border-black text-right whitespace-nowrap bg-red-50 text-red-700">Canceled</th>
                <th className="px-3 py-2 border border-black text-right whitespace-nowrap font-bold text-orange-700">Pend. Inv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {detailedSchedules.map((s, idx) => (
                <tr key={s.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                  <td className="px-3 py-2 border border-black text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap font-medium">{formatDate(s.scheduledDate)}</td>
                  <td className="px-3 py-2 border border-black font-bold text-black">{s.orderNo}</td>
                  <td className="px-3 py-2 border border-black truncate max-w-[150px]" title={s.companyName}>{s.companyName}</td>
                  <td className="px-3 py-2 border border-black min-w-[150px]">{s.itemName}</td>
                  <td className="px-3 py-2 border border-black text-right font-medium bg-indigo-50/30">{(Number(s.qty) || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 border border-black text-right font-medium text-emerald-700 bg-emerald-50/30">{s.produced.toLocaleString()}</td>
                  <td className="px-3 py-2 border border-black text-right font-medium text-amber-700 bg-amber-50/30">{s.loaded.toLocaleString()}</td>
                  <td className="px-3 py-2 border border-black text-right font-medium text-purple-700 bg-purple-50/30">{s.invoiced.toLocaleString()}</td>
                  <td className="px-3 py-2 border border-black text-right font-medium text-red-600 bg-red-50/30">{(Number(s.canceledQty) || 0).toLocaleString()}</td>
                  <td className={`px-3 py-2 border border-black text-right font-black ${s.pendingInvoice > 0 ? 'text-orange-600 bg-orange-50/50' : 'text-slate-400'}`}>
                    {s.pendingInvoice.toLocaleString()}
                  </td>
                </tr>
              ))}
              {detailedSchedules.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-slate-500 font-bold italic uppercase">No schedules found.</td>
                </tr>
              )}
            </tbody>
            {detailedSchedules.length > 0 && (
              <tfoot className="bg-slate-100 font-bold border-t border-black">
                <tr className="divide-x divide-black">
                  <td colSpan={5} className="px-3 py-2 text-right uppercase">Totals</td>
                  <td className="px-3 py-2 text-right bg-indigo-50">
                    {detailedSchedules.reduce((sum, s) => sum + (Number(s.qty) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right bg-emerald-50 text-emerald-700">
                    {detailedSchedules.reduce((sum, s) => sum + s.produced, 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right bg-amber-50 text-amber-700">
                    {detailedSchedules.reduce((sum, s) => sum + s.loaded, 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right bg-purple-50 text-purple-700">
                    {detailedSchedules.reduce((sum, s) => sum + s.invoiced, 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right bg-red-50 text-red-700">
                    {detailedSchedules.reduce((sum, s) => sum + (Number(s.canceledQty) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right bg-orange-50 text-orange-700">
                    {detailedSchedules.reduce((sum, s) => sum + s.pendingInvoice, 0).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
