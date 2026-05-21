import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { ProductionProcessing } from "../types";
import { Trash2, Plus } from "lucide-react";
import { TableControls } from "../components/TableControls";
import { useNavigate } from "react-router-dom";
import { PROCESSING_MACHINE_COLUMNS, groupProcessingByProduction } from "../lib/productionProcessingSummary";

export function ProductionProcessingMaster() {
  const navigate = useNavigate();
  const [processing, setProcessing] = useData<ProductionProcessing>("production_processing", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (ids: string[]) => {
    const deletionKey = ids.join("|");
    if (deletingId !== deletionKey) {
      setDeletingId(deletionKey);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setProcessing(processing.filter(p => !ids.includes(p.id)));
    setDeletingId(null);
  };

  const groupedRows = useMemo(() => groupProcessingByProduction(processing), [processing]);

  const filtered = groupedRows.filter((row) => {
    const query = searchTerm.toLowerCase();
    return (
      row.jobNo.toLowerCase().includes(query) ||
      row.operatorNames.some((operator) => operator.toLowerCase().includes(query))
    );
  });

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
                {PROCESSING_MACHINE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider"
                  >
                    {column.label}
                  </th>
                ))}
                <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Operator</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-slate-500 font-medium">No reporting records found.</td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.productionId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-black">{item.date}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-black">{item.jobNo}</td>
                    {PROCESSING_MACHINE_COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className="px-6 py-4 whitespace-nowrap text-sm font-bold text-right text-black"
                      >
                        {item[column.key] ? item[column.key].toLocaleString() : ""}
                      </td>
                    ))}
                    <td className="px-6 py-4 text-sm text-black min-w-[150px]">{item.operatorNames.join(", ") || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => handleDelete(item.recordIds)} 
                        className={`${deletingId === item.recordIds.join("|") ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                      >
                        <Trash2 size={16} className="mr-1" /> {deletingId === item.recordIds.join("|") ? "Confirm?" : "Delete"}
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
