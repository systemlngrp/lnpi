import type { PhysicalStockSession, StockTakerLog } from "../types";
import type { ReelStockCalculationRow } from "./reelStock";

export type PhysicalStockVarianceRow = {
  id: string;
  sessionId: string;
  sessionNo: string;
  sessionName: string;
  timestamp: string;
  reelNo: string;
  mrrNo: string;
  erp: string;
  supplierName: string;
  systemAvailableWeight: number;
  physicalWeight: number;
  variance: number;
  source: "scanned" | "unscanned";
};

export function roundPhysicalQty(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

export function formatPhysicalQty(value: number) {
  return roundPhysicalQty(value).toFixed(2);
}

export function getDefaultPhysicalStockSessionId(sessions: PhysicalStockSession[]) {
  const sorted = [...sessions].sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
  return sorted.find((session) => String(session.status || "").toLowerCase() === "open")?.id || sorted[0]?.id || "";
}

function normalizeReelNo(value: string) {
  return String(value || "").trim().toLowerCase();
}

function toScannedRow(log: StockTakerLog, session: PhysicalStockSession): PhysicalStockVarianceRow {
  const systemAvailableWeight = roundPhysicalQty(Number(log.systemAvailableWeight || 0));
  const physicalWeight = roundPhysicalQty(Number(log.physicalWeight || 0));
  return {
    id: log.id,
    sessionId: session.id,
    sessionNo: log.sessionNo || session.sessionNo,
    sessionName: log.sessionName || session.sessionName,
    timestamp: log.timestamp,
    reelNo: log.reelNo,
    mrrNo: log.mrrNo || "",
    erp: log.erp || "",
    supplierName: log.supplierName || "",
    systemAvailableWeight,
    physicalWeight,
    variance: roundPhysicalQty(physicalWeight - systemAvailableWeight),
    source: "scanned",
  };
}

export function buildPhysicalStockExcessRows(args: {
  sessions: PhysicalStockSession[];
  logs: StockTakerLog[];
  selectedSessionId: string;
}) {
  const session = args.sessions.find((entry) => entry.id === args.selectedSessionId);
  if (!session) return [];

  return args.logs
    .filter((log) => log.sessionId === session.id)
    .map((log) => toScannedRow(log, session))
    .filter((row) => row.physicalWeight > row.systemAvailableWeight)
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance) || String(a.reelNo).localeCompare(String(b.reelNo)));
}

export function buildPhysicalStockShortageRows(args: {
  sessions: PhysicalStockSession[];
  logs: StockTakerLog[];
  stockRows: ReelStockCalculationRow[];
  selectedSessionId: string;
}) {
  const session = args.sessions.find((entry) => entry.id === args.selectedSessionId);
  if (!session) return [];

  const scannedRows = args.logs
    .filter((log) => log.sessionId === session.id)
    .map((log) => toScannedRow(log, session));

  const scannedReelNos = new Set(scannedRows.map((row) => normalizeReelNo(row.reelNo)).filter(Boolean));
  const shortageRows = scannedRows.filter((row) => row.systemAvailableWeight > row.physicalWeight);

  if (String(session.status || "").toLowerCase() === "closed") {
    args.stockRows
      .filter((row) => Number(row.availableWeight || 0) > 0 && !scannedReelNos.has(normalizeReelNo(row.ourReelNo)))
      .forEach((row) => {
        const systemAvailableWeight = roundPhysicalQty(Number(row.availableWeight || 0));
        shortageRows.push({
          id: `unscanned-${session.id}-${row.slipId}`,
          sessionId: session.id,
          sessionNo: session.sessionNo,
          sessionName: session.sessionName,
          timestamp: session.closedAt || session.startedAt,
          reelNo: row.ourReelNo,
          mrrNo: row.mrrNo || "",
          erp: row.erp || "",
          supplierName: row.supplierName || "",
          systemAvailableWeight,
          physicalWeight: 0,
          variance: roundPhysicalQty(-systemAvailableWeight),
          source: "unscanned",
        });
      });
  }

  return shortageRows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance) || String(a.reelNo).localeCompare(String(b.reelNo)));
}
