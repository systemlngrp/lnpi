import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialIssue } from "../types";
import { TableControls } from "../components/TableControls";
import { Trash2 } from "lucide-react";
import { formatDate } from "../lib/serial";

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

export function NonJobIssueMaster() {
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...materialIssues]
      .filter((row) => isWithoutJobIssue(row.issueType))
      .filter((row) => {
        if (!q) return true;
        const haystack = [row.issueNo, row.date, row.remarks]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.issueNo || "").localeCompare(a.issueNo || ""));
  }, [materialIssues, searchTerm]);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIssues((prev) => prev.filter((row) => row.id !== id));
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Non-Job Issue Master</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search issue no, date, remarks..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remarks</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No “Without Job” material issues found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-bold">{row.issueNo}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(row.date) || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.remarks || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        title={deletingId === row.id ? "Confirm delete" : "Delete"}
                        onClick={() => handleDelete(row.id)}
                        className={`${deletingId === row.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center justify-end`}
                      >
                        <Trash2 size={16} />
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
  );
}
