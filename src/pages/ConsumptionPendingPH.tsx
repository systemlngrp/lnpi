import { useData } from "../hooks/useData";
import { Consumption } from "../types";
import { useState, useEffect } from "react";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";

export function ConsumptionPendingPH() {
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

  const [consumptions, setConsumptions] = useData<Consumption>("consumptions", []);
  const npdItems = useNpdItems();
  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

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
    const email = "ph@lngrp.in";

    try {
      await setConsumptions(prev => prev.map(c => 
        selectedIds.has(c.id) ? { ...c, status: "Pending Tally", phTimestamp: timestamp, phEmailId: email, updateTimestamp: timestamp } : c
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
      await setConsumptions(prev => 
        prev.map((c) =>
          c.id === id ? { 
            ...c, 
            status: "Pending Tally", 
            phTimestamp: timestamp, 
            phEmailId: "ph@lngrp.in",
            updateTimestamp: timestamp,
          } : c
        )
      );
    } catch (err) {
      console.error("Failed to approve consumption:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className={cn("text-xl font-bold text-black border-b border-black pb-4 uppercase transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>Consumption: Pending PH Approval</h2>
      <div className={cn("bg-white rounded shadow-sm overflow-hidden border border-black transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        {selectedIds.size > 0 && (
          <div className="p-3 bg-amber-50 border-b border-black flex justify-between items-center animate-in fade-in slide-in-from-top-1">
            <span className="text-sm font-bold text-amber-900 uppercase tracking-tight">
              {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'} selected
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={isBulkApproving}
              className="flex items-center gap-2 bg-amber-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase tracking-widest border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all disabled:opacity-50"
            >
              {isBulkApproving ? <Spinner size={14} /> : <CheckCircle size={14} />}
              Approve Selected
            </button>
          </div>
        )}
        
        {/* Mobile View - Cards */}
        <div className="block md:hidden p-4 space-y-4">
          {consumptions.filter((c) => isPendingPH(c.status)).length === 0 ? (
            <div className="p-6 text-center text-black font-bold border-2 border-dashed border-black">No pending consumption approvals.</div>
          ) : consumptions
              .filter((c) => isPendingPH(c.status))
              .sort((a, b) => {
                const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                return timeB - timeA;
              })
              .map((c) => (
                <div key={c.id} className={cn("bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]", selectedIds.has(c.id) && "bg-amber-50")}>
                  <div className="flex justify-between items-start gap-2">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-amber-600 focus:ring-amber-500 w-5 h-5 cursor-pointer mt-1"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                    />
                    <div className="text-right">
                        <div className="text-xs font-black text-slate-500 uppercase">Trx No</div>
                        <div className="text-sm font-bold">{c.transactionNo}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Date</div>
                    <div className="text-sm font-bold">{formatDate(c.date)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Item</div>
                    <div className="text-sm font-bold">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                        <div className="text-xs font-black text-slate-500 uppercase">Qty</div>
                        <div className="text-sm font-bold">{c.qty} {c.uom}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleApprove(c.id)}
                    disabled={submittingId === c.id}
                    className={cn(
                      "w-full flex items-center justify-center py-3 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                      confirmId === c.id 
                        ? "bg-amber-600 text-white border-black animate-pulse" 
                        : "bg-black text-white border-black hover:bg-slate-800"
                    )}
                  >
                    {submittingId === c.id ? (
                      <Spinner size={16} />
                    ) : (
                      <>
                        <CheckCircle size={16} />
                        {confirmId === c.id ? "Confirm?" : "Approve"}
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
                  className="rounded border-black text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                  checked={consumptions.filter(c => isPendingPH(c.status)).length > 0 && selectedIds.size === consumptions.filter(c => isPendingPH(c.status)).length}
                  onChange={() => toggleSelectAll(consumptions.filter(c => isPendingPH(c.status)).map(c => c.id))}
                />
              </th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Transaction No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {consumptions.filter((c) => isPendingPH(c.status)).length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium">No pending consumption approvals.</td>
              </tr>
            ) : consumptions
              .filter((c) => isPendingPH(c.status))
              .sort((a, b) => {
                const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                return timeB - timeA;
              })
              .map((c) => (
                <tr key={c.id} className={cn("hover:bg-slate-50 divide-x divide-black transition-colors", selectedIds.has(c.id) && "bg-amber-50/50")}>
                  <td className="px-6 py-4 w-10 text-center border border-black">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{c.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(c.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">{c.qty}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{c.uom}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                    <button
                      onClick={() => handleApprove(c.id)}
                      disabled={submittingId === c.id}
                      className={cn(
                        "inline-flex items-center justify-center min-w-[120px] px-4 py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                        confirmId === c.id 
                          ? "bg-amber-600 text-white border-black animate-pulse" 
                          : "bg-amber-100 text-amber-800 border-amber-800 hover:bg-amber-200"
                      )}
                    >
                      {submittingId === c.id ? (
                        <Spinner size={16} />
                      ) : (
                        <>
                          <CheckCircle size={16} />
                          {confirmId === c.id ? "Confirm?" : "Approve"}
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
