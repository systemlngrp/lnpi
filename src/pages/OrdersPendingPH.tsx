import React, { useState, useEffect } from "react";

import { TableControls } from "../components/TableControls";
import { useData } from "../hooks/useData";
import { Order } from "../types";
import { formatDate } from "../lib/utils";
import { useNavigate } from "react-router-dom";
import { useNpdItems } from "../hooks/useNpdItems";

export function OrdersPendingPH() {
  const [searchTerm, setSearchTerm] = useState('');
  const [orderByFilter, setOrderByFilter] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [orders, setOrders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const npdItems = useNpdItems();
  const navigate = useNavigate();

  const pending = orders.filter(o => !o.status || o.status === 'Pending PH');

  const orderByOptions = Array.from(new Set(orders.map(o => o.orderBy).filter(Boolean))).sort();
  const filtered = pending.filter(o => {
    if (orderByFilter && String(o.orderBy || '').toLowerCase() !== orderByFilter.toLowerCase()) return false;
    return true;
  });

  const handleApprove = (id: string) => {
    const now = new Date().toISOString();
    setOrders(
      orders.map((o) =>
        o.id === id
          ? {
              ...o,
              status: "Pending Scheduling",
              approvedTimestamp: o.approvedTimestamp || now,
              approvedEmail: o.approvedEmail || "System User",
              updatedBy: "System User",
              updateTimestamp: now,
            }
          : o
      )
    );
  };

  const handleCancel = (id: string) => {
    const cancelRemarks = window.prompt("Enter cancel remarks");
    if (cancelRemarks === null) return;
    if (!cancelRemarks.trim()) {
      alert("Cancel remarks are required.");
      return;
    }
    const timestamp = new Date().toISOString();
    setOrders(
      orders.map((o) =>
        o.id === id
          ? {
              ...o,
              status: 'Cancelled',
              remarks: [o.remarks?.trim(), `Cancel Remarks: ${cancelRemarks.trim()}`].filter(Boolean).join(" | "),
              updatedBy: 'System User',
              updateTimestamp: timestamp,
            }
          : o
      )
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Pending Salesman Approval</h2>

      <div className="flex items-center gap-4">
        <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        <div className="flex items-center gap-2">
          <label className="text-sm font-bold text-black uppercase">Order By</label>
          <select value={orderByFilter} onChange={(e) => setOrderByFilter(e.target.value)} className="border border-black rounded px-2 py-1 text-sm">
            <option value="">All</option>
            {orderByOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2 border border-black">Order No</th>
              <th className="px-4 py-2 border border-black">Order Date</th>
              <th className="px-4 py-2 border border-black">Company</th>
              <th className="px-4 py-2 border border-black">Item</th>
              <th className="px-4 py-2 border border-black">Order By</th>
              <th className="px-4 py-2 border border-black">Qty</th>
              <th className="px-4 py-2 border border-black">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 border border-black">{o.orderNo}</td>
                <td className="px-4 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-4 py-2 border border-black">{(companies as any[]).find((c:any)=>c.id===o.companyId)?.name}</td>
                <td className="px-4 py-2 border border-black">{npdItems.find((item) => item.id === o.itemId)?.name}</td>
                <td className="px-4 py-2 border border-black whitespace-nowrap">{o.orderBy || '-'}</td>
                <td className="px-4 py-2 border border-black">{o.qty}</td>
                <td className="px-4 py-2 border border-black">
                  <button onClick={() => handleApprove(o.id)} className="bg-emerald-600 text-white px-3 py-1 rounded font-bold mr-2">Approve</button>
                  <button onClick={() => handleCancel(o.id)} className="bg-red-600 text-white px-3 py-1 rounded font-bold mr-2">Cancel</button>
                  <button onClick={() => navigate(`/orders/form?edit=${o.id}`)} className="bg-slate-200 text-black px-3 py-1 rounded font-bold">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
