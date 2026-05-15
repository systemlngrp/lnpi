import React from "react";
import { useData } from "../hooks/useData";
import { OrderSchedule, Order } from "../types";
import { formatDate } from "../lib/utils";

function sumField(rows: OrderSchedule[], field: "qty" | "producedQty" | "canceledQty") {
  return rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

export function ScheduledOrdersMaster() {
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const [items] = useData("items", []);
  // Build aggregated view per order
  const schedulesByOrder = (orderId: string) => schedules.filter(s => s.orderId === orderId);
  const scheduledTotalFor = (orderId: string) => sumField(schedulesByOrder(orderId), "qty");
  const producedTotalFor = (orderId: string) => sumField(schedulesByOrder(orderId), "producedQty");
  const canceledTotalFor = (orderId: string) => sumField(schedulesByOrder(orderId), "canceledQty");
  const pendingProductionFor = (orderId: string) => Math.max(scheduledTotalFor(orderId) - producedTotalFor(orderId) - canceledTotalFor(orderId), 0);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Scheduled Orders Master</h2>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 border border-black">S.No</th>
              <th className="px-3 py-2 border border-black">Order No</th>
              <th className="px-3 py-2 border border-black">Order Date</th>
              <th className="px-3 py-2 border border-black">Company</th>
              <th className="px-3 py-2 border border-black">Item</th>
              <th className="px-3 py-2 border border-black">Order Qty</th>
              <th className="px-3 py-2 border border-black">Scheduled Qty</th>
              <th className="px-3 py-2 border border-black">Produced Qty</th>
              <th className="px-3 py-2 border border-black">Canceled Qty</th>
              <th className="px-3 py-2 border border-black">Pending Production Qty</th>
              <th className="px-3 py-2 border border-black">Yet To Schedule</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 border border-black">{idx + 1}</td>
                <td className="px-3 py-2 border border-black">{o.orderNo}</td>
                <td className="px-3 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===o.companyId)?.name}</td>
                <td className="px-3 py-2 border border-black">{(items as any[]).find(i=>i.id===o.itemId)?.name}</td>
                <td className="px-3 py-2 border border-black">{o.qty}</td>
                <td className="px-3 py-2 border border-black">{scheduledTotalFor(o.id)}</td>
                <td className="px-3 py-2 border border-black">{producedTotalFor(o.id)}</td>
                <td className="px-3 py-2 border border-black">{canceledTotalFor(o.id)}</td>
                <td className="px-3 py-2 border border-black">{pendingProductionFor(o.id)}</td>
                <td className="px-3 py-2 border border-black">{Number(o.qty || 0) - scheduledTotalFor(o.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
