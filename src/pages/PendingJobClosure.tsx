import React, { useEffect, useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, OrderSchedule, Order, Company, ProductionProcessing, Setting, LoadingSlip, LoadingSlipLine, MaterialIssue, Machine } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { ClientPagination } from "../components/ClientPagination";
import { ClipboardList, CheckCircle, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";
import { parseMandatoryMachinesByType } from "../lib/mandatoryMachines";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { getProductionDisplayStatus } from "../lib/productionStageFilters";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getProductionEffectiveType, getRequiredMachinesForProduction } from "../lib/productionType";
import { buildJobClosureStatusMap, formatJobCloseBlockedMessage } from "../lib/jobClosureValidation";

export function PendingJobClosure() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [productions, setProductions] = useData<Production>("productions", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [machines] = useData<Machine>("machines", []);
  const { findItemAcrossSources } = useOrderItemCatalog();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancelModalJobId, setCancelModalJobId] = useState<string | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelSubmittingId, setCancelSubmittingId] = useState<string | null>(null);
  const [editingProductionDateId, setEditingProductionDateId] = useState<string | null>(null);
  const [productionDateDraft, setProductionDateDraft] = useState("");

  const resolveProductionItem = (production?: Production | null) => {
    if (!production) return undefined;
    return findItemAcrossSources(
      String(production.itemId || ""),
      production.itemSource,
      production.erpCode
    );
  };

  const updateCloseMeta = async (id: string, patch: Partial<Pick<Production, "closeBy" | "closeDate">>) => {
    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Completed" || target.status === "Cancelled") return;

    const resolvedPatch = { ...patch };
    const nextCloseBy = String(resolvedPatch.closeBy ?? target.closeBy ?? "").trim();
    const nextCloseDate = String(resolvedPatch.closeDate ?? target.closeDate ?? "").trim();

    if (nextCloseBy === "Yes") {
      if (!nextCloseDate) {
        alert("Close Date is mandatory when Closer is Yes.");
        return;
      }

      const closureStatus = jobClosureStatusMap.get(id);
      if (!closureStatus?.canClose) {
        alert(formatJobCloseBlockedMessage(closureStatus));
        return;
      }
    }

    const timestamp = new Date().toISOString();
    await setProductions((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              ...resolvedPatch,
              updateTimestamp: timestamp,
              updatedBy: "System User",
            }
          : p
      )
    );
  };

  const issuedProductionIds = useMemo(() => {
    const ids = new Set<string>();
    materialIssues.forEach((issue) => {
      const productionId = String(issue.productionId || "").trim();
      if (productionId) ids.add(productionId);
    });
    return ids;
  }, [materialIssues]);

  const hasMaterialIssue = (productionId: string) => issuedProductionIds.has(String(productionId || "").trim());

  const startEditingProductionDate = (production: Production) => {
    if (hasMaterialIssue(production.id)) {
      alert("Production Date cannot be changed after Material Issue is created for this job.");
      return;
    }
    setEditingProductionDateId(production.id);
    setProductionDateDraft((production.date || "").split("T")[0]);
  };

  const cancelEditingProductionDate = () => {
    setEditingProductionDateId(null);
    setProductionDateDraft("");
  };

  const saveProductionDate = async (id: string) => {
    if (hasMaterialIssue(id)) {
      alert("Production Date cannot be changed after Material Issue is created for this job.");
      cancelEditingProductionDate();
      return;
    }
    const nextDate = productionDateDraft.trim();
    if (!nextDate) {
      alert("Production Date is mandatory.");
      return;
    }
    const timestamp = new Date().toISOString();
    await setProductions((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              date: nextDate,
              updateTimestamp: timestamp,
              updatedBy: user?.name || "System User",
            }
          : row
      )
    );
    cancelEditingProductionDate();
  };

  const processingTotalsMap = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    processing.forEach((p) => {
      const totals = map.get(p.productionId) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
      const machineColumn = PROCESSING_MACHINE_COLUMNS.find(col => (col.machineNames as readonly string[]).includes(p.machineName));
      if (machineColumn) {
        totals[machineColumn.key] += Number(p.qty || 0);
      }
      map.set(p.productionId, totals);
    });
    return map;
  }, [processing]);

  const processingMachinesMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    processing.forEach((row) => {
      const set = map.get(row.productionId) || new Set<string>();
      set.add(normalizeMachineName(row.machineName));
      map.set(row.productionId, set);
    });
    return map;
  }, [processing]);

  const mandatoryMachinesByType = useMemo(() => parseMandatoryMachinesByType(settings[0]), [settings]);

  const jobClosureStatusMap = useMemo(() => {
    return buildJobClosureStatusMap({
      productions,
      processing,
      mandatoryMachinesByType,
      machines,
      resolveProductionItem,
    });
  }, [productions, processing, mandatoryMachinesByType, machines, findItemAcrossSources]);
  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach(p => {
      if (p.status === "Cancelled" || p.cancelTimestamp) return;
      
      const erp = String(p.erpCode || "").trim();
      const gsm = Number(p.gsm || 0);
      if (erp && gsm > 0) {
        if (!map.has(erp) || gsm < map.get(erp)!) {
          map.set(erp, gsm);
        }
      }
    });
    return map;
  }, [productions]);

  const loadedQtyByProductionId = useMemo(() => {
    const map = new Map<string, number>();
    const getJobAllocations = (line: LoadingSlipLine) =>
      Array.isArray(line.allocations)
        ? line.allocations.filter((allocation) => allocation.sourceType === "job")
        : [];

    loadingSlips.forEach((slip) => {
      slip.lines.forEach((line) => {
        getJobAllocations(line).forEach((allocation) => {
          map.set(allocation.jobId, (map.get(allocation.jobId) || 0) + Number(allocation.qty || 0));
        });
      });
    });

    return map;
  }, [loadingSlips]);

  const openCancelModal = (id: string) => {
    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Cancelled") return;
    setCancelModalJobId(id);
    setCancelRemarks("");
    setCancelError("");
  };

  const closeCancelModal = () => {
    if (cancelSubmittingId) return;
    setCancelModalJobId(null);
    setCancelRemarks("");
    setCancelError("");
  };

  const handleCancelJob = async () => {
    const id = cancelModalJobId;
    if (!id) return;

    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Cancelled") return;

    const reason = cancelRemarks.trim();
    if (!reason) {
      setCancelError("Cancel reason is mandatory.");
      return;
    }

    const timestamp = new Date().toISOString();
    setCancelSubmittingId(id);

    try {
      await setProductions((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "Cancelled",
                cancelTimestamp: timestamp,
                cancelEmailId: user?.email || "System User",
                cancelRemarks: reason,
                updateTimestamp: timestamp,
                updatedBy: user?.name || "System User",
              }
            : p
        )
      );

      if (target.scheduleId) {
        await setSchedules((prev) =>
          prev.map((schedule) =>
            schedule.id === target.scheduleId
              ? {
                  ...schedule,
                  producedQty: Math.max(0, Number(schedule.producedQty || 0) - Number(target.qty || 0)),
                  updateTimestamp: timestamp,
                  updatedBy: user?.name || "System User",
                }
              : schedule
          )
        );
      }

      alert("Job cancelled successfully.");
      setCancelModalJobId(null);
      setCancelRemarks("");
      setCancelError("");
    } catch (err) {
      console.error("Failed to cancel job:", err);
      alert("Failed to cancel job. Please try again.");
    } finally {
      setCancelSubmittingId(null);
    }
  };

  const handleCloseJob = async (id: string) => {
    const target = productions.find((p) => p.id === id);
    if (!target || target.status === "Completed" || target.status === "Cancelled") return;

    const closureStatus = jobClosureStatusMap.get(id);
    if (!closureStatus?.canClose) {
      const reasons = closureStatus?.reasons?.length ? closureStatus.reasons : ["Processing data is incomplete."];
      alert(formatJobCloseBlockedMessage(closureStatus));
      return;
    }

    if (closingId !== id) {
      setClosingId(id);
      setTimeout(() => setClosingId(null), 3000);
      return;
    }

    const timestamp = new Date().toISOString();
    const closeDate = new Date().toISOString().split("T")[0];
    try {
      await setProductions((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "Completed",
                tallyTimestamp: p.tallyTimestamp || timestamp,
                closeBy: p.closeBy || "Yes",
                closeDate: p.closeDate || closeDate,
                updateTimestamp: timestamp,
                updatedBy: "System User",
              }
            : p
        )
      );
    } catch (err) {
      console.error("Failed to close job:", err);
    } finally {
      setClosingId(null);
    }
  };

  // Filter for ONLY jobs where closeBy and closeDate are NOT filled
  const filteredList = productions
    .filter(p => {
      // Rule: Only show jobs where closeBy and closeDate are empty/not filled
      const isNotClosed = !p.closeBy && !p.closeDate;
      const isNotCancelled = p.status !== "Cancelled";
      if (!isNotClosed || !isNotCancelled) return false;

      const item = resolveProductionItem(p);
      const schedule = schedules.find(s => s.id === p.scheduleId);
      const order = orders.find(o => o.id === schedule?.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      
      if (companyFilter && order?.companyId !== companyFilter) return false;
      const itemKey = item?.id || `${item?.name || ""}::${p.erpCode || ""}`;
      if (itemFilter && itemKey !== itemFilter) return false;
      return p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order?.orderNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (company?.name || "").toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => b.transactionNo.localeCompare(a.transactionNo, undefined, { numeric: true, sensitivity: 'base' }));

  const companyOptions = useMemo(() => Array.from(new Map(filteredList.map((row) => { const schedule = schedules.find((s) => s.id === row.scheduleId); const order = orders.find((o) => o.id === schedule?.orderId); const company = companies.find((c) => c.id === order?.companyId); return [order?.companyId || "", { value: order?.companyId || "", label: company?.name || "" }]; })).values()).filter((option) => option.value && option.label).sort((a, b) => a.label.localeCompare(b.label)), [companies, filteredList, orders, schedules]);
  const itemOptions = useMemo(() => Array.from(new Map(filteredList.map((row) => { const item = resolveProductionItem(row); const erp = String(row.erpCode || ""); const name = item?.name || ""; const key = item?.id || `${name}::${erp}`; return [key, { value: key, label: erp && name && !name.toLowerCase().includes(erp.toLowerCase()) ? `${name} - ${erp}` : name || erp, searchText: `${name} ${erp}` }]; })).values()).filter((option) => option.value && option.label).sort((a, b) => a.label.localeCompare(b.label)), [filteredList, findItemAcrossSources]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedList,
  } = useClientPagination(filteredList, 25);

  const getMandatoryStatus = (production: Production, item?: any) => {
    const status = jobClosureStatusMap.get(production.id);
    return {
      required: status?.required || [],
      done: status?.done || 0,
      missing: status?.missing || [],
    };
  };

  const cancelTarget = cancelModalJobId ? productions.find((p) => p.id === cancelModalJobId) : null;
  const cancelTargetSchedule = cancelTarget?.scheduleId ? schedules.find((schedule) => schedule.id === cancelTarget.scheduleId) : null;
  const cancelTargetOrder = cancelTargetSchedule ? orders.find((order) => order.id === cancelTargetSchedule.orderId) : null;
  const cancelTargetItem = cancelTarget ? resolveProductionItem(cancelTarget) : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Job Closure</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(260px,1.4fr)_minmax(220px,1fr)_minmax(260px,1.1fr)_auto] md:items-center">
        <TableControls
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          placeholder="Search pending closures..."
        />
        <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
        <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
        {(searchTerm || companyFilter || itemFilter) ? (
          <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
        ) : null}
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {paginatedList.map((p) => {
                const schedule = schedules.find(s => s.id === p.scheduleId);
                const order = orders.find(o => o.id === schedule?.orderId);
                const company = companies.find(c => c.id === order?.companyId);
                const item = resolveProductionItem(p);
                const erp = String(p.erpCode || "").trim();
                const leastGsm = erpLeastGsmMap.get(erp);
                const isHighGsm = p.gsm && leastGsm && Number(p.gsm) > Number(leastGsm);
                const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
                  const closureStatus = jobClosureStatusMap.get(p.id);
                  const mandatoryCloseDataComplete = closureStatus?.canClose === true;
                const mandatory = getMandatoryStatus(p, item);
                
                return (
                  <div key={p.id} className={`${isHighGsm ? "bg-amber-50" : "bg-white"} border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative`}>
                       <div className="flex justify-between items-center">
                          <div className="font-bold text-sm">Job: {p.transactionNo}</div>
                      </div>
	                      <div className="text-xs text-slate-500">Prod Date: {formatDate(p.date)}</div>
	                      {order && (
	                        <>
	                          <div className="text-xs font-bold text-slate-700">Order: {order.orderNo} ({formatDate(order.orderDate)})</div>
                          <div className="text-xs font-bold text-slate-700">ERP Code: {p.erpCode || "-"}</div>
                          <div className="text-xs font-bold text-slate-700">Company: {company?.name || "Unknown"}</div>
                        </>
                      )}
                      <div className="text-sm font-bold">{item?.name || "Unknown"}</div>
                      <div className="text-[10px] text-slate-600 uppercase font-black">
                        Type: {getProductionEffectiveType(p, item) || "-"} | Print: {p.printingColor || "-"}
                      </div>
                      <div className="text-[10px] text-slate-600 uppercase font-bold">
                        OD: {(item as any)?.lOd || item?.raw?.lOd || "-"}{" x "}{(item as any)?.wOd || item?.raw?.wOd || "-"}{" x "}{(item as any)?.hOd || item?.raw?.hOd || "-"}
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <div className="flex flex-col">
                          <span>{p.qty} {p.uom}</span>
                          <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 px-1 rounded border border-indigo-100">Production FFG: {Number(p.prodFromFFG || 0).toLocaleString()}</span>
                        </div>
                        <span className="font-bold text-amber-700">Loaded: {Number(loadedQtyByProductionId.get(p.id) || 0).toLocaleString()}</span>
                        <div className="flex flex-col items-end text-[10px] font-bold text-indigo-700 bg-indigo-50 p-1 border border-indigo-100 rounded">
                          <div>Pa:{procTotals.paper} | Li:{procTotals.liner} | Pr:{procTotals.printing}</div>
                          <div>Ps:{procTotals.pasting} | St:{procTotals.stitching} | Pu:{procTotals.punching} | Gl:{procTotals.gluing}</div>
                          <div className="mt-1 pt-1 border-t border-indigo-200 text-emerald-700 font-black">Actual Paper: {Number(p.actualPaperUsed || 0).toFixed(2)} KG</div>
                        </div>
                        <div className="flex flex-col items-end">
                            {p.gsm && <span className="font-bold text-indigo-700">GSM: {p.gsm}</span>}
                            {leastGsm && <span className="text-[10px] font-black text-emerald-700">Least: {leastGsm}</span>}
                        </div>
                      </div>
                      {mandatory.required.length > 0 ? (
                        <div
                          className={
                            mandatory.missing.length === 0
                              ? "text-[10px] font-black text-emerald-700 bg-emerald-50 p-1.5 rounded border border-emerald-200"
                              : "text-[10px] font-black text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200"
                          }
                        >
                          Mandatory: {mandatory.done}/{mandatory.required.length}
                          {mandatory.missing.length ? ` | Missing: ${mandatory.missing.join(", ")}` : ""}
                        </div>
                      ) : null}
                       <div className="flex gap-2 mt-2">
                       <button 
                          onClick={() => navigate(`/production-processing/form?productionId=${p.id}`)}
                          className="flex-1 bg-indigo-600 text-white font-bold inline-flex items-center justify-center p-2 border border-black text-xs hover:bg-indigo-700"
                        >
                          <ClipboardList size={14} className="mr-1" /> Report Proc.
                        </button>
                        {editingProductionDateId === p.id ? (
                          <>
                            <input
                              type="date"
                              value={productionDateDraft}
                              onChange={(e) => setProductionDateDraft(e.target.value)}
                              className="min-w-[140px] border border-black rounded px-2 py-1 text-xs bg-white"
                            />
                            <button
                              onClick={() => void saveProductionDate(p.id)}
                              className="font-bold inline-flex items-center justify-center p-2 border border-black text-xs bg-white hover:bg-slate-100"
                            >
                              Save Date
                            </button>
                            <button
                              onClick={cancelEditingProductionDate}
                              className="font-bold inline-flex items-center justify-center p-2 border border-black text-xs bg-white hover:bg-slate-100"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => startEditingProductionDate(p)}
                            disabled={hasMaterialIssue(p.id)}
                            title={hasMaterialIssue(p.id) ? "Date change is blocked after Material Issue" : "Change production date"}
                            className="font-bold inline-flex items-center justify-center p-2 border border-black text-xs bg-white hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            Change Date
                          </button>
                        )}
                        {mandatoryCloseDataComplete ? (
                          <button
                            onClick={() => handleCloseJob(p.id)}
                            className={`flex-1 font-bold inline-flex items-center justify-center p-2 border border-black text-xs ${
                              closingId === p.id
                                ? "bg-amber-500 text-black animate-pulse"
                                : "bg-emerald-600 text-white hover:bg-emerald-700"
                            }`}
                          >
                            <CheckCircle size={14} className="mr-1" /> {closingId === p.id ? "Confirm?" : "Close Job"}
                          </button>
                        ) : null}
                        <button 
                          onClick={() => openCancelModal(p.id)} 
                          className="text-red-600 hover:text-red-900 font-bold inline-flex items-center justify-center p-2 border border-black text-xs min-w-[80px]"
                        >
                          <XCircle size={14} className="mr-1" /> Cancel Job
                        </button>
                      </div>
                  </div>
                );
            })}
        </div>
        <div className="table-sticky-scroll hidden md:block pb-2">
          <table className="min-w-max w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Sr. No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Order No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">ERP Code</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Plan Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Sample</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Mandatory</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Planned Qty</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">UPS</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap bg-amber-50">Loaded Qty</th>

                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Paper</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Liner</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Print</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Paste</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Stitch</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Punch</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Glue</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">B</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">H</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L (OD)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">W (OD)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">H (OD)</th>
                
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Ply</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Flute</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L1</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">F1</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L2</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">F2</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L3</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Top</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">GSM</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Least GSM</th>

                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Color 1</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Color 2</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Printing Color</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Paper Req.</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Top Paper Wt (KG)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Liner Wt (KG)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Total Job Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Liner Required (Nos)</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Total Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Avg Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Wastage</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Real/KG</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Reel (Calc)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Reel Trim</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Cutting Trim</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Planned Prod (M)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Sheet Wt</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Flute Batch</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Rate</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Value</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap bg-indigo-50/50">Production FFG</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-emerald-900 uppercase border border-black whitespace-nowrap bg-emerald-50">Actual Paper (KG)</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job Closer</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Close Date</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={56} className="px-6 py-8 text-center text-black font-medium">No pending closures found.</td>
                </tr>
              ) : (
                paginatedList.map((p, idx) => {
                  const srNo = (page - 1) * pageSize + idx + 1;
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = resolveProductionItem(p);
                  const mandatory = getMandatoryStatus(p, item);
                  const erp = String(p.erpCode || "").trim();
                  const leastGsm = erpLeastGsmMap.get(erp);
                  const isHighGsm = p.gsm && leastGsm && Number(p.gsm) > Number(leastGsm);
                  const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
                  const closureStatus = jobClosureStatusMap.get(p.id);
                  const mandatoryCloseDataComplete = closureStatus?.canClose === true;
                  const baseCloseFieldsDisabled = !Number(p.actualPaperUsed || 0) || !Number(p.prodFromFFG || 0);
                  const closeFieldsDisabled = baseCloseFieldsDisabled || !mandatoryCloseDataComplete;
                  const closeFieldsDisabledTitle = !mandatoryCloseDataComplete
                    ? "Complete all mandatory machine processing data to enable job closer"
                    : baseCloseFieldsDisabled
                      ? "Actual Paper and Production FFG are required to enable job closer"
                      : undefined;                  
                    return (
                    <tr key={p.id} className={`${isHighGsm ? "bg-amber-50" : "hover:bg-slate-50"} divide-x divide-black transition-colors`}>
                      <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{srNo}</td>
                      <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.erpCode || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black min-w-[150px]">{item?.name || "Unknown"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{(item as any)?.isSample ? "Yes" : "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{getProductionEffectiveType(p, item) || "-"}</td>
                      <td className="px-4 py-4 text-[11px] text-black border border-black whitespace-nowrap">
                        {mandatory.required.length === 0 ? (
                          "-"
                        ) : mandatory.missing.length === 0 ? (
                          <span className="font-black text-emerald-700">Done {mandatory.done}/{mandatory.required.length}</span>
                        ) : (
                          <div className="space-y-1">
                            <div className="font-black text-amber-700">Pending {mandatory.done}/{mandatory.required.length}</div>
                            <div className="text-[10px] font-semibold text-slate-600 whitespace-normal max-w-[240px]">
                              Missing: {mandatory.missing.join(", ")}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right text-xs font-medium text-emerald-700 border border-black whitespace-nowrap">{p.qty} {p.uom}</td>
                      <td className="px-4 py-4 text-center text-xs font-medium text-black border border-black whitespace-nowrap">{p.ups || (item as any)?.ups || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-amber-700 border border-black whitespace-nowrap bg-amber-50/40">
                        {Number(loadedQtyByProductionId.get(p.id) || 0).toLocaleString()}
                      </td>

                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.paper.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.liner.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.printing.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.pasting.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.stitching.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.punching.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.gluing.toLocaleString()}</td>
                      
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.length || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.breadth || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.height || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{(item as any)?.lOd || item?.raw?.lOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{(item as any)?.wOd || item?.raw?.wOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{(item as any)?.hOd || item?.raw?.hOd || "-"}</td>

                      <td className="px-4 py-4 text-center text-xs text-black border border-black whitespace-nowrap">{p.ply || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.flute || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.l1 || (item as any)?.l1 || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.f1 || (item as any)?.f1 || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.l2 || (item as any)?.l2 || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.f2 || (item as any)?.f2 || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.l3 || (item as any)?.l3 || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.top || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-700">{p.gsm || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-black text-emerald-700">{erpLeastGsmMap.get(erp) || "-"}</td>

                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.color1 || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.color2 || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.printingColor || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.paperRequiredNos || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.topPaperWeightKg || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.linerWeightKg || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.totalJobWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.lineRequiredNos || "-"}</td>
                      
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.totalPaperWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.avgWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.wastage || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">
                        {Number(p.realizationPerKg || 0) ? Number(p.realizationPerKg || 0).toFixed(2) : "-"}
                      </td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{(p as any).reelAsPerCalc || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{(p as any).reelActualWithTrimming || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{(p as any).cuttingWithTrimming || (item as any)?.cuttingSize || item?.raw?.cuttingSize || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.plannedProductionInMeter ?? "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.sheetWeight || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.fluteBatches || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{Number(p.rate) ? Number(p.rate).toFixed(2) : (p.rate || "-")}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{Number(p.qty || 0) && Number(p.rate || 0) ? (Number(p.qty || 0) * Number(p.rate || 0)).toLocaleString() : "-"}</td>

                      <td className="px-4 py-4 text-right text-xs font-bold text-black border border-black whitespace-nowrap bg-indigo-50/20">{Number(p.prodFromFFG || 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-emerald-700 border border-black whitespace-nowrap bg-emerald-50/30">{Number(p.actualPaperUsed || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">
                        <select
                          value={p.closeBy || ""}
                          disabled={closeFieldsDisabled}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            if (nextValue === "Yes" && !mandatoryCloseDataComplete) {
                              alert(formatJobCloseBlockedMessage(jobClosureStatusMap.get(p.id)));
                              return;
                            }
                            const today = new Date().toISOString().split("T")[0];
                            void setProductions((prev) =>
                              prev.map((row) =>
                                row.id === p.id
                                  ? {
                                      ...row,
                                      closeBy: nextValue,
                                      closeDate: nextValue === "Yes" ? row.closeDate || today : row.closeDate,
                                    }
                                  : row
                              )
                            );
                          }}
                          onBlur={(e) => void updateCloseMeta(p.id, { closeBy: e.target.value, closeDate: p.closeDate })}
                          title={closeFieldsDisabledTitle}
                          className="w-24 border border-black rounded px-2 py-1 text-xs bg-white disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                        >
                          <option value=""></option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      </td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">
                        <input
                          type="date"
                          value={(p.closeDate || "").split("T")[0]}
                          disabled={closeFieldsDisabled}
                          onChange={(e) => {
                            if (p.closeBy === "Yes" && !mandatoryCloseDataComplete) {
                              alert(formatJobCloseBlockedMessage(jobClosureStatusMap.get(p.id)));
                              return;
                            }
                            void setProductions((prev) => prev.map((row) => (row.id === p.id ? { ...row, closeDate: e.target.value } : row)));
                          }}
                          onBlur={(e) => void updateCloseMeta(p.id, { closeDate: e.target.value, closeBy: p.closeBy })}
                          title={closeFieldsDisabledTitle}
                          className={`w-36 border rounded px-2 py-1 text-xs disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 ${p.closeBy === "Yes" && !p.closeDate ? "border-red-600" : "border-black"}`}
                          required={p.closeBy === "Yes"}
                        />
                      </td>
                      <td className="px-4 py-4 text-center text-xs font-medium border border-black whitespace-nowrap">
                        <div className="flex items-center justify-center gap-3">
                          <button 
                            onClick={() => navigate(`/production-processing/form?productionId=${p.id}`)}
                            title="Report Processing"
                            className="text-indigo-600 hover:text-indigo-900 transition-all p-1"
                          >
                            <ClipboardList size={16} />
                          </button>
                          {editingProductionDateId === p.id ? (
                            <>
                              <input
                                type="date"
                                value={productionDateDraft}
                                onChange={(e) => setProductionDateDraft(e.target.value)}
                                className="w-36 border border-black rounded px-2 py-1 text-xs bg-white"
                              />
                              <button
                                onClick={() => void saveProductionDate(p.id)}
                                title="Save production date"
                                className="text-slate-700 hover:text-slate-900 transition-all px-2 py-1 border border-black rounded text-[11px] font-bold bg-white"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingProductionDate}
                                title="Cancel date edit"
                                className="text-slate-700 hover:text-slate-900 transition-all px-2 py-1 border border-black rounded text-[11px] font-bold bg-white"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditingProductionDate(p)}
                              disabled={hasMaterialIssue(p.id)}
                              title={hasMaterialIssue(p.id) ? "Date change is blocked after Material Issue" : "Change production date"}
                              className="text-slate-700 hover:text-slate-900 transition-all px-2 py-1 border border-black rounded text-[11px] font-bold bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              Date
                            </button>
                          )}
                          {p.status !== "Completed" && p.status !== "Cancelled" && mandatoryCloseDataComplete ? (
                            <button
                              onClick={() => handleCloseJob(p.id)}
                              title={closingId === p.id ? "Click to confirm close" : "Close job"}
                              className={`transition-all p-1 ${
                                closingId === p.id
                                  ? "text-amber-600 animate-pulse scale-110"
                                  : "text-emerald-700 hover:text-emerald-900"
                              }`}
                            >
                              <CheckCircle size={16} />
                            </button>
                          ) : null}
                          {p.status !== "Completed" && p.status !== "Cancelled" && (
                            <button 
                              onClick={() => openCancelModal(p.id)} 
                              title="Cancel job"
                              className="text-red-600 hover:text-red-900 transition-all p-1"
                            >
                              <XCircle size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
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

      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeCancelModal}>
          <div className="w-full max-w-lg rounded border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-black px-5 py-4">
              <h3 className="text-lg font-black uppercase tracking-tight text-black">Cancel Job</h3>
              <div className="mt-2 text-xs font-bold text-slate-600">
                Job: {cancelTarget.transactionNo} | Order: {cancelTargetOrder?.orderNo || "-"} | Item: {cancelTargetItem?.name || "Unknown"}
              </div>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="text-sm font-medium text-slate-700">
                This will return{" "}
                <span className="font-black text-red-700">
                  {Number(cancelTarget.qty || 0).toLocaleString()} {cancelTarget.uom || ""}
                </span>{" "}
                to Pending Production Plan.
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-wider text-black">
                  Cancel Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  autoFocus
                  rows={4}
                  value={cancelRemarks}
                  onChange={(e) => {
                    setCancelRemarks(e.target.value);
                    if (cancelError) setCancelError("");
                  }}
                  placeholder="Enter cancellation reason"
                  className={`w-full rounded border-2 px-3 py-2 text-sm text-black outline-none ${cancelError ? "border-red-600" : "border-black"}`}
                />
                {cancelError ? <div className="text-xs font-bold text-red-600">{cancelError}</div> : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-black px-5 py-4">
              <button
                onClick={closeCancelModal}
                disabled={Boolean(cancelSubmittingId)}
                className="rounded border border-black px-4 py-2 text-sm font-bold text-black hover:bg-slate-50 disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={() => void handleCancelJob()}
                disabled={Boolean(cancelSubmittingId)}
                className="rounded border border-black bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelSubmittingId === cancelTarget.id ? "Cancelling..." : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
