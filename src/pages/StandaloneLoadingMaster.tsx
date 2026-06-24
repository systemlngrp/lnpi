import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { DispatchPlan, LoadingSlip, OrderItemSource, Production, Truck } from "../types";
import { TableControls } from "../components/TableControls";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";
const getDispatchEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_dispatch_plans" : "plate_dispatch_plans";
const getLoadingEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_loading_slips" : "plate_loading_slips";

type StandaloneLoadingMasterProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

export function StandaloneLoadingMaster({ source }: StandaloneLoadingMasterProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingSlips, setLoadingSlips] = useData<LoadingSlip>(getLoadingEntityName(source), []);
  const [dispatchPlans, setDispatchPlans] = useData<DispatchPlan>(getDispatchEntityName(source), []);
  const [productions] = useData<Production>(getJobMasterEntityName(source), []);
  const [trucks] = useData<Truck>("trucks", []);
  const [fgLoadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];

  const planMap = useMemo(() => new Map(dispatchPlans.map((plan) => [plan.id, plan])), [dispatchPlans]);
  const productionMap = useMemo(() => new Map(productions.map((production) => [production.id, production])), [productions]);
  const fgSlipMap = useMemo(() => new Map(fgLoadingSlips.map((slip) => [slip.id, slip])), [fgLoadingSlips]);

  const processedSlips = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return loadingSlips
      .map((slip) => {
        const isFgLinked = Boolean(String(slip.fgLoadingId || "").trim());
        const relevantLines = isFgLinked
          ? slip.lines.filter((line) => Number(line.loadedQty || 0) > 0)
          : slip.lines.filter((line) => {
              const plan = planMap.get(String(line.dispatchPlanId || "").trim());
              const production = plan ? productionMap.get(String(plan.productionId || "").trim()) : null;
              return Boolean(production);
            });
        if (relevantLines.length === 0) return null;

        const firstLine = relevantLines[0];
        const firstPlan = planMap.get(String(firstLine.dispatchPlanId || "").trim());
        const firstProduction = firstPlan ? productionMap.get(String(firstPlan.productionId || "").trim()) : null;
        const item = firstProduction
          ? items.find((entry) => entry.id === String(firstProduction.itemId || "").trim())
          : null;
        const fgSlip = fgSlipMap.get(String(slip.fgLoadingId || "").trim());

        return {
          slip,
          itemName: firstLine.itemName || item?.name || String(firstProduction?.itemId || "-"),
          companyName: firstLine.companyName || firstProduction?.companyName || item?.companyName || "-",
          jobNo: firstProduction?.transactionNo || "-",
          fgSlipNo: fgSlip?.slipNo || "-",
          truckNo: trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "-",
          totalQty: relevantLines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0),
          isFgLinked,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => {
        if (!normalizedSearch) return true;
        const haystack = [row.slip.slipNo, row.itemName, row.companyName, row.jobNo, row.truckNo, row.fgSlipNo].join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) =>
        String(b.slip.slipNo || "").localeCompare(String(a.slip.slipNo || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [fgSlipMap, items, loadingSlips, planMap, productionMap, searchTerm, trucks]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(processedSlips, 25);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cancelSlip = async (slipId: string) => {
    const slip = loadingSlips.find((row) => row.id === slipId);
    if (!slip || slip.status === "Cancelled" || slip.fgLoadingId) return;

    if (deletingId !== slipId) {
      setDeletingId(slipId);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }

    const now = new Date().toISOString();
    const byPlan = new Map(slip.lines.map((line) => [line.dispatchPlanId, Number(line.loadedQty || 0)]));

    await setDispatchPlans((prev) =>
      prev.map((plan) => {
        if (!byPlan.has(plan.id)) return plan;
        return {
          ...plan,
          loadedQty: Math.max(0, Number(plan.loadedQty || 0) - Number(byPlan.get(plan.id) || 0)),
          updateTimestamp: now,
          updatedBy: "System User",
        };
      })
    );

    await setLoadingSlips((prev) =>
      prev.map((row) =>
        row.id === slipId
          ? {
              ...row,
              status: "Cancelled",
              cancelledAt: now,
              cancelledBy: "System User",
              cancelReason: "Cancelled from standalone master",
              updateTimestamp: now,
              updatedBy: "System User",
            }
          : row
      )
    );

    setDeletingId(null);
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{sourceLabel} Loading Slip Master</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Slip No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">FG Slip</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Company</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Truck</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Qty</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Status</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-black font-medium">No loading slips found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => (
                <tr key={row.slip.id} className="border-t border-black">
                  <td className="px-3 py-2 text-sm font-semibold">{row.slip.slipNo || "-"}</td>
                  <td className="px-3 py-2 text-sm">{row.isFgLinked ? row.fgSlipNo : "-"}</td>
                  <td className="px-3 py-2 text-sm">{row.slip.date}</td>
                  <td className="px-3 py-2 text-sm">{row.jobNo}</td>
                  <td className="px-3 py-2 text-sm">{row.itemName}</td>
                  <td className="px-3 py-2 text-sm">{row.companyName}</td>
                  <td className="px-3 py-2 text-sm">{row.truckNo}</td>
                  <td className="px-3 py-2 text-sm text-right">{row.totalQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm">{row.slip.status || "Active"}</td>
                  <td className="px-3 py-2 text-center text-sm">
                    {row.isFgLinked ? (
                      <span className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase text-indigo-700">Linked</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void cancelSlip(row.slip.id)}
                        disabled={row.slip.status === "Cancelled"}
                        className="rounded border border-black px-2 py-1 font-bold uppercase disabled:opacity-50"
                      >
                        {deletingId === row.slip.id ? "Confirm" : "Cancel"}
                      </button>
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
