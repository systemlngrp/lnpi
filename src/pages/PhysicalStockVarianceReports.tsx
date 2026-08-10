import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { buildReelStockRows } from "../lib/reelStock";
import {
  buildPhysicalStockExcessRows,
  buildPhysicalStockShortageRows,
  formatPhysicalQty,
  getDefaultPhysicalStockSessionId,
} from "../lib/physicalStockReports";
import type {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  PhysicalStockSession,
  StockTakerLog,
  Supplier,
} from "../types";

type ReportMode = "excess" | "shortage";

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB");
}

function PhysicalStockVarianceReport({ mode }: { mode: ReportMode }) {
  const [sessions] = useData<PhysicalStockSession>("physical_stock_sessions", [], { cacheToLocalStorage: false });
  const [logs] = useData<StockTakerLog>("reel_stock_taker_logs", [], { cacheToLocalStorage: false });
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", [], { cacheToLocalStorage: false });
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [suppliers] = useData<Supplier>("suppliers", [], { cacheToLocalStorage: false });
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const defaultSessionId = useMemo(() => getDefaultPhysicalStockSessionId(sessions), [sessions]);

  useEffect(() => {
    if (!selectedSessionId && defaultSessionId) setSelectedSessionId(defaultSessionId);
    if (selectedSessionId && sessions.length > 0 && !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(defaultSessionId);
    }
  }, [defaultSessionId, selectedSessionId, sessions]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [selectedSessionId, sessions],
  );

  const stockRows = useMemo(
    () => buildReelStockRows({ materials, materialIn, packingSlips, issueReelLines, returnReelLines, suppliers }).filter((row) => row.availableWeight > 0),
    [issueReelLines, materialIn, materials, packingSlips, returnReelLines, suppliers],
  );

  const reportRows = useMemo(() => {
    if (mode === "excess") {
      return buildPhysicalStockExcessRows({ sessions, logs, selectedSessionId });
    }
    return buildPhysicalStockShortageRows({ sessions, logs, stockRows, selectedSessionId });
  }, [logs, mode, selectedSessionId, sessions, stockRows]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return reportRows;
    return reportRows.filter((row) =>
      [row.sessionNo, row.reelNo, row.mrrNo, row.erp, row.supplierName].some((value) => String(value || "").toLowerCase().includes(q)),
    );
  }, [reportRows, searchTerm]);

  const totals = useMemo(
    () => filteredRows.reduce(
      (sum, row) => ({
        book: sum.book + Number(row.systemAvailableWeight || 0),
        physical: sum.physical + Number(row.physicalWeight || 0),
        variance: sum.variance + Number(row.variance || 0),
      }),
      { book: 0, physical: 0, variance: 0 },
    ),
    [filteredRows],
  );

  const isShortage = mode === "shortage";
  const title = isShortage ? "Physical Stock Shortage Report" : "Physical Stock Excess Report";
  const sessionPanelClass = isShortage ? "rounded border-2 border-black bg-rose-50 p-3" : "rounded border-2 border-black bg-emerald-50 p-3";
  const sessionLabelClass = isShortage ? "text-[10px] font-black uppercase text-rose-700" : "text-[10px] font-black uppercase text-emerald-700";
  const sessionValueClass = isShortage ? "mt-1 text-lg font-black text-rose-900" : "mt-1 text-lg font-black text-emerald-900";
  const selectedIsOpen = String(selectedSession?.status || "").toLowerCase() === "open";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">{title}</h2>
        <div className="text-xs font-bold text-slate-700">Rows: {filteredRows.length}</div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className={sessionPanelClass}>
          <div className={sessionLabelClass}>Session</div>
          <div className={sessionValueClass}>{selectedSession?.sessionNo || "-"}</div>
        </div>
        <div className="rounded border-2 border-black bg-slate-50 p-3">
          <div className="text-[10px] font-black uppercase text-slate-600">Book Stock</div>
          <div className="mt-1 text-lg font-black text-black">{formatPhysicalQty(totals.book)} KG</div>
        </div>
        <div className="rounded border-2 border-black bg-blue-50 p-3">
          <div className="text-[10px] font-black uppercase text-blue-700">Physical Stock</div>
          <div className="mt-1 text-lg font-black text-blue-900">{formatPhysicalQty(totals.physical)} KG</div>
        </div>
      </div>

      {isShortage && selectedIsOpen ? (
        <div className="rounded border border-amber-600 bg-amber-50 p-3 text-sm font-bold text-amber-900">
          This session is still open. Unscanned book-stock reels will be added to shortage after the session is closed.
        </div>
      ) : null}

      <div className="rounded border border-black bg-white p-2">
        <div className="grid gap-2 md:grid-cols-[220px_1fr_auto] md:items-center">
          <select
            value={selectedSessionId}
            onChange={(event) => setSelectedSessionId(event.target.value)}
            className="h-[34px] w-full rounded border-2 border-black px-2 text-xs font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="">Select Session</option>
            {[...sessions]
              .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())
              .map((session) => (
                <option key={session.id} value={session.id}>
                  {session.sessionNo} - {String(session.status || "").toLowerCase() === "open" ? "In Progress" : "Closed"}
                </option>
              ))}
          </select>
          <div className="relative w-full min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search session / reel / MRR / ERP / supplier"
              className="h-[34px] w-full rounded border-2 border-black pl-8 pr-2 text-xs font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          {searchTerm ? (
            <button type="button" onClick={() => setSearchTerm("")} className="h-[34px] rounded border border-black bg-white px-2 text-[11px] font-bold text-black hover:bg-slate-50">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-330px)] overflow-auto">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {["Session No", "Time", "Reel No", "MRR No", "ERP", "Supplier", "Book Stock", "Physical Stock", isShortage ? "Shortage" : "Excess", "Source"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="border-2 border-black px-6 py-10 text-center font-medium text-black">No {isShortage ? "shortage" : "excess"} stock found for this session.</td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="border-2 border-black px-3 py-3 text-sm font-black text-black">{row.sessionNo}</td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{formatDateTime(row.timestamp)}</td>
                    <td className="border-2 border-black px-3 py-3 text-sm font-bold text-black">{row.reelNo}</td>
                    <td className="border-2 border-black px-3 py-3 text-sm text-black">{row.mrrNo || "-"}</td>
                    <td className="border-2 border-black px-3 py-3 text-sm text-black">{row.erp || "-"}</td>
                    <td className="min-w-[180px] border-2 border-black px-3 py-3 text-sm text-black">{row.supplierName || "-"}</td>
                    <td className="border-2 border-black bg-slate-50 px-3 py-3 text-right text-sm font-bold text-black">{formatPhysicalQty(row.systemAvailableWeight)}</td>
                    <td className="border-2 border-black bg-blue-50 px-3 py-3 text-right text-sm font-bold text-blue-900">{formatPhysicalQty(row.physicalWeight)}</td>
                    <td className={`border-2 border-black px-3 py-3 text-right text-sm font-black ${isShortage ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
                      {formatPhysicalQty(Math.abs(row.variance))}
                    </td>
                    <td className="border-2 border-black px-3 py-3 text-sm text-black">{row.source === "unscanned" ? "Not Scanned" : "Scanned"}</td>
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

export function PhysicalStockExcessReport() {
  return <PhysicalStockVarianceReport mode="excess" />;
}

export function PhysicalStockShortageReport() {
  return <PhysicalStockVarianceReport mode="shortage" />;
}
