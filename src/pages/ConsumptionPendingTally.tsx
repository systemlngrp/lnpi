import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Consumption } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { CheckCircle, Search } from "lucide-react";
import { cn } from "../lib/utils";
import { useNpdItems } from "../hooks/useNpdItems";
import { useAuth } from "../auth/AuthContext";

export function ConsumptionPendingTally() {
  const { user } = useAuth();
  const [consumptions, setConsumptions] = useData<Consumption>("consumptions", []);
  const npdItems = useNpdItems();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const currentUserEmail = String(user?.email || "").trim().toLowerCase();
  const canPostTally = currentUserEmail === "pankaj@bizskilledu.com";
  const tableColumnCount = canPostTally ? 6 : 5;

  const handleComplete = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000); // Reset after 3s
      return;
    }

    setSubmittingId(id);
    setTimeout(() => {
      setConsumptions(consumptions.map(c => 
        c.id === id ? { 
          ...c, 
          status: "Completed", 
          tallyTimestamp: new Date().toISOString(),
          updatedBy: "Tally Operator",
          updateTimestamp: new Date().toISOString()
        } : c
      ));
      setSubmittingId(null);
      setConfirmId(null);
    }, 500);
  };

  const pendingList = consumptions.filter(c => 
    c.status === "Pending Tally" && (
      c.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (npdItems.find(i => i.id === c.itemId)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Consumption: Pending Tally Entry</h2>
      </div>

      <div className="flex flex-wrap gap-4 items-center justify-between bg-white p-4 border border-black rounded shadow-sm">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search entries..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border-2 border-black rounded focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {pendingList.sort((a, b) => new Date(b.updateTimestamp).getTime() - new Date(a.updateTimestamp).getTime()).map((c) => (
                <div key={c.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                    <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{c.transactionNo}</div>
                        <div className="text-xs text-slate-500">{formatDate(c.date)}</div>
                    </div>
                    <div className="text-sm font-bold">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</div>
                    <div className="text-sm">{c.qty} {c.uom}</div>
                     {canPostTally ? (
                       <button
                        onClick={() => handleComplete(c.id)}
                        disabled={submittingId === c.id}
                        className={cn(
                          "w-full flex items-center justify-center py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                          confirmId === c.id 
                            ? "bg-amber-600 text-white border-black animate-pulse" 
                            : "bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-700"
                        )}
                      >
                        {submittingId === c.id ? <Spinner size={12} /> : (confirmId === c.id ? "Confirm?" : "Post")}
                      </button>
                     ) : null}
                </div>
            ))}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Consumed Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              {canPostTally ? (
                <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {pendingList.length === 0 ? (
              <tr>
                <td colSpan={tableColumnCount} className="px-6 py-8 text-center text-black font-medium">No pending Tally entries.</td>
              </tr>
            ) : (
              pendingList
                .sort((a, b) => new Date(b.updateTimestamp).getTime() - new Date(a.updateTimestamp).getTime())
                .map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 divide-x divide-black">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{c.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(c.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-amber-700 border border-black">{c.qty}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{c.uom}</td>
                  {canPostTally ? (
                    <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                      <button
                        onClick={() => handleComplete(c.id)}
                        disabled={submittingId === c.id}
                        className={cn(
                          "px-3 py-1 rounded font-bold text-xs uppercase flex items-center gap-1 ml-auto transition-all border disabled:opacity-50",
                          confirmId === c.id 
                            ? "bg-amber-600 text-white border-black animate-pulse" 
                            : "bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-700"
                        )}
                      >
                        {submittingId === c.id ? <Spinner size={12} /> : <CheckCircle size={14} />}
                        {confirmId === c.id ? "Confirm?" : "Post"}
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
  );
}
