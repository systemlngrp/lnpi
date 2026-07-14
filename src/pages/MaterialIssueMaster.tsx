import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialIssue, MaterialIssueLine, MaterialIssueReelLine, Material, Production } from "../types";
import { TableControls } from "../components/TableControls";
import { Trash2, Package, Layers, Disc } from "lucide-react";
import { formatDate } from "../lib/serial";

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

export function MaterialIssueMaster() {
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [reelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [productions] = useData<Production>("productions", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "reel-summary" | "reel-details">("general");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all, job, general

  const materialMap = useMemo(() => new Map(materials.map(m => [m.id, m])), [materials]);

  const processedData = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();

    // 1. Filter raw issues first
    const filteredIssues = materialIssues.filter(i => {
      // Custom Date Range filter
      const issueDate = i.date?.split("T")[0] || "";
      if (fromDate && issueDate < fromDate) return false;
      if (toDate && issueDate > toDate) return false;

      // Type filter
      const isJob = !isWithoutJobIssue(i.issueType);
      if (typeFilter === "job" && !isJob) return false;
      if (typeFilter === "general" && isJob) return false;

      return true;
    });

    const issueIds = new Set(filteredIssues.map(i => i.id));

    // 2. General Material Lines
    const general = issueLines.filter(l => issueIds.has(l.materialIssueId)).map(line => {
      const parent = filteredIssues.find(i => i.id === line.materialIssueId);
      if (!parent) return null;
      const material = materialMap.get(line.materialId);
      return {
        ...line,
        issueNo: parent.issueNo,
        date: parent.date,
        jobNo: parent.jobNo,
        remarks: parent.remarks,
        materialName: material?.name || "Unknown Material",
      };
    }).filter(Boolean) as any[];

    // 3. Reel Details
    const reelDetails = reelLines.filter(l => issueIds.has(l.materialIssueId)).map(reel => {
      const parent = filteredIssues.find(i => i.id === reel.materialIssueId);
      if (!parent) return null;
      const material = materialMap.get(reel.materialId);
      const specs = material ? `${material.gsm || "-"} GSM / ${material.bf || "-"} BF / ${material.size || "-"} ${material.sizeUom || ""}` : "Unknown";
      return {
        ...reel,
        issueNo: parent.issueNo,
        date: parent.date,
        jobNo: parent.jobNo,
        remarks: parent.remarks,
        specs,
      };
    }).filter(Boolean) as any[];

    // 4. Reel Summary (Grouped)
    const summaryMap = new Map<string, any>();
    reelDetails.forEach(reel => {
      const key = `${reel.materialIssueId}_${reel.materialId}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          ...reel,
          totalWeight: 0,
          reelCount: 0,
        });
      }
      const existing = summaryMap.get(key);
      existing.totalWeight += Number(reel.weightKg || 0);
      existing.reelCount += 1;
    });
    const reelSummary = Array.from(summaryMap.values());

    const filterFn = (item: any) => {
      if (!q) return true;
      return Object.values(item).some(val => 
        String(val).toLowerCase().includes(q)
      );
    };

    const finalGeneral = general.filter(filterFn).sort((a, b) => b.date.localeCompare(a.date));
    const finalReelSummary = reelSummary.filter(filterFn).sort((a, b) => b.date.localeCompare(a.date));
    const finalReelDetails = reelDetails.filter(filterFn).sort((a, b) => b.date.localeCompare(a.date));

    // Calculate Metrics
    const metrics = {
      totalTransactions: filteredIssues.length,
      totalWeight: reelDetails.reduce((sum, r) => sum + Number(r.weightKg || 0), 0),
      jobIssues: filteredIssues.filter(i => !isWithoutJobIssue(i.issueType)).length,
      generalIssues: filteredIssues.filter(i => isWithoutJobIssue(i.issueType)).length,
    };

    return {
      general: finalGeneral,
      reelSummary: finalReelSummary,
      reelDetails: finalReelDetails,
      metrics,
    };
  }, [materialIssues, issueLines, reelLines, materialMap, searchTerm, fromDate, toDate, typeFilter]);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIssues((prev) => prev.filter((row) => row.id !== id));
    setDeletingId(null);
  };

  const getJobDate = (productionId?: string) =>
    productions.find((p) => p.id === productionId)?.date || "";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Issue Master</h2>
          <div className="text-xs text-slate-500 font-medium">Track and analyze material consumption and reel usage.</div>
        </div>
      </div>

      {/* Colorful Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Total Transactions</div>
          <div className="text-3xl font-black">{processedData.metrics.totalTransactions.toLocaleString()}</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Total Reel Weight</div>
          <div className="text-3xl font-black">{processedData.metrics.totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs">KG</span></div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Job Issues</div>
          <div className="text-3xl font-black">{processedData.metrics.jobIssues.toLocaleString()}</div>
        </div>
        <div className="bg-gradient-to-br from-rose-500 to-rose-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">General Issues</div>
          <div className="text-3xl font-black">{processedData.metrics.generalIssues.toLocaleString()}</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-end gap-4 bg-slate-50 p-4 border border-black rounded shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">From Date</label>
          <input 
            type="date"
            value={fromDate} 
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-black rounded px-2 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">To Date</label>
          <input 
            type="date"
            value={toDate} 
            onChange={(e) => setToDate(e.target.value)}
            className="border border-black rounded px-2 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">Issue Type</label>
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-black rounded px-2 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none min-w-[120px]"
          >
            <option value="all">All Types</option>
            <option value="job">Job Specific</option>
            <option value="general">Without Job</option>
          </select>
        </div>

        <div className="flex-1 min-w-[200px] flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">Search</label>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search Job No, Reel No, Material..." />
        </div>

        {(fromDate || toDate || typeFilter !== "all" || searchTerm) && (
          <button 
            onClick={() => {
              setFromDate("");
              setToDate("");
              setTypeFilter("all");
              setSearchTerm("");
            }}
            className="text-[10px] font-black uppercase text-red-600 hover:text-red-800 underline pb-2"
          >
            Reset Filters
          </button>
        )}
      </div>

      <div className="flex border-b border-black mt-2">
        <button
          onClick={() => setActiveTab("general")}
          className={`px-4 py-2 text-xs font-black uppercase tracking-widest border-t border-l border-r border-black -mb-[1px] flex items-center gap-2 transition-all ${
            activeTab === "general" ? "bg-white border-b-transparent text-indigo-700" : "bg-slate-50 text-slate-400 opacity-70 hover:opacity-100"
          }`}
        >
          <Package size={14} /> General Material ({processedData.general.length})
        </button>
        <button
          onClick={() => setActiveTab("reel-summary")}
          className={`px-4 py-2 text-xs font-black uppercase tracking-widest border-t border-l border-r border-black -mb-[1px] ml-1 flex items-center gap-2 transition-all ${
            activeTab === "reel-summary" ? "bg-white border-b-transparent text-emerald-700" : "bg-slate-50 text-slate-400 opacity-70 hover:opacity-100"
          }`}
        >
          <Layers size={14} /> Reel Summary ({processedData.reelSummary.length})
        </button>
        <button
          onClick={() => setActiveTab("reel-details")}
          className={`px-4 py-2 text-xs font-black uppercase tracking-widest border-t border-l border-r border-black -mb-[1px] ml-1 flex items-center gap-2 transition-all ${
            activeTab === "reel-details" ? "bg-white border-b-transparent text-amber-700" : "bg-slate-50 text-slate-400 opacity-70 hover:opacity-100"
          }`}
        >
          <Disc size={14} /> Reel Details ({processedData.reelDetails.length})
        </button>
      </div>

      <div className="bg-white rounded-b shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          {activeTab === "general" && (
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="sticky top-0 z-30 bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Material</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">UOM</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {processedData.general.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-600 font-medium">No general material issues found.</td>
                  </tr>
                ) : (
                  processedData.general.map((row) => (
                    <tr key={row.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-indigo-700">{row.issueNo}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium">{row.jobNo || "-"}</td>
                      <td className="px-4 py-3 text-sm">{row.materialName}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-indigo-600">{row.qty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm uppercase">{row.uom}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 italic">{row.remarks || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "reel-summary" && (
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="sticky top-0 z-30 bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Material Specs</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total Weight (KG)</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase">Reel Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {processedData.reelSummary.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-600 font-medium">No reel issues found.</td>
                  </tr>
                ) : (
                  processedData.reelSummary.map((row, idx) => (
                    <tr key={idx} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-emerald-700">{row.issueNo}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium">{row.jobNo || "-"}</td>
                      <td className="px-4 py-3 text-sm">{row.specs}</td>
                      <td className="px-4 py-3 text-sm text-right font-black text-emerald-600">{Number(row.totalWeight || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-center font-bold">{row.reelCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "reel-details" && (
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="sticky top-0 z-30 bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Material Specs</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Our Reel No</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Weight (KG)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {processedData.reelDetails.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-600 font-medium">No reel details found.</td>
                  </tr>
                ) : (
                  processedData.reelDetails.map((row) => (
                    <tr key={row.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-amber-700">{row.issueNo}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium">{row.jobNo || "-"}</td>
                      <td className="px-4 py-3 text-sm">{row.specs}</td>
                      <td className="px-4 py-3 text-sm font-black text-slate-900">{row.ourReelNo}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-amber-600">{Number(row.weightKg || 0).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

