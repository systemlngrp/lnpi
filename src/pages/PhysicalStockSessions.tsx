import { useMemo, useState } from "react";
import { Play, Square, RefreshCw, RotateCcw, Trash2, AlertTriangle, XCircle } from "lucide-react";
import { useData } from "../hooks/useData";
import type { PhysicalStockSession, StockTakerLog } from "../types";

type SessionModalAction = "close" | "restart" | "delete" | "message";

type SessionModalState = {
  action: SessionModalAction;
  session?: PhysicalStockSession;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "emerald" | "rose" | "slate";
} | null;

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB");
}

async function sessionRequest(endpoint: string, options?: { method?: "POST" | "DELETE"; body?: Record<string, unknown> }) {
  const token = window.localStorage.getItem("authToken") || "";
  const response = await fetch(endpoint, {
    method: options?.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options?.method === "DELETE" ? undefined : JSON.stringify(options?.body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Session action failed.");
  return data;
}

export function PhysicalStockSessions() {
  const [sessions, , , sessionsApi] = useData<PhysicalStockSession>("physical_stock_sessions", [], { cacheToLocalStorage: false });
  const [logs, , , logsApi] = useData<StockTakerLog>("reel_stock_taker_logs", [], { cacheToLocalStorage: false });
  const [busySessionId, setBusySessionId] = useState("");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<SessionModalState>(null);

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

  const refreshAll = async () => {
    await Promise.all([sessionsApi.refresh({ force: true }), logsApi.refresh({ force: true })]);
  };

  const showErrorModal = (error: unknown, fallback: string) => {
    setModal({
      action: "message",
      title: "Action Failed",
      message: error instanceof Error ? error.message : fallback,
      tone: "rose",
    });
  };

  const handleStartSession = async () => {
    setBusySessionId("new");
    setMessage("");
    try {
      const session = await sessionRequest("/api/physical-stock/start-session");
      setMessage(`Session ${session.sessionNo || ""} started.`);
      await refreshAll();
    } catch (error) {
      showErrorModal(error, "Unable to start session.");
    } finally {
      setBusySessionId("");
    }
  };

  const runCloseSession = async (session: PhysicalStockSession) => {
    setBusySessionId(session.id);
    setMessage("");
    try {
      await sessionRequest("/api/physical-stock/close-session", { body: { sessionId: session.id } });
      setMessage(`Session ${session.sessionNo} closed.`);
      setModal(null);
      await refreshAll();
    } catch (error) {
      showErrorModal(error, "Unable to close session.");
    } finally {
      setBusySessionId("");
    }
  };

  const runRestartSession = async (session: PhysicalStockSession) => {
    setBusySessionId(session.id);
    setMessage("");
    try {
      await sessionRequest("/api/physical-stock/restart-session", { body: { sessionId: session.id } });
      setMessage(`Session ${session.sessionNo} restarted.`);
      setModal(null);
      await refreshAll();
    } catch (error) {
      showErrorModal(error, "Unable to restart session.");
    } finally {
      setBusySessionId("");
    }
  };

  const runDeleteSession = async (session: PhysicalStockSession) => {
    setBusySessionId(session.id);
    setMessage("");
    try {
      await sessionRequest(`/api/physical-stock/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      setMessage(`Session ${session.sessionNo} deleted.`);
      setModal(null);
      await refreshAll();
    } catch (error) {
      showErrorModal(error, "Unable to delete session.");
    } finally {
      setBusySessionId("");
    }
  };

  const requestCloseSession = (session: PhysicalStockSession) => {
    setModal({
      action: "close",
      session,
      title: "Close Session",
      message: `Close physical stock session ${session.sessionNo}?`,
      confirmLabel: "Close",
      tone: "rose",
    });
  };

  const requestRestartSession = (session: PhysicalStockSession) => {
    setModal({
      action: "restart",
      session,
      title: "Restart Session",
      message: `Restart session ${session.sessionNo} and continue scanning in the same session? Existing scans will remain.`,
      confirmLabel: "Restart",
      tone: "emerald",
    });
  };

  const requestDeleteSession = (session: PhysicalStockSession) => {
    const scannedCount = scanCounts.get(session.id) || 0;
    setModal({
      action: "delete",
      session,
      title: "Delete Session",
      message: `Delete session ${session.sessionNo}? This will permanently delete ${scannedCount} scanned reel record${scannedCount === 1 ? "" : "s"} for this session.`,
      confirmLabel: "Delete",
      tone: "rose",
    });
  };

  const handleModalConfirm = () => {
    if (!modal || modal.action === "message") {
      setModal(null);
      return;
    }
    if (!modal.session) return;
    if (modal.action === "close") void runCloseSession(modal.session);
    if (modal.action === "restart") void runRestartSession(modal.session);
    if (modal.action === "delete") void runDeleteSession(modal.session);
  };

  const modalIsWorking = Boolean(modal?.session && busySessionId === modal.session.id);
  const modalButtonClass = modal?.tone === "emerald"
    ? "border-emerald-700 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
    : modal?.tone === "rose"
      ? "border-rose-700 bg-rose-50 text-rose-800 hover:bg-rose-100"
      : "border-black bg-white text-black hover:bg-slate-50";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Physical Stock Sessions</h2>
        <button
          type="button"
          onClick={refreshAll}
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
              onClick={() => requestCloseSession(activeSession)}
              disabled={Boolean(busySessionId)}
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
              <div className="mt-1 text-lg font-black text-black">Start a new session or restart a closed session before scanning.</div>
            </div>
            <button
              type="button"
              onClick={handleStartSession}
              disabled={Boolean(busySessionId)}
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
                {["Session No", "Status", "Started", "Closed", "Scanned Reels", "Started By", "Closed By", "Actions"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border-2 border-black px-6 py-10 text-center font-medium text-black">No physical stock sessions found.</td>
                </tr>
              ) : (
                sortedSessions.map((session) => {
                  const isOpen = String(session.status || "").toLowerCase() === "open";
                  const isBusy = Boolean(busySessionId) && busySessionId === session.id;
                  return (
                    <tr key={session.id} className={isOpen ? "bg-emerald-50" : "hover:bg-slate-50"}>
                      <td className="border-2 border-black px-3 py-3 text-sm font-black text-black">{session.sessionNo}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm font-bold text-black">{isOpen ? "In Progress" : "Closed"}</td>
                      <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{formatDateTime(session.startedAt)}</td>
                      <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{formatDateTime(session.closedAt)}</td>
                      <td className="border-2 border-black px-3 py-3 text-right text-sm font-bold text-black">{scanCounts.get(session.id) || 0}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm text-black">{session.startedBy || "-"}</td>
                      <td className="border-2 border-black px-3 py-3 text-sm text-black">{session.closedBy || "-"}</td>
                      <td className="border-2 border-black px-3 py-2 text-sm text-black">
                        <div className="flex flex-wrap items-center gap-2">
                          {isOpen ? (
                            <button
                              type="button"
                              onClick={() => requestCloseSession(session)}
                              disabled={Boolean(busySessionId)}
                              className="inline-flex h-[30px] items-center gap-1 rounded border border-rose-700 bg-rose-50 px-2 text-[11px] font-black uppercase text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Square size={12} />
                              Close
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => requestRestartSession(session)}
                              disabled={Boolean(busySessionId)}
                              className="inline-flex h-[30px] items-center gap-1 rounded border border-emerald-700 bg-emerald-50 px-2 text-[11px] font-black uppercase text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCcw size={12} />
                              Restart
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => requestDeleteSession(session)}
                            disabled={Boolean(busySessionId)}
                            className="inline-flex h-[30px] items-center gap-1 rounded border border-black bg-white px-2 text-[11px] font-black uppercase text-black hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                          {isBusy ? <span className="text-[11px] font-bold text-slate-600">Working...</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded border-2 border-black bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className={modal.tone === "rose" ? "mt-0.5 text-rose-700" : modal.tone === "emerald" ? "mt-0.5 text-emerald-700" : "mt-0.5 text-slate-700"}>
                {modal.action === "message" ? <XCircle size={22} /> : <AlertTriangle size={22} />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-black uppercase text-black">{modal.title}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{modal.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {modal.action !== "message" ? (
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  disabled={modalIsWorking}
                  className="inline-flex h-[36px] items-center justify-center rounded border border-black bg-white px-4 text-xs font-black uppercase text-black hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleModalConfirm}
                disabled={modalIsWorking}
                className={`inline-flex h-[36px] min-w-[88px] items-center justify-center rounded border px-4 text-xs font-black uppercase disabled:cursor-not-allowed disabled:opacity-50 ${modalButtonClass}`}
              >
                {modalIsWorking ? "Working..." : modal.confirmLabel || "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}