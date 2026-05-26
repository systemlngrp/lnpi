import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { 
  DispatchPlan, 
  Truck, 
  Item, 
  Order, 
  Company, 
  LoadingSlip,
  LoadingSlipLine,
  Production
} from "../types";
import { 
  Truck as TruckIcon, 
  Package, 
  Search, 
  X, 
  Check, 
  ChevronRight,
  ChevronDown
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";

interface GroupedPlan {
  itemId: string;
  itemName: string;
  plans: (DispatchPlan & { 
    companyName: string; 
    orderNo: string;
    pendingQty: number;
  })[];
}

interface TruckGroup {
  truckId: string;
  truckNo: string;
  items: GroupedPlan[];
}

export function PendingLoading() {
  const [plans, updatePlans, plansLoading] = useData<DispatchPlan>("dispatch_plans", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [items] = useData<Item>("items", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [productions] = useData<Production>("productions", []);
  const [, updateLoadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedTrucks, setExpandedTrucks] = useState<Set<string>>(new Set());
  const [loadingModal, setLoadingModal] = useState<{
    truckId: string;
    itemId: string;
    plans: any[];
  } | null>(null);
  const [loadedQuantities, setLoadedQuantities] = useState<Record<string, number>>({});
  const [selectedJobs, setSelectedJobs] = useState<Record<string, string[]>>({});
  const [cancelingPlanId, setCancelingPlanId] = useState<string | null>(null);
  const [cancelQty, setCancelQty] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleTruck = (id: string) => {
    const next = new Set(expandedTrucks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedTrucks(next);
  };

  const groupedData = useMemo(() => {
    const filtered = plans.filter(p => {
      const pending = Number(p.plannedQty || 0) - Number(p.loadedQty || 0) - Number(p.canceledQty || 0);
      if (pending <= 0) return false;

      const truck = trucks.find(t => t.id === p.truckId);
      const order = orders.find(o => o.id === p.orderId);
      const item = items.find(i => i.id === order?.itemId);
      const company = companies.find(c => c.id === order?.companyId);

      const searchStr = `${truck?.truckNo} ${item?.name} ${company?.name} ${order?.orderNo}`.toLowerCase();
      return searchStr.includes(searchTerm.toLowerCase());
    });

    const truckMap = new Map<string, TruckGroup>();

    filtered.forEach(p => {
      const truck = trucks.find(t => t.id === p.truckId);
      const order = orders.find(o => o.id === p.orderId);
      const item = items.find(i => i.id === order?.itemId);
      const company = companies.find(c => c.id === order?.companyId);

      if (!truck || !item) return;

      if (!truckMap.has(p.truckId)) {
        truckMap.set(p.truckId, {
          truckId: p.truckId,
          truckNo: truck.truckNo,
          items: []
        });
      }

      const truckGroup = truckMap.get(p.truckId)!;
      let itemGroup = truckGroup.items.find(i => i.itemId === item.id);

      if (!itemGroup) {
        itemGroup = {
          itemId: item.id,
          itemName: item.name,
          plans: []
        };
        truckGroup.items.push(itemGroup);
      }

      const pendingQty = Number(p.plannedQty || 0) - Number(p.loadedQty || 0) - Number(p.canceledQty || 0);

      itemGroup.plans.push({
        ...p,
        companyName: company?.name || "Unknown",
        orderNo: order?.orderNo || "N/A",
        pendingQty: pendingQty
      });
    });

    return Array.from(truckMap.values()).sort((a, b) => a.truckNo.localeCompare(b.truckNo));
  }, [plans, trucks, orders, items, companies, searchTerm]);

  const handleOpenLoad = (truckId: string, itemId: string, plans: any[]) => {
    setLoadingModal({ truckId, itemId, plans });
    const initialQtys: Record<string, number> = {};
    plans.forEach(p => {
      initialQtys[p.id] = p.pendingQty;
    });
    setLoadedQuantities(initialQtys);
    setSelectedJobs({});
  };

  const handleCloseLoad = () => {
    setLoadingModal(null);
    setLoadedQuantities({});
    setSelectedJobs({});
  };

  const handleSubmitLoading = async () => {
    if (!loadingModal) return;

    const lines: LoadingSlipLine[] = Object.entries(loadedQuantities)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([id, qty]) => ({
        dispatchPlanId: id,
        loadedQty: Number(qty),
        jobNos: (selectedJobs[id] || []).filter(Boolean)
      }));

    if (lines.length === 0) return;

    setIsSubmitting(true);
    try {
      const newSlip: LoadingSlip = {
        id: crypto.randomUUID(),
        slipNo: "", 
        date: new Date().toISOString().slice(0, 10),
        truckId: loadingModal.truckId,
        lines: lines
      };
      await updateLoadingSlips(prev => [...prev, newSlip]);

      await updatePlans(prev => prev.map(p => {
        const line = lines.find(l => l.dispatchPlanId === p.id);
        if (line) {
          return {
            ...p,
            loadedQty: Number(p.loadedQty || 0) + line.loadedQty
          };
        }
        return p;
      }));

      handleCloseLoad();
    } catch (err) {
      console.error("Failed to submit loading:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelClick = (plan: any) => {
    setCancelingPlanId(plan.id);
    setCancelQty(plan.pendingQty);
  };

  const handleCancelPlan = async (planId: string) => {
    if (cancelQty === "" || Number(cancelQty) <= 0) return;

    setIsSubmitting(true);
    try {
      await updatePlans(prev => prev.map(p => {
        if (p.id === planId) {
          return {
            ...p,
            canceledQty: Number(p.canceledQty || 0) + Number(cancelQty)
          };
        }
        return p;
      }));
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
        <div className="flex justify-center p-12"><Spinner /></div>
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
                onClick={() => toggleTruck(truck.truckId)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors border-b border-black"
              >
                <div className="flex items-center gap-3">
                  <TruckIcon size={20} className="text-indigo-600" />
                  <span className="font-bold text-lg">{truck.truckNo}</span>
                  <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase">
                    {truck.items.length} {truck.items.length === 1 ? 'Item' : 'Items'}
                  </span>
                </div>
                {expandedTrucks.has(truck.truckId) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </button>

              {expandedTrucks.has(truck.truckId) && (
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
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Planned</th>
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Loaded</th>
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Canceled</th>
                              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-indigo-700">Pending</th>
                              <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-black">
                            {item.plans.map((p) => (
                              <tr key={p.id} className="divide-x divide-black hover:bg-slate-50">
                                <td className="px-3 py-2 text-xs truncate max-w-[200px]" title={p.companyName}>
                                  {p.companyName}
                                </td>
                                <td className="px-3 py-2 text-xs font-medium">
                                  {p.orderNo}
                                </td>
                                <td className="px-3 py-2 text-xs text-right">
                                  {Number(p.plannedQty || 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-xs text-right text-emerald-700 font-medium">
                                  {Number(p.loadedQty || 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-xs text-right text-red-600">
                                  {Number(p.canceledQty || 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-xs text-right font-bold text-indigo-700 bg-indigo-50/30">
                                  {p.pendingQty.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {cancelingPlanId === p.id ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <input 
                                        type="number"
                                        value={cancelQty}
                                        onChange={(e) => setCancelQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                        className="w-16 px-1 py-0.5 border border-red-400 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-red-500"
                                        autoFocus
                                      />
                                      <button 
                                        onClick={() => handleCancelPlan(p.id)}
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
                                      onClick={() => handleCancelClick(p)}
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
              )}
            </div>
          ))}
        </div>
      )}

      {/* Loading Modal */}
      {loadingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl border-2 border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <TruckIcon size={20} />
                <h3 className="font-bold uppercase tracking-tight">Loading Form - {trucks.find(t => t.id === loadingModal.truckId)?.truckNo}</h3>
              </div>
              <button onClick={handleCloseLoad} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 border border-black rounded">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Item</div>
                  <div className="font-bold">{items.find(i => i.id === loadingModal.itemId)?.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Date</div>
                  <div className="font-bold">{formatDate(new Date().toISOString())}</div>
                </div>
              </div>

              <div className="overflow-x-auto border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase">Company / Order</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase">Jobs</th>
                      <th className="px-4 py-2 text-right text-xs font-bold uppercase">Planned</th>
                      <th className="px-4 py-2 text-right text-xs font-bold uppercase">Pending</th>
                      <th className="px-4 py-2 text-right text-xs font-bold uppercase">Loaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {loadingModal.plans.map((p) => {
                      const plan = p as DispatchPlan;
                      const jobOptionsForSchedule = productions
                        .filter((prod) => prod.scheduleId === plan.scheduleId)
                        .map((prod) => String(prod.transactionNo || "").trim())
                        .filter(Boolean);

                      const jobOptionsForItem = productions
                        .filter((prod) => prod.itemId === loadingModal.itemId && prod.status !== "Cancelled")
                        .map((prod) => String(prod.transactionNo || "").trim())
                        .filter(Boolean);

                      const options = Array.from(
                        new Set(jobOptionsForSchedule.length ? jobOptionsForSchedule : jobOptionsForItem)
                      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

                      return (
                        <tr key={p.id} className="divide-x divide-black">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{p.companyName}</div>
                          <div className="text-[10px] text-slate-500">{p.orderNo}</div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            multiple
                            value={selectedJobs[p.id] || []}
                            onChange={(e) => {
                              const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                              setSelectedJobs((prev) => ({ ...prev, [p.id]: values }));
                            }}
                            className="w-56 max-w-[14rem] border border-black rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-black bg-white"
                            title="Select jobs (Ctrl/Shift for multi-select)"
                          >
                            {options.length === 0 ? (
                              <option value="" disabled>No jobs found</option>
                            ) : (
                              options.map((jobNo) => (
                                <option key={jobNo} value={jobNo}>
                                  {jobNo}
                                </option>
                              ))
                            )}
                          </select>
                          <div className="text-[10px] text-slate-500 mt-1">
                            Ctrl/Shift multi-select
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm">
                          {Number(p.plannedQty || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-indigo-600">
                          {p.pendingQty.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input 
                            type="number"
                            value={loadedQuantities[p.id] || ""}
                            onChange={(e) => {
                              const val = e.target.value === "" ? 0 : parseFloat(e.target.value);
                              setLoadedQuantities({
                                ...loadedQuantities,
                                [p.id]: Math.min(val, p.pendingQty)
                              });
                            }}
                            max={p.pendingQty}
                            min={0}
                            className="w-24 px-2 py-1 border-2 border-indigo-600 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-600 font-bold"
                          />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={4} className="px-4 py-3 text-right text-sm uppercase">Total Loaded</td>
                      <td className="px-4 py-3 text-right text-sm text-indigo-600 text-lg">
                        {Object.values(loadedQuantities).reduce((sum, q) => sum + q, 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
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
                  disabled={isSubmitting || Object.values(loadedQuantities).reduce((sum, q) => sum + q, 0) <= 0}
                  className="px-6 py-2 bg-indigo-600 text-white border-2 border-black font-bold uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-700 transition disabled:opacity-50 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  {isSubmitting ? <Spinner size={16} className="text-white" /> : "Confirm & Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
