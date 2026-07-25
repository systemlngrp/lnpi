import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useData } from "../hooks/useData";
import { Material, MaterialIssue, MaterialIssueLine } from "../types";
import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

function formatMoney(value?: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getIssueLineValue(line: MaterialIssueLine) {
  const amount = Number(line.amount || 0);
  if (amount > 0) return amount;
  return Number(line.qty || 0) * Number(line.rate || 0);
}

export function PendingConsumptionTallyPosting() {
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  const materialNameMap = useMemo(() => new Map(materials.map((row) => [row.id, row.name])), [materials]);

  const getItemName = (materialId?: string) => {
    const id = String(materialId || "").trim();
    return materialNameMap.get(id) || id || "-";
  };

  const itemNamesByIssueId = useMemo(() => {
    const issueMap = new Map<string, string>();

    for (const line of issueLines) {
      const issueId = String(line.materialIssueId || "").trim();
      if (!issueId) continue;

      const itemName = getItemName(line.materialId);
      if (!itemName || itemName === "-") continue;

      const existing = issueMap.get(issueId);
      if (!existing) {
        issueMap.set(issueId, itemName);
        continue;
      }

      const existingParts = existing.split(", ").filter(Boolean);
      if (!existingParts.includes(itemName)) {
        existingParts.push(itemName);
        issueMap.set(issueId, existingParts.join(", "));
      }
    }

    return issueMap;
  }, [issueLines, materialNameMap]);

  const itemStatsByIssueId = useMemo(() => {
    const statsMap = new Map<string, { itemCount: number; totalValue: number }>();

    for (const line of issueLines) {
      const issueId = String(line.materialIssueId || "").trim();
      if (!issueId) continue;

      const existing = statsMap.get(issueId) || { itemCount: 0, totalValue: 0 };
      statsMap.set(issueId, {
        itemCount: existing.itemCount + 1,
        totalValue: existing.totalValue + getIssueLineValue(line),
      });
    }

    return statsMap;
  }, [issueLines]);

  const pendingRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...materialIssues]
      .filter((row) => isWithoutJobIssue(row.issueType))
      .filter((row) => String(row.consumptionTransactionNo || "").trim() !== "")
      .filter((row) => String(row.tallyTimestamp || "").trim() === "")
      .filter((row) => !["not applicable", "cancelled"].includes(String(row.tallyPostingStatus || "").trim().toLowerCase()))
      .filter((row) => {
        if (!q) return true;
        const haystack = [
          row.issueNo,
          row.consumptionTransactionNo,
          row.date,
          row.remarks,
          row.tallyPostingStatus,
          row.tallyPostingError,
          itemNamesByIssueId.get(row.id),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort(
        (a, b) =>
          String(a.date || "").localeCompare(String(b.date || "")) ||
          String(a.consumptionTransactionNo || "").localeCompare(String(b.consumptionTransactionNo || "")) ||
          String(a.issueNo || "").localeCompare(String(b.issueNo || ""))
      );
  }, [itemNamesByIssueId, materialIssues, searchTerm]);

  const renderDetailsRow = (row: MaterialIssue) => {
    const selectedLines = issueLines.filter((line) => line.materialIssueId === row.id);

    return (
      <tr key={`${row.id}-details`} className="bg-slate-50">
        <td colSpan={8} className="border-t border-black px-3 py-2">
          <div className="overflow-hidden rounded border border-black bg-white">
            <table className="min-w-full divide-y divide-black text-[11px]">
              <thead className="bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="px-2 py-1 text-left font-black uppercase">Item</th>
                  <th className="px-2 py-1 text-right font-black uppercase">Qty</th>
                  <th className="px-2 py-1 text-left font-black uppercase">UOM</th>
                  <th className="px-2 py-1 text-right font-black uppercase">Rate</th>
                  <th className="px-2 py-1 text-right font-black uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {selectedLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-center text-slate-600">
                      No item lines found.
                    </td>
                  </tr>
                ) : (
                  selectedLines.map((line) => (
                    <tr key={line.id} className="divide-x divide-black">
                      <td className="px-2 py-1 font-semibold">{getItemName(line.materialId)}</td>
                      <td className="px-2 py-1 text-right font-semibold">{Number(line.qty || 0).toLocaleString()}</td>
                      <td className="px-2 py-1">{line.uom || "-"}</td>
                      <td className="px-2 py-1 text-right font-semibold">{formatMoney(line.rate)}</td>
                      <td className="px-2 py-1 text-right font-black text-emerald-700">{formatMoney(getIssueLineValue(line))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Consumption Tally Posting</h2>
          <p className="text-sm font-medium text-slate-600 mt-1">
            Shows non-job issues where <span className="font-bold">tallyTimestamp</span> is blank.
          </p>
        </div>
        <div className="text-sm font-bold text-slate-700">Pending: {pendingRows.length}</div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search issue no, consumption no, date, error, item..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Consumption No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">No. of Items</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total Value</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remark</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {pendingRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No pending Consumption Tally posting rows found.
                  </td>
                </tr>
              ) : (
                pendingRows.map((row) => {
                  const isExpanded = expandedIssueId === row.id;
                  const itemStats = itemStatsByIssueId.get(row.id) || { itemCount: 0, totalValue: 0 };
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="divide-x divide-black hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-bold">
                          <button
                            type="button"
                            title={isExpanded ? "Hide item details" : "Show item details"}
                            onClick={() => setExpandedIssueId(isExpanded ? null : row.id)}
                            className="flex items-start gap-2 text-left font-bold text-black hover:text-sky-800"
                          >
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-black bg-white">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                            <span>{row.issueNo}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-indigo-700">{row.consumptionTransactionNo || "-"}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(row.date) || "-"}</td>
                        <td className="px-4 py-3 text-right text-sm font-black text-slate-800">{itemStats.itemCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-sm font-black text-emerald-700">{formatMoney(itemStats.totalValue)}</td>
                        <td className="px-4 py-3 text-sm">{row.tallyPostingStatus || "-"}</td>
                        <td className="px-4 py-3 text-sm">{row.tallyPostingRemark || row.remarks || "-"}</td>
                        <td className="px-4 py-3 text-sm text-red-700">{row.tallyPostingError || "-"}</td>
                      </tr>
                      {isExpanded ? renderDetailsRow(row) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
