import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier, MaterialInPackingSlip } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, XCircle, Eye, ChevronRight, Search, FileText, AlertCircle } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { ExcelExport } from "../components/ExcelExport";

type Stage = "Pending MRR" | "Pending PH" | "Pending Accounts" | "Pending MD" | "Pending Tally";

export function MrrApprovals() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);

  const [activeStage, setActiveStage] = useState<Stage>("Pending MRR");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Form states for approval
  const [remark, setRemark] = useState("");
  const [debitNote, setDebitNote] = useState("");
  const [debitNoteDate, setDebitNoteDate] = useState("");
  const [debitNoteAmount, setDebitNoteAmount] = useState<number | "">("");
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stages: { label: string; value: Stage; status: string }[] = [
    { label: "Pending MRR", value: "Pending MRR", status: "Pending MRR" },
    { label: "Plant Head", value: "Pending PH", status: "Pending PH" },
    { label: "Accounts", value: "Pending Accounts", status: "Pending Accounts" },
    { label: "MD Approval", value: "Pending MD", status: "Pending MD" },
    { label: "Tally Posting", value: "Pending Tally", status: "Pending Tally" },
  ];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    stages.forEach(s => {
      c[s.value] = materialIn.filter(m => m.status === s.status).length;
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

  const selectedMrr = useMemo(() => materialIn.find(m => m.id === selectedId), [materialIn, selectedId]);

  const selectedMrrSlips = useMemo(() => {
    if (!selectedMrr) return [];
    return packingSlips.filter(s => s.materialInId === selectedMrr.id);
  }, [selectedMrr, packingSlips]);

  const totals = useMemo(() => {
    if (!selectedMrr) return { invoiceWeight: 0, actualWeight: 0, diff: 0 };
    const invoiceWeight = selectedMrr.lines.reduce((sum, l) => sum + (l.invoiceQty || 0), 0);
    const actualWeight = selectedMrr.lines.reduce((sum, l) => sum + (l.actualQty || l.qty || 0), 0);
    return {
      invoiceWeight,
      actualWeight,
      diff: invoiceWeight - actualWeight
    };
  }, [selectedMrr]);

  const isDebitNoteRequired = useMemo(() => {
    if (!selectedMrr || activeStage !== "Pending Accounts") return false;
    return selectedMrr.mrrType === "Reel" && totals.diff > 40;
  }, [selectedMrr, activeStage, totals]);

  const handleAction = async (action: "Approve" | "Reject") => {
    if (!selectedMrr) return;
    if (!remark.trim()) {
      alert("Please provide a remark.");
      return;
    }
    if (action === "Approve" && isDebitNoteRequired && (!debitNote || !debitNoteDate || !debitNoteAmount)) {
      alert("Debit note details are required for this MRR because the weight difference exceeds 40kg.");
      return;
    }

    setIsSubmitting(true);
    const timestamp = new Date().toISOString();
    const email = activeStage === "Pending PH" ? "ph@lngrp.in" : 
                  activeStage === "Pending Accounts" ? "accounts@lngrp.in" : 
                  activeStage === "Pending MD" ? "md@lngrp.in" : "system@lngrp.in";

    let nextStatus: MaterialIn["status"] = selectedMrr.status;
    const patch: Partial<MaterialIn> = { updateTimestamp: timestamp, updatedBy: email };

    if (action === "Approve") {
      if (activeStage === "Pending MRR") nextStatus = "Pending PH";
      else if (activeStage === "Pending PH") {
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
        patch.debitNote = debitNote;
        patch.debitNoteDate = debitNoteDate;
        patch.debitNoteAmount = Number(debitNoteAmount) || undefined;
      }
      else if (activeStage === "Pending MD") {
        nextStatus = "Pending Tally";
        patch.mdTimestamp = timestamp;
        patch.mdEmailId = email;
        patch.md_approval_remark = remark;
      }
      else if (activeStage === "Pending Tally") {
        nextStatus = "Completed";
        patch.tallyTimestamp = timestamp;
      }
    } else {
      // Rejection logic - for now, move back to Pending MRR or some "Rejected" state if existed
      // The plan says "return to correction or rejected list". Let's move to "Pending MRR" for correction.
      nextStatus = "Pending MRR";
      patch.status = "Pending MRR"; // Explicitly set it
      if (activeStage === "Pending PH") patch.plant_head_remark = `REJECTED: ${remark}`;
      if (activeStage === "Pending Accounts") patch.accounts_remark = `REJECTED: ${remark}`;
      if (activeStage === "Pending MD") patch.md_approval_remark = `REJECTED: ${remark}`;
    }

    patch.status = nextStatus;

    try {
      await setMaterialIn(prev => prev.map(m => m.id === selectedMrr.id ? { ...m, ...patch } : m));
      setSelectedId(null);
      setRemark("");
      setDebitNote("");
      setDebitNoteDate("");
      setDebitNoteAmount("");
    } catch (err) {
      console.error("Action failed:", err);
      alert("Failed to update MRR status.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || id;
  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || items.find(i => i.id === id)?.name || "Unknown";

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] overflow-hidden gap-4">
      {/* Top Header / Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500 bg-white p-3 rounded border border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <FileText size={14} className="text-black" />
        <span>MRR</span>
        <ChevronRight size={12} />
        <span>Approvals</span>
        <ChevronRight size={12} />
        <span className="text-black bg-amber-200 px-2 py-0.5 rounded">{activeStage}</span>
      </div>

      <div className="flex flex-1 overflow-hidden gap-4">
        {/* Left Sidebar: Stages */}
        <div className="w-64 flex flex-col gap-2 shrink-0">
          <h2 className="text-lg font-black uppercase tracking-tighter text-black mb-2 px-2">Approval Stages</h2>
          {stages.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                setActiveStage(s.value);
                setSelectedId(null);
              }}
              className={cn(
                "flex items-center justify-between p-3 rounded border transition-all text-left",
                activeStage === s.value
                  ? "bg-black text-white border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  : "bg-white text-black border-black hover:bg-slate-50"
              )}
            >
              <span className="text-xs font-bold uppercase tracking-tight">{s.label}</span>
              <span className={cn(
                "text-[10px] font-black px-2 py-0.5 rounded-full",
                activeStage === s.value ? "bg-white text-black" : "bg-black text-white"
              )}>
                {counts[s.value] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Center: List View */}
        <div className="flex-1 flex flex-col bg-white rounded border border-black overflow-hidden min-w-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="p-4 border-b border-black flex items-center justify-between bg-slate-50 gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search MRR, Supplier, Invoice..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-black rounded text-sm focus:ring-1 focus:ring-black outline-none"
              />
            </div>
            <ExcelExport data={filteredList} fileName={`MRR_Approvals_${activeStage.replace(/ /g, '_')}`} />
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="min-w-full divide-y divide-black border-collapse">
              <thead className="bg-slate-100 sticky top-0 z-10">
                <tr className="divide-x divide-black">
                  {["MRR No", "GE No", "Supplier", "Date", "Type", "Inv Wt", "Act Wt", "Diff", "Status", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-black border-b border-black">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-sm">
                      No records found in this stage
                    </td>
                  </tr>
                ) : (
                  filteredList.map((m) => {
                    const invWt = m.lines.reduce((s, l) => s + (l.invoiceQty || 0), 0);
                    const actWt = m.lines.reduce((s, l) => s + (l.actualQty || l.qty || 0), 0);
                    const diff = invWt - actWt;
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelectedId(m.id)}
                        className={cn(
                          "divide-x divide-black hover:bg-slate-50 cursor-pointer transition-colors",
                          selectedId === m.id ? "bg-amber-50" : ""
                        )}
                      >
                        <td className="px-4 py-3 text-xs font-black text-black">{m.transactionNo}</td>
                        <td className="px-4 py-3 text-xs text-black">{m.gateEntryNo || "-"}</td>
                        <td className="px-4 py-3 text-xs text-black truncate max-w-[150px]">{getSupplierName(m.supplierId)}</td>
                        <td className="px-4 py-3 text-xs text-black whitespace-nowrap">{formatDate(m.date)}</td>
                        <td className="px-4 py-3 text-xs text-black font-bold uppercase">{m.mrrType || "OTHERS"}</td>
                        <td className="px-4 py-3 text-xs text-black font-mono">{invWt.toFixed(2)}</td>
                        <td className="px-4 py-3 text-xs text-black font-mono">{actWt.toFixed(2)}</td>
                        <td className={cn("px-4 py-3 text-xs font-mono font-bold", diff > 40 ? "text-red-600" : "text-black")}>
                          {diff.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-[10px] font-black uppercase text-black">
                          <span className="px-2 py-0.5 rounded border border-black bg-slate-100">{m.status}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight size={16} className={cn("transition-transform", selectedId === m.id ? "rotate-90" : "")} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Detail & Action Panel */}
        <div className="w-[450px] flex flex-col bg-white border border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden shrink-0">
          {!selectedMrr ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50">
              <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center mb-4">
                <Eye size={32} className="text-slate-400" />
              </div>
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-400">Select an MRR</h3>
              <p className="text-xs font-medium text-slate-400 mt-1 uppercase">to view details and perform actions</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-black bg-black text-white flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tighter">{selectedMrr.transactionNo}</h3>
                  <p className="text-[10px] font-bold uppercase opacity-70 mt-1">
                    {getSupplierName(selectedMrr.supplierId)} | {formatDate(selectedMrr.date)}
                  </p>
                </div>
                <button onClick={() => setSelectedId(null)} className="p-1 hover:bg-white/10 rounded">
                  <XCircle size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Summary Block */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 border border-black rounded">
                    <div className="text-[10px] font-black uppercase text-slate-500 mb-1">Invoice No</div>
                    <div className="text-sm font-bold text-black">{selectedMrr.invoiceNo}</div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-black rounded">
                    <div className="text-[10px] font-black uppercase text-slate-500 mb-1">Gate Entry</div>
                    <div className="text-sm font-bold text-black">{selectedMrr.gateEntryNo || "-"}</div>
                  </div>
                </div>

                {/* Weight Totals */}
                <div className="border border-black rounded overflow-hidden">
                  <div className="bg-slate-100 px-3 py-2 text-[10px] font-black uppercase border-b border-black">Weight Summary</div>
                  <div className="p-3 grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Invoice</div>
                      <div className="text-lg font-black font-mono">{totals.invoiceWeight.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Actual</div>
                      <div className="text-lg font-black font-mono">{totals.actualWeight.toFixed(2)}</div>
                    </div>
                    <div className={cn(totals.diff > 40 ? "bg-red-50 -m-3 p-3 border-l border-black" : "")}>
                      <div className="text-[10px] font-bold text-slate-500 uppercase">Difference</div>
                      <div className={cn("text-lg font-black font-mono", totals.diff > 40 ? "text-red-600" : "text-black")}>
                        {totals.diff.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {totals.diff > 40 && (
                    <div className="bg-red-600 text-white px-3 py-1.5 text-[10px] font-bold uppercase flex items-center gap-2">
                      <AlertCircle size={14} /> Critical shortage detected (&gt;40kg)
                    </div>
                  )}
                </div>

                {/* Line Details */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Item Details</h4>
                  {selectedMrr.lines.map((l, i) => (
                    <div key={i} className="p-3 border border-black rounded bg-white relative">
                      <div className="font-bold text-sm text-black mb-1">{getMaterialName(l.itemId)}</div>
                      <div className="grid grid-cols-2 gap-4 text-[11px]">
                        <div>
                          <span className="font-bold text-slate-500">Invoice:</span> {l.invoiceQty?.toFixed(2)} {l.uom}
                        </div>
                        <div>
                          <span className="font-bold text-slate-500">Actual:</span> {l.actualQty?.toFixed(2)} {l.uom}
                        </div>
                        <div>
                          <span className="font-bold text-slate-500">Rate:</span> ₹{l.invoiceRate?.toFixed(2)}
                        </div>
                        <div>
                          <span className="font-bold text-slate-500">Value:</span> ₹{l.actualValue?.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Packing Slips (Reels) */}
                {selectedMrr.mrrType === "Reel" && selectedMrrSlips.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reel Details ({selectedMrrSlips.length})</h4>
                    <div className="max-h-60 overflow-y-auto border border-black rounded">
                      <table className="min-w-full divide-y divide-black text-[10px]">
                        <thead className="bg-slate-50">
                          <tr className="divide-x divide-black">
                            <th className="px-2 py-1.5 text-left font-black uppercase">Our Reel No</th>
                            <th className="px-2 py-1.5 text-right font-black uppercase">Weight (KG)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black">
                          {selectedMrrSlips.map(s => (
                            <tr key={s.id} className="divide-x divide-black">
                              <td className="px-2 py-1.5 font-bold">{s.ourReelNo}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{Number(s.weightKg || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Previous Approval Remarks */}
                {(selectedMrr.plant_head_remark || selectedMrr.accounts_remark || selectedMrr.md_approval_remark) && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Previous Remarks</h4>
                    <div className="space-y-2">
                      {selectedMrr.plant_head_remark && (
                        <div className="text-[11px] p-2 border-l-2 border-emerald-500 bg-emerald-50">
                          <span className="font-black uppercase text-emerald-700">Plant Head:</span> {selectedMrr.plant_head_remark}
                        </div>
                      )}
                      {selectedMrr.accounts_remark && (
                        <div className="text-[11px] p-2 border-l-2 border-indigo-500 bg-indigo-50">
                          <span className="font-black uppercase text-indigo-700">Accounts:</span> {selectedMrr.accounts_remark}
                        </div>
                      )}
                      {selectedMrr.md_approval_remark && (
                        <div className="text-[11px] p-2 border-l-2 border-amber-500 bg-amber-50">
                          <span className="font-black uppercase text-amber-700">MD:</span> {selectedMrr.md_approval_remark}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Area */}
              <div className="p-4 border-t-2 border-black bg-slate-50 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {activeStage} Remark <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={remark}
                    onChange={e => setRemark(e.target.value)}
                    placeholder="Enter approval/rejection remark..."
                    className="w-full h-20 border border-black rounded p-2 text-sm outline-none focus:ring-1 focus:ring-black"
                  />
                </div>

                {isDebitNoteRequired && (
                  <div className="p-3 border-2 border-dashed border-red-500 bg-red-50 rounded space-y-3">
                    <div className="text-[10px] font-black uppercase text-red-600 flex items-center gap-2">
                      <AlertCircle size={14} /> Debit Note Required
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        type="text"
                        placeholder="Debit Note No."
                        value={debitNote}
                        onChange={e => setDebitNote(e.target.value)}
                        className="w-full border border-black rounded p-2 text-xs"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={debitNoteDate}
                          onChange={e => setDebitNoteDate(e.target.value)}
                          className="w-full border border-black rounded p-2 text-xs"
                        />
                        <input
                          type="number"
                          placeholder="Amount"
                          value={debitNoteAmount}
                          onChange={e => setDebitNoteAmount(e.target.value === "" ? "" : parseFloat(e.target.value))}
                          className="w-full border border-black rounded p-2 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleAction("Reject")}
                    disabled={isSubmitting}
                    className="flex items-center justify-center gap-2 py-3 border-2 border-black rounded bg-white text-black font-black uppercase tracking-widest text-xs hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    <XCircle size={18} /> Reject
                  </button>
                  <button
                    onClick={() => handleAction("Approve")}
                    disabled={isSubmitting}
                    className="flex items-center justify-center gap-2 py-3 border-2 border-black rounded bg-emerald-600 text-white font-black uppercase tracking-widest text-xs hover:bg-emerald-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? <Spinner size={18} className="text-white" /> : <><CheckCircle size={18} /> {activeStage === "Pending Tally" ? "Post Tally" : "Approve"}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

}
