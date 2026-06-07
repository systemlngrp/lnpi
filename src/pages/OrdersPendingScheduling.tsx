import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Order, OrderSchedule } from "../types";
import { Select } from "../components/Select";
import { Trash2 } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useNpdItems } from "../hooks/useNpdItems";

export function OrdersPendingScheduling() {
  const [orders, setOrders] = useData<Order>("orders", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [companies] = useData("companies", []);
  const npdItems = useNpdItems();

  const rowsFor = (orderId: string) => schedules.filter(s => s.orderId === orderId);

  const totalScheduled = (orderId: string) => rowsFor(orderId).reduce((sum, r) => sum + (Number((r as any).qty) || 0), 0);

  const formatQty = (value: unknown) => {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return String(value ?? "");
    const rounded = Math.round(n);
    return Math.abs(n - rounded) < 1e-9 ? String(rounded) : String(n);
  };

  const today = new Date().toISOString().slice(0, 10);
  const pending = orders
    .filter(o => o.status === "Pending Scheduling" && o.status !== "Cancelled" && (o.qty || 0) > totalScheduled(o.id))
    .sort((a, b) => (a.orderNo || "").localeCompare(b.orderNo || "", undefined, { numeric: true, sensitivity: "base" }));

  const [modalOpen, setModalOpen] = useState(false);
  const [modalOrderId, setModalOrderId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalRows, setModalRows] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // Initialize modalRows when opening modal for an order
  React.useEffect(() => {
    if (modalOpen && modalOrderId) {
      const existing = rowsFor(modalOrderId).map(r => ({ ...r, qty: (r as any).qty != null ? String((r as any).qty) : '' }));
      setModalRows(existing);
      setModalError(null);
    }
  }, [modalOpen, modalOrderId]);

  const displayedTotalScheduled = (orderId: string | null) => {
    if (!orderId) return 0;
    if (modalOpen && modalOrderId === orderId) return modalRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    return totalScheduled(orderId);
  };

  

  const handleAddRow = (orderId: string) => {
    const newRow: any = {
      id: crypto.randomUUID(),
      orderId,
      scheduledDate: today,
      _isNew: true,
      qty: '',
      producedQty: 0,
      canceledQty: 0
    };
    setModalRows(prev => [...prev, newRow]);
  };

  const handleChangeRow = (id: string, field: keyof OrderSchedule, value: any) => {
    if (!modalOrderId) return;
    const order = orders.find(o => o.id === modalOrderId);
    if (!order) return;

    if (field === 'qty') {
      // compute prospective total from modalRows
      const rows = modalRows.map(r => r.id === id ? { ...r, qty: value } : r);
      const prospectiveTotal = rows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
      if (value !== '' && (isNaN(Number(value)) || Number(value) < 0)) return;
      if (prospectiveTotal > Number(order.qty || 0)) {
        setModalError('Total scheduled would exceed order quantity. Reduce the value.');
        return;
      }
      setModalError(null);
      setModalRows(rows);
      return;
    }

    if (field === "scheduledDate") {
      if (value < today) {
        setModalError("Previous date scheduling is not allowed.");
        return;
      }
      setModalError(null);
    }

    setModalRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleDeleteRow = (id: string) => {
    // delete from modalRows when modal open
    if (modalOpen) {
      setModalRows(prev => prev.filter(r => r.id !== id));
      setModalError(null);
      return;
    }
    setSchedules(prev => prev.filter(r => r.id !== id));
  };

  const handleSave = (orderId: string) => {
    return (async () => {
      const order = orders.find(o => o.id === orderId);
      if (!order) return false;
      const rows = modalRows;
      if (rows.some(r => (r as any).qty === '' || (r as any).qty === undefined)) {
        setModalError('Please fill or delete any empty scheduled quantities before saving');
        return false;
      }

      const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
      if (total > Number(order.qty || 0)) {
        setModalError('Total scheduled quantity exceeds order quantity');
        return false;
      }
      if (rows.some((r) => (r.scheduledDate || "") < today)) {
        setModalError("Previous date scheduling is not allowed.");
        return false;
      }

      setSaving(true);
      try {
        // Prepare rows to persist (convert qty to number and remove internal fields)
        const rowsToSave = rows.map(r => {
          const { _isNew, ...rest } = r as any;
          return {
            ...rest,
            qty: Number(rest.qty),
            producedQty: Number(rest.producedQty || 0),
            canceledQty: Number(rest.canceledQty || 0),
          };
        });

        // Persist: Replace existing rows for this order with rowsToSave
        await setSchedules(prev => {
          const others = prev.filter(p => p.orderId !== orderId);
          return [...others, ...rowsToSave];
        });

        const nextStatus = total === Number(order.qty || 0) ? "Scheduled" : "Pending Scheduling";
        await setOrders(prev =>
          prev.map(o =>
            o.id === orderId
              ? { ...o, status: nextStatus, updatedBy: 'System User', updateTimestamp: new Date().toISOString() }
              : o
          )
        );

        setModalError(null);
        setModalRows([]);
        return true;
      } catch (err) {
        console.error('Error saving schedule:', err);
        setModalError('Failed to save schedule. Try again.');
        return false;
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Pending Scheduling</h2>

      <div className="bg-white p-4 rounded border border-black">
        <div className="mb-4">
          <h3 className="font-bold mb-2">Pending Orders</h3>
          <table className="min-w-full divide-y divide-black border-collapse border border-black mb-3 text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 border border-black">S.No</th>
                <th className="px-3 py-2 border border-black">Order No</th>
                <th className="px-3 py-2 border border-black">Company</th>
                <th className="px-3 py-2 border border-black">Item</th>
                <th className="px-3 py-2 border border-black">Order Quantity</th>
                <th className="px-3 py-2 border border-black">Scheduled Qty</th>
                <th className="px-3 py-2 border border-black">Pending Scheduling</th>
                <th className="px-3 py-2 border border-black">Unit</th>
                <th className="px-3 py-2 border border-black">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((o, idx) => {
                const sched = totalScheduled(o.id);
                const pendingSched = Number(o.qty || 0) - sched;
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 border border-black">{idx + 1}</td>
                    <td className="px-3 py-2 border border-black">{o.orderNo}</td>
                    <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===o.companyId)?.name}</td>
                    <td className="px-3 py-2 border border-black">{npdItems.find(i => i.id === o.itemId)?.name}</td>
                    <td className="px-3 py-2 border border-black">{formatQty(o.qty)}</td>
                    <td className="px-3 py-2 border border-black">{formatQty(sched)}</td>
                    <td className="px-3 py-2 border border-black font-bold text-indigo-700">{formatQty(pendingSched)}</td>
                    <td className="px-3 py-2 border border-black">{npdItems.find(i => i.id === o.itemId)?.uom}</td>
                    <td className="px-3 py-2 border border-black"><button onClick={() => { setModalOrderId(o.id); setModalOpen(true); }} className="bg-indigo-600 text-white px-3 py-1 rounded">Schedule</button></td>
                  </tr>
                );
              })}
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

              <div className="text-sm mb-3"><strong>Company:</strong> {(companies as any[]).find(c=>c.id===orders.find(o=>o.id===modalOrderId)?.companyId)?.name} • <strong>Item:</strong> {npdItems.find(i => i.id === orders.find(o => o.id === modalOrderId)?.itemId)?.name}</div>

              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="bg-slate-50 p-2 border border-black rounded">
                  <div className="text-xs text-slate-600">Total Order Qty</div>
                  <div className="font-bold text-lg">{formatQty(orders.find(o=>o.id===modalOrderId)?.qty ?? 0)}</div>
                </div>
                <div className="bg-slate-50 p-2 border border-black rounded">
                  <div className="text-xs text-slate-600">Total Scheduled Qty</div>
                  <div className="font-bold text-lg">{formatQty(displayedTotalScheduled(modalOrderId))}</div>
                </div>
                <div className="bg-slate-50 p-2 border border-black rounded">
                  <div className="text-xs text-slate-600">Yet To Schedule</div>
                  <div className="font-bold text-lg">{formatQty((orders.find(o=>o.id===modalOrderId)?.qty ?? 0) - displayedTotalScheduled(modalOrderId))}</div>
                </div>
              </div>

              <table className="min-w-full divide-y divide-black border-collapse border border-black mb-3">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 border border-black">S.No</th>
                    <th className="px-3 py-2 border border-black">Scheduled Date</th>
                    <th className="px-3 py-2 border border-black">Scheduled Quantity</th>
                    <th className="px-3 py-2 border border-black">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {modalRows.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 border border-black">{idx + 1}</td>
                      <td className="px-3 py-2 border border-black"><input type="date" min={today} value={r.scheduledDate} onChange={(e)=>handleChangeRow(r.id, 'scheduledDate', e.target.value)} className="border-2 border-black rounded p-1" /></td>
                      <td className="px-3 py-2 border border-black"><input type="number" min={0} step="any" value={(r as any).qty ?? ''} onChange={(e)=>handleChangeRow(r.id, 'qty', e.target.value)} className="border-2 border-black rounded p-1 w-40" /></td>
                      <td className="px-3 py-2 border border-black text-center"><button onClick={()=>handleDeleteRow(r.id)} aria-label="Delete schedule" className="text-red-600"><Trash2 size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex gap-2">
                {(() => {
                  const order = orders.find(o => o.id === modalOrderId);
                  const yetTo = (order ? Number(order.qty || 0) - displayedTotalScheduled(modalOrderId) : 0);
                  return (
                    <button onClick={() => modalOrderId && handleAddRow(modalOrderId)} disabled={yetTo <= 0} className={`bg-indigo-600 text-white px-3 py-1 rounded ${yetTo <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>Add Row</button>
                  );
                })()}

                <button onClick={async () => { const saved = await handleSave(modalOrderId!); if (saved) { setModalOpen(false); setModalOrderId(null); } }} disabled={saving} className="bg-emerald-600 text-white px-3 py-1 rounded flex items-center gap-2">
                  {saving ? <Spinner size={16} /> : null}
                  <span>Save Schedule</span>
                </button>
              </div>

              {modalError && <div className="text-sm text-red-600 mt-2">{modalError}</div>}

              <div className="mt-3 text-sm">Total Scheduled: {displayedTotalScheduled(modalOrderId)} / {orders.find(o=>o.id===modalOrderId)?.qty}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
