import React from "react";
import { useData } from "../hooks/useData";
import { Order } from "../types";
import { useNavigate } from "react-router-dom";

export function OrdersPendingPH() {
  const [orders, setOrders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const [items] = useData("items", []);
  const navigate = useNavigate();

  const pending = orders.filter(o => !o.status || o.status === 'Pending PH');

  const handleApprove = (id: string) => {
    setOrders(orders.map(o => o.id === id ? { ...o, status: 'Pending Scheduling', updatedBy: 'System User', updateTimestamp: new Date().toISOString() } : o));
  };

  const handleCancel = (id: string) => {
    setOrders(orders.map(o => o.id === id ? { ...o, status: 'Cancelled', updatedBy: 'System User', updateTimestamp: new Date().toISOString() } : o));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Pending Plant Head Approval</h2>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2 border border-black">Order No</th>
              <th className="px-4 py-2 border border-black">Order Date</th>
              <th className="px-4 py-2 border border-black">Company</th>
              <th className="px-4 py-2 border border-black">Item</th>
              <th className="px-4 py-2 border border-black">Qty</th>
              <th className="px-4 py-2 border border-black">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map(o => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 border border-black">{o.orderNo}</td>
                <td className="px-4 py-2 border border-black">{o.orderDate}</td>
                <td className="px-4 py-2 border border-black">{(companies as any[]).find((c:any)=>c.id===o.companyId)?.name}</td>
                <td className="px-4 py-2 border border-black">{(items as any[]).find((it:any)=>it.id===o.itemId)?.name}</td>
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
