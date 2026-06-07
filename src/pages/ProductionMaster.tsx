import React, { useEffect, useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, Item, OrderSchedule, Order, Company, ProductionProcessing, Setting, LoadingSlip, LoadingSlipLine } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { ClientPagination } from "../components/ClientPagination";
import { ClipboardList, CheckCircle, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";
import { getRequiredMachinesForType, parseMandatoryMachinesByType } from "../lib/mandatoryMachines";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { getProductionDisplayStatus } from "../lib/productionStageFilters";
import { fetchNpdItems } from "../lib/npdItems";
import { useClientPagination } from "../hooks/useClientPagination";

export function ProductionMaster() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [productions, setProductions] = useData<Production>("productions", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [npdItems, setNpdItems] = useState<Item[]>([]);

  useEffect(() => {
    fetchNpdItems()
      .then(setNpdItems)
      .catch((error) => {
        console.error("Failed to fetch NPD items for Production Master:", error);
        setNpdItems([]);
      });
  }, []);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancelModalJobId, setCancelModalJobId] = useState<string | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelSubmittingId, setCancelSubmittingId] = useState<string | null>(null);

  const ffgSummaries = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const totals = {
      today: 0,
      yesterday: 0,
      total: 0
    };

    productions.forEach(p => {
      const qty = Number(p.prodFromFFG || 0);
      const prodDate = p.date?.split("T")[0];

      if (prodDate === today) totals.today += qty;
      if (prodDate === yesterdayStr) totals.yesterday += qty;
      totals.total += qty;
    });

    return totals;
  }, [productions]);

  const updateCloseMeta = async (id: string, patch: Partial<Pick<Production, "closeBy" | "closeDate">>) => {
    const resolvedPatch = { ...patch };
    if (resolvedPatch.closeBy === "Yes" && !resolvedPatch.closeDate) {
      alert("Close Date is mandatory when Closer is Yes.");
      return;
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
    const isCorrugationLiner = (name?: string | null) =>
      String(normalizeMachineName(name || "")).trim().toLowerCase() === "corrugation liner";

    const result = new Map<string, { canClose: boolean; reasons: string[] }>();

    productions.forEach((production) => {
      const item = npdItems.find((i) => i.id === String(production.itemId || "").trim());
      const boxType = (item as any)?.boxType;
      const requiredMachines = getRequiredMachinesForType(mandatoryMachinesByType, boxType).map((m) =>
        normalizeMachineName(m)
      );

      const records = processing.filter((entry) => entry.productionId === production.id);
      const planQty = Number(production.qty || 0);

      const reasons: string[] = [];

      if (requiredMachines.length === 0) {
        reasons.push(`No required process steps configured for Type: ${String(boxType || "-")}`);
      }

      const isEntryComplete = (entry: ProductionProcessing) => {
        const qtyValue = Number(entry.qty || 0);
        if (!Number.isFinite(qtyValue) || qtyValue <= 0) return false;
        if (!String(entry.machineId || "").trim()) return false;
        if (!String(entry.operatorId || "").trim()) return false;
        if (!String(entry.shift || "").trim()) return false;
        if (!String(entry.date || "").trim()) return false;
        return true;
      };

      requiredMachines.forEach((machineName) => {
        const normalized = normalizeMachineName(machineName);
        const stepRecords = records.filter(
          (r) => normalizeMachineName(r.machineName) === normalized
        );
        if (stepRecords.length === 0) {
          reasons.push(`Missing processing step: ${normalized}`);
          return;
        }

        if (!stepRecords.some(isEntryComplete)) {
          reasons.push(`Incomplete processing entry: ${normalized}`);
        }

        if (!isCorrugationLiner(normalized) && planQty > 0) {
          const stepQty = stepRecords.reduce((sum, r) => sum + Number(r.qty || 0), 0);
          if (stepQty > planQty) {
            reasons.push(`Qty exceeds Plan Qty for ${normalized} (Plan ${planQty}, Reported ${stepQty})`);
          }
        }
      });

      result.set(production.id, { canClose: reasons.length === 0, reasons });
    });

    return result;
  }, [productions, npdItems, processing, mandatoryMachinesByType]);

  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach(p => {
      // Skip canceled jobs for least cost calculation
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
      alert(`Job Close is blocked:\n- ${reasons.join("\n- ")}`);
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

  const filteredList = productions
    .filter(p => {
      const item = npdItems.find(i => i.id === String(p.itemId || "").trim());
      const schedule = schedules.find(s => s.id === p.scheduleId);
      const order = orders.find(o => o.id === schedule?.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      
      return p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order?.orderNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (company?.name || "").toLowerCase().includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => b.transactionNo.localeCompare(a.transactionNo, undefined, { numeric: true, sensitivity: 'base' }));
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedList,
  } = useClientPagination(filteredList, 25);

  const getProcessingSummary = (pId: string) => {
    const records = processing.filter(p => p.productionId === pId);
    if (records.length === 0) return "Pending";
    const machines = Array.from(new Set(records.map(r => r.machineName))).join(", ");
    const totalQty = records.reduce((sum, r) => sum + r.qty, 0);
    return `${machines} (${totalQty})`;
  };

  const getMandatoryStatus = (productionId: string, boxType?: string) => {
    const required = getRequiredMachinesForType(mandatoryMachinesByType, boxType);
    if (required.length === 0) return { required, done: 0, missing: [] as string[] };

    const doneSet = processingMachinesMap.get(productionId) || new Set<string>();
    const missing = required.filter((name) => !doneSet.has(normalizeMachineName(name)));
    return { required, done: required.length - missing.length, missing };
  };

  const cancelTarget = cancelModalJobId ? productions.find((p) => p.id === cancelModalJobId) : null;
  const cancelTargetSchedule = cancelTarget?.scheduleId ? schedules.find((schedule) => schedule.id === cancelTarget.scheduleId) : null;
  const cancelTargetOrder = cancelTargetSchedule ? orders.find((order) => order.id === cancelTargetSchedule.orderId) : null;
  const cancelTargetItem = cancelTarget ? npdItems.find((item) => item.id === String(cancelTarget.itemId || "").trim()) : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Master</h2>
      </div>

      {/* FFG Summaries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border-2 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
          <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">FFG Produced Today</div>
          <div className="text-2xl font-black text-indigo-700">{ffgSummaries.today.toLocaleString()} <span className="text-sm font-bold text-slate-400">PCS</span></div>
        </div>
        <div className="bg-white border-2 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
          <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">FFG Produced Yesterday</div>
          <div className="text-2xl font-black text-amber-700">{ffgSummaries.yesterday.toLocaleString()} <span className="text-sm font-bold text-slate-400">PCS</span></div>
        </div>
        <div className="bg-white border-2 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
          <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Total FFG Produced</div>
          <div className="text-2xl font-black text-emerald-700">{ffgSummaries.total.toLocaleString()} <span className="text-sm font-bold text-slate-400">PCS</span></div>
        </div>
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search productions..." 
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {paginatedList.map((p) => {
                const schedule = schedules.find(s => s.id === p.scheduleId);
                const order = orders.find(o => o.id === schedule?.orderId);
                const company = companies.find(c => c.id === order?.companyId);
                const item = npdItems.find(i => i.id === String(p.itemId || "").trim());
                const erp = String(p.erpCode || "").trim();
                const leastGsm = erpLeastGsmMap.get(erp);
                const isHighGsm = p.gsm && leastGsm && Number(p.gsm) > Number(leastGsm);
                const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
                const mandatory = getMandatoryStatus(p.id, (item as any)?.boxType);
                const displayStatus = getProductionDisplayStatus(p);
                
                return (
                  <div key={p.id} className={`${isHighGsm ? "bg-amber-50" : "bg-white"} border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative`}>
                       <div className="flex justify-between items-center">
                          <div className="font-bold text-sm">Job: {p.transactionNo}</div>
                           <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                              displayStatus === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                              displayStatus === 'Cancelled' ? 'bg-red-100 text-red-900 border-red-900' :
                              'bg-amber-100 text-amber-900 border-amber-900'
                          }`}>
                              {displayStatus}
                          </span>
                      </div>
	                      <div className="text-xs text-slate-500">Prod Date: {formatDate(p.date)}</div>
	                      {displayStatus === "Completed" ? (
	                        <div className="text-xs text-slate-500">
	                          Closed: {formatDate(p.closeDate || p.tallyTimestamp || p.updateTimestamp || "") || "-"}
	                        </div>
	                      ) : null}
	                      {order && (
	                        <>
	                          <div className="text-xs font-bold text-slate-700">Order: {order.orderNo} ({formatDate(order.orderDate)})</div>
                          <div className="text-xs font-bold text-slate-700">ERP Code: {p.erpCode || "-"}</div>
                          <div className="text-xs font-bold text-slate-700">Company: {company?.name || "Unknown"}</div>
                        </>
                      )}
                      <div className="text-sm font-bold">{item?.name || "Unknown"}</div>
                      <div className="text-[10px] text-slate-600 uppercase font-black">
                        Type: {(item as any)?.boxType || "-"} | Print: {p.printingColor || "-"}
                      </div>
                      <div className="text-[10px] text-slate-600 uppercase font-bold">
                        OD: {item?.lOd || "-"}×{item?.wOd || "-"}×{item?.hOd || "-"} | Flap: {item?.flap || "-"} | Deckle: {item?.deckleSize || "-"} | Cutting: {item?.cuttingSize || "-"}
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span>{p.qty} {p.uom}</span>
                        <span className="font-bold text-amber-700">Loaded: {Number(loadedQtyByProductionId.get(p.id) || 0).toLocaleString()}</span>
                        <div className="flex flex-col items-end text-[10px] font-bold text-indigo-700 bg-indigo-50 p-1 border border-indigo-100 rounded">
                          <div>Pa:{procTotals.paper} | Li:{procTotals.liner} | Pr:{procTotals.printing}</div>
                          <div>Ps:{procTotals.pasting} | St:{procTotals.stitching} | Pu:{procTotals.punching} | Gl:{procTotals.gluing}</div>
                        </div>
                        <div className="flex flex-col items-end">
                            {p.gsm && <span className="font-bold text-indigo-700">GSM: {p.gsm}</span>}
                            {leastGsm && <span className="text-[10px] font-black text-emerald-700">Least: {leastGsm}</span>}
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 p-1.5 rounded border border-indigo-100">
                        Processing: {getProcessingSummary(p.id)}
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
                      {p.status === 'Cancelled' && p.cancelRemarks && (
                        <div className="text-xs bg-red-50 text-red-700 p-2 border border-red-200 rounded font-medium mt-1">
                          Cancel Reason: {p.cancelRemarks}
                        </div>
                      )}
                       <div className="flex gap-2 mt-2">
                       <button 
                          onClick={() => navigate(`/production-processing/form?productionId=${p.id}`)}
                          className="flex-1 bg-indigo-600 text-white font-bold inline-flex items-center justify-center p-2 border border-black text-xs hover:bg-indigo-700"
                        >
                          <ClipboardList size={14} className="mr-1" /> Report Proc.
                        </button>
                        {p.status !== "Completed" && p.status !== "Cancelled" && jobClosureStatusMap.get(p.id)?.canClose ? (
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
                        {p.status !== "Completed" && p.status !== "Cancelled" && (
                          <button 
                            onClick={() => openCancelModal(p.id)} 
                            className="text-red-600 hover:text-red-900 font-bold inline-flex items-center justify-center p-2 border border-black text-xs min-w-[80px]"
                          >
                            <XCircle size={14} className="mr-1" /> Cancel Job
                          </button>
                        )}
                      </div>
                  </div>
                );
            })}
        </div>
        <div className="hidden md:block overflow-x-auto pb-2 w-full">
          <table className="min-w-max w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
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
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Flap</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Deckle</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Cutting</th>
                
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
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Line Req.</th>
                
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
                
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Processing Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job Closer</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Close Date</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={60} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
                </tr>
              ) : (
                paginatedList.map((p, idx) => {
                  const srNo = (page - 1) * pageSize + idx + 1;
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = npdItems.find(i => i.id === String(p.itemId || "").trim());
                  const mandatory = getMandatoryStatus(p.id, (item as any)?.boxType);
                  const erp = String(p.erpCode || "").trim();
                  const leastGsm = erpLeastGsmMap.get(erp);
                  const isHighGsm = p.gsm && leastGsm && Number(p.gsm) > Number(leastGsm);
                  const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
                  
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
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{(item as any)?.boxType || "-"}</td>
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
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.lOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.wOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.hOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{item?.flap || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{item?.deckleSize || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{item?.cuttingSize || "-"}</td>

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
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{(p as any).cuttingWithTrimming || item?.cuttingSize || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.plannedProductionInMeter ?? "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.sheetWeight || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.fluteBatches || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{Number(p.rate) ? Number(p.rate).toFixed(2) : (p.rate || "-")}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{Number(p.qty || 0) && Number(p.rate || 0) ? (Number(p.qty || 0) * Number(p.rate || 0)).toLocaleString() : "-"}</td>

                      <td className="px-4 py-4 text-xs text-indigo-600 font-bold border border-black max-w-[200px] truncate" title={getProcessingSummary(p.id)}>
                        {getProcessingSummary(p.id)}
                      </td>

                      <td className="px-4 py-4 text-xs border border-black whitespace-nowrap">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                          getProductionDisplayStatus(p) === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                          getProductionDisplayStatus(p) === 'Cancelled' ? 'bg-red-100 text-red-900 border-red-900' :
                          'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                          {getProductionDisplayStatus(p)}
                        </span>
                        {p.status === 'Cancelled' && p.cancelRemarks && (
                          <div className="text-[9px] text-red-600 font-bold mt-1 max-w-[120px] truncate" title={p.cancelRemarks}>
                            {p.cancelRemarks}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">
                        <select
                          value={p.closeBy || ""}
                          onChange={(e) => {
                            const nextValue = e.target.value;
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
                          className="w-24 border border-black rounded px-2 py-1 text-xs bg-white"
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
                          onChange={(e) => void setProductions((prev) => prev.map((row) => (row.id === p.id ? { ...row, closeDate: e.target.value } : row)))}
                          onBlur={(e) => void updateCloseMeta(p.id, { closeDate: e.target.value, closeBy: p.closeBy })}
                          className={`w-36 border rounded px-2 py-1 text-xs ${p.closeBy === "Yes" && !p.closeDate ? "border-red-600" : "border-black"}`}
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
                          {p.status !== "Completed" && p.status !== "Cancelled" && jobClosureStatusMap.get(p.id)?.canClose ? (
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
