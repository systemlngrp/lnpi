import { useState } from "react";
import { useData } from "../hooks/useData";
import { MaterialIn, Production, Consumption, Item, Supplier, OrderSchedule } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, Package, Truck, Activity, TrendingDown, XCircle } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

type Tab = "material-in" | "production" | "consumption";

export function PlantHeadUnified() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [productions, setProductions] = useData<Production>("productions", []);
  const [consumptions, setConsumptions] = useData<Consumption>("consumptions", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);

  const [activeTab, setActiveTab] = useState<Tab>("material-in");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState("");
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

  const counts = {
    "material-in": materialIn.filter(m => isPendingPH(m.status)).length,
    "production": productions.filter(p => isPendingPH(p.status)).length,
    "consumption": consumptions.filter(c => isPendingPH(c.status)).length
  };

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
      } else if (activeTab === "production") {
        await setProductions(prev => prev.map(p => 
          selectedIds.has(p.id) ? { ...p, status: "Pending Consumption", phTimestamp: timestamp, phEmailId: email } : p
        ));
      } else if (activeTab === "consumption") {
        await setConsumptions(prev => prev.map(c => 
          selectedIds.has(c.id) ? { ...c, status: "Pending Tally", phTimestamp: timestamp, phEmailId: email } : c
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

  const handleApproveProduction = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setSubmittingId(id);
    try {
      await setProductions(prev => prev.map(p => 
        p.id === id ? { ...p, status: "Pending Consumption", phTimestamp: new Date().toISOString(), phEmailId: "ph@lngrp.in" } : p
      ));
    } catch (err) {
      console.error("Approval error:", err);
    } finally {
      setSubmittingId(null);
      setConfirmId(null);
    }
  };

  const handleCancelProduction = async (id: string) => {
    const prod = productions.find(p => p.id === id);
    if (!prod) return;

    if (cancelingId !== id) {
      setCancelingId(id);
      setCancelRemarks("");
      return;
    }

    if (!cancelRemarks.trim()) {
      alert("Please provide cancellation remarks.");
      return;
    }

    setSubmittingId(id);
    try {
      const timestamp = new Date().toISOString();
      const email = "ph@lngrp.in";

      // 1. Update production entry
      await setProductions(prev => prev.map(p => 
        p.id === id ? { 
          ...p, 
          status: "Cancelled", 
          cancelTimestamp: timestamp, 
          cancelEmailId: email, 
          cancelRemarks: cancelRemarks.trim(),
          updateTimestamp: timestamp 
        } : p
      ));

      // 2. Revert produced quantity in schedule if scheduleId exists
      if (prod.scheduleId) {
        await setSchedules(prev => prev.map(s => 
          s.id === prod.scheduleId ? {
            ...s,
            producedQty: Math.max(0, Number(s.producedQty || 0) - Number(prod.qty || 0)),
            updateTimestamp: timestamp,
            updatedBy: "System User (Cancel)"
          } : s
        ));
      }

      setCancelingId(null);
      setCancelRemarks("");
    } catch (err) {
      console.error("Cancellation error:", err);
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
      await setConsumptions(prev => prev.map(c => 
        c.id === id ? { ...c, status: "Pending Tally", phTimestamp: new Date().toISOString(), phEmailId: "ph@lngrp.in" } : c
      ));
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
            active={activeTab === "material-in"} 
            onClick={() => { setActiveTab("material-in"); setSelectedIds(new Set()); }}
            label="Material In"
            count={counts["material-in"]}
            icon={<Truck size={14} />}
          />
          <TabButton 
            active={activeTab === "production"} 
            onClick={() => { setActiveTab("production"); setSelectedIds(new Set()); }}
            label="Production"
            count={counts["production"]}
            icon={<Activity size={14} />}
          />
          <TabButton 
            active={activeTab === "consumption"} 
            onClick={() => { setActiveTab("consumption"); setSelectedIds(new Set()); }}
            label="Consumption"
            count={counts["consumption"]}
            icon={<TrendingDown size={14} />}
          />
        </div>
      </div>

      <div className={cn("bg-white rounded border border-black shadow-sm transition-opacity", (isBulkApproving || submittingId) && "opacity-50 pointer-events-none")}>
        {selectedIds.size > 0 && (
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

        {activeTab === "material-in" && (
          <div className="p-0 overflow-x-auto">
            <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-black">
              <span className="font-bold text-sm uppercase text-slate-600">Pending Material In ({counts["material-in"]})</span>
              <ExcelExport data={materialIn.filter(m => m.status === "Pending PH")} fileName="Pending_PH_MaterialIn" />
            </div>
            
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {materialIn.filter(m => isPendingPH(m.status)).sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
                    return timeB - timeA;
                }).map(m => (
                    <div key={m.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                        <div className="flex justify-between items-center">
                            <input 
                              type="checkbox" 
                              className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                              checked={selectedIds.has(m.id)}
                              onChange={() => toggleSelect(m.id)}
                            />
                            <div className="font-bold text-sm">{m.transactionNo}</div>
                        </div>
                        <div className="text-sm font-bold">{suppliers.find(s => s.id === m.supplierId)?.name || m.supplierId}</div>
                        <div className="text-xs text-slate-600">{m.lines.map((l, i) => `${items.find(it => it.id === l.itemId)?.name} [${l.qty}]`).join(', ')}</div>
                        <div className="font-bold text-right text-lg">₹{m.totalAmount.toLocaleString()}</div>
                        <ApproveButton 
                            confirming={confirmId === m.id} 
                            submitting={submittingId === m.id} 
                            onClick={() => handleApproveMatIn(m.id)} 
                        />
                    </div>
                ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black">
              <thead className="bg-slate-50 border-b border-black">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-2 w-10">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                      checked={counts["material-in"] > 0 && selectedIds.size === counts["material-in"]}
                      onChange={() => toggleSelectAll(materialIn.filter(m => isPendingPH(m.status)).map(m => m.id))}
                    />
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Txn No</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Supplier</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Items</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {materialIn
                  .filter(m => isPendingPH(m.status))
                  .sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
                    return timeB - timeA;
                  })
                  .map(m => (
                  <tr key={m.id} className={cn("divide-x divide-black hover:bg-slate-50", selectedIds.has(m.id) && "bg-emerald-50/50")}>
                    <td className="px-4 py-2 w-10 text-center">
                      <input 
                        type="checkbox" 
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={selectedIds.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                      />
                    </td>
                    <td className="px-4 py-2 text-sm font-medium">{m.transactionNo}</td>
                    <td className="px-4 py-2 text-sm">{suppliers.find(s => s.id === m.supplierId)?.name || m.supplierId}</td>
                    <td className="px-4 py-2 text-sm">
                      <ul className="text-xs space-y-1">
                        {m.lines.map((l, i) => (
                          <li key={i}>{items.find(it => it.id === l.itemId)?.name} [{l.qty}]</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 text-sm font-mono text-right font-bold">₹{m.totalAmount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      <ApproveButton 
                        confirming={confirmId === m.id} 
                        submitting={submittingId === m.id} 
                        onClick={() => handleApproveMatIn(m.id)} 
                      />
                    </td>
                  </tr>
                ))}
                {counts["material-in"] === 0 && <NoPendingRows colSpan={6} />}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "production" && (
          <div className="p-0 overflow-x-auto">
            <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-black">
              <span className="font-bold text-sm uppercase text-slate-600">Pending Production ({counts["production"]})</span>
              <ExcelExport data={productions.filter(p => p.status === "Pending PH")} fileName="Pending_PH_Production" />
            </div>
            
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {productions.filter(p => isPendingPH(p.status)).sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                    return timeB - timeA;
                }).map(p => (
                    <div key={p.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                        <div className="flex justify-between items-center">
                            <input 
                              type="checkbox" 
                              className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                              checked={selectedIds.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                            />
                            <div className="font-bold text-sm">{p.transactionNo}</div>
                        </div>
                        <div className="text-sm font-bold">{items.find(it => it.id === p.itemId)?.name}</div>
                        <div className="text-sm">{p.qty} {p.uom}</div>
                        
                        {cancelingId === p.id && (
                          <div className="flex flex-col gap-1 w-full py-2">
                            <input 
                              type="text"
                              autoFocus
                              placeholder="Cancellation remarks..."
                              value={cancelRemarks}
                              onChange={(e) => setCancelRemarks(e.target.value)}
                              className="text-xs p-2 border border-black rounded focus:outline-none focus:border-red-600"
                            />
                          </div>
                        )}
                        
                        <div className="flex gap-2 justify-end">
                            {!cancelingId && (
                              <ApproveButton 
                                  confirming={confirmId === p.id} 
                                  submitting={submittingId === p.id} 
                                  onClick={() => handleApproveProduction(p.id)} 
                              />
                            )}
                            {(cancelingId === p.id || !confirmId) && (
                              <CancelButton 
                                  canceling={cancelingId === p.id}
                                  submitting={submittingId === p.id}
                                  onClick={() => handleCancelProduction(p.id)}
                              />
                            )}
                            {cancelingId === p.id && (
                              <button onClick={() => { setCancelingId(null); setCancelRemarks(""); }} className="text-[10px] uppercase font-bold text-slate-500 hover:text-black transition-colors">Back</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black">
              <thead className="bg-slate-50 border-b border-black">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-2 w-10">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                      checked={counts["production"] > 0 && selectedIds.size === counts["production"]}
                      onChange={() => toggleSelectAll(productions.filter(p => isPendingPH(p.status)).map(p => p.id))}
                    />
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Txn No</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Item</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Qty</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">UOM</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {productions
                  .filter(p => isPendingPH(p.status))
                  .sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                    return timeB - timeA;
                  })
                  .map(p => (
                  <tr key={p.id} className={cn("divide-x divide-black hover:bg-slate-50", selectedIds.has(p.id) && "bg-emerald-50/50")}>
                    <td className="px-4 py-2 w-10 text-center">
                      <input 
                        type="checkbox" 
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    <td className="px-4 py-2 text-sm font-medium">{p.transactionNo}</td>
                    <td className="px-4 py-2 text-sm">{items.find(it => it.id === p.itemId)?.name}</td>
                    <td className="px-4 py-2 text-sm text-right font-bold">{p.qty}</td>
                    <td className="px-4 py-2 text-sm">{p.uom}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex flex-col gap-2 items-end">
                        {cancelingId === p.id && (
                          <div className="flex flex-col gap-1 w-full max-w-[200px]">
                            <input 
                              type="text"
                              autoFocus
                              placeholder="Reason..."
                              value={cancelRemarks}
                              onChange={(e) => setCancelRemarks(e.target.value)}
                              className="text-[10px] p-2 border border-black rounded focus:outline-none focus:border-red-600"
                            />
                          </div>
                        )}
                        <div className="flex gap-2">
                          {!cancelingId && (
                            <ApproveButton 
                              confirming={confirmId === p.id} 
                              submitting={submittingId === p.id} 
                              onClick={() => handleApproveProduction(p.id)} 
                            />
                          )}
                          {(cancelingId === p.id || !confirmId) && (
                            <CancelButton 
                                canceling={cancelingId === p.id}
                                submitting={submittingId === p.id}
                                onClick={() => handleCancelProduction(p.id)}
                            />
                          )}
                          {cancelingId === p.id && (
                            <button onClick={() => { setCancelingId(null); setCancelRemarks(""); }} className="text-[10px] uppercase font-bold text-slate-500 hover:text-black transition-colors">Back</button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                {counts["production"] === 0 && <NoPendingRows colSpan={6} />}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "consumption" && (
          <div className="p-0 overflow-x-auto">
            <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-black">
              <span className="font-bold text-sm uppercase text-slate-600">Pending Consumption ({counts["consumption"]})</span>
              <ExcelExport data={consumptions.filter(c => c.status === "Pending PH")} fileName="Pending_PH_Consumption" />
            </div>
            
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {consumptions.filter(c => isPendingPH(c.status)).sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                    return timeB - timeA;
                }).map(c => (
                    <div key={c.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                        <div className="flex justify-between items-center">
                            <input 
                              type="checkbox" 
                              className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                              checked={selectedIds.has(c.id)}
                              onChange={() => toggleSelect(c.id)}
                            />
                            <div className="font-bold text-sm">{c.transactionNo}</div>
                        </div>
                        <div className="text-sm font-bold">{items.find(it => it.id === c.itemId)?.name}</div>
                        <div className="text-sm">{c.qty} {c.uom}</div>
                        <ApproveButton 
                            confirming={confirmId === c.id} 
                            submitting={submittingId === c.id} 
                            onClick={() => handleApproveConsumption(c.id)} 
                        />
                    </div>
                ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black">
              <thead className="bg-slate-50 border-b border-black">
                <tr className="divide-x divide-black">
                  <th className="px-4 py-2 w-10">
                    <input 
                      type="checkbox" 
                      className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                      checked={counts["consumption"] > 0 && selectedIds.size === counts["consumption"]}
                      onChange={() => toggleSelectAll(consumptions.filter(c => isPendingPH(c.status)).map(c => c.id))}
                    />
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Txn No</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">Item</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Qty</th>
                  <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase">UOM</th>
                  <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {consumptions
                  .filter(c => isPendingPH(c.status))
                  .sort((a, b) => {
                    const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
                    const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
                    return timeB - timeA;
                  })
                  .map(c => (
                  <tr key={c.id} className={cn("divide-x divide-black hover:bg-slate-50", selectedIds.has(c.id) && "bg-amber-50/50")}>
                    <td className="px-4 py-2 w-10 text-center">
                      <input 
                        type="checkbox" 
                        className="rounded border-black text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                    </td>
                    <td className="px-4 py-2 text-sm font-medium">{c.transactionNo}</td>
                    <td className="px-4 py-2 text-sm">{items.find(it => it.id === c.itemId)?.name}</td>
                    <td className="px-4 py-2 text-sm text-right font-bold">{c.qty}</td>
                    <td className="px-4 py-2 text-sm">{c.uom}</td>
                    <td className="px-4 py-2 text-right">
                      <ApproveButton 
                        confirming={confirmId === c.id} 
                        submitting={submittingId === c.id} 
                        onClick={() => handleApproveConsumption(c.id)} 
                      />
                    </td>
                  </tr>
                ))}
                {counts["consumption"] === 0 && <NoPendingRows colSpan={6} />}
              </tbody>
            </table>
          </div>
        )}
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

function NoPendingRows({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-400 font-medium italic text-sm">
        No pending transactions in this category.
      </td>
    </tr>
  );
}
