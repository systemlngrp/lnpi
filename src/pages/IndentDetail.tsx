import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { useData } from "../hooks/useData";
import { Indent, IndentLine, Material, Setting } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { downloadIndentPdf } from "../lib/indentPdf";

export function IndentDetail() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [indents] = useData<Indent>("indents", []);
  const [indentLines, setIndentLines] = useData<IndentLine>("indent-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [settings] = useData<Setting>("settings", []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const indent = useMemo(() => indents.find((row) => row.id === id) || null, [id, indents]);
  const lineRows = useMemo(() => indentLines.filter((line) => line.indentId === id), [id, indentLines]);
  const [editableQty, setEditableQty] = useState<Record<string, string>>({});
  const currentSetting = settings[0];

  const canEdit = indent?.status === "Pending";

  const lineValues = useMemo(
    () =>
      lineRows.map((line) => ({
        ...line,
        material: materials.find((row) => row.id === line.materialId) || null,
        qtyValue: editableQty[line.id] ?? String(Number(line.qty || 0)),
      })),
    [editableQty, lineRows, materials]
  );
  const handleQtyChange = (lineId: string, value: string) => {
    setEditableQty((prev) => ({ ...prev, [lineId]: value }));
  };

  const handleSave = async () => {
    if (!indent || !canEdit) return;

    const invalidLine = lineValues.find((line) => {
      const qty = Number(line.qtyValue);
      return !line.qtyValue.trim() || !Number.isFinite(qty) || qty <= 0;
    });

    if (invalidLine) {
      alert("Please enter a quantity greater than 0 for every line item.");
      return;
    }

    setIsSubmitting(true);
    const timestamp = new Date().toISOString();
    const nextLines = indentLines.map((line) => {
      if (line.indentId !== indent.id) return line;
      const qtyValue = editableQty[line.id];
      if (qtyValue === undefined) return line;
      return {
        ...line,
        qty: Number(qtyValue),
        updateTimestamp: timestamp,
        updatedBy: "System User",
      };
    });

    try {
      await setIndentLines(nextLines);
      setEditableQty({});
      alert("Indent quantities updated.");
    } catch (error) {
      console.error("Failed to update indent lines:", error);
      alert("Failed to update indent lines. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!indent) return;
    setIsDownloadingPdf(true);
    try {
      await downloadIndentPdf({
        indent,
        lines: lineValues.map((line) => ({
          id: line.id,
          indentId: line.indentId,
          erpCode: line.erpCode,
          materialId: line.materialId,
          uom: line.uom,
          qty: Number(line.qtyValue || line.qty || 0),
          updatedBy: line.updatedBy,
          updateTimestamp: line.updateTimestamp,
        })),
        materials,
        setting: currentSetting,
      });
    } catch (error) {
      console.error("Failed to download indent PDF:", error);
      alert("Failed to generate indent PDF.");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  if (!indent) {
    return (
      <div className="bg-white rounded-xl border border-black p-6 shadow-sm space-y-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Indent Detail</h2>
        <p className="text-black font-medium">Indent not found.</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-5 py-2 rounded border border-black text-black font-bold hover:bg-slate-50 transition"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-black p-6 shadow-sm space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-black uppercase tracking-tight">Indent Detail</h2>
            <p className="mt-1 text-sm font-medium text-slate-600">
              Review line items{canEdit ? " and update quantities before approval." : "."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={isDownloadingPdf}
              className="inline-flex items-center justify-center min-w-[140px] rounded border border-black bg-white px-5 py-2 font-bold text-black hover:bg-slate-50 transition disabled:opacity-50"
            >
              {isDownloadingPdf ? <Spinner size={18} /> : <><Download size={16} className="mr-2" />Download PDF</>}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-5 py-2 rounded border border-black text-black font-bold hover:bg-slate-50 transition"
            >
              Back
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center min-w-[140px] rounded bg-indigo-600 px-5 py-2 font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {isSubmitting ? <Spinner size={18} className="text-white" /> : "Save Changes"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded border border-black bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Requested By</div>
            <div className="mt-1 text-sm font-bold text-black">{indent.requestedBy}</div>
          </div>
          <div className="rounded border border-black bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Requisition Date</div>
            <div className="mt-1 text-sm font-bold text-black">{formatDate(indent.requisitionDate)}</div>
          </div>
          <div className="rounded border border-black bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Required Date</div>
            <div className="mt-1 text-sm font-bold text-black">{formatDate(indent.requiredDate)}</div>
          </div>
          <div className="rounded border border-black bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Status</div>
            <div className="mt-1 text-sm font-bold text-black">{indent.status}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-black">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-indigo-700 text-white">
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold">ERP</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold">Material</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold">Unit</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {lineValues.length === 0 ? (
                <tr>
                  <td colSpan={4} className="border-2 border-black px-6 py-10 text-center font-medium text-black">
                    No line items found.
                  </td>
                </tr>
              ) : (
                lineValues.map((line) => (
                  <tr key={line.id} className="bg-white">
                    <td className="border-2 border-black px-4 py-4 text-sm text-black">{line.erpCode || ""}</td>
                    <td className="border-2 border-black px-4 py-4 text-sm text-black">{line.material?.name || "Unknown Material"}</td>
                    <td className="border-2 border-black px-4 py-4 text-sm text-black">{line.uom || line.material?.uom || ""}</td>
                    <td className="border-2 border-black px-4 py-4 text-sm text-black">
                      {canEdit ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.qtyValue}
                          onChange={(e) => handleQtyChange(line.id, e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-right text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                        />
                      ) : (
                        <div className="text-right font-medium">{Number(line.qty).toLocaleString()}</div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
