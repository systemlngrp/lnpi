import React, { useState, useEffect } from "react";

import { TableControls } from "../components/TableControls";
import { useData } from "../hooks/useData";
import { Order } from "../types";
import { formatDate } from "../lib/utils";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";

export function CanceledOrders() {
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

  const [orders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const { resolveOrderItem } = useOrderItemCatalog();

  const canceled = orders.filter(o => o.status === 'Cancelled');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Canceled Orders</h2>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

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
            {canceled.map(o => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 border border-black">{o.orderNo}</td>
                <td className="px-3 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===o.companyId)?.name}</td>
                <td className="px-3 py-2 border border-black">{resolveOrderItem(o)?.name || "-"}</td>
                <td className="px-3 py-2 border border-black">{resolveOrderItem(o)?.erp || "-"}</td>
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
