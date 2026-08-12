import { useMemo, useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Camera, Plus, Trash2, X } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturnLine,
  MaterialReturn,
  MaterialReturnReelLine,
  Production,
} from "../types";
import { generateTransactionNo } from "../lib/serial";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { calculateMaterialIssueAmount, getAvailableReelPackingSlips, getNonReelAvailableQty, resolveMaterialIssueRate, round2 } from "../lib/materialMovement";
import {
  buildProductionCorrugatedSheetUsageMap,
  buildProductionMaterialUsageMap,
  isCorrugatedSheetMaterial,
  syncProductionWorkflowFromUsage,
} from "../lib/productionMaterialUsage";
import { useNpdItems } from "../hooks/useNpdItems";

type IssueMaterialOption = Material & { isFgPurchaseItem?: boolean; isNpdConsumableItem?: boolean; npdSourceId?: string; rate?: number };

type ParsedQrPayload = {
  reelNo: string;
  weight: number | null;
};

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
  const weightKeys = ["weight", "physicalWeight", "availableWeight", "availableWeightKg", "weightKg", "wt", "kg"];

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
  const weightByLabel = text.match(/(?:weight|physical\s*weight|available\s*weight|weightkg|wt|kg)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (reelByLabel?.[1]) return { reelNo: reelByLabel[1].trim(), weight: parsePositiveWeight(weightByLabel?.[1]) };

  const delimited = text.match(/^\s*([^|,;\n]+)\s*[|,;]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*kg)?\s*$/i);
  if (delimited?.[1]) return { reelNo: delimited[1].trim(), weight: parsePositiveWeight(delimited[2]) };

  const weightByKgSuffix = text.match(/([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  return { reelNo: text, weight: parsePositiveWeight(weightByKgSuffix?.[1]) };
}
type IssueLineDraft = {
  id: string;
  materialId: string;
  qty: number;
  uom: string;
  isReel: boolean;
  lastPurchaseRate?: number;
  openingRate?: number;
  rate?: number;
  amount?: number;
};

function normalizeDate(value?: string | null) {
  return String(value || "").slice(0, 10);
}

function normalizeText(value?: string | number | null) {
  return String(value || "").trim().toLowerCase();
}

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

function isConsumableNpdItem(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;

  const truthyValues = new Set(["1", "true", "yes", "y", "on"]);
  return truthyValues.has(normalized);
}

function formatMoney(value?: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function MaterialIssueForm() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);
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

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [productions, setProductions] = useData<Production>("productions", []);
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines, setMaterialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines, setMaterialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const npdItems = useNpdItems();

  const requestedDate = normalizeDate(searchParams.get("date"));
  const lockDate = searchParams.get("lockDate") === "1";
  const lockIssueType = searchParams.get("lockIssueType") === "1";
  const requestedIssueTypeRaw = String(searchParams.get("issueType") || "").trim();
  const materialFilter = String(searchParams.get("materialFilter") || "").trim().toLowerCase();
  const isCorrugatedSheetOnly = materialFilter === "corrugated-sheet";

  const [date, setDate] = useState(() => requestedDate || new Date().toISOString().split("T")[0]);
  const requestedProductionId = searchParams.get("productionId") || "";
  const [issueType, setIssueType] = useState<MaterialIssue["issueType"]>(() => {
    if (requestedProductionId) return "Job";
    if (requestedIssueTypeRaw && isWithoutJobIssue(requestedIssueTypeRaw)) return "Without Job";
    return "Without Job";
  });
  const [productionId, setProductionId] = useState(requestedProductionId);
  const [remarks, setRemarks] = useState("");
  const [currentMaterialId, setCurrentMaterialId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [lines, setLines] = useState<IssueLineDraft[]>([]);
  const [selectedReels, setSelectedReels] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const [scannerMessageType, setScannerMessageType] = useState<"success" | "error">("success");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef("");
  const lastScannedAtRef = useRef(0);

  const generalIssuesForDate = useMemo(() => {
    const selected = String(date || "").trim();
    if (!selected) return [];
    return materialIssues
      .filter((issue) => isWithoutJobIssue(issue.issueType) && normalizeDate(issue.date) === selected)
      .slice()
      .sort((a, b) => {
        const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
        const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
        return timeB - timeA;
      });
  }, [date, materialIssues]);

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

  const issueMaterials = useMemo<IssueMaterialOption[]>(() => {
    const existingMaterialIds = new Set(materials.map((material) => String(material.id)));
    const existingMaterialErpKeys = new Set(
      materials
        .map((material) => String(material.erpCode || "").trim().toLowerCase())
        .filter((value) => value !== "")
    );

    const fgItems = new Map<string, IssueMaterialOption>();
    const fgErpKeys = new Set<string>();

    materialIn.forEach((receipt) => {
      if (receipt.mrrType !== "FG Purchase" && receipt.mrrType !== "Rejection In") return;

      (receipt.lines || []).forEach((line) => {
        const itemId = String(line.itemId || line.npdId || "").trim();
        if (!itemId || existingMaterialIds.has(itemId) || fgItems.has(itemId)) return;

        const npdItem = npdItems.find((entry) => String(entry.id) === itemId);
        if (!npdItem) return;

        const erpCode = String(npdItem.erp || "").trim().toLowerCase();
        const erpKey = erpCode || `npd:${itemId}`;

        if (existingMaterialErpKeys.has(erpCode)) return;
        if (fgErpKeys.has(erpCode)) return;

        fgItems.set(itemId, {
          id: npdItem.id,
          type: "Other",
          erpCode: npdItem.erp,
          name: npdItem.name,
          uom: line.uom || npdItem.uom || "PCS",
          active: "Yes",
          isFgPurchaseItem: true,
        });
        fgErpKeys.add(erpKey);
      });
    });

    const npdConsumableItems: IssueMaterialOption[] = [];
    const npdCorrugatedSheetItems: IssueMaterialOption[] = [];

    if (issueType === "Job") {
      npdItems.forEach((item) => {
        const itemId = String(item.id || "").trim();
        if (!itemId) return;

        const erpCode = String(item.erp || "").trim().toLowerCase();
        const erpKey = erpCode || `npd:${itemId}`;

        if (isCorrugatedSheetOnly && isCorrugatedSheetMaterial({ name: item.name })) {
          const syntheticId = `npd:${itemId}`;
          if (!npdCorrugatedSheetItems.some((entry) => String(entry.id) === syntheticId)) {
            npdCorrugatedSheetItems.push({
              id: syntheticId,
              type: "Other",
              erpCode: item.erp,
              name: item.name,
              uom: item.uom || "PCS",
              rate: Number(item.rate || 0),
              active: "Yes",
              isNpdConsumableItem: true,
              npdSourceId: itemId,
            });
          }
        }

        if (!isConsumableNpdItem(item.consumable)) return;

        if (existingMaterialIds.has(itemId)) return;
        if (fgItems.has(itemId)) return;
        if (existingMaterialErpKeys.has(erpCode)) return;
        if (fgErpKeys.has(erpKey)) return;

        const syntheticId = `npd:${itemId}`;
        if (npdConsumableItems.some((entry) => String(entry.id) === syntheticId)) return;

        npdConsumableItems.push({
          id: syntheticId,
          type: "Other",
          erpCode: item.erp,
          name: item.name,
          uom: item.uom || "PCS",
          rate: Number(item.rate || 0),
          active: "Yes",
          isNpdConsumableItem: true,
          npdSourceId: itemId,
        });
      });
    }

    return [...materials, ...Array.from(fgItems.values()), ...npdConsumableItems, ...npdCorrugatedSheetItems];
  }, [isCorrugatedSheetOnly, materialIn, materials, npdItems, issueType]);

  const materialOptions = useMemo(
    () =>
      issueMaterials
        .filter((material) => material.active !== "No")
        .filter((material) => (isWithoutJobIssue(issueType) ? material.type !== "Reel" : true))
        .filter((material) => !isCorrugatedSheetOnly || (material.type !== "Reel" && isCorrugatedSheetMaterial(material)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [isCorrugatedSheetOnly, issueMaterials, issueType]
  );

  const issueTypeOptions = [
    { value: "Job", label: "Against Job" },
    { value: "Without Job", label: "Without Job" },
  ];

  const selectedProduction = productions.find((production) => production.id === productionId);
  const showNonJobValuation = isWithoutJobIssue(issueType);
  const issueLinesTotalAmount = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);

  const getMaterial = (materialId: string) => issueMaterials.find((material) => material.id === materialId);
  const isNpdConsumableOption = (materialIdOrOption: string | IssueMaterialOption | undefined | null) => {
    if (!materialIdOrOption) return false;
    const material =
      typeof materialIdOrOption === "string" ? getMaterial(materialIdOrOption) : materialIdOrOption;
    return material?.isNpdConsumableItem === true;
  };

  const handleAddLine = () => {
    if (!currentMaterialId) return;
    const material = getMaterial(currentMaterialId);
    if (!material) return;

    const isReel = material.type === "Reel";
    const isNpdConsumable = Boolean(material.isNpdConsumableItem);

    if (isReel && issueType !== "Job") {
      alert("Reels can only be issued against a job.");
      return;
    }
    if (issueType === "Job" && !productionId) {
      alert("Please select a job first.");
      return;
    }

    if (!isReel) {
      const qty = Number(currentQty || 0);
      if (qty <= 0) return;
      if (issueType === "Job" && !isNpdConsumable) {
        const availableQty = getNonReelAvailableQty(currentMaterialId, materialIn, materialIssueLines, materialReturnLines);
        if (qty > availableQty) {
          alert(`Available quantity is only ${availableQty}.`);
          return;
        }
      }
      const baseValuation = resolveMaterialIssueRate(currentMaterialId, materials, materialIn, qty, {
        useLatestRateAsOpeningRate: isWithoutJobIssue(issueType),
      });
      const npdRate = isNpdConsumable ? round2(Number(material.rate || 0)) : 0;
      const valuation = baseValuation.rate > 0 || npdRate <= 0
        ? baseValuation
        : { ...baseValuation, rate: npdRate, amount: calculateMaterialIssueAmount(qty, npdRate) };
      setLines((prev) => [
        ...prev,
        { id: crypto.randomUUID(), materialId: currentMaterialId, qty, uom: material.uom || "", isReel: false, ...valuation },
      ]);
    } else {
      setLines((prev) => [...prev, { id: crypto.randomUUID(), materialId: currentMaterialId, qty: 0, uom: "KG", isReel: true }]);
    }

    setCurrentMaterialId("");
    setCurrentQty("");
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((prev) => prev.filter((line) => line.id !== lineId));
    setSelectedReels((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const getSelectedReelsAcrossOtherLines = (lineId: string) =>
    new Set(
      Object.entries(selectedReels)
        .filter(([id]) => id !== lineId)
        .flatMap(([, reelIds]) => reelIds)
    );

  const getLineAvailableReels = (lineId: string, materialId: string) => {
    const selectedElsewhere = getSelectedReelsAcrossOtherLines(lineId);
    return getAvailableReelPackingSlips(materialId, packingSlips, materialIssueReelLines, materialReturnReelLines).filter(
      (slip) => !selectedElsewhere.has(slip.id)
    );
  };

  const updateSelectedReels = (lineId: string, materialId: string, packingSlipId: string, checked: boolean) => {
    setSelectedReels((prev) => {
      const current = new Set(prev[lineId] || []);
      if (checked) current.add(packingSlipId);
      else current.delete(packingSlipId);
      const nextIds = Array.from(current);
      const selectedElsewhere = new Set(
        Object.entries(prev)
          .filter(([id]) => id !== lineId)
          .flatMap(([, reelIds]) => reelIds)
      );
      if (checked && selectedElsewhere.has(packingSlipId)) {
        alert("This reel is already selected in another line.");
        return prev;
      }
      const totalWeight = getAvailableReelPackingSlips(materialId, packingSlips, materialIssueReelLines, materialReturnReelLines)
        .filter((slip) => nextIds.includes(slip.id))
        .reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0);
      setLines((old) => old.map((line) => (line.id === lineId ? { ...line, qty: totalWeight } : line)));
      return { ...prev, [lineId]: nextIds };
    });
  };


  const addReelFromQr = async (rawQrValue: string) => {
    if (issueType !== "Job" || !productionId) throw new Error("Select Against Job and Job No. before scanning.");

    const parsed = parseQrPayload(rawQrValue);
    const reelNo = String(parsed.reelNo || "").trim();
    if (!reelNo) throw new Error("Reel number is required in QR.");

    const originalSlip = packingSlips.find((slip) => normalizeText(slip.ourReelNo) === normalizeText(reelNo));
    if (!originalSlip) throw new Error(`Reel ${reelNo} was not found in reel stock.`);

    const material = getMaterial(originalSlip.materialId);
    if (!material || material.type !== "Reel") throw new Error(`Reel material was not found for ${originalSlip.ourReelNo}.`);

    const selectedIdsAcrossDraft = new Set(Object.values(selectedReels).flat());
    if (selectedIdsAcrossDraft.has(originalSlip.id)) throw new Error(`Reel ${originalSlip.ourReelNo} is already selected.`);

    const availableSlip = getAvailableReelPackingSlips(
      originalSlip.materialId,
      packingSlips,
      materialIssueReelLines,
      materialReturnReelLines
    ).find((slip) => slip.id === originalSlip.id);
    if (!availableSlip || Number(availableSlip.weightKg || 0) <= 0) {
      throw new Error(`Reel ${originalSlip.ourReelNo} is not available for issue.`);
    }

    const existingLine = lines.find((line) => line.isReel && line.materialId === originalSlip.materialId);
    const lineId = existingLine?.id || crypto.randomUUID();
    const nextSelectedForLine = Array.from(new Set([...(existingLine ? selectedReels[existingLine.id] || [] : []), originalSlip.id]));
    const availableForMaterial = getAvailableReelPackingSlips(
      originalSlip.materialId,
      packingSlips,
      materialIssueReelLines,
      materialReturnReelLines
    );
    const totalWeight = availableForMaterial
      .filter((slip) => nextSelectedForLine.includes(slip.id))
      .reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0);

    if (existingLine) {
      setSelectedReels((prev) => ({ ...prev, [existingLine.id]: nextSelectedForLine }));
      setLines((prev) => prev.map((line) => (line.id === existingLine.id ? { ...line, qty: totalWeight } : line)));
    } else {
      setLines((prev) => [
        ...prev,
        { id: lineId, materialId: originalSlip.materialId, qty: Number(availableSlip.weightKg || 0), uom: "KG", isReel: true },
      ]);
      setSelectedReels((prev) => ({ ...prev, [lineId]: [originalSlip.id] }));
    }

    setScannerMessageType("success");
    setScannerMessage(`Added reel ${originalSlip.ourReelNo} (${Number(availableSlip.weightKg || 0).toFixed(2)} KG).`);
  };

  const handleOpenScanner = async () => {
    if (issueType !== "Job" || !productionId) {
      setScannerMessageType("error");
      setScannerMessage("Select Against Job and Job No. before scanning.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerMessageType("error");
      setScannerMessage("Camera access is not supported on this browser/device.");
      return;
    }
    const BarcodeDetectorCtor = (window as Window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
      };
    }).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setScannerMessageType("error");
      setScannerMessage("QR scanner is not supported on this browser.");
      return;
    }

    stopScanner();
    setScannerMessage("");
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
            await addReelFromQr(scanned);
            closeScanner();
          } catch (error) {
            closeScanner();
            setScannerMessageType("error");
            setScannerMessage(error instanceof Error ? error.message : "Unable to process scanned reel.");
          } finally {
            setIsProcessingScan(false);
          }
        } catch {
          // Keep scanning if one frame fails to decode.
        }
      }, 350);
    } catch (error) {
      console.error(error);
      closeScanner();
      setScannerMessageType("error");
      setScannerMessage("Unable to open camera. Please allow camera permission and try again.");
    }
  };
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date || lines.length === 0) return;
    if (issueType === "Job" && !productionId) return;
    if (isWithoutJobIssue(issueType) && !remarks.trim()) {
      alert("Remarks are mandatory for Without Job material issue.");
      return;
    }

    for (const line of lines) {
      if (line.isReel) {
        const reelIds = selectedReels[line.id] || [];
        if (reelIds.length === 0) {
          alert("Please select reel serial numbers for each reel line.");
          return;
        }
      } else if (Number(line.qty || 0) <= 0) {
        alert("Issue quantity must be greater than 0.");
        return;
      }
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
      const consumptionTransactionNo = isWithoutJobIssue(issueType)
        ? generateTransactionNo(
            "CON",
            materialIssues
              .filter((row) => isWithoutJobIssue(row.issueType))
              .map((row) => ({ transactionNo: row.consumptionTransactionNo, date: row.date })),
            date
          )
        : undefined;

      const issue: MaterialIssue = {
        id: issueId,
        issueNo,
        consumptionTransactionNo,
        date,
        issueType: issueType === "General" ? "Without Job" : issueType,
        productionId: issueType === "Job" ? productionId : undefined,
        jobNo: issueType === "Job" ? (selectedProduction?.transactionNo || "") : undefined,
        remarks: remarks.trim() || undefined,
        tallyPostingStatus: isWithoutJobIssue(issueType) ? "Pending" : undefined,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const nextLines: MaterialIssueLine[] = [];
      const nextReelLines: MaterialIssueReelLine[] = [];

      lines.forEach((line) => {
        const issueLineId = crypto.randomUUID();
        const savedQty = round2(Number(line.qty || 0));
        let savedRate = round2(Number(line.rate || 0));
        let savedAmount = calculateMaterialIssueAmount(savedQty, savedRate);
        let savedLastPurchaseRate = round2(Number(line.lastPurchaseRate || 0));
        const savedOpeningRate = round2(Number(line.openingRate || getMaterial(line.materialId)?.openingRate || 0));

        if (line.isReel) {
          const reelIds = selectedReels[line.id] || [];
          const reelAmount = getAvailableReelPackingSlips(line.materialId, packingSlips, materialIssueReelLines, materialReturnReelLines)
            .filter((slip) => reelIds.includes(slip.id))
            .reduce((sum, slip) => {
              const receipt = materialIn.find((entry) => entry.id === slip.materialInId);
              const receiptLine = receipt?.lines.find((entry) => entry.id === slip.materialLineId);
              const material = getMaterial(line.materialId);
              const rate = Number(receiptLine?.invoiceRate || receiptLine?.poRate || receiptLine?.rate || material?.openingRate || 0);
              return sum + Number(slip.weightKg || 0) * rate;
            }, 0);
          savedAmount = round2(reelAmount);
          savedRate = savedQty > 0 ? round2(savedAmount / savedQty) : 0;
          savedLastPurchaseRate = savedRate;
        }

        nextLines.push({
          id: issueLineId,
          materialIssueId: issueId,
          materialId: line.materialId,
          qty: savedQty,
          uom: line.uom,
          lastPurchaseRate: savedLastPurchaseRate,
          openingRate: savedOpeningRate,
          rate: savedRate,
          amount: savedAmount,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        });

        if (line.isReel) {
          const reelIds = selectedReels[line.id] || [];
          getAvailableReelPackingSlips(line.materialId, packingSlips, materialIssueReelLines, materialReturnReelLines)
            .filter((slip) => reelIds.includes(slip.id))
            .forEach((slip) => {
              nextReelLines.push({
                id: crypto.randomUUID(),
                materialIssueId: issueId,
                materialIssueLineId: issueLineId,
                materialId: line.materialId,
                packingSlipId: slip.id,
                ourReelNo: slip.ourReelNo,
                weightKg: Number(slip.weightKg || 0),
                productionId,
                jobNo: selectedProduction?.transactionNo || "",
                updatedBy: "System User",
                updateTimestamp: timestamp,
              });
            });
        }
      });

      await setMaterialIssues([issue, ...materialIssues]);
      await setMaterialIssueLines([...materialIssueLines, ...nextLines]);
      if (nextReelLines.length > 0) {
        await setMaterialIssueReelLines([...materialIssueReelLines, ...nextReelLines]);
      }
      if (issueType === "Job" && productionId) {
        const nextMaterialIssues = [issue, ...materialIssues];
        const nextIssueLines = [...materialIssueLines, ...nextLines];
        const usageMap = buildProductionMaterialUsageMap(
          nextMaterialIssues,
          nextIssueLines,
          materialReturns,
          materialReturnLines,
          [...materialIssueReelLines, ...nextReelLines],
          materialReturnReelLines
        );
        const corrugatedSheetUsageMap = buildProductionCorrugatedSheetUsageMap(
          materials,
          nextMaterialIssues,
          nextIssueLines,
          materialReturns,
          materialReturnLines
        );
        const netUsage = usageMap.get(productionId) || 0;
        const hasCorrugatedSheetUsage = Number(corrugatedSheetUsageMap.get(productionId) || 0) > 0;
        await setProductions((prev) =>
          prev.map((production) =>
            production.id === productionId
              ? syncProductionWorkflowFromUsage(production, netUsage, timestamp, hasCorrugatedSheetUsage)
              : production
          )
        );
      }

      if (!lockDate) setDate(new Date().toISOString().split("T")[0]);
      if (!lockIssueType) setIssueType(requestedProductionId ? "Job" : "Without Job");
      setProductionId(requestedProductionId);
      setRemarks("");
      setCurrentMaterialId("");
      setCurrentQty("");
      setLines([]);
      setSelectedReels({});
      alert(
        isWithoutJobIssue(issueType) && consumptionTransactionNo
          ? `Material Issue created with Issue No: ${issueNo} | Consumption No: ${consumptionTransactionNo}`
          : `Material Issue created with Issue No: ${issueNo}`
      );

      // Redirect back to relevant pending view
      if (isWithoutJobIssue(issueType)) {
        navigate("/material-movement/pending-non-job-issue");
      } else {
        navigate("/production/pending-consumption");
      }
    } catch (error) {
      console.error("Failed to save material issue:", error);
      alert("Failed to save material issue.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className={issueType === "Job" ? "hidden md:block" : ""}>
        <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />
      </div>

      <div className="bg-white p-3 md:p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-lg md:text-xl font-bold text-black mb-4 md:mb-6 uppercase tracking-tight border-b border-black pb-2">Material Issue Form</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Date" required className={issueType === "Job" ? "hidden md:block" : ""}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              disabled={lockDate}
              className="w-full border-2 border-black rounded p-2 disabled:bg-slate-50 disabled:opacity-80"
            />
          </Field>
          <Field label="Issue No (Auto)" className={issueType === "Job" ? "hidden md:block" : ""}>
            <input type="text" value="Generated on Submit" disabled className="w-full border-2 border-black rounded p-2 bg-slate-50 opacity-70" />
          </Field>
          <Field label="Issue Type" required>
            <Select
              options={issueTypeOptions}
              value={issueType}
              onChange={(value) => setIssueType(value === "Job" ? "Job" : "Without Job")}
              required
              disabled={lockIssueType}
            />
          </Field>
          {!(lockIssueType && issueType === "Without Job") && (
            <div className={`${issueType === "Job" ? "hidden md:block" : ""} md:col-span-2 rounded border border-black bg-slate-50 p-3`}>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="text-sm font-bold text-black">
                  Without Job issues on {date}: {generalIssuesForDate.length}
                </div>
                {issueType === "Job" && generalIssuesForDate.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIssueType("Without Job");
                      setProductionId("");
                      setLines([]);
                      setSelectedReels({});
                    }}
                    className="rounded border border-black bg-white px-4 py-2 text-xs font-bold uppercase hover:bg-slate-100"
                  >
                    Create Without Job Issue
                  </button>
                ) : null}
              </div>
              {generalIssuesForDate.length > 0 && (
                <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {generalIssuesForDate.slice(0, 6).map((issue) => (
                    <div key={issue.id} className="rounded border border-black bg-white px-3 py-2 text-xs">
                      <div className="font-black text-black">{issue.issueNo}</div>
                      <div className="text-slate-600">{issue.remarks || "-"}</div>
                      <div className="mt-1 text-[10px] font-semibold text-slate-500">
                        {issue.updatedBy || "-"} | {new Date(issue.updateTimestamp || issue.date || "").toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {generalIssuesForDate.length > 6 ? (
                    <div className="text-xs font-bold text-slate-600 self-center">+{generalIssuesForDate.length - 6} more</div>
                  ) : null}
                </div>
              )}
            </div>
          )}
          {issueType === "Job" ? (
            <Field label="Job No." required>
              <Select options={jobOptions} value={productionId} onChange={setProductionId} required placeholder="Select Job..." />
            </Field>
          ) : null}
          {issueType === "Job" && productionId ? (
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleOpenScanner()}
                disabled={isProcessingScan || isSubmitting}
                className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded border border-emerald-700 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
              >
                <Camera size={16} />
                Scan Reel QR
              </button>
            </div>
          ) : null}
          {scannerMessage ? (
            <div className={`md:col-span-2 rounded border p-3 text-sm font-bold ${scannerMessageType === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
              {scannerMessage}
            </div>
          ) : null}
          <Field label="Remarks" required={isWithoutJobIssue(issueType)} className={issueType === "Job" ? "hidden md:block md:col-span-2" : "md:col-span-2"}>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} required={isWithoutJobIssue(issueType)} className="w-full border-2 border-black rounded p-2" />
          </Field>
        </div>

        <div className="border-t border-black pt-4 space-y-4">
          <h3 className="hidden text-lg font-bold uppercase md:block">Items</h3>
          {issueType === "Job" ? <h3 className="text-base font-black uppercase md:hidden">Scanned Reels</h3> : null}
          <div className={`${issueType === "Job" ? "hidden md:flex" : "flex"} flex-wrap gap-4 items-end bg-slate-50 p-4 rounded border border-black`}>
            <div className="w-full md:w-80 space-y-1">
              <label className="text-sm font-bold">Material</label>
              <Select options={materialOptions} value={currentMaterialId} onChange={setCurrentMaterialId} placeholder={isCorrugatedSheetOnly ? "Select Corrugated Sheet..." : "Select Material..."} />
            </div>
            {currentMaterialId && getMaterial(currentMaterialId)?.type !== "Reel" ? (
              <div className="w-full md:w-24 space-y-1">
                <label className="text-sm font-bold">Qty</label>
                <input type="number" value={currentQty} onChange={(e) => setCurrentQty(e.target.value === "" ? "" : parseFloat(e.target.value))} className="w-full border-2 border-black rounded p-[6px]" />
              </div>
            ) : null}
            <button type="button" onClick={handleAddLine} className="bg-black text-white p-[10px] rounded hover:bg-slate-800 transition">
              <Plus size={20} />
            </button>
          </div>

          {lines.length === 0 ? (
            <div className={`${issueType === "Job" ? "hidden md:block" : ""} p-4 bg-slate-50 border border-dashed border-black text-center text-sm font-bold text-slate-600 uppercase`}>
              No issue lines added yet.
            </div>
          ) : (
            <>
              {issueType === "Job" ? (
                <div className="space-y-3 md:hidden">
                  {lines.flatMap((line) => {
                    const material = getMaterial(line.materialId);
                    const selectedIds = selectedReels[line.id] || [];
                    return selectedIds.map((slipId) => {
                      const slip = packingSlips.find((entry) => entry.id === slipId);
                      return (
                        <div key={`${line.id}-${slipId}`} className="rounded border-2 border-black bg-white p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3 border-b border-black pb-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-black uppercase text-slate-500">Reel No</div>
                              <div className="break-words text-xl font-black text-black">{slip?.ourReelNo || "-"}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateSelectedReels(line.id, line.materialId, slipId, false)}
                              className="shrink-0 rounded border border-red-200 bg-red-50 p-2 text-red-700"
                              title="Remove Reel"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <div className="mt-3 grid gap-2">
                            <div className="rounded border border-slate-300 p-2">
                              <div className="text-[10px] font-black uppercase text-slate-500">Material</div>
                              <div className="break-words text-sm font-black text-black">{material?.name || "Unknown Material"}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded border border-slate-300 p-2">
                                <div className="text-[10px] font-black uppercase text-slate-500">ERP/Code</div>
                                <div className="break-words text-sm font-black text-black">{material?.erpCode || "-"}</div>
                              </div>
                              <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-right">
                                <div className="text-[10px] font-black uppercase text-emerald-700">Issue Weight</div>
                                <div className="text-sm font-black text-emerald-900">{Number(slip?.weightKg || 0).toFixed(2)} KG</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })}
                </div>
              ) : null}
            <div className={`${issueType === "Job" ? "hidden md:block" : ""} overflow-x-auto`}>
              <table className="min-w-full border-collapse border border-black">
                <thead className="sticky top-0 z-30 bg-slate-100">
                  <tr className="divide-x divide-black border-b border-black">
                    <th className="px-4 py-3 text-left text-xs font-black uppercase w-16">Sl No</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase min-w-[200px]">Material Details</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase w-48">Qty / Availability</th>
                    {showNonJobValuation ? (
                      <>
                        <th className="px-4 py-3 text-right text-xs font-black uppercase w-36">Last Purchase Rate</th>
                        <th className="px-4 py-3 text-right text-xs font-black uppercase w-32">Opening Rate</th>
                        <th className="px-4 py-3 text-right text-xs font-black uppercase w-32">Rate</th>
                        <th className="px-4 py-3 text-right text-xs font-black uppercase w-36">Amount</th>
                      </>
                    ) : null}
                    <th className="px-4 py-3 text-center text-xs font-black uppercase w-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black">
                  {lines.map((line, index) => {
                    const material = getMaterial(line.materialId);
                    const availableQty = !line.isReel ? getNonReelAvailableQty(line.materialId, materialIn, materialIssueLines, materialReturnLines) : null;
                    const isConsumableNpdMaterial = isNpdConsumableOption(material);
                    const availableReels = line.isReel ? getLineAvailableReels(line.id, line.materialId) : [];
                    const selectedIds = selectedReels[line.id] || [];

                    return (
                      <tr key={line.id} className="divide-x divide-black align-top hover:bg-slate-50">
                        <td className="px-4 py-4 text-sm font-black text-center">{index + 1}</td>
                        <td className="px-4 py-4 space-y-2">
                          <div className="text-sm font-black">{material?.name || 'Unknown Material'}</div>
                          <div className="text-xs text-slate-500">ERP: {material?.erpCode || "-"} | UOM: {line.uom}</div>

                          {line.isReel && (
                            <div className="mt-2 rounded border border-black overflow-hidden bg-white">
                              <table className="min-w-full border-collapse">
                                <thead className="sticky top-0 z-30 bg-slate-50 border-b border-black">
                                  <tr>
                                     { ["", "Our Reel", "Weight"].map((h) => (
                                      <th key={h} className="px-2 py-1.5 text-left text-[10px] font-black uppercase text-slate-600">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {availableReels.length === 0 ? (
                                    <tr>
                                      <td colSpan={3} className="px-2 py-4 text-center text-[10px] font-bold text-slate-400 italic">No reels available</td>
                                    </tr>
                                  ) : (
                                    availableReels.map((slip) => (
                                      <tr key={slip.id} className="hover:bg-indigo-50/30">
                                        <td className="px-2 py-1 text-center">
                                          <input
                                            type="checkbox"
                                            checked={selectedIds.includes(slip.id)}
                                            onChange={(e) => updateSelectedReels(line.id, line.materialId, slip.id, e.target.checked)}
                                            className="h-3 w-3"
                                          />
                                        </td>
                                        <td className="px-2 py-1 text-[10px] font-bold">{slip.ourReelNo}</td>
                                        <td className="px-2 py-1 text-[10px] font-black text-right">{Number(slip.weightKg || 0).toFixed(2)}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right space-y-1">
                          <div className="text-sm font-black text-indigo-700">
                            {line.isReel ? `${Number(line.qty || 0).toFixed(2)} KG` : `${line.qty} ${line.uom}`}
                          </div>
                          {!line.isReel && !isWithoutJobIssue(issueType) && !isConsumableNpdMaterial ? (
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter bg-slate-100 p-1 rounded inline-block">
                              Avail: {availableQty} {line.uom}
                            </div>
                          ) : null}
                        </td>
                        {showNonJobValuation ? (
                          <>
                            <td className="px-4 py-4 text-right text-sm font-bold text-slate-800">
                              {formatMoney(line.lastPurchaseRate)}
                            </td>
                            <td className="px-4 py-4 text-right text-sm font-bold text-slate-800">
                              {formatMoney(line.openingRate)}
                            </td>
                            <td className="px-4 py-4 text-right text-sm font-black text-indigo-700">
                              {formatMoney(line.rate)}
                            </td>
                            <td className="px-4 py-4 text-right text-sm font-black text-emerald-700">
                              {formatMoney(line.amount)}
                            </td>
                          </>
                        ) : null}
                        <td className="px-4 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200 transition"
                            title="Remove Line"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {showNonJobValuation ? (
                <div className="mt-3 flex justify-end">
                  <div className="min-w-[260px] rounded border-2 border-black bg-emerald-50 px-4 py-3 text-right">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Total Amount</div>
                    <div className="mt-1 text-lg font-black text-emerald-800">{formatMoney(issueLinesTotalAmount)}</div>
                  </div>
                </div>
              ) : null}
            </div>
            </>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-black">
          <button
            type="submit"
            disabled={isSubmitting || lines.length === 0}
            className="w-full bg-black text-white px-8 py-3 rounded font-black uppercase tracking-widest text-sm hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed shadow-md transition-all active:scale-95 md:w-auto md:min-w-[160px]"
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <Spinner size={16} className="text-white border-white" />
                <span>Saving...</span>
              </div>
            ) : "Save Issue"}
          </button>
        </div>
      </form>
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
            {isProcessingScan ? <div className="mt-2 text-center text-sm font-black text-emerald-800">Adding scanned reel...</div> : null}
          </div>
        </div>
      ) : null}
    </div>
    </>
  );
}

function Field({ label, children, required = false, className = "" }: { label: string; children: React.ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="font-bold text-black">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {children}
    </div>
  );
}




