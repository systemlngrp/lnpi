import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, Download, Eye, XCircle } from "lucide-react";
import { useData } from "../hooks/useData";
import { ExcelExport } from "../components/ExcelExport";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { Indent, IndentLine, Material, Setting } from "../types";
import { downloadIndentPdf } from "../lib/indentPdf";

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

function ActionButton({
  label,
  onClick,
  tone = "primary",
  disabled = false,
  loading = false,
}: {
  label: string;
  onClick: () => void;
  tone?: "primary" | "danger" | "success";
  disabled?: boolean;
  loading?: boolean;
}) {
  const className =
    tone === "danger"
      ? "bg-red-100 text-red-800 border-red-700 hover:bg-red-200"
      : tone === "success"
        ? "bg-emerald-100 text-emerald-800 border-emerald-700 hover:bg-emerald-200"
        : "bg-sky-100 text-sky-800 border-sky-800 hover:bg-sky-200";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center min-w-[120px] rounded border px-4 py-2 text-xs font-bold uppercase tracking-wider transition disabled:opacity-50",
        className
      )}
    >
      {loading ? <Spinner size={16} /> : label}
    </button>
  );
}

function IndentQueue({ mode }: { mode: QueueMode }) {
  const navigate = useNavigate();
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [settings] = useData<Setting>("settings", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  const exportRows = useMemo(
    () =>
      visibleIndents.map((indent) => ({
        "Requested By": indent.requestedBy,
        "Requisition Date": formatDate(indent.requisitionDate),
        "Required Date": formatDate(indent.requiredDate),
        "Indent Type": indent.indentType,
        Status: indent.status,
        Items: getLineSummary(
          indentLines.filter((line) => line.indentId === indent.id),
          materials
        ),
        "Rejected Remarks": indent.rejectedRemarks || "",
      })),
    [indentLines, materials, visibleIndents]
  );

  const updateIndent = async (indent: Indent, nextStatus: Indent["status"], remarks?: string) => {
    setSubmittingId(indent.id);
    const timestamp = new Date().toISOString();
    const nextIndent: Indent = {
      ...indent,
      status: nextStatus,
      updatedBy: "System User",
      updateTimestamp: timestamp,
      approvedTimestamp: nextStatus === "Approved" ? timestamp : indent.approvedTimestamp,
      approvedBy: nextStatus === "Approved" ? "System User" : indent.approvedBy,
      completedTimestamp: nextStatus === "Completed" ? timestamp : indent.completedTimestamp,
      completedBy: nextStatus === "Completed" ? "System User" : indent.completedBy,
      rejectedTimestamp: nextStatus === "Rejected" ? timestamp : indent.rejectedTimestamp,
      rejectedBy: nextStatus === "Rejected" ? "System User" : indent.rejectedBy,
      rejectedRemarks: nextStatus === "Rejected" ? remarks || indent.rejectedRemarks || "" : indent.rejectedRemarks,
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

  const handleDownloadPdf = async (indent: Indent) => {
    setDownloadingId(indent.id);
    try {
      await downloadIndentPdf({
        indent,
        lines: indentLines.filter((line) => line.indentId === indent.id),
        materials,
        setting: settings[0],
      });
    } catch (error) {
      console.error("Failed to download indent PDF:", error);
      alert("Failed to generate indent PDF.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{getQueueTitle(mode)}</h2>
        <ExcelExport data={exportRows} fileName={`Indent_${mode}`} />
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Requested By</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Requisition Date</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Required Date</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Indent Type</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Items</th>
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
                  colSpan={mode === "Rejected" ? 7 : 6}
                  className="border border-black px-6 py-10 text-center font-medium text-black"
                >
                  No indent records found.
                </td>
              </tr>
            ) : (
              visibleIndents.map((indent) => {
                const lineRows = indentLines.filter((line) => line.indentId === indent.id);
                return (
                  <tr key={indent.id} className="hover:bg-slate-50">
                    <td className="border border-black px-4 py-4 text-sm text-black">{indent.requestedBy}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(indent.requisitionDate)}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(indent.requiredDate)}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black">{indent.indentType}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black min-w-[360px]">
                      <ul className="space-y-1">
                        {lineRows.map((line) => {
                          const material = materials.find((row) => row.id === line.materialId);
                          return (
                            <li key={line.id}>
                              <span className="font-medium">{material?.name || line.erpCode || "Unknown Material"}</span>
                              <span className="ml-2">[{line.qty} {line.uom || ""}]</span>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
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
                          onClick={() => void handleDownloadPdf(indent)}
                          disabled={downloadingId === indent.id}
                          title="Download PDF"
                          className="inline-flex h-9 w-9 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-50 transition disabled:opacity-50"
                        >
                          {downloadingId === indent.id ? <Spinner size={16} /> : <Download size={16} />}
                        </button>
                        {mode === "Pending" ? (
                          <>
                            <ActionButton
                              label={confirmId === indent.id ? "Confirm?" : "Approve"}
                              onClick={() => handleApprove(indent)}
                              tone="primary"
                              loading={submittingId === indent.id}
                            />
                            <button
                              type="button"
                              onClick={() => handleReject(indent)}
                              disabled={submittingId === indent.id}
                              className="inline-flex items-center justify-center rounded border border-red-700 bg-red-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-800 hover:bg-red-200 transition disabled:opacity-50"
                            >
                              <XCircle size={14} className="mr-2" />
                              Reject
                            </button>
                          </>
                        ) : null}
                        {mode === "Approved" ? (
                          <button
                            type="button"
                            onClick={() => handleComplete(indent)}
                            disabled={submittingId === indent.id}
                            className="inline-flex items-center justify-center min-w-[130px] rounded border border-emerald-700 bg-emerald-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-800 hover:bg-emerald-200 transition disabled:opacity-50"
                          >
                            {submittingId === indent.id ? <Spinner size={16} /> : <><CheckCircle size={14} className="mr-2" />{confirmId === indent.id ? "Confirm?" : "Complete"}</>}
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
