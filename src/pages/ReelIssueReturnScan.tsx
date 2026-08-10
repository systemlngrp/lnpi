import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Save, X } from "lucide-react";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { useData } from "../hooks/useData";
import { generateTransactionNo } from "../lib/serial";
import { getAvailableReelPackingSlips } from "../lib/materialMovement";
import {
  buildProductionCorrugatedSheetUsageMap,
  buildProductionMaterialUsageMap,
  syncProductionWorkflowFromUsage,
} from "../lib/productionMaterialUsage";
import type {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Production,
} from "../types";

type ParsedQrPayload = {
  reelNo: string;
  weight: number | null;
};

type ReelDraft = {
  id: string;
  materialId: string;
  packingSlipId: string;
  ourReelNo: string;
  issueWeight: number;
  returnQty: string;
  jobNo: string;
  materialName: string;
  materialCode: string;
  qrWeight: number | null;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatQty(value: number) {
  return round2(value).toFixed(2);
}

function normalizeText(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function parsePositiveWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const match = value.trim().match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) && num > 0 ? round2(num) : null;
  }
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? round2(num) : null;
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
        reelKeys.map((key) => parsed?.[key]).find((value) => typeof value === "string" && String(value).trim()) || ""
      ).trim();
      const weight = parsePositiveWeight(
        weightKeys.map((key) => parsed?.[key]).find((value) => value !== undefined && value !== null && String(value).trim() !== "")
      );
      if (reelNo) return { reelNo, weight };
    } catch {
      // Fall through to loose text parsing.
    }
  }

  const reelByLabel = text.match(/(?:reel\s*no|our\s*reel\s*no|reel_no|reelno)\s*[:=]\s*([^|,;\n]+)/i);
  const weightByLabel = text.match(/(?:weight|physical\s*weight|available\s*weight|wt|kg)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (reelByLabel?.[1]) {
    return { reelNo: reelByLabel[1].trim(), weight: parsePositiveWeight(weightByLabel?.[1]) };
  }

  const delimited = text.match(/^\s*([^|,;\n]+)\s*[|,;]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*kg)?\s*$/i);
  if (delimited?.[1]) {
    return { reelNo: delimited[1].trim(), weight: parsePositiveWeight(delimited[2]) };
  }

  const weightByKgSuffix = text.match(/([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  return { reelNo: text, weight: parsePositiveWeight(weightByKgSuffix?.[1]) };
}

export function ReelIssueReturnScan() {
  const [materials] = useData<Material>("materials", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions, setProductions] = useData<Production>("productions", []);
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines, setMaterialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines, setMaterialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns, setMaterialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines, setMaterialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines, setMaterialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

  const [date] = useState(() => new Date().toISOString().split("T")[0]);
  const [productionId, setProductionId] = useState("");
  const [scannerError, setScannerError] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reelDrafts, setReelDrafts] = useState<ReelDraft[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef("");
  const lastScannedAtRef = useRef(0);

  const selectedProduction = productions.find((production) => production.id === productionId) || null;

  const jobOptions = useMemo(
    () =>
      productions
        .filter((production) => production.status !== "Cancelled")
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .map((production) => ({
          value: production.id,
          label: `${production.transactionNo}${production.date ? ` | ${production.date.split("T")[0]}` : ""}`,
        })),
    [productions]
  );

  const slipByReelNo = useMemo(() => {
    const map = new Map<string, MaterialInPackingSlip>();
    packingSlips.forEach((slip) => {
      const key = normalizeText(slip.ourReelNo);
      if (key) map.set(key, slip);
    });
    return map;
  }, [packingSlips]);

  const materialById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);

  const getReelInvoiceRate = (slipId: string): number => {
    const slip = packingSlips.find((row) => row.id === slipId);
    if (!slip) return 0;
    const mrr = materialIn.find((row) => row.id === slip.materialInId);
    if (!mrr) return 0;
    const line = mrr.lines.find((row) => row.id === slip.materialLineId);
    const material = materials.find((row) => row.id === slip.materialId);
    return Number(line?.invoiceRate || line?.poRate || line?.rate || material?.openingRate || 0);
  };

  const syncWorkflow = async (args: {
    issues: MaterialIssue[];
    issueLines: MaterialIssueLine[];
    returns: MaterialReturn[];
    returnLines: MaterialReturnLine[];
    issueReelLines: MaterialIssueReelLine[];
    returnReelLines: MaterialReturnReelLine[];
    timestamp: string;
  }) => {
    if (!productionId) return;
    const usageMap = buildProductionMaterialUsageMap(
      args.issues,
      args.issueLines,
      args.returns,
      args.returnLines,
      args.issueReelLines,
      args.returnReelLines
    );
    const corrugatedSheetUsageMap = buildProductionCorrugatedSheetUsageMap(
      materials,
      args.issues,
      args.issueLines,
      args.returns,
      args.returnLines
    );
    const netUsage = usageMap.get(productionId) || 0;
    const hasCorrugatedSheetUsage = Number(corrugatedSheetUsageMap.get(productionId) || 0) > 0;
    await setProductions((prev) =>
      prev.map((production) =>
        production.id === productionId
          ? syncProductionWorkflowFromUsage(production, netUsage, args.timestamp, hasCorrugatedSheetUsage)
          : production
      )
    );
  };

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

  useEffect(() => stopScanner, []);

  const addDraftFromQr = async (rawQrValue: string) => {
    if (!date || !productionId || !selectedProduction) throw new Error("Select date and job before scanning.");

    const parsed = parseQrPayload(rawQrValue);
    const reelNo = String(parsed.reelNo || "").trim();
    if (!reelNo) throw new Error("Reel number is required in QR.");

    const originalSlip = slipByReelNo.get(normalizeText(reelNo));
    if (!originalSlip) throw new Error(`Reel ${reelNo} was not found in reel stock.`);

    if (reelDrafts.some((draft) => draft.packingSlipId === originalSlip.id)) {
      throw new Error(`Reel ${originalSlip.ourReelNo} is already added in this submit draft.`);
    }

    const availableSlip = getAvailableReelPackingSlips(
      originalSlip.materialId,
      packingSlips,
      materialIssueReelLines,
      materialReturnReelLines
    ).find((slip) => slip.id === originalSlip.id);

    if (!availableSlip || Number(availableSlip.weightKg || 0) <= 0) {
      throw new Error(`Reel ${originalSlip.ourReelNo} is not available for issue.`);
    }

    const material = materialById.get(originalSlip.materialId);
    const issueWeight = round2(Number(availableSlip.weightKg || 0));
    const draft: ReelDraft = {
      id: crypto.randomUUID(),
      materialId: originalSlip.materialId,
      packingSlipId: originalSlip.id,
      ourReelNo: originalSlip.ourReelNo,
      issueWeight,
      returnQty: "0",
      jobNo: selectedProduction.transactionNo || "",
      materialName: material?.name || "-",
      materialCode: String(material?.erpCode || ""),
      qrWeight: parsed.weight,
    };

    setReelDrafts((prev) => [draft, ...prev]);
    setScannerError("");
  };

  const handleOpenScanner = async () => {
    if (!productionId) {
      setScannerError("Select job before scanning.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError("Camera access is not supported on this browser/device.");
      return;
    }
    const BarcodeDetectorCtor = (window as Window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
      };
    }).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setScannerError("QR scanner is not supported on this browser.");
      return;
    }

    stopScanner();
    setScannerError("");
    setIsScannerOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });
      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || isProcessingScan) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const scanned = codes?.[0]?.rawValue;
          if (!scanned) return;
          const now = Date.now();
          if (scanned === lastScannedCodeRef.current && now - lastScannedAtRef.current < 1500) return;
          lastScannedCodeRef.current = scanned;
          lastScannedAtRef.current = now;

          setIsProcessingScan(true);
          try {
            await addDraftFromQr(scanned);
            closeScanner();
          } catch (error) {
            closeScanner();
            setScannerError(error instanceof Error ? error.message : "Unable to process scanned reel.");
          } finally {
            setIsProcessingScan(false);
          }
        } catch {
          // Continue scanning after frame decode errors.
        }
      }, 350);
    } catch (error) {
      console.error(error);
      closeScanner();
      setScannerError("Unable to open camera. Please allow camera permission and try again.");
    }
  };

  const updateReturnQty = (draftId: string, value: string) => {
    const cleaned = String(value || "").replace(/[^0-9.]/g, "");
    setReelDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== draftId) return draft;
        const maxQty = Number(draft.issueWeight || 0);
        const numeric = Number(cleaned || 0);
        const nextValue = cleaned === "" ? "" : String(Math.min(Math.max(Number.isFinite(numeric) ? numeric : 0, 0), maxQty));
        return { ...draft, returnQty: nextValue };
      })
    );
  };

  const removeDraft = (draftId: string) => {
    setReelDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
  };

  const handleSubmit = async () => {
    if (!date || !productionId || !selectedProduction) {
      alert("Select date and job before submit.");
      return;
    }
    if (reelDrafts.length === 0) {
      alert("Scan at least one reel before submit.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const issueId = crypto.randomUUID();
      const issueNo = generateTransactionNo(
        "MIS",
        materialIssues.map((row) => ({ transactionNo: row.issueNo, date: row.date })),
        date
      );
      const issue: MaterialIssue = {
        id: issueId,
        issueNo,
        date,
        issueType: "Job",
        productionId,
        jobNo: selectedProduction.transactionNo || "",
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const createdIssueLines: MaterialIssueLine[] = [];
      const createdIssueReelLines: MaterialIssueReelLine[] = [];
      const draftsByMaterial = new Map<string, ReelDraft[]>();
      reelDrafts.forEach((draft) => {
        draftsByMaterial.set(draft.materialId, [...(draftsByMaterial.get(draft.materialId) || []), draft]);
      });

      draftsByMaterial.forEach((drafts, materialId) => {
        const issueLineId = crypto.randomUUID();
        const material = materialById.get(materialId);
        const totalWeight = round2(drafts.reduce((sum, draft) => sum + Number(draft.issueWeight || 0), 0));
        const totalValue = drafts.reduce((sum, draft) => sum + Number(draft.issueWeight || 0) * getReelInvoiceRate(draft.packingSlipId), 0);
        const savedAmount = round2(totalValue);
        const savedRate = totalWeight > 0 ? round2(savedAmount / totalWeight) : 0;

        createdIssueLines.push({
          id: issueLineId,
          materialIssueId: issueId,
          materialId,
          qty: totalWeight,
          uom: "KG",
          lastPurchaseRate: savedRate,
          openingRate: Number(Number(material?.openingRate || 0).toFixed(2)),
          rate: savedRate,
          amount: savedAmount,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        });

        drafts.forEach((draft) => {
          createdIssueReelLines.push({
            id: crypto.randomUUID(),
            materialIssueId: issueId,
            materialIssueLineId: issueLineId,
            materialId,
            packingSlipId: draft.packingSlipId,
            ourReelNo: draft.ourReelNo,
            weightKg: round2(draft.issueWeight),
            productionId,
            jobNo: selectedProduction.transactionNo || "",
            updatedBy: "System User",
            updateTimestamp: timestamp,
          });
        });
      });

      const positiveReturnDrafts = reelDrafts.filter((draft) => Number(draft.returnQty || 0) > 0);
      const createdReturnLines: MaterialReturnLine[] = [];
      const createdReturnReelLines: MaterialReturnReelLine[] = [];
      let returnEntry: MaterialReturn | null = null;

      if (positiveReturnDrafts.length > 0) {
        const returnId = crypto.randomUUID();
        const returnNo = generateTransactionNo(
          "MR",
          materialReturns.map((row) => ({ transactionNo: row.returnNo, date: row.date })),
          date
        );
        returnEntry = {
          id: returnId,
          returnNo,
          date,
          returnType: "Job",
          productionId,
          jobNo: selectedProduction.transactionNo || "",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };

        const returnDraftsByMaterial = new Map<string, ReelDraft[]>();
        positiveReturnDrafts.forEach((draft) => {
          returnDraftsByMaterial.set(draft.materialId, [...(returnDraftsByMaterial.get(draft.materialId) || []), draft]);
        });

        returnDraftsByMaterial.forEach((drafts, materialId) => {
          const returnLineId = crypto.randomUUID();
          const material = materialById.get(materialId);
          const validDrafts = drafts.flatMap((draft) => {
            const qty = round2(Math.min(Math.max(Number(draft.returnQty || 0), 0), Number(draft.issueWeight || 0)));
            return qty > 0 ? [{ draft, qty }] : [];
          });
          if (validDrafts.length === 0) return;

          const totalWeight = round2(validDrafts.reduce((sum, row) => sum + row.qty, 0));
          const totalValue = validDrafts.reduce((sum, row) => sum + row.qty * getReelInvoiceRate(row.draft.packingSlipId), 0);
          const savedAmount = round2(totalValue);
          const savedRate = totalWeight > 0 ? round2(savedAmount / totalWeight) : 0;

          createdReturnLines.push({
            id: returnLineId,
            materialReturnId: returnId,
            materialId,
            qty: totalWeight,
            uom: "KG",
            lastPurchaseRate: savedRate,
            openingRate: Number(Number(material?.openingRate || 0).toFixed(2)),
            rate: savedRate,
            amount: savedAmount,
            updatedBy: "System User",
            updateTimestamp: timestamp,
          });

          validDrafts.forEach(({ draft, qty }) => {
            createdReturnReelLines.push({
              id: crypto.randomUUID(),
              materialReturnId: returnId,
              materialReturnLineId: returnLineId,
              materialId,
              packingSlipId: draft.packingSlipId,
              ourReelNo: draft.ourReelNo,
              weightKg: qty,
              productionId,
              jobNo: selectedProduction.transactionNo || "",
              updatedBy: "System User",
              updateTimestamp: timestamp,
            });
          });
        });
      }

      const nextIssues = [issue, ...materialIssues];
      const nextIssueLines = [...materialIssueLines, ...createdIssueLines];
      const nextIssueReelLines = [...materialIssueReelLines, ...createdIssueReelLines];
      const nextReturns = returnEntry ? [returnEntry, ...materialReturns] : materialReturns;
      const nextReturnLines = returnEntry ? [...materialReturnLines, ...createdReturnLines] : materialReturnLines;
      const nextReturnReelLines = returnEntry ? [...materialReturnReelLines, ...createdReturnReelLines] : materialReturnReelLines;

      await setMaterialIssues(nextIssues);
      await setMaterialIssueLines(nextIssueLines);
      await setMaterialIssueReelLines(nextIssueReelLines);
      if (returnEntry) {
        await setMaterialReturns(nextReturns);
        await setMaterialReturnLines(nextReturnLines);
        if (createdReturnReelLines.length > 0) await setMaterialReturnReelLines(nextReturnReelLines);
      }
      await syncWorkflow({
        issues: nextIssues,
        issueLines: nextIssueLines,
        returns: nextReturns,
        returnLines: nextReturnLines,
        issueReelLines: nextIssueReelLines,
        returnReelLines: nextReturnReelLines,
        timestamp,
      });

      setReelDrafts([]);
      alert(returnEntry ? `Saved ${issueNo} and ${returnEntry.returnNo}.` : `Saved ${issueNo}.`);
    } catch (error) {
      console.error("Failed to submit reel issue/return scan:", error);
      alert("Failed to submit reel issue/return scan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalIssueDraftWeight = reelDrafts.reduce((sum, draft) => sum + Number(draft.issueWeight || 0), 0);
  const totalReturnDraftWeight = reelDrafts.reduce((sum, draft) => sum + Number(draft.returnQty || 0), 0);

  return (
    <div className="space-y-5">
      <div className="border-b border-black pb-3">
        <h2 className="text-xl font-bold uppercase tracking-tight text-black">Reel Issue/Return QR Scan</h2>
      </div>

      <div className="rounded border-2 border-black bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase text-black">Job No.</label>
            <Select options={jobOptions} value={productionId} onChange={setProductionId} placeholder="Select Job..." />
          </div>
          {productionId ? (
            <button
              type="button"
              onClick={() => void handleOpenScanner()}
              disabled={isProcessingScan || isSubmitting}
              className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
            >
              <Camera size={16} />
              Scan QR
            </button>
          ) : null}
        </div>
      </div>
      {scannerError ? <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800">{scannerError}</div> : null}

      <div className="rounded border-2 border-black bg-white p-4 shadow-sm">
        <div>
          <h3 className="text-lg font-black uppercase text-black">Scanned Reels</h3>
        </div>

        <div className="mt-4 space-y-3 md:hidden">
          {reelDrafts.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm font-semibold text-slate-500">
              No scanned reels in draft yet.
            </div>
          ) : (
            reelDrafts.map((draft) => (
              <div key={draft.id} className="rounded border-2 border-black bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-black pb-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase text-slate-500">Reel No</div>
                    <div className="break-words text-xl font-black text-black">{draft.ourReelNo}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDraft(draft.id)}
                    className="shrink-0 rounded border border-rose-700 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                  <MobileField label="Job No" value={draft.jobNo || "-"} />
                  <MobileField label="Material" value={draft.materialName} />
                  <MobileField label="ERP/Code" value={draft.materialCode || "-"} />
                  <MobileField label="Issue Weight" value={`${formatQty(draft.issueWeight)} KG`} accent />
                  <div className="rounded border border-slate-300 bg-slate-50 p-2">
                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">Return Qty KG</label>
                    <input
                      type="number"
                      min="0"
                      max={draft.issueWeight}
                      step="0.01"
                      value={draft.returnQty}
                      onChange={(event) => updateReturnQty(draft.id, event.target.value)}
                      className="h-10 w-full rounded border border-black px-2 text-right text-base font-black focus:border-indigo-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 hidden rounded border border-black md:block">
          <table className="min-w-full table-fixed border-collapse text-sm">
            <thead className="bg-slate-900 text-white">
              <tr>
                {["Reel No", "Job No", "Material", "ERP/Code", "Issue Weight", "Return Qty KG", "Action"].map((heading) => (
                  <th key={heading} className="border border-black px-3 py-2 text-left text-[11px] font-black uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reelDrafts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border border-black px-3 py-8 text-center font-semibold text-slate-500">
                    No scanned reels in draft yet.
                  </td>
                </tr>
              ) : (
                reelDrafts.map((draft) => (
                  <tr key={draft.id} className="odd:bg-white even:bg-slate-50">
                    <td className="break-words border border-black px-3 py-2 font-black text-black">{draft.ourReelNo}</td>
                    <td className="break-words border border-black px-3 py-2 font-semibold">{draft.jobNo || "-"}</td>
                    <td className="break-words border border-black px-3 py-2 font-semibold">{draft.materialName}</td>
                    <td className="break-words border border-black px-3 py-2 font-semibold">{draft.materialCode || "-"}</td>
                    <td className="border border-black px-3 py-2 font-black text-emerald-700">{formatQty(draft.issueWeight)}</td>
                    <td className="border border-black px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        max={draft.issueWeight}
                        step="0.01"
                        value={draft.returnQty}
                        onChange={(event) => updateReturnQty(draft.id, event.target.value)}
                        className="w-full max-w-28 rounded border border-black px-2 py-1.5 text-right font-bold focus:border-indigo-600 focus:outline-none"
                      />
                    </td>
                    <td className="border border-black px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeDraft(draft.id)}
                        className="rounded border border-rose-700 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-black text-slate-800">
          Issue Total: {formatQty(totalIssueDraftWeight)} KG | Return Total: {formatQty(totalReturnDraftWeight)} KG
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || reelDrafts.length === 0}
          className="mt-3 inline-flex h-[44px] w-full items-center justify-center gap-2 rounded border border-indigo-700 bg-indigo-50 px-4 text-sm font-bold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? <Spinner size={18} /> : <Save size={16} />}
          Save
        </button>
      </div>

      {isScannerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded border-2 border-black bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-black uppercase text-black">Scan Job Reel QR</div>
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
            {isProcessingScan ? <div className="mt-2 text-center text-sm font-black text-emerald-800">Adding scanned reel...</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}


function MobileField({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border border-slate-300 bg-slate-50 p-2">
      <div className="text-[10px] font-black uppercase text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-black ${accent ? "text-emerald-700" : "text-black"}`}>{value}</div>
    </div>
  );
}
