import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Company,
  Item,
  MaterialIssue,
  MaterialIssueLine,
  MaterialReturn,
  MaterialReturnLine,
  Order,
  OrderSchedule,
  Production,
  ProductionProcessing,
  Setting,
} from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "../lib/productionMaterialUsage";
import { isProductionPendingConsumption, isProductionPendingFFG } from "../lib/productionStageFilters";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { getRequiredMachinesForType, parseMandatoryMachinesByType } from "../lib/mandatoryMachines";

type QueueMode = "consumption" | "ffg";

type SortKey = "jobNo" | "date" | "orderNo" | "erpCode" | "company" | "item" | "qty" | "actualPaperUsed" | "prodFfg" | "status";
type SortDir = "asc" | "desc";

const parseJobNo = (value: string) => {
  const raw = String(value || "").trim();
  const lastPart = raw.split("/").pop() || raw;
  const num = Number.parseInt(lastPart, 10);
  return Number.isFinite(num) ? num : null;
};

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
  enableIssueAction = false,
  enableCloseAction = false,
  hideStatusColumn = false,
  hideProdFfgColumn = false,
  issuePrereqMachineName,
}: {
  title: string;
  emptyMessage: string;
  predicate: (production: Production, actualPaperUsed: number) => boolean;
  enableFfgEditing?: boolean;
  enableIssueAction?: boolean;
  enableCloseAction?: boolean;
  hideStatusColumn?: boolean;
  hideProdFfgColumn?: boolean;
  issuePrereqMachineName?: string;
}) {
  const navigate = useNavigate();
  const [productions, setProductions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);
  const [searchTerm, setSearchTerm] = useState("");
  const [ffgValues, setFfgValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("jobNo");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const usageMap = useMemo(
    () => buildProductionMaterialUsageMap(materialIssues, materialIssueLines, materialReturns, materialReturnLines),
    [materialIssueLines, materialIssues, materialReturnLines, materialReturns]
  );

  const toggleSort = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  };

  const rows = useMemo(() => {
    const lowered = searchTerm.toLowerCase();
    const mandatoryMap = parseMandatoryMachinesByType(settings[0]);
    const prereqMachine = issuePrereqMachineName ? normalizeMachineName(issuePrereqMachineName) : "";
    return productions
      .filter((production) => predicate(production, getProductionActualPaperUsed(production, usageMap)))
      .map((production) => {
        const schedule = schedules.find((row) => row.id === production.scheduleId);
        const order = orders.find((row) => row.id === schedule?.orderId);
        const item = items.find((row) => row.id === production.itemId);
        const company = companies.find((row) => row.id === order?.companyId);
        const prereqQty = prereqMachine
          ? processing
              .filter((entry) => entry.productionId === production.id && normalizeMachineName(entry.machineName) === prereqMachine)
              .reduce((sum, entry) => sum + Number(entry.qty || 0), 0)
          : 0;
        const requiredMachines = getRequiredMachinesForType(mandatoryMap, item?.typeName);
        return {
          production,
          order,
          item,
          company,
          actualPaperUsed: getProductionActualPaperUsed(production, usageMap),
          requiredMachines,
          prereqQty,
        };
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
        const dir = sortDir === "asc" ? 1 : -1;

        const getString = (value: unknown) => String(value ?? "").toLowerCase();
        const getNumber = (value: unknown) => {
          const num = Number(value);
          return Number.isFinite(num) ? num : null;
        };

        let cmp = 0;
        switch (sortKey) {
          case "jobNo": {
            const nA = parseJobNo(a.production.transactionNo);
            const nB = parseJobNo(b.production.transactionNo);
            if (nA != null && nB != null) cmp = nA - nB;
            else cmp = getString(a.production.transactionNo).localeCompare(getString(b.production.transactionNo));
            break;
          }
          case "date": {
            const tA = new Date(a.production.date || 0).getTime();
            const tB = new Date(b.production.date || 0).getTime();
            cmp = tA - tB;
            break;
          }
          case "orderNo":
            cmp = getString(a.order?.orderNo).localeCompare(getString(b.order?.orderNo));
            break;
          case "erpCode":
            cmp = getString(a.production.erpCode).localeCompare(getString(b.production.erpCode));
            break;
          case "company":
            cmp = getString(a.company?.name).localeCompare(getString(b.company?.name));
            break;
          case "item":
            cmp = getString(a.item?.name).localeCompare(getString(b.item?.name));
            break;
          case "qty": {
            const qA = getNumber(a.production.qty) ?? 0;
            const qB = getNumber(b.production.qty) ?? 0;
            cmp = qA - qB;
            break;
          }
          case "actualPaperUsed": {
            const pA = getNumber(a.actualPaperUsed) ?? 0;
            const pB = getNumber(b.actualPaperUsed) ?? 0;
            cmp = pA - pB;
            break;
          }
          case "prodFfg": {
            const fA = getNumber(a.production.prodFromFFG) ?? 0;
            const fB = getNumber(b.production.prodFromFFG) ?? 0;
            cmp = fA - fB;
            break;
          }
          case "status":
            cmp = getString(a.production.status).localeCompare(getString(b.production.status));
            break;
          default:
            cmp = 0;
        }

        if (cmp !== 0) return cmp * dir;

        const timeA = new Date(a.production.updateTimestamp || a.production.date || 0).getTime();
        const timeB = new Date(b.production.updateTimestamp || b.production.date || 0).getTime();
        return timeB - timeA;
      });
  }, [
    companies,
    items,
    issuePrereqMachineName,
    orders,
    predicate,
    processing,
    productions,
    schedules,
    searchTerm,
    settings,
    sortDir,
    sortKey,
    usageMap,
  ]);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (column !== sortKey) return <ArrowUpDown size={12} className="opacity-60" />;
    return sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

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

  const handleCloseJob = async (productionId: string) => {
    if (!enableCloseAction) return;
    const target = productions.find((p) => p.id === productionId);
    if (!target || target.status === "Completed" || target.status === "Cancelled") return;
    if (!processing.some((entry) => entry.productionId === productionId)) {
      alert("Processing data is mandatory. Please add Production Processing entry before closing the job.");
      return;
    }

    if (closingId !== productionId) {
      setClosingId(productionId);
      setTimeout(() => setClosingId(null), 3000);
      return;
    }

    const timestamp = new Date().toISOString();
    try {
      await setProductions((prev) =>
        prev.map((p) =>
          p.id === productionId
            ? {
                ...p,
                status: "Completed",
                tallyTimestamp: p.tallyTimestamp || timestamp,
                updateTimestamp: timestamp,
                updatedBy: "System User",
              }
            : p
        )
      );
    } catch (error) {
      console.error("Failed to close job:", error);
      alert("Failed to close job. Please try again.");
    } finally {
      setClosingId(null);
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
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("jobNo")} className="inline-flex items-center gap-1">
                    Job No. <SortIcon column="jobNo" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("date")} className="inline-flex items-center gap-1">
                    Date <SortIcon column="date" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("orderNo")} className="inline-flex items-center gap-1">
                    Order No. <SortIcon column="orderNo" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("erpCode")} className="inline-flex items-center gap-1">
                    ERP Code <SortIcon column="erpCode" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("company")} className="inline-flex items-center gap-1">
                    Company <SortIcon column="company" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("item")} className="inline-flex items-center gap-1">
                    Item <SortIcon column="item" />
                  </button>
                </th>
                {issuePrereqMachineName ? (
                  <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                    {normalizeMachineName(issuePrereqMachineName)}
                  </th>
                ) : null}
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("qty")} className="inline-flex items-center gap-1">
                    Qty <SortIcon column="qty" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort("actualPaperUsed")} className="inline-flex items-center gap-1">
                    Actual Paper Used <SortIcon column="actualPaperUsed" />
                  </button>
                </th>
                {!hideProdFfgColumn ? (
                  <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("prodFfg")} className="inline-flex items-center gap-1">
                      Prod (FFG) <SortIcon column="prodFfg" />
                    </button>
                  </th>
                ) : null}
                {!hideStatusColumn ? (
                  <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1">
                      Status <SortIcon column="status" />
                    </button>
                  </th>
                ) : null}
                {enableCloseAction ? (
                  <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Close</th>
                ) : null}
                {enableFfgEditing ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Update</th> : null}
                {enableIssueAction ? <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Action</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      (10 - (hideStatusColumn ? 1 : 0) - (hideProdFfgColumn ? 1 : 0)) +
                      (issuePrereqMachineName ? 1 : 0) +
                      (enableCloseAction ? 1 : 0) +
                      (enableFfgEditing ? 1 : 0) +
                      (enableIssueAction ? 1 : 0)
                    }
                    className="px-6 py-8 text-center text-black font-medium"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map(({ production, order, item, company, actualPaperUsed, prereqQty, requiredMachines }) => (
                  <tr key={production.id} className="hover:bg-slate-50 divide-x divide-black">
                    <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{production.transactionNo}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(production.date)}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{production.erpCode || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{company?.name || "-"}</td>
                    <td className="px-4 py-4 text-xs text-black border border-black">{item?.name || "Unknown"}</td>
                    {issuePrereqMachineName ? (
                      <td className="px-4 py-4 text-right text-xs font-black text-emerald-700 border border-black whitespace-nowrap">
                        {prereqQty > 0 ? prereqQty.toFixed(2) : "-"}
                      </td>
                    ) : null}
                    <td className="px-4 py-4 text-right text-xs font-medium text-emerald-700 border border-black whitespace-nowrap">{production.qty} {production.uom}</td>
                    <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{actualPaperUsed > 0 ? actualPaperUsed : "-"}</td>
                    {!hideProdFfgColumn ? (
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{production.prodFromFFG || "-"}</td>
                    ) : null}
                    {!hideStatusColumn ? (
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{production.status}</td>
                    ) : null}
                    {enableCloseAction ? (
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleCloseJob(production.id)}
                          disabled={production.status === "Completed" || production.status === "Cancelled"}
                          className={
                            production.status === "Completed" || production.status === "Cancelled"
                              ? "inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-black uppercase text-slate-400 cursor-not-allowed"
                              : closingId === production.id
                                ? "inline-flex items-center gap-1 rounded border border-black bg-amber-400 px-3 py-1 text-[11px] font-black uppercase text-black animate-pulse"
                                : "inline-flex items-center gap-1 rounded border border-black bg-emerald-600 px-3 py-1 text-[11px] font-black uppercase text-white hover:bg-emerald-700"
                          }
                          title={production.status === "Completed" || production.status === "Cancelled" ? "Job already closed" : "Close Job"}
                        >
                          <CheckCircle size={12} />
                          {closingId === production.id ? "Confirm?" : "Close"}
                        </button>
                      </td>
                    ) : null}
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
                    {enableIssueAction ? (
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">
                        {(() => {
                          const normalizedRequired = requiredMachines.map((m) => normalizeMachineName(m));
                          const requiresLiner = normalizedRequired.includes("Corrugation Liner");
                          const linerDone = processing.some(
                            (entry) =>
                              entry.productionId === production.id &&
                              normalizeMachineName(entry.machineName) === "Corrugation Liner"
                          );

                          const prereqMissing = !!issuePrereqMachineName && !(prereqQty > 0);

                          if (prereqMissing) {
                            return (
                              <button
                                type="button"
                                disabled
                                title={`${normalizeMachineName(issuePrereqMachineName || "Corrugation Liner")} entry pending`}
                                className="bg-slate-200 text-slate-500 px-3 py-1 rounded font-bold text-[11px] uppercase border border-black cursor-not-allowed"
                              >
                                Issue Material
                              </button>
                            );
                          }

                          if (!requiresLiner || linerDone) {
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  const date = String(production.date || "").slice(0, 10);
                                  const params = new URLSearchParams({
                                    productionId: production.id,
                                    date,
                                    lockDate: "1",
                                    lockJob: "1",
                                  });
                                  navigate(`/material-movement/reel-issue-return?${params.toString()}`);
                                }}
                                className="bg-indigo-600 text-white px-3 py-1 rounded font-bold text-[11px] uppercase border border-black"
                              >
                                Issue Material
                              </button>
                            );
                          }

                          return (
                            <span className="inline-flex items-center rounded border border-amber-700 bg-amber-50 px-2 py-1 text-[11px] font-black uppercase text-amber-800">
                              Add Corrugation Liner entry
                            </span>
                          );
                        })()}
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
      title="Production: Pending Material Issue"
      emptyMessage="No jobs pending material issue."
      predicate={isProductionPendingConsumption}
      enableIssueAction
      hideStatusColumn
      issuePrereqMachineName="Corrugation Liner"
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
      hideStatusColumn
      hideProdFfgColumn
    />
  );
}
