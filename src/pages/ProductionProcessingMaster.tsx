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
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setProcessing((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  const filtered = useMemo(() => {
    return processing
      .filter((p) => {
        const query = searchTerm.toLowerCase();
        const matchesSearch = (
          String(p.jobNo || "").toLowerCase().includes(query) ||
          (p.machineName || "").toLowerCase().includes(query) ||
          (p.operatorName || "").toLowerCase().includes(query) ||
          String(p.shift || "Day").toLowerCase().includes(query) ||
          String(p.itemName || "").toLowerCase().includes(query) ||
          String(p.erp || "").toLowerCase().includes(query) ||
          String(p.boxType || "").toLowerCase().includes(query)
        );
        const matchesFrom = !fromDate || String(p.date || "") >= fromDate;
        const matchesTo = !toDate || String(p.date || "") <= toDate;
        return matchesSearch && matchesFrom && matchesTo;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [processing, searchTerm, fromDate, toDate]);

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

      <div className="flex flex-nowrap items-center gap-3 overflow-x-auto">
        <div className="min-w-0 flex-1">
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search by Job No, Machine, Operator, Item, or ERP..." />
        </div>
        <div className="flex shrink-0 items-end gap-3 rounded border border-black bg-white px-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-600">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded border border-black bg-white px-2 py-1.5 text-sm font-semibold outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-600">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded border border-black bg-white px-2 py-1.5 text-sm font-semibold outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            className="rounded border border-black bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase hover:bg-slate-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Date</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Job No</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Item Name</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">ERP</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Box Type</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Shift</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border border-black">Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border border-black">Operator Name</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border border-black">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-slate-500 font-medium border border-black">No reporting records found.</td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{formatDate(item.date)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">{item.jobNo}</td>
                    <td className="px-6 py-4 text-sm text-black border border-black">{item.itemName || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{item.erp || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{item.boxType || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black border border-black">{item.machineName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black border border-black">{item.shift || "Day"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-right text-emerald-700 border border-black">
                      {Number(item.qty || 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-black border border-black">{item.operatorName || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium border border-black">
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

