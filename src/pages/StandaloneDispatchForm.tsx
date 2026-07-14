import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { DispatchPlan, OrderItemSource, Production } from "../types";
import { TableControls } from "../components/TableControls";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";
const getDispatchEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_dispatch_plans" : "plate_dispatch_plans";

type StandaloneDispatchFormProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

type DispatchableProduction = {
  production: Production;
  itemName: string;
  companyName: string;
  alreadyPlanned: number;
  alreadyLoaded: number;
  alreadyCanceled: number;
  remaining: number;
};

export function StandaloneDispatchForm({ source }: StandaloneDispatchFormProps) {
  const [productions] = useData<Production>(getJobMasterEntityName(source), []);
  const [dispatchPlans, setDispatchPlans] = useData<DispatchPlan>(getDispatchEntityName(source), []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowPlannedQty, setRowPlannedQty] = useState<Record<string, number | "">>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectivePlannedByProductionId = useMemo(() => {
    const map = new Map<string, number>();
    dispatchPlans.forEach((plan) => {
      const productionId = String(plan.productionId || "").trim();
      if (!productionId) return;
      const effective = Math.max(0, Number(plan.plannedQty || 0) - Number(plan.canceledQty || 0));
      if (effective <= 0) return;
      map.set(productionId, (map.get(productionId) || 0) + effective);
    });
    return map;
  }, [dispatchPlans]);

  const rows = useMemo<DispatchableProduction[]>(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return productions
      .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
      .map((production) => {
        const item = items.find((entry) => entry.id === String(production.itemId || "").trim());
        const availableBase =
          Number(production.prodFromFFG || 0) > 0 ? Number(production.prodFromFFG || 0) : Number(production.qty || 0);
        const productionPlans = dispatchPlans.filter((plan) => String(plan.productionId || "").trim() === production.id);
        const alreadyPlanned = Number(effectivePlannedByProductionId.get(production.id) || 0);
        const alreadyLoaded = productionPlans.reduce((sum, plan) => sum + Number(plan.loadedQty || 0), 0);
        const alreadyCanceled = productionPlans.reduce((sum, plan) => sum + Number(plan.canceledQty || 0), 0);
        const remaining = Math.max(0, availableBase - alreadyPlanned);
        return {
          production,
          itemName: item?.name || String(production.itemId || ""),
          companyName: production.companyName || item?.companyName || "-",
          alreadyPlanned,
          alreadyLoaded,
          alreadyCanceled,
          remaining,
        };
      })
      .filter((row) => row.remaining > 0)
      .filter((row) => {
        if (!normalizedSearch) return true;
        const haystack = [
          row.production.transactionNo,
          row.itemName,
          row.companyName,
          row.production.erpCode,
          row.production.remarks,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => {
        const timeA = new Date(a.production.updateTimestamp || a.production.date || 0).getTime();
        const timeB = new Date(b.production.updateTimestamp || b.production.date || 0).getTime();
        return timeB - timeA;
      });
  }, [effectivePlannedByProductionId, items, productions, searchTerm, source]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems,
  } = useClientPagination(rows, 25);

  const toggleSelected = (productionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productionId)) next.delete(productionId);
      else next.add(productionId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      alert("Please select at least one job to plan.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      let nextPlanNo =
        Math.max(
          0,
          ...dispatchPlans.map((plan) => {
            const match = String(plan.planNo || "").match(/DP-(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
        ) + 1;

      const newPlans: DispatchPlan[] = Array.from(selectedIds).map((id) => {
        const row = rows.find((entry) => entry.production.id === id)!;
        const nextQty = rowPlannedQty[id] !== undefined && rowPlannedQty[id] !== "" ? Number(rowPlannedQty[id]) : row.remaining;
        return {
          id: crypto.randomUUID(),
          planNo: `DP-${String(nextPlanNo++).padStart(5, "0")}`,
          scheduleId: "",
          orderId: "",
          productionId: row.production.id,
          truckId: "",
          plannedQty: Math.max(0, Math.min(nextQty, row.remaining)),
          status: "Planned",
          date: timestamp,
          loadedQty: 0,
          canceledQty: 0,
          updateTimestamp: timestamp,
          updatedBy: "System User",
        };
      });

      await setDispatchPlans((prev) => [...prev, ...newPlans]);
      setSelectedIds(new Set());
      setRowPlannedQty({});
      alert("Dispatch plans submitted successfully!");
    } catch (error) {
      console.error("Failed to submit dispatch plans:", error);
      alert("Failed to submit dispatch plans.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-black pb-4">
          <div>
            <h2 className="text-2xl font-black text-black tracking-tight uppercase">{sourceLabel} Dispatch Form</h2>
            <p className="text-sm font-medium text-slate-600 uppercase">Plan dispatch directly from production jobs</p>
          </div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={selectedIds.size === 0 || isSubmitting}
            className="rounded border border-black bg-black px-4 py-2 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save Dispatch Plan"}
          </button>
        </div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Select</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Company</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Produced</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Planned</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Loaded</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Canceled</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Remaining</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Plan Qty</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-8 text-center text-black font-medium">No dispatchable productions found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => (
                <tr key={row.production.id} className="border-t border-black">
                  <td className="px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.production.id)}
                      onChange={() => toggleSelected(row.production.id)}
                    />
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold">{row.production.transactionNo}</td>
                  <td className="px-3 py-2 text-sm">{row.production.date}</td>
                  <td className="px-3 py-2 text-sm">{row.itemName}</td>
                  <td className="px-3 py-2 text-sm">{row.companyName}</td>
                  <td className="px-3 py-2 text-sm text-right">{Number(row.production.qty || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right">{row.alreadyPlanned.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right">{row.alreadyLoaded.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right">{row.alreadyCanceled.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right font-bold">{row.remaining.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right">
                    <input
                      type="number"
                      min={0}
                      max={row.remaining}
                      value={rowPlannedQty[row.production.id] ?? row.remaining}
                      onChange={(e) =>
                        setRowPlannedQty((prev) => ({
                          ...prev,
                          [row.production.id]: e.target.value === "" ? "" : Math.max(0, Math.min(Number(e.target.value), row.remaining)),
                        }))
                      }
                      className="w-28 rounded border border-black bg-yellow-100 px-2 py-1 text-right font-bold"
                    />
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
