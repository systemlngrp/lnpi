import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
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
import { getAvailableReelPackingSlips, getNonReelAvailableQty } from "../lib/materialMovement";
import { buildProductionMaterialUsageMap, syncProductionWorkflowFromUsage } from "../lib/productionMaterialUsage";

export function MaterialIssueForm() {
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

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const requestedProductionId = searchParams.get("productionId") || "";
  const [issueType, setIssueType] = useState<"Job" | "General">(requestedProductionId ? "Job" : "General");
  const [productionId, setProductionId] = useState(requestedProductionId);
  const [remarks, setRemarks] = useState("");
  const [currentMaterialId, setCurrentMaterialId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [lines, setLines] = useState<Array<{ id: string; materialId: string; qty: number; uom: string; isReel: boolean }>>([]);
  const [selectedReels, setSelectedReels] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const jobOptions = useMemo(
    () =>
      productions
        .filter((production) => production.status !== "Cancelled")
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .map((production) => ({
          value: production.id,
          label: `${production.transactionNo}${production.itemId ? ` | ${production.date}` : ""}`,
        })),
    [productions]
  );

  const materialOptions = useMemo(
    () =>
      materials
        .filter((material) => material.active !== "No")
        .filter((material) => (issueType === "General" ? material.type !== "Reel" : true))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [issueType, materials]
  );

  const issueTypeOptions = [
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
      const availableQty = getNonReelAvailableQty(currentMaterialId, materialIn, materialIssueLines, materialReturnLines);
      if (qty > availableQty) {
        alert(`Available quantity is only ${availableQty}.`);
        return;
      }
      setLines((prev) => [...prev, { id: crypto.randomUUID(), materialId: currentMaterialId, qty, uom: material.uom || "", isReel: false }]);
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

  const getLineAvailableReels = (materialId: string) =>
    getAvailableReelPackingSlips(materialId, packingSlips, materialIssueReelLines, materialReturnReelLines);

  const updateSelectedReels = (lineId: string, materialId: string, packingSlipId: string, checked: boolean) => {
    setSelectedReels((prev) => {
      const current = new Set(prev[lineId] || []);
      if (checked) current.add(packingSlipId);
      else current.delete(packingSlipId);
      const nextIds = Array.from(current);
      const totalWeight = getLineAvailableReels(materialId)
        .filter((slip) => nextIds.includes(slip.id))
        .reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0);
      setLines((old) => old.map((line) => (line.id === lineId ? { ...line, qty: totalWeight } : line)));
      return { ...prev, [lineId]: nextIds };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date || lines.length === 0) return;
    if (issueType === "Job" && !productionId) return;

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

      const issue: MaterialIssue = {
        id: issueId,
        issueNo,
        date,
        issueType,
        productionId: issueType === "Job" ? productionId : undefined,
        jobNo: issueType === "Job" ? (selectedProduction?.transactionNo || "") : undefined,
        remarks: remarks.trim() || undefined,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const nextLines: MaterialIssueLine[] = [];
      const nextReelLines: MaterialIssueReelLine[] = [];

      lines.forEach((line) => {
        const issueLineId = crypto.randomUUID();
        nextLines.push({
          id: issueLineId,
          materialIssueId: issueId,
          materialId: line.materialId,
          qty: Number(line.qty || 0),
          uom: line.uom,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        });

        if (line.isReel) {
          const reelIds = selectedReels[line.id] || [];
          getLineAvailableReels(line.materialId)
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
          materialReturnLines
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
      setIssueType(requestedProductionId ? "Job" : "General");
      setProductionId(requestedProductionId);
      setRemarks("");
      setCurrentMaterialId("");
      setCurrentQty("");
      setLines([]);
      setSelectedReels({});
      alert(`Material Issue created with Issue No: ${issueNo}`);
    } catch (error) {
      console.error("Failed to save material issue:", error);
      alert("Failed to save material issue.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Material Issue Form</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Date" required>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full border-2 border-black rounded p-2" />
          </Field>
          <Field label="Issue No (Auto)">
            <input type="text" value="Generated on Submit" disabled className="w-full border-2 border-black rounded p-2 bg-slate-50 opacity-70" />
          </Field>
          <Field label="Issue Type" required>
            <Select options={issueTypeOptions} value={issueType} onChange={(value) => setIssueType(value === "Job" ? "Job" : "General")} required />
          </Field>
          {issueType === "Job" ? (
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
            <div className="p-4 bg-slate-50 border border-dashed border-black text-center text-sm">No issue lines added yet.</div>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => {
                const material = getMaterial(line.materialId);
                const availableQty = !line.isReel ? getNonReelAvailableQty(line.materialId, materialIn, materialIssueLines, materialReturnLines) : null;
                const availableReels = line.isReel ? getLineAvailableReels(line.materialId) : [];
                const selectedIds = selectedReels[line.id] || [];
                return (
                  <div key={line.id} className="rounded border border-black p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-bold">{material?.name || "Unknown Material"}</div>
                        <div className="text-sm text-slate-500">
                          {line.isReel ? `Selected Weight: ${line.qty.toFixed(2)} KG` : `Issue Qty: ${line.qty} ${line.uom} | Available: ${availableQty}`}
                        </div>
                      </div>
                      <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-600 hover:text-red-800">
                        <Trash2 size={18} />
                      </button>
                    </div>

                    {line.isReel ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse border border-black">
                          <thead className="bg-slate-100">
                            <tr>
                              {["Select", "Our Reel No.", "Supplier Reel No.", "Weight KG"].map((heading) => (
                                <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-bold uppercase">{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {availableReels.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="border border-black px-4 py-6 text-center text-sm text-slate-500">No available reels for this material.</td>
                              </tr>
                            ) : (
                              availableReels.map((slip) => (
                                <tr key={slip.id}>
                                  <td className="border border-black px-3 py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.includes(slip.id)}
                                      onChange={(e) => updateSelectedReels(line.id, line.materialId, slip.id, e.target.checked)}
                                    />
                                  </td>
                                  <td className="border border-black px-3 py-2 text-sm">{slip.ourReelNo}</td>
                                  <td className="border border-black px-3 py-2 text-sm">{slip.supplierReelNo || "-"}</td>
                                  <td className="border border-black px-3 py-2 text-sm">{Number(slip.weightKg || 0).toFixed(2)}</td>
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
            {isSubmitting ? <Spinner size={22} className="text-white" /> : "Save Issue"}
          </button>
        </div>
      </form>
    </div>
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
