import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
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

function normalizeDate(value?: string | null) {
  return String(value || "").slice(0, 10);
}

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

export function MaterialIssueForm() {
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

  const requestedDate = normalizeDate(searchParams.get("date"));
  const lockDate = searchParams.get("lockDate") === "1";
  const lockIssueType = searchParams.get("lockIssueType") === "1";
  const requestedIssueTypeRaw = String(searchParams.get("issueType") || "").trim();

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
  const [lines, setLines] = useState<Array<{ id: string; materialId: string; qty: number; uom: string; isReel: boolean }>>([]);
  const [selectedReels, setSelectedReels] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const materialOptions = useMemo(
    () =>
      materials
        .filter((material) => material.active !== "No")
        .filter((material) => (isWithoutJobIssue(issueType) ? material.type !== "Reel" : true))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [issueType, materials]
  );

  const issueTypeOptions = [
    { value: "Job", label: "Against Job" },
    { value: "Without Job", label: "Without Job" },
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
	      if (issueType === "Job") {
	        const availableQty = getNonReelAvailableQty(currentMaterialId, materialIn, materialIssueLines, materialReturnLines);
	        if (qty > availableQty) {
	          alert(`Available quantity is only ${availableQty}.`);
	          return;
	        }
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
        issueType: issueType === "General" ? "Without Job" : issueType,
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
        const netUsage = usageMap.get(productionId) || 0;
        await setProductions((prev) =>
          prev.map((production) =>
            production.id === productionId
              ? syncProductionWorkflowFromUsage(production, netUsage, timestamp)
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
      alert(`Material Issue created with Issue No: ${issueNo}`);

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
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Material Issue Form</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
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
          <Field label="Issue No (Auto)">
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
            <div className="md:col-span-2 rounded border border-black bg-slate-50 p-3">
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
            <div className="p-4 bg-slate-50 border border-dashed border-black text-center text-sm font-bold text-slate-600 uppercase">
              No issue lines added yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse border border-black">
                <thead className="bg-slate-100">
                  <tr className="divide-x divide-black border-b border-black">
                    <th className="px-4 py-3 text-left text-xs font-black uppercase w-16">Sl No</th>
                    <th className="px-4 py-3 text-left text-xs font-black uppercase min-w-[200px]">Material Details</th>
                    <th className="px-4 py-3 text-right text-xs font-black uppercase w-48">Qty / Availability</th>
                    <th className="px-4 py-3 text-center text-xs font-black uppercase w-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black">
                  {lines.map((line, index) => {
                    const material = getMaterial(line.materialId);
                    const availableQty = !line.isReel ? getNonReelAvailableQty(line.materialId, materialIn, materialIssueLines, materialReturnLines) : null;
                    const availableReels = line.isReel ? getLineAvailableReels(line.id, line.materialId) : [];
                    const selectedIds = selectedReels[line.id] || [];

                    return (
                      <tr key={line.id} className="divide-x divide-black align-top hover:bg-slate-50">
                        <td className="px-4 py-4 text-sm font-black text-center">{index + 1}</td>
                        <td className="px-4 py-4 space-y-2">
                          <div>
                            <div className="font-bold text-black">{material?.name || "Unknown Material"}</div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                              ERP: {material?.erpCode || "-"} | UOM: {line.uom}
                            </div>
                          </div>

                          {line.isReel && (
                            <div className="mt-2 rounded border border-black overflow-hidden bg-white">
                              <table className="min-w-full border-collapse">
                                <thead className="bg-slate-50 border-b border-black">
                                  <tr>
                                    {["", "Our Reel", "Weight"].map((h) => (
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
                            {line.isReel ? `${line.qty.toFixed(2)} KG` : `${line.qty} ${line.uom}`}
                          </div>
                          {!line.isReel && !isWithoutJobIssue(issueType) && (
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter bg-slate-100 p-1 rounded inline-block">
                              Avail: {availableQty} {line.uom}
                            </div>
                          )}
                        </td>
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
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-black">
          <button
            type="submit"
            disabled={isSubmitting || lines.length === 0}
            className="min-w-[160px] bg-black text-white px-8 py-3 rounded font-black uppercase tracking-widest text-sm hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed shadow-md transition-all active:scale-95"
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
