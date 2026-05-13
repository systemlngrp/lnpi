import { useData } from "../hooks/useData";
import { MaterialIn, Item, Supplier } from "../types";
import { useState } from "react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

export function PendingTallyEntry() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleComplete = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setSubmittingId(id);
    setTimeout(() => {
      setMaterialIn(
        materialIn.map((m) =>
          m.id === id ? { ...m, status: "Completed", tallyTimestamp: new Date().toISOString() } : m
        )
      );
      setSubmittingId(null);
      setConfirmId(null);
    }, 500);
  };

  const getLineItemsElement = (lines: MaterialIn['lines'] = []) => {
    return (
      <ul className="list-none space-y-1">
        {lines.map((l, idx) => {
          const item = items.find(i => i.id === l.itemId);
          return (
            <li key={idx} className="whitespace-nowrap border-b border-black last:border-0 pb-1 last:pb-0 mb-1 last:mb-0">
              <span className="font-medium text-black">{item?.name || 'Unknown'}</span>
              <span className="ml-2 text-black">[{l.qty} {l.uom} @ ₹{l.rate}]</span>
            </li>
          );
        })}
      </ul>
    );
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Tally Entry</h2>
        <ExcelExport 
          data={materialIn.filter(m => m.status === "Pending Tally")} 
          fileName="Pending_Tally_MaterialIn" 
        />
      </div>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
          {materialIn.filter((m) => m.status === "Pending Tally").length === 0 ? (
            <div className="p-6 text-center text-black font-bold border-2 border-dashed border-black">No pending entries.</div>
          ) : materialIn
              .filter((m) => m.status === "Pending Tally")
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((m) => (
                <div key={m.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                    <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{m.transactionNo}</div>
                        <div className="text-xs text-slate-500">{formatDate(m.date)}</div>
                    </div>
                    <div className="text-sm font-bold">{getSupplierName(m.supplierId)}</div>
                    <div className="text-xs text-slate-600">{getLineItemsElement(m.lines)}</div>
                    <div className="font-bold text-right text-lg">₹{m.totalAmount.toLocaleString()}</div>
                     <button
                      onClick={() => handleComplete(m.id)}
                      disabled={submittingId === m.id}
                      className={cn(
                        "w-full flex items-center justify-center py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                        confirmId === m.id 
                          ? "bg-amber-600 text-white border-black animate-pulse" 
                          : "bg-emerald-100 text-emerald-800 border-emerald-800 hover:bg-emerald-200"
                      )}
                    >
                      {submittingId === m.id ? <Spinner size={12} /> : (confirmId === m.id ? "Confirm?" : "Complete")}
                    </button>
                </div>
              ))}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Items</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Amount</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {materialIn.filter((m) => m.status === "Pending Tally").length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-black font-medium">No pending entries.</td>
              </tr>
            ) : materialIn
              .filter((m) => m.status === "Pending Tally")
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black whitespace-nowrap">{m.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{getSupplierName(m.supplierId)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">
                    {getLineItemsElement(m.lines)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black whitespace-nowrap font-mono">₹{m.totalAmount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                    <button
                      onClick={() => handleComplete(m.id)}
                      disabled={submittingId === m.id}
                      className={cn(
                        "inline-flex items-center justify-center min-w-[120px] px-4 py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                        confirmId === m.id 
                          ? "bg-amber-600 text-white border-black animate-pulse" 
                          : "bg-emerald-100 text-emerald-800 border-emerald-800 hover:bg-emerald-200"
                      )}
                    >
                      {submittingId === m.id ? (
                        <Spinner size={16} />
                      ) : (
                        <>
                          <CheckCircle size={16} />
                          {confirmId === m.id ? "Confirm?" : "Complete"}
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
