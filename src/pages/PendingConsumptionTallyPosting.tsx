import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialIssue } from "../types";
import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

export function PendingConsumptionTallyPosting() {
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [searchTerm, setSearchTerm] = useState("");

  const pendingRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...materialIssues]
      .filter((row) => isWithoutJobIssue(row.issueType))
      .filter((row) => String(row.consumptionTransactionNo || "").trim() !== "")
      .filter((row) => String(row.tallyTimestamp || "").trim() === "")
      .filter((row) => {
        if (!q) return true;
        const haystack = [
          row.issueNo,
          row.consumptionTransactionNo,
          row.date,
          row.remarks,
          row.tallyPostingStatus,
          row.tallyPostingError,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort(
        (a, b) =>
          String(a.date || "").localeCompare(String(b.date || "")) ||
          String(a.consumptionTransactionNo || "").localeCompare(String(b.consumptionTransactionNo || "")) ||
          String(a.issueNo || "").localeCompare(String(b.issueNo || ""))
      );
  }, [materialIssues, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Consumption Tally Posting</h2>
          <p className="text-sm font-medium text-slate-600 mt-1">
            Shows non-job issues where <span className="font-bold">tallyTimestamp</span> is blank.
          </p>
        </div>
        <div className="text-sm font-bold text-slate-700">Pending: {pendingRows.length}</div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search issue no, consumption no, date, error..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Consumption No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remark</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {pendingRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No pending Consumption Tally posting rows found.
                  </td>
                </tr>
              ) : (
                pendingRows.map((row) => (
                  <tr key={row.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-bold">{row.issueNo}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-indigo-700">{row.consumptionTransactionNo || "-"}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(row.date) || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.tallyPostingStatus || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.tallyPostingRemark || row.remarks || "-"}</td>
                    <td className="px-4 py-3 text-sm text-red-700">{row.tallyPostingError || "-"}</td>
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
