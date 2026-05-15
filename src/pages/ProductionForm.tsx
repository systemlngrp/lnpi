import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Company, Item, Order, OrderSchedule, Production } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { generateTransactionNo, formatDate } from "../lib/serial";

function getPendingProductionQty(schedule: OrderSchedule) {
  return Math.max(
    Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
    0
  );
}

export function ProductionForm() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [productions, setProductions] = useData<Production>("productions", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [items] = useData<Item>("items", []);
  const [companies] = useData<Company>("companies", []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState(searchParams.get("scheduleId") || "");
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    qty: "" as number | "",
    remarks: "",
  });

  const pendingSchedules = useMemo(
    () =>
      schedules
        .filter((schedule) => getPendingProductionQty(schedule) > 0)
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.scheduledDate || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.scheduledDate || 0).getTime();
          return timeB - timeA;
        }),
    [schedules]
  );

  useEffect(() => {
    const queryScheduleId = searchParams.get("scheduleId") || "";
    if (queryScheduleId && queryScheduleId !== selectedScheduleId) {
      setSelectedScheduleId(queryScheduleId);
    }
  }, [searchParams, selectedScheduleId]);

  const selectedSchedule = pendingSchedules.find((schedule) => schedule.id === selectedScheduleId);
  const selectedOrder = orders.find((order) => order.id === selectedSchedule?.orderId);
  const selectedItem = items.find((item) => item.id === selectedOrder?.itemId);
  const selectedCompany = companies.find((company) => company.id === selectedOrder?.companyId);
  const pendingQty = selectedSchedule ? getPendingProductionQty(selectedSchedule) : 0;

  const scheduleOptions = pendingSchedules.map((schedule) => {
    const order = orders.find((row) => row.id === schedule.orderId);
    const item = items.find((row) => row.id === order?.itemId);
    const company = companies.find((row) => row.id === order?.companyId);
    const pending = getPendingProductionQty(schedule);

    return {
      value: schedule.id,
      label: `${order?.orderNo || "Order"} | ${company?.name || "Company"} | ${item?.name || "Item"} | ${formatDate(schedule.scheduledDate)} | Pending ${pending}`,
    };
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchedule || !selectedOrder || !selectedItem || !formData.qty) return;

    const qty = Number(formData.qty);
    if (qty <= 0 || qty > pendingQty) return;

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextPendingQty = pendingQty - qty;

      await setProductions((prev) => {
        const txnNo = generateTransactionNo("PR", prev, formData.date);
        const newEntry: Production = {
          id: crypto.randomUUID(),
          transactionNo: txnNo,
          date: formData.date,
          scheduleId: selectedSchedule.id,
          itemId: selectedOrder.itemId,
          qty,
          uom: selectedItem.uom || "",
          remarks: formData.remarks,
          status: "Pending PH",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
        return [newEntry, ...prev];
      });

      await setSchedules((prev) =>
        prev.map((schedule) =>
          schedule.id === selectedSchedule.id
            ? {
                ...schedule,
                producedQty: Number(schedule.producedQty || 0) + qty,
                updateTimestamp: timestamp,
                updatedBy: "System User",
              }
            : schedule
        )
      );

      setFormData({
        date: new Date().toISOString().split("T")[0],
        qty: "",
        remarks: "",
      });

      if (nextPendingQty <= 0) {
        setSelectedScheduleId("");
        setSearchParams({});
      }
    } catch (err) {
      console.error("Failed to save production:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Form</h2>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Scheduled Order <span className="text-red-500">*</span></label>
            <Select
              id="schedule"
              value={selectedScheduleId}
              onChange={(value) => {
                setSelectedScheduleId(value);
                setSearchParams(value ? { scheduleId: value } : {});
              }}
              options={scheduleOptions}
              placeholder="Select pending production schedule..."
              required
            />
          </div>

          {selectedSchedule && selectedOrder && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 border border-black p-4 rounded">
              <InfoTile label="Order No" value={selectedOrder.orderNo || "-"} />
              <InfoTile label="Company" value={selectedCompany?.name || "-"} />
              <InfoTile label="Item" value={selectedItem?.name || "-"} />
              <InfoTile label="Schedule Date" value={formatDate(selectedSchedule.scheduledDate)} />
              <InfoTile label="Scheduled Qty" value={`${selectedSchedule.qty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Produced Qty" value={`${selectedSchedule.producedQty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Cancelled Qty" value={`${selectedSchedule.canceledQty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Pending Qty" value={`${pendingQty} ${selectedItem?.uom || ""}`} />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Production Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Quantity <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min={0}
                  max={pendingQty || undefined}
                  value={formData.qty}
                  onChange={(e) => setFormData({ ...formData, qty: e.target.value === "" ? "" : parseFloat(e.target.value) })}
                  required
                  placeholder="Enter produced quantity"
                  className="w-full border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
                />
                {selectedItem && <span className="absolute right-3 top-2.5 text-black font-bold opacity-60">{selectedItem.uom}</span>}
              </div>
              {selectedSchedule && <span className="text-xs font-bold text-slate-500">Max allowed: {pendingQty}</span>}
            </div>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Remarks</label>
            <input
              type="text"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !selectedSchedule || Number(formData.qty || 0) <= 0 || Number(formData.qty || 0) > pendingQty}
              className="flex items-center justify-center min-w-[120px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50 border border-black shadow"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit Entry"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <h3 className="bg-slate-100 p-4 font-bold text-black border-b border-black uppercase tracking-wider">Recent Productions</h3>
        <table className="min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-50 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Order No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {productions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-black font-medium">No recent production entries.</td>
              </tr>
            ) : (
              productions
                .sort((a, b) => {
                  const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                  const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                  return timeB - timeA;
                })
                .slice(0, 10)
                .map((production) => {
                  const schedule = schedules.find((row) => row.id === production.scheduleId);
                  const order = orders.find((row) => row.id === schedule?.orderId);
                  const item = items.find((row) => row.id === production.itemId);

                  return (
                    <tr key={production.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-6 py-4 text-sm font-medium text-black border border-black">{production.transactionNo}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(production.date)}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{order?.orderNo || "-"}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{item?.name || "Unknown"}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-indigo-700 border border-black">{production.qty}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{production.uom}</td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>

      {pendingSchedules.length === 0 && (
        <div className="bg-amber-50 border border-black p-4 font-bold text-amber-900">
          No scheduled orders are pending production right now.
        </div>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => navigate("/production/pending")}
          className="bg-white text-black border-2 border-black px-4 py-2 rounded font-bold hover:bg-slate-50 transition"
        >
          Open Pending Production View
        </button>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs font-black text-slate-500 uppercase">{label}</div>
      <div className="text-sm font-bold text-black">{value}</div>
    </div>
  );
}
