import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialIn, Supplier } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { CheckCircle } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthContext";

export function PendingDebitNote() {
  const { user } = useAuth();
  const [materialIn, setMaterialIn, isLoading] = useData<MaterialIn>("material-in", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const currentUserEmail = String(user?.email || "").trim().toLowerCase();
  const canPostDebitNote = currentUserEmail === "pankaj@bizskilledu.com";
  const columnCount = canPostDebitNote ? 6 : 5;

  const debitNoteList = useMemo(() => {
    return materialIn
      .filter(m => m.debitNote && !m.debitTallySync)
      .filter(m => {
        const supplierName = suppliers.find(s => s.id === m.supplierId)?.name || "";
        const searchStr = `${m.transactionNo} ${m.debitNote} ${supplierName} ${m.invoiceNo}`.toLowerCase();
        return searchStr.includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => new Date(b.updateTimestamp || b.timestamp).getTime() - new Date(a.updateTimestamp || a.timestamp).getTime());
  }, [materialIn, searchTerm, suppliers]);

  const handleMarkPosted = async (mrrId: string) => {
    if (!confirm("Are you sure you want to mark this Debit Note as Posted/Cleared?")) return;
    
    setProcessingId(mrrId);
    try {
      const timestamp = new Date().toISOString();
      await setMaterialIn(prev => prev.map(m => m.id === mrrId ? { 
        ...m, 
        debitTallySync: timestamp,
        debitRemarkTally: `Debit Note manually marked posted at ${timestamp}`,
        updatedBy: "System User",
        updateTimestamp: timestamp
      } : m));
    } catch (err) {
      alert("Failed to update status.");
    } finally {
      setProcessingId(null);
    }
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Debit Notes</h2>
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search MRR, Debit Note, Supplier..." 
      />

      <div className="bg-white border border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">MRR Details</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">Supplier/Customer</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">Date</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">Debit Note Tally Sync Remarks</th>
                {canPostDebitNote ? (
                  <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase">Action</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {debitNoteList.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-sm">
                    {isLoading ? <Spinner /> : "No pending debit notes found"}
                  </td>
                </tr>
              ) : (
                debitNoteList.map((m) => (
                  <tr key={m.id} className="divide-x divide-black hover:bg-slate-50 transition-colors text-sm text-black">
                    <td className="px-4 py-4">
                      <div className="font-bold">{m.transactionNo}</div>
                      <div className="text-[10px] text-slate-500">INV: {m.invoiceNo}</div>
                    </td>
                    <td className="px-4 py-4">{getSupplierName(m.supplierId)}</td>
                    <td className="px-4 py-4">{m.debitNoteDate ? formatDate(m.debitNoteDate) : "-"}</td>
                    <td className="px-4 py-4 text-right font-black text-indigo-700">{Number(m.debitNoteAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-4">{m.debitRemarkTally || "-"}</td>
                    {canPostDebitNote ? (
                      <td className="px-4 py-4 text-center">
                        <button 
                          disabled={!!processingId}
                          onClick={() => handleMarkPosted(m.id)}
                          className="bg-emerald-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase hover:bg-emerald-700 flex items-center gap-2 mx-auto"
                        >
                          {processingId === m.id ? <Spinner size={12} /> : <><CheckCircle size={14} /> Post</>}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
