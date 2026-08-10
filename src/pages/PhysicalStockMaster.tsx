import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import type { StockTakerLog } from "../types";

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB");
}

export function PhysicalStockMaster() {
  const [stockTakerLogs] = useData<StockTakerLog>("reel_stock_taker_logs", [], { cacheToLocalStorage: false });
  const [scanSearchTerm, setScanSearchTerm] = useState("");
  const [scanDateFrom, setScanDateFrom] = useState("");
  const [scanDateTo, setScanDateTo] = useState("");

  const filteredScanLogs = useMemo(() => {
    const loweredSearch = scanSearchTerm.trim().toLowerCase();
    const fromMs = scanDateFrom ? new Date(scanDateFrom).getTime() : null;
    const toMs = scanDateTo ? new Date(scanDateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    return stockTakerLogs
      .filter((entry) => {
        const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

        if (fromMs != null && timestamp < fromMs) return false;
        if (toMs != null && timestamp > toMs) return false;
        if (
          loweredSearch &&
          ![entry.sessionNo, entry.sessionName, entry.reelNo, entry.mrrNo, entry.erp, entry.supplierName].some((value) =>
            String(value || "").toLowerCase().includes(loweredSearch),
          )
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  }, [scanDateFrom, scanDateTo, scanSearchTerm, stockTakerLogs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Physical Stock Master</h2>
        <div className="text-xs font-bold text-slate-700">Rows: {filteredScanLogs.length}</div>
      </div>

      <div className="rounded border border-black bg-white p-2">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_130px_130px_auto] xl:items-center">
          <div className="relative w-full min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              value={scanSearchTerm}
              onChange={(e) => setScanSearchTerm(e.target.value)}
              placeholder="Search session / reel / MRR / ERP / supplier"
              className="h-[34px] w-full rounded border-2 border-black pl-8 pr-2 text-xs font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <input type="date" value={scanDateFrom} onChange={(e) => setScanDateFrom(e.target.value)} title="Scan Date From" className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600" />
          <input type="date" value={scanDateTo} onChange={(e) => setScanDateTo(e.target.value)} title="Scan Date To" className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600" />
          {scanSearchTerm || scanDateFrom || scanDateTo ? (
            <button type="button" onClick={() => { setScanSearchTerm(""); setScanDateFrom(""); setScanDateTo(""); }} className="h-[34px] rounded border border-black bg-white px-2 text-[11px] font-bold text-black hover:bg-slate-50">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-260px)] w-full overflow-auto">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {["Session No", "Time", "Reel No", "MRR No", "ERP", "Supplier", "Book Stock", "Physical Weight", "Variance"].map((heading) => (
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
                filteredScanLogs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 text-sm font-black text-black">{entry.sessionNo || "-"}</td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{formatDateTime(entry.timestamp)}</td>
                    <td className="border-2 border-black px-3 py-3 text-sm font-bold text-black">{entry.reelNo}</td>
                    <td className="border-2 border-black px-3 py-3 text-sm text-black">{entry.mrrNo || "-"}</td>
                    <td className="border-2 border-black px-3 py-3 text-sm text-black">{entry.erp || "-"}</td>
                    <td className="min-w-[180px] border-2 border-black px-3 py-3 text-sm text-black">{entry.supplierName || "-"}</td>
                    <td className="border-2 border-black bg-slate-50 px-3 py-3 text-right text-sm font-bold text-black">{formatQty(Number(entry.systemAvailableWeight || 0))}</td>
                    <td className="border-2 border-black bg-blue-50 px-3 py-3 text-right text-sm font-bold text-blue-900">{formatQty(Number(entry.physicalWeight || 0))}</td>
                    <td className="border-2 border-black px-3 py-3 text-right text-sm font-black text-black">{formatQty(Number(entry.variance || 0))}</td>
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
