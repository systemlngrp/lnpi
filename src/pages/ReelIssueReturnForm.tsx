import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, BarChart3 } from "lucide-react";
import { useData } from "../hooks/useData";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
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
import { generateTransactionNo } from "../lib/serial";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { getAvailableReelPackingSlips, getReturnableReelLinesForJob } from "../lib/materialMovement";
import { buildProductionMaterialUsageMap, syncProductionWorkflowFromUsage } from "../lib/productionMaterialUsage";

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

export function ReelIssueReturnForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
    const slip = packingSlips.find(s => s.id === slipId);
    if (!slip) return 0;
    const mrr = materialIn.find(m => m.id === slip.materialInId);
    if (!mrr) return 0;
    const line = mrr.lines.find(l => l.id === slip.materialLineId);
    return Number(line?.invoiceRate || line?.rate || 0);
  };

  const consumptionSummary = useMemo(() => {
    let totalIssueWt = 0;
    let totalIssueVal = 0;
    let totalReturnWt = 0;
    let totalReturnVal = 0;

    // Issue totals
    Object.values(selectedIssueReels).flat().forEach(slipId => {
      const slip = packingSlips.find(s => s.id === slipId);
      if (slip) {
        const wt = Number(slip.weightKg || 0);
        const rate = getReelInvoiceRate(slipId);
        totalIssueWt += wt;
        totalIssueVal += wt * rate;
      }
    });

    // Return totals
    Object.entries(returnQtyDrafts).forEach(([lineId, drafts]) => {
      Object.entries(drafts).forEach(([slipId, qtyStr]) => {
        const qty = Number(qtyStr || 0);
        if (qty > 0) {
          const rate = getReelInvoiceRate(slipId);
          totalReturnWt += qty;
          totalReturnVal += qty * rate;
        }
      });
    });

    const netWt = totalIssueWt - totalReturnWt;
    const netVal = totalIssueVal - totalReturnVal;

    return {
      issueWt: totalIssueWt,
      issueVal: totalIssueVal,
      returnWt: totalReturnWt,
      returnVal: totalReturnVal,
      netWt,
      netVal
    };
  }, [selectedIssueReels, returnQtyDrafts, packingSlips, materialIn]);

  useEffect(() => {
    const slipById = new Map(packingSlips.map((slip) => [slip.id, slip]));
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
      const next: ReelLineDraft[] = selectedMaterials.map(
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
            const slip = slipById.get(slipId);
            const weight = Number(slip?.weightKg || 0);
            currentDrafts[slipId] = weight > 0 ? weight.toFixed(2) : "";
          });

          nextDrafts[lineId] = currentDrafts;
        }

        return nextDrafts;
      });

      return next;
    });
  }, [issueLines, selectedIssueReels, packingSlips]);

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

  const reelMaterialOptions = useMemo(
    () =>
      materials
        .filter((material) => material.active !== "No" && material.type === "Reel")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [materials]
  );

  const getMaterial = (materialId: string) => materials.find((material) => material.id === materialId);

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

    const slipById = new Map(packingSlips.map((slip) => [slip.id, slip]));
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
    const merged = [...persisted, ...drafts].filter((line) => {
      if (seen.has(line.packingSlipId)) return false;
      seen.add(line.packingSlipId);
      return true;
    });
    return merged;
  };

  const addIssueLine = () => setIssueLines((prev) => [...prev, createEmptyReelLine()]);
  const addReturnLine = () => setReturnLines((prev) => [...prev, createEmptyReelLine()]);

  const removeIssueLine = (lineId: string) => {
    setIssueLines((prev) => (prev.length === 1 ? [createEmptyReelLine()] : prev.filter((l) => l.id !== lineId)));
    setSelectedIssueReels((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const removeReturnLine = (lineId: string) => {
    setReturnLines((prev) => (prev.length === 1 ? [createEmptyReelLine()] : prev.filter((l) => l.id !== lineId)));
    setReturnQtyDrafts((prev) => {
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
    setReturnQtyDrafts((prev) => {
      const next = {
        ...prev,
        [lineId]: {
          ...(prev[lineId] || {}),
          [packingSlipId]: value,
        },
      };

      const returnableMap = new Map(
        getReturnableReels(materialId).map((row) => [row.packingSlipId, Number(row.weightKg || 0)])
      );
      const totalWeight = Object.entries(next[lineId] || {}).reduce((sum, [id, qty]) => {
        const enteredQty = Number(qty || 0);
        const maxQty = returnableMap.get(id) || 0;
        return sum + Math.min(Math.max(enteredQty, 0), maxQty);
      }, 0);

      return next;
    });
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
      const nextMaterialReturns = [...materialReturns];
      const nextMaterialReturnLines = [...materialReturnLines];

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
            createdLines.push({
              id: issueLineId,
              materialIssueId: issueId,
              materialId: line.materialId,
              qty: Number(totalWeight.toFixed(2)),
              uom: "KG",
              updatedBy: "System User",
              updateTimestamp: timestamp,
            });

            const reelIds = selectedIssueReels[line.id] || [];
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
          await setMaterialIssueReelLines([...materialIssueReelLines, ...createdReelLines]);
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
          createdLines.push({
            id: returnLineId,
            materialReturnId: returnId,
            materialId: line.materialId,
            qty: Number(totalWeight.toFixed(2)),
            uom: "KG",
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
          await setMaterialReturnReelLines([...materialReturnReelLines, ...createdReelLines]);
        }
      }

      // Sync production status based on net usage after both operations
      if (productionId) {
        const usageMap = buildProductionMaterialUsageMap(
          nextMaterialIssues,
          nextMaterialIssueLines,
          nextMaterialReturns,
          nextMaterialReturnLines
        );
        const netUsage = usageMap.get(productionId) || 0;
        await setProductions((prev) =>
          prev.map((production) =>
            production.id === productionId ? syncProductionWorkflowFromUsage(production, netUsage, timestamp) : production
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
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Reel Issue & Return</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Date" required>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              disabled={lockDate}
              className="w-full border-2 border-black rounded p-2 disabled:bg-slate-50 disabled:opacity-80"
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
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border-2 border-black rounded p-2" />
          </Field>
        </div>

        <div className="rounded border border-black p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold uppercase">Issue Reels</h3>
            <button type="button" onClick={addIssueLine} className="inline-flex items-center gap-2 rounded border border-black px-3 py-2 text-sm font-bold hover:bg-slate-50">
              <Plus size={16} /> Add
            </button>
          </div>

          {issueLines.map((line) => {
            const availableReels = line.materialId ? getIssueAvailableReels(line.materialId, line.id) : [];
            const selectedIds = selectedIssueReels[line.id] || [];
            const totalWeight = line.materialId ? computeIssueLineWeight(line) : 0;
            return (
              <div key={line.id} className="rounded border border-black p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-full max-w-xl space-y-1">
                    <label className="text-sm font-bold">Material</label>
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
                      <label className="text-sm font-black uppercase text-indigo-700">Invoice Rate</label>
                      <div className="border-2 border-indigo-700 rounded p-2 bg-indigo-50 font-black text-indigo-700 text-center">
                        ₹{(selectedIds[0] ? getReelInvoiceRate(selectedIds[0]) : 0).toLocaleString()}
                      </div>
                    </div>
                  )}
                  <button type="button" onClick={() => removeIssueLine(line.id)} className="mt-6 text-red-600 hover:text-red-800" title="Remove line">
                    <Trash2 size={18} />
                  </button>
                </div>

                {line.materialId ? (
                  <>
                    <div className="text-sm text-slate-500">
                      Selected: <span className="font-bold text-black">{totalWeight.toFixed(2)} KG</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border border-black">
                        <thead className="bg-slate-100">
                          <tr>
                            {["Select", "Our Reel No.", "Supplier Reel No.", "Invoice Rate", "Weight KG"].map((heading) => (
                              <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-bold uppercase">
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {availableReels.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="border border-black px-4 py-6 text-center text-sm text-slate-500">
                                No available reels for this material.
                              </td>
                            </tr>
                          ) : (
                            availableReels.map((slip) => (
                              <tr key={slip.id}>
                                <td className="border border-black px-3 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.includes(slip.id)}
                                    onChange={(e) => updateSelectedIssueReels(line.id, line.materialId, slip.id, e.target.checked)}
                                  />
                                </td>
                                <td className="border border-black px-3 py-2 text-sm">{slip.ourReelNo}</td>
                                <td className="border border-black px-3 py-2 text-sm">{slip.supplierReelNo || "-"}</td>
                                <td className="border border-black px-3 py-2 text-sm font-bold text-indigo-700">₹{getReelInvoiceRate(slip.id).toLocaleString()}</td>
                                <td className="border border-black px-3 py-2 text-sm">{Number(slip.weightKg || 0).toFixed(2)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

	        <div className="rounded border border-black p-4 space-y-4">
	          <div className="flex items-center justify-between">
	            <h3 className="text-lg font-bold uppercase">Return Reels</h3>
	          </div>

	          {returnLines.length === 0 ? (
	            <div className="text-sm text-slate-500">Select reels in Issue Reels to auto-fill return.</div>
	          ) : (
	          returnLines.map((line) => {
	            const returnableReels = line.materialId ? getReturnableReels(line.materialId) : [];
	            const drafts = returnQtyDrafts[line.id] || {};
	            const totalWeight = line.materialId ? computeReturnLineWeight(line) : 0;
	            return (
              <div key={line.id} className="rounded border border-black p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
	                  <div className="w-full max-w-xl space-y-1">
	                    <label className="text-sm font-bold">Material</label>
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
                        <label className="text-sm font-black uppercase text-indigo-700">Invoice Rate</label>
                        <div className="border-2 border-indigo-700 rounded p-2 bg-indigo-50 font-black text-indigo-700 text-center">
                          ₹{(returnableReels[0] ? getReelInvoiceRate(returnableReels[0].packingSlipId) : 0).toLocaleString()}
                        </div>
                      </div>
                    )}
	                </div>

                {line.materialId ? (
                  <>
                    <div className="text-sm text-slate-500">
                      Selected: <span className="font-bold text-black">{totalWeight.toFixed(2)} KG</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border border-black">
                        <thead className="bg-slate-100">
                          <tr>
                            {["Our Reel No.", "Invoice Rate", "Issued Weight KG", "Return Qty KG"].map((heading) => (
                              <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-bold uppercase">
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {returnableReels.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="border border-black px-4 py-6 text-center text-sm text-slate-500">
                                No issued reels available for return for this job.
                              </td>
                            </tr>
                          ) : (
                            returnableReels.map((reelLine) => (
                              <tr key={reelLine.packingSlipId}>
                                <td className="border border-black px-3 py-2 text-sm">{reelLine.ourReelNo}</td>
                                <td className="border border-black px-3 py-2 text-sm font-bold text-indigo-700">₹{getReelInvoiceRate(reelLine.packingSlipId).toLocaleString()}</td>
                                <td className="border border-black px-3 py-2 text-sm">{Number(reelLine.weightKg || 0).toFixed(2)}</td>
                                <td className="border border-black px-3 py-2 text-sm">
                                  <input
                                    type="number"
                                    min="0"
                                    max={Number(reelLine.weightKg || 0)}
                                    step="0.01"
                                    value={drafts[reelLine.packingSlipId] || ""}
                                    onChange={(e) => updateReturnQty(line.id, line.materialId, reelLine.packingSlipId, e.target.value)}
                                    className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                                  />
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
	              </div>
	            );
	          }))}
	        </div>

        {/* Consumption Summary Section */}
        <div className="bg-slate-900 text-white p-6 rounded border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <h3 className="text-lg font-black uppercase tracking-tighter mb-4 border-b border-white/20 pb-2 flex items-center gap-2">
            <BarChart3 size={20} />
            Consumption Summary
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Issue Weight</div>
                <div className="text-xl font-black">{consumptionSummary.issueWt.toFixed(2)} <span className="text-xs text-slate-400">KG</span></div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Issue Value</div>
                <div className="text-xl font-black">₹{consumptionSummary.issueVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Return Weight</div>
                <div className="text-xl font-black text-amber-400">{consumptionSummary.returnWt.toFixed(2)} <span className="text-xs text-slate-400">KG</span></div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Return Value</div>
                <div className="text-xl font-black text-amber-400">₹{consumptionSummary.returnVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">Net Consumption Weight</div>
                <div className="text-2xl font-black text-indigo-400">{consumptionSummary.netWt.toFixed(2)} <span className="text-xs text-slate-400">KG</span></div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">Net Consumption Value</div>
                <div className="text-2xl font-black text-indigo-400">₹{consumptionSummary.netVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !productionId || (!hasAnyIssue && !hasAnyReturn)}
            className="min-w-[180px] bg-indigo-600 text-white px-6 py-3 rounded font-bold hover:bg-indigo-700 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px] transition-all uppercase tracking-widest text-sm"
          >
            {isSubmitting ? <Spinner size={22} className="text-white" /> : "Save Issue/Return"}
          </button>
        </div>
      </form>
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
      <label className="font-bold text-black">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {children}
    </div>
  );
}
