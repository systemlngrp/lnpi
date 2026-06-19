import React, { useState } from "react";
import { useData } from "../hooks/useData";
import {
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Production,
} from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { CheckCircle, Search } from "lucide-react";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { cn } from "../lib/utils";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "../lib/productionMaterialUsage";
import { isProductionReadyForTally } from "../lib/productionStageFilters";
import { useNpdItems } from "../hooks/useNpdItems";

export function ProductionPendingTally() {
  const [productions, setProductions] = useData<Production>("productions", []);
  const npdItems = useNpdItems();
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const usageMap = buildProductionMaterialUsageMap(
    materialIssues,
    materialIssueLines,
    materialReturns,
    materialReturnLines,
    materialIssueReelLines,
    materialReturnReelLines
  );

  const handleComplete = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000); // Reset after 3s
      return;
    }

    setSubmittingId(id);
    setTimeout(() => {
      setProductions(productions.map(p => 
        p.id === id ? { 
          ...p, 
          status: "Completed", 
          tallyTimestamp: new Date().toISOString(),
          updatedBy: "Tally Operator",
          updateTimestamp: new Date().toISOString()
        } : p
      ));
      setSubmittingId(null);
      setConfirmId(null);
    }, 500);
  };

  const pendingList = productions
    .filter(p => 
      isProductionReadyForTally(p, getProductionActualPaperUsed(p, usageMap)) && (
        p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (npdItems.find(i => i.id === p.itemId)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
    )
    .sort((a, b) => new Date(b.updateTimestamp).getTime() - new Date(a.updateTimestamp).getTime());

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedPendingList,
  } = useClientPagination(pendingList, 25);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production: Pending Tally Entry</h2>
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
            {paginatedPendingList.map((p) => (
                <div key={p.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                    <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">Job: {p.transactionNo}</div>
                        <div className="text-xs text-slate-500">{formatDate(p.date)}</div>
                    </div>
                    <div className="text-sm font-bold">{npdItems.find(i => i.id === p.itemId)?.name || "Unknown"}</div>
                    <div className="text-sm">{Number(p.prodFromFFG || 0).toLocaleString()} {p.uom}</div>
                     <button
                      onClick={() => handleComplete(p.id)}
                      disabled={submittingId === p.id}
                      className={cn(
                        "w-full flex items-center justify-center py-2 rounded font-bold transition-all border disabled:opacity-50 text-xs uppercase tracking-wider gap-2",
                        confirmId === p.id 
                          ? "bg-amber-600 text-white border-black animate-pulse" 
                          : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-700"
                      )}
                    >
                      {submittingId === p.id ? <Spinner size={12} /> : (confirmId === p.id ? "Confirm?" : "Mark Completed")}
                    </button>
                </div>
            ))}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Job No.</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">FFG Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {paginatedPendingList.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-black font-medium">No pending Tally entries.</td>
              </tr>
            ) : (
              paginatedPendingList.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 divide-x divide-black">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{p.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{npdItems.find(i => i.id === p.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-emerald-700 border border-black">{Number(p.prodFromFFG || 0).toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{p.uom}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black">
                    <button
                      onClick={() => handleComplete(p.id)}
                      disabled={submittingId === p.id}
                      className={cn(
                        "px-3 py-1 rounded font-bold text-xs uppercase flex items-center gap-1 ml-auto transition-all border disabled:opacity-50",
                        confirmId === p.id 
                          ? "bg-amber-600 text-white border-black animate-pulse" 
                          : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-700"
                      )}
                    >
                      {submittingId === p.id ? <Spinner size={12} /> : (confirmId === p.id ? <CheckCircle size={14} /> : <CheckCircle size={14} />)}
                      {confirmId === p.id ? "Confirm?" : "Mark Completed"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
