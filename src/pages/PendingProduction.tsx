import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Company, Item, Order, OrderSchedule } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";

function getPendingProductionQty(schedule: OrderSchedule) {
  return Math.max(
    Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
    0
  );
}

export function PendingProduction() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [items] = useData<Item>("items", []);
  const [companies] = useData<Company>("companies", []);

  const [cancelValues, setCancelValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const pendingRows = useMemo(
    () =>
      schedules
        .filter((schedule) => getPendingProductionQty(schedule) > 0)
        .map((schedule) => {
          const order = orders.find((row) => row.id === schedule.orderId);
          const item = items.find((row) => row.id === order?.itemId);
          const company = companies.find((row) => row.id === order?.companyId);
          return { schedule, order, item, company, pendingQty: getPendingProductionQty(schedule) };
        })
        .sort((a, b) => {
          const timeA = new Date(a.schedule.updateTimestamp || a.schedule.scheduledDate || 0).getTime();
          const timeB = new Date(b.schedule.updateTimestamp || b.schedule.scheduledDate || 0).getTime();
          return timeB - timeA;
        }),
    [companies, items, orders, schedules]
  );

  const handleCancelQty = async (schedule: OrderSchedule) => {
    const rawValue = cancelValues[schedule.id];
    const qtyToCancel = Number(rawValue || 0);
    const pendingQty = getPendingProductionQty(schedule);

    if (!qtyToCancel || qtyToCancel <= 0 || qtyToCancel > pendingQty) return;

    setSavingId(schedule.id);
    try {
      const timestamp = new Date().toISOString();
      await setSchedules((prev) =>
        prev.map((row) =>
          row.id === schedule.id
            ? {
                ...row,
                canceledQty: Number(row.canceledQty || 0) + qtyToCancel,
                updateTimestamp: timestamp,
                updatedBy: "System User",
              }
            : row
        )
      );
      setCancelValues((prev) => ({ ...prev, [schedule.id]: "" }));
    } catch (err) {
      console.error("Failed to cancel scheduled quantity:", err);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Production</h2>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 border border-black">Order No</th>
              <th className="px-3 py-2 border border-black">Schedule Date</th>
              <th className="px-3 py-2 border border-black">Company</th>
              <th className="px-3 py-2 border border-black">Item</th>
              <th className="px-3 py-2 border border-black">Scheduled Qty</th>
              <th className="px-3 py-2 border border-black">Produced Qty</th>
              <th className="px-3 py-2 border border-black">Canceled Qty</th>
              <th className="px-3 py-2 border border-black">Pending Qty</th>
              <th className="px-3 py-2 border border-black">Cancel Qty</th>
              <th className="px-3 py-2 border border-black">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-black font-medium">
                  No pending production schedules.
                </td>
              </tr>
            ) : (
              pendingRows.map(({ schedule, order, item, company, pendingQty }) => (
                <tr key={schedule.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-black">{order?.orderNo || "-"}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap">{formatDate(schedule.scheduledDate)}</td>
                  <td className="px-3 py-2 border border-black">{company?.name || "-"}</td>
                  <td className="px-3 py-2 border border-black">{item?.name || "-"}</td>
                  <td className="px-3 py-2 border border-black">{schedule.qty || 0}</td>
                  <td className="px-3 py-2 border border-black">{schedule.producedQty || 0}</td>
                  <td className="px-3 py-2 border border-black">{schedule.canceledQty || 0}</td>
                  <td className="px-3 py-2 border border-black font-bold">{pendingQty}</td>
                  <td className="px-3 py-2 border border-black">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      max={pendingQty}
                      value={cancelValues[schedule.id] || ""}
                      onChange={(e) => setCancelValues((prev) => ({ ...prev, [schedule.id]: e.target.value }))}
                      className="border-2 border-black rounded p-1 w-28"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2 border border-black">
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/production/form?scheduleId=${schedule.id}`)}
                        className="bg-emerald-600 text-white px-3 py-1 rounded font-bold"
                      >
                        Produce
                      </button>
                      <button
                        onClick={() => handleCancelQty(schedule)}
                        disabled={savingId === schedule.id || !cancelValues[schedule.id] || Number(cancelValues[schedule.id]) <= 0}
                        className="bg-rose-600 text-white px-3 py-1 rounded font-bold disabled:opacity-50"
                      >
                        {savingId === schedule.id ? <Spinner size={14} className="text-white" /> : "Cancel Qty"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
