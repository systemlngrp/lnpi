import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
import { Company, DirectCreditNote, Material } from "../types";

const empty = { invoiceNo: "", companyId: "", materialId: "", poNumber: "", rate: "", qty: "", remark: "" };

export function DirectCreditNoteForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [companies] = useData<Company>("companies", []);
  const [materials] = useData<Material>("materials", []);
  const [, , , actions] = useData<DirectCreditNote>("direct-credit-notes", []);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const amount = useMemo(() => Number(form.rate || 0) * Number(form.qty || 0), [form.rate, form.qty]);

  const update = (key: keyof typeof empty, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const rate = Number(form.rate), qty = Number(form.qty);
    if (!form.invoiceNo.trim() || !form.companyId || !form.materialId || !form.poNumber.trim() || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(qty) || qty <= 0) {
      alert("Please fill all required fields with positive Rate and Quantity.");
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const note: DirectCreditNote = {
        id: crypto.randomUUID(), creditNoteNo: `DCN/${new Date().getFullYear()}/${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        invoiceNo: form.invoiceNo.trim(), companyId: form.companyId, materialId: form.materialId, poNumber: form.poNumber.trim(),
        rate, qty, amount: Math.round(rate * qty * 100) / 100, remark: form.remark.trim(), status: "Pending Tally",
        createdBy: user?.email || user?.name || "System User", createdAt: now, updatedBy: user?.email || user?.name, updateTimestamp: now,
      };
      await actions.addItem(note);
      alert(`Direct Credit Note ${note.creditNoteNo} saved successfully.`);
      setForm(empty);
      navigate("/material-receipt/direct-credit-note/pending");
    } catch (error) { alert((error as Error).message || "Failed to save Direct Credit Note."); }
    finally { setSaving(false); }
  };

  return <div className="max-w-4xl space-y-6">
    <div className="border-b border-black pb-4"><h2 className="text-xl font-bold uppercase">Direct Credit Note</h2></div>
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-5 bg-white border border-black rounded p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
      <label className="font-semibold">Invoice No.*<input className="w-full border-2 border-black rounded p-2 mt-1" value={form.invoiceNo} onChange={e => update("invoiceNo", e.target.value)} /></label>
      <label className="font-semibold">Company*<select className="w-full border-2 border-black rounded p-2 mt-1 bg-white" value={form.companyId} onChange={e => update("companyId", e.target.value)}><option value="">Select Company</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="font-semibold">Item Name*<select className="w-full border-2 border-black rounded p-2 mt-1 bg-white" value={form.materialId} onChange={e => update("materialId", e.target.value)}><option value="">Select Item</option>{materials.filter(m => m.active !== "No").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="font-semibold">PO Number*<input className="w-full border-2 border-black rounded p-2 mt-1" value={form.poNumber} onChange={e => update("poNumber", e.target.value)} /></label>
      <label className="font-semibold">Rate*<input type="number" min="0.01" step="0.01" className="w-full border-2 border-black rounded p-2 mt-1" value={form.rate} onChange={e => update("rate", e.target.value)} /></label>
      <label className="font-semibold">Quantity*<input type="number" min="0.001" step="0.001" className="w-full border-2 border-black rounded p-2 mt-1" value={form.qty} onChange={e => update("qty", e.target.value)} /></label>
      <label className="font-semibold">Amount<input readOnly className="w-full border-2 border-slate-300 rounded p-2 mt-1 bg-slate-100" value={amount.toFixed(2)} /></label>
      <label className="font-semibold">Remark<textarea className="w-full border-2 border-black rounded p-2 mt-1" rows={2} value={form.remark} onChange={e => update("remark", e.target.value)} /></label>
      <div className="md:col-span-2 flex justify-end gap-3"><button type="button" className="border-2 border-black px-5 py-2 rounded font-bold" onClick={() => setForm(empty)}>Reset</button><button disabled={saving} className="bg-black text-white px-6 py-2 rounded font-bold">{saving ? "Saving..." : "Save Direct Credit Note"}</button></div>
    </form>
  </div>;
}
