import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier } from "../types";
import { useState, useEffect } from "react";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";

export function PendingMDApproval() {
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

  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkApproving(true);
    const timestamp = new Date().toISOString();
    const email = "md@lngrp.in";

    try {
      await setMaterialIn(prev => prev.map(m => 
        selectedIds.has(m.id) ? { ...m, status: "Pending Tally", mdTimestamp: timestamp, mdEmailId: email, updateTimestamp: timestamp } : m
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
          m.id === id ? { ...m, status: "Pending Tally", mdTimestamp: timestamp, mdEmailId: "md@lngrp.in", updateTimestamp: timestamp } : m
        )
      );
    } catch (err) {
      console.error("Failed to approve Material In at MD stage:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const getLineItemsElement = (lines: MaterialIn['lines'] = []) => {
    return (
      <ul className="list-none space-y-1">
        {lines.map((l, idx) => {
          const itemName = materials.find(i => i.id === l.itemId)?.name || npdItems.find(i => i.id === l.itemId)?.name;
          return (
            <li key={idx} className="whitespace-nowrap border-b border-black last:border-0 pb-1 last:pb-0 mb-1 last:mb-0">
              <span className="font-medium text-black">{itemName || 'Unknown'}</span>
              <span className="ml-2 text-black">[{l.qty} {l.uom} @ {l.rate}]</span>
            </li>
          );
        })}
      </ul>
    );
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className={cn("flex justify-between items-center border-b border-black pb-4 transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        <h2 className="text-xl font-bold text-black uppercase">Pending MD Approval</h2>
      </div>
      <div className={cn("bg-white rounded shadow-sm overflow-hidden border border-black transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        {selectedIds.size > 0 && (
          <div className="p-3 bg-sky-50 border-b border-black flex justify-between items-center animate-in fade-in slide-in-from-top-1">
            <span className="text-sm font-bold text-sky-900 uppercase tracking-tight">
              {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'} selected
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={isBulkApproving}
              className="flex items-center gap-2 bg-sky-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase tracking-widest border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all disabled:opacity-50"
            >
              {isBulkApproving ? <Spinner size={14} /> : <CheckCircle size={14} />}
              Approve Selected
            </button>
          </div>
        )}
        
        {/* Mobile View - Cards */}
        <div className="block md:hidden p-4 space-y-4">
          {materialIn.filter((m) => m.status === "Pending MD").length === 0 ? (
            <div className="p-6 text-center text-black font-bold border-2 border-dashed border-black">No pending approvals.</div>
          ) : materialIn
              .filter((m) => m.status === "Pending MD")
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((m) => (
                <div key={m.id} className={cn("bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]", selectedIds.has(m.id) && "bg-sky-50")}>
                  <div className="flex justify-between items-start gap-2">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-sky-600 focus:ring-sky-500 w-5 h-5 cursor-pointer mt-1"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                    />
                    <div className="text-right">
                        <div className="text-xs font-black text-slate-500 uppercase">Trx No</div>
                        <div className="text-sm font-bold">{m.transactionNo}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Date</div>
                    <div className="text-sm font-bold">{formatDate(m.date)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Supplier</div>
                    <div className="text-sm font-bold">{getSupplierName(m.supplierId)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Items</div>
                    <div className="text-sm font-bold">{getLineItemsElement(m.lines)}</div>
                  </div>
                  <div className="text-right font-mono font-bold text-lg">{m.totalAmount.toLocaleString()}</div>
                  <button
                    onClick={() => handleApprove(m.id)}
                    disabled={submittingId === m.id}
                    className={cn(
                      "w-full flex items-center justify-center py-3 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                      confirmId === m.id 
                        ? "bg-amber-600 text-white border-black animate-pulse" 
                        : "bg-black text-white border-black hover:bg-slate-800"
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
                </div>
              ))}
        </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 w-10 border border-black">
                <input 
                  type="checkbox" 
                  className="rounded border-black text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                  checked={materialIn.filter(m => m.status === "Pending MD").length > 0 && selectedIds.size === materialIn.filter(m => m.status === "Pending MD").length}
                  onChange={() => toggleSelectAll(materialIn.filter(m => m.status === "Pending MD").map(m => m.id))}
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
            {materialIn.filter((m) => m.status === "Pending MD").length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium">No pending approvals.</td>
              </tr>
            ) : materialIn
              .filter((m) => m.status === "Pending MD")
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((m) => (
                <tr key={m.id} className={cn("hover:bg-slate-50 divide-x divide-black transition-colors", selectedIds.has(m.id) && "bg-sky-50/50")}>
                  <td className="px-6 py-4 w-10 text-center border border-black">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{m.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{getSupplierName(m.supplierId)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">
                    {getLineItemsElement(m.lines)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black whitespace-nowrap font-mono">{m.totalAmount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                    <button
                      onClick={() => handleApprove(m.id)}
                      disabled={submittingId === m.id}
                      className={cn(
                        "inline-flex items-center justify-center min-w-[120px] px-4 py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                        confirmId === m.id 
                          ? "bg-amber-600 text-white border-black animate-pulse" 
                          : "bg-sky-100 text-sky-800 border-sky-800 hover:bg-sky-200"
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
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
