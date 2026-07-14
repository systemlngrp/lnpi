import { useMemo, useState } from "react";
import { TableControls } from "../components/TableControls";
import { useData } from "../hooks/useData";
import { LoadingSlip } from "../types";
import { formatDate } from "../lib/serial";

function PendingLinkedLoadingTallyPage({ source }: { source: "PHP" | "PLATE" }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingSlips] = useData<LoadingSlip>(source === "PHP" ? "php_loading_slips" : "plate_loading_slips", []);
  const [fgLoadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const fgSlipMap = useMemo(
    () => new Map(fgLoadingSlips.map((slip) => [String(slip.id || "").trim(), slip])),
    [fgLoadingSlips]
  );

  const pendingRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return loadingSlips
      .filter((row) => String(source === "PHP" ? row.phpConsumptionTransactionNo || "" : row.plateConsumptionTransactionNo || "").trim() !== "")
      .filter((row) => String(row.tallyTimestamp || "").trim() === "")
      .filter((row) => String(row.status || "Active").trim().toLowerCase() !== "cancelled")
      .map((row) => {
        const fgSlip = fgSlipMap.get(String(row.fgLoadingId || "").trim());
        const relevantLines = Array.isArray(row.lines) ? row.lines.filter((line) => Number(line.loadedQty || 0) > 0) : [];
        const firstLine = relevantLines[0];
        return {
          row,
          fgSlipNo: fgSlip?.slipNo || "-",
          itemName: String(firstLine?.itemName || "-"),
          companyName: String(firstLine?.companyName || row.companyName || "-"),
          consumptionNo: String(source === "PHP" ? row.phpConsumptionTransactionNo || "" : row.plateConsumptionTransactionNo || "").trim(),
          totalQty: relevantLines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0),
        };
      })
      .filter((entry) => {
        if (!q) return true;
        const haystack = [
          entry.row.slipNo,
          entry.fgSlipNo,
          entry.consumptionNo,
          entry.row.date,
          entry.itemName,
          entry.companyName,
          entry.row.tallyPostingStatus,
          entry.row.tallyPostingRemark,
          entry.row.tallyPostingError,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort(
        (a, b) =>
          String(a.row.date || "").localeCompare(String(b.row.date || "")) ||
          String(a.consumptionNo || "").localeCompare(String(b.consumptionNo || ""), undefined, { numeric: true, sensitivity: "base" }) ||
          String(a.row.slipNo || "").localeCompare(String(b.row.slipNo || ""), undefined, { numeric: true, sensitivity: "base" })
      );
  }, [fgSlipMap, loadingSlips, searchTerm, source]);

  const heading = source === "PHP" ? "Pending PHP Tally Posting" : "Pending Plate Tally Posting";
  const consumptionLabel = source === "PHP" ? "PHP Cons. No" : "Plate Cons. No";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">{heading}</h2>
          <p className="text-sm font-medium text-slate-600 mt-1">
            Shows linked {source.toLowerCase()} loading slips where <span className="font-bold">tallyTimestamp</span> is blank.
          </p>
        </div>
        <div className="text-sm font-bold text-slate-700">Pending: {pendingRows.length}</div>
      </div>

      <TableControls
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        placeholder={`Search slip no, ${consumptionLabel.toLowerCase()}, item, company, error...`}
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Slip No</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">FG Slip</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">{consumptionLabel}</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Company</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Remark</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {pendingRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-slate-600 font-medium">
                    No pending {source} Tally posting rows found.
                  </td>
                </tr>
              ) : (
                pendingRows.map(({ row, fgSlipNo, consumptionNo, itemName, companyName, totalQty }) => (
                  <tr key={row.id} className="divide-x divide-black hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-bold">{row.slipNo || "-"}</td>
                    <td className="px-4 py-3 text-sm">{fgSlipNo}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-indigo-700">{consumptionNo || "-"}</td>
                    <td className="px-4 py-3 text-sm">{formatDate(row.date) || "-"}</td>
                    <td className="px-4 py-3 text-sm">{itemName}</td>
                    <td className="px-4 py-3 text-sm">{companyName}</td>
                    <td className="px-4 py-3 text-sm text-right">{totalQty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">{row.tallyPostingStatus || "-"}</td>
                    <td className="px-4 py-3 text-sm">{row.tallyPostingRemark || "-"}</td>
                    <td className="px-4 py-3 text-sm text-red-700">{row.tallyPostingError || "-"}</td>
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

export function PendingPhpLoadingTallyPosting() {
  return <PendingLinkedLoadingTallyPage source="PHP" />;
}

export function PendingPlateLoadingTallyPosting() {
  return <PendingLinkedLoadingTallyPage source="PLATE" />;
}
