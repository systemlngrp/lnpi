import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, BarChart3, Package2 } from "lucide-react";
import { useData } from "../hooks/useData";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Material,
  MaterialGroup,
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
import { generateTransactionNo } from "../lib/serial";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { getAvailableReelPackingSlips, getReturnableReelLinesForJob } from "../lib/materialMovement";
import {
  buildProductionCorrugatedSheetUsageMap,
  buildProductionMaterialUsageMap,
  syncProductionWorkflowFromUsage,
} from "../lib/productionMaterialUsage";

type ReelLineDraft = {
  id: string;
  materialId: string;
};

function createEmptyReelLine(): ReelLineDraft {
  return { id: crypto.randomUUID(), materialId: "" };
}

function normalizeDate(value?: string | null) {
  return String(value || "").slice(0, 10);
}

function normalizeText(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCurrencyDisplay(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ReelIssueReturnForm() {
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

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [materials] = useData<Material>("materials", []);
  const [materialGroups] = useData<MaterialGroup>("material-groups", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions, setProductions] = useData<Production>("productions", []);

  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines, setMaterialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines, setMaterialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);

  const [materialReturns, setMaterialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines, setMaterialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines, setMaterialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

  const requestedDate = normalizeDate(searchParams.get("date"));
  const requestedProductionId = String(searchParams.get("productionId") || "").trim();
  const lockDate = searchParams.get("lockDate") === "1";
  const lockJob = searchParams.get("lockJob") === "1";

  const [date, setDate] = useState(() => requestedDate || new Date().toISOString().split("T")[0]);
  const [productionId, setProductionId] = useState(() => requestedProductionId);
  const [remarks, setRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [issueLines, setIssueLines] = useState<ReelLineDraft[]>([createEmptyReelLine()]);
  const [selectedIssueReels, setSelectedIssueReels] = useState<Record<string, string[]>>({});

  const [returnLines, setReturnLines] = useState<ReelLineDraft[]>([createEmptyReelLine()]);
  const [returnQtyDrafts, setReturnQtyDrafts] = useState<Record<string, Record<string, string>>>({});

  const selectedProduction = productions.find((production) => production.id === productionId) || null;

  const getReelInvoiceRate = (slipId: string): number => {
    const slip = packingSlips.find((row) => row.id === slipId);
    if (!slip) return 0;
    const mrr = materialIn.find((row) => row.id === slip.materialInId);
    if (!mrr) return 0;
    const line = mrr.lines.find((row) => row.id === slip.materialLineId);
    const material = materials.find((row) => row.id === slip.materialId);
    return Number(line?.invoiceRate || line?.poRate || line?.rate || material?.openingRate || 0);
  };

  const consumptionSummary = useMemo(() => {
    let totalIssueWt = 0;
    let totalIssueVal = 0;
    let totalReturnWt = 0;
    let totalReturnVal = 0;

    Object.values(selectedIssueReels)
      .flat()
      .forEach((slipId) => {
        const slip = packingSlips.find((row) => row.id === slipId);
        if (!slip) return;
        const weight = Number(slip.weightKg || 0);
        const rate = getReelInvoiceRate(slipId);
        totalIssueWt += weight;
        totalIssueVal += weight * rate;
      });

    Object.values(returnQtyDrafts).forEach((drafts) => {
      Object.entries(drafts).forEach(([slipId, qtyStr]) => {
        const qty = Number(qtyStr || 0);
        if (qty <= 0) return;
        const rate = getReelInvoiceRate(slipId);
        totalReturnWt += qty;
        totalReturnVal += qty * rate;
      });
    });

    return {
      issueWt: totalIssueWt,
      issueVal: totalIssueVal,
      returnWt: totalReturnWt,
      returnVal: totalReturnVal,
      netWt: totalIssueWt - totalReturnWt,
      netVal: totalIssueVal - totalReturnVal,
    };
  }, [selectedIssueReels, returnQtyDrafts, packingSlips, materialIn]);

  useEffect(() => {
    const availableSlipById = new Map(
      issueLines
        .flatMap((line) => (line.materialId ? getIssueAvailableReels(line.materialId, line.id) : []))
        .map((slip) => [slip.id, slip])
    );
    const materialToSelectedSlipIds = new Map<string, string[]>();

    issueLines.forEach((line) => {
      if (!line.materialId) return;
      const selected = selectedIssueReels[line.id] || [];
      if (selected.length === 0) return;
      const existing = materialToSelectedSlipIds.get(line.materialId) || [];
      materialToSelectedSlipIds.set(line.materialId, [...existing, ...selected]);
    });

    const selectedMaterials = Array.from(materialToSelectedSlipIds.keys());

    if (selectedMaterials.length === 0) {
      setReturnLines([]);
      setReturnQtyDrafts({});
      return;
    }

    setReturnLines((prev) => {
      const existingByMaterial = new Map(prev.filter((row) => row.materialId).map((row) => [row.materialId, row]));
      const next = selectedMaterials.map(
        (materialId) => existingByMaterial.get(materialId) ?? { id: crypto.randomUUID(), materialId }
      );

      setReturnQtyDrafts((prevDrafts) => {
        const nextDrafts: Record<string, Record<string, string>> = {};

        for (const materialId of selectedMaterials) {
          const lineId = next.find((row) => row.materialId === materialId)?.id;
          if (!lineId) continue;

          const slipIds = Array.from(new Set(materialToSelectedSlipIds.get(materialId) || []));
          const previousLineDrafts = prevDrafts[lineId] || {};
          const currentDrafts: Record<string, string> = {};

          slipIds.forEach((slipId) => {
            if (previousLineDrafts[slipId] !== undefined) {
              currentDrafts[slipId] = previousLineDrafts[slipId];
              return;
            }
            const slip = availableSlipById.get(slipId);
            const weight = Number(slip?.weightKg || 0);
            currentDrafts[slipId] = weight > 0 ? weight.toFixed(2) : "";
          });

          nextDrafts[lineId] = currentDrafts;
        }

        return nextDrafts;
      });

      return next;
    });
  }, [issueLines, selectedIssueReels, packingSlips, materialIssueReelLines, materialReturnReelLines]);

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

  const reelGroupIds = useMemo(
    () =>
      new Set(
        materialGroups
          .filter((group) => normalizeText(group.name) === "reel")
          .map((group) => group.id)
      ),
    [materialGroups]
  );

  const reelMaterialOptions = useMemo(
    () =>
      materials
        .filter((material) => {
          const isActive = normalizeText(material.active || "Yes") !== "no";
          const isReelType = normalizeText(material.type) === "reel";
          const isReelGroup = material.materialGroupId ? reelGroupIds.has(material.materialGroupId) : false;
          return isActive && (isReelType || isReelGroup);
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [materials, reelGroupIds]
  );

  const ensureReturnLineForMaterial = (materialId: string) => {
    if (!materialId) return "";
    const existing = returnLines.find((line) => line.materialId === materialId);
    if (existing) return existing.id;

    const newId = crypto.randomUUID();
    setReturnLines((prev) => {
      const hasOnlyEmpty = prev.length === 1 && !prev[0].materialId;
      if (hasOnlyEmpty) return [{ id: newId, materialId }];
      return [...prev, { id: newId, materialId }];
    });
    return newId;
  };

  const getIssueAvailableReels = (materialId: string, currentLineId: string) => {
    const selectedElsewhere = new Set(
      Object.entries(selectedIssueReels)
        .filter(([lineId]) => lineId !== currentLineId)
        .flatMap(([, ids]) => ids)
    );
    return getAvailableReelPackingSlips(materialId, packingSlips, materialIssueReelLines, materialReturnReelLines).filter(
      (slip) => !selectedElsewhere.has(slip.id)
    );
  };

  const getDraftIssuedReelsForMaterial = (materialId: string) => {
    const selectedIds = new Set(
      issueLines
        .filter((line) => line.materialId === materialId)
        .flatMap((line) => selectedIssueReels[line.id] || [])
    );

    if (selectedIds.size === 0) return [];

    const slipById = new Map(
      issueLines
        .filter((line) => line.materialId === materialId)
        .flatMap((line) => getIssueAvailableReels(materialId, line.id))
        .map((slip) => [slip.id, slip])
    );
    return Array.from(selectedIds)
      .map((id) => slipById.get(id))
      .filter((slip): slip is MaterialInPackingSlip => Boolean(slip))
      .map((slip) => ({
        id: `draft-${slip.id}`,
        materialIssueId: "draft",
        materialIssueLineId: "draft",
        materialId,
        packingSlipId: slip.id,
        ourReelNo: slip.ourReelNo,
        weightKg: Number(slip.weightKg || 0),
        productionId: productionId || "",
        jobNo: selectedProduction?.transactionNo || "",
      }));
  };

  const getReturnableReels = (materialId: string) => {
    const persisted = productionId
      ? getReturnableReelLinesForJob(materialId, productionId, materialIssueReelLines, materialReturnReelLines)
      : [];
    const drafts = getDraftIssuedReelsForMaterial(materialId);
    const seen = new Set<string>();
    return [...drafts, ...persisted].filter((line) => {
      if (seen.has(line.packingSlipId)) return false;
      seen.add(line.packingSlipId);
      return true;
    });
  };

  const addIssueLine = () => setIssueLines((prev) => [...prev, createEmptyReelLine()]);

  const removeIssueLine = (lineId: string) => {
    setIssueLines((prev) => (prev.length === 1 ? [createEmptyReelLine()] : prev.filter((line) => line.id !== lineId)));
    setSelectedIssueReels((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const updateSelectedIssueReels = (lineId: string, materialId: string, packingSlipId: string, checked: boolean) => {
    setSelectedIssueReels((prev) => {
      const current = new Set(prev[lineId] || []);
      if (checked) current.add(packingSlipId);
      else current.delete(packingSlipId);

      const selectedElsewhere = new Set(
        Object.entries(prev)
          .filter(([id]) => id !== lineId)
          .flatMap(([, reelIds]) => reelIds)
      );
      if (checked && selectedElsewhere.has(packingSlipId)) {
        alert("This reel is already selected in another issue line.");
        return prev;
      }

      return { ...prev, [lineId]: Array.from(current) };
    });

    if (productionId && materialId) {
      const returnLineId = ensureReturnLineForMaterial(materialId);
      if (returnLineId) {
        setReturnQtyDrafts((prev) => ({
          ...prev,
          [returnLineId]: {
            ...(prev[returnLineId] || {}),
            [packingSlipId]: (prev[returnLineId] || {})[packingSlipId] ?? "",
          },
        }));
      }
    }
  };

  const updateReturnQty = (lineId: string, materialId: string, packingSlipId: string, value: string) => {
    const currentReturnable = getReturnableReels(materialId);
    const maxQty = Number(
      currentReturnable.find((line) => line.packingSlipId === packingSlipId)?.weightKg || 0
    );
    const cleanedValue = String(value || "").replace(/[^0-9.]/g, "");
    const numericValue = Number(cleanedValue || 0);
    const normalizedValue =
      cleanedValue === ""
        ? ""
        : String(Math.min(Math.max(Number.isFinite(numericValue) ? numericValue : 0, 0), maxQty));

    setReturnQtyDrafts((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        [packingSlipId]: normalizedValue,
      },
    }));
  };

  const computeIssueLineWeight = (line: ReelLineDraft) => {
    const ids = selectedIssueReels[line.id] || [];
    return getAvailableReelPackingSlips(line.materialId, packingSlips, materialIssueReelLines, materialReturnReelLines)
      .filter((slip) => ids.includes(slip.id))
      .reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0);
  };

  const computeReturnLineWeight = (line: ReelLineDraft) => {
    const drafts = returnQtyDrafts[line.id] || {};
    const returnableMap = new Map(getReturnableReels(line.materialId).map((row) => [row.packingSlipId, Number(row.weightKg || 0)]));
    return Object.entries(drafts).reduce((sum, [id, qty]) => {
      const enteredQty = Number(qty || 0);
      const maxQty = returnableMap.get(id) || 0;
      return sum + Math.min(Math.max(enteredQty, 0), maxQty);
    }, 0);
  };

  const hasAnyIssue = issueLines.some((line) => line.materialId && (selectedIssueReels[line.id] || []).length > 0);
  const hasAnyReturn = returnLines.some((line) => line.materialId && computeReturnLineWeight(line) > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date || !productionId) return;
    if (!hasAnyIssue && !hasAnyReturn) {
      alert("Select at least one reel to issue and/or enter a return quantity.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextMaterialIssues = [...materialIssues];
      const nextMaterialIssueLines = [...materialIssueLines];
      const nextMaterialIssueReelLines = [...materialIssueReelLines];
      const nextMaterialReturns = [...materialReturns];
      const nextMaterialReturnLines = [...materialReturnLines];
      const nextMaterialReturnReelLines = [...materialReturnReelLines];

      if (hasAnyIssue) {
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
          jobNo: selectedProduction?.transactionNo || "",
          remarks: remarks.trim() || undefined,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };

        const createdLines: MaterialIssueLine[] = [];
        const createdReelLines: MaterialIssueReelLine[] = [];

        issueLines
          .filter((line) => line.materialId && (selectedIssueReels[line.id] || []).length > 0)
          .forEach((line) => {
            const issueLineId = crypto.randomUUID();
            const totalWeight = computeIssueLineWeight(line);
            const reelIds = selectedIssueReels[line.id] || [];
            const totalValue = getAvailableReelPackingSlips(line.materialId, packingSlips, materialIssueReelLines, materialReturnReelLines)
              .filter((slip) => reelIds.includes(slip.id))
              .reduce((sum, slip) => sum + Number(slip.weightKg || 0) * getReelInvoiceRate(slip.id), 0);
            const savedAmount = Number(totalValue.toFixed(2));
            const savedRate = totalWeight > 0 ? Number((savedAmount / totalWeight).toFixed(2)) : 0;
            const material = materials.find((row) => row.id === line.materialId);
            createdLines.push({
              id: issueLineId,
              materialIssueId: issueId,
              materialId: line.materialId,
              qty: Number(totalWeight.toFixed(2)),
              uom: "KG",
              lastPurchaseRate: savedRate,
              openingRate: Number(Number(material?.openingRate || 0).toFixed(2)),
              rate: savedRate,
              amount: savedAmount,
              updatedBy: "System User",
              updateTimestamp: timestamp,
            });
            getAvailableReelPackingSlips(line.materialId, packingSlips, materialIssueReelLines, materialReturnReelLines)
              .filter((slip) => reelIds.includes(slip.id))
              .forEach((slip) => {
                createdReelLines.push({
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
          });

        nextMaterialIssues.unshift(issue);
        nextMaterialIssueLines.push(...createdLines);
        await setMaterialIssues(nextMaterialIssues);
        await setMaterialIssueLines(nextMaterialIssueLines);
        if (createdReelLines.length > 0) {
          nextMaterialIssueReelLines.push(...createdReelLines);
          await setMaterialIssueReelLines(nextMaterialIssueReelLines);
        }
      }

      if (hasAnyReturn) {
        const returnId = crypto.randomUUID();
        const returnNo = generateTransactionNo(
          "MR",
          materialReturns.map((row) => ({ transactionNo: row.returnNo, date: row.date })),
          date
        );
        const entry: MaterialReturn = {
          id: returnId,
          returnNo,
          date,
          returnType: "Job",
          productionId,
          jobNo: selectedProduction?.transactionNo || "",
          remarks: remarks.trim() || undefined,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };

        const createdLines: MaterialReturnLine[] = [];
        const createdReelLines: MaterialReturnReelLine[] = [];

        for (const line of returnLines.filter((row) => row.materialId)) {
          const drafts = returnQtyDrafts[line.id] || {};
          const totalWeight = computeReturnLineWeight(line);
          if (totalWeight <= 0) continue;

          const returnLineId = crypto.randomUUID();
          const totalValue = Object.entries(drafts).reduce((sum, [packingSlipId, qty]) => {
            const returnQty = Number(qty || 0);
            if (returnQty <= 0) return sum;
            return sum + returnQty * getReelInvoiceRate(packingSlipId);
          }, 0);
          const savedAmount = Number(totalValue.toFixed(2));
          const savedRate = totalWeight > 0 ? Number((savedAmount / totalWeight).toFixed(2)) : 0;
          const material = materials.find((row) => row.id === line.materialId);
          createdLines.push({
            id: returnLineId,
            materialReturnId: returnId,
            materialId: line.materialId,
            qty: Number(totalWeight.toFixed(2)),
            uom: "KG",
            lastPurchaseRate: savedRate,
            openingRate: Number(Number(material?.openingRate || 0).toFixed(2)),
            rate: savedRate,
            amount: savedAmount,
            updatedBy: "System User",
            updateTimestamp: timestamp,
          });

          getReturnableReels(line.materialId)
            .filter((reelLine) => Number(drafts[reelLine.packingSlipId] || 0) > 0)
            .forEach((reelLine) => {
              createdReelLines.push({
                id: crypto.randomUUID(),
                materialReturnId: returnId,
                materialReturnLineId: returnLineId,
                materialId: line.materialId,
                packingSlipId: reelLine.packingSlipId,
                ourReelNo: reelLine.ourReelNo,
                weightKg: Number(drafts[reelLine.packingSlipId] || 0),
                productionId,
                jobNo: selectedProduction?.transactionNo || "",
                updatedBy: "System User",
                updateTimestamp: timestamp,
              });
            });
        }

        nextMaterialReturns.unshift(entry);
        nextMaterialReturnLines.push(...createdLines);
        await setMaterialReturns(nextMaterialReturns);
        await setMaterialReturnLines(nextMaterialReturnLines);
        if (createdReelLines.length > 0) {
          nextMaterialReturnReelLines.push(...createdReelLines);
          await setMaterialReturnReelLines(nextMaterialReturnReelLines);
        }
      }

      if (productionId) {
        const usageMap = buildProductionMaterialUsageMap(
          nextMaterialIssues,
          nextMaterialIssueLines,
          nextMaterialReturns,
          nextMaterialReturnLines,
          nextMaterialIssueReelLines,
          nextMaterialReturnReelLines
        );
        const corrugatedSheetUsageMap = buildProductionCorrugatedSheetUsageMap(
          materials,
          nextMaterialIssues,
          nextMaterialIssueLines,
          nextMaterialReturns,
          nextMaterialReturnLines
        );
        const netUsage = usageMap.get(productionId) || 0;
        const hasCorrugatedSheetUsage = Number(corrugatedSheetUsageMap.get(productionId) || 0) > 0;
        await setProductions((prev) =>
          prev.map((production) =>
            production.id === productionId ? syncProductionWorkflowFromUsage(production, netUsage, timestamp, hasCorrugatedSheetUsage) : production
          )
        );
      }

      setRemarks("");
      setIssueLines([createEmptyReelLine()]);
      setReturnLines([createEmptyReelLine()]);
      setSelectedIssueReels({});
      setReturnQtyDrafts({});
      if (!lockDate) setDate(new Date().toISOString().split("T")[0]);
      if (!lockJob) setProductionId("");
      alert("Saved reel issue/return successfully.");
      navigate("/production/pending-consumption");
    } catch (error) {
      console.error("Failed to save reel issue/return:", error);
      alert("Failed to save reel issue/return.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28)]">
        <div className="bg-[linear-gradient(135deg,rgba(30,41,59,1),rgba(79,70,229,0.96))] px-5 py-5 text-white md:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/15">
              <Package2 size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Reel Issue & Return</h2>
              <p className="text-sm font-medium text-white/75">Issue and return reels with a cleaner, app-matched dashboard layout.</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-5 md:p-6">
          <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,1))] p-4 shadow-sm md:p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Date" required>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  disabled={lockDate}
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50 disabled:opacity-80"
                />
              </Field>
              <Field label="Job No." required>
                <Select
                  options={jobOptions}
                  value={productionId}
                  onChange={setProductionId}
                  required
                  placeholder="Select Job..."
                  disabled={lockJob}
                />
              </Field>
              <Field label="Remarks" className="md:col-span-2">
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add optional notes..."
                  className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                />
              </Field>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black tracking-tight text-slate-950">Issue Reels</h3>
                <p className="text-sm font-medium text-slate-500">Choose a material and issue from the currently available reels.</p>
              </div>
              <button type="button" onClick={addIssueLine} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50">
                <Plus size={16} /> Add
              </button>
            </div>

            {issueLines.map((line) => {
              const availableReels = line.materialId ? getIssueAvailableReels(line.materialId, line.id) : [];
              const selectedIds = selectedIssueReels[line.id] || [];
              const totalWeight = line.materialId ? computeIssueLineWeight(line) : 0;
              return (
                <div key={line.id} className="mt-4 rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.86),rgba(255,255,255,1))] p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-full max-w-xl space-y-1">
                      <label className="text-sm font-bold text-slate-700">Material</label>
                      <Select
                        options={reelMaterialOptions}
                        value={line.materialId}
                        onChange={(value) => {
                          setIssueLines((prev) => prev.map((row) => (row.id === line.id ? { ...row, materialId: value } : row)));
                          setSelectedIssueReels((prev) => ({ ...prev, [line.id]: [] }));
                        }}
                        placeholder="Select reel material..."
                      />
                    </div>
                    {line.materialId && (
                      <div className="w-32 space-y-1">
                        <label className="text-sm font-black uppercase tracking-wide text-indigo-700">Invoice Rate</label>
                        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-center font-black text-indigo-700 shadow-sm">
                          {formatCurrencyDisplay(selectedIds[0] ? getReelInvoiceRate(selectedIds[0]) : 0)}
                        </div>
                      </div>
                    )}
                    <button type="button" onClick={() => removeIssueLine(line.id)} className="mt-6 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 hover:text-rose-700" title="Remove line">
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {line.materialId ? (
                    <>
                      <div className="mt-3 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                        Selected Weight: <span className="ml-1 font-black">{totalWeight.toFixed(2)} KG</span>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-[20px] border border-slate-200">
                        <div className="overflow-x-auto">

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <table className="min-w-full border-collapse">
                            <thead className="sticky top-0 z-30 bg-slate-800 text-white">
                              <tr>
                                {["Select", "Our Reel No.", "Supplier Reel No.", "Invoice Rate", "Available Weight KG"].map((heading) => (
                                  <th key={heading} className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em]">
                                    {heading}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {availableReels.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-4 py-8 text-center text-sm font-medium text-slate-500">
                                    No available reels for this material.
                                  </td>
                                </tr>
                              ) : (
                                availableReels.map((slip, index) => {
                                  const availableQty = Number(slip.weightKg || 0);
                                  return (
                                  <tr key={slip.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/70"}>
                                    <td className="border-t border-slate-200 px-4 py-3 text-center align-top">
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.includes(slip.id)}
                                        onChange={(e) => updateSelectedIssueReels(line.id, line.materialId, slip.id, e.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                      />
                                    </td>
                                    <td className="border-t border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 align-top">{slip.ourReelNo}</td>
                                    <td className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600 align-top">{slip.supplierReelNo || "-"}</td>
                                    <td className="border-t border-slate-200 px-4 py-3 text-sm font-bold text-indigo-700 align-top">{formatCurrencyDisplay(getReelInvoiceRate(slip.id))}</td>
                                    <td className="border-t border-slate-200 px-4 py-3 text-sm font-semibold text-emerald-700">{availableQty.toFixed(2)}</td>
                                  </tr>
                                )})
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Return Reels</h3>
              <p className="text-sm font-medium text-slate-500">Return issued reels back against the selected job.</p>
            </div>

            {returnLines.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-500">Select reels in Issue Reels to auto-fill return.</div>
            ) : (
              returnLines.map((line) => {
                const returnableReels = line.materialId ? getReturnableReels(line.materialId) : [];
                const drafts = returnQtyDrafts[line.id] || {};
                const totalWeight = line.materialId ? computeReturnLineWeight(line) : 0;
                return (
                  <div key={line.id} className="mt-4 rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.86),rgba(255,255,255,1))] p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-full max-w-xl space-y-1">
                        <label className="text-sm font-bold text-slate-700">Material</label>
                        <Select
                          options={reelMaterialOptions}
                          value={line.materialId}
                          onChange={() => {}}
                          placeholder="Select reel material..."
                          disabled
                        />
                      </div>
                      {line.materialId && (
                        <div className="w-32 space-y-1">
                          <label className="text-sm font-black uppercase tracking-wide text-indigo-700">Invoice Rate</label>
                          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-center font-black text-indigo-700 shadow-sm">
                            {formatCurrencyDisplay(returnableReels[0] ? getReelInvoiceRate(returnableReels[0].packingSlipId) : 0)}
                          </div>
                        </div>
                      )}
                    </div>

                    {line.materialId ? (
                      <>
                        <div className="mt-3 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
                          Return Weight: <span className="ml-1 font-black">{totalWeight.toFixed(2)} KG</span>
                        </div>
                        <div className="mt-4 overflow-hidden rounded-[20px] border border-slate-200">
                          <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse">
                              <thead className="sticky top-0 z-30 bg-slate-800 text-white">
                                <tr>
                                  {["Our Reel No.", "Invoice Rate", "Available Weight KG", "Return Qty KG"].map((heading) => (
                                    <th key={heading} className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em]">
                                      {heading}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {returnableReels.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-sm font-medium text-slate-500">
                                      No issued reels available for return for this job.
                                    </td>
                                  </tr>
                                ) : (
                                  returnableReels.map((reelLine, index) => (
                                    <tr key={reelLine.packingSlipId} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/70"}>
                                      <td className="border-t border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">{reelLine.ourReelNo}</td>
                                      <td className="border-t border-slate-200 px-4 py-3 text-sm font-bold text-indigo-700">{formatCurrencyDisplay(getReelInvoiceRate(reelLine.packingSlipId))}</td>
                                      <td className="border-t border-slate-200 px-4 py-3 text-sm font-semibold text-amber-700">{Number(reelLine.weightKg || 0).toFixed(2)}</td>
                                      <td className="border-t border-slate-200 px-4 py-3 text-sm">
                                        <input
                                          type="number"
                                          min="0"
                                          max={Number(reelLine.weightKg || 0)}
                                          step="0.01"
                                          value={drafts[reelLine.packingSlipId] || ""}
                                          onChange={(e) => updateReturnQty(line.id, line.materialId, reelLine.packingSlipId, e.target.value)}
                                          className="w-28 rounded-xl border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-800 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                                        />
                                        <div className="mt-1 text-[11px] font-medium text-slate-500">
                                          Max {Number(reelLine.weightKg || 0).toFixed(2)} KG
                                        </div>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="overflow-hidden rounded-[24px] border border-slate-200 shadow-sm">
            <div className="bg-[linear-gradient(135deg,rgba(15,23,42,1),rgba(49,46,129,0.95))] p-6 text-white">
              <h3 className="mb-5 flex items-center gap-2 border-b border-white/15 pb-3 text-lg font-black uppercase tracking-tighter">
                <BarChart3 size={20} />
                Consumption Summary
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Issue Weight</div>
                    <div className="text-xl font-black">{Number(consumptionSummary.issueWt || 0).toFixed(2)} <span className="text-xs text-slate-400">KG</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Issue Value</div>
                    <div className="text-xl font-black">{formatCurrencyDisplay(consumptionSummary.issueVal)}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Return Weight</div>
                    <div className="text-xl font-black text-amber-400">{Number(consumptionSummary.returnWt || 0).toFixed(2)} <span className="text-xs text-slate-400">KG</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Return Value</div>
                    <div className="text-xl font-black text-amber-400">{formatCurrencyDisplay(consumptionSummary.returnVal)}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Net Consumption Weight</div>
                    <div className="text-2xl font-black text-indigo-300">{Number(consumptionSummary.netWt || 0).toFixed(2)} <span className="text-xs text-slate-400">KG</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Net Consumption Value</div>
                    <div className="text-2xl font-black text-indigo-300">{formatCurrencyDisplay(consumptionSummary.netVal)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || !productionId || (!hasAnyIssue && !hasAnyReturn)}
              className="inline-flex min-w-[220px] items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(99,102,241,1),rgba(168,85,247,0.95))] px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_18px_35px_-18px_rgba(79,70,229,0.85)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <Spinner size={22} className="text-white" /> : "Save Issue/Return"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required = false,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {children}
    </div>
  );
}

