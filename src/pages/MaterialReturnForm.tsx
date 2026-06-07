import { useMemo, useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Material,
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
import { getReturnableReelLinesForJob } from "../lib/materialMovement";
import { buildProductionMaterialUsageMap, syncProductionWorkflowFromUsage } from "../lib/productionMaterialUsage";

export function MaterialReturnForm() {
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

  const [materials] = useData<Material>("materials", []);
  const [productions, setProductions] = useData<Production>("productions", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns, setMaterialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines, setMaterialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines, setMaterialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [returnType, setReturnType] = useState<"Job" | "General">("General");
  const [productionId, setProductionId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [currentMaterialId, setCurrentMaterialId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [lines, setLines] = useState<Array<{ id: string; materialId: string; qty: number; uom: string; isReel: boolean }>>([]);
  const [returnQtyDrafts, setReturnQtyDrafts] = useState<Record<string, Record<string, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const materialOptions = useMemo(
    () =>
      materials
        .filter((material) => material.active !== "No")
        .filter((material) => (returnType === "General" ? material.type !== "Reel" : true))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [materials, returnType]
  );

  const typeOptions = [
    { value: "Job", label: "Against Job" },
    { value: "General", label: "Without Job" },
  ];

  const selectedProduction = productions.find((production) => production.id === productionId);
  const getMaterial = (materialId: string) => materials.find((material) => material.id === materialId);

  const handleAddLine = () => {
    if (!currentMaterialId) return;
    const material = getMaterial(currentMaterialId);
    if (!material) return;
    const isReel = material.type === "Reel";
    if (isReel && returnType !== "Job") {
      alert("Reels can only be returned against a job.");
      return;
    }
    if (returnType === "Job" && !productionId) {
      alert("Please select a job first.");
      return;
    }

    if (!isReel) {
      const qty = Number(currentQty || 0);
      if (qty <= 0) return;
      setLines((prev) => [...prev, { id: crypto.randomUUID(), materialId: currentMaterialId, qty, uom: material.uom || "", isReel: false }]);
    } else {
      setLines((prev) => [...prev, { id: crypto.randomUUID(), materialId: currentMaterialId, qty: 0, uom: "KG", isReel: true }]);
    }

    setCurrentMaterialId("");
    setCurrentQty("");
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((prev) => prev.filter((line) => line.id !== lineId));
    setReturnQtyDrafts((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const getReturnableReels = (materialId: string) =>
    productionId ? getReturnableReelLinesForJob(materialId, productionId, materialIssueReelLines, materialReturnReelLines) : [];

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
        getReturnableReels(materialId).map((line) => [line.packingSlipId, Number(line.weightKg || 0)])
      );
      const totalWeight = Object.entries(next[lineId] || {}).reduce((sum, [id, qty]) => {
        const enteredQty = Number(qty || 0);
        const maxQty = returnableMap.get(id) || 0;
        return sum + Math.min(Math.max(enteredQty, 0), maxQty);
      }, 0);
      setLines((old) => old.map((line) => (line.id === lineId ? { ...line, qty: totalWeight } : line)));
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date || lines.length === 0) return;
    if (returnType === "Job" && !productionId) return;

    for (const line of lines) {
      if (line.isReel) {
        const drafts = returnQtyDrafts[line.id] || {};
        const selectedEntries = Object.entries(drafts).filter(([, qty]) => Number(qty || 0) > 0);
        if (selectedEntries.length === 0) {
          alert("Please enter return quantity for at least one issued reel in each reel return line.");
          return;
        }
        const issuedMap = new Map(getReturnableReels(line.materialId).map((row) => [row.packingSlipId, Number(row.weightKg || 0)]));
        const invalidQty = selectedEntries.find(([packingSlipId, qty]) => {
          const returnQty = Number(qty || 0);
          const issuedQty = issuedMap.get(packingSlipId) || 0;
          return returnQty <= 0 || returnQty > issuedQty;
        });
        if (invalidQty) {
          alert("Return quantity cannot be more than issued weight for a reel.");
          return;
        }
      } else if (Number(line.qty || 0) <= 0) {
        alert("Return quantity must be greater than 0.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const returnId = crypto.randomUUID();
      const returnNo = generateTransactionNo(
        "MRT",
        materialReturns.map((row) => ({ transactionNo: row.returnNo, date: row.date })),
        date
      );

      const entry: MaterialReturn = {
        id: returnId,
        returnNo,
        date,
        returnType,
        productionId: returnType === "Job" ? productionId : undefined,
        jobNo: returnType === "Job" ? (selectedProduction?.transactionNo || "") : undefined,
        remarks: remarks.trim() || undefined,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const nextLines: MaterialReturnLine[] = [];
      const nextReelLines: MaterialReturnReelLine[] = [];

      lines.forEach((line) => {
        const returnLineId = crypto.randomUUID();
        nextLines.push({
          id: returnLineId,
          materialReturnId: returnId,
          materialId: line.materialId,
          qty: Number(line.qty || 0),
          uom: line.uom,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        });

        if (line.isReel) {
          const drafts = returnQtyDrafts[line.id] || {};
          getReturnableReels(line.materialId)
            .filter((reelLine) => Number(drafts[reelLine.packingSlipId] || 0) > 0)
            .forEach((reelLine) => {
              nextReelLines.push({
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
      });

      await setMaterialReturns([entry, ...materialReturns]);
      await setMaterialReturnLines([...materialReturnLines, ...nextLines]);
      if (nextReelLines.length > 0) {
        await setMaterialReturnReelLines([...materialReturnReelLines, ...nextReelLines]);
      }
      if (returnType === "Job" && productionId) {
        const nextMaterialReturns = [entry, ...materialReturns];
        const nextReturnLines = [...materialReturnLines, ...nextLines];
        const usageMap = buildProductionMaterialUsageMap(
          materialIssues,
          materialIssueLines,
          nextMaterialReturns,
          nextReturnLines,
          materialIssueReelLines,
          [...materialReturnReelLines, ...nextReelLines]
        );
        const netUsage = usageMap.get(productionId) || 0;
        await setProductions((prev) =>
          prev.map((production) =>
            production.id === productionId
              ? syncProductionWorkflowFromUsage(production, netUsage, timestamp)
              : production
          )
        );
      }

      setDate(new Date().toISOString().split("T")[0]);
      setReturnType("General");
      setProductionId("");
      setRemarks("");
      setCurrentMaterialId("");
      setCurrentQty("");
      setLines([]);
      setReturnQtyDrafts({});
      alert(`Material Return created with Return No: ${returnNo}`);
    } catch (error) {
      console.error("Failed to save material return:", error);
      alert("Failed to save material return.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Material Return Form</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Date" required>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full border-2 border-black rounded p-2" />
          </Field>
          <Field label="Return No (Auto)">
            <input type="text" value="Generated on Submit" disabled className="w-full border-2 border-black rounded p-2 bg-slate-50 opacity-70" />
          </Field>
          <Field label="Return Type" required>
            <Select options={typeOptions} value={returnType} onChange={(value) => setReturnType(value === "Job" ? "Job" : "General")} required />
          </Field>
          {returnType === "Job" ? (
            <Field label="Job No." required>
              <Select options={jobOptions} value={productionId} onChange={setProductionId} required placeholder="Select Job..." />
            </Field>
          ) : null}
          <Field label="Remarks" className="md:col-span-2">
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border-2 border-black rounded p-2" />
          </Field>
        </div>

        <div className="border-t border-black pt-4 space-y-4">
          <h3 className="text-lg font-bold uppercase">Items</h3>
          <div className="flex flex-wrap gap-4 items-end bg-slate-50 p-4 rounded border border-black">
            <div className="w-full md:w-80 space-y-1">
              <label className="text-sm font-bold">Material</label>
              <Select options={materialOptions} value={currentMaterialId} onChange={setCurrentMaterialId} placeholder="Select Material..." />
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
            <div className="p-4 bg-slate-50 border border-dashed border-black text-center text-sm">No return lines added yet.</div>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => {
                const material = getMaterial(line.materialId);
                const returnableReels = line.isReel ? getReturnableReels(line.materialId) : [];
                const draftQtys = returnQtyDrafts[line.id] || {};
                return (
                  <div key={line.id} className="rounded border border-black p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-black">{material?.name || 'Unknown Material'}</div>
                        <div className="text-xs text-slate-500">{line.isReel ? `Selected Weight: ${line.qty.toFixed(2)} KG` : `Return Qty: ${line.qty} ${line.uom}`}</div>
                      </div>
                      <div>
                        <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-600 hover:text-red-800">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {line.isReel ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse border border-black">
                          <thead className="bg-slate-100">
                            <tr>
                              {["Our Reel No.", "Issued Weight KG", "Return Qty KG"].map((heading) => (
                                <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-bold uppercase">{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {returnableReels.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="border border-black px-4 py-6 text-center text-sm text-slate-500">No issued reels available for return for this job.</td>
                              </tr>
                            ) : (
                              returnableReels.map((reelLine) => (
                                <tr key={`${reelLine.packingSlipId}-${reelLine.productionId}`}>
                                  <td className="border border-black px-3 py-2 text-sm">{reelLine.ourReelNo}</td>
                                  <td className="border border-black px-3 py-2 text-sm">{Number(reelLine.weightKg || 0).toFixed(2)}</td>
                                  <td className="border border-black px-3 py-2 text-sm">
                                    <input
                                      type="number"
                                      min="0"
                                      max={Number(reelLine.weightKg || 0)}
                                      step="0.01"
                                      value={draftQtys[reelLine.packingSlipId] || ""}
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
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={isSubmitting || lines.length === 0} className="min-w-[150px] bg-indigo-600 text-white px-6 py-3 rounded font-bold hover:bg-indigo-700 disabled:opacity-50">
            {isSubmitting ? <Spinner size={22} className="text-white" /> : "Save Return"}
          </button>
        </div>
      </form>
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
