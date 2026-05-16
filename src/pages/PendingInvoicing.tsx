import React, { useState, useMemo } from "react";
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
  Download,
  Building2,
  Package
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  const [, updateInvoices] = useData<Invoice>("invoices", []);
  const [, updateLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [billingMode, setBillingMode] = useState<string | null>(null); // companyId
  const [selectedSlips, setSelectedSlips] = useState<Set<string>>(new Set());
  
  const [invoiceModal, setInvoiceModal] = useState<{
    companyId: string;
    slips: any[];
  } | null>(null);
  
  const [itemRates, setInvoiceRates] = useState<Record<string, number>>({});
  const [gstRate, setGstRate] = useState<number>(18);
  const [isInterState, setIsInterState] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleCompany = (id: string) => {
    const next = new Set(expandedCompanies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedCompanies(next);
  };

  const groupedData = useMemo(() => {
    const uninvoiced = loadingSlips.filter(s => !s.invoiceId);
    
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
    
    // Initialize rates
    const initialRates: Record<string, number> = {};
    selected.forEach(s => {
      s.lines.forEach((l: any) => {
        const p = plans.find(pl => pl.id === l.dispatchPlanId);
        const o = orders.find(ord => ord.id === p?.orderId);
        if (o?.itemId && !initialRates[o.itemId]) {
          initialRates[o.itemId] = 0;
        }
      });
    });
    setInvoiceRates(initialRates);
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
    let totalBeforeGst = 0;
    invoiceItems.forEach(item => {
      const rate = itemRates[item.itemId] || 0;
      totalBeforeGst += item.qty * rate;
    });

    const taxAmount = (totalBeforeGst * gstRate) / 100;
    const cgst = isInterState ? 0 : taxAmount / 2;
    const sgst = isInterState ? 0 : taxAmount / 2;
    const igst = isInterState ? taxAmount : 0;
    const totalAfterGst = totalBeforeGst + taxAmount;

    return { totalBeforeGst, cgst, sgst, igst, totalAfterGst };
  }, [invoiceItems, itemRates, gstRate, isInterState]);

  const generatePDF = (invoice: Invoice, company: Company, lines: any[]) => {
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(20);
    doc.text("TAX INVOICE", 105, 20, { align: "center" });
    
    doc.setFontSize(10);
    doc.text(`Invoice No: ${invoice.invoiceNo}`, 14, 40);
    doc.text(`Date: ${formatDate(invoice.date)}`, 14, 45);
    
    // Company Details
    doc.setFontSize(12);
    doc.text("Bill To:", 14, 60);
    doc.setFontSize(10);
    doc.text(company.name, 14, 65);
    doc.text(company.address || "", 14, 70, { maxWidth: 80 });
    doc.text(`GSTIN: ${company.gstNo || "N/A"}`, 14, 85);

    // Table
    autoTable(doc, {
      startY: 95,
      head: [["Item", "Quantity", "Rate", "Amount"]],
      body: lines.map(l => [l.itemName, l.qty, l.rate.toFixed(2), l.amount.toFixed(2)]),
      foot: [
        ["Total Before GST", "", "", calculations.totalBeforeGst.toFixed(2)],
        ["CGST", "", "", calculations.cgst.toFixed(2)],
        ["SGST", "", "", calculations.sgst.toFixed(2)],
        ["IGST", "", "", calculations.igst.toFixed(2)],
        ["Grand Total", "", "", calculations.totalAfterGst.toFixed(2)]
      ],
      theme: "striped",
      headStyles: { fillColor: [79, 70, 229] }
    });

    doc.save(`${invoice.invoiceNo}.pdf`);
  };

  const handleSubmitInvoice = async () => {
    if (!invoiceModal) return;
    const company = companies.find(c => c.id === invoiceModal.companyId);
    if (!company) return;

    setIsSubmitting(true);
    try {
      const invoiceId = crypto.randomUUID();
      const newInvoice: Invoice = {
        id: invoiceId,
        invoiceNo: "", // Server generated
        date: new Date().toISOString().slice(0, 10),
        companyId: company.id,
        gstRate,
        ...calculations
      };

      // 1. Save Invoice
      await updateInvoices(prev => [...prev, newInvoice]);

      // 2. Save Line Items
      const lineItems: InvoiceLineItem[] = [];
      invoiceItems.forEach(item => {
        const rate = itemRates[item.itemId] || 0;
        // We link multiple slips to this invoice through line items
        // For simplicity in this UI, we map item-wise totals
        // but the prompt implies mapping to actual slips
        invoiceModal.slips.forEach(s => {
           const sItemQty = s.lines.reduce((sum: number, l: any) => {
             const p = plans.find(pl => pl.id === l.dispatchPlanId);
             const o = orders.find(ord => ord.id === p?.orderId);
             return o?.itemId === item.itemId ? sum + Number(l.loadedQty || 0) : sum;
           }, 0);
           
           if (sItemQty > 0) {
             lineItems.push({
               id: crypto.randomUUID(),
               invoiceId,
               loadingSlipId: s.id,
               itemId: item.itemId,
               qty: sItemQty,
               rate,
               amount: sItemQty * rate
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

      // 4. Generate PDF (using a dummy invoice no since it's server generated, 
      // in a real app we'd fetch the generated ID back)
      generatePDF({ ...newInvoice, invoiceNo: "DRAFT-INV" }, company, invoiceItems.map(i => ({
        ...i,
        rate: itemRates[i.itemId] || 0,
        amount: i.qty * (itemRates[i.itemId] || 0)
      })));

      setInvoiceModal(null);
      setBillingMode(null);
      setSelectedSlips(new Set());
    } catch (err) {
      console.error("Failed to generate invoice:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase text-slate-500">GST Rate (%)</label>
                  <select 
                    value={gstRate}
                    onChange={(e) => setGstRate(Number(e.target.value))}
                    className="w-full px-3 py-2 border-2 border-black rounded focus:outline-none"
                  >
                    <option value={0}>0% (Exempt)</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500">Type</label>
                  <div className="flex gap-2 mt-2">
                    <button 
                      onClick={() => setIsInterState(false)}
                      className={`flex-1 py-1 text-[10px] font-bold rounded border ${!isInterState ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'}`}
                    >
                      INTRA (CGST+SGST)
                    </button>
                    <button 
                      onClick={() => setIsInterState(true)}
                      className={`flex-1 py-1 text-[10px] font-bold rounded border ${isInterState ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300'}`}
                    >
                      INTER (IGST)
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase">Item</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase w-24">Quantity</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase w-32">Rate</th>
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
                        <td className="px-3 py-3 text-right text-sm font-medium">
                          {((itemRates[item.itemId] || 0) * item.qty).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black divide-y divide-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase">Total Before GST</td>
                      <td className="px-3 py-2 text-right text-xs">{calculations.totalBeforeGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    {!isInterState ? (
                      <>
                        <tr className="divide-x divide-black">
                          <td colSpan={3} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">CGST ({gstRate/2}%)</td>
                          <td className="px-3 py-2 text-right text-[10px] text-slate-500">{calculations.cgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="divide-x divide-black">
                          <td colSpan={3} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">SGST ({gstRate/2}%)</td>
                          <td className="px-3 py-2 text-right text-[10px] text-slate-500">{calculations.sgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </>
                    ) : (
                      <tr className="divide-x divide-black">
                        <td colSpan={3} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">IGST ({gstRate}%)</td>
                        <td className="px-3 py-2 text-right text-[10px] text-slate-500">{calculations.igst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )}
                    <tr className="divide-x divide-black bg-indigo-600 text-white border-t-2 border-black">
                      <td colSpan={3} className="px-3 py-3 text-right text-sm uppercase">Total Amount After GST</td>
                      <td className="px-3 py-3 text-right text-lg">{calculations.totalAfterGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
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
                  {isSubmitting ? <Spinner size={16} color="white" /> : (
                    <>
                      <Download size={18} />
                      Generate & Save Invoice
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
