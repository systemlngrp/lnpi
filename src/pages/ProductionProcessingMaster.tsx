import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { ProductionProcessing } from "../types";
import { Trash2, Plus } from "lucide-react";
import { TableControls } from "../components/TableControls";
import { useNavigate } from "react-router-dom";
import { formatDate } from "../lib/serial";

export function ProductionProcessingMaster() {
  const navigate = useNavigate();
  const [processing, setProcessing] = useData<ProductionProcessing>("production_processing", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setProcessing(processing.filter(p => p.id !== id));
    setDeletingId(null);
  };

  const filtered = useMemo(() => {
    return processing
      .filter((p) => {
        const query = searchTerm.toLowerCase();
        return (
          String(p.jobNo || "").toLowerCase().includes(query) ||
          (p.machineName || "").toLowerCase().includes(query) ||
          (p.operatorName || "").toLowerCase().includes(query) ||
          String(p.shift || "Day").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [processing, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Reporting Master</h2>
        <button 
          onClick={() => navigate("/production-processing/form")} 
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
        >
          <Plus size={18} /> New Report
        </button>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search by Job No, Machine, or Operator..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Job No</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Shift</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Operator Name</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500 font-medium">No reporting records found.</td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black">{formatDate(item.date)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black">{item.jobNo}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black">{item.machineName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black">{item.shift || "Day"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-right text-emerald-700">
                      {Number(item.qty || 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-black">{item.operatorName || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => handleDelete(item.id)} 
                        className={`${deletingId === item.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                      >
                        <Trash2 size={16} className="mr-1" /> {deletingId === item.id ? "Confirm?" : "Delete"}
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

