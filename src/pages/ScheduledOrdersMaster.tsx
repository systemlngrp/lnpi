import React from "react";
import { useData } from "../hooks/useData";
import { OrderSchedule, Order } from "../types";

export function ScheduledOrdersMaster() {
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const [items] = useData("items", []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Scheduled Orders Master</h2>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 border border-black">Schedule Id</th>
              <th className="px-3 py-2 border border-black">Order No</th>
              <th className="px-3 py-2 border border-black">Order Date</th>
              <th className="px-3 py-2 border border-black">Company</th>
              <th className="px-3 py-2 border border-black">Item</th>
              <th className="px-3 py-2 border border-black">Scheduled Date</th>
              <th className="px-3 py-2 border border-black">Qty</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => {
              const order = orders.find(o=>o.id===s.orderId);
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-black">{s.id}</td>
                  <td className="px-3 py-2 border border-black">{order?.orderNo}</td>
                  <td className="px-3 py-2 border border-black">{order?.orderDate}</td>
                  <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===order?.companyId)?.name}</td>
                  <td className="px-3 py-2 border border-black">{(items as any[]).find(i=>i.id===order?.itemId)?.name}</td>
                  <td className="px-3 py-2 border border-black">{s.scheduledDate}</td>
                  <td className="px-3 py-2 border border-black">{s.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
