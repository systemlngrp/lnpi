import React, { useState, useMemo, useEffect } from "react";

import { TableControls } from "../components/TableControls";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { OrderSchedule, Order, Company, Item, DispatchPlan, LoadingSlip, Production } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { ArrowUpDown, Save } from "lucide-react";

type SortKey = "scheduledDate" | "orderNo" | "companyName" | "itemName" | "pendingQty";

export function PendingDispatchPlanning() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const [dispatchPlans, setDispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [productions] = useData<Production>("productions", []);

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowPlannedQty, setRowPlannedQty] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("scheduledDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  const isFfgFilled = (value: unknown) => {
    if (value === null || value === undefined) return false;
    const asString = String(value).trim();
    if (!asString) return false;
    const asNumber = Number(asString);
    return Number.isFinite(asNumber) ? asNumber > 0 : true;
  };

  const itemIdByScheduleId = useMemo(() => {
    const scheduleToOrderId = new Map(schedules.map((s) => [s.id, s.orderId]));
    const orderToItemId = new Map(orders.map((o) => [o.id, o.itemId]));
    const map = new Map<string, string>();
    schedules.forEach((s) => {
      const itemId = orderToItemId.get(scheduleToOrderId.get(s.id) || "") || "";
      map.set(s.id, itemId);
    });
    return map;
  }, [orders, schedules]);

  const loadedQtyByDispatchPlanId = useMemo(() => {
    const map = new Map<string, number>();
    loadingSlips.forEach((slip) => {
      if (slip.status === "Cancelled") return;
      slip.lines.forEach((line) => {
        const planId = String(line.dispatchPlanId || "").trim();
        if (!planId) return;
        map.set(planId, (map.get(planId) || 0) + Number(line.loadedQty || 0));
      });
    });
    return map;
  }, [loadingSlips]);

  const loadedQtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    const planById = new Map(dispatchPlans.map((p) => [p.id, p]));
    loadingSlips.forEach((slip) => {
      if (slip.status === "Cancelled") return;
      slip.lines.forEach((line) => {
        const plan = planById.get(String(line.dispatchPlanId || ""));
        if (!plan) return;
        const itemId = itemIdByScheduleId.get(plan.scheduleId) || "";
        if (!itemId) return;
        map.set(itemId, (map.get(itemId) || 0) + Number(line.loadedQty || 0));
      });
    });
    return map;
  }, [dispatchPlans, itemIdByScheduleId, loadingSlips]);

  const pendingProductionPlanQtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach((p) => {
      if (!p.itemId) return;
      if (p.status === "Cancelled" || p.cancelTimestamp) return;
      if (isFfgFilled(p.prodFromFFG)) return;
      map.set(p.itemId, (map.get(p.itemId) || 0) + Number(p.qty || 0));
    });
    return map;
  }, [productions]);

  const reservedDispatchPlanQtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    dispatchPlans.forEach((plan) => {
      if (!plan.scheduleId) return;
      const itemId = itemIdByScheduleId.get(plan.scheduleId) || "";
      if (!itemId) return;

      const effectivePlanned = Math.max(0, Number(plan.plannedQty || 0) - Number(plan.canceledQty || 0));
      const loaded = Math.max(0, Number(loadedQtyByDispatchPlanId.get(plan.id) || 0));
      const remaining = Math.max(0, effectivePlanned - loaded);
      if (remaining <= 0) return;

      map.set(itemId, (map.get(itemId) || 0) + remaining);
    });
    return map;
  }, [dispatchPlans, itemIdByScheduleId, loadedQtyByDispatchPlanId]);

  const effectivePlannedByScheduleId = useMemo(() => {
    const map = new Map<string, number>();
    dispatchPlans.forEach((plan) => {
      const scheduleId = String(plan.scheduleId || "").trim();
      if (!scheduleId) return;
      const effective = Math.max(0, Number(plan.plannedQty || 0) - Number(plan.canceledQty || 0));
      if (effective <= 0) return;
      map.set(scheduleId, (map.get(scheduleId) || 0) + effective);
    });
    return map;
  }, [dispatchPlans]);

  const getEffectivePlannedForSchedule = (scheduleId: string) =>
    Number(effectivePlannedByScheduleId.get(scheduleId) || 0);

  const availableToPlanByItemId = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const opening = Number((item as any).opening || 0);
      const receipt = Number((item as any).receipt || 0);
      const production = Number((item as any).production || 0);
      const baseStock = opening + receipt + production;

      const loaded = Number(loadedQtyByItemId.get(item.id) || 0);
      const dispatchBalance = baseStock - loaded;
      const pendingProduction = Number(pendingProductionPlanQtyByItemId.get(item.id) || 0);
      const reserved = Number(reservedDispatchPlanQtyByItemId.get(item.id) || 0);

      map.set(item.id, Math.max(0, dispatchBalance + pendingProduction - reserved));
    });
    return map;
  }, [items, loadedQtyByItemId, pendingProductionPlanQtyByItemId, reservedDispatchPlanQtyByItemId]);

  const basePendingSchedules = useMemo(() => {
    return schedules.filter(s => {
      const scheduledDate = new Date(s.scheduledDate);
      if (isNaN(scheduledDate.getTime())) return false;
      
      const effectivePlanned = getEffectivePlannedForSchedule(s.id);
      const balance = Number(s.qty || 0) - effectivePlanned;
      return scheduledDate <= tomorrow && balance > 0;
    }).sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
  }, [schedules, tomorrow, getEffectivePlannedForSchedule]);

  const availableCompanies = useMemo(() => {
    const compIds = new Set(basePendingSchedules.map(s => {
      const order = orders.find(o => o.id === s.orderId);
      return order?.companyId;
    }).filter(Boolean));
    
    return companies.filter(c => compIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [basePendingSchedules, orders, companies]);

  const filteredSchedules = useMemo(() => {
    const rows = !selectedCompanyId ? basePendingSchedules : basePendingSchedules.filter(s => {
      const order = orders.find(o => o.id === s.orderId);
      return order?.companyId === selectedCompanyId;
    });

    return [...rows].sort((a, b) => {
      const orderA = orders.find(o => o.id === a.orderId);
      const orderB = orders.find(o => o.id === b.orderId);
      const companyA = companies.find(c => c.id === orderA?.companyId)?.name || "";
      const companyB = companies.find(c => c.id === orderB?.companyId)?.name || "";
      const itemA = npdItems.find(i => i.id === orderA?.itemId)?.name || "";
      const itemB = npdItems.find(i => i.id === orderB?.itemId)?.name || "";
      const plannedA = getEffectivePlannedForSchedule(a.id);
      const plannedB = getEffectivePlannedForSchedule(b.id);
      const pendingA = Math.max(0, Number(a.qty || 0) - plannedA);
      const pendingB = Math.max(0, Number(b.qty || 0) - plannedB);

      let compare = 0;
      switch (sortKey) {
        case "scheduledDate":
          compare = new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
          break;
        case "orderNo":
          compare = (orderA?.orderNo || "").localeCompare(orderB?.orderNo || "", undefined, { numeric: true, sensitivity: "base" });
          break;
        case "companyName":
          compare = companyA.localeCompare(companyB, undefined, { sensitivity: "base" });
          break;
        case "itemName":
          compare = itemA.localeCompare(itemB, undefined, { sensitivity: "base" });
          break;
        case "pendingQty":
          compare = pendingA - pendingB;
          break;
      }

      return sortDirection === "asc" ? compare : -compare;
    });
  }, [basePendingSchedules, selectedCompanyId, orders, companies, items, sortDirection, sortKey, getEffectivePlannedForSchedule]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const renderSortHeader = (label: string, key: SortKey, align: "left" | "right" = "left") => (
    <button
      type="button"
      onClick={() => handleSort(key)}
      className={cn(
        "inline-flex items-center gap-1 font-bold uppercase",
        align === "right" ? "ml-auto justify-end" : "justify-start"
      )}
    >
      <span>{label}</span>
      <ArrowUpDown size={12} className={cn(sortKey === key ? "text-indigo-700" : "text-slate-400")} />
    </button>
  );

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(filteredSchedules.map(s => s.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const totalSessionPlannedQty = useMemo(() => {
    return Array.from(selectedIds).reduce((sum, id) => {
      const schedule = schedules.find(s => s.id === id);
      if (!schedule) return sum;
      
      const effectivePlanned = getEffectivePlannedForSchedule(id);
      const balance = Number(schedule.qty || 0) - effectivePlanned;
      
      const currentPlanned = rowPlannedQty[id] !== undefined ? rowPlannedQty[id] : balance;
      return sum + Number(currentPlanned || 0);
    }, 0);
  }, [selectedIds, rowPlannedQty, schedules, getEffectivePlannedForSchedule]);

  const plannedNowByItemId = useMemo(() => {
    const map = new Map<string, number>();
    selectedIds.forEach((scheduleId) => {
      const itemId = itemIdByScheduleId.get(scheduleId) || "";
      if (!itemId) return;

      const schedule = schedules.find((row) => row.id === scheduleId);
      const effectivePlanned = getEffectivePlannedForSchedule(scheduleId);
      const schedulePendingQty = schedule ? Math.max(0, Number(schedule.qty || 0) - effectivePlanned) : 0;

      const plannedQty = rowPlannedQty[scheduleId] !== undefined ? rowPlannedQty[scheduleId] : schedulePendingQty;
      map.set(itemId, (map.get(itemId) || 0) + Number(plannedQty || 0));
    });
    return map;
  }, [itemIdByScheduleId, rowPlannedQty, schedules, selectedIds, getEffectivePlannedForSchedule]);

  const calculationRows = useMemo(() => {
    const itemIds = Array.from(plannedNowByItemId.keys());
    return itemIds
      .map((itemId) => {
        const item = npdItems.find((row) => row.id === itemId);
        const opening = Number((item as any)?.opening || 0);
        const receipt = Number((item as any)?.receipt || 0);
        const production = Number((item as any)?.production || 0);
        const baseStock = opening + receipt + production;
        const loaded = Number(loadedQtyByItemId.get(itemId) || 0);
        const dispatchBalance = baseStock - loaded;
        const pendingProduction = Number(pendingProductionPlanQtyByItemId.get(itemId) || 0);
        const reserved = Number(reservedDispatchPlanQtyByItemId.get(itemId) || 0);
        const available = Number(availableToPlanByItemId.get(itemId) || 0);
        const plannedNow = Number(plannedNowByItemId.get(itemId) || 0);
        return {
          itemId,
          itemName: item?.name || "Unknown Item",
          opening,
          receipt,
          production,
          baseStock,
          loaded,
          dispatchBalance,
          pendingProduction,
          reserved,
          available,
          plannedNow,
          exceededBy: Math.max(0, plannedNow - available),
        };
      })
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [
    availableToPlanByItemId,
    items,
    loadedQtyByItemId,
    pendingProductionPlanQtyByItemId,
    plannedNowByItemId,
    reservedDispatchPlanQtyByItemId,
  ]);

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      alert("Please select at least one order to plan.");
      return;
    }

    const violations: string[] = [];
    plannedNowByItemId.forEach((plannedNow, itemId) => {
      const available = Number(availableToPlanByItemId.get(itemId) || 0);
      if (plannedNow > available + 1e-9) {
        const itemName = npdItems.find((i) => i.id === itemId)?.name || "Unknown Item";
        violations.push(`${itemName}: Trying to plan ${plannedNow.toLocaleString()} but only ${available.toLocaleString()} is available.`);
      }
    });

    if (violations.length > 0) {
      alert(`Dispatch planning limit exceeded:\n\n${violations.join("\n")}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      let nextPlanNo = Math.max(0, ...dispatchPlans.map(p => {
        const match = p.planNo?.match(/DP-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })) + 1;

      const newPlans: DispatchPlan[] = Array.from(selectedIds).map(id => {
        const schedule = schedules.find(s => s.id === id)!;
        const effectivePlanned = getEffectivePlannedForSchedule(id);
        const balance = Number(schedule.qty || 0) - effectivePlanned;
        
        return {
          id: crypto.randomUUID(),
          planNo: `DP-${String(nextPlanNo++).padStart(5, '0')}`,
          scheduleId: id,
          orderId: schedule.orderId,
          truckId: "",
          plannedQty: rowPlannedQty[id] !== undefined ? rowPlannedQty[id] : Math.max(0, balance),
          status: "Planned",
          date: timestamp,
          updateTimestamp: timestamp,
          updatedBy: "System User"
        };
      });

      await setDispatchPlans([...dispatchPlans, ...newPlans]);
      
      setSelectedIds(new Set());
      setRowPlannedQty({});
      alert("Dispatch plans submitted successfully!");
    } catch (err) {
      console.error("Failed to submit dispatch plans:", err);
      alert("Failed to submit dispatch plans. Please check the console for details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Dispatch Planning</h2>
          <p className="text-xs text-slate-500 mt-1 font-bold">Plan dispatches for today and tomorrow</p>
        </div>
        
        <div className="flex items-center gap-6">
          {selectedIds.size > 0 && (
            <div className="bg-amber-50 border-2 border-amber-500 px-4 py-1.5 rounded-lg flex items-center gap-3 shadow-[2px_2px_0px_0px_rgba(245,158,11,1)]">
              <span className="text-[10px] font-black uppercase text-amber-700">Total Planned:</span>
              <span className="text-lg font-black text-amber-900">{totalSessionPlannedQty.toLocaleString()}</span>
            </div>
          )}

          <div className="flex flex-col">
            <label className="text-[10px] font-bold uppercase text-slate-500 mb-1">Filter by Company</label>
            <select 
              value={selectedCompanyId}
              onChange={(e) => {
                setSelectedCompanyId(e.target.value);
                setSelectedIds(new Set());
              }}
              className="border-2 border-black rounded p-2 text-sm focus:outline-none focus:border-indigo-600 font-bold min-w-[200px]"
            >
              <option value="">All Companies</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          
          {selectedIds.size > 0 && (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition flex items-center mt-4 self-end h-[42px] border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px]"
            >
              <Save size={18} className="mr-2" />
              {isSubmitting ? "Saving..." : `Submit Plan (${selectedIds.size})`}
            </button>
          )}
        </div>
      </div>

      {calculationRows.length > 0 ? (
        <>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

          <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
          <div className="px-4 py-3 border-b border-black bg-slate-50">
            <div className="text-sm font-black uppercase text-black">Dispatch Planning Calculation</div>
            <div className="text-[11px] font-bold text-slate-600">
              Available = (Opening + Receipt + Production − Loaded) + Pending Production (FG not filled) − Pending Loading (not loaded)
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black border-collapse border border-black">
              <thead className="bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                  <th className="px-3 py-2 text-left text-[11px] font-black uppercase border border-black">Item</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Opening</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Receipt</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Production</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Invoice Qty</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">FG Balance</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Pending Production</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Pending Loading</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Available</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Planned Now</th>
                  <th className="px-3 py-2 text-right text-[11px] font-black uppercase border border-black">Exceeded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {calculationRows.map((row) => (
                  <tr key={row.itemId} className={cn("divide-x divide-black", row.exceededBy > 0 && "bg-rose-50")}>
                    <td className="px-3 py-2 text-[11px] font-bold text-black border border-black min-w-[260px]">{row.itemName}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.opening.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.receipt.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.production.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.loaded.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.dispatchBalance.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.pendingProduction.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] text-black border border-black">{row.reserved.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] font-black text-black border border-black">{row.available.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-[11px] font-black text-black border border-black">{row.plannedNow.toLocaleString()}</td>
                    <td className={cn("px-3 py-2 text-right text-[11px] font-black border border-black", row.exceededBy > 0 ? "text-rose-700" : "text-slate-500")}>
                      {row.exceededBy > 0 ? row.exceededBy.toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </>
      ) : null}

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
         <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-center border border-black w-10">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-black text-indigo-600 focus:ring-indigo-600"
                    onChange={handleSelectAll}
                    checked={filteredSchedules.length > 0 && selectedIds.size === filteredSchedules.length}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Scheduled Date", "scheduledDate")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Order No", "orderNo")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Company", "companyName")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Item Name", "itemName")}</th>
                <th className="px-4 py-3 text-right text-xs text-black uppercase border border-black">{renderSortHeader("Pending Qty", "pendingQty", "right")}</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black w-32">Planned Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-black font-medium">No pending dispatch plans found.</td>
                </tr>
              ) : (
                filteredSchedules.map((s) => {
                  const order = orders.find(o => o.id === s.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = npdItems.find(i => i.id === order?.itemId);
                  
                  const schedDate = new Date(s.scheduledDate);
                  const isOverdue = schedDate < today;
                  
                  const alreadyPlanned = dispatchPlans
                    .filter(plan => plan.scheduleId === s.id)
                    .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
                  const effectivePlanned = getEffectivePlannedForSchedule(s.id);
                  const balance = Number(s.qty || 0) - effectivePlanned;
                  
                  return (
                    <tr key={s.id} className={cn(
                      "hover:bg-slate-50 divide-x divide-black", 
                      isOverdue && "bg-red-50",
                      selectedIds.has(s.id) && "bg-indigo-50/50"
                    )}>
                      <td className="px-4 py-4 text-center border border-black">
                         <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-black text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                        />
                      </td>
                      <td className={cn("px-4 py-4 text-xs font-bold border border-black whitespace-nowrap", isOverdue ? "text-red-600" : "text-black")}>
                        {formatDate(s.scheduledDate)}
                        {isOverdue && <div className="text-[8px] uppercase px-1 border border-red-600 rounded inline-block ml-1">Overdue</div>}
                      </td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{item?.name || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">{balance}</td>
                      
                      <td className="px-2 py-2 border border-black">
                        <input
                          type="number"
                          value={rowPlannedQty[s.id] !== undefined ? rowPlannedQty[s.id] : balance}
                          onChange={(e) => setRowPlannedQty({...rowPlannedQty, [s.id]: Number(e.target.value)})}
                          className="w-full border border-slate-300 rounded p-1 text-right text-[11px] focus:outline-none focus:border-indigo-600 font-bold"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {selectedIds.size > 0 && (
              <tfoot className="bg-slate-100 border-t-2 border-black">
                <tr className="divide-x divide-black font-black">
                  <td colSpan={6} className="px-4 py-3 text-right text-xs uppercase text-slate-600">Total Planned for Submission:</td>
                  <td className="px-4 py-3 text-right text-sm text-indigo-700 bg-indigo-50 border border-black">
                    {totalSessionPlannedQty.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
