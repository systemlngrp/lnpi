import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { Company, Order, OrderSchedule } from "../types";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { formatDate } from "../lib/serial";
import { normalizeOrderItemSource } from "../lib/orderItems";

function getPendingProductionQty(schedule: OrderSchedule) {
  return Math.max(
    Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
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

export function PendingProduction() {
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
  const [orders] = useData<Order>("orders", []);
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

  const pendingRows = useMemo(
    () =>
      schedules
        .filter((schedule) => {
          if (getPendingProductionQty(schedule) <= 0) return false;
          const scheduledDate = parseLocalYmd(schedule.scheduledDate);
          if (!scheduledDate) return false;
          return scheduledDate.getTime() <= cutoffDate.getTime();
        })
        .map((schedule) => {
          const order = orders.find((row) => row.id === schedule.orderId);
          const item = resolveOrderItem(order);
          const company = companies.find((row) => row.id === order?.companyId);
          return { schedule, order, item, company, pendingQty: getPendingProductionQty(schedule) };
        })
        .sort((a, b) => {
          const timeA = new Date(a.schedule.updateTimestamp || a.schedule.scheduledDate || 0).getTime();
          const timeB = new Date(b.schedule.updateTimestamp || b.schedule.scheduledDate || 0).getTime();
          return timeB - timeA;
        }),
    [companies, cutoffDate, orders, resolveOrderItem, schedules]
  );
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedRows,
  } = useClientPagination(pendingRows, 25);

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

  const handleMakeJob = async (schedule: OrderSchedule) => {
    const pendingQty = getPendingProductionQty(schedule);
    if (pendingQty <= 0) return;
    const order = orders.find((row) => row.id === schedule.orderId);
    const item = resolveOrderItem(order);
    const canPlanFgJob = normalizeOrderItemSource(order?.itemSource) === "FG";
    const boxType = canPlanFgJob ? String((item as any)?.boxType || "").trim() : "";
    if (!boxType) return;

    if (makeConfirmId !== schedule.id) {
      setMakeConfirmId(schedule.id);
      setTimeout(() => setMakeConfirmId(null), 3000);
      return;
    }

    // Open Production Form to create the job (scheduleId is pre-selected via query param)
    navigate(`/production/form?scheduleId=${schedule.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Production Plan</h2>
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
              <th className="px-3 py-2 border border-black">Box Type</th>
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
                <td colSpan={11} className="px-6 py-8 text-center text-black font-medium">
                  No pending production schedules.
                </td>
              </tr>
            ) : (
              paginatedRows.map(({ schedule, order, item, company, pendingQty }) => {
                const canPlanFgJob = normalizeOrderItemSource(order?.itemSource) === "FG";
    const boxType = canPlanFgJob ? String((item as any)?.boxType || "").trim() : "";
                const hasBoxType = Boolean(boxType);
                return (
                <tr key={schedule.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-black">{order?.orderNo || "-"}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap">{formatDate(schedule.scheduledDate)}</td>
                  <td className="px-3 py-2 border border-black">{company?.name || "-"}</td>
                  <td className="px-3 py-2 border border-black">{item?.name || "-"}</td>
                  <td className={`px-3 py-2 border border-black font-bold ${hasBoxType ? "text-black" : "bg-red-100 text-red-700"}`}>{boxType || "Missing"}</td>
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
                        onClick={() => handleCancelQty(schedule)}
                        disabled={savingId === schedule.id || !cancelValues[schedule.id] || Number(cancelValues[schedule.id]) <= 0}
                        className="bg-rose-600 text-white px-3 py-1 rounded font-bold disabled:opacity-50"
                      >
                        {savingId === schedule.id ? <Spinner size={14} className="text-white" /> : "Cancel Qty"}
                      </button>
                      <button
                        onClick={() => void handleMakeJob(schedule)}
                        disabled={pendingQty <= 0 || !hasBoxType}
                        className={`px-3 py-1 rounded font-bold disabled:opacity-50 ${
                          makeConfirmId === schedule.id ? "bg-amber-500 text-black" : "bg-yellow-400 text-black"
                        }`}
                        title={canPlanFgJob ? (hasBoxType ? "Plan job" : "Box Type is missing in NPD. Planning is disabled.") : "Only FG orders can create production jobs."}
                      >
                        {makeConfirmId === schedule.id ? "Confirm?" : "Plan Job"}
                      </button>
                    </div>
                  </td>
                </tr>
              )})
            )}
          </tbody>
        </table>
      </div>
      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
