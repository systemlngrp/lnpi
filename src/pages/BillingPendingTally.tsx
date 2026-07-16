import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { 
  Invoice, 
  InvoiceLineItem,
  Company,
  Item,
  LoadingSlip,
  DispatchPlan,
  Order
} from "../types";
import { 
  Search, 
  Receipt, 
  Calendar, 
  Building2,
  ChevronRight,
  ChevronDown,
  FileText,
  CheckCircle,
  Hash,
  Pencil
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { useAuth } from "../auth/AuthContext";
import { normalizeOrderItemSource } from "../lib/orderItems";

const formatInr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function BillingPendingTally() {
  const { user } = useAuth();
  const [invoices, setInvoices, isLoading] = useData<Invoice>("invoices", []);
  const [lineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [companies] = useData<Company>("companies", []);
  const { findItem, resolveOrderItem } = useOrderItemCatalog();
  const [slips] = useData<LoadingSlip>("loading_slips", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const currentUserEmail = String(user?.email || "").trim().toLowerCase();
  const canPostTally = currentUserEmail === "pankaj@bizskill.edu.com";
  const tableColumnCount = canPostTally ? 6 : 5;
  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const getInvoiceSlips = (invoiceId: string) =>
    slips.filter((slip) => slip.invoiceId === invoiceId && slip.status !== "Cancelled");

  const resolveDisplayUom = (itemSource: string | undefined, rawUom: string | undefined) => {
    const normalizedSource = normalizeOrderItemSource(itemSource);
    if (normalizedSource === "PHP" || normalizedSource === "PLATE") return "PCS";
    return String(rawUom || "").trim();
  };

  const buildSlipDerivedDetails = (invoiceId: string) => {
    const invoiceSlips = getInvoiceSlips(invoiceId);
    const rows: Array<{
      itemName: string;
      erp: string;
      uom: string;
      slipNo: string;
      qty: number;
      rate: number;
      amount: number;
    }> = [];

    invoiceSlips.forEach((slip) => {
      slip.lines.forEach((slipLine: any, index: number) => {
        const plan = dispatchPlans.find((dp) => dp.id === slipLine.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        const item = resolveOrderItem(order);
        const itemSource = normalizeOrderItemSource(order?.itemSource || slipLine.itemSource);
        const qty = Number(slipLine.loadedQty || 0);
        const rate = Number(order?.rate || 0);

        rows.push({
          itemName: item?.name || order?.poNumber || "Unknown",
          erp: String(order?.erpCode || (item as any)?.erp || "").trim(),
          uom: resolveDisplayUom(itemSource, String((item as any)?.uom || slipLine.uom || "").trim()),
          slipNo: slip.slipNo || `Slip ${index + 1}`,
          qty,
          rate,
          amount: qty * rate,
        });
      });
    });

    return rows;
  };

  const getPoNumbers = (invoiceId: string) => {
    const invoiceSlips = getInvoiceSlips(invoiceId);
    const poNums = new Set<string>();

    invoiceSlips.forEach((slip) => {
      slip.lines.forEach((slipLine: any) => {
        const plan = dispatchPlans.find((dp) => dp.id === slipLine.dispatchPlanId);
        const order = plan ? orders.find((o) => o.id === plan.orderId) : undefined;
        if (order?.poNumber) poNums.add(order.poNumber);
      });
    });

    return Array.from(poNums);
  };

  const processedInvoices = useMemo(() => {
    return invoices
      .filter(inv => !inv.tallyTimestamp)
      .map(inv => {
        const company = companies.find(c => c.id === inv.companyId);
        const invLines = lineItems.filter(li => li.invoiceId === inv.id);
        const invoiceSlips = getInvoiceSlips(inv.id);
        const poNumbers = getPoNumbers(inv.id);
        const details = invLines.length > 0
          ? invLines.map((li) => {
              const itemSource = normalizeOrderItemSource(li.itemSource);
              const item = findItem(itemSource, li.itemId);
              return {
                ...li,
                itemName: item?.name || "Unknown",
                erp: String(item?.erp || "").trim(),
                uom: resolveDisplayUom(itemSource, String(item?.uom || "").trim()),
                slipNo: slips.find((s) => s.id === li.loadingSlipId)?.slipNo || "N/A"
              };
            })
          : buildSlipDerivedDetails(inv.id);
        
        return {
          ...inv,
          companyName: company?.name || "Unknown",
          poNumbers,
          grandTotal: Number(inv.totalAfterGst || 0) + Number(inv.otherCharges || 0) + Number(inv.roundOff || 0),
          details,
          slipCount: invoiceSlips.length
        };
      })
      .filter(inv => {
        const searchStr = `${inv.invoiceNo} ${inv.companyName} ${inv.poNumbers.join(" ")}`.toLowerCase();
        return searchStr.includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, companies, lineItems, findItem, slips, dispatchPlans, orders, searchTerm]);

  const handleMarkPosted = async (id: string) => {
    if (!confirm("Mark this invoice as Posted to Tally?")) return;

    setProcessingId(id);
    try {
      const timestamp = new Date().toISOString();
      await setInvoices(prev => prev.map(inv => inv.id === id ? {
        ...inv,
        tallyTimestamp: timestamp,
        tallyBy: "System User",
        updateTimestamp: timestamp,
        updatedBy: "System User"
      } : inv));
    } catch (err) {
      alert("Failed to update invoice status.");
    } finally {
      setProcessingId(null);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Tally Posting</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border-2 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
          <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Total Pending Invoices</div>
          <div className="text-2xl font-black text-indigo-700">{processedInvoices.length}</div>
        </div>
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search invoice, company, PO number..." 
      />

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr className="divide-x divide-black">
              <th className="w-10 px-4 py-3 text-center"></th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">Invoice Details</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">Company</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase">PO Numbers</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase">Total Amount</th>
              {canPostTally ? (
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase">Action</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {processedInvoices.length === 0 ? (
              <tr>
                <td colSpan={tableColumnCount} className="px-6 py-12 text-center text-slate-500 italic">
                  {isLoading ? <Spinner /> : "No pending invoices for Tally posting."}
                </td>
              </tr>
            ) : (
              processedInvoices.map((inv) => (
                <React.Fragment key={inv.id}>
                  <tr className="hover:bg-slate-50 transition-colors divide-x divide-black">
                    <td className="px-4 py-4 text-center">
                      <button 
                        onClick={() => toggleRow(inv.id)}
                        className="p-1 hover:bg-slate-200 rounded transition"
                      >
                        {expandedRows.has(inv.id) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-sm flex items-center gap-2">
                        <Receipt size={14} className="text-indigo-600" />
                        {inv.invoiceNo}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">{formatDate(inv.date)}</div>
                    </td>
                    <td className="px-4 py-4 text-sm font-medium">{inv.companyName}</td>
                    <td className="px-4 py-4">
                      {inv.poNumbers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {inv.poNumbers.map((po, idx) => (
                            <span key={idx} className="bg-slate-100 border border-slate-300 px-2 py-0.5 rounded text-[10px] font-bold text-slate-700">
                              {po}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right font-black text-indigo-700">
                      {formatInr.format(inv.grandTotal)}
                    </td>
                    {canPostTally ? (
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            disabled={!!processingId}
                            onClick={() => handleMarkPosted(inv.id)}
                            className="bg-emerald-600 text-white px-4 py-1.5 rounded text-xs font-black uppercase hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50"
                          >
                            {processingId === inv.id ? <Spinner size={12} /> : <><CheckCircle size={14} /> Post</>}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  {expandedRows.has(inv.id) && (
                    <tr className="bg-slate-50">
                      <td colSpan={tableColumnCount} className="px-12 py-4">
                        <div className="border border-black rounded overflow-hidden">
                          <table className="min-w-full divide-y divide-black">
                            <thead className="sticky top-0 z-30 bg-slate-200">
                              <tr className="divide-x divide-black text-[10px] font-black uppercase">
                                <th className="px-3 py-2 text-left">Item Name</th>
                                <th className="px-3 py-2 text-left">ERP</th>
                                <th className="px-3 py-2 text-left">UOM</th>
                                <th className="px-3 py-2 text-left">Slip No</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-right">Rate</th>
                                <th className="px-3 py-2 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-black">
                              {inv.details.length === 0 ? (
                                <tr className="divide-x divide-black text-[11px]">
                                  <td colSpan={7} className="px-3 py-4 text-center text-slate-500 italic">
                                    No item breakup found for this invoice.
                                  </td>
                                </tr>
                              ) : (
                                inv.details.map((line: any, idx: number) => {
                                  const tax = (Number(line.cgst) || 0) + (Number(line.sgst) || 0) + (Number(line.igst) || 0);
                                  return (
                                    <tr key={idx} className="divide-x divide-black text-[11px]">
                                      <td className="px-3 py-2 font-bold uppercase">{line.itemName}</td>
                                      <td className="px-3 py-2">{line.erp || "-"}</td>
                                      <td className="px-3 py-2">{line.uom || "-"}</td>
                                      <td className="px-3 py-2">{line.slipNo}</td>
                                      <td className="px-3 py-2 text-right">{Number(line.qty || 0).toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right">{Number(line.rate || 0).toFixed(2)}</td>
                                      <td className="px-3 py-2 text-right font-bold">{formatInr.format(Number(line.amount || 0) + tax)}</td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
