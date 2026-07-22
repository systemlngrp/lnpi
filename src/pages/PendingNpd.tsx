import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { normalizeOrderItemSource } from "../lib/orderItems";
import { Company, Order, OrderSchedule } from "../types";
import { formatDate } from "../lib/serial";
import { DataSummaryTiles } from "../components/DataSummaryTiles";

export function PendingNpd() {
  const [orders] = useData<Order>("orders", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const [searchTerm, setSearchTerm] = useState("");

  const pendingRows = useMemo(() => {
    const rows = schedules
      .map((schedule) => {
        const order = orders.find((row) => row.id === schedule.orderId);
        if (!order || order.status === "Cancelled") return null;
        if (normalizeOrderItemSource(order.itemSource) !== "FG") return null;
        const item = npdItems.find((row) => row.id === String(order.itemId || "").trim());
        const company = companies.find((row) => row.id === order.companyId);
        const boxType = String((item as any)?.boxType || "").trim();
        const rapcValue = String((item as any)?.rapc ?? "").trim();
        return {
          schedule,
          order,
          item,
          company,
          boxType,
          rapcValue,
        };
      })
      .filter(Boolean)
      .filter((row) => row.item && !row.boxType && !row.rapcValue);

    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter(({ schedule, order, item, company, boxType, rapcValue }) => {
      const blob = [
        order.orderNo,
        order.orderDate,
        schedule.scheduledDate,
        order.erpCode,
        company?.name,
        item?.name,
        (item as any)?.itemName,
        (item as any)?.customerName,
        (item as any)?.contactPerson,
        boxType,
        rapcValue,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [companies, npdItems, orders, searchTerm]);

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending NPD</h2>
          <p className="text-sm text-slate-700 font-medium">
            Scheduled NPD items where both Box Type and RAPC are still blank.
          </p>
        </div>
        <label className="relative w-full lg:w-[360px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search order, company, item, ERP..."
            className="w-full border border-black rounded pl-10 pr-3 py-2 text-sm"
          />
        </label>
      </div>

      <DataSummaryTiles
        totalRecords={0}
        filteredRecords={pendingRows.length}
        showingRecords={pendingRows.length}
        pageLabel="1 / 1"
        hideTotalRecords
        filteredRecordsLabel="Total Records"
      />

      <div className="table-sticky-scroll border border-black">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 border border-black">SL No</th>
              <th className="px-3 py-2 border border-black">Order No</th>
              <th className="px-3 py-2 border border-black">Order Date</th>
              <th className="px-3 py-2 border border-black">Schedule No</th>
              <th className="px-3 py-2 border border-black">Schedule Date</th>
              <th className="px-3 py-2 border border-black">Company</th>
              <th className="px-3 py-2 border border-black">ERP</th>
              <th className="px-3 py-2 border border-black">Item</th>
              <th className="px-3 py-2 border border-black">Box Type</th>
              <th className="px-3 py-2 border border-black">RAPC</th>
            </tr>
          </thead>
          <tbody>
            {pendingRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-black font-medium">
                  No scheduled items are pending NPD completion.
                </td>
              </tr>
            ) : (
              pendingRows.map(({ schedule, order, item, company, boxType, rapcValue }, index) => (
                <tr key={schedule.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 border border-black font-bold whitespace-nowrap">{index + 1}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap">{order.orderNo || "-"}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap">{formatDate(order.orderDate)}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap font-bold text-indigo-700">{schedule.scheduleNo || "-"}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap">{formatDate(schedule.scheduledDate)}</td>
                  <td className="px-3 py-2 border border-black">{company?.name || "-"}</td>
                  <td className="px-3 py-2 border border-black whitespace-nowrap">{order.erpCode || "-"}</td>
                  <td className="px-3 py-2 border border-black">{item?.name || "-"}</td>
                  <td className={`px-3 py-2 border border-black font-bold ${boxType ? "" : "bg-red-100 text-red-700"}`}>
                    {boxType || "Missing"}
                  </td>
                  <td className={`px-3 py-2 border border-black font-bold ${rapcValue ? "" : "bg-red-100 text-red-700"}`}>
                    {rapcValue || "Missing"}
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
