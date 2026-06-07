import React, { useState, useEffect } from "react";

import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { User } from "../types";
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
  const [users] = useData<User>("users", []);
  const npdItems = useNpdItems();
  const navigate = useNavigate();

  const pending = orders.filter(o => !o.status || o.status === 'Pending PH');

  const normalize = (s: string) => String(s || "").trim().toLowerCase();

  const looksLikeId = (val: string) => /^[0-9a-fA-F\-]{10,}$/.test(val);

  const resolveOrderByUser = (raw: string): User | null => {
    const val = String(raw || "").trim();
    if (!val) return null;
    // If it looks like an id, match only against users.id
    if (looksLikeId(val)) {
      return users.find(u => u.id === val) || null;
    }
    // try by userId
    const byUserId = users.find(u => String(u.userId || "") === val);
    if (byUserId) return byUserId;
    // try by name (normalized)
    const byName = users.find(u => normalize(u.name) === normalize(val));
    if (byName) return byName;
    return null;
  };

  const presentUserMap = new Map<string, User>();
  pending.forEach(o => {
    const u = resolveOrderByUser(String(o.orderBy || ""));
    if (u) presentUserMap.set(u.id, u);
  });

  const orderByOptions = Array.from(presentUserMap.values())
    .map(u => ({ value: u.id, label: u.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const filtered = pending.filter(o => {
    if (orderByFilter && String(o.orderBy || "") !== orderByFilter) return false;
    return true;
  });

  const presentOrderByValues = Array.from(new Set(pending.map(o => String(o.orderBy || "").trim()).filter(Boolean)));
  const unmappedOrderBys = presentOrderByValues.filter(v => !resolveOrderByUser(v));
  const params = new URLSearchParams(window.location.search);
  const showDebug = params.get("debug") === "1";

  const getOrderByLabel = (raw: string) => {
    const u = resolveOrderByUser(String(raw || ""));
    if (u) return u.name || "";
    const val = String(raw || "").trim();
    if (!val) return "";
    if (val.includes(" ") || val.includes("@")) return val;
    return "";
  };

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

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[320px]">
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-black uppercase">Order By</span>
          <div className="w-64">
            <Select
              options={orderByOptions}
              value={orderByFilter}
              onChange={(v) => setOrderByFilter(v)}
              placeholder="All"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {showDebug && (
          <div className="p-3 bg-yellow-50 border-b border-black text-sm">
            <strong>Debug:</strong> Unmapped Order By values: {unmappedOrderBys.length} {unmappedOrderBys.length > 0 && ` — ${unmappedOrderBys.slice(0,10).join(", ")}`}
          </div>
        )}
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
                <td className="px-4 py-2 border border-black whitespace-nowrap">{getOrderByLabel(o.orderBy) || '-'}</td>
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
