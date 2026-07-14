import { useData } from "../hooks/useData";
import { Production, OrderSchedule } from "../types";
import { useState, useEffect } from "react";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, XCircle } from "lucide-react";
import { isProductionPendingPH } from "../lib/productionStageFilters";
import { useNpdItems } from "../hooks/useNpdItems";

export function ProductionPendingPH() {
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

  const [productions, setProductions] = useData<Production>("productions", []);
  const npdItems = useNpdItems();
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState("");

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
      await setProductions(prev => prev.map(p => 
        selectedIds.has(p.id) ? { ...p, status: "Pending Consumption", phTimestamp: timestamp, phEmailId: email, updateTimestamp: timestamp } : p
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
      await setProductions(prev =>
        prev.map((p) =>
          p.id === id ? { 
            ...p, 
            status: "Pending Consumption", 
            phTimestamp: timestamp, 
            phEmailId: "ph@lngrp.in",
            updateTimestamp: timestamp,
          } : p
        )
      );
    } catch (err) {
      console.error("Failed to approve production:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const handleCancel = async (id: string) => {
    const prod = productions.find(p => p.id === id);
    if (!prod) return;

    if (cancelingId !== id) {
      setCancelingId(id);
      setCancelRemarks("");
      return;
    }

    if (!cancelRemarks.trim()) {
      alert("Please provide cancellation remarks.");
      return;
    }

    setSubmittingId(id);
    try {
      const timestamp = new Date().toISOString();
      const email = "ph@lngrp.in";

      // 1. Update production entry
      await setProductions(prev => prev.map(p => 
        p.id === id ? { 
          ...p, 
          status: "Cancelled", 
          cancelTimestamp: timestamp, 
          cancelEmailId: email, 
          cancelRemarks: cancelRemarks.trim(),
          updateTimestamp: timestamp 
        } : p
      ));

      // 2. Revert produced quantity in schedule if scheduleId exists
      if (prod.scheduleId) {
        await setSchedules(prev => prev.map(s => 
          s.id === prod.scheduleId ? {
            ...s,
            producedQty: Math.max(0, Number(s.producedQty || 0) - Number(prod.qty || 0)),
            updateTimestamp: timestamp,
            updatedBy: "System User (Cancel)"
          } : s
        ));
      }

      setCancelingId(null);
      setCancelRemarks("");
    } catch (err) {
      console.error("Failed to cancel production:", err);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className={cn("text-xl font-bold text-black border-b border-black pb-4 uppercase transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>Production: Pending PH Approval</h2>
      <div className={cn("bg-white rounded shadow-sm overflow-hidden border border-black transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        {selectedIds.size > 0 && (
          <div className="p-3 bg-emerald-50 border-b border-black flex justify-between items-center animate-in fade-in slide-in-from-top-1">
            <span className="text-sm font-bold text-emerald-900 uppercase tracking-tight">
              {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'} selected
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={isBulkApproving}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase tracking-widest border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all disabled:opacity-50"
            >
              {isBulkApproving ? <Spinner size={14} /> : <CheckCircle size={14} />}
              Approve Selected
            </button>
          </div>
        )}
        
        {/* Mobile View - Cards */}
        <div className="block md:hidden p-4 space-y-4">
          {productions.filter(isProductionPendingPH).length === 0 ? (
            <div className="p-6 text-center text-black font-bold border-2 border-dashed border-black">No pending production approvals.</div>
          ) : productions
              .filter(isProductionPendingPH)
              .sort((a, b) => {
                const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                return timeB - timeA;
              })
              .map((p) => (
                <div key={p.id} className={cn("bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]", selectedIds.has(p.id) && "bg-emerald-50")}>
                  <div className="flex justify-between items-start gap-2">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-5 h-5 cursor-pointer mt-1"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                    <div className="text-right">
                        <div className="text-xs font-black text-slate-500 uppercase">Job No.</div>
                        <div className="text-sm font-bold">{p.transactionNo}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Date</div>
                    <div className="text-sm font-bold">{formatDate(p.date)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase">Item</div>
                    <div className="text-sm font-bold">{npdItems.find(i => i.id === p.itemId)?.name || "Unknown"}</div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                        <div className="text-xs font-black text-slate-500 uppercase">Qty</div>
                        <div className="text-sm font-bold">{p.qty} {p.uom}</div>
                    </div>
                  </div>

                  {cancelingId === p.id && (
                    <div className="flex flex-col gap-1 w-full">
                      <label className="text-[10px] font-black uppercase text-red-600">Cancellation Remarks</label>
                      <input 
                        type="text"
                        autoFocus
                        placeholder="Reason for cancellation..."
                        value={cancelRemarks}
                        onChange={(e) => setCancelRemarks(e.target.value)}
                        className="text-sm p-3 border-2 border-black rounded focus:outline-none focus:border-red-600 shadow-sm"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {!cancelingId && (
                      <button
                        onClick={() => handleApprove(p.id)}
                        disabled={submittingId === p.id}
                        className={cn(
                          "w-full flex items-center justify-center py-3 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                          confirmId === p.id 
                            ? "bg-amber-600 text-white border-black animate-pulse shadow-none" 
                            : "bg-emerald-600 text-white border-black hover:bg-emerald-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        )}
                      >
                        {submittingId === p.id && !cancelingId ? (
                          <Spinner size={16} />
                        ) : (
                          <>
                            <CheckCircle size={16} />
                            {confirmId === p.id ? "Confirm Approval?" : "Approve"}
                          </>
                        )}
                      </button>
                    )}

                    {(cancelingId === p.id || !confirmId) && (
                      <button
                        onClick={() => handleCancel(p.id)}
                        disabled={submittingId === p.id}
                        className={cn(
                          "w-full flex items-center justify-center py-3 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                          cancelingId === p.id 
                            ? "bg-red-600 text-white border-black shadow-none" 
                            : "bg-white text-red-600 border-red-600 hover:bg-red-50"
                        )}
                      >
                        {submittingId === p.id && cancelingId === p.id ? (
                          <Spinner size={16} />
                        ) : (
                          <>
                            <XCircle size={16} />
                            {cancelingId === p.id ? "Confirm Cancel" : "Cancel"}
                          </>
                        )}
                      </button>
                    )}

                    {cancelingId === p.id && (
                      <button 
                        onClick={() => { setCancelingId(null); setCancelRemarks(""); }}
                        className="w-full bg-slate-200 text-black border-2 border-black py-2 rounded font-bold text-xs uppercase"
                      >
                        Go Back
                      </button>
                    )}
                  </div>
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
                  className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                  checked={productions.filter(isProductionPendingPH).length > 0 && selectedIds.size === productions.filter(isProductionPendingPH).length}
                  onChange={() => toggleSelectAll(productions.filter(isProductionPendingPH).map(p => p.id))}
                />
              </th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Job No.</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {productions.filter(isProductionPendingPH).length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium">No pending production approvals.</td>
              </tr>
            ) : productions
              .filter(isProductionPendingPH)
              .sort((a, b) => {
                const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                return timeB - timeA;
              })
              .map((p) => (
                <tr key={p.id} className={cn("hover:bg-slate-50 divide-x divide-black transition-colors", selectedIds.has(p.id) && "bg-emerald-50/50")}>
                  <td className="px-6 py-4 w-10 text-center border border-black">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{p.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{npdItems.find(i => i.id === p.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">{p.qty}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{p.uom}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                    <div className="flex flex-col gap-2 items-end">
                      {cancelingId === p.id && (
                        <div className="flex flex-col gap-1 w-full max-w-[250px]">
                          <input 
                            type="text"
                            autoFocus
                            placeholder="Reason for cancellation..."
                            value={cancelRemarks}
                            onChange={(e) => setCancelRemarks(e.target.value)}
                            className="text-xs p-2 border-2 border-black rounded focus:outline-none focus:border-red-600"
                          />
                        </div>
                      )}
                      <div className="flex gap-2">
                        {!cancelingId && (
                          <button
                            onClick={() => handleApprove(p.id)}
                            disabled={submittingId === p.id}
                            className={cn(
                              "inline-flex items-center justify-center min-w-[120px] px-4 py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                              confirmId === p.id 
                                ? "bg-amber-600 text-white border-black animate-pulse" 
                                : "bg-emerald-100 text-emerald-800 border-emerald-800 hover:bg-emerald-200"
                            )}
                          >
                            {submittingId === p.id ? (
                              <Spinner size={16} />
                            ) : (
                              <>
                                <CheckCircle size={16} />
                                {confirmId === p.id ? "Confirm?" : "Approve"}
                              </>
                            )}
                          </button>
                        )}
                        
                        {(cancelingId === p.id || !confirmId) && (
                          <button
                            onClick={() => handleCancel(p.id)}
                            disabled={submittingId === p.id}
                            className={cn(
                              "inline-flex items-center justify-center min-w-[120px] px-4 py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                              cancelingId === p.id 
                                ? "bg-red-600 text-white border-black" 
                                : "bg-red-50 text-red-800 border-red-800 hover:bg-red-100"
                            )}
                          >
                            {submittingId === p.id && cancelingId === p.id ? (
                              <Spinner size={16} />
                            ) : (
                              <>
                                <XCircle size={16} />
                                {cancelingId === p.id ? "Confirm Cancel" : "Cancel"}
                              </>
                            )}
                          </button>
                        )}

                        {cancelingId === p.id && (
                          <button 
                            onClick={() => { setCancelingId(null); setCancelRemarks(""); }}
                            className="bg-slate-200 text-black border border-black px-4 py-2 rounded font-bold text-xs uppercase"
                          >
                            Back
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
