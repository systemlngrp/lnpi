import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Order, OrderSchedule } from "../types";
import { Select } from "../components/Select";
import { Trash2 } from "lucide-react";

export function OrdersPendingScheduling() {
  const [orders, setOrders] = useData<Order>("orders", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [companies] = useData("companies", []);
  const [items] = useData("items", []);

  const rowsFor = (orderId: string) => schedules.filter(s => s.orderId === orderId);

  const totalScheduled = (orderId: string) => rowsFor(orderId).reduce((sum, r) => sum + (Number((r as any).qty) || 0), 0);

  const pending = orders.filter(o => (o.qty || 0) > totalScheduled(o.id));

  const [modalOpen, setModalOpen] = useState(false);
  const [modalOrderId, setModalOrderId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  

  const handleAddRow = (orderId: string) => {
    const newRow: any = { id: crypto.randomUUID(), orderId, scheduledDate: new Date().toISOString().slice(0,10), _isNew: true };
    setSchedules(prev => [...prev, newRow]);
  };

  const handleChangeRow = (id: string, field: keyof OrderSchedule, value: any) => {
    if (field === 'qty' && modalOrderId) {
      const order = orders.find(o => o.id === modalOrderId);
      if (!order) return;

      // compute prospective total: replace this row's qty with the new value
      const rows = rowsFor(modalOrderId);
      const prospectiveTotal = rows.reduce((sum, r) => {
        if (r.id === id) return sum + (Number(value) || 0);
        return sum + (Number((r as any).qty) || 0);
      }, 0);

      if (!value || value === '') {
        // allow clearing the field
        setSchedules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
        setModalError(null);
        return;
      }

      const numeric = Number(value);
      if (isNaN(numeric) || numeric < 0) {
        // ignore invalid
        return;
      }

      if (prospectiveTotal > Number(order.qty || 0)) {
        setModalError('Total scheduled would exceed order quantity. Reduce the value.');
        return; // do not accept this change
      }

      // otherwise accept
      setModalError(null);
      setSchedules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
      return;
    }

    setSchedules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleDeleteRow = (id: string) => {
    setSchedules(prev => prev.filter(r => r.id !== id));
    setModalError(null);
  };

  const handleSave = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const rows = rowsFor(orderId);
    if (rows.some(r => (r as any).qty === '' || (r as any).qty === undefined)) {
      alert('Please fill or delete any empty scheduled quantities before saving');
      return;
    }

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
        <div className="mb-4">
          <h3 className="font-bold mb-2">Pending Orders</h3>
          <table className="min-w-full divide-y divide-black border-collapse border border-black mb-3">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 border border-black">Order No</th>
                <th className="px-3 py-2 border border-black">Company</th>
                <th className="px-3 py-2 border border-black">Item</th>
                <th className="px-3 py-2 border border-black">Qty</th>
                <th className="px-3 py-2 border border-black">Unit</th>
                <th className="px-3 py-2 border border-black">Scheduled Qty</th>
                <th className="px-3 py-2 border border-black">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(o => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-black">{o.orderNo}</td>
                  <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===o.companyId)?.name}</td>
                  <td className="px-3 py-2 border border-black">{(items as any[]).find(i=>i.id===o.itemId)?.name}</td>
                  <td className="px-3 py-2 border border-black">{o.qty}</td>
                  <td className="px-3 py-2 border border-black">{(items as any[]).find(i=>i.id===o.itemId)?.uom}</td>
                  <td className="px-3 py-2 border border-black">{totalScheduled(o.id)}</td>
                  <td className="px-3 py-2 border border-black"><button onClick={() => { setModalOrderId(o.id); setModalOpen(true); }} className="bg-indigo-600 text-white px-3 py-1 rounded">Schedule</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Modal scheduler */}
        {modalOpen && modalOrderId && (
          <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 z-50">
            <div className="bg-white rounded shadow-lg border border-black max-w-2xl w-full p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold">Schedule Order {orders.find(o=>o.id===modalOrderId)?.orderNo}</h3>
                <div className="flex gap-2">
                  <button onClick={() => { setModalOpen(false); setModalOrderId(null); }} className="bg-white border border-black px-3 py-1 rounded">Close</button>
                </div>
              </div>

              <div className="text-sm mb-3"><strong>Company:</strong> {(companies as any[]).find(c=>c.id===orders.find(o=>o.id===modalOrderId)?.companyId)?.name} • <strong>Item:</strong> {(items as any[]).find(i=>i.id===orders.find(o=>o.id===modalOrderId)?.itemId)?.name}</div>

              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="bg-slate-50 p-2 border border-black rounded">
                  <div className="text-xs text-slate-600">Total Order Qty</div>
                  <div className="font-bold text-lg">{orders.find(o=>o.id===modalOrderId)?.qty ?? 0}</div>
                </div>
                <div className="bg-slate-50 p-2 border border-black rounded">
                  <div className="text-xs text-slate-600">Total Scheduled Qty</div>
                  <div className="font-bold text-lg">{totalScheduled(modalOrderId)}</div>
                </div>
                <div className="bg-slate-50 p-2 border border-black rounded">
                  <div className="text-xs text-slate-600">Yet To Schedule</div>
                  <div className="font-bold text-lg">{(orders.find(o=>o.id===modalOrderId)?.qty ?? 0) - totalScheduled(modalOrderId)}</div>
                </div>
              </div>

              <table className="min-w-full divide-y divide-black border-collapse border border-black mb-3">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 border border-black">Scheduled Date</th>
                    <th className="px-3 py-2 border border-black">Scheduled Quantity</th>
                    <th className="px-3 py-2 border border-black">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsFor(modalOrderId).map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 border border-black"><input type="date" value={r.scheduledDate} onChange={(e)=>handleChangeRow(r.id, 'scheduledDate', e.target.value)} className="border-2 border-black rounded p-1" /></td>
                      <td className="px-3 py-2 border border-black"><input type="number" min={0} step="any" value={(r as any)._isNew ? ((r as any).qty ?? '') : ((r as any).qty ?? '')} onChange={(e)=>handleChangeRow(r.id, 'qty', e.target.value)} className="border-2 border-black rounded p-1 w-40" /></td>
                      <td className="px-3 py-2 border border-black text-center"><button onClick={()=>handleDeleteRow(r.id)} aria-label="Delete schedule" className="text-red-600"><Trash2 size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex gap-2">
                <button onClick={() => handleAddRow(modalOrderId)} className="bg-indigo-600 text-white px-3 py-1 rounded">Add Row</button>
                <button onClick={() => { handleSave(modalOrderId); setModalOpen(false); setModalOrderId(null); }} className="bg-emerald-600 text-white px-3 py-1 rounded">Save Schedule</button>
              </div>

              {modalError && <div className="text-sm text-red-600 mt-2">{modalError}</div>}

              <div className="mt-3 text-sm">Total Scheduled: {totalScheduled(modalOrderId)} / {orders.find(o=>o.id===modalOrderId)?.qty}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
