import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { DispatchPlan, LoadingSlip, LoadingSlipAllocation, OrderItemSource, Production, Truck } from "../types";
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

type StandaloneLoadingFormProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

type PendingStandalonePlan = {
  plan: DispatchPlan;
  production: Production;
  itemName: string;
  companyName: string;
  pendingQty: number;
};

export function StandaloneLoadingForm({ source }: StandaloneLoadingFormProps) {
  const [dispatchPlans, setDispatchPlans] = useData<DispatchPlan>(getDispatchEntityName(source), []);
  const [loadingSlips, setLoadingSlips] = useData<LoadingSlip>(getLoadingEntityName(source), []);
  const [productions] = useData<Production>(getJobMasterEntityName(source), []);
  const [trucks] = useData<Truck>("trucks", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];

  const [searchTerm, setSearchTerm] = useState("");
  const [truckByPlanId, setTruckByPlanId] = useState<Record<string, string>>({});
  const [qtyByPlanId, setQtyByPlanId] = useState<Record<string, number | "">>({});
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);

  const productionMap = useMemo(() => new Map(productions.map((production) => [production.id, production])), [productions]);

  const rows = useMemo<PendingStandalonePlan[]>(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return dispatchPlans
      .map((plan) => {
        const production = productionMap.get(String(plan.productionId || "").trim());
        if (!production) return null;
        const pendingQty = Math.max(0, Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0));
        if (pendingQty <= 0) return null;
        const item = items.find((entry) => entry.id === String(production.itemId || "").trim());
        return {
          plan,
          production,
          itemName: item?.name || String(production.itemId || ""),
          companyName: production.companyName || item?.companyName || "-",
          pendingQty,
        };
      })
      .filter((row): row is PendingStandalonePlan => Boolean(row))
      .filter((row) => {
        if (!normalizedSearch) return true;
        const haystack = [
          row.plan.planNo,
          row.production.transactionNo,
          row.itemName,
          row.companyName,
          row.production.erpCode,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => String(a.plan.planNo || "").localeCompare(String(b.plan.planNo || ""), undefined, { numeric: true, sensitivity: "base" }));
  }, [dispatchPlans, items, productionMap, searchTerm, source]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems,
  } = useClientPagination(rows, 25);

  const handleSaveSlip = async (row: PendingStandalonePlan) => {
    const truckId = String(truckByPlanId[row.plan.id] || "").trim();
    const loadQty = qtyByPlanId[row.plan.id] === undefined || qtyByPlanId[row.plan.id] === "" ? row.pendingQty : Number(qtyByPlanId[row.plan.id]);

    if (!truckId) {
      alert("Please select truck.");
      return;
    }
    if (!Number.isFinite(loadQty) || loadQty <= 0 || loadQty > row.pendingQty) {
      alert("Loaded qty must be greater than 0 and cannot exceed pending qty.");
      return;
    }

    setSavingPlanId(row.plan.id);
    try {
      const allocation: LoadingSlipAllocation = {
        sourceType: "job",
        jobId: row.production.id,
        jobNo: String(row.production.transactionNo || ""),
        qty: loadQty,
      };

      const newSlip: LoadingSlip = {
        id: crypto.randomUUID(),
        slipNo: "",
        date: new Date().toISOString().slice(0, 10),
        truckId,
        lines: [{ dispatchPlanId: row.plan.id, loadedQty: loadQty, allocations: [allocation] }],
      };

      await setLoadingSlips((prev) => [...prev, newSlip]);
      await setDispatchPlans((prev) =>
        prev.map((plan) => {
          if (plan.id !== row.plan.id) return plan;
          const nextLoaded = Number(plan.loadedQty || 0) + loadQty;
          const remaining = Math.max(0, Number(plan.plannedQty || 0) - nextLoaded - Number(plan.canceledQty || 0));
          return {
            ...plan,
            loadedQty: nextLoaded,
            canceledQty: Number(plan.canceledQty || 0) + remaining,
            updateTimestamp: new Date().toISOString(),
            updatedBy: "System User",
          };
        })
      );

      setTruckByPlanId((prev) => {
        const next = { ...prev };
        delete next[row.plan.id];
        return next;
      });
      setQtyByPlanId((prev) => {
        const next = { ...prev };
        delete next[row.plan.id];
        return next;
      });
      alert("Loading slip saved successfully!");
    } catch (error) {
      console.error("Failed to save loading slip:", error);
      alert("Failed to save loading slip.");
    } finally {
      setSavingPlanId(null);
    }
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-black pb-4">
        <div>
          <h2 className="text-2xl font-black text-black tracking-tight uppercase">{sourceLabel} Loading Slip Form</h2>
          <p className="text-sm font-medium text-slate-600 uppercase">Create loading slips from dispatch plans</p>
        </div>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Plan No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Company</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Pending</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Truck</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Load Qty</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-black font-medium">No pending loading plans found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => (
                <tr key={row.plan.id} className="border-t border-black">
                  <td className="px-3 py-2 text-sm font-semibold">{row.plan.planNo}</td>
                  <td className="px-3 py-2 text-sm">{row.production.transactionNo}</td>
                  <td className="px-3 py-2 text-sm">{row.itemName}</td>
                  <td className="px-3 py-2 text-sm">{row.companyName}</td>
                  <td className="px-3 py-2 text-sm text-right font-bold">{row.pendingQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm">
                    <select
                      value={truckByPlanId[row.plan.id] || ""}
                      onChange={(e) => setTruckByPlanId((prev) => ({ ...prev, [row.plan.id]: e.target.value }))}
                      className="w-full rounded border border-black bg-white px-2 py-1 text-xs font-bold"
                    >
                      <option value="">Select Truck</option>
                      {trucks.map((truck) => (
                        <option key={truck.id} value={truck.id}>
                          {truck.truckNo}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-sm text-right">
                    <input
                      type="number"
                      min={0}
                      max={row.pendingQty}
                      value={qtyByPlanId[row.plan.id] ?? row.pendingQty}
                      onChange={(e) =>
                        setQtyByPlanId((prev) => ({
                          ...prev,
                          [row.plan.id]: e.target.value === "" ? "" : Math.max(0, Math.min(Number(e.target.value), row.pendingQty)),
                        }))
                      }
                      className="w-28 rounded border border-black bg-yellow-100 px-2 py-1 text-right font-bold"
                    />
                  </td>
                  <td className="px-3 py-2 text-center text-sm">
                    <button
                      type="button"
                      onClick={() => void handleSaveSlip(row)}
                      disabled={savingPlanId === row.plan.id}
                      className="rounded border border-black bg-black px-3 py-1 text-xs font-bold uppercase text-white disabled:opacity-50"
                    >
                      {savingPlanId === row.plan.id ? "Saving..." : "Save Slip"}
                    </button>
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
