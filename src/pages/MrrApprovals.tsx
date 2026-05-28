import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier, MaterialInPackingSlip } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, XCircle, Search, FileText, ChevronRight, ArrowLeft } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useNavigate } from "react-router-dom";

type Stage = "Pending PH" | "Pending Accounts" | "Pending MD";

export function MrrApprovals() {
  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  
  const [activeStage, setActiveStage] = useState<Stage>("Pending PH");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null); // MRR ID being processed

  const stages: { label: string; value: Stage }[] = [
    { label: "Plant Head", value: "Pending PH" },
    { label: "Accounts", value: "Pending Accounts" },
    { label: "MD Approval", value: "Pending MD" },
  ];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    stages.forEach(s => {
      c[s.value] = materialIn.filter(m => m.status === s.value).length;
    });
    return c;
  }, [materialIn]);

  const filteredList = useMemo(() => {
    return materialIn
      .filter(m => m.status === activeStage)
      .filter(m => {
        const supplierName = suppliers.find(s => s.id === m.supplierId)?.name || "";
        const searchStr = `${m.transactionNo} ${m.gateEntryNo || ""} ${supplierName} ${m.invoiceNo}`.toLowerCase();
        return searchStr.includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => new Date(b.updateTimestamp || b.timestamp).getTime() - new Date(a.updateTimestamp || a.timestamp).getTime());
  }, [materialIn, activeStage, searchTerm, suppliers]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredList.map(m => m.id));
    }
  };

  const handleAction = async (mrrId: string, action: "Approve" | "Reject") => {
    const mrr = materialIn.find(m => m.id === mrrId);
    if (!mrr) return;

    const remark = remarks[mrrId] || "";
    if (!remark.trim()) {
      alert("Please provide a remark.");
      return;
    }

    setIsSubmitting(mrrId);
    const timestamp = new Date().toISOString();
    const email = activeStage === "Pending PH" ? "ph@lngrp.in" : 
                  activeStage === "Pending Accounts" ? "accounts@lngrp.in" : 
                  activeStage === "Pending MD" ? "md@lngrp.in" : "system@lngrp.in";

    let nextStatus: MaterialIn["status"] = mrr.status;
    const patch: Partial<MaterialIn> = { updateTimestamp: timestamp, updatedBy: email };

    if (action === "Approve") {
      if (activeStage === "Pending PH") {
        nextStatus = "Pending Accounts";
        patch.phTimestamp = timestamp;
        patch.phEmailId = email;
        patch.plant_head_remark = remark;
      }
      else if (activeStage === "Pending Accounts") {
        nextStatus = "Pending MD";
        patch.accTimestamp = timestamp;
        patch.accEmailId = email;
        patch.accounts_remark = remark;
      }
      else if (activeStage === "Pending MD") {
        nextStatus = "Pending Tally";
        patch.mdTimestamp = timestamp;
        patch.mdEmailId = email;
        patch.md_approval_remark = remark;
      }
    } else {
      nextStatus = "Pending MRR";
      if (activeStage === "Pending PH") patch.plant_head_remark = `REJECTED: ${remark}`;
      if (activeStage === "Pending Accounts") patch.accounts_remark = `REJECTED: ${remark}`;
      if (activeStage === "Pending MD") patch.md_approval_remark = `REJECTED: ${remark}`;
    }

    patch.status = nextStatus;

    try {
      await setMaterialIn(prev => prev.map(m => m.id === mrrId ? { ...m, ...patch } : m));
      setRemarks(prev => {
        const next = { ...prev };
        delete next[mrrId];
        return next;
      });
      setSelectedIds(prev => prev.filter(i => i !== mrrId));
    } catch (err) {
      console.error("Action failed:", err);
      alert("Failed to update MRR status.");
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return;
    
    // Validate remarks for all selected
    const missingRemarks = selectedIds.filter(id => !remarks[id]?.trim());
    if (missingRemarks.length > 0) {
      alert("Please provide remarks for all selected MRRs.");
      return;
    }

    if (!confirm(`Are you sure you want to approve ${selectedIds.length} MRRs?`)) return;

    for (const id of selectedIds) {
      await handleAction(id, "Approve");
    }
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;

  const getItemSpecs = (line: MaterialIn["lines"][0]) => {
    const material = materials.find(m => m.id === line.itemId);
    if (!material) return line.itemId;
    
    const specs = [];
    if (material.size) specs.push(`Size: ${material.size} CM`);
    if (material.gsm) specs.push(`GSM: ${material.gsm}`);
    if (material.bf) specs.push(`BF: ${material.bf}`);
    
    const specStr = specs.join(" X ");
    const erpStr = `ERP:${material.erpCode || material.id} | Size:${material.size || "-"} | GSM:${material.gsm || "-"} | BF:${material.bf || "-"} | Wt:${Number(line.actualQty || line.qty || 0).toFixed(3)}`;
    
    return `${material.name} - ${specStr} (${erpStr})`;
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Top Header */}
      <div className="p-4 bg-white border-b border-black">
        <h1 className="text-3xl font-black text-indigo-700 uppercase tracking-tighter">All Approvals (Grouped)</h1>
      </div>

      {/* Stage Selector Tabs */}
      <div className="flex justify-center gap-4 my-6">
        {stages.map((s) => (
          <button
            key={s.value}
            onClick={() => {
              setActiveStage(s.value);
              setSelectedIds([]);
            }}
            className={cn(
              "px-6 py-2 rounded font-bold text-sm uppercase transition-all border border-black",
              activeStage === s.value
                ? "bg-indigo-600 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -translate-y-0.5"
                : "bg-white text-indigo-600 hover:bg-indigo-50"
            )}
          >
            {s.label} ({counts[s.value] || 0})
          </button>
        ))}
      </div>

      {/* Table Container */}
      <div className="flex-1 px-4 pb-20">
        <div className="bg-white border border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="bg-indigo-600 px-4 py-2 text-white font-black uppercase text-sm border-b border-black">
            {activeStage} ({filteredList.length})
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest">
                <tr className="divide-x divide-white/20">
                  <th className="px-2 py-3 text-center">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.length === filteredList.length && filteredList.length > 0}
                      onChange={toggleSelectAll}
                      className="accent-white h-4 w-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">GE No</th>
                  <th className="px-4 py-3 text-left">MRR No</th>
                  <th className="px-4 py-3 text-left">Firm</th>
                  <th className="px-4 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Total Qty</th>
                  <th className="px-4 py-3 text-left min-w-[300px]">Items</th>
                  <th className="px-4 py-3 text-right">MRR Weight</th>
                  <th className="px-4 py-3 text-right">Invoice Weight</th>
                  <th className="px-4 py-3 text-right">Difference</th>
                  <th className="px-4 py-3 text-right">PO Rate</th>
                  <th className="px-4 py-3 text-right">Invoice Rate</th>
                  <th className="px-4 py-3 text-right">Basic Value</th>
                  <th className="px-4 py-3 text-center min-w-[200px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-sm">
                      No records found in this stage
                    </td>
                  </tr>
                ) : (
                  filteredList.map((m) => {
                    const mrrWeight = m.lines.reduce((s, l) => s + (l.actualQty || l.qty || 0), 0);
                    const invWeight = m.lines.reduce((s, l) => s + (l.invoiceQty || 0), 0);
                    const diff = mrrWeight - invWeight;
                    const firstLine = m.lines[0] || {};
                    const basicValue = mrrWeight * (firstLine.invoiceRate || 0);

                    return (
                      <tr key={m.id} className="divide-x divide-black hover:bg-slate-50 transition-colors text-[11px] text-black font-medium uppercase">
                        <td className="px-2 py-4 text-center">
                          <input 
                            type="checkbox" 
                            checked={selectedIds.includes(m.id)}
                            onChange={() => toggleSelect(m.id)}
                            className="accent-indigo-600 h-4 w-4"
                          />
                        </td>
                        <td className="px-4 py-4">{m.gateEntryNo || "-"}</td>
                        <td className="px-4 py-4">{m.transactionNo}</td>
                        <td className="px-4 py-4">LNPI</td>
                        <td className="px-4 py-4 whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">{getSupplierName(m.supplierId)}</td>
                        <td className="px-4 py-4 text-center">-</td>
                        <td className="px-4 py-4 leading-relaxed lowercase first-letter:uppercase">
                          {m.lines.map((l, i) => (
                            <div key={i} className="mb-2 last:mb-0">
                              {i + 1}. {getItemSpecs(l)}
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-4 text-right font-bold">{mrrWeight.toFixed(2)}</td>
                        <td className="px-4 py-4 text-right font-bold">{invWeight.toFixed(2)}</td>
                        <td className={cn("px-4 py-4 text-right font-bold", Math.abs(diff) > 40 ? "text-red-600" : "text-emerald-600")}>
                          {diff.toFixed(2)}
                        </td>
                        <td className="px-4 py-4 text-right">{Number(firstLine.poRate || 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right">{Number(firstLine.invoiceRate || 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right font-black">{basicValue.toFixed(2)}</td>
                        <td className="px-4 py-4 flex flex-col gap-2 min-w-[200px]">
                          <div className="grid grid-cols-1 gap-1">
                            <button 
                              onClick={() => navigate(`/material-in/master?search=${m.transactionNo}`)}
                              className="w-full border border-indigo-600 text-indigo-600 py-1 rounded text-[10px] font-black hover:bg-indigo-50"
                            >
                              OPEN
                            </button>
                            <button 
                              disabled={!!isSubmitting}
                              onClick={() => handleAction(m.id, "Approve")}
                              className="w-full border border-black text-black py-1 rounded text-[10px] font-black hover:bg-slate-100"
                            >
                              {isSubmitting === m.id ? <Spinner size={12} /> : "APPROVE"}
                            </button>
                            <button 
                              disabled={!!isSubmitting}
                              onClick={() => handleAction(m.id, "Reject")}
                              className="w-full bg-red-600 text-white py-1 rounded text-[10px] font-black hover:bg-red-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            >
                              REJECT
                            </button>
                          </div>
                          <textarea
                            value={remarks[m.id] || ""}
                            onChange={e => setRemarks(prev => ({ ...prev, [m.id]: e.target.value }))}
                            placeholder={`${activeStage.replace("Pending ", "")} Remark *`}
                            className="w-full border border-black rounded p-1 text-[10px] uppercase outline-none focus:ring-1 focus:ring-indigo-600 min-h-[40px]"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer / Bulk Actions */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t-2 border-black flex items-center justify-between px-8 shadow-[0_-4px_10px_rgba(0,0,0,0.1)] z-40">
        <button 
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 border border-black rounded font-bold text-xs uppercase hover:bg-slate-50 transition-all"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-center gap-8">
          <label className="flex items-center gap-2 font-bold text-xs uppercase cursor-pointer">
            <input 
              type="checkbox" 
              checked={selectedIds.length === filteredList.length && filteredList.length > 0}
              onChange={toggleSelectAll}
              className="accent-indigo-600 h-4 w-4"
            />
            Select All Visible
          </label>

          <button
            disabled={selectedIds.length === 0 || !!isSubmitting}
            onClick={handleBulkApprove}
            className={cn(
              "px-8 py-2 bg-indigo-600 text-white rounded font-black text-xs uppercase tracking-widest transition-all border border-black",
              selectedIds.length > 0 ? "shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5" : "opacity-50"
            )}
          >
            {isSubmitting ? <Spinner size={16} className="text-white" /> : `Approve Selected (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
