import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useData } from "../hooks/useData";
import { SampleRequest } from "../types";
import { formatDate } from "../lib/serial";
import { sortSampleRequestsDesc } from "../lib/sampleRequests";

export function PendingSamples() {
  const [sampleRequests, setSampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const rows = sampleRequests.filter((row) => !row.jobCardNo && !row.cancelTimestamp);
    const searched = search
      ? rows.filter((row) =>
          [row.itemName, String(row.erp || ""), formatDate(row.date)]
            .join(" ")
            .toLowerCase()
            .includes(search)
        )
      : rows;

    return sortSampleRequestsDesc(searched);
  }, [sampleRequests, searchTerm]);

  const handleCancel = async (row: SampleRequest) => {
    if (!window.confirm(`Cancel sample request for ${row.itemName}?`)) return;

    setSavingId(row.id);
    try {
      const timestamp = new Date().toISOString();
      await setSampleRequests((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                cancelTimestamp: timestamp,
                cancelBy: "System User",
                updatedBy: "System User",
                updateTimestamp: timestamp,
              }
            : entry
        )
      );
    } catch (err) {
      console.error("Failed to cancel sample request:", err);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Samples</h2>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search item or ERP..."
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
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-black font-medium italic">
                    No pending sample requests.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                    <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black">{row.itemName}</td>
                    <td className="px-4 py-3 text-sm text-black border border-black whitespace-nowrap">{row.erp || "-"}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-black border border-black whitespace-nowrap">{Number(row.plannedQuantity || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-center border border-black whitespace-nowrap">
                      <button
                        onClick={() => handleCancel(row)}
                        disabled={savingId === row.id}
                        className="inline-flex items-center justify-center min-w-[110px] bg-rose-600 text-white px-3 py-1.5 rounded font-bold hover:bg-rose-700 transition disabled:opacity-50"
                      >
                        {savingId === row.id ? <Spinner size={14} className="text-white" /> : "Cancel"}
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
