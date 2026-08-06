import { Fragment, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Company, Material, MaterialIn, MaterialInPackingSlip, Service, Supplier, Setting } from "../types";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { Search, ChevronRight, ChevronDown, ArrowLeft, Download, QrCode, ArrowUp, ArrowDown, ThumbsUp, ThumbsDown, MessageSquareText, X } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { useNpdItems } from "../hooks/useNpdItems";
import { downloadMaterialInPdf } from "../lib/materialInPdf";
import { downloadMrrReelLabelsPdf } from "../lib/mrrReelLabelsPdf";
import { useNavigate } from "react-router-dom";

type Stage = "All MRR" | "Pending PH" | "Pending Accounts" | "Pending MD";
type SortField = "timestamp" | "gateEntryNo" | "transactionNo";
type SortDirection = "asc" | "desc";

export function MrrApprovals() {
  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [services] = useData<Service>("services", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [settings] = useData<Setting>("settings", []);
  
  const [activeStage, setActiveStage] = useState<Stage>("All MRR");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);
  const [reelLabelMenuId, setReelLabelMenuId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [openRemarkId, setOpenRemarkId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("transactionNo");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const getSeriesNumber = (value?: string) => {
    const suffix = String(value || "").trim().split("/").pop() || "";
    const parsed = Number(suffix);
    return Number.isFinite(parsed) ? parsed : -1;
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "timestamp" ? "desc" : "asc");
  };

  const renderSortIcon = (field: SortField) =>
    sortField === field ? (
      sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
    ) : (
      <ArrowDown size={12} className="opacity-40" />
    );

  const getSupplierName = (id: string) => {
    const supplier = suppliers.find(s => s.id === id);
    if (supplier) return supplier.name;
    const company = companies.find(c => c.id === id);
    if (company) return company.name;
    return id;
  };

  const stages: { label: string; value: Stage }[] = [
    { label: "All MRR", value: "All MRR" },
    { label: "Plant Head", value: "Pending PH" },
    { label: "Accounts", value: "Pending Accounts" },
    { label: "MD Approval", value: "Pending MD" },
  ];

  const approvalStatuses: Stage[] = ["Pending PH", "Pending Accounts", "Pending MD"];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    stages.forEach(s => {
      c[s.value] = s.value === "All MRR"
        ? materialIn.filter(m => approvalStatuses.includes(m.status as Stage)).length
        : materialIn.filter(m => m.status === s.value).length;
    });
    return c;
  }, [materialIn]);

  const filteredList = useMemo(() => {
    return materialIn
      .filter(m => activeStage === "All MRR" ? approvalStatuses.includes(m.status as Stage) : m.status === activeStage)
      .filter(m => {
        const supplierName = getSupplierName(m.supplierId);
        const searchStr = `${m.transactionNo} ${m.gateEntryNo || ""} ${supplierName} ${m.invoiceNo} ${m.mrrType || ""}`.toLowerCase();
        return searchStr.includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => {
        let comparison = 0;

        if (sortField === "gateEntryNo") {
          comparison = getSeriesNumber(a.gateEntryNo) - getSeriesNumber(b.gateEntryNo);
        } else if (sortField === "transactionNo") {
          comparison = getSeriesNumber(a.transactionNo) - getSeriesNumber(b.transactionNo);
        } else {
          comparison = new Date(a.updateTimestamp || a.timestamp).getTime() - new Date(b.updateTimestamp || b.timestamp).getTime();
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [materialIn, activeStage, searchTerm, suppliers, companies, sortField, sortDirection]);

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

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(expandedId => expandedId !== id) : [...prev, id]);
  };

  const handleAction = async (mrrId: string, action: "Approve" | "Reject") => {
    const mrr = materialIn.find(m => m.id === mrrId);
    if (!mrr) return;

    const currentStage = mrr.status as Stage;
    if (!["Pending PH", "Pending Accounts", "Pending MD"].includes(currentStage)) {
      alert(`No approval action is available for status ${mrr.status || "-"}.`);
      return;
    }

    const remark = remarks[mrrId] || "";
    if (action === "Reject" && !remark.trim()) {
      alert("Please provide a remark for rejection.");
      return;
    }

    setIsSubmitting(mrrId);
    const timestamp = new Date().toISOString();
    const email = currentStage === "Pending PH" ? "ph@lngrp.in" : 
                  currentStage === "Pending Accounts" ? "accounts@lngrp.in" : 
                  currentStage === "Pending MD" ? "md@lngrp.in" : "system@lngrp.in";

    let nextStatus: MaterialIn["status"] = mrr.status;
    const patch: Partial<MaterialIn> = { updateTimestamp: timestamp, updatedBy: email };

    if (action === "Approve") {
      if (currentStage === "Pending PH") {
        nextStatus = "Pending Accounts";
        patch.phTimestamp = timestamp;
        patch.phEmailId = email;
        patch.plant_head_remark = remark;
      }
      else if (currentStage === "Pending Accounts") {
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
      else if (currentStage === "Pending MD") {
        nextStatus = "Pending Tally";
        patch.mdTimestamp = timestamp;
        patch.mdEmailId = email;
        patch.md_approval_remark = remark;
      }
    } else {
      nextStatus = "Pending PH";
      if (currentStage === "Pending PH") patch.plant_head_remark = `REJECTED: ${remark}`;
      if (currentStage === "Pending Accounts") patch.accounts_remark = `REJECTED: ${remark}`;
      if (currentStage === "Pending MD") patch.md_approval_remark = `REJECTED: ${remark}`;
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
    const actionableIds = selectedIds.filter((id) => {
      const mrr = materialIn.find((m) => m.id === id);
      return mrr && ["Pending PH", "Pending Accounts", "Pending MD"].includes(mrr.status || "");
    });
    if (actionableIds.length === 0) {
      alert("No selected MRR is available for approval.");
      return;
    }
    if (!confirm(`Are you sure you want to approve ${actionableIds.length} MRRs?`)) return;
    for (const id of actionableIds) {
      await handleAction(id, "Approve");
    }
  };

  const downloadPdf = async (mrr: MaterialIn) => {
    await downloadMaterialInPdf({
      mrr,
      materials,
      npdItems,
      services,
      suppliers,
      companies,
      setting: settings[0] || null,
    });
  };

  const downloadReelLabelsPdf = async (mrr: MaterialIn, paperSize: "A4" | "A3" = "A4") => {
    if (mrr.mrrType !== "Reel") {
      alert("Reel Labels PDF is available only for Reel MRR.");
      return;
    }

    try {
      const result = await downloadMrrReelLabelsPdf({
        mrr,
        packingSlips,
        materials,
        suppliers,
        companies,
        setting: settings[0] || null,
        paperSize,
      });
      if (result.warnings.length > 0) {
        alert(`Generated ${result.count} labels with ${result.warnings.length} warning(s).`);
      }
    } catch (error) {
      console.error("Failed to generate reel labels PDF", error);
      alert(error instanceof Error ? error.message : "Failed to generate reel labels PDF.");
    }
  };

  const getMaterialSpecs = (material: Material) => {
    const specs = [];
    if (material.size) specs.push(`Size: ${material.size} CM`);
    if (material.gsm) specs.push(`GSM: ${material.gsm}`);
    if (material.bf) specs.push(`BF: ${material.bf}`);
    const specStr = specs.join(" X ");
    return specStr ? `${material.name} - ${specStr}` : material.name;
  };

  const getItemSpecs = (line: MaterialIn["lines"][0], mrrType?: MaterialIn["mrrType"]) => {
    const isServiceReturn = mrrType === "Service Return" || line.lineType === "Service";
    if (isServiceReturn) {
      const baseLabel = line.sourceGatePassItemDescription?.trim() || line.itemName?.trim() || line.itemId;
      const resolvedServiceName = services.find((service) => service.id === (line.serviceId || line.itemId))?.name?.trim() || line.serviceName?.trim();
      if (resolvedServiceName) {
        return `${baseLabel} (${resolvedServiceName})`;
      }
      return baseLabel;
    }

    const npdItem = npdItems.find(i => i.id === line.itemId);
    const material = materials.find(m => m.id === line.itemId);
    const isFgType = mrrType === "Rejection In" || mrrType === "FG Purchase";

    if (isFgType) {
      if (npdItem) return npdItem.name;
      if (material) return getMaterialSpecs(material);
      return line.itemName?.trim() || line.itemId;
    }

    if (material) return getMaterialSpecs(material);
    if (npdItem) return npdItem.name;
    return line.itemName?.trim() || line.itemId;
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
              <thead className="sticky top-0 z-30 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest">
                <tr className="divide-x divide-white/20">
                  <th className="px-2 py-3 text-center"></th>
                  <th className="px-2 py-3 text-center">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.length === filteredList.length && filteredList.length > 0}
                      onChange={toggleSelectAll}
                      className="accent-white h-4 w-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button
                      type="button"
                      onClick={() => toggleSort("gateEntryNo")}
                      className="inline-flex items-center gap-1 uppercase"
                    >
                      GE No
                      {renderSortIcon("gateEntryNo")}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button
                      type="button"
                      onClick={() => toggleSort("transactionNo")}
                      className="inline-flex items-center gap-1 uppercase"
                    >
                      MRR No
                      {renderSortIcon("transactionNo")}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">Supplier/Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">MRR Type</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Items</th>
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
                    <td colSpan={15} className="px-4 py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-sm">
                      No records found in this stage
                    </td>
                  </tr>
                ) : (
                  filteredList.map((m) => {
                    const linesToDisplay = m.lines;
                    const isExpanded = expandedIds.includes(m.id);
                    
                    const mrrWeight = linesToDisplay.reduce((s, l) => s + (l.actualQty || l.qty || 0), 0);
                    const invWeight = linesToDisplay.reduce((s, l) => s + (l.invoiceQty || 0), 0);
                    const firstLine: Partial<MaterialIn["lines"][0]> = linesToDisplay[0] || {};
                    const basicValue = linesToDisplay.reduce((s, l) => s + (l.actualValue || l.value || 0), 0);

                    return (
                      <Fragment key={m.id}>
                        <tr className="divide-x divide-black hover:bg-slate-50 transition-colors text-[11px] text-black font-medium uppercase">
                          <td className="px-2 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(m.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-black/20 bg-white hover:bg-slate-100"
                              aria-label={isExpanded ? "Collapse item details" : "Expand item details"}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
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
                          <td className="px-4 py-4 whitespace-nowrap font-bold">{m.status || "-"}</td>
                          <td className="px-4 py-4 whitespace-nowrap font-bold">{m.mrrType || "-"}</td>
                          <td className="px-4 py-4 whitespace-nowrap font-bold">{linesToDisplay.length} {linesToDisplay.length === 1 ? "item" : "items"}</td>
                          <td className="px-4 py-4 text-right font-bold">{Number(mrrWeight || 0).toFixed(2)}</td>
                          <td className="px-4 py-4 text-right font-bold">{Number(invWeight || 0).toFixed(2)}</td>
                          <td className="px-4 py-4 text-right">{Number(firstLine.poRate || 0).toFixed(2)}</td>
                          <td className="px-4 py-4 text-right">{Number(firstLine.invoiceRate || 0).toFixed(2)}</td>
                          <td className="px-4 py-4 text-right">{Number(firstLine.gstRate || 0)}%</td>
                          <td className="px-4 py-4 text-right font-black">{Number(basicValue || 0).toFixed(2)}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => downloadPdf(m)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded border border-black text-black hover:bg-slate-100"
                                title="Download PDF"
                                aria-label="Download PDF"
                              >
                                <Download size={14} />
                              </button>
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setReelLabelMenuId((current) => (current === m.id ? null : m.id))}
                                  disabled={m.mrrType !== "Reel"}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-black text-black hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  title={m.mrrType === "Reel" ? "Reel Labels PDF" : "Reel Labels PDF (Reel MRR only)"}
                                  aria-label="Reel Labels PDF"
                                >
                                  <QrCode size={14} />
                                </button>
                                {reelLabelMenuId === m.id ? (
                                  <div className="absolute right-0 top-9 z-40 w-28 rounded border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setReelLabelMenuId(null);
                                        await downloadReelLabelsPdf(m, "A4");
                                      }}
                                      className="block w-full border-b border-black px-3 py-2 text-left text-xs font-bold uppercase hover:bg-slate-100"
                                    >
                                      A4
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setReelLabelMenuId(null);
                                        await downloadReelLabelsPdf(m, "A3");
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-bold uppercase hover:bg-slate-100"
                                    >
                                      A3
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                disabled={!!isSubmitting || !["Pending PH", "Pending Accounts", "Pending MD"].includes(m.status || "")}
                                onClick={() => handleAction(m.id, "Approve")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded border border-emerald-700 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                title="Approve"
                                aria-label="Approve"
                              >
                                {isSubmitting === m.id ? <Spinner size={12} /> : <ThumbsUp size={14} />}
                              </button>
                              <button
                                type="button"
                                disabled={!!isSubmitting || !["Pending PH", "Pending Accounts", "Pending MD"].includes(m.status || "")}
                                onClick={() => handleAction(m.id, "Reject")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded border border-red-700 text-red-700 hover:bg-red-50 disabled:opacity-50"
                                title="Reject"
                                aria-label="Reject"
                              >
                                <ThumbsDown size={14} />
                              </button>
                              {["Pending PH", "Pending Accounts", "Pending MD"].includes(m.status || "") ? (
                                <div className="relative inline-flex">
                                  <button
                                    type="button"
                                    onClick={() => setOpenRemarkId((current) => current === m.id ? null : m.id)}
                                    className={cn(
                                      "relative inline-flex h-8 w-8 items-center justify-center rounded border border-black text-black hover:bg-indigo-50",
                                      remarks[m.id]?.trim() ? "bg-indigo-100 text-indigo-700" : "bg-white"
                                    )}
                                    title="Remark"
                                    aria-label="Open remark box"
                                  >
                                    <MessageSquareText size={14} />
                                    {remarks[m.id]?.trim() ? (
                                      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-white bg-indigo-600" />
                                    ) : null}
                                  </button>
                                  {openRemarkId === m.id ? (
                                    <div className="absolute right-0 top-9 z-40 w-56 rounded border border-black bg-white p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-[9px] font-black uppercase text-slate-600">Remark required for reject</span>
                                        <button
                                          type="button"
                                          onClick={() => setOpenRemarkId(null)}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded border border-black text-black hover:bg-slate-100"
                                          title="Close"
                                          aria-label="Close remark box"
                                        >
                                          <X size={12} />
                                        </button>
                                      </div>
                                      <textarea
                                        value={remarks[m.id] || ""}
                                        onChange={e => setRemarks(prev => ({ ...prev, [m.id]: e.target.value }))}
                                        placeholder="Remark *"
                                        className="h-20 w-full border border-black rounded p-1 text-[9px] uppercase outline-none focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="rounded border border-black bg-slate-50 px-2 py-2 text-center text-[9px] font-black uppercase text-slate-500">
                                  No approval action
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50 text-[11px] text-black uppercase">
                            <td colSpan={15} className="px-6 py-4">
                              <div className="space-y-2">
                                {linesToDisplay.map((l, i) => (
                                  <div key={i} className="rounded border border-black/10 bg-white px-3 py-2">
                                    <div className="font-bold">{getItemSpecs(l, m.mrrType)}</div>
                                    <div className="mt-1 text-[10px] font-medium text-slate-600">
                                      MRR Qty: {Number(l.actualQty || l.qty || 0).toFixed(2)} {l.uom || "-"} | Inv Qty: {Number(l.invoiceQty || 0).toFixed(2)} | PO Rate: {Number(l.poRate || 0).toFixed(2)} | Inv Rate: {Number(l.invoiceRate || 0).toFixed(2)} | GST: {Number(l.gstRate || 0)}%
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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



