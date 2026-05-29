import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier } from "../types";
import { useState, useMemo } from "react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function PendingTallyEntry() {
  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  const pendingList = useMemo(() => {
    return materialIn
      .filter((m) => m.status === "Pending Tally")
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
          const itemName = materials.find(i => i.id === l.itemId)?.name || items.find(i => i.id === l.itemId)?.name;
          return (
            <li key={idx} className="whitespace-nowrap border-b border-black last:border-0 pb-1 last:pb-0 mb-1 last:mb-0 text-[10px]">
              <span className="font-medium text-black">{itemName || 'Unknown'}</span>
              <span className="ml-2 text-black">[{l.qty} {l.uom} @ ₹{l.rate}]</span>
            </li>
          );
        })}
      </ul>
    );
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <div className="p-4 bg-white border-b border-black flex justify-between items-center">
        <h1 className="text-3xl font-black text-fuchsia-700 uppercase tracking-tighter">Pending Tally Posting</h1>
      </div>

      <div className="p-4">
        <div className="bg-white border border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="bg-fuchsia-700 px-4 py-2 text-white font-black uppercase text-sm border-b border-black flex justify-between items-center">
            <span>Pending Records ({pendingList.length})</span>
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
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="bg-fuchsia-700 text-white text-[10px] font-black uppercase tracking-widest">
                <tr className="divide-x divide-white/20">
                  <th className="px-2 py-3 text-center w-10">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.length === pendingList.length && pendingList.length > 0}
                      onChange={toggleSelectAll}
                      className="accent-white h-4 w-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">Trn No</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Items</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {pendingList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center text-black font-bold uppercase tracking-widest text-sm">
                      No pending entries.
                    </td>
                  </tr>
                ) : (
                  pendingList.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50 divide-x divide-black transition-colors text-[11px] text-black font-medium uppercase">
                      <td className="px-2 py-4 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.includes(m.id)}
                          onChange={() => toggleSelect(m.id)}
                          className="accent-fuchsia-600 h-4 w-4"
                        />
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">{m.transactionNo}</td>
                      <td className="px-4 py-4 whitespace-nowrap">{formatDate(m.date)}</td>
                      <td className="px-4 py-4">{getSupplierName(m.supplierId)}</td>
                      <td className="px-4 py-4">
                        {getLineItemsElement(m.lines)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold">₹{m.totalAmount.toLocaleString()}</td>
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
                              {confirmId === m.id ? "Confirm?" : "Complete"}
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))
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
            {isBulkSubmitting ? <Spinner size={16} className="text-white" /> : `Complete Selected (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
