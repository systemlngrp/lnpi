import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Company, DispatchPlan, OrderItemSource, Production, Truck } from "../types";
import { TableControls } from "../components/TableControls";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";

const getJobMasterEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";
const getDispatchEntityName = (source: Extract<OrderItemSource, "PHP" | "PLATE">) =>
  source === "PHP" ? "php_dispatch_plans" : "plate_dispatch_plans";

type StandaloneDispatchMasterProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

export function StandaloneDispatchMaster({ source }: StandaloneDispatchMasterProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [plans, setPlans] = useData<DispatchPlan>(getDispatchEntityName(source), []);
  const [productions] = useData<Production>(getJobMasterEntityName(source), []);
  const [trucks] = useData<Truck>("trucks", []);
  const [companies] = useData<Company>("companies", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];

  const productionMap = useMemo(
    () => new Map(productions.map((production) => [production.id, production])),
    [productions]
  );

  const filteredPlans = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return plans
      .filter((plan) => {
        const production = productionMap.get(String(plan.productionId || "").trim());
        return Boolean(production);
      })
      .map((plan) => {
        const production = productionMap.get(String(plan.productionId || "").trim())!;
        const item = items.find((entry) => entry.id === String(production.itemId || "").trim());
        const companyName =
          production.companyName ||
          item?.companyName ||
          companies.find((company) => company.name === production.companyName)?.name ||
          "-";
        return {
          plan,
          production,
          itemName: item?.name || String(production.itemId || ""),
          companyName,
          truckNo: trucks.find((truck) => truck.id === plan.truckId)?.truckNo || "-",
        };
      })
      .filter((row) => {
        if (!normalizedSearch) return true;
        const haystack = [
          row.plan.planNo,
          row.production.transactionNo,
          row.itemName,
          row.companyName,
          row.production.erpCode,
          row.truckNo,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) =>
        String(b.plan.planNo || "").localeCompare(String(a.plan.planNo || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [companies, items, plans, productionMap, searchTerm, source, trucks]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(filteredPlans, 25);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setPlans((prev) => prev.filter((plan) => plan.id !== id));
    setDeletingId(null);
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{sourceLabel} Dispatch Plan Master</h2>
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
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Truck</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Planned</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Loaded</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Cancelled</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Status</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-black font-medium">No dispatch plans found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => (
                <tr key={row.plan.id} className="border-t border-black">
                  <td className="px-3 py-2 text-sm font-semibold">{row.plan.planNo || "-"}</td>
                  <td className="px-3 py-2 text-sm">{row.production.transactionNo}</td>
                  <td className="px-3 py-2 text-sm">{row.itemName}</td>
                  <td className="px-3 py-2 text-sm">{row.companyName}</td>
                  <td className="px-3 py-2 text-sm">{row.truckNo}</td>
                  <td className="px-3 py-2 text-sm text-right">{Number(row.plan.plannedQty || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right">{Number(row.plan.loadedQty || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-right">{Number(row.plan.canceledQty || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm">{row.plan.status}</td>
                  <td className="px-3 py-2 text-center text-sm">
                    <button
                      type="button"
                      onClick={() => handleDelete(row.plan.id)}
                      className="rounded border border-black px-2 py-1 font-bold uppercase"
                    >
                      {deletingId === row.plan.id ? "Confirm" : "Delete"}
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
