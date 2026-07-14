import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { CheckCircle, Eye, FileText, RotateCcw, ThumbsUp, X } from "lucide-react";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { renderOrganizationHeader } from "../lib/pdfOrganizationHeader";
import { Indent, IndentLine, Material, Setting } from "../types";
import { canIndentBeUnapproved, revertIndentToPending, withIndentTotals } from "../lib/indentTotals";

type QueueMode = "Pending" | "Approved" | "Completed" | "Rejected";

function getQueueTitle(mode: QueueMode) {
  return mode === "Pending"
    ? "Indent: Pending"
    : mode === "Approved"
      ? "Indent: Approved"
      : mode === "Completed"
        ? "Indent: Completed"
        : "Indent: Rejected";
}

function getLineSummary(lines: IndentLine[], materials: Material[]) {
  return lines
    .map((line) => {
      const material = materials.find((row) => row.id === line.materialId);
      const name = material?.name || line.erpCode || "Unknown Material";
      return `${name} (${line.qty} ${line.uom || ""})`.trim();
    })
    .join(", ");
}

function IndentQueue({ mode }: { mode: QueueMode }) {
  const navigate = useNavigate();
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [settings] = useData<Setting>("settings", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [unapproveConfirmId, setUnapproveConfirmId] = useState<string | null>(null);
  const [pdfIndentId, setPdfIndentId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const currentSetting = settings[0];

  const visibleIndents = useMemo(
    () =>
      indents
        .filter((indent) => {
          if (indent.status !== mode) return false;
          if (!searchTerm.trim()) return true;
          
          const q = searchTerm.toLowerCase().trim();
          const indentLinesForThis = indentLines.filter(l => l.indentId === indent.id);
          const itemSummary = getLineSummary(indentLinesForThis, materials).toLowerCase();
          
          return (
            (indent.indentNo || "").toLowerCase().includes(q) ||
            (indent.requestedBy || "").toLowerCase().includes(q) ||
            (indent.indentType || "").toLowerCase().includes(q) ||
            itemSummary.includes(q)
          );
        })
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.requisitionDate || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.requisitionDate || 0).getTime();
          return timeB - timeA;
        }),
    [indents, mode, searchTerm, indentLines, materials]
  );

  const displayRows = useMemo(
    () =>
      mode === "Pending"
        ? visibleIndents.flatMap((indent) =>
            indentLines
              .filter((line) => line.indentId === indent.id)
              .map((line) => ({ indent, line }))
          )
        : visibleIndents.map((indent) => ({ indent, line: null as IndentLine | null })),
    [indentLines, mode, visibleIndents]
  );

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedDisplayRows,
  } = useClientPagination(displayRows, 25);

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text(getQueueTitle(mode), 14, 16);
    doc.setFontSize(10);
    doc.text(`Total Records: ${visibleIndents.length}`, 14, 24);

    if (mode === "Pending") {
      const pendingRows = visibleIndents.flatMap((indent) =>
        indentLines
          .filter((line) => line.indentId === indent.id)
          .map((line) => {
            const material = materials.find((row) => row.id === line.materialId);
            return [
              indent.indentNo || indent.id,
              indent.requestedBy || "",
              formatDate(indent.requisitionDate),
              formatDate(indent.requiredDate),
              line.erpCode || "",
              material?.name || line.erpCode || "Unknown Material",
              Number(line.qty || 0).toLocaleString(),
              line.uom || "",
              line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "",
            ];
          })
      );

      autoTable(doc, {
        head: [[
          "Requisition No",
          "Requested By",
          "Requisition Date",
          "Required Date",
          "ERP",
          "Item",
          "Qty",
          "Unit",
          "Target Delivery",
        ]],
        body: pendingRows,
        startY: 30,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235] },
        columnStyles: {
          5: { cellWidth: 72 },
        },
      });
    } else {
      autoTable(doc, {
        head: [[
          "Requisition No",
          "Requested By",
          "Requisition Date",
          "Required Date",
          "Indent Type",
          "Items",
        ]],
        body: visibleIndents.map((indent) => {
          const lineRows = indentLines.filter((row) => row.indentId === indent.id);
          return [
            indent.indentNo || indent.id,
            indent.requestedBy || "",
            formatDate(indent.requisitionDate),
            formatDate(indent.requiredDate),
            indent.indentType || "",
            getLineSummary(lineRows, materials),
          ];
        }),
        startY: 30,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235] },
        columnStyles: {
          5: { cellWidth: 120 },
        },
      });
    }

    doc.save(`${getQueueTitle(mode).replace(/[^a-z0-9]+/gi, "_")}.pdf`);
  };

  const handleRowPdf = async (indent: Indent) => {
    const lineRows = indentLines.filter((row) => row.indentId === indent.id);
    const doc = new jsPDF("p", "mm", "a4");
    setPdfIndentId(indent.id);

    try {
      const { currentY } = await renderOrganizationHeader(doc, currentSetting, { startY: 12 });
      let y = currentY;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Indent Document", 105, y, { align: "center" });
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`Indent No: ${indent.indentNo || indent.id}`, 14, y);
      doc.text(`Status: ${indent.status}`, 140, y);
      y += 6;
      doc.text(`Requested By: ${indent.requestedBy || "-"}`, 14, y);
      doc.text(`Indent Type: ${indent.indentType || "-"}`, 140, y);
      y += 6;
      doc.text(`Requisition Date: ${formatDate(indent.requisitionDate)}`, 14, y);
      doc.text(`Required Date: ${formatDate(indent.requiredDate)}`, 140, y);
      y += 6;

      const totalsIndent = withIndentTotals(indent, lineRows);
      doc.text(`Total Indent Qty: ${Number(totalsIndent.totalIndentQty || 0).toLocaleString()}`, 14, y);
      doc.text(`Balance Qty: ${Number(totalsIndent.totalBalanceQty || 0).toLocaleString()}`, 140, y);
      y += 8;

      if (indent.rejectedRemarks?.trim()) {
        doc.setFont("helvetica", "bold");
        doc.text("Remarks:", 14, y);
        doc.setFont("helvetica", "normal");
        const remarksLines = doc.splitTextToSize(indent.rejectedRemarks.trim(), 170);
        doc.text(remarksLines, 32, y);
        y += Math.max(6, remarksLines.length * 5 + 2);
      }

      autoTable(doc, {
        startY: y,
        theme: "grid",
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 8, cellPadding: 2 },
        head: [[
          "ERP",
          "Item",
          "Qty",
          "Unit",
          "Target Delivery",
          "Ordered Qty",
          "Cancelled Qty",
          "Balance Qty",
        ]],
        body: lineRows.map((row) => {
          const rowMaterial = materials.find((m) => m.id === row.materialId);
          return [
            row.erpCode || "",
            rowMaterial?.name || row.erpCode || "Unknown Material",
            Number(row.qty || 0).toLocaleString(),
            row.uom || "",
            row.targetDeliveryDate ? formatDate(row.targetDeliveryDate) : "-",
            Number(row.orderedQty || 0).toLocaleString(),
            Number(row.cancelledQty || 0).toLocaleString(),
            Number(row.balanceQty || 0).toLocaleString(),
          ];
        }),
      });

      doc.save(`Indent_${indent.indentNo || indent.id}.pdf`);
    } finally {
      setPdfIndentId(null);
    }
  };

  const updateIndent = async (indent: Indent, nextStatus: Indent["status"], remarks?: string) => {
    setSubmittingId(indent.id);
    const timestamp = new Date().toISOString();
    const indentSpecificLines = indentLines.filter((line) => line.indentId === indent.id);
    const nextIndentBase = withIndentTotals(indent, indentSpecificLines);
    const resolvedStatus =
      nextStatus === "Approved" && Number(nextIndentBase.totalBalanceQty || 0) <= 0
        ? "Completed"
        : nextStatus;
    const nextIndent: Indent = {
      ...nextIndentBase,
      updatedBy: "System User",
      updateTimestamp: timestamp,
      status: resolvedStatus,
      approvedTimestamp: resolvedStatus === "Approved" || resolvedStatus === "Completed" ? (indent.approvedTimestamp || timestamp) : indent.approvedTimestamp,
      approvedBy: resolvedStatus === "Approved" || resolvedStatus === "Completed" ? (indent.approvedBy || "System User") : indent.approvedBy,
      completedTimestamp: resolvedStatus === "Completed" ? (indent.completedTimestamp || timestamp) : indent.completedTimestamp,
      completedBy: resolvedStatus === "Completed" ? (indent.completedBy || "System User") : indent.completedBy,
      rejectedTimestamp: resolvedStatus === "Rejected" ? timestamp : indent.rejectedTimestamp,
      rejectedBy: resolvedStatus === "Rejected" ? "System User" : indent.rejectedBy,
      rejectedRemarks: resolvedStatus === "Rejected" ? remarks || indent.rejectedRemarks || "" : indent.rejectedRemarks,
    };

    try {
      await setIndents(indents.map((row) => (row.id === indent.id ? nextIndent : row)));
      setConfirmId(null);
    } catch (error) {
      console.error(`Failed to update indent ${indent.id}:`, error);
      alert("Failed to update indent. Please try again.");
    } finally {
      setSubmittingId(null);
    }
  };

  const handleApprove = async (indent: Indent) => {
    if (confirmId !== indent.id) {
      setConfirmId(indent.id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    await updateIndent(indent, "Approved");
  };

  const handleComplete = async (indent: Indent) => {
    if (confirmId !== indent.id) {
      setConfirmId(indent.id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    await updateIndent(indent, "Completed");
  };

  const handleReject = async (indent: Indent) => {
    const remarks = window.prompt("Enter rejection remarks");
    if (remarks === null) return;
    if (!remarks.trim()) {
      alert("Rejection remarks are required.");
      return;
    }
    await updateIndent(indent, "Rejected", remarks.trim());
  };

  const handleUnapprove = async (indent: Indent) => {
    const indentSpecificLines = indentLines.filter((line) => line.indentId === indent.id);
    if (!canIndentBeUnapproved(indentSpecificLines)) {
      alert("This indent cannot be unapproved because PO quantity has already been created against it.");
      return;
    }

    if (unapproveConfirmId !== indent.id) {
      setUnapproveConfirmId(indent.id);
      setConfirmId(null);
      setTimeout(() => setUnapproveConfirmId(null), 3000);
      return;
    }

    setSubmittingId(indent.id);
    try {
      const nextIndent = revertIndentToPending(indent, indentSpecificLines);
      await setIndents(indents.map((row) => (row.id === indent.id ? nextIndent : row)));
      setUnapproveConfirmId(null);
    } catch (error) {
      console.error(`Failed to unapprove indent ${indent.id}:`, error);
      alert("Failed to move indent back to Pending.");
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{getQueueTitle(mode)}</h2>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="bg-slate-100">
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black whitespace-nowrap">Requisition No</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Requested By</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Requisition Date</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Required Date</th>
              {mode === "Pending" ? (
                <>
                  <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">ERP</th>
                  <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black min-w-[320px]">Item</th>
                  <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Qty</th>
                  <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Unit</th>
                  <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Target Delivery</th>
                </>
              ) : (
                <>
                  <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Indent Type</th>
                  <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Items</th>
                </>
              )}
              {mode === "Rejected" ? (
                <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Remarks</th>
              ) : null}
              {(mode === "Pending" || mode === "Approved" || mode === "Completed" || mode === "Rejected") ? (
                <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {paginatedDisplayRows.length === 0 ? (
              <tr>
                <td
                  colSpan={mode === "Pending" ? 10 : mode === "Rejected" ? 8 : 7}
                  className="border border-black px-6 py-10 text-center font-medium text-black"
                >
                  No indent records found.
                </td>
              </tr>
            ) : (
              paginatedDisplayRows.map(({ indent, line }) => {
                const lineRows = indentLines.filter((row) => row.indentId === indent.id);
                const material = line ? materials.find((row) => row.id === line.materialId) : null;
                const canUnapprove = mode === "Approved" && canIndentBeUnapproved(lineRows);

                return (
                  <tr key={line ? `${indent.id}-${line.id}` : indent.id} className="hover:bg-slate-50">
                    <td className="border border-black px-4 py-4 text-sm font-bold text-black whitespace-nowrap">
                      {indent.indentNo || indent.id}
                    </td>
                    <td className="border border-black px-4 py-4 text-sm text-black">{indent.requestedBy}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(indent.requisitionDate)}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(indent.requiredDate)}</td>
                    {mode === "Pending" ? (
                      <>
                        <td className="border border-black px-4 py-4 text-sm text-black">{line?.erpCode || ""}</td>
                        <td className="border border-black px-4 py-4 text-sm text-black min-w-[320px]">
                          {material?.name || line?.erpCode || "Unknown Material"}
                        </td>
                        <td className="border border-black px-4 py-4 text-sm text-black text-right">{Number(line?.qty || 0).toLocaleString()}</td>
                        <td className="border border-black px-4 py-4 text-sm text-black">{line?.uom || ""}</td>
                        <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">
                          {line?.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : ""}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="border border-black px-4 py-4 text-sm text-black">{indent.indentType}</td>
                        <td className="border border-black px-4 py-4 text-sm text-black min-w-[360px]">
                          <ul className="space-y-1">
                            {lineRows.map((row) => {
                              const rowMaterial = materials.find((m) => m.id === row.materialId);
                              return (
                                <li key={row.id}>
                                  <span className="font-medium">{rowMaterial?.name || row.erpCode || "Unknown Material"}</span>
                                  <span className="ml-2">[{row.qty} {row.uom || ""}]</span>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </>
                    )}
                    {mode === "Rejected" ? (
                      <td className="border border-black px-4 py-4 text-sm text-black">{indent.rejectedRemarks || ""}</td>
                    ) : null}
                    <td className="border border-black px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/indent/view/${indent.id}`)}
                          title="View Indent"
                          className="inline-flex h-9 w-9 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-50 transition"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRowPdf(indent)}
                          disabled={pdfIndentId === indent.id}
                          title="Download PDF"
                          className="inline-flex h-9 w-9 items-center justify-center rounded border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                        >
                          {pdfIndentId === indent.id ? <Spinner size={16} /> : <FileText size={16} />}
                        </button>
                        {mode === "Pending" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(indent)}
                              disabled={submittingId === indent.id}
                              title={confirmId === indent.id ? "Confirm Approve" : "Approve"}
                              className={cn(
                                "inline-flex h-9 w-9 items-center justify-center rounded border transition disabled:opacity-50",
                                confirmId === indent.id
                                  ? "border-amber-700 bg-amber-100 text-amber-800"
                                  : "border-sky-800 bg-sky-100 text-sky-800 hover:bg-sky-200"
                              )}
                            >
                              {submittingId === indent.id ? <Spinner size={16} /> : <ThumbsUp size={16} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(indent)}
                              disabled={submittingId === indent.id}
                              title="Reject"
                              className="inline-flex h-9 w-9 items-center justify-center rounded border border-red-700 bg-red-100 text-red-800 hover:bg-red-200 transition disabled:opacity-50"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : null}
                        {mode === "Approved" ? (
                          <button
                            type="button"
                            onClick={() => void handleUnapprove(indent)}
                            disabled={submittingId === indent.id || !canUnapprove}
                            title={
                              canUnapprove
                                ? (unapproveConfirmId === indent.id ? "Confirm Unapprove" : "Move back to Pending")
                                : "Cannot unapprove after PO quantity has been created"
                            }
                            className={cn(
                              "inline-flex h-9 w-9 items-center justify-center rounded border transition disabled:opacity-50",
                              unapproveConfirmId === indent.id
                                ? "border-amber-700 bg-amber-100 text-amber-800"
                                : "border-orange-700 bg-orange-100 text-orange-800 hover:bg-orange-200"
                            )}
                          >
                            {submittingId === indent.id ? <Spinner size={16} /> : <RotateCcw size={16} />}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {(mode === "Pending" || mode === "Approved" || mode === "Completed") ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-2 rounded border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100"
          >
            <FileText size={14} />
            PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function IndentPending() {
  return <IndentQueue mode="Pending" />;
}

export function IndentApproved() {
  return <IndentQueue mode="Approved" />;
}

export function IndentCompleted() {
  return <IndentQueue mode="Completed" />;
}

export function IndentRejected() {
  return <IndentQueue mode="Rejected" />;
}
