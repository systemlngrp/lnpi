import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Company, DirectCreditNote, Material } from "../types";
import { TableControls } from "../components/TableControls";
import { useAuth } from "../auth/AuthContext";

export function DirectCreditNoteMaster({ pending = false }: { pending?: boolean }) {
  const [notes] = useData<DirectCreditNote>("direct-credit-notes", []);
  const [companies] = useData<Company>("companies", []);
  const [materials] = useData<Material>("materials", []);
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const rows = useMemo(() => notes.filter(n => (!pending || n.status === "Pending Tally")).filter(n => `${n.creditNoteNo} ${n.invoiceNo} ${n.poNumber}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))), [notes, pending, search]);
  const company = (id: string) => companies.find(c => c.id === id)?.name || id;
  const material = (id: string) => materials.find(m => m.id === id)?.name || id;
  const canPost = user?.role === "Admin" || String(user?.email || "").toLowerCase() === "pankaj@bizskilledu.com";
  const post = async (id: string) => { if (!confirm("Mark this Direct Credit Note as Posted?")) return; const token = localStorage.getItem("authToken") || ""; const response = await fetch(`/api/direct-credit-notes/${id}/post`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ remark: "Manually marked posted" }) }); if (!response.ok) { const data = await response.json().catch(() => ({})); alert(data.error || "Failed to post."); } else window.location.reload(); };
  const headers = ["Credit Note", "Invoice", "Company", "Item", "PO Number", "Rate", "Qty", "Taxable", "GST", "CGST", "SGST", "IGST", "Round Off", "Grand Total", "Remark", "Status", ...(pending && canPost ? ["Action"] : [])];
  return <div className="space-y-5"><div className="flex justify-between items-center border-b border-black pb-4"><h2 className="text-xl font-bold uppercase">{pending ? "Pending Direct Credit Notes" : "Direct Credit Note Master"}</h2></div><TableControls searchTerm={search} onSearchChange={setSearch} placeholder="Search credit note, invoice, PO..." /><div className="overflow-x-auto bg-white border border-black rounded"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr>{headers.map(h => <th key={h} className="text-left px-3 py-3 border-b border-black uppercase text-xs">{h}</th>)}</tr></thead><tbody>{rows.map(n => <tr key={n.id} className="border-b border-slate-200"><td className="px-3 py-3 font-bold">{n.creditNoteNo}</td><td className="px-3 py-3">{n.invoiceNo}</td><td className="px-3 py-3">{company(n.companyId)}</td><td className="px-3 py-3">{material(n.materialId)}</td><td className="px-3 py-3">{n.poNumber}</td><td className="px-3 py-3">{Number(n.rate).toFixed(2)}</td><td className="px-3 py-3">{n.qty}</td><td className="px-3 py-3">{Number(n.amount || 0).toFixed(2)}</td><td className="px-3 py-3">{Number(n.gstRate || 0).toFixed(2)}%</td><td className="px-3 py-3">{Number(n.cgstAmount || 0).toFixed(2)}</td><td className="px-3 py-3">{Number(n.sgstAmount || 0).toFixed(2)}</td><td className="px-3 py-3">{Number(n.igstAmount || 0).toFixed(2)}</td><td className="px-3 py-3">{Number(n.roundOff || 0).toFixed(2)}</td><td className="px-3 py-3 font-bold">{Number(n.grandTotal ?? n.amount ?? 0).toFixed(2)}</td><td className="px-3 py-3">{n.remark || "-"}</td><td className="px-3 py-3">{n.status}</td>{pending && canPost ? <td className="px-3 py-3"><button onClick={() => post(n.id)} className="bg-emerald-600 text-white px-3 py-1 rounded font-bold">Post</button></td> : null}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="p-12 text-center font-bold text-slate-500">No records found</td></tr>}</tbody></table></div></div>;
}
