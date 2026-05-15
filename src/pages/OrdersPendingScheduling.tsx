import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Order, OrderSchedule } from "../types";
import { Select } from "../components/Select";

export function OrdersPendingScheduling() {
  const [orders, setOrders] = useData<Order>("orders", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [companies] = useData("companies", []);
  const [items] = useData("items", []);

  const pending = orders.filter(o => o.status === 'Pending Scheduling');
  const [selectedOrderId, setSelectedOrderId] = useState<string>(pending[0]?.id || "");

  const orderOptions = pending.map(o => ({ value: o.id, label: o.orderNo || o.id }));

  const rowsFor = (orderId: string) => schedules.filter(s => s.orderId === orderId);

  const totalScheduled = (orderId: string) => rowsFor(orderId).reduce((sum, r) => sum + (r.qty || 0), 0);

  const handleAddRow = (orderId: string) => {
    const newRow: OrderSchedule = { id: crypto.randomUUID(), orderId, scheduledDate: new Date().toISOString().slice(0,10), qty: 0 };
    setSchedules(prev => [...prev, newRow]);
  };

  const handleChangeRow = (id: string, field: keyof OrderSchedule, value: any) => {
    setSchedules(prev => prev.map(r => r.id === id ? { ...r, [field]: field === 'qty' ? parseFloat(value||0) : value } : r));
  };

  const handleSave = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const total = totalScheduled(orderId);
    if (total > order.qty) {
      alert('Total scheduled quantity exceeds order quantity');
      return;
    }
    // If fully scheduled, mark as Scheduled else leave Pending Scheduling
    if (total === order.qty) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'Scheduled', updatedBy: 'System User', updateTimestamp: new Date().toISOString() } : o));
    }
    alert('Schedule saved');
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Pending Scheduling</h2>

      <div className="bg-white p-4 rounded border border-black">
        <div className="max-w-md">
          <Select value={selectedOrderId} onChange={setSelectedOrderId} options={orderOptions} placeholder="Select Order to schedule..." />
        </div>

        {selectedOrderId ? (
          <div className="mt-4">
            <div className="mb-2 font-bold">Order Details</div>
            <div className="text-sm mb-4">
              Company: {(companies as any[]).find(c=>c.id===orders.find(o=>o.id===selectedOrderId)?.companyId)?.name} • Item: {(items as any[]).find(i=>i.id===orders.find(o=>o.id===selectedOrderId)?.itemId)?.name}
            </div>

            <div className="space-y-2">
              {rowsFor(selectedOrderId).map(r => (
                <div key={r.id} className="flex gap-2 items-center">
                  <input type="date" value={r.scheduledDate} onChange={(e)=>handleChangeRow(r.id, 'scheduledDate', e.target.value)} className="border-2 border-black rounded p-1" />
                  <input type="number" min={0} step={1} value={r.qty} onChange={(e)=>handleChangeRow(r.id, 'qty', e.target.value)} className="border-2 border-black rounded p-1 w-32" />
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => handleAddRow(selectedOrderId)} className="bg-indigo-600 text-white px-3 py-1 rounded">Add Row</button>
              <button onClick={() => handleSave(selectedOrderId)} className="bg-emerald-600 text-white px-3 py-1 rounded">Save Schedule</button>
            </div>

            <div className="mt-4 text-sm">Total Scheduled: {totalScheduled(selectedOrderId)} / {orders.find(o=>o.id===selectedOrderId)?.qty}</div>
          </div>
        ) : (
          <div className="text-sm text-slate-600 mt-4">Select an order to schedule</div>
        )}
      </div>
    </div>
  );
}
