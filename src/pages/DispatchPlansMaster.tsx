import React, { useMemo, useState } from "react";

import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { useData } from "../hooks/useData";
import { DispatchPlan, Truck, Order, Company, OrderSchedule, LoadingSlip } from "../types";
import { formatDate } from "../lib/serial";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";

export function DispatchPlansMaster() {
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');


  const [plans, setPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem } = useOrderItemCatalog();
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ date: string; truckId: string; plannedQty: string }>({
    date: "",
    truckId: "",
    plannedQty: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setPlans(plans.filter(p => p.id !== id));
    setDeletingId(null);
  };

  const loadingSlipPlanIds = useMemo(() => {
    const ids = new Set<string>();
    loadingSlips.forEach((slip) => {
      if (slip.status === "Cancelled") return;
      slip.lines.forEach((line) => {
        const planId = String(line.dispatchPlanId || "").trim();
        if (planId) ids.add(planId);
      });
    });
    return ids;
  }, [loadingSlips]);

  const openEditModal = (plan: DispatchPlan) => {
    setEditingPlanId(plan.id);
    setEditForm({
      date: String(plan.date || "").slice(0, 10),
      truckId: String(plan.truckId || ""),
      plannedQty: String(Number(plan.plannedQty || 0)),
    });
  };

  const closeEditModal = () => {
    if (isSaving) return;
    setEditingPlanId(null);
    setEditForm({ date: "", truckId: "", plannedQty: "" });
  };

  const editingPlan = editingPlanId ? plans.find((plan) => plan.id === editingPlanId) || null : null;
  const editingSchedule = editingPlan ? schedules.find((schedule) => schedule.id === editingPlan.scheduleId) || null : null;
  const editingOrder = editingPlan ? orders.find((order) => order.id === editingPlan.orderId) || null : null;
  const editingCompany = editingOrder ? companies.find((company) => company.id === editingOrder.companyId) || null : null;
  const editingTolerancePercent = Math.max(0, Number(editingCompany?.toleranceAllowed || 0));
  const editingLoaded = Number(editingPlan?.loadedQty || 0);
  const editingCancelled = Number(editingPlan?.canceledQty || 0);
  const otherEffectivePlanned = editingPlan
    ? plans
        .filter((plan) => plan.scheduleId === editingPlan.scheduleId && plan.id !== editingPlan.id)
        .reduce((sum, plan) => sum + Math.max(0, Number(plan.plannedQty || 0) - Number(plan.canceledQty || 0)), 0)
    : 0;
  const baseEditableScheduleQty = editingSchedule
    ? Math.max(0, Number(editingSchedule.qty || 0) - Number(editingSchedule.canceledQty || 0))
    : 0;
  const toleratedEditableScheduleQty = Number((baseEditableScheduleQty * (1 + editingTolerancePercent / 100)).toFixed(2));
  const maxEditablePlannedQty = editingSchedule
    ? Math.max(
        editingLoaded + editingCancelled,
        toleratedEditableScheduleQty - otherEffectivePlanned + editingCancelled
      )
    : Infinity;

  const handleSaveEdit = async () => {
    if (!editingPlan) return;
    if (loadingSlipPlanIds.has(editingPlan.id)) {
      alert("Dispatch plan cannot be edited after loading slip creation.");
      closeEditModal();
      return;
    }

    const plannedQty = Number(editForm.plannedQty || 0);
    if (!editForm.date) {
      alert("Please enter plan date.");
      return;
    }
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      alert("Planned qty must be greater than 0.");
      return;
    }
    if (plannedQty < editingLoaded + editingCancelled) {
      alert("Planned qty cannot be less than loaded qty plus cancelled qty.");
      return;
    }
    if (Number.isFinite(maxEditablePlannedQty) && plannedQty > maxEditablePlannedQty) {
      alert(`Planned qty cannot exceed ${maxEditablePlannedQty.toLocaleString()}.`);
      return;
    }

    const nextPlan: DispatchPlan = {
      ...editingPlan,
      date: editForm.date,
      truckId: editForm.truckId,
      plannedQty,
      updatedBy: window.localStorage.getItem("userName") || editingPlan.updatedBy || "Admin",
      updateTimestamp: new Date().toISOString(),
    };

    try {
      setIsSaving(true);
      await setPlans((prev) => prev.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan)));
      closeEditModal();
    } catch (error) {
      console.error("Failed to update dispatch plan:", error);
      alert("Failed to update dispatch plan.");
    } finally {
      setIsSaving(false);
    }
  };

  const dispatchFilterRows = useMemo(() => {
    return plans.map((plan) => {
      const order = orders.find((o) => o.id === plan.orderId);
      const company = companies.find((c) => c.id === order?.companyId);
      const item = resolveOrderItem(order);
      const companyName = String(company?.name || "").trim();
      const itemName = String(item?.name || "").trim();
      const itemErp = String(order?.erpCode || item?.erp || "").trim();
      const itemKey = itemName || itemErp ? `${itemName}::${itemErp}` : "";
      const pending = Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0);
      return {
        plan,
        companyName,
        itemName,
        itemErp,
        itemKey,
        pending,
        searchText: [
          plan.planNo,
          formatDate(plan.date),
          companyName,
          order?.orderNo,
          order?.erpCode,
          itemName,
          itemErp,
          String(plan.plannedQty || ""),
          String(plan.loadedQty || ""),
          String(plan.canceledQty || ""),
          String(pending),
          plan.status,
        ].join(" ").toLowerCase(),
      };
    });
  }, [plans, orders, companies, resolveOrderItem]);

  const companyOptions = useMemo(() => {
    const names = Array.from(new Set(dispatchFilterRows.map((row) => row.companyName).filter(Boolean)));
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((name) => ({ value: name, label: name }));
  }, [dispatchFilterRows]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; searchText: string }>();
    dispatchFilterRows.forEach((row) => {
      if (!row.itemKey || map.has(row.itemKey)) return;
      const label = !row.itemName ? row.itemErp : !row.itemErp || row.itemName.toLowerCase().includes(row.itemErp.toLowerCase()) ? row.itemName : `${row.itemName} - ${row.itemErp}`;
      map.set(row.itemKey, { value: row.itemKey, label, searchText: `${row.itemName} ${row.itemErp}` });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [dispatchFilterRows]);

  const filteredPlans = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return dispatchFilterRows
      .filter((row) => {
        if (companyFilter && row.companyName !== companyFilter) return false;
        if (itemFilter && row.itemKey !== itemFilter) return false;
        return !normalizedSearch || row.searchText.includes(normalizedSearch);
      })
      .map((row) => row.plan)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [companyFilter, dispatchFilterRows, itemFilter, searchTerm]);
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedPlans,
  } = useClientPagination(filteredPlans, 25);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Dispatch Plans Master</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(260px,1.4fr)_minmax(220px,1fr)_minmax(260px,1.1fr)_auto] md:items-center">
        <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search plan, order, ERP, company, item..." />
        <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
        <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
        {(searchTerm || companyFilter || itemFilter) ? (
          <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
        ) : null}
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="table-frozen-scroll">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Plan No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Plan Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Order / Item</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Planned</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black text-emerald-700">Invoice Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black text-red-700">Cancl</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black text-indigo-700">Pending</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black">Status</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {paginatedPlans.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-black font-medium">No dispatch plans found.</td>
                </tr>
              ) : (
                paginatedPlans.map((p) => {
                  const order = orders.find(o => o.id === p.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = resolveOrderItem(order);
                  const pending = Number(p.plannedQty || 0) - Number(p.loadedQty || 0) - Number(p.canceledQty || 0);
                  const hasLoadingSlip = loadingSlipPlanIds.has(p.id);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-4 py-4 text-xs font-bold text-slate-500 border border-black">{p.planNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black">
                        <div className="font-bold">{order?.orderNo || "-"}</div>
                        <div className="text-[10px] text-slate-500 uppercase">{item?.name || "-"}</div>
                      </td>
                      <td className="px-4 py-4 text-right text-xs font-medium text-black border border-black whitespace-nowrap">
                        {Number(p.plannedQty || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-emerald-700 border border-black whitespace-nowrap">
                        {Number(p.loadedQty || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-xs font-medium text-red-600 border border-black whitespace-nowrap">
                        {Number(p.canceledQty || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">
                        {pending.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-center text-xs border border-black">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                          p.status === 'Dispatched' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                          'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-xs font-medium border border-black whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          disabled={hasLoadingSlip}
                          title={hasLoadingSlip ? "Loading slip already created. Editing is locked." : "Edit dispatch plan"}
                          className={`mr-2 p-1 transition ${hasLoadingSlip ? "text-slate-300 cursor-not-allowed" : "text-indigo-600 hover:text-indigo-900"}`}
                        >
                          <Pencil size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(p.id)} 
                          className={`${deletingId === p.id ? "text-amber-600 animate-pulse scale-110" : "text-red-600"} hover:text-red-900 transition-all p-1`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {editingPlan ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeEditModal}>
          <div className="w-full max-w-2xl rounded-xl border-2 border-black bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b-2 border-black px-5 py-4">
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight text-black">Edit Dispatch Plan</h3>
                <div className="text-xs font-semibold text-slate-500">{editingPlan.planNo || "-"}</div>
              </div>
              <button type="button" onClick={closeEditModal} className="text-slate-500 hover:text-black transition">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-black">Plan Date</label>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded border border-black px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-black">Truck</label>
                <select
                  value={editForm.truckId}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, truckId: e.target.value }))}
                  className="w-full rounded border border-black px-3 py-2 text-sm"
                >
                  <option value="">Select truck</option>
                  {trucks.map((truck) => (
                    <option key={truck.id} value={truck.id}>
                      {truck.truckNo}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-black">Planned Qty</label>
                <input
                  type="number"
                  min={editingLoaded + editingCancelled}
                  step="0.01"
                  value={editForm.plannedQty}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, plannedQty: e.target.value }))}
                  className="w-full rounded border border-black px-3 py-2 text-sm"
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Max allowed: {Number.isFinite(maxEditablePlannedQty) ? maxEditablePlannedQty.toLocaleString() : "-"}
                  {editingTolerancePercent > 0 ? ` (${editingTolerancePercent}% tolerance)` : ""}
                </div>
              </div>
              <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div><span className="font-bold text-black">Loaded:</span> {editingLoaded.toLocaleString()}</div>
                <div><span className="font-bold text-black">Cancelled:</span> {editingCancelled.toLocaleString()}</div>
                <div><span className="font-bold text-black">Schedule Qty:</span> {Number(editingSchedule?.qty || 0).toLocaleString()}</div>
                <div><span className="font-bold text-black">Tolerance:</span> {editingTolerancePercent.toLocaleString()}%</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded border border-black px-4 py-2 text-sm font-bold text-black"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                <Save size={16} />
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
