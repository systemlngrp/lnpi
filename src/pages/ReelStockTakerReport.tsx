import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Search, Scale, Trash2, X } from "lucide-react";
import { useData } from "../hooks/useData";
import { buildReelStockRows } from "../lib/reelStock";
import { shouldBlockDuplicateReelScan } from "../lib/reelStockTakerDuplicate";
import type {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
  Supplier,
} from "../types";

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

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatQty(value: number) {
  return round2(value).toFixed(2);
}

type ParsedQrPayload = {
  reelNo: string;
  weight: number | null;
};

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
      if (reelNo) {
        return { reelNo, weight };
      }
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

export function ReelStockTakerReport() {
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", [], { cacheToLocalStorage: false });
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [suppliers] = useData<Supplier>("suppliers", [], { cacheToLocalStorage: false });

  const [logs, setLogs] = useData<StockTakerLog>("reel_stock_taker_logs", []);
  const [scanValue, setScanValue] = useState("");
  const [physicalWeightInput, setPhysicalWeightInput] = useState("");
  const [matchedReelNo, setMatchedReelNo] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef("");
  const lastScannedAtRef = useRef(0);

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
      map.set(String(row.ourReelNo || "").trim(), row);
    });
    return map;
  }, [availableRows]);

  const matchedRow = useMemo(() => {
    return rowByReelNo.get(matchedReelNo);
  }, [matchedReelNo, rowByReelNo]);

  const stats = useMemo(() => {
    const total = logs.length;
    const matched = logs.filter((entry) => Math.abs(entry.variance) <= 0.5).length;
    const mismatch = total - matched;
    return { total, matched, mismatch };
  }, [logs]);

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

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const closeScanner = () => {
    stopScanner();
    setIsScannerOpen(false);
    setScannerError("");
    setScannerStatus("");
    lastScannedCodeRef.current = "";
    lastScannedAtRef.current = 0;
  };

  const saveScanEntry = async (row: (typeof availableRows)[number], physicalWeight: number) => {
    const systemWeight = round2(row.availableWeight);
    const variance = round2(physicalWeight - systemWeight);

    const payload: StockTakerLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      reelNo: row.ourReelNo,
      mrrNo: row.mrrNo,
      erp: row.erp,
      supplierName: row.supplierName,
      systemAvailableWeight: systemWeight,
      physicalWeight: round2(physicalWeight),
      variance,
    };

    const duplicateBlocked = shouldBlockDuplicateReelScan(logs, payload.reelNo, new Date());
    if (duplicateBlocked) {
      throw new Error(`Reel ${payload.reelNo} was already scanned recently. Please wait before scanning it again.`);
    }

    const nextLogs = [payload, ...logs];
    await setLogs(nextLogs);
    setPhysicalWeightInput("");
    setScanValue("");
    setMatchedReelNo("");
  };

  const applyScannedReel = async (rawQrValue: string, autoSave: boolean) => {
    const parsed = parseQrPayload(rawQrValue);
    const reelNo = String(parsed.reelNo || "").trim();
    if (!reelNo) return "";

    const row = rowByReelNo.get(reelNo);
    if (!row) {
      return "Reel not found in Reelwise Stock with Available > 0.";
    }

    setScanValue(reelNo);
    setMatchedReelNo(reelNo);

    if (parsed.weight !== null) {
      setPhysicalWeightInput(String(parsed.weight));
    }

    if (autoSave) {
      const physicalWeight = parsed.weight ?? Number(physicalWeightInput || 0);
      if (Number.isFinite(physicalWeight) && physicalWeight > 0) {
        try {
          await saveScanEntry(row, physicalWeight);
          return `Scanned ${reelNo}. Saved successfully (${formatQty(physicalWeight)} KG).`;
        } catch (error) {
          return error instanceof Error ? error.message : `Scanned ${reelNo}. Could not save record.`;
        }
      }
      return `Scanned ${reelNo}. Enter physical weight and click Compare & Save.`;
    }

    if (parsed.weight !== null) {
      return `Scanned ${reelNo}. Weight ${formatQty(parsed.weight)} KG captured from QR.`;
    }
    return `Scanned ${reelNo}. Reel fetched.`;
  };

  const handleScan = () => {
    void (async () => {
      const message = await applyScannedReel(scanValue, false);
      if (message && message.includes("not found")) {
        alert(message);
      }
    })();
  };

  const handleSave = async () => {
    if (!matchedRow) {
      alert("Please scan a valid reel QR first.");
      return;
    }
    const physicalWeight = Number(physicalWeightInput || 0);
    if (!Number.isFinite(physicalWeight) || physicalWeight <= 0) {
      alert("Please enter valid physical weight.");
      return;
    }

    try {
      await saveScanEntry(matchedRow, physicalWeight);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to save stock-taker entry.");
      return;
    }
  };

  const handleOpenScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Camera access is not supported on this browser/device.");
      return;
    }

    setIsScannerOpen(true);
    setScannerError("");
    setScannerStatus("Point camera at QR code...");

    const BarcodeDetectorCtor = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setScannerError("QR scanner is not supported on this browser. Please use Chrome on mobile or paste reel number manually.");
      return;
    }

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

          const reelNo = String(scanned || "").trim();
          const now = Date.now();
          // Prevent repeat-trigger from same QR across nearby frames.
          if (reelNo === lastScannedCodeRef.current && now - lastScannedAtRef.current < 1500) {
            return;
          }
          lastScannedCodeRef.current = reelNo;
          lastScannedAtRef.current = now;

          const message = await applyScannedReel(reelNo, true);
          if (message) {
            setScannerStatus(message);
          }
        } catch {
          // Keep scanning if one frame fails to decode.
        }
      }, 350);
    } catch (error) {
      console.error(error);
      setScannerError("Unable to open camera. Please allow camera permission and try again.");
      stopScanner();
    }
  };

  const clearLogs = async () => {
    const confirmed = window.confirm("Clear all stock taker records?");
    if (!confirmed) return;
    await setLogs(() => []);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-black pb-3">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Reel Stock Taker</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-blue-300 bg-blue-50 p-4">
          <div className="text-xs font-black uppercase text-blue-700">Total Scans</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{stats.total}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">{"Matched (<= 0.50 KG)"}</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{stats.matched}</div>
        </div>
        <div className="rounded border border-rose-300 bg-rose-50 p-4">
          <div className="text-xs font-black uppercase text-rose-700">Mismatch</div>
          <div className="mt-1 text-2xl font-black text-rose-900">{stats.mismatch}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_auto_auto] items-end">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan();
                }
              }}
              placeholder="Scan reel QR here (reel number)"
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs font-black uppercase text-black mb-1">Physical Weight (KG)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={physicalWeightInput}
              onChange={(e) => setPhysicalWeightInput(e.target.value)}
              className="w-full rounded border-2 border-black px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>

          <button
            type="button"
            onClick={handleScan}
            className="h-[42px] rounded border border-black bg-white px-3 text-sm font-bold text-black hover:bg-slate-50"
          >
            Fetch Reel
          </button>

          <button
            type="button"
            onClick={() => {
              void handleOpenScanner();
            }}
            className="inline-flex h-[42px] items-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Camera size={15} />
            Open QR Scan
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="inline-flex h-[42px] items-center gap-2 rounded border border-indigo-700 bg-indigo-50 px-3 text-sm font-bold text-indigo-800 hover:bg-indigo-100"
          >
            <Scale size={15} />
            Compare & Save
          </button>
        </div>

        {matchedRow ? (
          <div className="rounded border border-emerald-500 bg-emerald-50 p-3 text-sm">
            <div className="font-black text-emerald-900">Scanned Reel: {matchedRow.ourReelNo}</div>
            <div className="mt-1 text-black">MRR: {matchedRow.mrrNo} | ERP: {matchedRow.erp} | Supplier: {matchedRow.supplierName || "-"}</div>
            <div className="mt-1 text-black font-bold">System Available Weight: {formatQty(matchedRow.availableWeight)} KG</div>
          </div>
        ) : null}
      </div>

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

            {scannerError ? (
              <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
                {scannerError}
              </div>
            ) : (
              <>
                <video ref={videoRef} className="h-[320px] w-full rounded border border-black object-cover" autoPlay muted playsInline />
                <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs font-bold text-emerald-800">
                  {scannerStatus || "Point camera at QR code..."}
                </div>
                <div className="mt-2 text-xs font-semibold text-slate-700">
                  Scanner stays open after each scan. QR can contain reel only or reel + weight.
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded shadow-sm border-2 border-black overflow-hidden">
        <div className="flex items-center justify-between border-b-2 border-black px-3 py-2.5">
          <h3 className="text-sm font-black uppercase text-black">Stock Taker Log</h3>
          <button
            type="button"
            onClick={clearLogs}
            className="inline-flex items-center gap-1.5 rounded border border-rose-700 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100"
          >
            <Trash2 size={13} />
            Clear Log
          </button>
        </div>

        <div className="max-h-[calc(100vh-320px)] w-full overflow-auto">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {[
                  "Time",
                  "Reel No",
                  "MRR No",
                  "ERP",
                  "Supplier",
                  "System Weight",
                  "Physical Weight",
                  "Variance",
                  "Status",
                ].map((heading) => (
                  <th key={heading} className="bg-indigo-700 px-3 py-3 text-left text-xs font-black border-2 border-black whitespace-nowrap uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                    No stock taker scans yet.
                  </td>
                </tr>
              ) : (
                logs.map((entry) => {
                  const isMatch = Math.abs(entry.variance) <= 0.5;
                  return (
                    <tr key={entry.id} className={isMatch ? "hover:bg-emerald-50/40" : "bg-rose-50/50 hover:bg-rose-50"}>
                      <td className="px-3 py-3 text-black text-sm border-2 border-black whitespace-nowrap">{new Date(entry.timestamp).toLocaleString("en-GB")}</td>
                      <td className="px-3 py-3 text-black text-sm font-bold border-2 border-black">{entry.reelNo}</td>
                      <td className="px-3 py-3 text-black text-sm border-2 border-black">{entry.mrrNo}</td>
                      <td className="px-3 py-3 text-black text-sm border-2 border-black">{entry.erp}</td>
                      <td className="px-3 py-3 text-black text-sm border-2 border-black min-w-[180px]">{entry.supplierName || "-"}</td>
                      <td className="px-3 py-3 text-emerald-900 text-sm font-bold border-2 border-black bg-emerald-50 text-right">{formatQty(entry.systemAvailableWeight)}</td>
                      <td className="px-3 py-3 text-blue-900 text-sm font-bold border-2 border-black bg-blue-50 text-right">{formatQty(entry.physicalWeight)}</td>
                      <td className={`px-3 py-3 text-sm font-bold border-2 border-black text-right ${entry.variance >= 0 ? "text-amber-900 bg-amber-50" : "text-red-800 bg-red-50"}`}>
                        {formatQty(entry.variance)}
                      </td>
                      <td className={`px-3 py-3 text-xs font-black border-2 border-black uppercase ${isMatch ? "text-emerald-800 bg-emerald-50" : "text-rose-800 bg-rose-50"}`}>
                        {isMatch ? "Matched" : "Mismatch"}
                      </td>
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
