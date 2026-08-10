import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Keyboard, Save, Search, X } from "lucide-react";
import { useData } from "../hooks/useData";
import { buildReelStockRows } from "../lib/reelStock";
import { shouldBlockDuplicateReelScan } from "../lib/reelStockTakerDuplicate";
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

type ParsedQrPayload = {
  reelNo: string;
  weight: number | null;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatQty(value: number) {
  return round2(value).toFixed(2);
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB");
}

function parsePositiveWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const cleaned = value.trim();
    const match = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    return round2(num);
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return round2(num);
}

function parseQrPayload(rawValue: string): ParsedQrPayload {
  const text = String(rawValue || "").trim();
  if (!text) return { reelNo: "", weight: null };

  const reelKeys = ["reelNo", "reel", "ourReelNo", "reel_no", "reelno"];
  const weightKeys = ["weight", "physicalWeight", "availableWeight", "availableWeightKg", "wt", "kg"];

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const reelNo = String(
        reelKeys
          .map((key) => parsed?.[key])
          .find((v) => typeof v === "string" && String(v).trim()) || "",
      ).trim();
      const weight = parsePositiveWeight(
        weightKeys
          .map((key) => parsed?.[key])
          .find((v) => v !== undefined && v !== null && String(v).trim() !== ""),
      );
      if (reelNo) return { reelNo, weight };
    } catch {
      // Fallback to text parsing.
    }
  }

  const reelByLabel = text.match(/(?:reel\s*no|our\s*reel\s*no|reel_no|reelno)\s*[:=]\s*([^|,;\n]+)/i);
  const weightByLabel = text.match(/(?:weight|physical\s*weight|available\s*weight|wt|kg)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (reelByLabel?.[1]) {
    return {
      reelNo: reelByLabel[1].trim(),
      weight: parsePositiveWeight(weightByLabel?.[1]),
    };
  }

  const delimited = text.match(/^\s*([^|,;\n]+)\s*[|,;]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*kg)?\s*$/i);
  if (delimited?.[1]) {
    return {
      reelNo: delimited[1].trim(),
      weight: parsePositiveWeight(delimited[2]),
    };
  }

  const weightByKgSuffix = text.match(/([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  return {
    reelNo: text,
    weight: parsePositiveWeight(weightByKgSuffix?.[1]),
  };
}

async function postStockTakerLog(payload: StockTakerLog) {
  const token = window.localStorage.getItem("authToken") || "";
  const response = await fetch("/api/reel-stock-taker-logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Unable to save stock-taker entry.");
}

export function ReelStockTakerReport() {
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", [], { cacheToLocalStorage: false });
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [suppliers] = useData<Supplier>("suppliers", [], { cacheToLocalStorage: false });
  const [sessions] = useData<PhysicalStockSession>("physical_stock_sessions", [], { cacheToLocalStorage: false });
  const [logs, , , logsApi] = useData<StockTakerLog>("reel_stock_taker_logs", [], { cacheToLocalStorage: false });

  const [manualReelNo, setManualReelNo] = useState("");
  const [manualPhysicalWeight, setManualPhysicalWeight] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [manualEntryAvailable, setManualEntryAvailable] = useState(false);
  const [showManualFields, setShowManualFields] = useState(false);
  const [processedScan, setProcessedScan] = useState<StockTakerLog | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef("");
  const lastScannedAtRef = useRef(0);
  const autoOpenedSessionRef = useRef("");

  const activeSession = useMemo(
    () => sessions.find((session) => String(session.status || "").toLowerCase() === "open") || null,
    [sessions],
  );

  const availableRows = useMemo(() => {
    return buildReelStockRows({
      materials,
      materialIn,
      packingSlips,
      issueReelLines,
      returnReelLines,
      suppliers,
    }).filter((row) => row.availableWeight > 0);
  }, [issueReelLines, materialIn, materials, packingSlips, returnReelLines, suppliers]);

  const rowByReelNo = useMemo(() => {
    const map = new Map<string, (typeof availableRows)[number]>();
    availableRows.forEach((row) => {
      map.set(String(row.ourReelNo || "").trim().toLowerCase(), row);
    });
    return map;
  }, [availableRows]);

  const stopScanner = () => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const closeScanner = () => {
    stopScanner();
    setIsScannerOpen(false);
    lastScannedCodeRef.current = "";
    lastScannedAtRef.current = 0;
  };

  const saveScanEntry = async (args: { row?: (typeof availableRows)[number]; reelNo: string; physicalWeight: number }) => {
    if (!activeSession) {
      throw new Error("Start a physical stock session before scanning reels.");
    }

    const systemWeight = round2(args.row?.availableWeight || 0);
    const physicalWeight = round2(args.physicalWeight);
    const variance = round2(physicalWeight - systemWeight);

    const payload: StockTakerLog = {
      id: crypto.randomUUID(),
      sessionId: activeSession.id,
      sessionNo: activeSession.sessionNo,
      sessionName: activeSession.sessionName,
      timestamp: new Date().toISOString(),
      reelNo: args.row?.ourReelNo || args.reelNo,
      mrrNo: args.row?.mrrNo || "",
      erp: args.row?.erp || "",
      supplierName: args.row?.supplierName || "",
      systemAvailableWeight: systemWeight,
      physicalWeight,
      variance,
    };

    if (shouldBlockDuplicateReelScan(logs, payload.reelNo, activeSession.id)) {
      throw new Error(`Reel ${payload.reelNo} was already scanned in session ${activeSession.sessionNo}.`);
    }

    await postStockTakerLog(payload);
    await logsApi.refresh({ force: true });
    setProcessedScan(payload);
    setManualReelNo("");
    setManualPhysicalWeight("");
    setManualEntryAvailable(false);
    setShowManualFields(false);
    setScannerError("");
  };

  const handleScanValue = async (rawQrValue: string, source: "qr" | "manual") => {
    const parsed = parseQrPayload(rawQrValue);
    const reelNo = String(parsed.reelNo || "").trim();
    if (!reelNo) throw new Error("Reel number is required.");

    const row = rowByReelNo.get(reelNo.toLowerCase());
    if (parsed.weight === null && source === "manual") {
      throw new Error("Physical weight is required.");
    }

    await saveScanEntry({
      row,
      reelNo,
      physicalWeight: parsed.weight ?? 0,
    });
  };

  const handleOpenScanner = async () => {
    if (!activeSession) {
      closeScanner();
      setScannerError("Start a physical stock session before scanning reels.");
      setManualEntryAvailable(true);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      closeScanner();
      setScannerError("Camera access is not supported on this browser/device.");
      setManualEntryAvailable(true);
      return;
    }

    const BarcodeDetectorCtor = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      closeScanner();
      setScannerError("QR scanner is not supported on this browser.");
      setManualEntryAvailable(true);
      return;
    }

    stopScanner();
    setProcessedScan(null);
    setScannerError("");
    setManualEntryAvailable(false);
    setShowManualFields(false);
    setIsScannerOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });

      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const scanned = codes?.[0]?.rawValue;
          if (!scanned) return;

          const now = Date.now();
          if (scanned === lastScannedCodeRef.current && now - lastScannedAtRef.current < 1500) return;
          lastScannedCodeRef.current = scanned;
          lastScannedAtRef.current = now;

          try {
            await handleScanValue(scanned, "qr");
            closeScanner();
          } catch (error) {
            closeScanner();
            setScannerError(error instanceof Error ? error.message : "Unable to process scanned reel.");
            setManualEntryAvailable(true);
          }
        } catch {
          // Keep scanning if one frame fails to decode.
        }
      }, 350);
    } catch (error) {
      console.error(error);
      closeScanner();
      setScannerError("Unable to open camera. Please allow camera permission and try again.");
      setManualEntryAvailable(true);
    }
  };

  useEffect(() => {
    if (!activeSession?.id || autoOpenedSessionRef.current === activeSession.id) return;
    autoOpenedSessionRef.current = activeSession.id;
    void handleOpenScanner();
    return () => {
      stopScanner();
    };
    // Open once for the active session; live data continues through useData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id]);

  const handleManualSave = async () => {
    const physicalWeight = parsePositiveWeight(manualPhysicalWeight);
    if (physicalWeight === null) {
      alert("Please enter valid physical weight.");
      return;
    }

    try {
      await handleScanValue(JSON.stringify({ reelNo: manualReelNo, weight: physicalWeight }), "manual");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to save stock-taker entry.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Physical Stock Entry Scan</h2>
          <div className="mt-1 text-xs font-bold text-slate-700">
            Session: {activeSession ? `${activeSession.sessionNo} started ${formatDateTime(activeSession.startedAt)}` : "No active session"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void handleOpenScanner();
          }}
          disabled={!activeSession}
          className="inline-flex h-[38px] items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera size={16} />
          Scan QR
        </button>
      </div>

      {!activeSession ? (
        <div className="rounded border border-amber-600 bg-amber-50 p-3 text-sm font-bold text-amber-900">
          Start a physical stock session from Start / Close Session before scanning reels.
        </div>
      ) : null}

      {scannerError ? (
        <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
          {scannerError}
        </div>
      ) : null}

      {processedScan ? (
        <div className="rounded border-2 border-black bg-white p-4 shadow-sm">
          <div className="border-b border-black pb-3">
            <div className="text-[10px] font-black uppercase text-slate-600">Reel No</div>
            <div className="mt-1 text-2xl font-black text-black">{processedScan.reelNo}</div>
            <div className="mt-1 text-xs font-bold text-slate-700">Session {processedScan.sessionNo || activeSession?.sessionNo || "-"}</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded border border-black bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase text-slate-600">MRR</div>
              <div className="mt-1 text-sm font-bold text-black">{processedScan.mrrNo || "-"}</div>
            </div>
            <div className="rounded border border-black bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase text-slate-600">ERP</div>
              <div className="mt-1 text-sm font-bold text-black">{processedScan.erp || "-"}</div>
            </div>
            <div className="rounded border border-black bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase text-slate-600">Supplier</div>
              <div className="mt-1 text-sm font-bold text-black">{processedScan.supplierName || "-"}</div>
            </div>
            <div className="rounded border border-blue-700 bg-blue-50 p-3">
              <div className="text-[10px] font-black uppercase text-blue-700">Physical Weight</div>
              <div className="mt-1 text-lg font-black text-blue-900">{formatQty(processedScan.physicalWeight)} KG</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleOpenScanner();
            }}
            disabled={!activeSession}
            className="mt-4 inline-flex h-[42px] w-full items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera size={16} />
            Scan QR
          </button>
        </div>
      ) : (
        <div className="rounded border-2 border-black bg-white p-6 text-center shadow-sm">
          <Camera className="mx-auto text-slate-700" size={42} />
        </div>
      )}

      {manualEntryAvailable ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowManualFields((value) => !value)}
            className="inline-flex h-[38px] items-center gap-2 rounded border border-black bg-white px-3 text-sm font-bold text-black hover:bg-slate-50"
          >
            <Keyboard size={16} />
            Manual Entry
          </button>

          {showManualFields ? (
            <div className="rounded border border-black bg-white p-3">
              <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_auto] md:items-end">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={manualReelNo}
                    onChange={(e) => setManualReelNo(e.target.value)}
                    placeholder="Reel Number"
                    className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-black">Physical Weight</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualPhysicalWeight}
                    onChange={(e) => setManualPhysicalWeight(e.target.value)}
                    className="w-full rounded border-2 border-black px-3 py-2.5 text-sm font-semibold focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleManualSave}
                  disabled={!activeSession}
                  className="inline-flex h-[42px] items-center justify-center gap-2 rounded border border-indigo-700 bg-indigo-50 px-3 text-sm font-bold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={15} />
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isScannerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded border-2 border-black bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-black uppercase text-black">Scan Reel QR</div>
              <button
                type="button"
                onClick={closeScanner}
                className="inline-flex items-center justify-center rounded border border-black bg-white p-1.5 text-black hover:bg-slate-50"
                aria-label="Close scanner"
              >
                <X size={14} />
              </button>
            </div>
            <video ref={videoRef} className="h-[320px] w-full rounded border border-black object-cover" autoPlay muted playsInline />
          </div>
        </div>
      ) : null}
    </div>
  );
}
