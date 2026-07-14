import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialVisit, Supplier, Company } from "../types";
import { formatDate } from "../lib/serial";
import { Trash2, Search, Plus, CheckCircle, Clock, XCircle, PlayCircle } from "lucide-react";
import { Spinner } from "../components/Spinner";

export function MaterialVisitMaster() {
  const [visits, setVisits] = useData<MaterialVisit>("material-visit", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const getSupplierName = (id: string) => {
    return suppliers.find(s => s.id === id)?.name || companies.find(c => c.id === id)?.name || id;
  };

  const filteredVisits = visits
    .filter(v => {
      const supplierName = getSupplierName(v.supplierId).toLowerCase();
      const visitorName = v.visitorName.toLowerCase();
      const visitNo = v.visitNo.toLowerCase();
      const purpose = v.purpose.toLowerCase();
      const search = searchTerm.toLowerCase();

      const matchesSearch = 
        supplierName.includes(search) || 
        visitorName.includes(search) || 
        visitNo.includes(search) || 
        purpose.includes(search);
      
      const matchesStatus = statusFilter === "All" || v.status === statusFilter;

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => new Date(b.updateTimestamp || b.date).getTime() - new Date(a.updateTimestamp || a.date).getTime());

  const handleDelete = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    try {
      await setVisits(visits.filter(v => v.id !== id));
      setDeletingId(null);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const getStatusIcon = (status: MaterialVisit['status']) => {
    switch (status) {
      case "Pending": return <Clock className="text-amber-500" size={16} />;
      case "In-Progress": return <PlayCircle className="text-blue-500" size={16} />;
      case "Completed": return <CheckCircle className="text-emerald-500" size={16} />;
      case "Cancelled": return <XCircle className="text-red-500" size={16} />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Visit Master</h2>
        <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-black rounded text-sm font-bold uppercase bg-white"
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="In-Progress">In-Progress</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search visitor, supplier..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Visit No</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Visitor Name</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Supplier / Customer</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Purpose</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Status</th>
              <th className="px-4 py-3 text-right border border-black"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredVisits.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-black font-medium italic">No visit records found.</td>
              </tr>
            ) : (
              filteredVisits.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                  <td className="px-4 py-4 text-sm font-medium text-black border border-black">{v.visitNo}</td>
                  <td className="px-4 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(v.date)}</td>
                  <td className="px-4 py-4 text-sm text-black border border-black">{v.visitorName}</td>
                  <td className="px-4 py-4 text-sm text-black border border-black">{getSupplierName(v.supplierId)}</td>
                  <td className="px-4 py-4 text-sm text-black border border-black">{v.purpose}</td>
                  <td className="px-4 py-4 text-sm border border-black">
                    <div className="flex items-center gap-2 font-bold uppercase text-[10px]">
                      {getStatusIcon(v.status)}
                      <span>{v.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right text-sm font-medium border border-black">
                    <button
                      onClick={() => handleDelete(v.id)}
                      className={`${deletingId === v.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === v.id ? "Confirm?" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
