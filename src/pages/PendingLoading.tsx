import React, { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../hooks/useData";
import {
  DispatchPlan,
  Truck,
  Item,
  Order,
  Company,
  LoadingSlip,
  LoadingSlipAllocation,
  LoadingSlipLine,
  Production,
} from "../types";
import {
  Truck as TruckIcon,
  Package,
  Search,
  X,
  Check,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";

interface PendingPlan extends DispatchPlan {
  companyName: string;
  orderNo: string;
  pendingQty: number;
}

interface GroupedPlan {
  itemId: string;
  itemName: string;
  plans: PendingPlan[];
}

interface TruckGroup {
  truckId: string;
  truckNo: string;
  items: GroupedPlan[];
}

interface LoadingModalState {
  truckId: string;
  itemId: string;
  plans: PendingPlan[];
}

interface JobOption {
  jobId: string;
  jobNo: string;
  ffg: number;
}

function getLoadingSlipJobAllocations(line: LoadingSlipLine): Array<{ jobId: string; jobNo: string; qty: number }> {
  if (Array.isArray(line.allocations) && line.allocations.length > 0) {
    return line.allocations
      .filter((allocation): allocation is Extract<LoadingSlipAllocation, { sourceType: "job" }> => allocation.sourceType === "job")
      .map((allocation) => ({
        jobId: allocation.jobId,
        jobNo: allocation.jobNo,
        qty: Number(allocation.qty || 0),
      }));
  }

  return [];
}

export function PendingLoading() {
  const [plans, updatePlans, plansLoading] = useData<DispatchPlan>("dispatch_plans", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [items] = useData<Item>("items", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [productions] = useData<Production>("productions", []);
  const [loadingSlips, updateLoadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedTrucks, setExpandedTrucks] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);
  const [loadingModal, setLoadingModal] = useState<LoadingModalState | null>(null);
  const [loadedQuantities, setLoadedQuantities] = useState<Record<string, number>>({});
  const [jobSplitQtys, setJobSplitQtys] = useState<Record<string, Record<string, number | "">>>({});
  const [openingStockQtys, setOpeningStockQtys] = useState<Record<string, number | "">>({});
  const [cancelingPlanId, setCancelingPlanId] = useState<string | null>(null);
  const [cancelQty, setCancelQty] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const productionMap = useMemo(() => new Map(productions.map((production) => [production.id, production])), [productions]);

  const existingLoadedByJobId = useMemo(() => {
    const map = new Map<string, number>();
    loadingSlips.forEach((slip) => {
      if (slip.status === "Cancelled") return;
      slip.lines.forEach((line) => {
        getLoadingSlipJobAllocations(line).forEach((allocation) => {
          map.set(allocation.jobId, (map.get(allocation.jobId) || 0) + allocation.qty);
        });
      });
    });
    return map;
  }, [loadingSlips]);

  const groupedData = useMemo(() => {
    const filtered = plans.filter((plan) => {
      const pending = Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0);
      if (pending <= 0) return false;

      const truck = trucks.find((row) => row.id === plan.truckId);
      const order = orders.find((row) => row.id === plan.orderId);
      const item = items.find((row) => row.id === order?.itemId);
      const company = companies.find((row) => row.id === order?.companyId);

      const searchBlob = `${truck?.truckNo || ""} ${item?.name || ""} ${company?.name || ""} ${order?.orderNo || ""}`.toLowerCase();
      return searchBlob.includes(searchTerm.toLowerCase());
    });

    const truckMap = new Map<string, TruckGroup>();

    filtered.forEach((plan) => {
      const truck = trucks.find((row) => row.id === plan.truckId);
      const order = orders.find((row) => row.id === plan.orderId);
      const item = items.find((row) => row.id === order?.itemId);
      const company = companies.find((row) => row.id === order?.companyId);
      if (!truck || !item) return;

      if (!truckMap.has(plan.truckId)) {
        truckMap.set(plan.truckId, {
          truckId: plan.truckId,
          truckNo: truck.truckNo,
          items: [],
        });
      }

      const truckGroup = truckMap.get(plan.truckId)!;
      let itemGroup = truckGroup.items.find((row) => row.itemId === item.id);
      if (!itemGroup) {
        itemGroup = { itemId: item.id, itemName: item.name, plans: [] };
        truckGroup.items.push(itemGroup);
      }

      itemGroup.plans.push({
        ...plan,
        companyName: company?.name || "Unknown",
        orderNo: order?.orderNo || "N/A",
        pendingQty: Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0),
      });
    });

    return Array.from(truckMap.values())
      .sort((a, b) => {
        // Sort by earliest planNo across all items and plans in the truck
        const minPlanNoA = a.items.flatMap(i => i.plans).map(p => p.planNo || "").sort()[0] || "";
        const minPlanNoB = b.items.flatMap(i => i.plans).map(p => p.planNo || "").sort()[0] || "";
        return minPlanNoA.localeCompare(minPlanNoB, undefined, { numeric: true, sensitivity: 'base' });
      })
      .map(group => ({
        ...group,
        items: group.items.sort((a, b) => {
          const minPlanNoA = a.plans.map(p => p.planNo || "").sort()[0] || "";
          const minPlanNoB = b.plans.map(p => p.planNo || "").sort()[0] || "";
          return minPlanNoA.localeCompare(minPlanNoB, undefined, { numeric: true, sensitivity: 'base' });
        })
      }));
  }, [companies, items, orders, plans, searchTerm, trucks]);

  useEffect(() => {
    if (didInitExpand.current) return;
    if (groupedData.length === 0) return;
    didInitExpand.current = true;
    setExpandedTrucks(new Set(groupedData.map((group) => group.truckId)));
  }, [groupedData]);

  const currentAdjustmentByJobId = useMemo(() => {
    const map = new Map<string, number>();
    Object.values(jobSplitQtys).forEach((byJobId) => {
      Object.entries(byJobId).forEach(([jobId, qty]) => {
        if (!jobId) return;
        map.set(jobId, (map.get(jobId) || 0) + Number(qty || 0));
      });
    });
    return map;
  }, [jobSplitQtys]);

  const getJobOptionsForPlan = (plan: DispatchPlan, itemId: string): JobOption[] => {
    const jobOptionsForSchedule = productions
      .filter((production) => 
        production.scheduleId === plan.scheduleId && 
        production.status !== "Cancelled" && 
        !production.cancelTimestamp &&
        !production.closeDate &&
        Number(production.prodFromFFG || 0) > 0
      )
      .map((production) => ({
        jobId: production.id,
        jobNo: String(production.transactionNo || "").trim(),
        ffg: Number(production.prodFromFFG || 0),
      }))
      .filter((option) => option.jobNo);

    const jobOptionsForItem = productions
      .filter((production) => 
        production.itemId === itemId && 
        production.status !== "Cancelled" && 
        !production.cancelTimestamp &&
        !production.closeDate &&
        Number(production.prodFromFFG || 0) > 0
      )
      .map((production) => ({
        jobId: production.id,
        jobNo: String(production.transactionNo || "").trim(),
        ffg: Number(production.prodFromFFG || 0),
      }))
      .filter((option) => option.jobNo);

    const deduped = new Map<string, JobOption>();
    [...(jobOptionsForSchedule.length ? jobOptionsForSchedule : jobOptionsForItem)].forEach((option) => {
      deduped.set(option.jobId, option);
    });

    return Array.from(deduped.values()).sort((a, b) =>
      a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" })
    );
  };

  const getPlanOpeningStockQty = (planId: string) => Number(openingStockQtys[planId] || 0);

  const getAlreadyLoadedForJob = (jobId: string) => existingLoadedByJobId.get(jobId) || 0;

  const getRemainingCapacityForJob = (jobId: string, currentRowQty = 0) => {
    const production = productionMap.get(jobId);
    const ffg = Number(production?.prodFromFFG || 0);
    const alreadyLoaded = getAlreadyLoadedForJob(jobId);
    const currentAdjustments = currentAdjustmentByJobId.get(jobId) || 0;
    return Math.max(0, ffg - alreadyLoaded - currentAdjustments + currentRowQty);
  };

  const getModalKey = (truckId: string, itemId: string) => `${truckId}::${itemId}`;

  const getModalValidation = (modal: LoadingModalState) => {
    const modalKey = getModalKey(modal.truckId, modal.itemId);
    const rowLoadedQty = Number(loadedQuantities[modalKey] || 0);
    const byJobId = jobSplitQtys[modalKey] || {};
    const openingStockQty = getPlanOpeningStockQty(modalKey);
    const jobAllocatedTotal = Object.values(byJobId).reduce((sum, qty) => sum + Number(qty || 0), 0);
    const allocatedTotal = jobAllocatedTotal + openingStockQty;
    const errors: string[] = [];

    const totalPending = modal.plans.reduce((sum, plan) => sum + Number(plan.pendingQty || 0), 0);

    if (rowLoadedQty <= 0) errors.push("Loaded qty must be greater than 0.");
    if (rowLoadedQty > totalPending + 0.0001) errors.push("Loaded qty cannot exceed total pending for loading.");

    Object.entries(byJobId).forEach(([jobId, qty]) => {
      const value = Number(qty || 0);
      if (value <= 0) return;
      const remainingCapacity = getRemainingCapacityForJob(jobId, value);
      if (value > remainingCapacity + 0.0001) {
        errors.push("Adjust Now cannot exceed Yet to Load for a job.");
      }
    });

    if (openingStockQty < 0) errors.push("Opening Stock quantity cannot be negative.");
    if (allocatedTotal <= 0) errors.push("At least one positive adjustment is required.");
    if (Math.abs(allocatedTotal - rowLoadedQty) > 0.0001) errors.push("Job/Open Stock total must exactly match Loaded qty.");

    return { isValid: errors.length === 0, errors, allocatedTotal, openingStockQty, totalPending };
  };

  const modalHasErrors = useMemo(() => {
    if (!loadingModal) return false;
    return !getModalValidation(loadingModal).isValid;
  }, [jobSplitQtys, loadedQuantities, loadingModal, openingStockQtys, currentAdjustmentByJobId, existingLoadedByJobId, productionMap]);

  const handleOpenLoad = (truckId: string, itemId: string, itemPlans: PendingPlan[]) => {
    setLoadingModal({ truckId, itemId, plans: itemPlans });
    const modalKey = getModalKey(truckId, itemId);
    const totalPending = itemPlans.reduce((sum, plan) => sum + Number(plan.pendingQty || 0), 0);

    const eligibleJobs = productions
      .filter((p) => 
        p.itemId === itemId && 
        p.status !== "Cancelled" && 
        !p.cancelTimestamp &&
        !p.closeDate &&
        Number(p.prodFromFFG || 0) > 0
      )
      .map((p) => {
        const ffg = Number(p.prodFromFFG || 0);
        const alreadyLoaded = getAlreadyLoadedForJob(p.id);
        return { jobId: p.id, jobNo: String(p.transactionNo || "").trim(), ffg, yetToLoad: Math.max(0, ffg - alreadyLoaded) };
      })
      .filter((j) => j.jobNo && j.yetToLoad > 0)
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" }));

    setLoadedQuantities({ [modalKey]: totalPending });
    setOpeningStockQtys({ [modalKey]: "" });
    setJobSplitQtys({
      [modalKey]: Object.fromEntries(eligibleJobs.map((j) => [j.jobId, ""])),
    });
  };

  const handleCloseLoad = () => {
    setLoadingModal(null);
    setLoadedQuantities({});
    setJobSplitQtys({});
    setOpeningStockQtys({});
  };

  const handleSubmitLoading = async () => {
    if (!loadingModal) return;

    const modalKey = getModalKey(loadingModal.truckId, loadingModal.itemId);
    const rowLoadedQty = Number(loadedQuantities[modalKey] || 0);
    const validation = getModalValidation(loadingModal);

    if (!validation.isValid) {
      alert(validation.errors[0] || "Loading data is invalid.");
      return;
    }

    // Build allocation pool (job splits + opening stock) and then distribute into dispatch plan lines FIFO.
    const byJobId = jobSplitQtys[modalKey] || {};
    const allocationPool: LoadingSlipAllocation[] = [];

    Object.entries(byJobId).forEach(([jobId, qty]) => {
      const value = Number(qty || 0);
      if (!jobId || value <= 0) return;
      const production = productionMap.get(jobId);
      const jobNo = String(production?.transactionNo || "").trim();
      if (!jobNo) return;
      allocationPool.push({ sourceType: "job", jobId, jobNo, qty: value });
    });

    const openingStockQty = getPlanOpeningStockQty(modalKey);
    if (openingStockQty > 0) {
      allocationPool.push({ sourceType: "opening_stock", sourceRef: "Opening Stock", qty: openingStockQty });
    }

    const sortedPlans = [...loadingModal.plans].sort((a, b) =>
      (a.planNo || "").localeCompare(b.planNo || "", undefined, { numeric: true, sensitivity: "base" })
    );

    const consumeFromPool = (need: number) => {
      const allocations: LoadingSlipAllocation[] = [];
      let remaining = need;
      while (remaining > 0.0001 && allocationPool.length > 0) {
        const head = allocationPool[0];
        const take = Math.min(remaining, Number(head.qty || 0));
        if (take <= 0) {
          allocationPool.shift();
          continue;
        }
        allocations.push({ ...(head as any), qty: take });
        remaining -= take;
        const left = Number(head.qty || 0) - take;
        if (left <= 0.0001) allocationPool.shift();
        else allocationPool[0] = { ...(head as any), qty: left };
      }
      return { allocations, remaining };
    };

    const lines: LoadingSlipLine[] = [];
    let remainingToDistribute = rowLoadedQty;
    for (const plan of sortedPlans) {
      if (remainingToDistribute <= 0.0001) break;
      const planPending = Math.max(0, Number(plan.pendingQty || 0));
      const planLoad = Math.min(planPending, remainingToDistribute);
      if (planLoad <= 0.0001) continue;

      const consumed = consumeFromPool(planLoad);
      if (consumed.remaining > 0.0001) {
        alert("Job split allocations are insufficient to cover Loaded qty.");
        return;
      }

      lines.push({ dispatchPlanId: plan.id, loadedQty: planLoad, allocations: consumed.allocations });
      remainingToDistribute -= planLoad;
    }

    if (remainingToDistribute > 0.0001) {
      alert("Unable to distribute Loaded qty across pending dispatch plans.");
      return;
    }

    setIsSubmitting(true);
    try {
      const newSlip: LoadingSlip = {
        id: crypto.randomUUID(),
        slipNo: "",
        date: new Date().toISOString().slice(0, 10),
        truckId: loadingModal.truckId,
        lines,
      };

      await updateLoadingSlips((prev) => [...prev, newSlip]);

      await updatePlans((prev) =>
        prev.map((plan) => {
          const line = lines.find((row) => row.dispatchPlanId === plan.id);
          if (!line) return plan;
          const nextLoaded = Number(plan.loadedQty || 0) + line.loadedQty;
          const remaining = Math.max(0, Number(plan.plannedQty || 0) - nextLoaded - Number(plan.canceledQty || 0));
          return {
            ...plan,
            loadedQty: nextLoaded,
            canceledQty: Number(plan.canceledQty || 0) + remaining, // Auto-cancel remaining
          };
        })
      );

      handleCloseLoad();
    } catch (err) {
      console.error("Failed to submit loading:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelClick = (plan: PendingPlan) => {
    setCancelingPlanId(plan.id);
    setCancelQty(plan.pendingQty);
  };

  const handleCancelPlan = async (planId: string) => {
    if (cancelQty === "" || Number(cancelQty) <= 0) return;

    setIsSubmitting(true);
    try {
      await updatePlans((prev) =>
        prev.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                canceledQty: Number(plan.canceledQty || 0) + Number(cancelQty),
              }
            : plan
        )
      );
      setCancelingPlanId(null);
      setCancelQty("");
    } catch (err) {
      console.error("Failed to cancel plan:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Loading</h2>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search truck, item, company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      {plansLoading ? (
        <div className="flex justify-center p-12">
          <Spinner />
        </div>
      ) : groupedData.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium">No pending loading plans found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedData.map((truck) => (
            <div key={truck.truckId} className="bg-white border border-black rounded shadow-sm overflow-hidden">
              <button
                onClick={() => {
                  const next = new Set(expandedTrucks);
                  if (next.has(truck.truckId)) next.delete(truck.truckId);
                  else next.add(truck.truckId);
                  setExpandedTrucks(next);
                }}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors border-b border-black"
              >
                <div className="flex items-center gap-3">
                  <TruckIcon size={20} className="text-indigo-600" />
                  <span className="font-bold text-lg">{truck.truckNo}</span>
                  <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase">
                    {truck.items.length} {truck.items.length === 1 ? "Item" : "Items"}
                  </span>
                </div>
                {expandedTrucks.has(truck.truckId) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </button>

              {expandedTrucks.has(truck.truckId) ? (
                <div className="p-4 space-y-6">
                  {truck.items.map((item) => (
                    <div key={item.itemId} className="space-y-2">
                      <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                          <Package size={18} className="text-slate-500" />
                          <span className="font-bold text-black uppercase tracking-wider">{item.itemName}</span>
                        </div>
                        <button
                          onClick={() => handleOpenLoad(truck.truckId, item.itemId, item.plans)}
                          className="bg-indigo-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-indigo-700 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px]"
                        >
                          LOAD ITEM
                        </button>
                      </div>

                      <div className="overflow-x-auto border border-black">
                        <table className="min-w-full divide-y divide-black border-collapse">
                          <thead className="bg-slate-100">
                            <tr className="divide-x divide-black">
                              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider">Company</th>
                              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider">Order No</th>
                              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider">Plan No</th>
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Planned</th>
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Loaded</th>
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-indigo-700">Pending</th>
                              <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-black">
                            {item.plans.map((plan) => (
                              <tr key={plan.id} className="divide-x divide-black hover:bg-slate-50">
                                <td className="px-3 py-2 text-xs truncate max-w-[200px]" title={plan.companyName}>
                                  {plan.companyName}
                                </td>
                                <td className="px-3 py-2 text-xs font-medium">{plan.orderNo}</td>
                                <td className="px-3 py-2 text-xs font-bold text-slate-500">{plan.planNo || "-"}</td>
                                <td className="px-3 py-2 text-xs text-right">{Number(plan.plannedQty || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 text-xs text-right text-emerald-700 font-medium">{Number(plan.loadedQty || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 text-xs text-right font-bold text-indigo-700 bg-indigo-50/30">{plan.pendingQty.toLocaleString()}</td>
                                <td className="px-3 py-2 text-center">
                                  {cancelingPlanId === plan.id ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <input
                                        type="number"
                                        value={cancelQty}
                                        onChange={(e) => setCancelQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                        className="w-16 px-1 py-0.5 border border-red-400 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-red-500"
                                        autoFocus
                                      />
                                      <button
                                        onClick={() => handleCancelPlan(plan.id)}
                                        disabled={isSubmitting || cancelQty === "" || Number(cancelQty) <= 0}
                                        className="p-1 bg-red-600 text-white rounded hover:bg-red-700 transition"
                                      >
                                        <Check size={12} />
                                      </button>
                                      <button
                                        onClick={() => setCancelingPlanId(null)}
                                        className="p-1 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition"
                                      >
                                        <X size={12} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => handleCancelClick(plan)}
                                      className="text-red-600 hover:text-red-800 text-[10px] font-bold uppercase border border-red-200 px-2 py-0.5 rounded bg-red-50 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {loadingModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl max-h-[92vh] border-2 border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <TruckIcon size={20} />
                <h3 className="font-bold uppercase tracking-tight">Loading Form - {trucks.find((truck) => truck.id === loadingModal.truckId)?.truckNo}</h3>
              </div>
              <button onClick={handleCloseLoad} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 border border-black rounded">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Item</div>
                  <div className="font-bold">{items.find((item) => item.id === loadingModal.itemId)?.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Date</div>
                  <div className="font-bold">{formatDate(new Date().toISOString())}</div>
                </div>
              </div>

                            <div className="space-y-5">
                {(() => {
                  const modalKey = getModalKey(loadingModal.truckId, loadingModal.itemId);
                  const item = items.find((row) => row.id === loadingModal.itemId);
                  const totalPlanned = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
                  const totalLoaded = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.loadedQty || 0), 0);
                  const totalCancelled = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.canceledQty || 0), 0);
                  const totalPending = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.pendingQty || 0), 0);
                  const rowLoadedQty = Number(loadedQuantities[modalKey] || 0);
                  const validation = getModalValidation(loadingModal);

                  const jobs = productions
                    .filter((p) => 
                      p.itemId === loadingModal.itemId && 
                      p.status !== "Cancelled" && 
                      !p.cancelTimestamp &&
                      !p.closeDate &&
                      Number(p.prodFromFFG || 0) > 0
                    )
                    .map((p) => {
                      const ffg = Number(p.prodFromFFG || 0);
                      const alreadyLoaded = getAlreadyLoadedForJob(p.id);
                      const yetToLoad = Math.max(0, ffg - alreadyLoaded);
                      return { jobId: p.id, jobNo: String(p.transactionNo || "").trim(), ffg, alreadyLoaded, yetToLoad };
                    })
                    .filter((j) => j.jobNo && j.yetToLoad > 0)
                    .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" }));

                  return (
                    <div className="border border-black rounded overflow-hidden">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-0 bg-slate-100 border-b border-black">
                        <div className="px-4 py-3 border-r border-black col-span-2">
                          <div className="text-sm font-medium">{item?.name || "Unknown Item"}</div>
                          <div className="text-[10px] text-slate-500">Combined Loading for {loadingModal.plans.length} dispatch plans</div>
                        </div>
                        <div className="px-4 py-3 border-r border-black text-right">
                          <div className="text-[10px] uppercase text-slate-500 font-bold">Planned</div>
                          <div className="font-bold">{totalPlanned.toLocaleString()}</div>
                        </div>
                        <div className="px-4 py-3 border-r border-black text-right">
                          <div className="text-[10px] uppercase text-slate-500 font-bold">Pending</div>
                          <div className="font-bold text-indigo-700">{totalPending.toLocaleString()}</div>
                        </div>
                        <div className="px-4 py-3 text-right">
                          <div className="text-[10px] uppercase text-slate-500 font-bold">Loaded</div>
                          <input
                            type="number"
                            value={rowLoadedQty || ""}
                            onChange={(e) => {
                              const nextValue = e.target.value === "" ? 0 : parseFloat(e.target.value);
                              setLoadedQuantities((prev) => ({
                                ...prev,
                                [modalKey]: Math.min(Math.max(nextValue, 0), totalPending),
                              }));
                            }}
                            max={totalPending}
                            min={0}
                            className="mt-1 w-28 rounded border-2 border-indigo-600 px-2 py-1 text-right font-bold focus:outline-none focus:ring-1 focus:ring-indigo-600"
                          />
                          <div className="mt-1 text-[10px] font-bold text-slate-500">
                            Loaded so far: {totalLoaded.toLocaleString()} | Cancelled: {totalCancelled.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-black border-collapse">
                          <thead className="bg-white">
                            <tr className="divide-x divide-black">
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase">Job No</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase">FFG</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase">Already Loaded</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase">Yet to Load</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase">Adjust Now</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black bg-white">
                            {jobs.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500">
                                  No jobs available (Yet to Load is 0 for all jobs of this item).
                                </td>
                              </tr>
                            ) : (
                              jobs.map((job) => {
                                const currentValue = jobSplitQtys[modalKey]?.[job.jobId] ?? "";
                                return (
                                  <tr key={job.jobId} className="divide-x divide-black">
                                    <td className="px-4 py-3 text-xs font-bold text-black whitespace-nowrap">{job.jobNo}</td>
                                    <td className="px-4 py-3 text-right text-xs text-slate-600">{job.ffg.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-xs text-slate-600">{job.alreadyLoaded.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-xs font-bold text-emerald-700">{job.yetToLoad.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right">
                                      <input
                                        type="number"
                                        value={currentValue}
                                        min={0}
                                        max={job.yetToLoad}
                                        onChange={(e) => {
                                          const next = e.target.value === "" ? "" : Math.min(parseFloat(e.target.value), job.yetToLoad);
                                          setJobSplitQtys((prev) => ({
                                            ...prev,
                                            [modalKey]: { ...(prev[modalKey] || {}), [job.jobId]: next },
                                          }));
                                        }}
                                        className="w-24 rounded border-2 border-indigo-600 px-2 py-1 text-right font-bold focus:outline-none focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                            <tr className="divide-x divide-black bg-emerald-50/40">
                              <td className="px-4 py-3 text-xs font-bold uppercase text-emerald-800">Opening Stock</td>
                              <td className="px-4 py-3 text-right text-xs text-slate-500">-</td>
                              <td className="px-4 py-3 text-right text-xs text-slate-500">-</td>
                              <td className="px-4 py-3 text-right text-xs text-slate-500">-</td>
                              <td className="px-4 py-3 text-right">
                                <input
                                  type="number"
                                  value={openingStockQtys[modalKey] ?? ""}
                                  min={0}
                                  onChange={(e) =>
                                    setOpeningStockQtys((prev) => ({
                                      ...prev,
                                      [modalKey]: e.target.value === "" ? "" : parseFloat(e.target.value),
                                    }))
                                  }
                                  className="w-24 rounded border-2 border-emerald-600 px-2 py-1 text-right font-bold focus:outline-none focus:ring-1 focus:ring-emerald-600"
                                />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-t border-black bg-slate-50 px-4 py-3">
                        <div className="text-xs font-bold text-slate-700">
                          Allocated / Balance:{" "}
                          <span className={Math.abs(validation.allocatedTotal - rowLoadedQty) < 0.0001 ? "text-emerald-700" : "text-red-600"}>
                            {validation.allocatedTotal.toLocaleString()} / {(rowLoadedQty - validation.allocatedTotal).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-right">
                          {validation.errors.length > 0 ? (
                            <div className="text-xs font-bold text-red-600">{validation.errors[0]}</div>
                          ) : (
                            <div className="text-xs font-bold text-emerald-700">Row balanced and ready.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={handleCloseLoad}
                  className="px-6 py-2 border-2 border-black font-bold uppercase text-sm hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitLoading}
                  disabled={isSubmitting || modalHasErrors}
                  className="px-6 py-2 bg-indigo-600 text-white border-2 border-black font-bold uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-700 transition disabled:opacity-50 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  {isSubmitting ? <Spinner size={16} className="text-white" /> : "Confirm & Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
