import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Company, Material, MaterialIn, Item, Supplier } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { CheckCircle, XCircle, Search, FileText, ChevronRight, ArrowLeft, Edit2, Download } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNpdItems } from "../hooks/useNpdItems";

type Stage = "Pending PH" | "Pending Accounts" | "Pending MD";

export function MrrApprovals() {
  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  
  const [activeStage, setActiveStage] = useState<Stage>("Pending PH");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

  const getSupplierName = (id: string) => {
    const supplier = suppliers.find(s => s.id === id);
    if (supplier) return supplier.name;
    const company = companies.find(c => c.id === id);
    if (company) return company.name;
    return id;
  };

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
        const supplierName = getSupplierName(m.supplierId);
        const searchStr = `${m.transactionNo} ${m.gateEntryNo || ""} ${supplierName} ${m.invoiceNo}`.toLowerCase();
        return searchStr.includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => new Date(b.updateTimestamp || b.timestamp).getTime() - new Date(a.updateTimestamp || a.timestamp).getTime());
  }, [materialIn, activeStage, searchTerm, suppliers, companies]);

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
    if (action === "Reject" && !remark.trim()) {
      alert("Please provide a remark for rejection.");
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

        // Auto Debit Note Logic
        const totalMrrWeight = mrr.lines.reduce((s, l) => s + (l.actualQty || l.qty || 0), 0);
        const totalInvWeight = mrr.lines.reduce((s, l) => s + (l.invoiceQty || 0), 0);
        
        if (Math.abs(totalMrrWeight - totalInvWeight) > 0.01) {
           patch.debitNote = `DN-${mrr.transactionNo.split('-').pop()}`;
           patch.debitNoteDate = timestamp.split('T')[0];
           const weightDiff = totalInvWeight - totalMrrWeight;
           if (weightDiff > 0) {
             const avgRate = mrr.lines.reduce((s, l) => s + (l.invoiceRate || 0), 0) / mrr.lines.length;
             patch.debitNoteAmount = Number((weightDiff * avgRate).toFixed(2));
           }
        }
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
    if (!confirm(`Are you sure you want to approve ${selectedIds.length} MRRs?`)) return;
    for (const id of selectedIds) {
      await handleAction(id, "Approve");
    }
  };

  const downloadPdf = (mrr: MaterialIn) => {
    const doc = new jsPDF();
    const supplierName = getSupplierName(mrr.supplierId);
    
    doc.setFontSize(18);
    doc.text("MATERIAL RECEIPT", 105, 15, { align: "center" });
    
    doc.setFontSize(10);
    doc.text(`MRR No: ${mrr.transactionNo}`, 14, 25);
    doc.text(`Date: ${formatDate(mrr.date)}`, 14, 30);
    doc.text(`Supplier/Customer: ${supplierName || "N/A"}`, 14, 35);
    doc.text(`Invoice No: ${mrr.invoiceNo}`, 14, 40);
    
    const tableData = mrr.lines.map((l, i) => [
      i + 1,
      getItemSpecs(l, mrr.mrrType),
      l.actualQty || l.qty,
      l.uom,
      l.invoiceRate || l.rate,
      l.actualValue || l.value
    ]);

    autoTable(doc, {
      startY: 45,
      head: [["S.No", "Item Description", "Qty", "UOM", "Rate", "Amount"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [0, 0, 0], textColor: "white" }
    });

    doc.save(`MRR_${mrr.transactionNo}.pdf`);
  };

  const getItemSpecs = (line: MaterialIn["lines"][0], mrrType?: MaterialIn["mrrType"]) => {
    const isFgType = mrrType === "Rejection In" || mrrType === "FG Purchase";
    if (isFgType) {
      const item = npdItems.find(i => i.id === line.itemId);
      return item ? item.name : line.itemId;
    }
    const material = materials.find(m => m.id === line.itemId);
    if (!material) return line.itemId;
    const specs = [];
    if (material.size) specs.push(`Size: ${material.size} CM`);
    if (material.gsm) specs.push(`GSM: ${material.gsm}`);
    if (material.bf) specs.push(`BF: ${material.bf}`);
    const specStr = specs.join(" X ");
    return specStr ? `${material.name} - ${specStr}` : material.name;
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <div className="p-4 bg-white border-b border-black">
        <h1 className="text-3xl font-black text-indigo-700 uppercase tracking-tighter">Pending Approvals</h1>
      </div>

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

      <div className="flex-1 px-4 pb-20">
        <div className="bg-white border border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="bg-indigo-600 px-4 py-2 text-white font-black uppercase text-sm border-b border-black flex justify-between items-center">
            <span>{activeStage} ({filteredList.length})</span>
            <div className="flex items-center gap-2">
              <Search size={14} />
              <input 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-xs text-white placeholder:text-white/50 focus:outline-none focus:bg-white/20"
              />
            </div>
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
                  <th className="px-4 py-3 text-left">Supplier/Customer</th>
                  <th className="px-4 py-3 text-left min-w-[300px]">Items</th>
                  <th className="px-4 py-3 text-right">MRR Qty</th>
                  <th className="px-4 py-3 text-right">Inv Qty</th>
                  <th className="px-4 py-3 text-right">PO Rate</th>
                  <th className="px-4 py-3 text-right">Inv Rate</th>
                  <th className="px-4 py-3 text-right">GST%</th>
                  <th className="px-4 py-3 text-right">Basic Val</th>
                  <th className="px-4 py-3 text-center min-w-[220px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-sm">
                      No records found in this stage
                    </td>
                  </tr>
                ) : (
                  filteredList.map((m) => {
                    const linesToDisplay = m.lines;
                    
                    const mrrWeight = linesToDisplay.reduce((s, l) => s + (l.actualQty || l.qty || 0), 0);
                    const invWeight = linesToDisplay.reduce((s, l) => s + (l.invoiceQty || 0), 0);
                    const firstLine: Partial<MaterialIn["lines"][0]> = linesToDisplay[0] || {};
                    const basicValue = linesToDisplay.reduce((s, l) => s + (l.actualValue || l.value || 0), 0);

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
                        <td className="px-4 py-4 w-[170px] max-w-[170px] whitespace-normal break-words leading-snug">{getSupplierName(m.supplierId)}</td>
                        <td className="px-4 py-4 leading-relaxed">
                          {linesToDisplay.map((l, i) => (
                            <div key={i} className="mb-2 last:mb-0 border-b border-black/5 pb-1 last:border-0">
                              <div className="font-bold lowercase first-letter:uppercase">{getItemSpecs(l, m.mrrType)}</div>
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-4 text-right font-bold">{Number(mrrWeight || 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right font-bold">{Number(invWeight || 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right">{Number(firstLine.poRate || 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right">{Number(firstLine.invoiceRate || 0).toFixed(2)}</td>
                        <td className="px-4 py-4 text-right">{Number(firstLine.gstRate || 0)}%</td>
                        <td className="px-4 py-4 text-right font-black">{Number(basicValue || 0).toFixed(2)}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="grid grid-cols-2 gap-1">
                              <button 
                                onClick={() => downloadPdf(m)}
                                className="border border-black text-black py-1 rounded text-[9px] font-black hover:bg-slate-100 flex items-center justify-center gap-1"
                              >
                                <Download size={10} /> PDF
                              </button>
                              {activeStage === "Pending Accounts" && (
                                <button 
                                  onClick={() => navigate(`/material-in/form?edit=${m.id}`)}
                                  className="border border-indigo-600 text-indigo-600 py-1 rounded text-[9px] font-black hover:bg-indigo-50 flex items-center justify-center gap-1"
                                >
                                  <Edit2 size={10} /> EDIT
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                              <button 
                                disabled={!!isSubmitting}
                                onClick={() => handleAction(m.id, "Approve")}
                                className="border border-black text-black py-1 rounded text-[9px] font-black hover:bg-slate-100"
                              >
                                {isSubmitting === m.id ? <Spinner size={10} /> : "APPROVE"}
                              </button>
                              <button 
                                disabled={!!isSubmitting}
                                onClick={() => handleAction(m.id, "Reject")}
                                className="bg-red-600 text-white py-1 rounded text-[9px] font-black hover:bg-red-700"
                              >
                                REJECT
                              </button>
                            </div>
                            <textarea
                              value={remarks[m.id] || ""}
                              onChange={e => setRemarks(prev => ({ ...prev, [m.id]: e.target.value }))}
                              placeholder="Remark *"
                              className="w-full border border-black rounded p-1 text-[9px] uppercase outline-none focus:ring-1 focus:ring-indigo-600"
                            />
                          </div>
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
            Select All
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


