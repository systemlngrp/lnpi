import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ChevronDown, ChevronRight, Eye, FileText, RotateCcw, Search, ThumbsUp, X } from "lucide-react";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";

import { Select } from "../components/Select";
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


function makeOptions(values: Array<string | number>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

function toDateOnly(value?: string) {
  return String(value || "").split("T")[0];
}

function getIndentLineItemName(line: IndentLine, materialById: Map<string, Material>) {
  return materialById.get(line.materialId)?.name || String(line.erpCode || "Unknown Material");
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
  const [requestedByFilter, setRequestedByFilter] = useState("");
  const [indentTypeFilter, setIndentTypeFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedIndentIds, setExpandedIndentIds] = useState<Set<string>>(new Set());

  const currentSetting = settings[0];
  const showExpandableItems = mode !== "Pending";

  const toggleIndentItems = (indentId: string) => {
    setExpandedIndentIds((prev) => {
      const next = new Set(prev);
      if (next.has(indentId)) next.delete(indentId);
      else next.add(indentId);
      return next;
    });
  };

  const materialById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);

  const statusIndents = useMemo(
    () => indents.filter((indent) => indent.status === mode),
    [indents, mode]
  );

  const requestedByOptions = useMemo(() => makeOptions(statusIndents.map((indent) => indent.requestedBy)), [statusIndents]);
  const indentTypeOptions = useMemo(() => makeOptions(statusIndents.map((indent) => indent.indentType)), [statusIndents]);
  const itemOptions = useMemo(() => {
    const statusIndentIds = new Set(statusIndents.map((indent) => indent.id));
    return makeOptions(
      indentLines
        .filter((line) => statusIndentIds.has(line.indentId))
        .map((line) => getIndentLineItemName(line, materialById))
    );
  }, [indentLines, materialById, statusIndents]);

  const visibleIndents = useMemo(
    () =>
      statusIndents
        .filter((indent) => {
          const indentDate = toDateOnly(indent.requisitionDate);
          if (requestedByFilter && indent.requestedBy !== requestedByFilter) return false;
          if (indentTypeFilter && indent.indentType !== indentTypeFilter) return false;
          if (dateFrom && indentDate < dateFrom) return false;
          if (dateTo && indentDate > dateTo) return false;

          const indentLinesForThis = indentLines.filter((line) => line.indentId === indent.id);
          if (itemFilter && !indentLinesForThis.some((line) => getIndentLineItemName(line, materialById) === itemFilter)) return false;

          const q = searchTerm.toLowerCase().trim();
          if (!q) return true;
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
    [dateFrom, dateTo, indentLines, indentTypeFilter, itemFilter, materialById, materials, requestedByFilter, searchTerm, statusIndents]
  );

  const displayRows = useMemo(
    () =>
      mode === "Pending"
        ? visibleIndents.flatMap((indent) =>
            indentLines
              .filter((line) => line.indentId === indent.id)
              .filter((line) => !itemFilter || getIndentLineItemName(line, materialById) === itemFilter)
              .map((line) => ({ indent, line }))
          )
        : visibleIndents.map((indent) => ({ indent, line: null as IndentLine | null })),
    [indentLines, itemFilter, materialById, mode, visibleIndents]
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

<div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[minmax(260px,1.4fr)_repeat(5,minmax(145px,1fr))_auto] xl:items-center">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search requisition, requested by, type, item..."
            className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
        </div>
        <Select value={requestedByFilter} onChange={setRequestedByFilter} options={requestedByOptions} placeholder="All Requested By" />
        <Select value={indentTypeFilter} onChange={setIndentTypeFilter} options={indentTypeOptions} placeholder="All Indent Types" />
        <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
        {searchTerm || requestedByFilter || indentTypeFilter || itemFilter || dateFrom || dateTo ? (
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              setRequestedByFilter("");
              setIndentTypeFilter("");
              setItemFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
          >
            Clear Filters
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
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
                  colSpan={mode === "Pending" ? 10 : mode === "Rejected" ? 7 : 6}
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
                  <Fragment key={line ? `${indent.id}-${line.id}` : indent.id}>
                  <tr className="hover:bg-slate-50">
                    <td className="border border-black px-4 py-4 text-sm font-bold text-black whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {showExpandableItems ? (
                          <button
                            type="button"
                            onClick={() => toggleIndentItems(indent.id)}
                            title={expandedIndentIds.has(indent.id) ? "Hide items" : "Show items"}
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-100"
                          >
                            {expandedIndentIds.has(indent.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        ) : null}
                        <span>{indent.indentNo || indent.id}</span>
                      </div>
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
                  {showExpandableItems && expandedIndentIds.has(indent.id) ? (
                    <tr key={`${indent.id}-items`} className="bg-slate-50">
                      <td colSpan={mode === "Rejected" ? 7 : 6} className="border border-black p-0">
                        <div className="p-4">
                          <div className="mb-2 text-xs font-black uppercase text-slate-600">Items</div>
                          <div className="overflow-auto rounded border border-black bg-white">
                            <table className="min-w-full border-collapse">
                              <thead className="bg-slate-100">
                                <tr>
                                  {["ERP", "Item", "Qty", "Unit", "Target Delivery", "Ordered Qty", "Cancelled Qty", "Balance Qty"].map((heading) => (
                                    <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-black uppercase text-black">{heading}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {lineRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={8} className="border border-black px-4 py-6 text-center text-sm text-slate-600">No item lines found.</td>
                                  </tr>
                                ) : (
                                  lineRows.map((row) => {
                                    const rowMaterial = materials.find((m) => m.id === row.materialId);
                                    return (
                                      <tr key={row.id}>
                                        <td className="border border-black px-3 py-2 text-sm text-black">{row.erpCode || ""}</td>
                                        <td className="border border-black px-3 py-2 text-sm font-medium text-black">{rowMaterial?.name || row.erpCode || "Unknown Material"}</td>
                                        <td className="border border-black px-3 py-2 text-right text-sm text-black">{Number(row.qty || 0).toLocaleString()}</td>
                                        <td className="border border-black px-3 py-2 text-sm text-black">{row.uom || ""}</td>
                                        <td className="border border-black px-3 py-2 text-sm text-black">{row.targetDeliveryDate ? formatDate(row.targetDeliveryDate) : ""}</td>
                                        <td className="border border-black px-3 py-2 text-right text-sm text-black">{Number(row.orderedQty || 0).toLocaleString()}</td>
                                        <td className="border border-black px-3 py-2 text-right text-sm text-black">{Number(row.cancelledQty || 0).toLocaleString()}</td>
                                        <td className="border border-black px-3 py-2 text-right text-sm font-bold text-black">{Number(row.balanceQty || 0).toLocaleString()}</td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
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
