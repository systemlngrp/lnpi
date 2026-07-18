import React, { useMemo, useState } from "react";

import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { useData } from "../hooks/useData";
import { Order } from "../types";
import { formatDate } from "../lib/utils";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";

export function CanceledOrders() {
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const { resolveOrderItem } = useOrderItemCatalog();

  const canceledRows = useMemo(() => {
    const rows = orders
      .filter((order) => order.status === 'Cancelled')
      .map((order) => {
        const company = (companies as any[]).find((row) => row.id === order.companyId);
        const item = resolveOrderItem(order);
        const itemKey = item?.id || `${item?.name || ""}::${item?.erp || ""}`;
        return { order, company, item, companyName: company?.name || "", itemKey };
      });
    const needle = searchTerm.trim().toLowerCase();
    return rows.filter(({ order, companyName, item, itemKey }) => {
      if (companyFilter && order.companyId !== companyFilter) return false;
      if (itemFilter && itemKey !== itemFilter) return false;
      if (!needle) return true;
      return [order.orderNo, formatDate(order.orderDate), companyName, item?.name, item?.erp, order.qty, order.remarks]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [companies, companyFilter, itemFilter, orders, resolveOrderItem, searchTerm]);

  const companyOptions = useMemo(
    () =>
      Array.from(
        new Map(canceledRows.map((row) => [row.order.companyId, { value: row.order.companyId, label: row.companyName }])).values()
      )
        .filter((option) => option.value && option.label)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [canceledRows]
  );

  const itemOptions = useMemo(
    () =>
      Array.from(
        new Map(
          canceledRows.map((row) => [
            row.itemKey,
            {
              value: row.itemKey,
              label:
                row.item?.erp && row.item?.name && !row.item.name.toLowerCase().includes(String(row.item.erp).toLowerCase())
                  ? `${row.item.name} - ${row.item.erp}`
                  : row.item?.name || row.item?.erp || "",
              searchText: `${row.item?.name || ""} ${row.item?.erp || ""}`,
            },
          ])
        ).values()
      )
        .filter((option) => option.value && option.label)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [canceledRows]
  );

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Canceled Orders</h2>

      <div className="grid gap-3 md:grid-cols-[minmax(260px,1.4fr)_minmax(220px,1fr)_minmax(260px,1.1fr)_auto] md:items-center">
        <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
        <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
        {(searchTerm || companyFilter || itemFilter) ? (
          <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
        ) : null}
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 border border-black">Order No</th>
              <th className="px-3 py-2 border border-black">Order Date</th>
              <th className="px-3 py-2 border border-black">Company</th>
              <th className="px-3 py-2 border border-black">Item</th>
              <th className="px-3 py-2 border border-black">Item ERP</th>
              <th className="px-3 py-2 border border-black">Qty</th>
              <th className="px-3 py-2 border border-black">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {canceledRows.map(({ order: o, company, item }) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 border border-black">{o.orderNo}</td>
                <td className="px-3 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-3 py-2 border border-black">{company?.name}</td>
                <td className="px-3 py-2 border border-black">{item?.name || "-"}</td>
                <td className="px-3 py-2 border border-black">{item?.erp || "-"}</td>
                <td className="px-3 py-2 border border-black">{o.qty}</td>
                <td className="px-3 py-2 border border-black">{o.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
