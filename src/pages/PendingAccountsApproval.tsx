import { useData } from "../hooks/useData";
import { Company, GstRateMaster, Material, MaterialIn, Item, Supplier } from "../types";
import { useState, useMemo, useEffect } from "react";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, Edit2, X, Save } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";
import { applySupplyTypeTaxRates, normalizeMaterialInRecord, recalculateMaterialLine } from "../lib/materialInTaxes";

export function PendingAccountsApproval() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [gstRateMasters] = useData<GstRateMaster>("gst_rate_masters", []);

  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MaterialIn | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  const toggleSelectAll = (ids: string[]) => {
    if (selectedIds.size === ids.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleEdit = (m: MaterialIn) => {
    setEditingId(m.id);
    const supplyType = getGstSupplyType(m.supplierId);
    const cloned = JSON.parse(JSON.stringify(m)) as MaterialIn;
    setEditForm(
      normalizeMaterialInRecord({
        ...cloned,
        lines: (cloned.lines || []).map((line) =>
          applySupplyTypeTaxRates(line, supplyType === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE")
        ),
      })
    );
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const handleUpdateLine = (idx: number, field: string, value: any) => {
    if (!editForm) return;
    const next = { ...editForm };
    const baseLine = recalculateMaterialLine({ ...next.lines[idx], [field]: value });
    next.lines[idx] = Object.prototype.hasOwnProperty.call({ [field]: value }, "gstRate")
      ? applySupplyTypeTaxRates(baseLine, editFormIsInterState ? "INTER_STATE" : "INTRA_STATE", { forceFromGstRate: true })
      : applySupplyTypeTaxRates(baseLine, editFormIsInterState ? "INTER_STATE" : "INTRA_STATE");
    setEditForm(normalizeMaterialInRecord(next));
  };

  const handleSaveEdit = async () => {
    if (!editForm || !editingId) return;
    setSubmittingId(editingId);
    try {
      await setMaterialIn(prev => prev.map(m => m.id === editingId ? editForm : m));
      handleCancelEdit();
    } catch (err) {
      console.error("Failed to save MRR edit:", err);
    } finally {
      setSubmittingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkApproving(true);
    const timestamp = new Date().toISOString();
    const email = "accounts@lngrp.in";

    try {
      await setMaterialIn(prev => prev.map(m => 
        selectedIds.has(m.id) ? { ...m, status: "Pending MD", accTimestamp: timestamp, accEmailId: email, updateTimestamp: timestamp } : m
      ));
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Bulk approval error:", err);
    } finally {
      setIsBulkApproving(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setSubmittingId(id);
    try {
      const timestamp = new Date().toISOString();
      await setMaterialIn(prev =>
        prev.map((m) =>
          m.id === id ? { ...m, status: "Pending MD", accTimestamp: timestamp, accEmailId: "accounts@lngrp.in", updateTimestamp: timestamp } : m
        )
      );
    } catch (err) {
      console.error("Failed to approve Material In at Accounts stage:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const getLineItemsElement = (lines: MaterialIn['lines']) => {
    return (
      <ul className="list-none space-y-1">
        {lines.map((l, idx) => {
          const itemName = materials.find(i => i.id === l.itemId)?.name || npdItems.find(i => i.id === l.itemId)?.name;
          return (
            <li key={idx} className="whitespace-nowrap border-b border-black last:border-0 pb-1 last:pb-0 mb-1 last:mb-0">
              <span className="font-medium text-black">{itemName || 'Unknown'}</span>
              <span className="ml-2 text-black">[{l.qty} {l.uom} @ {l.rate}]</span>
              {l.gstRate !== undefined && <span className="ml-1 text-[10px] text-slate-500">GST {l.gstRate}% | CGST {Number(l.cgst || 0).toFixed(2)} | SGST {Number(l.sgst || 0).toFixed(2)} | IGST {Number(l.igst || 0).toFixed(2)}</span>}
            </li>
          );
        })}
      </ul>
    );
  };

  const gstRateOptions = useMemo(
    () =>
      [...gstRateMasters]
        .filter((entry) => entry.active !== "No")
        .sort((a, b) => Number(a.rate || 0) - Number(b.rate || 0))
        .map((entry) => ({ value: String(Number(entry.rate || 0)), label: `${entry.name} (${Number(entry.rate || 0).toFixed(2)}%)` })),
    [gstRateMasters]
  );

  const getGstSupplyType = (supplierId: string) => {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    if (supplier?.gstSupplyType) return supplier.gstSupplyType;
    const company = companies.find((entry) => entry.id === supplierId);
    return company?.gstSupplyType || "INTRA_STATE";
  };

  const editFormIsInterState = (editForm ? getGstSupplyType(editForm.supplierId) : "INTRA_STATE") === "INTER_STATE";

  const getSupplierName = (id: string) =>
    suppliers.find((supplier) => supplier.id === id)?.name ||
    companies.find((company) => company.id === id)?.name ||
    id;

  return (
    <div className="space-y-6">
      <h2 className={cn("text-xl font-bold text-black border-b border-black pb-4 uppercase transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>Pending Accounts Approval</h2>
      <div className={cn("bg-white rounded shadow-sm overflow-hidden border border-black transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        {selectedIds.size > 0 && (
          <div className="p-3 bg-indigo-50 border-b border-black flex justify-between items-center animate-in fade-in slide-in-from-top-1">
            <span className="text-sm font-bold text-indigo-900 uppercase tracking-tight">
              {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'} selected
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={isBulkApproving}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase tracking-widest border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all disabled:opacity-50"
            >
              {isBulkApproving ? <Spinner size={14} /> : <CheckCircle size={14} />}
              Approve Selected
            </button>
          </div>
        )}
        
        {/* Table View */}

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 w-10 border border-black">
                <input 
                  type="checkbox" 
                  className="rounded border-black text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  checked={materialIn.filter(m => m.status === "Pending Accounts").length > 0 && selectedIds.size === materialIn.filter(m => m.status === "Pending Accounts").length}
                  onChange={() => toggleSelectAll(materialIn.filter(m => m.status === "Pending Accounts").map(m => m.id))}
                />
              </th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Transaction No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Items</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Amount</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {materialIn.filter((m) => m.status === "Pending Accounts").length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium text-bold">No pending approvals.</td>
              </tr>
            ) : materialIn
              .filter((m) => m.status === "Pending Accounts")
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((m) => {
                const isEditing = editingId === m.id;
                return (
                  <tr key={m.id} className={cn("hover:bg-slate-50 divide-x divide-black transition-colors", selectedIds.has(m.id) && "bg-indigo-50/50")}>
                    <td className="px-6 py-4 w-10 text-center border border-black">
                      <input 
                        type="checkbox" 
                        className="rounded border-black text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                        checked={selectedIds.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                      />
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-black border border-black">{m.transactionNo}</td>
                    <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(m.date)}</td>
                    <td className="px-6 py-4 text-sm text-black border border-black">{getSupplierName(m.supplierId)}</td>
                    <td className="px-6 py-4 text-sm text-black border border-black">
                      {isEditing && editForm ? (
                        <div className="space-y-2">
                           {editForm.lines.map((l, idx) => {
                             const itemName = materials.find(i => i.id === l.itemId)?.name || npdItems.find(i => i.id === l.itemId)?.name;
                             return (
                               <div key={idx} className="flex flex-wrap items-center gap-2 p-2 border border-slate-200 rounded bg-slate-50">
                                  <div className="text-xs font-bold w-full">{itemName}</div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-500">Qty:</span>
                                    <input 
                                      type="number" 
                                      value={l.qty} 
                                      onChange={(e) => handleUpdateLine(idx, "qty", e.target.value)}
                                      className="w-16 border border-black rounded px-1 text-xs"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-500">Rate:</span>
                                    <input 
                                      type="number" 
                                      value={l.rate} 
                                      onChange={(e) => handleUpdateLine(idx, "rate", e.target.value)}
                                      className="w-20 border border-black rounded px-1 text-xs"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-500">GST %:</span>
                                    <select value={Number(l.gstRate || 0) > 0 ? l.gstRate : ""} onChange={(e) => handleUpdateLine(idx, "gstRate", Number(e.target.value))} className="border border-black rounded text-[10px]">
                                      {gstRateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                  </div>
                                  {!editFormIsInterState ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-slate-500">CGST %:</span>
                                      <input type="number" value={Number(l.cgstRate || 0) > 0 ? l.cgstRate : ""} onChange={(e) => handleUpdateLine(idx, "cgstRate", Number(e.target.value))} className="w-16 border border-black rounded px-1 text-xs" />
                                    </div>
                                  ) : null}
                                  {!editFormIsInterState ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-slate-500">SGST %:</span>
                                      <input type="number" value={Number(l.sgstRate || 0) > 0 ? l.sgstRate : ""} onChange={(e) => handleUpdateLine(idx, "sgstRate", Number(e.target.value))} className="w-16 border border-black rounded px-1 text-xs" />
                                    </div>
                                  ) : null}
                                  {editFormIsInterState ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-slate-500">IGST %:</span>
                                      <input type="number" value={Number(l.igstRate || 0) > 0 ? l.igstRate : ""} onChange={(e) => handleUpdateLine(idx, "igstRate", Number(e.target.value))} className="w-16 border border-black rounded px-1 text-xs" />
                                    </div>
                                  ) : null}
                               </div>
                             );
                           })}
                        </div>
                      ) : getLineItemsElement(m.lines)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black whitespace-nowrap font-mono">
                      {(isEditing && editForm ? editForm.totalAmount : m.totalAmount).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                      <div className="flex items-center justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button
                              onClick={handleSaveEdit}
                              className="p-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                            >
                              <Save size={16} />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="p-2 bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEdit(m)}
                              className="p-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleApprove(m.id)}
                              disabled={submittingId === m.id}
                              className={cn(
                                "inline-flex items-center justify-center min-w-[120px] px-4 py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                                confirmId === m.id 
                                  ? "bg-amber-600 text-white border-black animate-pulse" 
                                  : "bg-indigo-100 text-indigo-800 border-indigo-800 hover:bg-indigo-200"
                              )}
                            >
                              {submittingId === m.id ? (
                                <Spinner size={16} />
                              ) : (
                                <>
                                  <CheckCircle size={16} />
                                  {confirmId === m.id ? "Confirm?" : "Approve"}
                                </>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
