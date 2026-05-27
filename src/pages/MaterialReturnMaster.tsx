import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialReturn, Production } from "../types";
import { TableControls } from "../components/TableControls";
import { Trash2 } from "lucide-react";
import { formatDate } from "../lib/serial";

export function MaterialReturnMaster() {
  const [materialReturns, setMaterialReturns] = useData<MaterialReturn>("material-returns", []);
  const [productions] = useData<Production>("productions", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...materialReturns]
      .filter((row) => {
        if (!q) return true;
        const haystack = [
          row.returnNo,
          row.date,
          row.returnType,
          row.jobNo,
          row.remarks,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.returnNo || "").localeCompare(a.returnNo || ""));
  }, [materialReturns, searchTerm]);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialReturns((prev) => prev.filter((row) => row.id !== id));
    setDeletingId(null);
  };

  const getJobDate = (productionId?: string) =>
    productions.find((p) => p.id === productionId)?.date || "";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Return Master</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search return no, date, type, job..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Return No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Return Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remarks</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No material returns found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-bold">{row.returnNo}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(row.date) || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.returnType}</td>
                    <td className="px-4 py-3 text-sm">{row.jobNo || "-"}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(getJobDate(row.productionId)) || "-"}</td>
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

