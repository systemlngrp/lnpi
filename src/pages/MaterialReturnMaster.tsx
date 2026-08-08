import React, { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialReturn, MaterialReturnLine, MaterialReturnReelLine, Material, Production, Setting } from "../types";
import { Select } from "../components/Select";
import { Trash2, Package, Layers, Disc, Search, Download } from "lucide-react";
import { formatDate } from "../lib/serial";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { downloadReturnReelQrPdf } from "../lib/returnReelQrPdf";

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function resolveLineRate(line: MaterialReturnLine | undefined, material: Material | undefined) {
  const qty = Number(line?.qty || 0);
  const amount = Number(line?.amount || 0);
  if (qty > 0 && amount > 0) return amount / qty;

  const candidates = [line?.rate, line?.lastPurchaseRate, line?.openingRate, material?.openingRate];
  for (const candidate of candidates) {
    const rate = Number(candidate || 0);
    if (rate > 0) return rate;
  }
  return 0;
}

const returnTypeOptions = [
  { value: "all", label: "All Types" },
  { value: "job", label: "Job Specific" },
  { value: "general", label: "General" },
];

export function MaterialReturnMaster() {
  const [materialReturns, setMaterialReturns] = useData<MaterialReturn>("material-returns", []);
  const [returnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [reelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [productions] = useData<Production>("productions", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "reel-summary" | "reel-details">("general");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [materialFilter, setMaterialFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [reelFilter, setReelFilter] = useState("");

  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const returnLineMap = useMemo(() => new Map(returnLines.map((line) => [line.id, line])), [returnLines]);

  const materialOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    returnLines.forEach((line) => {
      const material = materialMap.get(line.materialId);
      if (material) optionMap.set(material.id, material.name);
    });
    reelLines.forEach((line) => {
      const material = materialMap.get(line.materialId);
      if (material) optionMap.set(material.id, material.name);
    });
    return Array.from(optionMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [returnLines, reelLines, materialMap]);

  const jobOptions = useMemo(() => {
    const jobs = new Set<string>();
    materialReturns.forEach((returnEntry) => {
      if (returnEntry.jobNo) jobs.add(returnEntry.jobNo);
    });
    reelLines.forEach((line) => {
      if (line.jobNo) jobs.add(line.jobNo);
    });
    return Array.from(jobs).sort().map((jobNo) => ({ value: jobNo, label: jobNo }));
  }, [materialReturns, reelLines]);

  const reelOptions = useMemo(() => {
    return Array.from(new Set(reelLines.map((line) => line.ourReelNo).filter(Boolean)))
      .sort()
      .map((reelNo) => ({ value: reelNo, label: reelNo }));
  }, [reelLines]);

  const processedData = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();

    const filteredReturns = materialReturns.filter((returnEntry) => {
      const returnDate = returnEntry.date?.split("T")[0] || "";
      if (fromDate && returnDate < fromDate) return false;
      if (toDate && returnDate > toDate) return false;

      const isJob = returnEntry.returnType === "Job";
      if (typeFilter === "job" && !isJob) return false;
      if (typeFilter === "general" && isJob) return false;

      return true;
    });

    const returnIds = new Set(filteredReturns.map((returnEntry) => returnEntry.id));
    const returnMap = new Map(filteredReturns.map((returnEntry) => [returnEntry.id, returnEntry]));

    const matchesText = (item: any) => {
      if (!q) return true;
      return Object.values(item).some((val) => String(val).toLowerCase().includes(q));
    };

    const matchesCommonFilters = (item: any) => {
      if (materialFilter && item.materialId !== materialFilter) return false;
      if (jobFilter && item.jobNo !== jobFilter) return false;
      return matchesText(item);
    };

    const general = returnLines
      .filter((line) => returnIds.has(line.materialReturnId))
      .map((line) => {
        const parent = returnMap.get(line.materialReturnId);
        if (!parent) return null;
        const material = materialMap.get(line.materialId);
        return {
          ...line,
          returnNo: parent.returnNo,
          date: parent.date,
          jobNo: parent.jobNo,
          remarks: parent.remarks,
          materialName: material?.name || "Unknown Material",
          returnType: parent.returnType,
          reelNos: reelLines
            .filter((reel) => reel.materialReturnLineId === line.id)
            .map((reel) => reel.ourReelNo)
            .join(" "),
        };
      })
      .filter(Boolean)
      .filter((line: any) => {
        if (reelFilter && !String(line.reelNos || "").split(" ").includes(reelFilter)) return false;
        return matchesCommonFilters(line);
      }) as any[];

    const reelDetails = reelLines
      .filter((line) => returnIds.has(line.materialReturnId))
      .map((reel) => {
        const parent = returnMap.get(reel.materialReturnId);
        if (!parent) return null;
        const material = materialMap.get(reel.materialId);
        const line = returnLineMap.get(reel.materialReturnLineId);
        const rate = resolveLineRate(line, material);
        const specs = material ? `${material.gsm || "-"} GSM / ${material.bf || "-"} BF / ${material.size || "-"} ${material.uom || ""}` : "Unknown";
        return {
          ...reel,
          returnNo: parent.returnNo,
          date: parent.date,
          jobNo: parent.jobNo,
          remarks: parent.remarks,
          specs,
          materialName: material?.name || "Unknown Material",
          materialCode: material?.erpCode || "",
          returnType: parent.returnType,
          rate,
          value: Number(reel.weightKg || 0) * rate,
        };
      })
      .filter(Boolean)
      .filter((reel: any) => {
        if (reelFilter && reel.ourReelNo !== reelFilter) return false;
        return matchesCommonFilters(reel);
      }) as any[];

    const summaryMap = new Map<string, any>();
    reelDetails.forEach((reel) => {
      const key = `${reel.materialReturnId}_${reel.materialId}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          ...reel,
          totalWeight: 0,
          totalValue: 0,
          reelCount: 0,
        });
      }
      const existing = summaryMap.get(key);
      existing.totalWeight += Number(reel.weightKg || 0);
      existing.totalValue += Number(reel.value || 0);
      existing.reelCount += 1;
    });

    const finalGeneral = general.sort((a, b) => b.date.localeCompare(a.date));
    const finalReelSummary = Array.from(summaryMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    const finalReelDetails = reelDetails.sort((a, b) => b.date.localeCompare(a.date));
    const visibleReturnIds = new Set([...finalGeneral, ...finalReelDetails].map((row) => row.materialReturnId));
    const visibleReturns = filteredReturns.filter((returnEntry) => visibleReturnIds.has(returnEntry.id));

    const metrics = {
      totalTransactions: visibleReturns.length,
      totalWeight: finalReelDetails.reduce((sum, row) => sum + Number(row.weightKg || 0), 0),
      totalValue: finalReelDetails.reduce((sum, row) => sum + Number(row.value || 0), 0),
      jobReturns: visibleReturns.filter((returnEntry) => returnEntry.returnType === "Job").length,
      generalReturns: visibleReturns.filter((returnEntry) => returnEntry.returnType !== "Job").length,
    };

    return {
      general: finalGeneral,
      reelSummary: finalReelSummary,
      reelDetails: finalReelDetails,
      metrics,
    };
  }, [materialReturns, returnLines, reelLines, materialMap, returnLineMap, searchTerm, fromDate, toDate, typeFilter, materialFilter, jobFilter, reelFilter]);

  const handleDownloadReturnQrPdf = async (row: any) => {
    try {
      await downloadReturnReelQrPdf({
        returnNo: row.returnNo || "",
        date: row.date || "",
        jobNo: row.jobNo || "",
        materialName: row.materialName || "",
        materialCode: row.materialCode || "",
        specs: row.specs || "",
        reelNo: row.ourReelNo || "",
        weight: Number(row.weightKg || 0),
        setting: settings[0] || null,
      });
    } catch (error) {
      console.error("Failed to generate return reel QR PDF", error);
      alert(error instanceof Error ? error.message : "Failed to generate return reel QR PDF.");
    }
  };

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

  const activeRows = activeTab === "general"
    ? processedData.general
    : activeTab === "reel-summary"
      ? processedData.reelSummary
      : processedData.reelDetails;

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems,
  } = useClientPagination(activeRows, 25);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchTerm, fromDate, toDate, typeFilter, materialFilter, jobFilter, reelFilter, setPage]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Return Master</h2>
          <div className="text-xs text-slate-500 font-medium">Track and analyze material returns and reel recoveries.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Total Transactions</div>
          <div className="text-3xl font-black">{processedData.metrics.totalTransactions.toLocaleString()}</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Total Reel Weight</div>
          <div className="text-3xl font-black">{formatNumber(processedData.metrics.totalWeight)} <span className="text-xs">KG</span></div>
        </div>
        <div className="bg-gradient-to-br from-cyan-500 to-cyan-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Total Reel Value</div>
          <div className="text-3xl font-black">{formatNumber(processedData.metrics.totalValue)}</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Job Returns</div>
          <div className="text-3xl font-black">{processedData.metrics.jobReturns.toLocaleString()}</div>
        </div>
        <div className="bg-gradient-to-br from-rose-500 to-rose-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">General Returns</div>
          <div className="text-3xl font-black">{processedData.metrics.generalReturns.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[minmax(260px,1.4fr)_repeat(6,minmax(140px,1fr))_auto] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search return no, job no, reel no, material..."
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <Select options={returnTypeOptions} value={typeFilter} onChange={(value) => setTypeFilter(value || "all")} placeholder="All Types" />
          <Select options={materialOptions} value={materialFilter} onChange={setMaterialFilter} placeholder="All Materials" />
          <Select options={jobOptions} value={jobFilter} onChange={setJobFilter} placeholder="All Jobs" />
          <Select options={reelOptions} value={reelFilter} onChange={setReelFilter} placeholder="All Reels" />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          {(fromDate || toDate || typeFilter !== "all" || searchTerm || materialFilter || jobFilter || reelFilter) ? (
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setTypeFilter("all");
                setSearchTerm("");
                setMaterialFilter("");
                setJobFilter("");
                setReelFilter("");
              }}
              className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
            >
              Clear Filters
            </button>
          ) : null}
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
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Return No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Material</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">UOM</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {activeRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-600 font-medium">No general material returns found.</td>
                  </tr>
                ) : (
                  paginatedItems.map((row: any) => (
                    <tr key={row.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-indigo-700">{row.returnNo}</td>
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
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Return No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Material Specs</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total Weight (KG)</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total Value</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase">Reel Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {activeRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-600 font-medium">No reel returns found.</td>
                  </tr>
                ) : (
                  paginatedItems.map((row: any, idx) => (
                    <tr key={idx} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-emerald-700">{row.returnNo}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium">{row.jobNo || "-"}</td>
                      <td className="px-4 py-3 text-sm">{row.specs}</td>
                      <td className="px-4 py-3 text-sm text-right font-black text-emerald-600">{formatNumber(row.totalWeight)}</td>
                      <td className="px-4 py-3 text-sm text-right font-black text-cyan-700">{formatNumber(row.totalValue)}</td>
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
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Return No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Job No</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Material Specs</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Our Reel No</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Weight (KG)</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase">Value</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase">QR PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {activeRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-slate-600 font-medium">No reel details found.</td>
                  </tr>
                ) : (
                  paginatedItems.map((row: any) => (
                    <tr key={row.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-amber-700">{row.returnNo}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium">{row.jobNo || "-"}</td>
                      <td className="px-4 py-3 text-sm">{row.specs}</td>
                      <td className="px-4 py-3 text-sm font-black text-slate-900">{row.ourReelNo}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-amber-600">{formatNumber(row.weightKg)}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-cyan-700">{formatNumber(row.value)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleDownloadReturnQrPdf(row)}
                          className="inline-flex items-center gap-1 rounded border border-indigo-700 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100"
                          title="Download return reel QR PDF"
                        >
                          <Download size={12} />
                          QR PDF
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ClientPagination page={page} pageSize={pageSize} totalItems={totalItems} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
