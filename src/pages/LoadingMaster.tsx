import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { 
  LoadingSlip, 
  LoadingSlipAllocation,
  Truck, 
  DispatchPlan,
  Order,
  Company,
  Invoice,
  InvoiceLineItem,
  Setting
} from "../types";
import { 
  Search, 
  FileText, 
  Truck as TruckIcon, 
  ChevronDown,
  ChevronRight,
  Download
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { useNpdItems } from "../hooks/useNpdItems";
import { downloadLoadingSlipPdf } from "../lib/loadingSlipPdf";

export function LoadingMaster() {
  const [loadingSlips, setLoadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const npdItems = useNpdItems();
  const [companies] = useData<Company>("companies", []);
  const [invoices, setInvoices] = useData<Invoice>("invoices", []);
  const [invoiceLineItems, setInvoiceLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedSlipIds, setExpandedSlipIds] = useState<Set<string>>(new Set());
  const [editingSlipIds, setEditingSlipIds] = useState<Set<string>>(new Set());
  const [draftBySlipId, setDraftBySlipId] = useState<Record<string, LoadingSlip>>({});
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  const getTruckNo = (id: string) => trucks.find(t => t.id === id)?.truckNo || "Unknown";

  const processedSlips = useMemo(() => {
    return loadingSlips.map(slip => {
      const totalQty = slip.lines.reduce((sum, line) => sum + line.loadedQty, 0);
      
      // Extract aggregated info for the main table
      const uniqueItemNames = new Set<string>();
      const uniqueCompanies = new Set<string>();
      const uniqueErpCodes = new Set<string>();

      slip.lines.forEach(line => {
        const plan = plans.find(p => p.id === line.dispatchPlanId);
        const order = orders.find(o => o.id === plan?.orderId);
        const item = npdItems.find(i => i.id === order?.itemId);
        const company = companies.find(c => c.id === order?.companyId);
        
        if (item?.name) uniqueItemNames.add(item.name);
        if (company?.name) uniqueCompanies.add(company.name);
        if (item?.erpCode) uniqueErpCodes.add(item.erpCode);
      });

      return {
        ...slip,
        totalQty,
        itemNames: Array.from(uniqueItemNames).join(", "),
        companyNames: Array.from(uniqueCompanies).join(", "),
        erpCodes: Array.from(uniqueErpCodes).join(", ")
      };
    }).filter(slip => {
      const q = searchTerm.toLowerCase();
      return (
        slip.slipNo.toLowerCase().includes(q) ||
        slip.itemNames.toLowerCase().includes(q) ||
        slip.companyNames.toLowerCase().includes(q) ||
        slip.erpCodes.toLowerCase().includes(q)
      );
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [loadingSlips, plans, orders, npdItems, companies, searchTerm]);

  const handleDownloadPdf = async (slip: LoadingSlip) => {
    setIsDownloading(slip.id);
    try {
      const orgSetting = settings[0];
      await downloadLoadingSlipPdf({
        slip,
        setting: orgSetting,
        trucks,
        plans,
        orders,
        npdItems,
        companies
      });
    } catch (err) {
      console.error("Failed to download PDF:", err);
      alert("Failed to generate PDF. Please check console for details.");
    } finally {
      setIsDownloading(null);
    }
  };

  const getSlipLines = (slip: LoadingSlip) =>
    slip.lines.map((line) => {
      const plan = plans.find((p) => p.id === line.dispatchPlanId);
      const order = orders.find((o) => o.id === plan?.orderId);
      const item = npdItems.find((i) => i.id === order?.itemId);
      const company = companies.find((c) => c.id === order?.companyId);
      const plannedQty = Number(plan?.plannedQty || 0);
      const cancelledQty = Number(plan?.canceledQty || 0);
      const maxAllowed = Math.max(0, plannedQty - cancelledQty);
      return {
        ...line,
        orderNo: order?.orderNo || "N/A",
        itemName: item?.name || "Unknown",
        companyName: company?.name || "Unknown",
        plannedQty,
        maxAllowed,
      };
    });

  const toggleSlip = (id: string) => {
    setExpandedSlipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (slip: LoadingSlip) => {
    if (slip.status === "Cancelled") {
      alert("Cancelled slip cannot be edited.");
      return;
    }
    if (slip.invoiceId) {
      const confirmed = window.confirm("This slip is invoiced. Editing will update the linked invoice totals. Continue?");
      if (!confirmed) return;
    }
    setEditingSlipIds((prev) => new Set(prev).add(slip.id));
    setDraftBySlipId((prev) => ({ ...prev, [slip.id]: JSON.parse(JSON.stringify(slip)) }));
    setExpandedSlipIds((prev) => new Set(prev).add(slip.id));
  };

  const cancelEdit = (slipId: string) => {
    setEditingSlipIds((prev) => {
      const next = new Set(prev);
      next.delete(slipId);
      return next;
    });
    setDraftBySlipId((prev) => {
      const next = { ...prev };
      delete next[slipId];
      return next;
    });
  };

  const getAllocationTotal = (allocations?: LoadingSlipAllocation[]) =>
    (allocations || []).reduce((sum, a) => sum + Number(a.qty || 0), 0);

  const validateSlipDraft = (draft: LoadingSlip) => {
    const errors: string[] = [];
    const lines = getSlipLines(draft);
    lines.forEach((line, index) => {
      const loadedQty = Number(line.loadedQty || 0);
      if (loadedQty < 0) errors.push(`Line ${index + 1}: Loaded qty cannot be negative.`);
      if (loadedQty > line.maxAllowed) errors.push(`Line ${index + 1}: Loaded qty cannot exceed ${line.maxAllowed}.`);
      const allocTotal = getAllocationTotal(line.allocations);
      if (Math.abs(allocTotal - loadedQty) > 0.0001) errors.push(`Line ${index + 1}: Allocations must equal Loaded qty.`);
      (line.allocations || []).forEach((a) => {
        if (Number(a.qty || 0) < 0) errors.push(`Line ${index + 1}: Allocation qty cannot be negative.`);
      });
    });
    return errors;
  };

  const saveEdit = async (slipId: string) => {
    const original = loadingSlips.find((s) => s.id === slipId);
    const draft = draftBySlipId[slipId];
    if (!original || !draft) return;
    if (original.status === "Cancelled") {
      alert("Cancelled slip cannot be edited.");
      return;
    }

    const errors = validateSlipDraft(draft);
    if (errors.length > 0) {
      alert(errors[0]);
      return;
    }

    const now = new Date().toISOString();

    if (original.invoiceId) {
      const invoice = invoices.find((inv) => inv.id === original.invoiceId);
      if (!invoice) {
        alert("Linked invoice not found. Cannot save changes.");
        return;
      }
    }

    const originalByPlan = new Map(original.lines.map((l) => [l.dispatchPlanId, Number(l.loadedQty || 0)]));
    const draftByPlan = new Map(draft.lines.map((l) => [l.dispatchPlanId, Number(l.loadedQty || 0)]));
    const allPlanIds = new Set<string>([...originalByPlan.keys(), ...draftByPlan.keys()]);

    await setPlans((prev) =>
      prev.map((plan) => {
        if (!allPlanIds.has(plan.id)) return plan;
        const delta = (draftByPlan.get(plan.id) || 0) - (originalByPlan.get(plan.id) || 0);
        if (Math.abs(delta) < 0.0001) return plan;
        return { ...plan, loadedQty: Math.max(0, Number(plan.loadedQty || 0) + delta), updateTimestamp: now, updatedBy: "System User" };
      })
    );

    await setLoadingSlips((prev) =>
      prev.map((s) =>
        s.id === slipId ? { ...draft, updatedBy: "System User", updateTimestamp: now } : s
      )
    );

    if (original.invoiceId) {
      const invoiceId = original.invoiceId;
      const invoice = invoices.find((inv) => inv.id === invoiceId);
      if (!invoice) return;

      const isInterState = (companies.find((c) => c.id === invoice.companyId)?.gstSupplyType || "INTRA_STATE") === "INTER_STATE";

      const qtyByItemId = new Map<string, number>();
      draft.lines.forEach((line) => {
        const plan = plans.find((p) => p.id === line.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        if (!order?.itemId) return;
        qtyByItemId.set(order.itemId, (qtyByItemId.get(order.itemId) || 0) + Number(line.loadedQty || 0));
      });

      const hadSlipLineItems = invoiceLineItems.some((li) => li.invoiceId === invoiceId && li.loadingSlipId === slipId);

      const nextInvoiceLineItems = invoiceLineItems
        .map((li) => {
          if (li.invoiceId !== invoiceId || li.loadingSlipId !== slipId) return li;
          const nextQty = Number(qtyByItemId.get(li.itemId) || 0);
          const nextAmount = nextQty * Number(li.rate || 0);
          const taxAmount = (nextAmount * Number(li.gstRate || 0)) / 100;
          return {
            ...li,
            qty: nextQty,
            amount: nextAmount,
            cgst: isInterState ? 0 : taxAmount / 2,
            sgst: isInterState ? 0 : taxAmount / 2,
            igst: isInterState ? taxAmount : 0,
          };
        })
        .filter((li) => !(li.invoiceId === invoiceId && li.loadingSlipId === slipId && Number(li.qty || 0) <= 0));

      await setInvoiceLineItems(nextInvoiceLineItems);

      const allForInvoice = nextInvoiceLineItems.filter((li) => li.invoiceId === invoiceId);
      const totals = allForInvoice.reduce(
        (acc, li) => {
          acc.totalBeforeGst += Number(li.amount || 0);
          acc.cgst += Number(li.cgst || 0);
          acc.sgst += Number(li.sgst || 0);
          acc.igst += Number(li.igst || 0);
          return acc;
        },
        { totalBeforeGst: 0, cgst: 0, sgst: 0, igst: 0 }
      );

      const roundOff = Number(invoice.roundOff || 0);
      const nextTotalAfterGst = totals.totalBeforeGst + totals.cgst + totals.sgst + totals.igst + roundOff;

      await setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invoiceId
            ? {
                ...inv,
                totalBeforeGst: totals.totalBeforeGst,
                cgst: totals.cgst,
                sgst: totals.sgst,
                igst: totals.igst,
                totalAfterGst: nextTotalAfterGst,
                updatedBy: "System User",
                updateTimestamp: now,
              }
            : inv
        )
      );

      if (!hadSlipLineItems) {
        alert("Saved. Note: no existing invoice line items were found for this slip; invoice totals were recomputed from remaining items.");
      }
    }

    cancelEdit(slipId);
  };

  const cancelSlip = async (slip: LoadingSlip) => {
    if (slip.invoiceId) {
      alert("Cannot cancel a slip after invoice is created.");
      return;
    }
    if (slip.status === "Cancelled") return;

    const reason = window.prompt("Cancel reason (optional)") || "";
    const confirmed = window.confirm("Cancel this loading slip? This will reverse loaded qty from dispatch plans.");
    if (!confirmed) return;

    const now = new Date().toISOString();
    const byPlan = new Map(slip.lines.map((l) => [l.dispatchPlanId, Number(l.loadedQty || 0)]));

    await setPlans((prev) =>
      prev.map((plan) => {
        if (!byPlan.has(plan.id)) return plan;
        const qty = byPlan.get(plan.id) || 0;
        return { ...plan, loadedQty: Math.max(0, Number(plan.loadedQty || 0) - qty), updateTimestamp: now, updatedBy: "System User" };
      })
    );

    await setLoadingSlips((prev) =>
      prev.map((row) =>
        row.id === slip.id
          ? { ...row, status: "Cancelled", cancelReason: reason, cancelledAt: now, cancelledBy: "System User", updatedBy: "System User", updateTimestamp: now }
          : row
      )
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Loading Master</h2>
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search slip no..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Slip No</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Date</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Company</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Items (ERP)</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border-b border-black">Total Qty</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border-b border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {processedSlips.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500 italic">No loading slips found.</td>
              </tr>
            ) : processedSlips.map((slip) => (
              <tr key={slip.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <FileText size={16} className="text-indigo-600 mr-2" />
                    <span className="font-bold text-sm">{slip.slipNo}</span>
                    {slip.status === "Cancelled" ? (
                      <span className="ml-2 rounded border border-red-700 bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-800">
                        Cancelled
                      </span>
                    ) : slip.invoiceId ? (
                      <span className="ml-2 rounded border border-emerald-700 bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800">
                        Invoiced
                      </span>
                    ) : (
                      <span className="ml-2 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700">
                        Not Invoiced
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {formatDate(slip.date)}
                </td>
                <td className="px-6 py-4 text-sm text-black">
                  <div className="max-w-xs truncate font-medium" title={slip.companyNames}>
                    {slip.companyNames || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  <div className="max-w-md truncate" title={slip.itemNames}>
                    {slip.itemNames} <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">({slip.erpCodes})</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600">
                  {slip.totalQty.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex justify-end items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(slip)}
                      disabled={isDownloading === slip.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-indigo-600 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors uppercase disabled:opacity-50"
                      title="Download PDF"
                    >
                      {isDownloading === slip.id ? <Spinner size={14} /> : <Download size={14} />}
                      PDF
                    </button>
                    {slip.status !== "Cancelled" ? (
                      <button
                        type="button"
                        onClick={() => startEdit(slip)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-50 transition-colors uppercase"
                        title="Edit loading slip"
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSlip(slip.id)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-50 transition-colors uppercase"
                        title="Open slip details"
                      >
                        Open
                      </button>
                    )}
                    <button 
                      type="button"
                      onClick={() => toggleSlip(slip.id)}
                      className="text-indigo-600 hover:text-indigo-900 font-bold uppercase flex items-center justify-end gap-1"
                    >
                      {expandedSlipIds.has(slip.id) ? "Hide" : "Details"}{" "}
                      {expandedSlipIds.has(slip.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {processedSlips.map((slip) => {
              const isExpanded = expandedSlipIds.has(slip.id);
              if (!isExpanded) return null;
              const draft = draftBySlipId[slip.id] || slip;
              const isEditing = editingSlipIds.has(slip.id);
              const lines = getSlipLines(draft);
              return (
                <tr key={`${slip.id}-details`} className="bg-white">
                  <td colSpan={6} className="px-6 pb-6 pt-2 border-t border-black">
                    <div className="rounded border border-black overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3 border-b border-black">
                        <div className="text-sm font-bold text-black">
                          Slip {slip.slipNo} - Date {formatDate(slip.date)}
                        </div>
                        <div className="flex items-center gap-2">
                          {slip.status !== "Cancelled" ? (
                            isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void saveEdit(slip.id)}
                                  className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-emerald-600 text-white hover:bg-emerald-700"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelEdit(slip.id)}
                                  className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-100"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(slip)}
                                  className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-100"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void cancelSlip(slip)}
                                  className="px-3 py-1.5 text-xs font-bold border border-red-700 rounded bg-red-100 text-red-800 hover:bg-red-200"
                                >
                                  Cancel Slip
                                </button>
                              </>
                            )
                          ) : null}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-black border-collapse">
                          <thead className="bg-slate-100 divide-x divide-black">
                            <tr className="divide-x divide-black">
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Company</th>
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Order No</th>
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Item</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase border border-black">Planned</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase border border-black">Loaded</th>
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Allocations</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black bg-white">
                            {lines.map((line, idx) => {
                              const originalLine = slip.lines.find((l) => l.dispatchPlanId === line.dispatchPlanId);
                              const loadedValue = Number(line.loadedQty || 0);
                              const allocTotal = getAllocationTotal(line.allocations);
                              const balanced = Math.abs(allocTotal - loadedValue) < 0.0001;
                              return (
                                <tr key={`${slip.id}-${idx}`} className="divide-x divide-black">
                                  <td className="px-4 py-3 text-xs border border-black">{line.companyName}</td>
                                  <td className="px-4 py-3 text-xs border border-black">{line.orderNo}</td>
                                  <td className="px-4 py-3 text-xs border border-black">{line.itemName}</td>
                                  <td className="px-4 py-3 text-xs text-right border border-black">{Number(line.plannedQty || 0).toLocaleString()}</td>
                                  <td className="px-4 py-3 text-xs text-right border border-black">
                                    {isEditing ? (
                                      <input
                                        type="number"
                                        min={0}
                                        max={line.maxAllowed}
                                        value={loadedValue}
                                        onChange={(e) => {
                                          const next = e.target.value === "" ? 0 : Math.max(0, Math.min(Number(e.target.value), line.maxAllowed));
                                          setDraftBySlipId((prev) => {
                                            const draftSlip = prev[slip.id];
                                            if (!draftSlip) return prev;
                                            const nextSlip: LoadingSlip = JSON.parse(JSON.stringify(draftSlip));
                                            const lineToUpdate = nextSlip.lines.find((l) => l.dispatchPlanId === line.dispatchPlanId);
                                            if (lineToUpdate) lineToUpdate.loadedQty = next;
                                            return { ...prev, [slip.id]: nextSlip };
                                          });
                                        }}
                                        className="w-24 rounded border border-black bg-yellow-200 px-2 py-1 text-xs text-right font-bold"
                                      />
                                    ) : (
                                      <span className="font-bold text-indigo-700">{loadedValue.toLocaleString()}</span>
                                    )}
                                    {!balanced ? <div className="text-[10px] font-bold text-red-600">Alloc != Loaded</div> : null}
                                  </td>
                                  <td className="px-4 py-3 text-xs border border-black">
                                    {Array.isArray(line.allocations) && line.allocations.length > 0 ? (
                                      <div className="space-y-1">
                                        {line.allocations.map((a, aidx) => (
                                          <div key={aidx} className="flex items-center gap-2">
                                            <span className="font-bold">
                                              {a.sourceType === "job" ? a.jobNo : (a as any).sourceRef}
                                            </span>
                                            {isEditing ? (
                                              <input
                                                type="number"
                                                min={0}
                                                value={Number(a.qty || 0)}
                                                onChange={(e) => {
                                                  const nextQty = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
                                                  setDraftBySlipId((prev) => {
                                                    const draftSlip = prev[slip.id];
                                                    if (!draftSlip) return prev;
                                                    const nextSlip: LoadingSlip = JSON.parse(JSON.stringify(draftSlip));
                                                    const lineToUpdate = nextSlip.lines.find((l) => l.dispatchPlanId === line.dispatchPlanId);
                                                    if (lineToUpdate?.allocations?.[aidx]) lineToUpdate.allocations[aidx].qty = nextQty as any;
                                                    return { ...prev, [slip.id]: nextSlip };
                                                  });
                                                }}
                                                className="w-20 rounded border border-black bg-yellow-200 px-2 py-1 text-xs text-right font-bold"
                                              />
                                            ) : (
                                              <span className="text-slate-700">{Number(a.qty || 0).toLocaleString()}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
