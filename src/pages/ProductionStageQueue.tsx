import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Company, Item, Order, OrderSchedule, Production } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { isProductionPendingConsumption, isProductionPendingFFG } from "../lib/productionStageFilters";

type QueueMode = "consumption" | "ffg";

const CONFIG: Record<QueueMode, { title: string; empty: string }> = {
  consumption: {
    title: "Production: Pending Consumption",
    empty: "No pending consumption rows.",
  },
  ffg: {
    title: "Production: Pending FFG",
    empty: "No pending FFG rows.",
  },
};

export function ProductionStageQueue({
  title,
  emptyMessage,
  predicate,
  enableFfgEditing = false,
  enableConsumptionAction = false,
}: {
  title: string;
  emptyMessage: string;
  predicate: (production: Production) => boolean;
  enableFfgEditing?: boolean;
  enableConsumptionAction?: boolean;
}) {
  const navigate = useNavigate();
  const [productions, setProductions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [ffgValues, setFfgValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const lowered = searchTerm.toLowerCase();
    return productions
      .filter(predicate)
      .map((production) => {
        const schedule = schedules.find((row) => row.id === production.scheduleId);
        const order = orders.find((row) => row.id === schedule?.orderId);
        const item = items.find((row) => row.id === production.itemId);
        const company = companies.find((row) => row.id === order?.companyId);
        return { production, order, item, company };
      })
      .filter(({ production, order, item, company }) => {
        if (!lowered) return true;
        return (
          production.transactionNo.toLowerCase().includes(lowered) ||
          String(production.erpCode || "").toLowerCase().includes(lowered) ||
          (order?.orderNo || "").toLowerCase().includes(lowered) ||
          (item?.name || "").toLowerCase().includes(lowered) ||
          (company?.name || "").toLowerCase().includes(lowered)
        );
      })
      .sort((a, b) => {
        const timeA = new Date(a.production.updateTimestamp || a.production.date || 0).getTime();
        const timeB = new Date(b.production.updateTimestamp || b.production.date || 0).getTime();
        return timeB - timeA;
      });
  }, [companies, items, orders, predicate, productions, schedules, searchTerm]);

  const handleSaveFfg = async (productionId: string) => {
    const rawValue = ffgValues[productionId];
    const nextValue = Number(rawValue);

    if (!rawValue || Number.isNaN(nextValue) || nextValue <= 0) return;

    setSavingId(productionId);
    try {
      const timestamp = new Date().toISOString();
      await setProductions((prev) =>
        prev.map((production) =>
          production.id === productionId
            ? {
                ...production,
                prodFromFFG: nextValue,
                status: "Pending Tally",
                updatedBy: "System User",
                updateTimestamp: timestamp,
              }
            : production
        )
      );
      setFfgValues((prev) => ({ ...prev, [productionId]: "" }));
    } catch (error) {
      console.error("Failed to save Prod (FFG):", error);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{title}</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search jobs..." />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Order No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">ERP Code</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Item</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actual Paper Used</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Prod (FFG)</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Status</th>
                {enableFfgEditing ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Update</th> : null}
                {enableConsumptionAction ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Action</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10 + (enableFfgEditing ? 1 : 0) + (enableConsumptionAction ? 1 : 0)} className="px-6 py-8 text-center text-black font-medium">{emptyMessage}</td>
                </tr>
              ) : (
                rows.map(({ production, order, item, company }) => (
                  <tr key={production.id} className="hover:bg-slate-50 divide-x divide-black">
                    <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{production.transactionNo}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(production.date)}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{production.erpCode || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{company?.name || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black">{item?.name || "Unknown"}</td>
                    <td className="px-4 py-4 text-right text-xs font-medium text-emerald-700 border border-black whitespace-nowrap">{production.qty} {production.uom}</td>
                    <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{production.actualPaperUsed || "-"}</td>
                    <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{production.prodFromFFG || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{production.status}</td>
                    {enableFfgEditing ? (
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.00001"
                            min={0}
                            value={ffgValues[production.id] || ""}
                            onChange={(e) => setFfgValues((prev) => ({ ...prev, [production.id]: e.target.value }))}
                            placeholder="Enter FFG"
                            className="w-28 border-2 border-black rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveFfg(production.id)}
                            disabled={savingId === production.id || !ffgValues[production.id] || Number(ffgValues[production.id]) <= 0}
                            className="bg-emerald-600 text-white px-3 py-1 rounded font-bold text-[11px] uppercase border border-black disabled:opacity-50"
                          >
                            {savingId === production.id ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </td>
                    ) : null}
                    {enableConsumptionAction ? (
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => navigate(`/consumption/form?productionId=${production.id}`)}
                          className="bg-indigo-600 text-white px-3 py-1 rounded font-bold text-[11px] uppercase border border-black"
                        >
                          Create Consumption
                        </button>
                      </td>
                    ) : null}
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

export function ProductionPendingConsumption() {
  return (
    <ProductionStageQueue
      title={CONFIG.consumption.title}
      emptyMessage={CONFIG.consumption.empty}
      predicate={isProductionPendingConsumption}
      enableConsumptionAction
    />
  );
}

export function ProductionPendingFFG() {
  return (
    <ProductionStageQueue
      title={CONFIG.ffg.title}
      emptyMessage={CONFIG.ffg.empty}
      predicate={isProductionPendingFFG}
      enableFfgEditing
    />
  );
}
