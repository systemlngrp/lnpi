import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { useData } from "../hooks/useData";
import { Indent, IndentLine, Material, Setting } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

async function getImageDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load logo image.");
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read logo image."));
    reader.readAsDataURL(blob);
  });
}

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
  const organizationLogoUrl = useMemo(() => {
    if (!currentSetting?.organizationLogo) return "";
    const encoded = currentSetting.organizationLogo.split("/").map(encodeURIComponent).join("/");
    if (typeof window === "undefined") return `/uploads/${encoded}`;
    return new URL(`/uploads/${encoded}`, window.location.origin).toString();
  }, [currentSetting?.organizationLogo]);

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
      const doc = new jsPDF("p", "mm", "a4");
      let currentY = 16;

      if (organizationLogoUrl) {
        try {
          const imageDataUrl = await getImageDataUrl(organizationLogoUrl);
          doc.addImage(imageDataUrl, "PNG", 90, currentY, 30, 18, undefined, "FAST");
          currentY += 22;
        } catch (error) {
          console.warn("Organization logo could not be added to indent PDF:", error);
        }
      }

      const organizationName = currentSetting?.organizationName?.trim();
      const organizationAddress = currentSetting?.organizationAddress?.trim();
      const organizationGstDetails = currentSetting?.organizationGstDetails?.trim();

      if (organizationName) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(organizationName, 105, currentY, { align: "center" });
        currentY += 7;
      }

      if (organizationAddress) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const addressLines = doc.splitTextToSize(organizationAddress, 160);
        doc.text(addressLines, 105, currentY, { align: "center" });
        currentY += addressLines.length * 5;
      }

      if (organizationGstDetails) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const gstLines = doc.splitTextToSize(organizationGstDetails, 160);
        doc.text(gstLines, 105, currentY, { align: "center" });
        currentY += gstLines.length * 5;
      }

      currentY += 4;
      doc.setDrawColor(0);
      doc.line(14, currentY, 196, currentY);
      currentY += 8;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("INDENT", 105, currentY, { align: "center" });
      currentY += 10;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const detailRows = [
        ["Requested By", indent.requestedBy],
        ["Requisition Date", formatDate(indent.requisitionDate)],
        ["Required Date", formatDate(indent.requiredDate)],
        ["Indent Type", indent.indentType],
        ["Status", indent.status],
      ];

      detailRows.forEach(([label, value], index) => {
        const columnX = index % 2 === 0 ? 14 : 110;
        const rowY = currentY + Math.floor(index / 2) * 8;
        doc.setFont("helvetica", "bold");
        doc.text(`${label}:`, columnX, rowY);
        doc.setFont("helvetica", "normal");
        doc.text(String(value), columnX + 28, rowY);
      });
      currentY += 24;

      const lineTableRows = lineValues.map((line, index) => [
        index + 1,
        line.erpCode || "",
        line.material?.name || "Unknown Material",
        line.uom || line.material?.uom || "",
        Number(line.qtyValue || 0).toLocaleString(),
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [["SL", "ERP", "Material Name", "Unit", "Quantity"]],
        body: lineTableRows,
        theme: "grid",
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 9, cellPadding: 2.5, textColor: 0 },
        columnStyles: {
          0: { halign: "center", cellWidth: 14 },
          1: { cellWidth: 28 },
          2: { cellWidth: 92 },
          3: { halign: "center", cellWidth: 20 },
          4: { halign: "right", cellWidth: 28 },
        },
      });

      let footerY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : currentY + 40;
      if (indent.rejectedRemarks) {
        doc.setFont("helvetica", "bold");
        doc.text("Rejected Remarks:", 14, footerY);
        doc.setFont("helvetica", "normal");
        const remarkLines = doc.splitTextToSize(indent.rejectedRemarks, 175);
        doc.text(remarkLines, 14, footerY + 5);
        footerY += remarkLines.length * 5 + 8;
      }

      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text(`Generated on ${formatDate(new Date().toISOString())}`, 14, Math.min(footerY, 285));

      const safeRequestedBy = indent.requestedBy.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "Indent";
      doc.save(`Indent_${safeRequestedBy}_${indent.requisitionDate}.pdf`);
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
