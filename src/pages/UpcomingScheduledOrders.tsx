import React, { useMemo, useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { Company, Order, OrderSchedule, Production } from "../types";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { useNavigate } from "react-router-dom";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { buildScheduleConsumptionByScheduleId } from "../lib/productionScheduleQty";

function getPendingProductionQty(schedule: OrderSchedule, consumedQty: number) {
  return Math.max(
    Number(schedule.qty || 0) - Number(consumedQty || 0) - Number(schedule.canceledQty || 0),
    0
  );
}

function parseLocalYmd(dateStr?: string) {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function UpcomingScheduledOrders() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const navigate = useNavigate();
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [productions] = useData<Production>("productions", []);
  const [phpJobs] = useData<Production>("php_job_master", []);
  const [plateJobs] = useData<Production>("plate_job_master", []);
  const [orders] = useData<Order>("orders", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem } = useOrderItemCatalog();
  const [companies] = useData<Company>("companies", []);

  const [cancelValues, setCancelValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [makeConfirmId, setMakeConfirmId] = useState<string | null>(null);

  const cutoffDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 2);
    cutoff.setHours(23, 59, 59, 999);
    return cutoff;
  }, []);

  const consumptionByScheduleId = useMemo(
    () => buildScheduleConsumptionByScheduleId(productions, phpJobs, plateJobs),
    [phpJobs, plateJobs, productions]
  );

  const upcomingRows = useMemo(
    () =>
      schedules
        .filter((schedule) => {
          const consumedQty = Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0);
          if (getPendingProductionQty(schedule, consumedQty) <= 0) return false;
          const scheduledDate = parseLocalYmd(schedule.scheduledDate);
          if (!scheduledDate) return false;
          return scheduledDate.getTime() > cutoffDate.getTime();
        })
        .map((schedule) => {
          const order = orders.find((row) => row.id === schedule.orderId);
          const item = resolveOrderItem(order);
          const company = companies.find((row) => row.id === order?.companyId);
          const actualProducedQty = Number(consumptionByScheduleId.get(schedule.id)?.actualProducedQty || 0);
          const plannedWithoutFfgQty = Number(consumptionByScheduleId.get(schedule.id)?.plannedWithoutFfgQty || 0);
          const consumedQty = Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0);
          return {
            schedule,
            order,
            item,
            company,
            actualProducedQty,
            plannedWithoutFfgQty,
            pendingQty: getPendingProductionQty(schedule, consumedQty),
          };
        })
        .sort((a, b) => {
          const timeA = new Date(a.schedule.scheduledDate || 0).getTime();
          const timeB = new Date(b.schedule.scheduledDate || 0).getTime();
          return timeA - timeB; // Ascending by date
        }),
    [companies, consumptionByScheduleId, cutoffDate, npdItems, orders, schedules]
  );

  const handleCancelQty = async (schedule: OrderSchedule) => {
    const rawValue = cancelValues[schedule.id];
    const qtyToCancel = Number(rawValue || 0);
    const pendingQty = getPendingProductionQty(
      schedule,
      Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0),
    );

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

  const handleMakeJob = async (schedule: OrderSchedule) => {
    const pendingQty = getPendingProductionQty(
      schedule,
      Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0),
    );
    if (pendingQty <= 0) return;

    if (makeConfirmId !== schedule.id) {
      setMakeConfirmId(schedule.id);
      setTimeout(() => setMakeConfirmId(null), 3000);
      return;
    }

    navigate(`/production/form?scheduleId=${schedule.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Upcoming Scheduled Orders</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

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
              <th className="px-3 py-2 border border-black">Planned W/O FFG</th>
              <th className="px-3 py-2 border border-black">Canceled Qty</th>
              <th className="px-3 py-2 border border-black text-indigo-700">Pending Qty</th>
              <th className="px-3 py-2 border border-black w-40">Cancel Qty</th>
              <th className="px-3 py-2 border border-black">Actions</th>
            </tr>
          </thead>
          <tbody>
            {upcomingRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-8 text-center text-black font-medium italic">
                  No upcoming production schedules (beyond today + 2 days).
                </td>
              </tr>
            ) : (
              upcomingRows.map(({ schedule, order, item, company, pendingQty, actualProducedQty, plannedWithoutFfgQty }) => (
                <tr key={schedule.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-black font-medium">{order?.orderNo || "-"}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap font-bold text-indigo-700">{formatDate(schedule.scheduledDate)}</td>
                  <td className="px-3 py-2 border border-black">{company?.name || "-"}</td>
                  <td className="px-3 py-2 border border-black">{item?.name || "-"}</td>
                  <td className="px-3 py-2 border border-black text-right">{schedule.qty || 0}</td>
                  <td className="px-3 py-2 border border-black text-right">{actualProducedQty}</td>
                  <td className="px-3 py-2 border border-black text-right">{plannedWithoutFfgQty}</td>
                  <td className="px-3 py-2 border border-black text-right">{schedule.canceledQty || 0}</td>
                  <td className="px-3 py-2 border border-black text-right font-bold bg-indigo-50/30">{pendingQty}</td>
                  <td className="px-3 py-2 border border-black">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      max={pendingQty}
                      value={cancelValues[schedule.id] || ""}
                      onChange={(e) => setCancelValues((prev) => ({ ...prev, [schedule.id]: e.target.value }))}
                      className="w-full border-2 border-black rounded px-2 py-1 text-right font-bold"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2 border border-black text-center">
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => handleCancelQty(schedule)}
                        disabled={savingId === schedule.id || !cancelValues[schedule.id] || Number(cancelValues[schedule.id]) <= 0}
                        className="bg-rose-600 text-white px-3 py-1 rounded font-bold uppercase text-[10px] disabled:opacity-50 tracking-tighter"
                      >
                        {savingId === schedule.id ? <Spinner size={12} className="text-white" /> : "Cancel Qty"}
                      </button>
                      <button
                        onClick={() => void handleMakeJob(schedule)}
                        disabled={pendingQty <= 0}
                        className={`px-3 py-1 rounded font-bold uppercase text-[10px] tracking-tighter disabled:opacity-50 ${
                          makeConfirmId === schedule.id ? "bg-amber-500 text-black border-2 border-black animate-pulse" : "bg-yellow-400 text-black border border-black hover:bg-yellow-500 transition-colors"
                        }`}
                      >
                        {makeConfirmId === schedule.id ? "Confirm?" : "Plan Job"}
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
