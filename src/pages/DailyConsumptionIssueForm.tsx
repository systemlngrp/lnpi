import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { useData } from "../hooks/useData";
import { generateTransactionNo } from "../lib/serial";
import { Material, MaterialIssue, MaterialIssueLine } from "../types";

type ConsumptionLine = {
  id: string;
  materialId: string;
  qty: number;
};

export function DailyConsumptionIssueForm() {
  const [materials] = useData<Material>("materials", []);
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines, setMaterialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");
  const [currentMaterialId, setCurrentMaterialId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [lines, setLines] = useState<ConsumptionLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const materialOptions = useMemo(
    () =>
      materials
        .filter((material) => material.active !== "No" && material.type !== "Reel")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [materials]
  );

  const generalIssuesForDate = useMemo(
    () => materialIssues.filter((issue) => issue.issueType === "General" && (issue.date || "").split("T")[0] === date),
    [materialIssues, date]
  );

  const getMaterial = (materialId: string) => materials.find((material) => material.id === materialId);

  const handleAddLine = () => {
    if (!currentMaterialId) return;
    const qty = Number(currentQty || 0);
    if (qty <= 0) return;

    setLines((prev) => [...prev, { id: crypto.randomUUID(), materialId: currentMaterialId, qty }]);
    setCurrentMaterialId("");
    setCurrentQty("");
  };

  const handleRemoveLine = (lineId: string) => setLines((prev) => prev.filter((line) => line.id !== lineId));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!date || lines.length === 0) return;
    if (generalIssuesForDate.length > 0) {
      alert("Daily Consumption (General) issue already exists for this date.");
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
      const consumptionTransactionNo = generateTransactionNo(
        "CON",
        materialIssues
          .filter((row) => String(row.issueType || "").trim().toLowerCase() === "general" || String(row.issueType || "").trim().toLowerCase() === "without job")
          .map((row) => ({ transactionNo: row.consumptionTransactionNo, date: row.date })),
        date
      );

      const issue: MaterialIssue = {
        id: issueId,
        issueNo,
        consumptionTransactionNo,
        date,
        issueType: "General",
        remarks: remarks.trim() || undefined,
        tallyPostingStatus: "Pending",
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      const createdLines: MaterialIssueLine[] = lines.map((line) => {
        const material = getMaterial(line.materialId);
        return {
          id: crypto.randomUUID(),
          materialIssueId: issueId,
          materialId: line.materialId,
          qty: Number(Number(line.qty || 0).toFixed(2)),
          uom: material?.uom || "",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
      });

      await setMaterialIssues([issue, ...materialIssues]);
      await setMaterialIssueLines([...materialIssueLines, ...createdLines]);

      setDate(new Date().toISOString().split("T")[0]);
      setRemarks("");
      setCurrentMaterialId("");
      setCurrentQty("");
      setLines([]);
      alert(`Daily Consumption saved with Issue No: ${issueNo} | Consumption No: ${consumptionTransactionNo}`);
    } catch (error) {
      console.error("Failed to save daily consumption issue:", error);
      alert("Failed to save daily consumption issue.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Daily Consumption Issue</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Date" required>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full border-2 border-black rounded p-2" />
          </Field>
          <Field label="Issue No (Auto)">
            <input type="text" value="Generated on Submit" disabled className="w-full border-2 border-black rounded p-2 bg-slate-50 opacity-70" />
          </Field>
          <div className="md:col-span-2 rounded border border-black bg-slate-50 p-3 text-sm font-bold">
            Daily Consumption (General) issues on {date}: {generalIssuesForDate.length}
          </div>
          <Field label="Remarks" className="md:col-span-2">
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border-2 border-black rounded p-2" />
          </Field>
        </div>

        <div className="border-t border-black pt-4 space-y-4">
          <h3 className="text-lg font-bold uppercase">Items</h3>
          <div className="flex flex-wrap gap-4 items-end bg-slate-50 p-4 rounded border border-black">
            <div className="w-full md:w-96 space-y-1">
              <label className="text-sm font-bold">Material</label>
              <Select options={materialOptions} value={currentMaterialId} onChange={setCurrentMaterialId} placeholder="Select Material..." />
            </div>
            <div className="w-full md:w-32 space-y-1">
              <label className="text-sm font-bold">Qty</label>
              <input type="number" value={currentQty} onChange={(e) => setCurrentQty(e.target.value === "" ? "" : parseFloat(e.target.value))} className="w-full border-2 border-black rounded p-[6px]" />
            </div>
            <button type="button" onClick={handleAddLine} className="bg-black text-white p-[10px] rounded hover:bg-slate-800 transition">
              <Plus size={20} />
            </button>
          </div>

          {lines.length === 0 ? (
            <div className="p-4 bg-slate-50 border border-dashed border-black text-center text-sm">No consumption lines added yet.</div>
          ) : (
            <div className="space-y-3">
              {lines.map((line) => {
                const material = getMaterial(line.materialId);
                return (
                  <div key={line.id} className="rounded border border-black p-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold">{material?.name || "Unknown Material"}</div>
                      <div className="text-sm text-slate-500">Qty: {Number(line.qty || 0)}</div>
                    </div>
                    <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-600 hover:text-red-800">
                      <Trash2 size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || lines.length === 0 || generalIssuesForDate.length > 0}
            className="min-w-[180px] bg-indigo-600 text-white px-6 py-3 rounded font-bold hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={22} className="text-white" /> : "Save Daily Consumption"}
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

