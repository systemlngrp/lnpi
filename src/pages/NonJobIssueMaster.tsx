import React, { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { Material, MaterialIn, MaterialIssue, MaterialIssueLine, MaterialIssueReelLine } from "../types";
import { TableControls } from "../components/TableControls";
import { ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { formatDate } from "../lib/serial";
import { calculateMaterialIssueAmount, resolveMaterialIssueRate } from "../lib/materialMovement";

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

const CANCEL_ALLOWED_EMAIL = "pankaj@bizskilledu.com";

function DetailChip({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-[130px] border-r border-slate-300 pr-3 last:border-r-0">
      <span className="mr-1 text-[9px] font-black uppercase text-slate-500">{label}:</span>
      <span className="text-[11px] font-bold text-black">{value || "-"}</span>
    </div>
  );
}

function formatMoney(value?: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function NonJobIssueMaster() {
  const { user } = useAuth();
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const npdItems = useNpdItems();

  const [searchTerm, setSearchTerm] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  const materialNameMap = useMemo(() => {
    const names = new Map(materials.map((row) => [String(row.id), String(row.name || "").trim()]));
    for (const row of npdItems) {
      const id = String((row as any).id || "").trim();
      const name = String((row as any).name || "").trim();
      if (id && name && !names.has(id)) names.set(id, name);
    }
    return names;
  }, [materials, npdItems]);

  const getItemName = (materialId?: string) => {
    const id = String(materialId || "").trim();
    return materialNameMap.get(id) || id || "-";
  };

  const itemNameByIssueId = useMemo(() => {
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

  const canCancelIssues = String(user?.email || "").trim().toLowerCase() === CANCEL_ALLOWED_EMAIL;
  const mainTableColSpan = canCancelIssues ? 9 : 8;

  const issueTotalsByIssueId = useMemo(() => {
    const totalsMap = new Map<string, { totalQty: number; totalValue: number }>();

    for (const line of issueLines) {
      const issueId = String(line.materialIssueId || "").trim();
      if (!issueId) continue;

      const qty = Number(line.qty || 0);
      const fallback = resolveMaterialIssueRate(line.materialId, materials, materialIn, qty, {
        useLatestRateAsOpeningRate: true,
      });
      const savedRate = Number(line.rate || 0);
      const rate = savedRate > 0 ? savedRate : fallback.rate;
      const existing = totalsMap.get(issueId) || { totalQty: 0, totalValue: 0 };

      totalsMap.set(issueId, {
        totalQty: existing.totalQty + qty,
        totalValue: existing.totalValue + calculateMaterialIssueAmount(qty, rate),
      });
    }

    return totalsMap;
  }, [issueLines, materialIn, materials]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return [...materialIssues]
      .filter((row) => isWithoutJobIssue(row.issueType))
      .filter((row) => {
        if (!q) return true;
        const haystack = [row.issueNo, row.consumptionTransactionNo, row.date, row.remarks, row.tallyPostingStatus, itemNameByIssueId.get(row.id)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.issueNo || "").localeCompare(a.issueNo || ""));
  }, [itemNameByIssueId, materialIssues, searchTerm]);

  const handleCancel = (row: MaterialIssue) => {
    if (cancellingId !== row.id) {
      setCancellingId(row.id);
      setTimeout(() => setCancellingId(null), 3000);
      return;
    }

    const timestamp = new Date().toISOString();
    const cancelBy = user?.name || user?.email || CANCEL_ALLOWED_EMAIL;
    setMaterialIssues((prev) =>
      prev.map((entry) =>
        entry.id === row.id
          ? {
              ...entry,
              tallyPostingStatus: "Cancelled",
              tallyTimestamp: timestamp,
              tallyLastAttemptAt: timestamp,
              tallyPostedBy: cancelBy,
              tallyPostingRemark: entry.tallyPostingRemark || `Cancelled by ${CANCEL_ALLOWED_EMAIL}`,
              updatedBy: cancelBy,
              updateTimestamp: timestamp,
            }
          : entry
      )
    );
    setCancellingId(null);
  };

  const renderDetailsRow = (row: MaterialIssue) => {
    const selectedLines = issueLines
      .filter((line) => line.materialIssueId === row.id)
      .map((line) => {
        const fallback = resolveMaterialIssueRate(line.materialId, materials, materialIn, Number(line.qty || 0), {
          useLatestRateAsOpeningRate: true,
        });
        const savedRate = Number(line.rate || 0);
        const rate = savedRate > 0 ? savedRate : fallback.rate;
        return {
          ...line,
          lastPurchaseRate: Number(line.lastPurchaseRate || 0) || fallback.lastPurchaseRate,
          openingRate: Number(line.openingRate || 0) || fallback.openingRate,
          rate,
          amount: calculateMaterialIssueAmount(Number(line.qty || 0), rate),
        };
      });
    const selectedReelLines = issueReelLines.filter((line) => line.materialIssueId === row.id);
    const selectedLineAmountTotal = selectedLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const tallyValues = [
      ["Voucher", row.tallyVoucherNo],
      ["Date", formatDate(row.tallyVoucherDate)],
      ["Type", row.tallyVoucherType],
      ["By", row.tallyPostedBy],
      ["At", row.tallyTimestamp],
      ["Remark", row.tallyPostingRemark],
      ["Error", row.tallyPostingError],
    ].filter(([, value]) => String(value || "").trim());

    return (
      <tr key={`${row.id}-details`} className="bg-slate-50">
        <td colSpan={mainTableColSpan} className="border-t border-black px-3 py-2">
          <div className="space-y-2 text-[11px]">
            <div className="flex flex-wrap gap-x-3 gap-y-1 rounded border border-slate-300 bg-white px-3 py-2">
              <DetailChip label="Issue" value={row.issueNo} />
              <DetailChip label="Consumption" value={row.consumptionTransactionNo} />
              <DetailChip label="Date" value={formatDate(row.date)} />
              <DetailChip label="Type" value={row.issueType} />
              <DetailChip label="Tally" value={row.tallyPostingStatus} />
              <DetailChip label="Remarks" value={row.remarks} />
            </div>

            <div className="grid gap-2 xl:grid-cols-[1.1fr_1fr]">
              <section>
                <h4 className="mb-1 text-[10px] font-black uppercase tracking-wide text-black">Items</h4>
                <div className="overflow-hidden rounded border border-black bg-white">
                  <table className="min-w-full divide-y divide-black text-[11px]">
                    <thead className="sticky top-0 z-30 bg-slate-100">
                      <tr className="divide-x divide-black">
                        <th className="px-2 py-1 text-left font-black uppercase">Item</th>
                        <th className="px-2 py-1 text-right font-black uppercase">Qty</th>
                        <th className="px-2 py-1 text-left font-black uppercase">UOM</th>
                        <th className="px-2 py-1 text-right font-black uppercase">Last Purchase Rate</th>
                        <th className="px-2 py-1 text-right font-black uppercase">Opening Rate</th>
                        <th className="px-2 py-1 text-right font-black uppercase">Rate</th>
                        <th className="px-2 py-1 text-right font-black uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black">
                      {selectedLines.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-2 py-2 text-center text-slate-600">No item lines found.</td>
                        </tr>
                      ) : (
                        selectedLines.map((line) => (
                          <tr key={line.id} className="divide-x divide-black">
                            <td className="px-2 py-1 font-semibold">{getItemName(line.materialId)}</td>
                            <td className="px-2 py-1 text-right font-semibold">{Number(line.qty || 0).toLocaleString()}</td>
                            <td className="px-2 py-1">{line.uom || "-"}</td>
                            <td className="px-2 py-1 text-right font-semibold">{formatMoney(line.lastPurchaseRate)}</td>
                            <td className="px-2 py-1 text-right font-semibold">{formatMoney(line.openingRate)}</td>
                            <td className="px-2 py-1 text-right font-black text-indigo-700">{formatMoney(line.rate)}</td>
                            <td className="px-2 py-1 text-right font-black text-emerald-700">{formatMoney(line.amount)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {selectedLines.length > 0 ? (
                      <tfoot className="border-t-2 border-black bg-emerald-50">
                        <tr className="divide-x divide-black">
                          <td colSpan={6} className="px-2 py-1.5 text-right font-black uppercase text-slate-700">
                            Total Amount
                          </td>
                          <td className="px-2 py-1.5 text-right font-black text-emerald-800">
                            {formatMoney(selectedLineAmountTotal)}
                          </td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              </section>

              <section>
                <h4 className="mb-1 text-[10px] font-black uppercase tracking-wide text-black">Reel Details</h4>
                <div className="overflow-hidden rounded border border-black bg-white">
                  <table className="min-w-full divide-y divide-black text-[11px]">
                    <thead className="sticky top-0 z-30 bg-slate-100">
                      <tr className="divide-x divide-black">
                        <th className="px-2 py-1 text-left font-black uppercase">Item</th>
                        <th className="px-2 py-1 text-left font-black uppercase">Reel No</th>
                        <th className="px-2 py-1 text-left font-black uppercase">Slip</th>
                        <th className="px-2 py-1 text-right font-black uppercase">Wt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black">
                      {selectedReelLines.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-2 text-center text-slate-600">No reel details found.</td>
                        </tr>
                      ) : (
                        selectedReelLines.map((line) => (
                          <tr key={line.id} className="divide-x divide-black">
                            <td className="px-2 py-1 font-semibold">{getItemName(line.materialId)}</td>
                            <td className="px-2 py-1">{line.ourReelNo || "-"}</td>
                            <td className="px-2 py-1">{line.packingSlipId || "-"}</td>
                            <td className="px-2 py-1 text-right font-semibold">{Number(line.weightKg || 0).toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="rounded border border-slate-300 bg-white px-3 py-1.5">
              <span className="mr-2 text-[10px] font-black uppercase text-black">Tally Details</span>
              {tallyValues.length === 0 ? (
                <span className="text-slate-600">-</span>
              ) : (
                tallyValues.map(([label, value]) => (
                  <span key={label} className="mr-4 inline-block whitespace-nowrap">
                    <span className="font-black text-slate-500">{label}:</span> <span className="font-semibold text-black">{value}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Non-Job Issue Master</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search issue no, consumption no, date, item, remarks..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Consumption No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Tally Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Items</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total Value</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remarks</th>
                {canCancelIssues ? <th className="px-4 py-3 text-right text-xs font-bold uppercase">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={mainTableColSpan} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No Without Job material issues found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const isExpanded = expandedIssueId === row.id;
                  const issueTotals = issueTotalsByIssueId.get(row.id) || { totalQty: 0, totalValue: 0 };
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="divide-x divide-black hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-bold">
                          <button
                            type="button"
                            title={isExpanded ? "Hide details" : "Show details"}
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
                        <td className="px-4 py-3 text-sm">{row.tallyPostingStatus || "-"}</td>
                        <td className="px-4 py-3 text-sm">{itemNameByIssueId.get(row.id) || "-"}</td>
                        <td className="px-4 py-3 text-right text-sm font-black text-slate-800">{issueTotals.totalQty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-sm font-black text-emerald-700">{formatMoney(issueTotals.totalValue)}</td>
                        <td className="px-4 py-3 text-sm">{row.remarks || "-"}</td>
                        {canCancelIssues ? (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              title={cancellingId === row.id ? "Confirm cancel" : "Cancel"}
                              onClick={() => handleCancel(row)}
                              disabled={String(row.tallyPostingStatus || "").trim().toLowerCase() === "cancelled"}
                              className={`${cancellingId === row.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 disabled:cursor-not-allowed disabled:text-slate-400 font-bold inline-flex items-center justify-end`}
                            >
                              <XCircle size={16} />
                            </button>
                          </td>
                        ) : null}
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
