import React, { useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Order, Company, Item } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/utils";
import { Select } from "../components/Select";
import { useLocation } from "react-router-dom";
import { User } from "../types";
import { getFinancialYear } from "../lib/serial";

export function OrderForm() {
  const [orders, setOrders, isLoading] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [users] = useData<User>("users", []);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().slice(0,10));
  const [companyId, setCompanyId] = useState("");
  const [poType, setPoType] = useState<"Verbal"|"Ref No.">("Verbal");
  const [poNumber, setPoNumber] = useState("");
  const [itemId, setItemId] = useState("");
  const [erpCode, setErpCode] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [orderBy, setOrderBy] = useState("");
  const [remarks, setRemarks] = useState("");

  const getNextVerbalPoNumber = (effectiveOrderDate: string, ignoreOrderId?: string | null) => {
    const fy = getFinancialYear(effectiveOrderDate);
    const matching = orders.filter(
      (order) =>
        order.id !== ignoreOrderId &&
        order.poType === "Verbal" &&
        String(order.poNumber || "").startsWith(`${fy}/`)
    );
    const maxNo = matching.reduce((max, order) => {
      const parts = String(order.poNumber || "").split("/");
      const num = parseInt(parts[1] || "0", 10);
      return Number.isFinite(num) && num > max ? num : max;
    }, 0);
    return `${fy}/${maxNo + 1}`;
  };

  const poOptions = [
    { value: "Verbal", label: "Verbal" },
    { value: "Ref No.", label: "Ref No." },
  ];

  const companyOptions = companies
    .slice()
    .sort((a,b) => (a.name||"").localeCompare(b.name||""))
    .map(c => ({ value: c.id, label: c.name }));

  const itemOptions = useMemo(() => {
    return items
      .filter(i => !companyId || i.customer === companies.find(c => c.id === companyId)?.name)
      .slice()
      .sort((a,b) => (a.name||"").localeCompare(b.name||""))
      .map(i => ({ value: i.id, label: i.name }));
  }, [items, companyId, companies]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const location = useLocation();

  const userOptions = users.slice().sort((a,b)=> (a.name||"").localeCompare(b.name||"")).map(u=>({ value: u.id, label: u.name }));

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setOrders(orders.filter(o => o.id !== id));
    setDeletingId(null);
  };

  const handleEdit = (o: Order) => {
    setEditingId(o.id);
    setOrderDate(o.orderDate || "");
    setCompanyId(o.companyId);
    setPoType(o.poType || "Verbal");
    setPoNumber(o.poNumber || "");
    setItemId(o.itemId);
    setErpCode((o.erpCode || "").toString());
    setQty(o.qty?.toString() || "");
    setRate(o.rate?.toString() || "");
    setOrderBy(o.orderBy || "");
    setRemarks(o.remarks || "");
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setOrderDate(new Date().toISOString().slice(0,10));
    setCompanyId("");
    setPoType("Verbal");
    setPoNumber("");
    setItemId("");
    setErpCode("");
    setQty("");
    setRate("");
    setOrderBy("");
    setRemarks("");
  };

  useEffect(() => {
    if (poType === "Verbal") {
      const editingOrder = editingId ? orders.find((o) => o.id === editingId) : null;
      if (editingOrder?.poType === "Verbal" && editingOrder.poNumber) {
        setPoNumber(editingOrder.poNumber);
      } else {
        setPoNumber(getNextVerbalPoNumber(orderDate, editingId));
      }
    } else if (editingId) {
      const editingOrder = orders.find((o) => o.id === editingId);
      setPoNumber(editingOrder?.poType === "Ref No." ? editingOrder.poNumber || "" : "");
    } else {
      setPoNumber("");
    }
  }, [poType, orderDate, editingId, orders]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !itemId || !qty) return;
    if (!orderBy) {
      alert("Order By is mandatory.");
      return;
    }

    if (!/^[0-9]+$/.test(qty)) {
      alert("Qty must be a whole number (no decimals) or enter integer value.");
      return;
    }

    const rateNumber = Number(rate);
    if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
      alert("Rate must be greater than 0.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as any;
      const payload: Order = {
        id: editingId || crypto.randomUUID(),
        ...(editingId ? { orderNo: orders.find(o=>o.id===editingId)?.orderNo } : {}),
        orderDate,
        companyId,
        poNumber: poType === "Verbal" ? getNextVerbalPoNumber(orderDate, editingId) : poNumber,
        erpCode,
        itemId,
        qty: parseInt(qty,10),
        rate: rateNumber,
        orderBy,
        poType,
        remarks,
        status: editingId ? orders.find(o=>o.id===editingId)?.status || 'Pending PH' : 'Pending PH',
        ...audit
      };

      if (editingId) {
        setOrders(orders.map(o => o.id === editingId ? { ...o, ...payload } : o));
      } else {
        setOrders([...orders, payload]);
      }

      resetForm();
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  // Auto-fill ERP when item selected
  const handleItemChange = (id: string) => {
    if (id === itemId) return;
    setItemId(id);
    const it = items.find(i => i.id === id);
    if (it && typeof it.erp !== 'undefined') setErpCode((it.erp || "").toString());
    else setErpCode("");
    if (it && typeof it.rate !== "undefined" && it.rate !== null) {
      setRate(String(it.rate));
    }
  };

  // Auto-open edit when ?edit=<id> in URL (used by Plant Head edit link)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editId = params.get("edit");
    if (editId) {
      const o = orders.find(x => x.id === editId);
      if (o) {
        // populate form
        setIsFormOpen(true);
        setEditingId(o.id);
        setOrderDate(o.orderDate || "");
        setCompanyId(o.companyId);
        setPoType(o.poType || "Verbal");
        setPoNumber(o.poNumber || "");
        setItemId(o.itemId);
        setErpCode((o.erpCode || "").toString());
        setQty(o.qty?.toString() || "");
        setRate(o.rate?.toString() || "");
        setOrderBy(o.orderBy || "");
        setRemarks(o.remarks || "");
      }
    }
  }, [location.search, orders]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Order Form</h2>
        {!isFormOpen && (
          <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow">
            <Plus size={18} /> New Order
          </button>
        )}
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-sm border border-black space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Order Date</label>
              <input type="date" value={orderDate} onChange={(e)=>setOrderDate(e.target.value)} className="border-2 border-black rounded p-2" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Company Name</label>
              <Select value={companyId} onChange={setCompanyId} options={companyOptions} placeholder="Select Company..." />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">PO Type</label>
              <Select value={poType} onChange={(v:any)=>setPoType(v)} options={poOptions} />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">PO Number</label>
              <input value={poNumber} onChange={(e)=>setPoNumber(e.target.value)} className={`border-2 rounded p-2 ${poType === 'Verbal' ? 'bg-slate-200 border-gray-300 text-slate-600' : 'border-black text-black'}`} disabled={poType === 'Verbal'} />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Item</label>
              <Select value={itemId} onChange={handleItemChange} options={itemOptions} placeholder="Select Item..." />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">ERP Code</label>
              <input value={erpCode} onChange={(e)=>setErpCode(e.target.value)} className="border-2 border-black rounded p-2 bg-slate-100 text-slate-700" readOnly />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Qty</label>
              <input value={qty} onChange={(e)=>setQty(e.target.value.replace(/[^0-9]/g,''))} className="border-2 border-black rounded p-2" />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Rate</label>
              <input
                value={rate}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cleaned = raw.replace(/[^0-9.]/g, "");
                  const parts = cleaned.split(".");
                  const normalized = parts.length <= 2 ? cleaned : `${parts[0]}.${parts.slice(1).join("")}`;
                  setRate(normalized);
                }}
                type="number"
                min={0.01}
                step={0.01}
                className="border-2 border-black rounded p-2"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Order By <span className="text-red-500">*</span></label>
              <Select value={orderBy} onChange={setOrderBy} options={userOptions} placeholder="Select user..." required />
            </div>

            <div className="flex flex-col space-y-1 md:col-span-3 lg:col-span-1">
              <label className="font-bold text-black">Remarks</label>
              <input value={remarks} onChange={(e)=>setRemarks(e.target.value)} className="border-2 border-black rounded p-2" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-2 rounded font-bold">{isSubmitting ? <Spinner /> : 'Submit'}</button>
            <button type="button" onClick={()=>{ setIsFormOpen(false); resetForm(); }} className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Order No.</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Order Date</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Company</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">PO Number</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">ERP Code</th>
              <th className="px-4 py-2 text-left font-bold text-black uppercase border border-black">Item</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Rate</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Order By</th>
              <th className="px-4 py-2 text-right font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {orders.map(o => (
              <tr key={o.id} className="divide-x divide-black hover:bg-slate-50">
                <td className="px-4 py-2 border border-black">{o.orderNo}</td>
                <td className="px-4 py-2 border border-black">{formatDate(o.orderDate)}</td>
                <td className="px-4 py-2 border border-black">{companies.find(c => c.id === o.companyId)?.name}</td>
                <td className="px-4 py-2 border border-black">{o.poNumber}</td>
                <td className="px-4 py-2 border border-black">{o.erpCode}</td>
                <td className="px-4 py-2 border border-black">{items.find(i => i.id === o.itemId)?.name}</td>
                <td className="px-4 py-2 text-right border border-black">{o.qty}</td>
                <td className="px-4 py-2 text-right border border-black">{o.rate}</td>
                <td className="px-4 py-2 text-right border border-black">{users.find(u => u.id === o.orderBy)?.name}</td>
                <td className="px-4 py-2 text-right border border-black">
                  <button title="Edit" aria-label="Edit" onClick={() => handleEdit(o)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit size={16} /></button>
                  <button title={deletingId === o.id ? 'Confirm cancel' : 'Cancel'} aria-label={deletingId === o.id ? 'Confirm cancel' : 'Cancel'} onClick={() => handleDelete(o.id)} className={`${deletingId === o.id ? 'text-amber-600 animate-pulse' : 'text-red-600'} hover:text-red-900`}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
