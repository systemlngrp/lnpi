import React, { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../hooks/useData";
import { 
  LoadingSlip, 
  Company, 
  Item, 
  Invoice, 
  InvoiceLineItem,
  DispatchPlan,
  Order,
  Truck
} from "../types";
import {
  FileText, 
  Search, 
  Check, 
  X, 
  ChevronRight, 
  ChevronDown,
  Receipt,
  Building2,
  Package,
  Plus
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";

interface GroupedLoading {
  companyId: string;
  companyName: string;
  slips: (LoadingSlip & { 
    truckNo: string;
    totalQty: number;
    items: string[];
  })[];
}

interface InvoiceAllocationRow {
  id: string;
  orderId: string;
  qty: number;
}

interface InvoiceItemRow {
  id: string;
  itemId: string;
  gstRate: number;
  totalQty: number; // total qty from selected loading slips for this item
  sources: Array<{ loadingSlipId: string; qty: number }>;
  allocations: InvoiceAllocationRow[];
}

export function PendingInvoicing() {
  const [loadingSlips, updateSlips] = useData<LoadingSlip>("loading_slips", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const [invoices, updateInvoices] = useData<Invoice>("invoices", []);
  const [invoiceLineItems, updateLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);
  const [billingMode, setBillingMode] = useState<string | null>(null);
  const [selectedSlips, setSelectedSlips] = useState<Set<string>>(new Set());
  
  const [invoiceModal, setInvoiceModal] = useState<{
    companyId: string;
    slips: any[];
  } | null>(null);
  
  const [invoiceRows, setInvoiceRows] = useState<InvoiceItemRow[]>([]);
  const [gstSupplyType, setGstSupplyType] = useState<"" | "INTRA_STATE" | "INTER_STATE">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleCompany = (id: string) => {
    const next = new Set(expandedCompanies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedCompanies(next);
  };

  const groupedData = useMemo(() => {
    const uninvoiced = loadingSlips.filter((s) => !s.invoiceId && s.status !== "Cancelled");
    const companyMap = new Map<string, GroupedLoading>();

    uninvoiced.forEach(s => {
      const firstLine = s.lines[0];
      if (!firstLine) return;
      const plan = plans.find(p => p.id === firstLine.dispatchPlanId);
      const order = orders.find(o => o.id === plan?.orderId);
      const company = companies.find(c => c.id === order?.companyId);

      if (!company) return;

      if (!companyMap.has(company.id)) {
        companyMap.set(company.id, {
          companyId: company.id,
          companyName: company.name,
          slips: []
        });
      }

      const totalQty = s.lines.reduce((sum, l) => sum + Number(l.loadedQty || 0), 0);
      const truck = trucks.find(t => t.id === s.truckId);
      const slipItems = s.lines.map(l => {
        const lp = plans.find(p => p.id === l.dispatchPlanId);
        const lo = orders.find(o => o.id === lp?.orderId);
        return items.find(i => i.id === lo?.itemId)?.name || "Unknown";
      });

      companyMap.get(company.id)!.slips.push({
        ...s,
        truckNo: truck?.truckNo || "Unknown",
        totalQty,
        items: Array.from(new Set(slipItems))
      });
    });

    return Array.from(companyMap.values())
      .filter(g => g.companyName.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [loadingSlips, companies, plans, orders, trucks, items, searchTerm]);

  useEffect(() => {
    if (didInitExpand.current) return;
    if (groupedData.length === 0) return;
    didInitExpand.current = true;
    setExpandedCompanies(new Set(groupedData.map((group) => group.companyId)));
  }, [groupedData]);

  const handleStartBilling = (companyId: string, slips: any[]) => {
    setBillingMode(companyId);
    setSelectedSlips(new Set(slips.map(s => s.id)));
  };

  const handleToggleSlip = (id: string) => {
    const next = new Set(selectedSlips);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSlips(next);
  };

  const totalDispatchedByOrderId = useMemo(() => {
    const map = new Map<string, number>();
    invoiceLineItems.forEach(li => {
      const plan = plans.find(p => p.id === li.loadingSlipId); // Wait, loadingSlipId in li is actually dispatchPlanId in some contexts? 
      // Let's verify types.ts. In types.ts: loadingSlipId: string; itemId: string; qty: number;
      // In this project, invoice line items usually link to a loading slip.
      // But we need total dispatched for an ORDER.
      // Let's find all loading slips that are invoiced.
    });

    // Actually, we can get total dispatched from order objects if they are updated, 
    // or by summing all invoiced line items for that order.
    // Let's sum from loading slips that HAVE an invoiceId.
    const dispatchedMap = new Map<string, number>();
    loadingSlips.forEach(s => {
      if (!s.invoiceId || s.status === "Cancelled") return;
      s.lines.forEach(l => {
        const plan = plans.find(p => p.id === l.dispatchPlanId);
        if (plan?.orderId) {
          dispatchedMap.set(plan.orderId, (dispatchedMap.get(plan.orderId) || 0) + Number(l.loadedQty || 0));
        }
      });
    });
    return dispatchedMap;
  }, [loadingSlips, plans]);

  const handleOpenInvoiceForm = () => {
    if (!billingMode) return;
    const companyGroup = groupedData.find(g => g.companyId === billingMode);
    if (!companyGroup) return;
    
    const selected = companyGroup.slips.filter(s => selectedSlips.has(s.id));
    setInvoiceModal({ companyId: billingMode, slips: selected });
    
    const itemMap = new Map<string, InvoiceItemRow>();
    const itemOrderQtyMap = new Map<string, Map<string, number>>(); // itemId -> orderId -> qty

    selected.forEach((slip) => {
      slip.lines.forEach((line: any) => {
        const plan = plans.find((p) => p.id === line.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        const item = items.find((i) => i.id === order?.itemId);
        if (!order || !item) return;

        const qty = Number(line.loadedQty || 0);
        const gstRate = item.gstRate ?? 18;

        const existing = itemMap.get(item.id);
        if (existing) {
          existing.totalQty += qty;
          existing.sources.push({ loadingSlipId: slip.id, qty });
        } else {
          itemMap.set(item.id, {
            id: crypto.randomUUID(),
            itemId: item.id,
            gstRate,
            totalQty: qty,
            sources: [{ loadingSlipId: slip.id, qty }],
            allocations: [],
          });
        }

        const byOrder = itemOrderQtyMap.get(item.id) || new Map<string, number>();
        byOrder.set(order.id, (byOrder.get(order.id) || 0) + qty);
        itemOrderQtyMap.set(item.id, byOrder);
      });
    });

    // Seed allocations from slips' original orders
    itemMap.forEach((row, itemId) => {
      const byOrder = itemOrderQtyMap.get(itemId) || new Map<string, number>();
      const allocations: InvoiceAllocationRow[] = Array.from(byOrder.entries()).map(([orderId, qty]) => ({
        id: crypto.randomUUID(),
        orderId,
        qty,
      }));
      row.allocations = allocations.length ? allocations : [{ id: crypto.randomUUID(), orderId: "", qty: row.totalQty }];
    });

    setInvoiceRows(Array.from(itemMap.values()));

    const company = companies.find(c => c.id === billingMode);
    setGstSupplyType((company?.gstSupplyType as any) || "INTRA_STATE");
  };

  const handleAddRow = () => {
    alert("Rows are created from selected Loading Slips. Use 'Add Order' under an item to split quantities.");
  };

  const addAllocationRow = (itemRowId: string) => {
    setInvoiceRows((prev) =>
      prev.map((row) =>
        row.id === itemRowId
          ? (() => {
              const allocated = row.allocations.reduce((sum, a) => sum + Number(a.qty || 0), 0);
              const remaining = Math.max(0, Number(row.totalQty || 0) - allocated);
              return { ...row, allocations: [...row.allocations, { id: crypto.randomUUID(), orderId: "", qty: remaining }] };
            })()
          : row
      )
    );
  };

  const removeAllocationRow = (itemRowId: string, allocationId: string) => {
    setInvoiceRows((prev) =>
      prev.map((row) => {
        if (row.id !== itemRowId) return row;
        const next = row.allocations.length === 1 ? row.allocations : row.allocations.filter((a) => a.id !== allocationId);
        return { ...row, allocations: next };
      })
    );
  };

  const updateAllocation = (
    itemRowId: string,
    allocationId: string,
    patch: Partial<Pick<InvoiceAllocationRow, "orderId" | "qty">>
  ) => {
    setInvoiceRows((prev) =>
      prev.map((row) => {
        if (row.id !== itemRowId) return row;

        const nextAllocations = row.allocations.map((a) => (a.id === allocationId ? { ...a, ...patch } : a));

        // Clamp qty so that per-item allocated total never exceeds totalQty
        const totalQty = Number(row.totalQty || 0);
        const current = nextAllocations.find((a) => a.id === allocationId);
        if (current && patch.qty !== undefined) {
          const othersTotal = nextAllocations
            .filter((a) => a.id !== allocationId)
            .reduce((sum, a) => sum + Number(a.qty || 0), 0);
          const maxAllowed = Math.max(0, totalQty - othersTotal);
          const desired = Number(current.qty || 0);
          current.qty = Math.min(Math.max(0, desired), maxAllowed);
        }

        return { ...row, allocations: nextAllocations };
      })
    );
  };

  const updateItemGstRate = (itemRowId: string, gstRate: number) => {
    setInvoiceRows((prev) => prev.map((row) => (row.id === itemRowId ? { ...row, gstRate } : row)));
  };

  const calculations = useMemo(() => {
    const isInterState = gstSupplyType === "INTER_STATE";
    let totalBeforeGst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    invoiceRows.forEach((itemRow) => {
      itemRow.allocations.forEach((alloc) => {
        const order = orders.find((o) => o.id === alloc.orderId);
        if (!order) return;
        const rate = Number(order.rate || 0);
        const qty = Number(alloc.qty || 0);
        const amount = qty * rate;
        totalBeforeGst += amount;

        const taxAmount = (amount * itemRow.gstRate) / 100;
        if (isInterState) totalIgst += taxAmount;
        else {
          totalCgst += taxAmount / 2;
          totalSgst += taxAmount / 2;
        }
      });
    });

    const totalAfterGst = totalBeforeGst + totalCgst + totalSgst + totalIgst;
    // Nearest 0.5 rounding
    const roundedTotal = Math.round(totalAfterGst * 2) / 2;
    const roundOff = roundedTotal - totalAfterGst;

    return { 
      totalBeforeGst, 
      cgst: totalCgst, 
      sgst: totalSgst, 
      igst: totalIgst, 
      totalAfterGst, 
      roundOff, 
      grandTotal: roundedTotal 
    };
  }, [invoiceRows, gstSupplyType, orders]);

  const handleSubmitInvoice = async () => {
    if (!invoiceModal) return;
    const company = companies.find(c => c.id === invoiceModal.companyId);
    if (!company) return;

    const loadedByItemId = new Map<string, number>();
    const totalLoaded = invoiceModal.slips.reduce((sum, s) => 
      sum + s.lines.reduce((lSum: number, l: any) => {
        const qty = Number(l.loadedQty || 0);
        const plan = plans.find(p => p.id === l.dispatchPlanId);
        const order = orders.find(o => o.id === plan?.orderId);
        const itemId = String(order?.itemId || "").trim();
        if (itemId) loadedByItemId.set(itemId, (loadedByItemId.get(itemId) || 0) + qty);
        return lSum + qty;
      }, 0)
    , 0);
    const totalInvoicedNow = invoiceRows.reduce(
      (sum, itemRow) => sum + itemRow.allocations.reduce((s, a) => s + Number(a.qty || 0), 0),
      0
    );

    if (Math.abs(totalInvoicedNow - totalLoaded) > 0.01) {
      alert(`Total quantity in invoice (${totalInvoicedNow.toLocaleString()}) must match total loaded quantity (${totalLoaded.toLocaleString()}).`);
      return;
    }

    // Item-wise validation: allocations must match item total
    for (const itemRow of invoiceRows) {
      const allocTotal = itemRow.allocations.reduce((s, a) => s + Number(a.qty || 0), 0);
      if (Math.abs(allocTotal - Number(itemRow.totalQty || 0)) > 0.01) {
        const itemName = items.find((i) => i.id === itemRow.itemId)?.name || "Item";
        alert(
          `Item-wise quantity mismatch for ${itemName}.\nLoaded: ${Number(itemRow.totalQty || 0).toLocaleString()}\nAllocated: ${allocTotal.toLocaleString()}`
        );
        return;
      }
      if (itemRow.allocations.some((a) => !String(a.orderId || "").trim())) {
        const itemName = items.find((i) => i.id === itemRow.itemId)?.name || "Item";
        alert(`Please select Order for all allocation rows of ${itemName}.`);
        return;
      }
    }

    // Tolerance Check (per allocation row)
    const tolerancePercent = Math.min(company.toleranceAllowed || 0, 10);
    for (const itemRow of invoiceRows) {
      for (const alloc of itemRow.allocations) {
        const order = orders.find((o) => o.id === alloc.orderId);
        if (!order) continue;
        const totalDispatched = totalDispatchedByOrderId.get(order.id) || 0;
        const allowedMax = Number(order.qty || 0) * (1 + tolerancePercent / 100);
        const currentlyDispatched = totalDispatched + Number(alloc.qty || 0);
        if (currentlyDispatched > allowedMax + 0.01) {
          const itemName = items.find((i) => i.id === itemRow.itemId)?.name || "Item";
          alert(`Dispatched quantity for ${itemName} exceeds allowed tolerance (${tolerancePercent}%). Max allowed: ${allowedMax.toLocaleString()}`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      const invoiceId = crypto.randomUUID();
      const newInvoice: Invoice = {
        id: invoiceId,
        invoiceNo: "",
        date: new Date().toISOString().slice(0, 10),
        companyId: company.id,
        gstRate: 0,
        totalBeforeGst: calculations.totalBeforeGst,
        cgst: calculations.cgst,
        sgst: calculations.sgst,
        igst: calculations.igst,
        totalAfterGst: calculations.grandTotal,
        roundOff: calculations.roundOff
      };

      await updateInvoices(prev => [...prev, newInvoice]);

      const buildPool = (sources: Array<{ loadingSlipId: string; qty: number }>) =>
        sources.map((s) => ({ loadingSlipId: s.loadingSlipId, remaining: Number(s.qty || 0) }));

      const consumeFromPool = (pool: Array<{ loadingSlipId: string; remaining: number }>, need: number) => {
        const parts: Array<{ loadingSlipId: string; qty: number }> = [];
        let remainingNeed = Number(need || 0);
        for (const src of pool) {
          if (remainingNeed <= 0.0001) break;
          if (!src.loadingSlipId) continue;
          const take = Math.min(Math.max(0, src.remaining), remainingNeed);
          if (take <= 0.0001) continue;
          parts.push({ loadingSlipId: src.loadingSlipId, qty: take });
          src.remaining -= take;
          remainingNeed -= take;
        }
        if (remainingNeed > 0.0001) {
          const firstSlipId = invoiceModal.slips[0]?.id || "";
          if (firstSlipId) parts.push({ loadingSlipId: firstSlipId, qty: remainingNeed });
        }
        return parts;
      };

      const poolsByItemId = new Map<string, Array<{ loadingSlipId: string; remaining: number }>>();
      invoiceRows.forEach((row) => poolsByItemId.set(row.itemId, buildPool(row.sources || [])));

      const lineItems: InvoiceLineItem[] = [];
      for (const itemRow of invoiceRows) {
        const pool = poolsByItemId.get(itemRow.itemId) || buildPool(itemRow.sources || []);
        for (const alloc of itemRow.allocations) {
          const order = orders.find((o) => o.id === alloc.orderId);
          if (!order) continue;
          if (order.itemId !== itemRow.itemId) continue;
          const rate = Number(order.rate || 0);
          const parts = consumeFromPool(pool, Number(alloc.qty || 0));
          for (const part of parts) {
            const amount = part.qty * rate;
            const taxAmount = (amount * itemRow.gstRate) / 100;
            lineItems.push({
              id: crypto.randomUUID(),
              invoiceId,
              loadingSlipId: part.loadingSlipId,
              itemId: itemRow.itemId,
              qty: part.qty,
              rate,
              amount,
              gstRate: itemRow.gstRate,
              cgst: gstSupplyType === "INTER_STATE" ? 0 : taxAmount / 2,
              sgst: gstSupplyType === "INTER_STATE" ? 0 : taxAmount / 2,
              igst: gstSupplyType === "INTER_STATE" ? taxAmount : 0
            });
          }
        }
      }
      
      for (const li of lineItems) {
        await updateLineItems(prev => [...prev, li]);
      }

      await updateSlips(prev => prev.map(s => {
        if (invoiceModal.slips.some(os => os.id === s.id)) {
          return { ...s, invoiceId };
        }
        return s;
      }));

      setInvoiceModal(null);
      setBillingMode(null);
      setSelectedSlips(new Set());
      alert("Invoice generated successfully! Showing Pending Tally Posting...");
      // In a real app, we'd navigate to the Tally Posting view here.
    } catch (err) {
      console.error("Failed to generate invoice:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const format2 = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Invoicing</h2>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="space-y-4">
        {groupedData.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
            <Receipt className="mx-auto h-12 w-12 text-slate-300 mb-4" />
            <p className="text-slate-500 font-medium">No pending loading slips for invoicing.</p>
          </div>
        ) : groupedData.map((group) => (
          <div key={group.companyId} className="bg-white border border-black rounded shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100 border-b border-black">
              <div className="flex items-center gap-3">
                <Building2 size={20} className="text-indigo-600" />
                <span className="font-bold text-lg">{group.companyName}</span>
                <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase">
                  {group.slips.length} Loading Slips
                </span>
              </div>
              <div className="flex items-center gap-3">
                {billingMode === group.companyId ? (
                  <button 
                    onClick={handleOpenInvoiceForm}
                    disabled={selectedSlips.size === 0}
                    className="bg-emerald-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-emerald-700 transition shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px] disabled:opacity-50 disabled:shadow-none"
                  >
                    GENERATE INVOICE ({selectedSlips.size})
                  </button>
                ) : (
                  <button 
                    onClick={() => handleStartBilling(group.companyId, group.slips)}
                    className="bg-indigo-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-indigo-700 transition shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px]"
                  >
                    SELECT FOR INVOICING
                  </button>
                )}
                <button 
                  onClick={() => toggleCompany(group.companyId)}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  {expandedCompanies.has(group.companyId) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
              </div>
            </div>

            {expandedCompanies.has(group.companyId) && (
              <div className="p-4">
                <table className="min-w-full border-collapse border border-black">
                  <thead className="bg-slate-50">
                    <tr className="divide-x divide-black border-b border-black">
                      {billingMode === group.companyId && <th className="w-10 px-2 py-2"></th>}
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase">Slip No</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase">Date</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase">Truck</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase">Items</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase">Total Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {group.slips.map((s) => (
                      <tr key={s.id} className="divide-x divide-black hover:bg-slate-50">
                        {billingMode === group.companyId && (
                          <td className="px-2 py-2 text-center">
                            <input 
                              type="checkbox"
                              checked={selectedSlips.has(s.id)}
                              onChange={() => handleToggleSlip(s.id)}
                              className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-black rounded"
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs font-bold">{s.slipNo}</td>
                        <td className="px-3 py-2 text-xs">{formatDate(s.date)}</td>
                        <td className="px-3 py-2 text-xs">{s.truckNo}</td>
                        <td className="px-3 py-2 text-xs truncate max-w-[200px]">{s.items.join(", ")}</td>
                        <td className="px-3 py-2 text-xs text-right font-medium">{s.totalQty.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Invoice Modal */}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-[95vw] max-h-[95vh] border-2 border-black rounded shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <Receipt size={20} />
                <h3 className="font-bold uppercase tracking-tight">Invoice Form - {companies.find(c => c.id === invoiceModal.companyId)?.name}</h3>
              </div>
              <button onClick={() => setInvoiceModal(null)} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              <div className="overflow-x-auto border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Item Name</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase min-w-[200px]">Order No / PO No</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Order Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Dispatched</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Pending</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Rate</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase bg-indigo-50">DISPATCH NOW</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-20">GST %</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Amount</th>
                      <th className="px-3 py-2 text-center text-[10px] font-black uppercase w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {invoiceRows.flatMap((itemRow) => {
                      const itemName = items.find((i) => i.id === itemRow.itemId)?.name || "Item";
                      const pendingOrdersForItem = orders.filter((o) => {
                        if (o.companyId !== invoiceModal.companyId) return false;
                        if (o.status === "Cancelled") return false;
                        if (o.itemId !== itemRow.itemId) return false;
                        const dispatched = totalDispatchedByOrderId.get(o.id) || 0;
                        return Math.max(0, Number(o.qty || 0) - dispatched) > 0;
                      });

                      const parentRow = (
                        <tr key={itemRow.id} className="bg-slate-50 border-t-2 border-black">
                          <td colSpan={10} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              {(() => {
                                const allocatedTotal = itemRow.allocations.reduce((s, a) => s + Number(a.qty || 0), 0);
                                const remaining = Number(itemRow.totalQty || 0) - allocatedTotal;
                                return (
                              <div className="text-[11px] font-black uppercase">
                                {itemName}{" "}
                                <span className="text-slate-500 font-bold">
                                  | Total: {Number(itemRow.totalQty || 0).toLocaleString()} | Allocated: {allocatedTotal.toLocaleString()} | Remaining:{" "}
                                  <span className={cn("font-black", remaining < -0.001 ? "text-rose-700" : remaining > 0.001 ? "text-amber-700" : "text-emerald-700")}>
                                    {remaining.toLocaleString()}
                                  </span>
                                </span>
                              </div>
                                );
                              })()}
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="text-[10px] font-black uppercase text-slate-500">GST</div>
                                  <select
                                    value={itemRow.gstRate}
                                    onChange={(e) => updateItemGstRate(itemRow.id, Number(e.target.value))}
                                    className="w-20 px-2 py-1 border-2 border-black rounded text-[11px] font-bold"
                                  >
                                    {[0, 5, 12, 18, 28].map((v) => (
                                      <option key={v} value={v}>
                                        {v}%
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => addAllocationRow(itemRow.id)}
                                  className="px-3 py-1.5 bg-white border-2 border-black text-[10px] font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-none transition"
                                >
                                  + Add Order
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );

                      const childRows = itemRow.allocations.map((alloc) => {
                        const order = orders.find((o) => o.id === alloc.orderId);
                        const dispatched = order ? (totalDispatchedByOrderId.get(order.id) || 0) : 0;
                        const orderQty = order ? Number(order.qty || 0) : 0;
                        const pending = order ? Math.max(0, orderQty - dispatched) : 0;
                        const rate = order ? Number(order.rate || 0) : 0;
                        const amount = Number(alloc.qty || 0) * rate;
                        const otherAllocated = itemRow.allocations
                          .filter((a) => a.id !== alloc.id)
                          .reduce((s, a) => s + Number(a.qty || 0), 0);
                        const maxAllowed = Math.max(0, Number(itemRow.totalQty || 0) - otherAllocated);

                        return (
                          <tr key={alloc.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                            <td className="px-2 py-2">
                              <div className="text-[11px] font-bold uppercase truncate max-w-[220px]">{itemName}</div>
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={alloc.orderId}
                                onChange={(e) => updateAllocation(itemRow.id, alloc.id, { orderId: e.target.value })}
                                className="w-full border-2 border-black rounded p-1 text-[11px] font-bold focus:ring-0"
                              >
                                <option value="">-- Choose Order --</option>
                                {pendingOrdersForItem.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.orderNo} | {o.poNumber || "No PO"}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-right text-[11px] font-medium">{order ? orderQty.toLocaleString() : "-"}</td>
                            <td className="px-2 py-2 text-right text-[11px] font-medium text-slate-500">{order ? dispatched.toLocaleString() : "-"}</td>
                            <td className="px-2 py-2 text-right text-[11px] font-black text-indigo-700">{order ? pending.toLocaleString() : "-"}</td>
                            <td className="px-2 py-2 text-right text-[11px] font-bold">{order ? rate : "-"}</td>
                            <td className="px-2 py-2 text-right bg-indigo-50/30">
                              <input
                                type="number"
                                value={Number(alloc.qty || 0) || ""}
                                min={0}
                                max={maxAllowed}
                                onChange={(e) => updateAllocation(itemRow.id, alloc.id, { qty: e.target.value === "" ? 0 : parseFloat(e.target.value) })}
                                className="w-24 px-1 py-1 border-2 border-indigo-600 rounded text-right text-[11px] font-black focus:ring-0"
                              />
                            </td>
                            <td className="px-2 py-2 text-right text-[11px]">{itemRow.gstRate}%</td>
                            <td className="px-2 py-2 text-right text-[11px] font-black">{format2(amount)}</td>
                            <td className="px-2 py-2 text-center">
                              <button onClick={() => removeAllocationRow(itemRow.id, alloc.id)} className="text-rose-600 hover:text-rose-800">
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      });

                      return [parentRow, ...childRows];
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black divide-y divide-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase font-black">Total Before GST</td>
                      <td className="px-3 py-2 text-right text-[11px] font-black">{format2(calculations.totalBeforeGst)}</td>
                      <td></td>
                    </tr>
                    {gstSupplyType === "INTER_STATE" ? (
                       <tr className="divide-x divide-black text-slate-500">
                        <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total IGST</td>
                        <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.igst)}</td>
                        <td></td>
                      </tr>
                    ) : (
                      <>
                        <tr className="divide-x divide-black text-slate-500">
                          <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total CGST</td>
                          <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.cgst)}</td>
                          <td></td>
                        </tr>
                        <tr className="divide-x divide-black text-slate-500">
                          <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total SGST</td>
                          <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.sgst)}</td>
                          <td></td>
                        </tr>
                      </>
                    )}
                    <tr className="divide-x divide-black">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase italic text-slate-400">Round Off (to nearest 0.5)</td>
                      <td className="px-3 py-2 text-right text-[11px] text-slate-400">{format2(calculations.roundOff)}</td>
                      <td></td>
                    </tr>
                    <tr className="divide-x divide-black bg-slate-900 text-white">
                      <td colSpan={8} className="px-3 py-3 text-right text-xs uppercase tracking-widest font-black">Grand Total</td>
                      <td className="px-3 py-3 text-right text-lg font-black">{format2(calculations.grandTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              
              <div className="text-[11px] font-bold text-slate-600">
                Use <span className="font-black text-black">Add Order</span> on an item to split quantities across orders.
              </div>

              <div className="flex justify-between items-center bg-slate-50 p-4 border-t-2 border-black -mx-6 -mb-6 sticky bottom-0">
                <div className="text-[10px] font-bold text-slate-500 uppercase">
                   Loaded Total: <span className="text-black font-black">
                    {invoiceModal.slips.reduce((sum, s) => sum + s.lines.reduce((lSum: number, l: any) => lSum + Number(l.loadedQty || 0), 0), 0).toLocaleString()}
                   </span>
                </div>
                <div className="flex gap-3">
                    <button 
                    onClick={() => setInvoiceModal(null)}
                    className="px-8 py-3 border-2 border-black font-black uppercase text-xs tracking-widest hover:bg-white transition"
                    >
                    Cancel
                    </button>
                    <button 
                    onClick={handleSubmitInvoice}
                    disabled={isSubmitting || calculations.totalBeforeGst <= 0}
                    className="px-10 py-3 bg-indigo-600 text-white border-2 border-black font-black uppercase text-xs tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-700 transition disabled:opacity-50 disabled:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 flex items-center gap-2"
                    >
                    {isSubmitting ? <Spinner size={16} className="text-white" /> : (
                        <>
                        <Check size={18} />
                        Confirm & Save Invoice
                        </>
                    )}
                    </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
