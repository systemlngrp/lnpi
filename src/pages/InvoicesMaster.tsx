import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { 
  Invoice, 
  InvoiceLineItem,
  Company,
  Item,
  LoadingSlip
} from "../types";
import { 
  Search, 
  Receipt, 
  Calendar, 
  Building2,
  ChevronRight,
  ChevronDown,
  X,
  Download,
  FileText
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { ExcelExport } from "../components/ExcelExport";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function InvoicesMaster() {
  const [invoices] = useData<Invoice>("invoices", []);
  const [lineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [companies] = useData<Company>("companies", []);
  const [items] = useData<Item>("items", []);
  const [slips] = useData<LoadingSlip>("loading_slips", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const processedInvoices = useMemo(() => {
    return invoices.map(inv => {
      const company = companies.find(c => c.id === inv.companyId);
      const invLines = lineItems.filter(li => li.invoiceId === inv.id);
      const invItems = invLines.map(li => {
        const item = items.find(i => i.id === li.itemId);
        return item?.name || "Unknown";
      });
      
      return {
        ...inv,
        companyName: company?.name || "Unknown",
        address: company?.address || "",
        gstNo: company?.gstNo || "N/A",
        itemSummary: Array.from(new Set(invItems)).join(", "),
        details: invLines.map(li => ({
          ...li,
          itemName: items.find(i => i.id === li.itemId)?.name || "Unknown",
          slipNo: slips.find(s => s.id === li.loadingSlipId)?.slipNo || "N/A"
        }))
      };
    }).filter(inv => {
      return inv.invoiceNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
             inv.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
             inv.itemSummary.toLowerCase().includes(searchTerm.toLowerCase());
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, companies, lineItems, items, slips, searchTerm]);

  const invoiceDetails = useMemo(() => {
    if (!selectedInvoice) return [];
    return lineItems
      .filter(li => li.invoiceId === selectedInvoice.id)
      .map(li => {
        const item = items.find(i => i.id === li.itemId);
        const slip = slips.find(s => s.id === li.loadingSlipId);
        return {
          ...li,
          itemName: item?.name || "Unknown",
          slipNo: slip?.slipNo || "N/A"
        };
      });
  }, [selectedInvoice, lineItems, items, slips]);

  const downloadPDF = (invoice: any, lines: any[]) => {
    const doc = new jsPDF();
    const company = companies.find(c => c.id === invoice.companyId);
    
    doc.setFontSize(20);
    doc.text("TAX INVOICE", 105, 20, { align: "center" });
    
    doc.setFontSize(10);
    doc.text(`Invoice No: ${invoice.invoiceNo}`, 14, 40);
    doc.text(`Date: ${formatDate(invoice.date)}`, 14, 45);
    
    doc.setFontSize(12);
    doc.text("Bill To:", 14, 60);
    doc.setFontSize(10);
    doc.text(company?.name || "Unknown", 14, 65);
    doc.text(company?.address || "", 14, 70, { maxWidth: 80 });
    doc.text(`GSTIN: ${company?.gstNo || "N/A"}`, 14, 85);

    autoTable(doc, {
      startY: 95,
      head: [["Item", "Slip No", "Qty", "Rate", "GST %", "Tax", "Amount"]],
      body: lines.map(l => {
        const tax = (Number(l.cgst) || 0) + (Number(l.sgst) || 0) + (Number(l.igst) || 0);
        return [
          l.itemName, 
          l.slipNo, 
          l.qty, 
          Number(l.rate || 0).toFixed(2), 
          `${l.gstRate || 0}%`,
          tax.toFixed(2),
          (Number(l.amount) + tax).toFixed(2)
        ];
      }),
      foot: [
        ["Total Before GST", "", "", "", "", "", Number(invoice.totalBeforeGst || 0).toFixed(2)],
        ["CGST", "", "", "", "", "", Number(invoice.cgst || 0).toFixed(2)],
        ["SGST", "", "", "", "", "", Number(invoice.sgst || 0).toFixed(2)],
        ["IGST", "", "", "", "", "", Number(invoice.igst || 0).toFixed(2)],
        ["Grand Total", "", "", "", "", "", Number(invoice.totalAfterGst || 0).toFixed(2)]
      ],
      theme: "striped",
      headStyles: { fillColor: [79, 70, 229] }
    });

    doc.save(`${invoice.invoiceNo}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Billing Master</h2>
          <ExcelExport data={processedInvoices} fileName="Invoices_Master" />
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search invoice, company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="bg-slate-100">
            <tr className="divide-x divide-black">
              <th className="w-10 px-4 py-3"></th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Invoice / Company</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider">Items Summary</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Total Amount</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {processedInvoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500 italic">No invoices found.</td>
              </tr>
            ) : processedInvoices.map((inv) => (
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
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <div className="flex items-center">
                        <Receipt size={14} className="text-indigo-600 mr-2" />
                        <span className="font-bold text-sm">{inv.invoiceNo}</span>
                      </div>
                      <div className="flex items-center text-xs text-slate-500 mt-1">
                        <Building2 size={12} className="mr-1" />
                        {inv.companyName}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{formatDate(inv.date)}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-slate-600 line-clamp-2 max-w-xs uppercase font-medium">
                      {inv.itemSummary}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-700">
                    {inv.totalAfterGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => downloadPDF(inv, inv.details)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                        title="Download PDF"
                      >
                        <Download size={18} />
                      </button>
                      <button 
                        onClick={() => setSelectedInvoice(inv)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                        title="View Full Details"
                      >
                        <FileText size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedRows.has(inv.id) && (
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="px-12 py-4">
                      <div className="border-2 border-black rounded overflow-hidden shadow-sm">
                        <table className="min-w-full divide-y divide-black">
                          <thead className="bg-slate-200">
                            <tr className="divide-x divide-black">
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Item Name</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Slip No</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-24">Qty</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-24">Rate</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-20">GST %</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-32">Total</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-black">
                            {inv.details.map((line: any, idx: number) => {
                              const tax = (Number(line.cgst) || 0) + (Number(line.sgst) || 0) + (Number(line.igst) || 0);
                              return (
                                <tr key={idx} className="divide-x divide-black">
                                  <td className="px-3 py-2 text-xs font-bold uppercase">{line.itemName}</td>
                                  <td className="px-3 py-2 text-xs">{line.slipNo}</td>
                                  <td className="px-3 py-2 text-xs text-right">{line.qty.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-xs text-right">{Number(line.rate || 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 text-xs text-right">{line.gstRate}%</td>
                                  <td className="px-3 py-2 text-xs text-right font-bold">{(line.amount + tax).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invoice Details Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-4xl border-2 border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <Receipt size={20} />
                <h3 className="font-bold uppercase tracking-tight">Invoice: {selectedInvoice.invoiceNo}</h3>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 bg-slate-50 p-4 border border-black rounded">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Company</div>
                  <div className="font-bold">{companies.find(c => c.id === selectedInvoice.companyId)?.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Date</div>
                  <div className="font-bold">{formatDate(selectedInvoice.date)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Status</div>
                  <div className="font-bold text-emerald-600 uppercase text-xs">Generated</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Grand Total</div>
                  <div className="font-bold text-indigo-700 text-lg">
                    {selectedInvoice.totalAfterGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Item / Slip</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Qty</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Rate</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">GST %</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Tax</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {invoiceDetails.map((line, idx) => {
                      const tax = (line.cgst || 0) + (line.sgst || 0) + (line.igst || 0);
                      return (
                        <tr key={idx} className="divide-x divide-black">
                          <td className="px-4 py-3">
                            <div className="font-bold text-sm uppercase">{line.itemName}</div>
                            <div className="text-[10px] text-slate-500">Slip: {line.slipNo}</div>
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{line.qty.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm">{Number(line.rate || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-sm">{line.gstRate}%</td>
                          <td className="px-4 py-3 text-right text-sm">{tax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-3 text-right text-sm font-medium">{(line.amount + tax).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black divide-y divide-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-xs uppercase">Before GST</td>
                      <td className="px-4 py-2 text-right text-xs">{selectedInvoice.totalBeforeGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">CGST</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">{selectedInvoice.cgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">SGST</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">{selectedInvoice.sgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={5} className="px-4 py-2 text-right text-[10px] uppercase text-slate-500">IGST</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-500">{selectedInvoice.igst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr className="divide-x divide-black bg-indigo-600 text-white">
                      <td colSpan={5} className="px-4 py-3 text-right text-sm uppercase tracking-wider">Total Amount After GST</td>
                      <td className="px-4 py-3 text-right text-lg font-bold">
                        {selectedInvoice.totalAfterGst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => downloadPDF(selectedInvoice, invoiceDetails)}
                  className="px-6 py-2 border-2 border-black font-bold uppercase text-sm hover:bg-slate-100 transition flex items-center gap-2"
                >
                  <Download size={18} /> Download PDF
                </button>
                <button 
                  onClick={() => setSelectedInvoice(null)}
                  className="px-8 py-2 bg-slate-900 text-white border-2 border-black font-bold uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-black transition active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
