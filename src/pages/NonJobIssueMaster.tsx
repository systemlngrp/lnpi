import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { Material, MaterialIssue, MaterialIssueLine, MaterialIssueReelLine } from "../types";
import { TableControls } from "../components/TableControls";
import { Eye, Trash2, X } from "lucide-react";
import { formatDate } from "../lib/serial";

function isWithoutJobIssue(issueType?: string) {
  const t = String(issueType || "").trim().toLowerCase();
  return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
}

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="border-b border-slate-200 py-2">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-black break-words">{value || "-"}</div>
    </div>
  );
}

export function NonJobIssueMaster() {
  const [materialIssues, setMaterialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materials] = useData<Material>("materials", []);
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const npdItems = useNpdItems();

  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<MaterialIssue | null>(null);

  const materialNameMap = useMemo(() => {
    const names = new Map(materials.map((row) => [String(row.id), String(row.name || "").trim()]));
    for (const row of npdItems) {
      const id = String((row as any).id || "").trim();
      const name = String((row as any).name || "").trim();
      if (id && name && !names.has(id)) names.set(id, name);
    }
    return names;
  }, [issueLines, materials, npdItems]);

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

  const selectedLines = useMemo(
    () => issueLines.filter((line) => line.materialIssueId === selectedIssue?.id),
    [issueLines, selectedIssue?.id]
  );

  const selectedReelLines = useMemo(
    () => issueReelLines.filter((line) => line.materialIssueId === selectedIssue?.id),
    [issueReelLines, selectedIssue?.id]
  );

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIssues((prev) => prev.filter((row) => row.id !== id));
    if (selectedIssue?.id === id) setSelectedIssue(null);
    setDeletingId(null);
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
            <thead className="bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Issue No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Consumption No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Tally Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Items</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remarks</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No Without Job material issues found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-bold">{row.issueNo}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-indigo-700">{row.consumptionTransactionNo || "-"}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(row.date) || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.tallyPostingStatus || "-"}</td>
                    <td className="px-4 py-3 text-sm">{itemNameByIssueId.get(row.id) || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.remarks || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          title="Show details"
                          onClick={() => setSelectedIssue(row)}
                          className="inline-flex items-center justify-center text-sky-700 hover:text-sky-950"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          title={deletingId === row.id ? "Confirm delete" : "Delete"}
                          onClick={() => handleDelete(row.id)}
                          className={`${deletingId === row.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center justify-end`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedIssue && (
        <div className="fixed inset-y-0 left-0 z-[70] flex w-full max-w-md flex-col border-r-2 border-black bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-black bg-slate-100 px-5 py-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-600">Non-Job Issue Details</div>
              <h3 className="mt-1 text-lg font-black text-black">{selectedIssue.issueNo || "-"}</h3>
            </div>
            <button
              type="button"
              title="Close details"
              onClick={() => setSelectedIssue(null)}
              className="rounded border border-black bg-white p-1.5 text-black hover:bg-slate-200"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <section className="mb-5">
              <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-black">Issue Header</h4>
              <div className="rounded border border-slate-300 bg-white px-3">
                <DetailRow label="Issue No" value={selectedIssue.issueNo} />
                <DetailRow label="Consumption No" value={selectedIssue.consumptionTransactionNo} />
                <DetailRow label="Date" value={formatDate(selectedIssue.date)} />
                <DetailRow label="Issue Type" value={selectedIssue.issueType} />
                <DetailRow label="Tally Status" value={selectedIssue.tallyPostingStatus} />
                <DetailRow label="Remarks" value={selectedIssue.remarks} />
              </div>
            </section>

            <section className="mb-5">
              <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-black">Items</h4>
              <div className="overflow-hidden rounded border border-black">
                <table className="min-w-full divide-y divide-black text-sm">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase">Item</th>
                      <th className="px-3 py-2 text-right text-[11px] font-black uppercase">Qty</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase">UOM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {selectedLines.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-slate-600">No item lines found.</td>
                      </tr>
                    ) : (
                      selectedLines.map((line) => (
                        <tr key={line.id} className="divide-x divide-black">
                          <td className="px-3 py-2 font-semibold">{getItemName(line.materialId)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{Number(line.qty || 0).toLocaleString()}</td>
                          <td className="px-3 py-2">{line.uom || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-5">
              <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-black">Reel Details</h4>
              <div className="overflow-hidden rounded border border-black">
                <table className="min-w-full divide-y divide-black text-sm">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase">Item</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase">Reel No</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase">Packing Slip</th>
                      <th className="px-3 py-2 text-right text-[11px] font-black uppercase">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {selectedReelLines.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-600">No reel details found.</td>
                      </tr>
                    ) : (
                      selectedReelLines.map((line) => (
                        <tr key={line.id} className="divide-x divide-black">
                          <td className="px-3 py-2 font-semibold">{getItemName(line.materialId)}</td>
                          <td className="px-3 py-2">{line.ourReelNo || "-"}</td>
                          <td className="px-3 py-2">{line.packingSlipId || "-"}</td>
                          <td className="px-3 py-2 text-right font-semibold">{Number(line.weightKg || 0).toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-black">Tally Details</h4>
              <div className="rounded border border-slate-300 bg-white px-3">
                <DetailRow label="Voucher No" value={selectedIssue.tallyVoucherNo} />
                <DetailRow label="Voucher Date" value={formatDate(selectedIssue.tallyVoucherDate)} />
                <DetailRow label="Voucher Type" value={selectedIssue.tallyVoucherType} />
                <DetailRow label="Voucher ID" value={selectedIssue.tallyVoucherId} />
                <DetailRow label="Posted By" value={selectedIssue.tallyPostedBy} />
                <DetailRow label="Posted At" value={selectedIssue.tallyTimestamp} />
                <DetailRow label="Posting Remark" value={selectedIssue.tallyPostingRemark} />
                <DetailRow label="Posting Error" value={selectedIssue.tallyPostingError} />
                <DetailRow label="Last Attempt" value={selectedIssue.tallyLastAttemptAt} />
                <DetailRow label="Attempt Count" value={selectedIssue.tallyPostingAttemptCount} />
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}