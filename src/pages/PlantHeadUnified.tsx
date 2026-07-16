import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier, Order, Consumption, Company } from "../types";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, Truck, XCircle, ClipboardList, Package } from "lucide-react";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { useNpdItems } from "../hooks/useNpdItems";

type Tab = "all" | "material-in" | "orders" | "consumption";

export function PlantHeadUnified() {
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

  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [orders, setOrders] = useData<Order>("orders", []);
  const [consumptions, setConsumptions] = useData<Consumption>("consumptions", []);
  const [materials] = useData<Material>("materials", []);
  const { resolveOrderItem } = useOrderItemCatalog();
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);

  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";
  const pendingMaterialIn = materialIn.filter((m) => isPendingPH(m.status));
  const pendingOrders = orders.filter((o) => isPendingPH(o.status));
  const pendingConsumptions = consumptions.filter((c) => isPendingPH(c.status));

  const counts = {
    "material-in": pendingMaterialIn.length,
    "orders": pendingOrders.length,
    "consumption": pendingConsumptions.length,
  };

  const totalApprovals = counts["material-in"] + counts["orders"] + counts["consumption"];
  const showSelection = activeTab !== "all";
  const showMaterialInSection = (activeTab === "material-in" || activeTab === "all") && counts["material-in"] > 0;
  const showOrdersSection = (activeTab === "orders" || activeTab === "all") && counts["orders"] > 0;
  const showConsumptionSection = (activeTab === "consumption" || activeTab === "all") && counts["consumption"] > 0;
  const showEmptyState = !showMaterialInSection && !showOrdersSection && !showConsumptionSection;

  const toggleSelectAll = (ids: string[]) => {
    if (selectedIds.size === ids.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
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

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkApproving(true);
    const timestamp = new Date().toISOString();
    const email = "ph@lngrp.in";

    try {
      if (activeTab === "material-in") {
        await setMaterialIn(prev => prev.map(m => 
          selectedIds.has(m.id) ? { ...m, status: "Pending Accounts", phTimestamp: timestamp, phEmailId: email } : m
        ));
      } else if (activeTab === "orders") {
        await setOrders(prev => prev.map(o =>
          selectedIds.has(o.id) ? { ...o, status: "Pending Scheduling", updatedBy: "System User", updateTimestamp: timestamp } : o
        ));
      } else if (activeTab === "consumption") {
        await setConsumptions(prev => prev.map(c =>
          selectedIds.has(c.id) ? { ...c, status: "Pending Tally", phTimestamp: timestamp, phEmailId: email, updateTimestamp: timestamp } : c
        ));
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Bulk approval error:", err);
    } finally {
      setIsBulkApproving(false);
    }
  };

  const handleApproveMatIn = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setSubmittingId(id);
    try {
      await setMaterialIn(prev => prev.map(m => 
        m.id === id ? { ...m, status: "Pending Accounts", phTimestamp: new Date().toISOString(), phEmailId: "ph@lngrp.in" } : m
      ));
    } catch (err) {
      console.error("Approval error:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const handleApproveOrder = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setSubmittingId(id);
    try {
      await setOrders(prev =>
        prev.map((o) =>
          o.id === id
            ? { ...o, status: "Pending Scheduling", updatedBy: "System User", updateTimestamp: new Date().toISOString() }
            : o
        )
      );
    } catch (err) {
      console.error("Approval error:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const handleCancelOrder = async (id: string) => {
    const cancelRemarks = window.prompt("Enter cancel remarks");
    if (cancelRemarks === null) return;
    if (!cancelRemarks.trim()) {
      alert("Cancel remarks are required.");
      return;
    }

    setSubmittingId(id);
    try {
      const timestamp = new Date().toISOString();
      await setOrders(prev =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                status: "Cancelled",
                remarks: [o.remarks?.trim(), `Cancel Remarks: ${cancelRemarks.trim()}`].filter(Boolean).join(" | "),
                updatedBy: "System User",
                updateTimestamp: timestamp,
              }
            : o
        )
      );
    } catch (err) {
      console.error("Order cancellation error:", err);
    } finally {
      setSubmittingId(null);
    }
  };

  const handleApproveConsumption = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setSubmittingId(id);
    try {
      const timestamp = new Date().toISOString();
      await setConsumptions(prev =>
        prev.map((c) =>
          c.id === id
            ? { ...c, status: "Pending Tally", phTimestamp: timestamp, phEmailId: "ph@lngrp.in", updateTimestamp: timestamp }
            : c
        )
      );
    } catch (err) {
      console.error("Approval error:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className={cn("flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4 transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Plant Head Unified Approvals</h2>
        <div className="flex bg-slate-100 p-1 rounded border border-black">
          <TabButton
            active={activeTab === "all"}
            onClick={() => { setActiveTab("all"); setSelectedIds(new Set()); }}
            label="All"
            count={totalApprovals}
            icon={<CheckCircle size={14} />}
          />
          <TabButton 
            active={activeTab === "material-in"} 
            onClick={() => { setActiveTab("material-in"); setSelectedIds(new Set()); }}
            label="Material In"
            count={counts["material-in"]}
            icon={<Truck size={14} />}
          />
          <TabButton
            active={activeTab === "orders"}
            onClick={() => { setActiveTab("orders"); setSelectedIds(new Set()); }}
            label="Orders"
            count={counts["orders"]}
            icon={<ClipboardList size={14} />}
          />
          <TabButton
            active={activeTab === "consumption"}
            onClick={() => { setActiveTab("consumption"); setSelectedIds(new Set()); }}
            label="Consumption"
            count={counts["consumption"]}
            icon={<Package size={14} />}
          />
        </div>
      </div>

      <div className={cn("bg-white rounded border border-black shadow-sm transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        {showSelection && selectedIds.size > 0 && (
          <div className="p-3 bg-emerald-50 border-b border-black flex justify-between items-center animate-in fade-in slide-in-from-top-1">
            <span className="text-sm font-bold text-emerald-900 uppercase tracking-tight">
              {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'} selected
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={isBulkApproving}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase tracking-widest border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all disabled:opacity-50"
            >
              {isBulkApproving ? <Spinner size={14} /> : <CheckCircle size={14} />}
              Approve Selected
            </button>
          </div>
        )}

        {showMaterialInSection && (
          <div className="p-0 overflow-x-auto">
            <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-black">
              <span className="font-bold text-sm uppercase text-slate-600">Pending Material In ({counts["material-in"]})</span>
            </div>
            
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {pendingMaterialIn.sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
                    return timeB - timeA;
                }).map(m => (
                    <div key={m.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                        <div className="flex justify-between items-center">
                            {showSelection ? (
                              <input 
                                type="checkbox" 
                                className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                                checked={selectedIds.has(m.id)}
                                onChange={() => toggleSelect(m.id)}
                              />
                            ) : null}
                            <div className="font-bold text-sm">{m.transactionNo}</div>
                        </div>
                        <div className="text-sm font-bold">{suppliers.find(s => s.id === m.supplierId)?.name || m.supplierId}</div>
                        <div className="text-xs text-slate-600">{m.lines.map((l) => `${materials.find(it => it.id === l.itemId)?.name || npdItems.find(it => it.id === l.itemId)?.name || "Unknown"} [${l.qty}]`).join(', ')}</div>
                        <div className="font-bold text-right text-lg">{m.totalAmount.toLocaleString()}</div>
                        <ApproveButton 
                            confirming={confirmId === m.id} 
                            submitting={submittingId === m.id} 
                            onClick={() => handleApproveMatIn(m.id)} 
                        />
                    </div>
                ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black">
              <thead className="sticky top-0 z-30 bg-slate-50 border-b border-black">
                <tr className="divide-x divide-black">
                  {showSelection ? (
                    <th className="px-4 py-2 w-10">
                      <input 
                        type="checkbox" 
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={counts["material-in"] > 0 && selectedIds.size === counts["material-in"]}
                        onChange={() => toggleSelectAll(pendingMaterialIn.map(m => m.id))}
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Txn No</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Supplier</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Items</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {pendingMaterialIn
                  .sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
                    return timeB - timeA;
                  })
                  .map(m => (
                  <tr key={m.id} className={cn("divide-x divide-black hover:bg-slate-50", selectedIds.has(m.id) && "bg-emerald-50/50")}>
                    {showSelection ? (
                      <td className="px-4 py-2 w-10 text-center">
                        <input 
                          type="checkbox" 
                          className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                          checked={selectedIds.has(m.id)}
                          onChange={() => toggleSelect(m.id)}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-2 text-sm font-medium">{m.transactionNo}</td>
                    <td className="px-4 py-2 text-sm">{suppliers.find(s => s.id === m.supplierId)?.name || m.supplierId}</td>
                    <td className="px-4 py-2 text-sm">
                      <ul className="text-xs space-y-1">
                        {m.lines.map((l, i) => (
                          <li key={i}>{materials.find(it => it.id === l.itemId)?.name || npdItems.find(it => it.id === l.itemId)?.name || "Unknown"} [{l.qty}]</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 text-sm font-mono text-right font-bold">{m.totalAmount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      <ApproveButton 
                        confirming={confirmId === m.id} 
                        submitting={submittingId === m.id} 
                        onClick={() => handleApproveMatIn(m.id)} 
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showOrdersSection && (
          <div className="p-0 overflow-x-auto">
            <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-black">
              <span className="font-bold text-sm uppercase text-slate-600">Pending Orders ({counts["orders"]})</span>
            </div>

            <div className="block md:hidden space-y-4 p-2">
              {pendingOrders.map((o) => (
                <div key={o.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                  <div className="flex justify-between items-center">
                    {showSelection ? (
                      <input
                        type="checkbox"
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={selectedIds.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                      />
                    ) : null}
                    <div className="font-bold text-sm">{o.orderNo}</div>
                  </div>
                  <div className="text-sm font-bold">{companies.find((c) => c.id === o.companyId)?.name || o.companyId}</div>
                  <div className="text-xs text-slate-600">{resolveOrderItem(o)?.name || "Unknown"} [{o.qty}]</div>
                  <div className="flex gap-2 justify-end">
                    <ApproveButton confirming={confirmId === o.id} submitting={submittingId === o.id} onClick={() => handleApproveOrder(o.id)} />
                    <button onClick={() => handleCancelOrder(o.id)} disabled={submittingId === o.id} className="bg-red-50 text-red-800 border border-red-800 px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest">
                      Cancel
                    </button>
                    <button onClick={() => navigate(`/orders/form?edit=${o.id}`)} className="bg-slate-200 text-black border border-black px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest">
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black">
              <thead className="sticky top-0 z-30 bg-slate-50 border-b border-black">
                <tr className="divide-x divide-black">
                  {showSelection ? (
                    <th className="px-4 py-2 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={counts["orders"] > 0 && selectedIds.size === counts["orders"]}
                        onChange={() => toggleSelectAll(pendingOrders.map((o) => o.id))}
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Order No</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Company</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Item</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Qty</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {pendingOrders
                  .sort((a, b) => new Date(b.updateTimestamp || b.orderDate || 0).getTime() - new Date(a.updateTimestamp || a.orderDate || 0).getTime())
                  .map((o) => (
                    <tr key={o.id} className={cn("divide-x divide-black hover:bg-slate-50", selectedIds.has(o.id) && "bg-emerald-50/50")}>
                      {showSelection ? (
                        <td className="px-4 py-2 w-10 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                            checked={selectedIds.has(o.id)}
                            onChange={() => toggleSelect(o.id)}
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-2 text-sm font-medium">{o.orderNo}</td>
                      <td className="px-4 py-2 text-sm">{formatDate(o.orderDate)}</td>
                      <td className="px-4 py-2 text-sm">{companies.find((c) => c.id === o.companyId)?.name || o.companyId}</td>
                      <td className="px-4 py-2 text-sm">{resolveOrderItem(o)?.name || "Unknown"}</td>
                      <td className="px-4 py-2 text-sm text-right font-bold">{o.qty}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-2 justify-end">
                          <ApproveButton confirming={confirmId === o.id} submitting={submittingId === o.id} onClick={() => handleApproveOrder(o.id)} />
                          <button onClick={() => handleCancelOrder(o.id)} disabled={submittingId === o.id} className="bg-red-50 text-red-800 border border-red-800 px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest">
                            Cancel
                          </button>
                          <button onClick={() => navigate(`/orders/form?edit=${o.id}`)} className="bg-slate-200 text-black border border-black px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest">
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {showConsumptionSection && (
          <div className="p-0 overflow-x-auto">
            <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-black">
              <span className="font-bold text-sm uppercase text-slate-600">Pending Consumption ({counts["consumption"]})</span>
            </div>

            <div className="block md:hidden space-y-4 p-2">
              {pendingConsumptions.map((c) => (
                <div key={c.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                  <div className="flex justify-between items-center">
                    {showSelection ? (
                      <input
                        type="checkbox"
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                    ) : null}
                    <div className="font-bold text-sm">{c.transactionNo}</div>
                  </div>
                  <div className="text-sm font-bold">{npdItems.find((it) => it.id === c.itemId)?.name || "Unknown"}</div>
                  <div className="text-xs text-slate-600">{c.qty} {c.uom}</div>
                  <div className="flex justify-end">
                    <ApproveButton confirming={confirmId === c.id} submitting={submittingId === c.id} onClick={() => handleApproveConsumption(c.id)} />
                  </div>
                </div>
              ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black">
              <thead className="sticky top-0 z-30 bg-slate-50 border-b border-black">
                <tr className="divide-x divide-black">
                  {showSelection ? (
                    <th className="px-4 py-2 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={counts["consumption"] > 0 && selectedIds.size === counts["consumption"]}
                        onChange={() => toggleSelectAll(pendingConsumptions.map((c) => c.id))}
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Txn No</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Item</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Qty</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">UOM</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {pendingConsumptions
                  .sort((a, b) => new Date(b.updateTimestamp || b.date || 0).getTime() - new Date(a.updateTimestamp || a.date || 0).getTime())
                  .map((c) => (
                    <tr key={c.id} className={cn("divide-x divide-black hover:bg-slate-50", selectedIds.has(c.id) && "bg-emerald-50/50")}>
                      {showSelection ? (
                        <td className="px-4 py-2 w-10 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-2 text-sm font-medium">{c.transactionNo}</td>
                      <td className="px-4 py-2 text-sm">{formatDate(c.date)}</td>
                      <td className="px-4 py-2 text-sm">{npdItems.find((it) => it.id === c.itemId)?.name || "Unknown"}</td>
                      <td className="px-4 py-2 text-sm text-right font-bold">{c.qty}</td>
                      <td className="px-4 py-2 text-sm">{c.uom}</td>
                      <td className="px-4 py-2 text-right">
                        <ApproveButton confirming={confirmId === c.id} submitting={submittingId === c.id} onClick={() => handleApproveConsumption(c.id)} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {showEmptyState ? (
          <div className="p-8 text-center text-sm font-bold uppercase tracking-wide text-slate-500">
            No pending approvals found.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick, count, icon }: { active: boolean; label: string; onClick: () => void; count: number; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-6 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all",
        active 
          ? "bg-white text-black shadow-sm ring-1 ring-black/10 scale-105 z-10" 
          : "text-slate-500 hover:text-black hover:bg-white/50"
      )}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className={cn(
          "flex items-center justify-center w-5 h-5 text-[10px] rounded-full",
          active ? "bg-black text-white" : "bg-slate-200 text-slate-600"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

function ApproveButton({ confirming, submitting, onClick }: { confirming: boolean; submitting: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={submitting}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest border transition-all disabled:opacity-50",
        confirming 
          ? "bg-amber-600 text-white border-black animate-pulse" 
          : "bg-emerald-100 text-emerald-800 border-emerald-800 hover:bg-emerald-200"
      )}
    >
      {submitting ? <Spinner size={12} /> : (
        <>
          <CheckCircle size={12} />
          {confirming ? "Confirm?" : "Approve"}
        </>
      )}
    </button>
  );
}

function CancelButton({ canceling, submitting, onClick }: { canceling: boolean; submitting: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={submitting}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest border transition-all disabled:opacity-50",
        canceling 
          ? "bg-red-600 text-white border-black shadow-none" 
          : "bg-red-50 text-red-800 border-red-800 hover:bg-red-100"
      )}
    >
      {submitting && canceling ? <Spinner size={12} /> : (
        <>
          <XCircle size={12} />
          {canceling ? "Confirm Cancel" : "Cancel"}
        </>
      )}
    </button>
  );
}

