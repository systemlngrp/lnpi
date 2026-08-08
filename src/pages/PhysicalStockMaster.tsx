import React, { useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";

type ScanStatusFilter = "all" | "matched" | "mismatch";

type StockTakerLog = {
  id: string;
  timestamp: string;
  reelNo: string;
  mrrNo: string;
  erp: string;
  supplierName: string;
  systemAvailableWeight: number;
  physicalWeight: number;
  variance: number;
};

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
}

export function PhysicalStockMaster() {
  const [stockTakerLogs, setStockTakerLogs] = useData<StockTakerLog>("reel_stock_taker_logs", [], { cacheToLocalStorage: false });
  const [scanSearchTerm, setScanSearchTerm] = useState("");
  const [scanDateFrom, setScanDateFrom] = useState("");
  const [scanDateTo, setScanDateTo] = useState("");
  const [scanStatusFilter, setScanStatusFilter] = useState<ScanStatusFilter>("all");

  const filteredScanLogs = useMemo(() => {
    const loweredSearch = scanSearchTerm.trim().toLowerCase();
    const fromMs = scanDateFrom ? new Date(scanDateFrom).getTime() : null;
    const toMs = scanDateTo ? new Date(scanDateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    return stockTakerLogs
      .filter((entry) => {
        const variance = Number(entry.variance || 0);
        const isMatched = Math.abs(variance) <= 0.5;
        const status = isMatched ? "matched" : "mismatch";
        const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

        if (scanStatusFilter !== "all" && status !== scanStatusFilter) return false;
        if (fromMs != null && timestamp < fromMs) return false;
        if (toMs != null && timestamp > toMs) return false;
        if (
          loweredSearch &&
          ![
            entry.reelNo,
            entry.mrrNo,
            entry.erp,
            entry.supplierName,
            isMatched ? "matched" : "mismatched",
          ].some((value) => String(value || "").toLowerCase().includes(loweredSearch))
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  }, [scanDateFrom, scanDateTo, scanSearchTerm, scanStatusFilter, stockTakerLogs]);

  const handleClearData = async () => {
    if (stockTakerLogs.length === 0) return;
    const confirmed = window.confirm("Clear all physical stock scan records?");
    if (!confirmed) return;
    await setStockTakerLogs([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Physical Stock Master</h2>
        <div className="text-xs font-bold text-slate-700">Rows: {filteredScanLogs.length}</div>
      </div>

      <div className="rounded border border-black bg-white p-2">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_130px_130px_210px_auto] xl:items-center">
          <div className="relative w-full min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              value={scanSearchTerm}
              onChange={(e) => setScanSearchTerm(e.target.value)}
              placeholder="Search reel / MRR / ERP / supplier / status"
              className="h-[34px] w-full rounded border-2 border-black pl-8 pr-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input type="date" value={scanDateFrom} onChange={(e) => setScanDateFrom(e.target.value)} title="Scan Date From" className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
          <input type="date" value={scanDateTo} onChange={(e) => setScanDateTo(e.target.value)} title="Scan Date To" className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
          <div className="grid h-[34px] grid-cols-3 gap-1 rounded border-2 border-black bg-white p-1">
            {[
              { label: "All", value: "all" as const },
              { label: "Matched", value: "matched" as const },
              { label: "Mismatch", value: "mismatch" as const },
            ].map((option) => (
              <button key={option.value} type="button" onClick={() => setScanStatusFilter(option.value)} className={`rounded px-1 text-[11px] font-black ${scanStatusFilter === option.value ? "bg-indigo-600 text-white" : "bg-slate-50 text-black hover:bg-slate-100"}`}>
                {option.label}
              </button>
            ))}
          </div>
          {scanSearchTerm || scanDateFrom || scanDateTo || scanStatusFilter !== "all" ? (
            <button type="button" onClick={() => { setScanSearchTerm(""); setScanDateFrom(""); setScanDateTo(""); setScanStatusFilter("all"); }} className="h-[34px] rounded border border-black bg-white px-2 text-[11px] font-bold text-black hover:bg-slate-50">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border-2 border-black overflow-hidden">
        <div className="max-h-[calc(100vh-260px)] w-full overflow-auto">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {["Time", "Reel No", "MRR No", "ERP", "Supplier", "Book Weight", "Physical Weight", "Variance", "Status"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredScanLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="border-2 border-black px-6 py-10 text-center font-medium text-black">No physical stock scans found.</td>
                </tr>
              ) : (
                filteredScanLogs.map((entry) => {
                  const isMatched = Math.abs(Number(entry.variance || 0)) <= 0.5;
                  return (
                    <tr key={entry.id} className={isMatched ? "hover:bg-emerald-50/40" : "bg-rose-50/50 hover:bg-rose-50"}>
                      <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{new Date(entry.timestamp).toLocaleString("en-GB")}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm font-bold text-black">{entry.reelNo}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm text-black">{entry.mrrNo}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm text-black">{entry.erp}</td>
                      <td className="min-w-[180px] border-2 border-black px-3 py-3 text-sm text-black">{entry.supplierName || "-"}</td>
                      <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right text-sm font-bold text-emerald-900">{formatQty(Number(entry.systemAvailableWeight || 0))}</td>
                      <td className="border-2 border-black bg-blue-50 px-3 py-3 text-right text-sm font-bold text-blue-900">{formatQty(Number(entry.physicalWeight || 0))}</td>
                      <td className={`border-2 border-black px-3 py-3 text-right text-sm font-bold ${Number(entry.variance || 0) >= 0 ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}>{formatQty(Number(entry.variance || 0))}</td>
                      <td className={`border-2 border-black px-3 py-3 text-xs font-black uppercase ${isMatched ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{isMatched ? "Matched" : "Mismatched"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end border-t border-black pt-3">
        <button
          type="button"
          onClick={handleClearData}
          disabled={stockTakerLogs.length === 0}
          className="inline-flex h-[38px] items-center gap-2 rounded border border-rose-700 bg-rose-50 px-3 text-xs font-black uppercase text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={14} />
          Clear Data
        </button>
      </div>
    </div>
  );
}
