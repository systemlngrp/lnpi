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
  Package
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { MandatoryLabel, MandatoryLegend } from "../components/Mandatory";
import { isMandatoryField } from "../lib/mandatoryFields";

interface GroupedLoading {
  companyId: string;
  companyName: string;
  slips: (LoadingSlip & { 
    truckNo: string;
    totalQty: number;
    items: string[];
  })[];
}

export function PendingInvoicing() {
  const [loadingSlips, updateSlips] = useData<LoadingSlip>("loading_slips", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const [invoices, updateInvoices] = useData<Invoice>("invoices", []);
  const [, updateLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);
  const [billingMode, setBillingMode] = useState<string | null>(null); // companyId
  const [selectedSlips, setSelectedSlips] = useState<Set<string>>(new Set());
  
  const [invoiceModal, setInvoiceModal] = useState<{
    companyId: string;
    slips: any[];
  } | null>(null);
  
  const [itemRates, setInvoiceRates] = useState<Record<string, number>>({});
  const [itemGstRates, setItemGstRates] = useState<Record<string, number>>({});
  const [gstSupplyType, setGstSupplyType] = useState<"" | "INTRA_STATE" | "INTER_STATE">("");
  const [roundOff, setRoundOff] = useState<number | "">("");
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
      // Find company via the first line item's plan
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

  const handleOpenInvoiceForm = () => {
    if (!billingMode) return;
    const companyGroup = groupedData.find(g => g.companyId === billingMode);
    if (!companyGroup) return;
    
    const selected = companyGroup.slips.filter(s => selectedSlips.has(s.id));
    setInvoiceModal({ companyId: billingMode, slips: selected });
    
    // Initialize rates and gst rates
    const initialRates: Record<string, number> = {};
    const initialGstRates: Record<string, number> = {};
    selected.forEach(s => {
      s.lines.forEach((l: any) => {
        const p = plans.find(pl => pl.id === l.dispatchPlanId);
        const o = orders.find(ord => ord.id === p?.orderId);
        const item = items.find(i => i.id === o?.itemId);
        if (item && !initialRates[item.id]) {
          initialRates[item.id] = Number(o?.rate || 0);
          initialGstRates[item.id] = item.gstRate ?? 18;
        }
      });
    });
    setInvoiceRates(initialRates);
    setItemGstRates(initialGstRates);
    setRoundOff("");

    const company = companies.find(c => c.id === billingMode);
    setGstSupplyType((company?.gstSupplyType as any) || "INTRA_STATE");
  };

  const invoiceItems = useMemo(() => {
    if (!invoiceModal) return [];
    
    const itemTotals = new Map<string, { itemId: string; itemName: string; qty: number; slips: string[] }>();
    
    invoiceModal.slips.forEach(s => {
      s.lines.forEach((l: any) => {
        const p = plans.find(pl => pl.id === l.dispatchPlanId);
        const o = orders.find(ord => ord.id === p?.orderId);
        const item = items.find(i => i.id === o?.itemId);
        
        if (!item) return;
        
        if (!itemTotals.has(item.id)) {
          itemTotals.set(item.id, {
            itemId: item.id,
            itemName: item.name,
            qty: 0,
            slips: []
          });
        }
        
        const data = itemTotals.get(item.id)!;
        data.qty += Number(l.loadedQty || 0);
        data.slips.push(s.id);
      });
    });
    
    return Array.from(itemTotals.values());
  }, [invoiceModal, plans, orders, items]);

  const calculations = useMemo(() => {
    const isInterState = gstSupplyType === "INTER_STATE";
    let totalBeforeGst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    invoiceItems.forEach(item => {
      const rate = itemRates[item.itemId] || 0;
      const gRate = itemGstRates[item.itemId] || 0;
      const amount = item.qty * rate;
      totalBeforeGst += amount;

      const taxAmount = (amount * gRate) / 100;
      if (isInterState) {
        totalIgst += taxAmount;
      } else {
        totalCgst += taxAmount / 2;
        totalSgst += taxAmount / 2;
      }
    });

    const totalAfterGst = totalBeforeGst + totalCgst + totalSgst + totalIgst;
    const roundOffValue = roundOff === "" ? 0 : Number(roundOff || 0);
    const grandTotal = totalAfterGst + roundOffValue;

    return { totalBeforeGst, cgst: totalCgst, sgst: totalSgst, igst: totalIgst, totalAfterGst, roundOff: roundOffValue, grandTotal };
  }, [invoiceItems, itemRates, itemGstRates, gstSupplyType, roundOff]);

  const handleSubmitInvoice = async () => {
    if (!invoiceModal) return;
    const company = companies.find(c => c.id === invoiceModal.companyId);
    if (!company) return;
    if (isMandatoryField("invoice_form", "gstSupplyType") && !gstSupplyType) {
      alert("GST Supply Type is mandatory.");
      return;
    }

    const isInterState = gstSupplyType === "INTER_STATE";
    setIsSubmitting(true);
    try {
      const invoiceId = crypto.randomUUID();
      const newInvoice: Invoice = {
        id: invoiceId,
        invoiceNo: "", // Server generated
        date: new Date().toISOString().slice(0, 10),
        companyId: company.id,
        gstRate: 0, // No longer used as a single value
        totalBeforeGst: calculations.totalBeforeGst,
        cgst: calculations.cgst,
        sgst: calculations.sgst,
        igst: calculations.igst,
        totalAfterGst: calculations.grandTotal,
        roundOff: calculations.roundOff
      };

      // 1. Save Invoice
      await updateInvoices(prev => [...prev, newInvoice]);

      let savedInvoice = invoices.find((invoice) => invoice.id === invoiceId);
      if (!savedInvoice) {
        const response = await fetch("/api/invoices");
        if (response.ok) {
          const latestInvoices: Invoice[] = await response.json();
          savedInvoice = latestInvoices.find((invoice) => invoice.id === invoiceId);
        }
      }

      // 2. Save Line Items
      const lineItems: InvoiceLineItem[] = [];
      invoiceItems.forEach(item => {
        const rate = itemRates[item.itemId] || 0;
        const gRate = itemGstRates[item.itemId] || 0;
        
        invoiceModal.slips.forEach(s => {
           const sItemQty = s.lines.reduce((sum: number, l: any) => {
             const p = plans.find(pl => pl.id === l.dispatchPlanId);
             const o = orders.find(ord => ord.id === p?.orderId);
             return o?.itemId === item.itemId ? sum + Number(l.loadedQty || 0) : sum;
           }, 0);
           
           if (sItemQty > 0) {
             const amount = sItemQty * rate;
             const taxAmount = (amount * gRate) / 100;
             lineItems.push({
               id: crypto.randomUUID(),
               invoiceId,
               loadingSlipId: s.id,
               itemId: item.itemId,
               qty: sItemQty,
               rate,
               amount,
               gstRate: gRate,
               cgst: isInterState ? 0 : taxAmount / 2,
               sgst: isInterState ? 0 : taxAmount / 2,
               igst: isInterState ? taxAmount : 0
             });
           }
        });
      });
      
      for (const li of lineItems) {
        await updateLineItems(prev => [...prev, li]);
      }

      // 3. Update Loading Slips
      await updateSlips(prev => prev.map(s => {
        if (invoiceModal.slips.some(os => os.id === s.id)) {
          return { ...s, invoiceId };
        }
        return s;
      }));

      setInvoiceModal(null);
      setBillingMode(null);
      setSelectedSlips(new Set());
    } catch (err) {
      console.error("Failed to generate invoice:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isInterState = gstSupplyType === "INTER_STATE";

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
          <div className="bg-white w-full max-w-3xl border-2 border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <Receipt size={20} />
                <h3 className="font-bold uppercase tracking-tight">Invoice Form - {companies.find(c => c.id === invoiceModal.companyId)?.name}</h3>
              </div>
              <button onClick={() => setInvoiceModal(null)} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              <MandatoryLegend />
              <div className="bg-slate-50 p-4 border border-black rounded space-y-2">
                <MandatoryLabel
                  label="GST Supply Type"
                  required={isMandatoryField("invoice_form", "gstSupplyType")}
                  className="font-bold uppercase text-xs"
                />
                <select
                  value={gstSupplyType}
                  onChange={(e) => setGstSupplyType(e.target.value as "" | "INTRA_STATE" | "INTER_STATE")}
                  required={isMandatoryField("invoice_form", "gstSupplyType")}
                  disabled
                  className="w-full border-2 border-black rounded px-3 py-2 text-sm font-bold bg-white disabled:bg-slate-100 disabled:text-slate-700"
                >
                  <option value="" disabled>
                    Select GST Supply Type...
                  </option>
                  <option value="INTRA_STATE">INTRA_STATE (CGST+SGST)</option>
                  <option value="INTER_STATE">INTER_STATE (IGST)</option>
                </select>
                <div className="text-[11px] text-slate-600">Set in Companies Master.</div>
              </div>

              <div className="overflow-x-auto border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase">Item</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase w-20">Quantity</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase w-28">Rate</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase w-24">GST %</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {invoiceItems.map((item) => (
                      <tr key={item.itemId} className="divide-x divide-black">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Package size={14} className="text-slate-400" />
                            <span className="text-sm font-bold uppercase">{item.itemName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-sm">
                          {item.qty.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input 
                            type="number"
                            value={itemRates[item.itemId] || ""}
                            onChange={(e) => setInvoiceRates({
                              ...itemRates,
                              [item.itemId]: e.target.value === "" ? 0 : parseFloat(e.target.value)
                            })}
                            placeholder="0.00"
                            className="w-24 px-2 py-1 border-2 border-indigo-600 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-600 font-bold"
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <select 
                            value={itemGstRates[item.itemId] ?? 18}
                            onChange={(e) => setItemGstRates({
                              ...itemGstRates,
                              [item.itemId]: Number(e.target.value)
                            })}
                            className="w-20 px-1 py-1 border border-black rounded text-right text-xs"
                          >
                            <option value={0}>0%</option>
                            <option value={5}>5%</option>
                            <option value={12}>12%</option>
                            <option value={18}>18%</option>
                            <option value={28}>28%</option>
                          </select>
                        </td>
                        <td className="px-3 py-3 text-right text-sm font-medium">
                          {((itemRates[item.itemId] || 0) * item.qty).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black divide-y divide-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase">Total Before GST</td>
                      <td className="px-3 py-2 text-right text-xs">{calculations.totalBeforeGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    {!isInterState ? (
                      <>
                        <tr className="divide-x divide-black">
                          <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">Total CGST</td>
                          <td className="px-3 py-2 text-right text-[10px] text-slate-500">{calculations.cgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="divide-x divide-black">
                          <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">Total SGST</td>
                          <td className="px-3 py-2 text-right text-[10px] text-slate-500">{calculations.sgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </>
                    ) : (
                      <tr className="divide-x divide-black">
                        <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">Total IGST</td>
                        <td className="px-3 py-2 text-right text-[10px] text-slate-500">{calculations.igst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )}
                    <tr className="divide-x divide-black bg-indigo-600 text-white border-t-2 border-black">
                      <td colSpan={4} className="px-3 py-3 text-right text-sm uppercase">Total Amount After GST</td>
                      <td className="px-3 py-3 text-right text-lg">{calculations.totalAfterGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase">Round Off</td>
                      <td className="px-3 py-2 text-right text-xs">
                        <input
                          type="number"
                          step="0.01"
                          value={roundOff}
                          onChange={(e) => setRoundOff(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-28 px-2 py-1 border-2 border-black rounded text-right bg-white"
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                    <tr className="divide-x divide-black bg-emerald-700 text-white border-t-2 border-black">
                      <td colSpan={4} className="px-3 py-3 text-right text-sm uppercase tracking-wider">Grand Total</td>
                      <td className="px-3 py-3 text-right text-lg font-black">{calculations.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setInvoiceModal(null)}
                  className="px-6 py-2 border-2 border-black font-bold uppercase text-sm hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSubmitInvoice}
                  disabled={isSubmitting || calculations.totalBeforeGst <= 0}
                  className="px-6 py-2 bg-indigo-600 text-white border-2 border-black font-bold uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-700 transition disabled:opacity-50 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 active:shadow-none active:translate-x-1 active:translate-y-1 flex items-center gap-2"
                >
                  {isSubmitting ? <Spinner size={16} className="text-white" /> : (
                    <>
                      <Check size={18} />
                      Save Invoice
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
