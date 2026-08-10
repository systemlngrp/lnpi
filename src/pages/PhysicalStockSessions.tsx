import { useMemo, useState } from "react";
import { Play, Square, RefreshCw } from "lucide-react";
import { useData } from "../hooks/useData";
import type { PhysicalStockSession, StockTakerLog } from "../types";

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB");
}

async function postSessionAction(endpoint: string, body?: Record<string, unknown>) {
  const token = window.localStorage.getItem("authToken") || "";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Session action failed.");
  return data;
}

export function PhysicalStockSessions() {
  const [sessions, , , sessionsApi] = useData<PhysicalStockSession>("physical_stock_sessions", [], { cacheToLocalStorage: false });
  const [logs] = useData<StockTakerLog>("reel_stock_taker_logs", [], { cacheToLocalStorage: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const activeSession = useMemo(
    () => sessions.find((session) => String(session.status || "").toLowerCase() === "open") || null,
    [sessions],
  );

  const scanCounts = useMemo(() => {
    const counts = new Map<string, number>();
    logs.forEach((log) => {
      const sessionId = String(log.sessionId || "").trim();
      if (!sessionId) return;
      counts.set(sessionId, (counts.get(sessionId) || 0) + 1);
    });
    return counts;
  }, [logs]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()),
    [sessions],
  );

  const refreshSessions = async () => {
    await sessionsApi.refresh({ force: true });
  };

  const handleStartSession = async () => {
    setBusy(true);
    setMessage("");
    try {
      const session = await postSessionAction("/api/physical-stock/start-session");
      setMessage(`Session ${session.sessionNo || ""} started.`);
      await refreshSessions();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to start session.");
    } finally {
      setBusy(false);
    }
  };

  const handleCloseSession = async () => {
    if (!activeSession) return;
    const confirmed = window.confirm(`Close physical stock session ${activeSession.sessionNo}?`);
    if (!confirmed) return;

    setBusy(true);
    setMessage("");
    try {
      await postSessionAction("/api/physical-stock/close-session", { sessionId: activeSession.id });
      setMessage(`Session ${activeSession.sessionNo} closed.`);
      await refreshSessions();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to close session.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Physical Stock Sessions</h2>
        <button
          type="button"
          onClick={refreshSessions}
          className="inline-flex h-[38px] items-center justify-center gap-2 rounded border border-black bg-white px-3 text-xs font-black uppercase text-black hover:bg-slate-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {message ? <div className="rounded border border-emerald-700 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{message}</div> : null}

      <div className="rounded border-2 border-black bg-white p-4 shadow-sm">
        {activeSession ? (
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="text-[10px] font-black uppercase text-emerald-700">Session In Progress</div>
              <div className="mt-1 text-2xl font-black text-black">{activeSession.sessionNo}</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">Started: {formatDateTime(activeSession.startedAt)}</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">Scanned reels: {scanCounts.get(activeSession.id) || 0}</div>
            </div>
            <button
              type="button"
              onClick={handleCloseSession}
              disabled={busy}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded border border-rose-700 bg-rose-50 px-4 text-sm font-black uppercase text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Square size={15} />
              Close Session
            </button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="text-[10px] font-black uppercase text-slate-600">No Active Session</div>
              <div className="mt-1 text-lg font-black text-black">Start a session before physical stock scanning begins.</div>
            </div>
            <button
              type="button"
              onClick={handleStartSession}
              disabled={busy}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-4 text-sm font-black uppercase text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={15} />
              Start Session
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-310px)] overflow-auto">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {["Session No", "Status", "Started", "Closed", "Scanned Reels", "Started By", "Closed By"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-2 border-black px-6 py-10 text-center font-medium text-black">No physical stock sessions found.</td>
                </tr>
              ) : (
                sortedSessions.map((session) => {
                  const isOpen = String(session.status || "").toLowerCase() === "open";
                  return (
                    <tr key={session.id} className={isOpen ? "bg-emerald-50" : "hover:bg-slate-50"}>
                      <td className="border-2 border-black px-3 py-3 text-sm font-black text-black">{session.sessionNo}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm font-bold text-black">{isOpen ? "In Progress" : "Closed"}</td>
                      <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{formatDateTime(session.startedAt)}</td>
                      <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{formatDateTime(session.closedAt)}</td>
                      <td className="border-2 border-black px-3 py-3 text-right text-sm font-bold text-black">{scanCounts.get(session.id) || 0}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm text-black">{session.startedBy || "-"}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm text-black">{session.closedBy || "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
