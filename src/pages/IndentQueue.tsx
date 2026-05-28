import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, Eye, ThumbsUp, X } from "lucide-react";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { Indent, IndentLine, Material } from "../types";
import { withIndentTotals } from "../lib/indentTotals";

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
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const visibleIndents = useMemo(
    () =>
      indents
        .filter((indent) => indent.status === mode)
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.requisitionDate || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.requisitionDate || 0).getTime();
          return timeB - timeA;
        }),
    [indents, mode]
  );

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{getQueueTitle(mode)}</h2>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead>
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
            {visibleIndents.length === 0 ? (
              <tr>
                <td
                  colSpan={mode === "Pending" ? 10 : mode === "Rejected" ? 8 : 7}
                  className="border border-black px-6 py-10 text-center font-medium text-black"
                >
                  No indent records found.
                </td>
              </tr>
            ) : (
              (mode === "Pending"
                ? visibleIndents.flatMap((indent) =>
                    indentLines
                      .filter((line) => line.indentId === indent.id)
                      .map((line) => ({ indent, line }))
                  )
                : visibleIndents.map((indent) => ({ indent, line: null as IndentLine | null }))
              ).map(({ indent, line }) => {
                const lineRows = indentLines.filter((row) => row.indentId === indent.id);
                const material = line ? materials.find((row) => row.id === line.materialId) : null;

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
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
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
