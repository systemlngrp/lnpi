import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier } from "../types";
import { Fragment, useState, useMemo, useEffect } from "react";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNpdItems } from "../hooks/useNpdItems";
import { useAuth } from "../auth/AuthContext";

export function PendingTallyEntry() {
  const { user } = useAuth();
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

  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const currentUserEmail = String(user?.email || "").trim().toLowerCase();
  const canPostTally = currentUserEmail === "pankaj@bizskilledu.com";
  const tableColumnCount = canPostTally ? 20 : 18;
  const formatMoney = (value?: number) =>
    `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const pendingList = useMemo(() => {
    return materialIn
      .filter((m) => m.status === "Pending Tally" && String(m.mrrType || "").trim().toLowerCase() !== "rejection in")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [materialIn]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === pendingList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingList.map(m => m.id));
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  };

  const handleComplete = async (id: string) => {
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
          m.id === id ? { ...m, status: "Completed", tallyTimestamp: timestamp, updateTimestamp: timestamp } : m
        )
      );
      setSelectedIds(prev => prev.filter(i => i !== id));
    } catch (err) {
      console.error("Failed to complete Material In tally entry:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const handleBulkComplete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to complete tally entry for ${selectedIds.length} items?`)) return;

    setIsBulkSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      await setMaterialIn(prev =>
        prev.map((m) =>
          selectedIds.includes(m.id) ? { ...m, status: "Completed", tallyTimestamp: timestamp, updateTimestamp: timestamp } : m
        )
      );
      setSelectedIds([]);
    } catch (err) {
      console.error("Bulk completion failed:", err);
      alert("Failed to complete some entries.");
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const getLineItemsElement = (lines: MaterialIn['lines'] = []) => {
    return (
      <ul className="list-none space-y-1">
        {lines.map((l, idx) => {
          const itemName = materials.find(i => i.id === l.itemId)?.name || npdItems.find(i => i.id === l.itemId)?.name;
          return (
            <li key={idx} className="whitespace-nowrap border-b border-black last:border-0 pb-1 last:pb-0 mb-1 last:mb-0 text-[10px]">
              <span className="font-medium text-black">{itemName || 'Unknown'}</span>
              <span className="ml-2 text-black">[{l.qty} {l.uom} @ {l.rate}]</span>
            </li>
          );
        })}
      </ul>
    );
  };

  const getItemValue = (lines: MaterialIn["lines"] = []) =>
    lines.reduce((sum, line) => {
      const lineValue =
        Number(line.actualValue ?? line.value ?? (Number(line.qty || 0) * Number(line.rate || 0)) ?? 0) || 0;
      return sum + lineValue;
    }, 0);

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <div className="p-4 bg-white border-b border-black flex justify-between items-center">
        <h1 className="text-3xl font-black text-fuchsia-700 uppercase tracking-tighter">Pending Tally Posting</h1>
      </div>

      <div className="p-4">

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="bg-fuchsia-700 px-4 py-2 text-white font-black uppercase text-sm border-b border-black flex justify-between items-center">
            <span>Pending Records ({pendingList.length})</span>
            {canPostTally ? (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-[10px]">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.length === pendingList.length && pendingList.length > 0}
                    onChange={toggleSelectAll}
                    className="accent-white h-3 w-3"
                  />
                  Select All
                </label>
              </div>
            ) : null}
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="sticky top-0 z-30 bg-fuchsia-700 text-white text-[10px] font-black uppercase tracking-widest">
                <tr className="divide-x divide-white/20">
                  {canPostTally ? (
                    <th className="px-2 py-3 text-center w-10">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.length === pendingList.length && pendingList.length > 0}
                        onChange={toggleSelectAll}
                        className="accent-white h-4 w-4"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left">Trn No</th>
                  <th className="px-4 py-3 text-left">MRR Type</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Items</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3 text-right">Item Value</th>
                  <th className="px-6 py-3 text-right">Invoice Value</th>
                  <th className="px-6 py-3 text-right">Actual Value</th>
                  <th className="px-6 py-3 text-right">CGST</th>
                  <th className="px-6 py-3 text-right">SGST</th>
                  <th className="px-6 py-3 text-right">IGST</th>
                  <th className="px-6 py-3 text-right">After GST</th>
                  <th className="px-6 py-3 text-right">Insurance</th>
                  <th className="px-6 py-3 text-right">Other Charges</th>
                  <th className="px-6 py-3 text-right">Round Off</th>
                  <th className="px-4 py-3 text-left">Tally Sync Remarks</th>
                  <th className="px-4 py-3 text-center">Details</th>
                  {canPostTally ? <th className="px-6 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {pendingList.length === 0 ? (
                  <tr>
                    <td colSpan={tableColumnCount} className="px-6 py-20 text-center text-black font-bold uppercase tracking-widest text-sm">
                      No pending entries.
                    </td>
                  </tr>
                ) : (
                  pendingList.map((m) => {
                    const isExpanded = expandedIds.includes(m.id);
                    return (
                      <Fragment key={m.id}>
                        <tr className="hover:bg-slate-50 divide-x divide-black transition-colors text-[11px] text-black font-medium uppercase">
                          {canPostTally ? (
                            <td className="px-2 py-4 text-center">
                              <input 
                                type="checkbox" 
                                checked={selectedIds.includes(m.id)}
                                onChange={() => toggleSelect(m.id)}
                                className="accent-fuchsia-600 h-4 w-4"
                              />
                            </td>
                          ) : null}
                          <td className="px-4 py-4 whitespace-nowrap">{m.transactionNo}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{m.mrrType || "-"}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{formatDate(m.date)}</td>
                          <td className="px-4 py-4">{getSupplierName(m.supplierId)}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{m.lines?.length || 0} Item(s)</td>
                          <td className="px-6 py-4 text-right font-mono font-bold whitespace-nowrap">{formatMoney(m.totalAmount)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(getItemValue(m.lines))}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.totalInvoiceValue)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.totalActualValue)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.totalCgst)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.totalSgst)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.totalIgst)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.totalInvoiceValueAfterGst)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.insurance)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.otherCharges)}</td>
                          <td className="px-6 py-4 text-right font-mono whitespace-nowrap">{formatMoney(m.roundOff)}</td>
                          <td className="px-4 py-4 align-top min-w-[280px]">
                            <div
                              className="max-w-[320px] whitespace-pre-wrap break-words text-[10px] normal-case text-rose-700 font-semibold"
                              title={m.tallySyncRemark || ""}
                            >
                              {m.tallySyncRemark || "-"}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(m.id)}
                              className="inline-flex items-center justify-center h-8 w-8 rounded border border-black bg-white hover:bg-slate-100 transition-colors"
                              title={isExpanded ? "Hide item details" : "Show item details"}
                            >
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          {canPostTally ? (
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleComplete(m.id)}
                                disabled={submittingId === m.id || isBulkSubmitting}
                                className={cn(
                                  "inline-flex items-center justify-center min-w-[100px] px-3 py-1.5 rounded font-black transition-all border disabled:opacity-50 text-[10px] uppercase tracking-wider gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
                                  confirmId === m.id 
                                    ? "bg-amber-600 text-white border-black animate-pulse" 
                                    : "bg-emerald-100 text-emerald-800 border-emerald-800 hover:bg-emerald-200"
                                )}
                              >
                                {submittingId === m.id ? (
                                  <Spinner size={12} />
                                ) : (
                                  <>
                                    <CheckCircle size={14} />
                                    {confirmId === m.id ? "Confirm?" : "Post"}
                                  </>
                                )}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={tableColumnCount} className="px-6 py-4 border-t border-black">
                              <div className="text-[10px] font-black uppercase tracking-wider text-slate-700 mb-2">
                                Item Level Details
                              </div>
                              {getLineItemsElement(m.lines)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer / Bulk Actions */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t-2 border-black flex items-center justify-between px-8 shadow-[0_-4px_10px_rgba(0,0,0,0.1)] z-40">
        <button 
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 border border-black rounded font-bold text-xs uppercase hover:bg-slate-50 transition-all"
        >
          <ArrowLeft size={16} /> Back
        </button>

        {canPostTally ? (
          <div className="flex items-center gap-8">
            <label className="flex items-center gap-2 font-bold text-xs uppercase cursor-pointer">
              <input 
                type="checkbox" 
                checked={selectedIds.length === pendingList.length && pendingList.length > 0}
                onChange={toggleSelectAll}
                className="accent-fuchsia-600 h-4 w-4"
              />
              Select All Visible
            </label>

            <button
              disabled={selectedIds.length === 0 || isBulkSubmitting}
              onClick={handleBulkComplete}
              className={cn(
                "px-8 py-2 bg-fuchsia-700 text-white rounded font-black text-xs uppercase tracking-widest transition-all border border-black",
                selectedIds.length > 0 ? "shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5" : "opacity-50"
              )}
            >
              {isBulkSubmitting ? <Spinner size={16} className="text-white" /> : `Post Selected (${selectedIds.length})`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
