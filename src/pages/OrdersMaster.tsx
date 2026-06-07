import React from "react";
import { useData } from "../hooks/useData";
import { Order } from "../types";
import { formatDate } from "../lib/utils";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";

export function OrdersMaster() {
  const navigate = useNavigate();
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData("companies", []);
  const npdItems = useNpdItems();
  const [users] = useData("users", []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Orders Master</h2>
        <button 
          onClick={() => navigate("/orders/form")} 
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
        >
          <Plus size={18} /> New Order
        </button>
      </div>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
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
                <td className="px-3 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-3 py-2 border border-black">{(companies as any[]).find(c=>c.id===o.companyId)?.name}</td>
                <td className="px-3 py-2 border border-black">{o.poNumber}</td>
                <td className="px-3 py-2 border border-black">{o.erpCode}</td>
                <td className="px-3 py-2 border border-black">{npdItems.find(i => i.id === o.itemId)?.name}</td>
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
