import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { LoadingSlip, OrderItemSource, Production, Truck } from "../types";
import { TableControls } from "../components/TableControls";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";
const getLoadingEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_loading_slips" : "plate_loading_slips";

type StandaloneLoadingMasterProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

export function StandaloneLoadingMaster({ source }: StandaloneLoadingMasterProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingSlips] = useData<LoadingSlip>(getLoadingEntityName(source), []);
  const [productions] = useData<Production>(getJobMasterEntityName(source), []);
  const [trucks] = useData<Truck>("trucks", []);
  const [fgLoadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];

  const productionMap = useMemo(() => new Map(productions.map((production) => [production.id, production])), [productions]);
  const fgSlipMap = useMemo(() => new Map(fgLoadingSlips.map((slip) => [slip.id, slip])), [fgLoadingSlips]);
  const consumptionTxnLabel = source === "PHP" ? "PHP Cons. No" : "Plate Cons. No";

  const processedSlips = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return loadingSlips
      .map((slip) => {
        const relevantLines = slip.lines.filter((line) => Number(line.loadedQty || 0) > 0);
        if (relevantLines.length === 0) return null;

        const firstLine = relevantLines[0];
        const firstAllocation = Array.isArray(firstLine.allocations)
          ? firstLine.allocations.find((allocation) => allocation.sourceType === "job")
          : undefined;
        const firstProduction = firstAllocation?.sourceType === "job"
          ? productionMap.get(String(firstAllocation.jobId || "").trim())
          : undefined;
        const item = firstLine.itemId
          ? items.find((entry) => entry.id === String(firstLine.itemId || "").trim())
          : firstProduction
            ? items.find((entry) => entry.id === String(firstProduction.itemId || "").trim())
            : undefined;
        const fgSlip = fgSlipMap.get(String(slip.fgLoadingId || "").trim());
        const isFgLinked = Boolean(String(slip.fgLoadingId || "").trim());

        return {
          slip,
          itemName: firstLine.itemName || item?.name || String(firstProduction?.itemId || "-"),
          companyName: firstLine.companyName || firstProduction?.companyName || item?.companyName || "-",
          jobNo: firstAllocation?.sourceType === "job" ? firstAllocation.jobNo || firstProduction?.transactionNo || "-" : "-",
          fgSlipNo: fgSlip?.slipNo || "-",
          truckNo: slip.truckNo || trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "-",
          totalQty: relevantLines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0),
          isFgLinked,
          consumptionTxnNo:
            source === "PHP"
              ? String(slip.phpConsumptionTransactionNo || "").trim()
              : String(slip.plateConsumptionTransactionNo || "").trim(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => {
        if (!normalizedSearch) return true;
        const haystack = [row.slip.slipNo, row.itemName, row.companyName, row.jobNo, row.truckNo, row.fgSlipNo, row.consumptionTxnNo].join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) =>
        String(b.slip.slipNo || "").localeCompare(String(a.slip.slipNo || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [fgSlipMap, items, loadingSlips, productionMap, searchTerm, trucks]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(processedSlips, 25);
  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{sourceLabel} Loading Slip Master</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Slip No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">FG Slip</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">{consumptionTxnLabel}</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Company</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Truck</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Qty</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Status</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Tally Status</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Source</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-6 py-8 text-center text-black font-medium">No loading slips found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => (
                <tr key={row.slip.id} className="border-t border-black">
                  <td className="px-3 py-2 text-sm font-semibold">{row.slip.slipNo || "-"}</td>
                  <td className="px-3 py-2 text-sm">{row.isFgLinked ? row.fgSlipNo : "-"}</td>
                  <td className="px-3 py-2 text-sm font-semibold">{row.consumptionTxnNo || "-"}</td>
                  <td className="px-3 py-2 text-sm">{row.slip.date}</td>
                  <td className="px-3 py-2 text-sm">{row.jobNo}</td>
                  <td className="px-3 py-2 text-sm align-top">
                    <div className="max-w-[260px] whitespace-normal break-words leading-5">{row.itemName}</div>
                  </td>
                  <td className="px-3 py-2 text-sm align-top">
                    <div className="max-w-[260px] whitespace-normal break-words leading-5">{row.companyName}</div>
                  </td>
                  <td className="px-3 py-2 text-sm">{row.truckNo}</td>
                  <td className="px-3 py-2 text-sm text-right">{row.totalQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm">{row.slip.status || "Active"}</td>
                  <td className="px-3 py-2 text-sm">{row.slip.tallyPostingStatus || (row.slip.tallyTimestamp ? "Posted" : "-")}</td>
                  <td className="px-3 py-2 text-center text-sm">
                    {row.isFgLinked ? (
                      <span className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase text-indigo-700">Linked</span>
                    ) : (
                      <span className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-700">Historical</span>
                    )}
                  </td>
                </tr>
              ))
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
    </div>
  );
}
