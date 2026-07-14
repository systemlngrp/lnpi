import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { SampleRequest } from "../types";
import { formatDate } from "../lib/serial";
import { sortSampleRequestsDesc } from "../lib/sampleRequests";

export function SamplesProduced() {
  const [sampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const rows = sampleRequests.filter((row) => !!row.jobCardNo && !row.cancelTimestamp);
    const searched = search
      ? rows.filter((row) =>
          [row.itemName, String(row.erp || ""), String(row.jobCardNo || "")]
            .join(" ")
            .toLowerCase()
            .includes(search)
        )
      : rows;

    return sortSampleRequestsDesc(searched);
  }, [sampleRequests, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Samples Produced</h2>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search item, ERP, job card..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">ERP</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Planned Qty</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job Card No.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-black font-medium italic">
                    No produced samples found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                    <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black">{row.itemName}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{row.erp || "-"}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-black border border-black whitespace-nowrap">{Number(row.plannedQuantity || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{row.jobCardNo}</td>
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
