import React from "react";
import { useData } from "../hooks/useData";
import { Order } from "../types";

export function OrdersMaster() {
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const [items] = useData("items", []);
  const [users] = useData("users", []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-black uppercase">Orders Master</h2>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 border border-black">Order No</th>
              <th className="px-3 py-2 border border-black">Order Date</th>
              <th className="px-3 py-2 border border-black">Company</th>
              <th className="px-3 py-2 border border-black">PO Number</th>
              <th className="px-3 py-2 border border-black">ERP Code</th>
              <th className="px-3 py-2 border border-black">Item</th>
              <th className="px-3 py-2 border border-black">Qty</th>
              <th className="px-3 py-2 border border-black">Rate</th>
              <th className="px-3 py-2 border border-black">Order By</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 border border-black">{o.orderNo}</td>
                <td className="px-3 py-2 border border-black">{o.orderDate}</td>
                <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===o.companyId)?.name}</td>
                <td className="px-3 py-2 border border-black">{o.poNumber}</td>
                <td className="px-3 py-2 border border-black">{o.erpCode}</td>
                <td className="px-3 py-2 border border-black">{(items as any[]).find(i=>i.id===o.itemId)?.name}</td>
                <td className="px-3 py-2 border border-black">{o.qty}</td>
                <td className="px-3 py-2 border border-black">{o.rate}</td>
                <td className="px-3 py-2 border border-black">{(users as any[]).find(u=>u.id===o.orderBy)?.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
