import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
import { Select } from "../components/Select";
import { Company, DirectCreditNote, GstRateMaster, Material } from "../types";

const empty = { invoiceNo: "", companyId: "", materialId: "", poNumber: "", rate: "", qty: "", gstRate: "0", roundOff: "0", remark: "" };
const money = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function DirectCreditNoteForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [companies] = useData<Company>("companies", []);
  const [materials] = useData<Material>("materials", []);
  const [gstRateMasters] = useData<GstRateMaster>("gst-rate-masters", []);
  const [, , , actions] = useData<DirectCreditNote>("direct-credit-notes", []);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const amount = useMemo(() => Number(form.rate || 0) * Number(form.qty || 0), [form.rate, form.qty]);
  const selectedCompany = companies.find((company) => company.id === form.companyId);
  const supplyType = selectedCompany?.gstSupplyType === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE";
  const gstRate = Number(form.gstRate || 0);
  const gstAmount = money((amount * gstRate) / 100);
  const cgstAmount = supplyType === "INTRA_STATE" ? money(gstAmount / 2) : 0;
  const sgstAmount = supplyType === "INTRA_STATE" ? money(gstAmount - cgstAmount) : 0;
  const igstAmount = supplyType === "INTER_STATE" ? gstAmount : 0;
  const roundOff = Number(form.roundOff || 0);
  const grandTotal = money(amount + cgstAmount + sgstAmount + igstAmount + (Number.isFinite(roundOff) ? roundOff : 0));
  const companyOptions = useMemo(() => companies
    .map((company) => ({
      value: company.id,
      label: company.name,
      searchText: `${company.name} ${company.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), [companies]);
  const materialOptions = useMemo(() => materials
    .filter((material) => material.active !== "No")
    .map((material) => ({
      value: material.id,
      label: material.name,
      searchText: `${material.name} ${material.erpCode || ""} ${material.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), [materials]);
  const gstOptions = useMemo(() => [{ value: "0", label: "0%", searchText: "0 zero" }, ...gstRateMasters
    .filter((entry) => entry.active !== "No")
    .map((entry) => ({ value: String(entry.rate), label: `${entry.name} (${entry.rate}%)`, searchText: `${entry.name} ${entry.rate}` }))]
    .filter((option, index, all) => all.findIndex((item) => item.value === option.value) === index), [gstRateMasters]);

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
        rate, qty, amount: money(amount), gstRate, cgstRate: supplyType === "INTRA_STATE" ? gstRate / 2 : 0,
        sgstRate: supplyType === "INTRA_STATE" ? gstRate / 2 : 0, igstRate: supplyType === "INTER_STATE" ? gstRate : 0,
        cgstAmount, sgstAmount, igstAmount, roundOff: Number.isFinite(roundOff) ? roundOff : 0, grandTotal, supplyType,
        remark: form.remark.trim(), status: "Pending Tally",
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
      <label className="font-semibold">Company*<Select options={companyOptions} value={form.companyId} onChange={(value) => update("companyId", value)} placeholder="Search company..." required /></label>
      <label className="font-semibold">Item Name*<Select options={materialOptions} value={form.materialId} onChange={(value) => update("materialId", value)} placeholder="Search item or ERP code..." required wrapLabels /></label>
      <label className="font-semibold">PO Number*<input className="w-full border-2 border-black rounded p-2 mt-1" value={form.poNumber} onChange={e => update("poNumber", e.target.value)} /></label>
      <label className="font-semibold">Rate*<input type="number" min="0.01" step="0.01" className="w-full border-2 border-black rounded p-2 mt-1" value={form.rate} onChange={e => update("rate", e.target.value)} /></label>
      <label className="font-semibold">Quantity*<input type="number" min="0.001" step="0.001" className="w-full border-2 border-black rounded p-2 mt-1" value={form.qty} onChange={e => update("qty", e.target.value)} /></label>
      <label className="font-semibold">GST Rate<Select options={gstOptions} value={form.gstRate} onChange={(value) => update("gstRate", value)} placeholder="Search GST rate..." required /></label>
      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4 rounded border border-slate-300 bg-slate-50 p-3 text-sm">
        <div><div className="font-semibold">Taxable Amount</div><div className="font-bold">{money(amount).toFixed(2)}</div></div>
        {supplyType === "INTRA_STATE" ? <><div><div className="font-semibold">CGST ({(gstRate / 2).toFixed(2)}%)</div><div className="font-bold">{cgstAmount.toFixed(2)}</div></div><div><div className="font-semibold">SGST ({(gstRate / 2).toFixed(2)}%)</div><div className="font-bold">{sgstAmount.toFixed(2)}</div></div></> : <div><div className="font-semibold">IGST ({gstRate.toFixed(2)}%)</div><div className="font-bold">{igstAmount.toFixed(2)}</div></div>}
        <div><div className="font-semibold">Supply Type</div><div className="font-bold">{supplyType === "INTER_STATE" ? "Inter-State" : "Intra-State"}</div></div>
      </div>
      <label className="font-semibold">Round Off<input type="number" step="0.01" className="w-full border-2 border-black rounded p-2 mt-1" value={form.roundOff} onChange={e => update("roundOff", e.target.value)} /></label>
      <label className="font-semibold">Grand Total<input readOnly className="w-full border-2 border-slate-300 rounded p-2 mt-1 bg-slate-100" value={grandTotal.toFixed(2)} /></label>
      <label className="font-semibold">Remark<textarea className="w-full border-2 border-black rounded p-2 mt-1" rows={2} value={form.remark} onChange={e => update("remark", e.target.value)} /></label>
      <div className="md:col-span-2 flex justify-end gap-3"><button type="button" className="border-2 border-black px-5 py-2 rounded font-bold" onClick={() => setForm(empty)}>Reset</button><button disabled={saving} className="bg-black text-white px-6 py-2 rounded font-bold">{saving ? "Saving..." : "Save Direct Credit Note"}</button></div>
    </form>
  </div>;
}
