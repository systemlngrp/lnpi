import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import { Indent, IndentLine, Material, User } from "../types";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { summarizeIndentLines } from "../lib/indentTotals";

type EditableIndentLine = {
  id: string;
  materialId: string;
  qty: number | "";
  targetDeliveryDate: string;
};

function createEmptyLine(): EditableIndentLine {
  return {
    id: crypto.randomUUID(),
    materialId: "",
    qty: "",
    targetDeliveryDate: "",
  };
}

function getIndentLineUom(indentType: Indent["indentType"], material?: Material | null) {
  return indentType === "Reel" ? "Kgs" : material?.uom || "";
}

export function IndentForm() {
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
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines, setIndentLines] = useData<IndentLine>("indent-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [users] = useData<User>("users", []);

  const [requestedBy, setRequestedBy] = useState("");
  const [requisitionDate, setRequisitionDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [indentType, setIndentType] = useState<Indent["indentType"]>("Reel");
  const [lines, setLines] = useState<EditableIndentLine[]>([createEmptyLine()]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeMaterials = useMemo(
    () => materials.filter((material) => material.active !== "No" && material.type === indentType),
    [indentType, materials]
  );

  const requestedByOptions = useMemo(() => {
    const userOptions = users
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((user) => ({ value: user.name, label: user.name }));

    return userOptions.length > 0 ? userOptions : [{ value: "System", label: "System" }];
  }, [users]);

  useEffect(() => {
    if (!requestedBy) {
      setRequestedBy(requestedByOptions[0]?.value || "System");
    }
  }, [requestedBy, requestedByOptions]);

  const materialOptions = activeMaterials
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((material) => ({
      value: material.id,
      label: `${material.erpCode ? `${material.erpCode} - ` : ""}${material.name}`,
    }));

  const handleLineChange = (lineId: string, field: "materialId" | "qty" | "targetDeliveryDate", value: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              [field]: field === "qty" ? (value === "" ? "" : Number(value)) : value,
              ...(field === "materialId" && !line.targetDeliveryDate && requisitionDate ? { targetDeliveryDate: requisitionDate } : {}),
            }
          : line
      )
    );
  };

  const handleAddRow = () => {
    setLines((prev) => [...prev, createEmptyLine()]);
  };

  const handleRemoveRow = (lineId: string) => {
    setLines((prev) => (prev.length === 1 ? [createEmptyLine()] : prev.filter((line) => line.id !== lineId)));
  };

  const handleTypeChange = (value: Indent["indentType"]) => {
    setIndentType(value);
    setLines([createEmptyLine()]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!requestedBy.trim() || !requisitionDate) {
      alert("Requested By and Requisition Date are required.");
      return;
    }

    const validLines = lines.filter((line) => line.materialId && Number(line.qty) > 0);
    if (validLines.length === 0 || validLines.length !== lines.length) {
      alert("Please select a material and enter a quantity greater than 0 for every row.");
      return;
    }

    const missingMaterials = validLines.some((line) => !activeMaterials.find((material) => material.id === line.materialId));
    if (missingMaterials) {
      alert("One or more selected materials are no longer available for the chosen indent type.");
      return;
    }

    setIsSubmitting(true);
    const timestamp = new Date().toISOString();
    const indentId = crypto.randomUUID();

    const nextLines: IndentLine[] = validLines.map((line) => {
      const material = activeMaterials.find((row) => row.id === line.materialId) as Material;
      return {
        id: crypto.randomUUID(),
        indentId,
        erpCode: material.erpCode,
        materialId: material.id,
        uom: getIndentLineUom(indentType, material),
        qty: Number(line.qty),
        targetDeliveryDate: (line.targetDeliveryDate || requisitionDate || "").trim() || undefined,
        orderedQty: 0,
        cancelledQty: 0,
        balanceQty: Number(line.qty),
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
    });
    const totals = summarizeIndentLines(nextLines);

    const nextIndent: Indent = {
      id: indentId,
      requestedBy: requestedBy.trim(),
      requisitionDate,
      requiredDate: requisitionDate,
      indentType,
      status: "Pending",
      totalIndentQty: totals.totalIndentQty,
      totalOrderedQty: totals.totalOrderedQty,
      totalCancelledQty: totals.totalCancelledQty,
      totalBalanceQty: totals.totalBalanceQty,
      updatedBy: "System User",
      updateTimestamp: timestamp,
    };

    try {
      await setIndents([nextIndent, ...indents]);
      await setIndentLines([...indentLines, ...nextLines]);
      setRequestedBy(requestedByOptions[0]?.value || "System");
      setRequisitionDate(new Date().toISOString().split("T")[0]);
      setIndentType("Reel");
      setLines([createEmptyLine()]);
      alert("Indent saved successfully.");
    } catch (error) {
      console.error("Failed to save indent:", error);
      alert("Failed to save indent. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white rounded-xl border border-black p-6 shadow-sm space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">New Indent</h2>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-5 py-2 rounded border border-black text-black font-bold hover:bg-slate-50 transition"
        >
          Back
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-blue-700 font-bold">
              Requested By <span className="text-red-500">*</span>
            </label>
            <Select
              options={requestedByOptions}
              value={requestedBy}
              onChange={setRequestedBy}
              required
              placeholder="Select user..."
            />
          </div>
          <div className="space-y-2">
            <label className="text-blue-700 font-bold">
              Requisition Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={requisitionDate}
              onChange={(e) => setRequisitionDate(e.target.value)}
              required
              className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-blue-700 font-bold">
            Indent Type <span className="text-red-500">*</span>
          </label>
          <select
            value={indentType}
            onChange={(e) => handleTypeChange(e.target.value as Indent["indentType"])}
            required
            className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          >
            <option value="Reel">Reel</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="rounded-xl border border-black overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-black bg-slate-50">
            <h3 className="text-sm font-bold uppercase tracking-tight text-blue-700">Items</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/masters/materials")}
                className="px-4 py-2 rounded border border-black text-indigo-700 font-bold hover:bg-white transition"
              >
                + New Item
              </button>
              <button
                type="button"
                onClick={handleAddRow}
                className="px-4 py-2 rounded border border-black text-indigo-700 font-bold hover:bg-white transition"
              >
                + Add Row
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 z-30">
                <tr className="bg-indigo-700 text-white">
                  <th className="px-4 py-3 text-left text-sm font-bold border-2 border-black">ERP</th>
                  <th className="px-4 py-3 text-left text-sm font-bold border-2 border-black min-w-[420px]">Select Item <span className="text-red-200">*</span></th>
                  <th className="px-4 py-3 text-left text-sm font-bold border-2 border-black">Unit</th>
                  <th className="px-4 py-3 text-right text-sm font-bold border-2 border-black">Qty <span className="text-red-200">*</span></th>
                  <th className="px-4 py-3 text-left text-sm font-bold border-2 border-black min-w-[180px]">Target Delivery</th>
                  <th className="px-4 py-3 text-center text-sm font-bold border-2 border-black w-16"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const material = activeMaterials.find((row) => row.id === line.materialId);
                  return (
                    <tr key={line.id} className="bg-white">
                      <td className="px-3 py-3 border-2 border-black">
                        <input
                          value={material?.erpCode ? String(material.erpCode) : "Auto"}
                          readOnly
                          className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-black"
                        />
                      </td>
                      <td className="px-3 py-3 border-2 border-black">
                        <Select
                          options={materialOptions}
                          value={line.materialId}
                          onChange={(value) => handleLineChange(line.id, "materialId", value)}
                          placeholder={activeMaterials.length === 0 ? "No material available..." : "Select Item..."}
                        />
                      </td>
                      <td className="px-3 py-3 border-2 border-black">
                        <input
                          value={getIndentLineUom(indentType, material)}
                          readOnly
                          className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-black"
                        />
                      </td>
                      <td className="px-3 py-3 border-2 border-black">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.qty}
                          onChange={(e) => handleLineChange(line.id, "qty", e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-right text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                        />
                      </td>
                      <td className="px-3 py-3 border-2 border-black">
                        <input
                          type="date"
                          value={line.targetDeliveryDate}
                          onChange={(e) => handleLineChange(line.id, "targetDeliveryDate", e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                        />
                      </td>
                      <td className="px-3 py-3 border-2 border-black text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(line.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition"
                          title="Remove row"
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
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center min-w-[160px] rounded bg-indigo-600 px-6 py-3 font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save Indent"}
          </button>
        </div>
      </form>
    </div>
    </>
  );
}
