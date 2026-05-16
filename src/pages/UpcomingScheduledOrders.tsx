import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { OrderSchedule, Order, Company, Item, Truck, DispatchPlan } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { Search, Save } from "lucide-react";

export function UpcomingScheduledOrders() {
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [dispatchPlans, setDispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowTrucks, setRowTrucks] = useState<Record<string, string>>({});
  const [rowPlannedQty, setRowPlannedQty] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  // Filter schedules that are pending and beyond tomorrow
  const basePendingSchedules = useMemo(() => {
    return schedules.filter(s => {
      const scheduledDate = new Date(s.scheduledDate);
      if (isNaN(scheduledDate.getTime())) return false;
      
      // Calculate already planned quantity from dispatch_plans table
      const alreadyPlanned = dispatchPlans
        .filter(plan => plan.scheduleId === s.id)
        .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
      
      const balance = Number(s.qty || 0) - alreadyPlanned;
      // ONLY DIFFERENCE: Filter for dates GREATER than tomorrow
      return scheduledDate > tomorrow && balance > 0;
    }).sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
  }, [schedules, tomorrow, dispatchPlans]);

  // Companies that actually have pending schedules
  const availableCompanies = useMemo(() => {
    const compIds = new Set(basePendingSchedules.map(s => {
      const order = orders.find(o => o.id === s.orderId);
      return order?.companyId;
    }).filter(Boolean));
    
    return companies.filter(c => compIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [basePendingSchedules, orders, companies]);

  // Final filtered list based on company selection
  const filteredSchedules = useMemo(() => {
    if (!selectedCompanyId) return basePendingSchedules;
    return basePendingSchedules.filter(s => {
      const order = orders.find(o => o.id === s.orderId);
      return order?.companyId === selectedCompanyId;
    });
  }, [basePendingSchedules, selectedCompanyId, orders]);

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

  const sortedTrucks = useMemo(() => {
    return [...trucks].sort((a, b) => a.truckNo.localeCompare(b.truckNo));
  }, [trucks]);

  // Calculate total planned quantity for current session
  const totalSessionPlannedQty = useMemo(() => {
    return Array.from(selectedIds).reduce((sum, id) => {
      const schedule = schedules.find(s => s.id === id);
      if (!schedule) return sum;
      
      const alreadyPlanned = dispatchPlans
        .filter(plan => plan.scheduleId === id)
        .reduce((pSum, plan) => pSum + Number(plan.plannedQty || 0), 0);
      const balance = Number(schedule.qty || 0) - alreadyPlanned;
      
      const currentPlanned = rowPlannedQty[id] !== undefined ? rowPlannedQty[id] : balance;
      return sum + Number(currentPlanned || 0);
    }, 0);
  }, [selectedIds, rowPlannedQty, schedules, dispatchPlans]);

  const handleSubmit = () => {
    if (selectedIds.size === 0) {
      alert("Please select at least one order to plan.");
      return;
    }

    const missingTruck = Array.from(selectedIds).some(id => !rowTrucks[id]);
    if (missingTruck) {
      alert("Please select a Truck for all selected orders.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const newPlans: DispatchPlan[] = Array.from(selectedIds).map(id => {
        const schedule = schedules.find(s => s.id === id)!;
        const alreadyPlanned = dispatchPlans
          .filter(plan => plan.scheduleId === id)
          .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
        const balance = Number(schedule.qty || 0) - alreadyPlanned;
        
        return {
          id: crypto.randomUUID(),
          scheduleId: id,
          orderId: schedule.orderId,
          truckId: rowTrucks[id],
          plannedQty: rowPlannedQty[id] !== undefined ? rowPlannedQty[id] : balance,
          status: "Planned",
          date: new Date().toISOString(),
          updateTimestamp: new Date().toISOString(),
          updatedBy: "System User"
        };
      });

      setDispatchPlans([...dispatchPlans, ...newPlans]);
      
      // Cleanup
      setSelectedIds(new Set());
      setRowTrucks({});
      setRowPlannedQty({});
      setIsSubmitting(false);
      alert("Dispatch plans submitted successfully!");
    }, 800);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Upcoming Scheduled Orders</h2>
          <p className="text-xs text-slate-500 mt-1 font-bold">Future orders scheduled beyond tomorrow</p>
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
                setSelectedIds(new Set()); // Reset selection when filter changes
              }}
              className="border-2 border-black rounded p-2 text-sm focus:outline-none focus:border-indigo-600 font-bold min-w-[200px]"
            >
              <option value="">All Companies</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          
          {selectedCompanyId && selectedIds.size > 0 && (
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

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
         <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                {selectedCompanyId && (
                  <th className="px-4 py-3 text-center border border-black w-10">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-black text-indigo-600 focus:ring-indigo-600"
                      onChange={handleSelectAll}
                      checked={filteredSchedules.length > 0 && selectedIds.size === filteredSchedules.length}
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Scheduled Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Order No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Item Name</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Pending Qty</th>
                
                {selectedCompanyId && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black min-w-[150px]">Truck No</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black w-32">Planned Qty</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={selectedCompanyId ? 8 : 5} className="px-6 py-8 text-center text-black font-medium">No upcoming scheduled orders found.</td>
                </tr>
              ) : (
                filteredSchedules.map((s) => {
                  const order = orders.find(o => o.id === s.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = items.find(i => i.id === order?.itemId);
                  
                  // Calculate balance correctly: Scheduled - Already Planned
                  const alreadyPlanned = dispatchPlans
                    .filter(plan => plan.scheduleId === s.id)
                    .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
                  const balance = Number(s.qty || 0) - alreadyPlanned;
                  
                  return (
                    <tr key={s.id} className={cn(
                      "hover:bg-slate-50 divide-x divide-black", 
                      selectedIds.has(s.id) && "bg-indigo-50/50"
                    )}>
                      {selectedCompanyId && (
                        <td className="px-4 py-4 text-center border border-black">
                           <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded border-black text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                          />
                        </td>
                      )}
                      <td className="px-4 py-4 text-xs font-bold border border-black whitespace-nowrap text-black">
                        {formatDate(s.scheduledDate)}
                      </td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{item?.name || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">{balance}</td>
                      
                      {selectedCompanyId && (
                        <>
                          <td className="px-2 py-2 border border-black">
                            <select
                              value={rowTrucks[s.id] || ""}
                              onChange={(e) => setRowTrucks({...rowTrucks, [s.id]: e.target.value})}
                              className="w-full border border-slate-300 rounded p-1 text-[11px] focus:outline-none focus:border-indigo-600 font-bold"
                            >
                              <option value="">Select Truck</option>
                              {sortedTrucks.map(t => (
                                <option key={t.id} value={t.id}>{t.truckNo} ({t.driverName})</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2 border border-black">
                            <input
                              type="number"
                              value={rowPlannedQty[s.id] !== undefined ? rowPlannedQty[s.id] : balance}
                              onChange={(e) => setRowPlannedQty({...rowPlannedQty, [s.id]: Number(e.target.value)})}
                              className="w-full border border-slate-300 rounded p-1 text-right text-[11px] focus:outline-none focus:border-indigo-600 font-bold"
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {selectedIds.size > 0 && (
              <tfoot className="bg-slate-100 border-t-2 border-black">
                <tr className="divide-x divide-black font-black">
                  <td colSpan={selectedCompanyId ? 7 : 5} className="px-4 py-3 text-right text-xs uppercase text-slate-600">Total Planned for Submission:</td>
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
