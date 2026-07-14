import React, { useState, useMemo } from "react";

import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { User } from "../types";
import { useData } from "../hooks/useData";
import { Order } from "../types";
import { formatDate } from "../lib/utils";
import { useNavigate } from "react-router-dom";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { ChevronUp, ChevronDown, CheckCircle, XCircle, Edit } from "lucide-react";

export function OrdersPendingPH() {
  const [searchTerm, setSearchTerm] = useState('');
  const [orderByFilter, setOrderByFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [orders, setOrders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const [users] = useData<User>("users", []);
  const { resolveOrderItem } = useOrderItemCatalog();
  const navigate = useNavigate();

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach((u) => {
      if (u.id) map.set(u.id.toLowerCase(), u);
      if (u.userId) map.set(u.userId.toLowerCase(), u);
      if (u.name) map.set(u.name.toLowerCase(), u);
    });
    return map;
  }, [users]);

  const resolveOrderByUser = (raw: string): User | null => {
    const val = String(raw || "").trim().toLowerCase();
    if (!val) return null;
    return userMap.get(val) || null;
  };

  const pending = orders.filter(o => !o.status || o.status === 'Pending PH');

  const orderByOptions = useMemo(() => {
    const presentUserIds = new Set<string>();
    pending.forEach((o) => {
      const u = resolveOrderByUser(String(o.orderBy || ""));
      if (u) presentUserIds.add(u.id);
    });

    return Array.from(presentUserIds)
      .map((id) => {
        const u = users.find((user) => user.id === id);
        return { value: id, label: u?.name || id };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [pending, users, userMap]);

  const getOrderByLabel = (raw: string) => {
    const u = resolveOrderByUser(String(raw || ""));
    if (u) return u.name || "";
    return String(raw || "").trim();
  };

  const filtered = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return pending
      .map((order) => {
        const item = resolveOrderItem(order);
        const companyName = (companies as any[]).find((c: any) => c.id === order.companyId)?.name || "";
        return {
          order,
          item,
          companyName,
          orderByLabel: getOrderByLabel(order.orderBy),
        };
      })
      .filter(({ order, item, companyName, orderByLabel }) => {
        if (orderByFilter && String(order.orderBy || "") !== orderByFilter) return false;
        if (!normalizedSearch) return true;
        const haystack = [
          order.orderNo,
          formatDate(order.orderDate),
          companyName,
          item?.name,
          item?.erp,
          orderByLabel,
          String(order.qty || ""),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => {
        const aNo = a.order.orderNo || "";
        const bNo = b.order.orderNo || "";
        const cmp = aNo.localeCompare(bNo, undefined, { numeric: true, sensitivity: "base" });
        return sortOrder === "asc" ? cmp : -cmp;
      });
  }, [companies, orderByFilter, pending, resolveOrderItem, searchTerm, sortOrder]);

  const presentOrderByValues = Array.from(new Set(pending.map(o => String(o.orderBy || "").trim()).filter(Boolean)));
  const unmappedOrderBys = presentOrderByValues.filter(v => !resolveOrderByUser(v));
  const params = new URLSearchParams(window.location.search);
  const showDebug = params.get("debug") === "1";

  const toggleSort = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
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
            <strong>Debug:</strong> Unmapped Order By values: {unmappedOrderBys.length} {unmappedOrderBys.length > 0 && ` â€” ${unmappedOrderBys.slice(0,10).join(", ")}`}
          </div>
        )}
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th 
                className="px-4 py-2 border border-black cursor-pointer hover:bg-slate-200 select-none"
                onClick={toggleSort}
              >
                <div className="flex items-center justify-center gap-1">
                  Order No
                  {sortOrder === "asc" ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </th>
              <th className="px-4 py-2 border border-black">Order Date</th>
              <th className="px-4 py-2 border border-black">Company</th>
              <th className="px-4 py-2 border border-black">Item</th>
              <th className="px-4 py-2 border border-black">Item ERP</th>
              <th className="px-4 py-2 border border-black">Order By</th>
              <th className="px-4 py-2 border border-black">Qty</th>
              <th className="px-4 py-2 border border-black">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ order: o, item, companyName, orderByLabel }) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 border border-black">{o.orderNo}</td>
                <td className="px-4 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-4 py-2 border border-black">{companyName || "-"}</td>
                <td className="px-4 py-2 border border-black">{item?.name || "-"}</td>
                <td className="px-4 py-2 border border-black">{item?.erp || "-"}</td>
                <td className="px-4 py-2 border border-black whitespace-nowrap">{orderByLabel || '-'}</td>
                <td className="px-4 py-2 border border-black">{o.qty}</td>
                <td className="px-4 py-2 border border-black">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleApprove(o.id)} 
                      title="Approve"
                      className="text-emerald-600 hover:text-emerald-800 transition-colors"
                    >
                      <CheckCircle size={20} />
                    </button>
                    <button 
                      onClick={() => handleCancel(o.id)} 
                      title="Cancel"
                      className="text-red-600 hover:text-red-800 transition-colors"
                    >
                      <XCircle size={20} />
                    </button>
                    <button 
                      onClick={() => navigate(`/orders/form?edit=${o.id}`)} 
                      title="Edit"
                      className="text-slate-600 hover:text-slate-900 transition-colors"
                    >
                      <Edit size={20} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
