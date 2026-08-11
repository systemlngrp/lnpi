import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Company, Material, MaterialIn, MaterialInPackingSlip, Service, Setting, Supplier } from "../types";
import { formatDate } from "../lib/serial";
import { ChevronDown, ChevronRight, Search, Trash2, Download, QrCode } from "lucide-react";
import { Select } from "../components/Select";
import { ExcelExport } from "../components/ExcelExport";
import { useNpdItems } from "../hooks/useNpdItems";
import { normalizeMaterialInRecord, recalculateMaterialLine } from "../lib/materialInTaxes";
import { downloadMaterialInPdf } from "../lib/materialInPdf";
import { downloadMrrReelLabelsPdf } from "../lib/mrrReelLabelsPdf";

function makeOptions(values: Array<string | number>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}
export function MaterialInMaster() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);
  const [services] = useData<Service>("services", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [settings] = useData<Setting>("settings", []);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reelLabelMenuId, setReelLabelMenuId] = useState<string | null>(null);
  const [expandedItemRows, setExpandedItemRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [mrrFilter, setMrrFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const statusOptions = ["All", "Pending PH", "Pending Accounts", "Pending MD", "Pending Tally", "Completed"];
  const mrrOptions = useMemo(() => makeOptions(materialIn.map((entry) => entry.transactionNo)), [materialIn]);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIn(materialIn.filter((entry) => entry.id !== id));
    setDeletingId(null);
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

  const getSupplierName = (id: string) =>
    suppliers.find((supplier) => supplier.id === id)?.name ||
    companies.find((company) => company.id === id)?.name ||
    id;
  const formatMoney = (value?: number) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatText = (value?: string | number) => String(value || "").trim() || "-";
  const getGstTotal = (entry: MaterialIn) => Number(entry.totalCgst || 0) + Number(entry.totalSgst || 0) + Number(entry.totalIgst || 0);
  const getExpenseGstTotal = (entry: MaterialIn) => Number(entry.expenseCGST || 0) + Number(entry.expenseSGST || 0) + Number(entry.expenseIGST || 0);
  const getApprovalText = (timestamp?: string, user?: string) => [timestamp ? formatDate(timestamp) : "", user || ""].filter(Boolean).join(" / ") || "-";
  const toggleItemRow = (id: string) => {
    setExpandedItemRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getLineItemsSummary = (lines: MaterialIn["lines"] = []) => {
    const safeLines = Array.isArray(lines) ? lines : [];
    if (safeLines.length === 0) return "No items";
    const names = safeLines
      .slice(0, 2)
      .map((rawLine) => {
        const line = rawLine ? recalculateMaterialLine({ ...rawLine }) : null;
        if (!line) return "";
        return materials.find((item) => item.id === line.itemId)?.name || npdItems.find((item) => item.id === line.itemId)?.name || "Unknown";
      })
      .filter(Boolean);
    const suffix = safeLines.length > 2 ? ` + ${safeLines.length - 2} more` : "";
    return `${names.join(", ") || "Unknown"}${suffix}`;
  };

  const getMrrNoElement = (entry: MaterialIn, showInlineDetails = false) => {
    const isExpanded = expandedItemRows.has(entry.id);
  return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => toggleItemRow(entry.id)}
          className="inline-flex max-w-full items-center gap-2 text-left text-sm font-bold text-indigo-700 hover:text-indigo-900"
          aria-expanded={isExpanded}
          title={getLineItemsSummary(entry.lines)}
        >
          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span className="whitespace-nowrap">{entry.transactionNo}</span>
        </button>
        {showInlineDetails && isExpanded ? getLineItemsElement(entry.lines) : null}
      </div>
    );
  };
  const getLineItemsElement = (lines: MaterialIn["lines"] = []) => {
    const safeLines = Array.isArray(lines) ? lines : [];
  return (
      <ul className="list-none space-y-1">
        {safeLines.map((rawLine, idx) => {
          if (!rawLine) return null;
          const line = recalculateMaterialLine({ ...rawLine });
          const itemName = materials.find((item) => item.id === line.itemId)?.name || npdItems.find((item) => item.id === line.itemId)?.name;
  return (
            <li key={idx} className="border-b border-black pb-1 mb-1 last:border-0 last:pb-0 last:mb-0">
              <div className="font-medium text-black">{itemName || "Unknown"}</div>
              <div className="text-xs text-black">
                PO: {line.poNo || "-"} | PO Rate: {Number(line.poRate || 0).toFixed(2)} | Invoice: {Number(line.invoiceQty || 0).toFixed(2)} {line.uom} @ {Number(line.invoiceRate || line.rate || 0).toFixed(2)} = {Number(line.invoiceValue || 0).toFixed(2)} | Tax: CGST {Number(line.cgst || 0).toFixed(2)} / SGST {Number(line.sgst || 0).toFixed(2)} / IGST {Number(line.igst || 0).toFixed(2)} | Actual: {Number(line.actualQty || line.qty || 0).toFixed(2)} {line.uom} = {Number(line.actualValue || line.value || 0).toFixed(2)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const filteredMaterialIn = materialIn
    .map((entry) => normalizeMaterialInRecord(entry))
    .filter((entry) => {
      const supplierName = getSupplierName(entry.supplierId);
      const safeLines = Array.isArray(entry.lines) ? entry.lines : [];
      const itemNames = safeLines
        .map((line) => {
          if (!line) return "";
          return materials.find((item) => item.id === line.itemId)?.name || npdItems.find((item) => item.id === line.itemId)?.name || "";
        })
        .join(" ");

      const searchableParentText = [
        entry.transactionNo,
        entry.mrrType,
        entry.gateEntryNo,
        entry.invoiceNo,
        entry.invDate,
        entry.status,
        entry.debitNote,
        entry.debitNoteDate,
        entry.debitTallySync,
        entry.debitRemarkTally,
        entry.creditTallySync,
        entry.creditRemarkTally,
        entry.tallySyncRemark,
        entry.updatedBy,
        supplierName,
        itemNames,
      ].join(" ").toLowerCase();

      const matchesSearch = searchableParentText.includes(searchTerm.toLowerCase());

      const matchesMrr = !mrrFilter || entry.transactionNo === mrrFilter;
      const matchesStatus = statusFilter === "All" || entry.status === statusFilter;
      const receiptDate = entry.date || "";
      const matchesFromDate = !fromDate || receiptDate >= fromDate;
      const matchesToDate = !toDate || receiptDate <= toDate;

      return matchesSearch && matchesMrr && matchesStatus && matchesFromDate && matchesToDate;
    })
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.timestamp || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.timestamp || 0).getTime();
      return timeB - timeA;
    });

  const metrics = useMemo(
    () => ({
      total: filteredMaterialIn.length,
      totalInvoice: filteredMaterialIn.reduce((sum, row) => sum + Number(row.totalInvoiceValue || 0), 0),
      totalInvoiceAfterGst: filteredMaterialIn.reduce((sum, row) => sum + Number(row.totalInvoiceValueAfterGst || 0), 0),
      totalActual: filteredMaterialIn.reduce((sum, row) => sum + Number(row.totalActualValue || row.totalAmount || 0), 0),
      completed: filteredMaterialIn.filter((row) => row.status === "Completed").length,
    }),
    [filteredMaterialIn]
  );

  const excelRows = useMemo(() => filteredMaterialIn.map((entry) => ({
    "MRR No": entry.transactionNo,
    "MRR Type": formatText(entry.mrrType),
    Date: formatDate(entry.date),
    "Gate Entry No": formatText(entry.gateEntryNo),
    Supplier: getSupplierName(entry.supplierId),
    "Invoice No": formatText(entry.invoiceNo),
    "Invoice Date": entry.invDate ? formatDate(entry.invDate) : "-",
    Status: entry.status || "-",
    PH: getApprovalText(entry.phTimestamp, entry.phEmailId),
    Accounts: getApprovalText(entry.accTimestamp, entry.accEmailId),
    MD: getApprovalText(entry.mdTimestamp, entry.mdEmailId),
    Tally: entry.tallyTimestamp ? formatDate(entry.tallyTimestamp) : "-",
    "Invoice Value": Number(entry.totalInvoiceValue || 0),
    GST: Number(getGstTotal(entry) || 0),
    "Invoice After GST": Number(entry.totalInvoiceValueAfterGst || 0),
    "Actual Value": Number(entry.totalActualValue || entry.totalAmount || 0),
    Insurance: Number(entry.insurance || 0),
    "Other Charges": Number(entry.otherCharges || 0),
    "Expense GST": Number(getExpenseGstTotal(entry) || 0),
    "Round Off": Number(entry.roundOff || 0),
    "Total Amount": Number(entry.totalAmount || 0),
    "Debit Note No": formatText(entry.debitNote),
    "Debit Note Date": entry.debitNoteDate ? formatDate(entry.debitNoteDate) : "-",
    "Debit Amount": Number(entry.debitNoteAmount || 0),
    "Updated By": formatText(entry.updatedBy),
    "Updated At": entry.updateTimestamp ? formatDate(entry.updateTimestamp) : "-",
  })), [filteredMaterialIn, suppliers, companies]);
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Receipt Master</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Total Receipts</div>
          <div className="text-2xl font-black">{metrics.total}</div>
          <div className="text-[10px] font-bold mt-1 opacity-90">{metrics.completed} Fully Completed</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Actual Value</div>
          <div className="text-2xl font-black">{metrics.totalActual.toLocaleString()}</div>
          <div className="text-[10px] font-bold mt-1 opacity-90">Net Purchase Value</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Invoice Value</div>
          <div className="text-2xl font-black">{metrics.totalInvoice.toLocaleString()}</div>
          <div className="text-[10px] font-bold mt-1 opacity-90">Reported on Invoices</div>
        </div>
        <div className="bg-gradient-to-br from-rose-500 to-rose-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Invoice After GST</div>
          <div className="text-2xl font-black">{metrics.totalInvoiceAfterGst.toLocaleString()}</div>
          <div className="text-[10px] font-bold mt-1 opacity-90">Pre-tax plus GST</div>
        </div>
      </div>

      <div className="bg-slate-50 p-4 border border-black rounded shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase text-slate-500">From Date</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-3 py-1.5 border border-black rounded text-xs font-bold bg-white focus:outline-none focus:ring-1 focus:ring-black" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase text-slate-500">To Date</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-3 py-1.5 border border-black rounded text-xs font-bold bg-white focus:outline-none focus:ring-1 focus:ring-black" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase text-slate-500">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-1.5 border border-black rounded text-xs focus:outline-none focus:ring-1 focus:ring-black bg-white font-bold uppercase">
              {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-[10px] font-black uppercase text-slate-500">MRR No</label>
            <Select compact value={mrrFilter} onChange={setMrrFilter} options={mrrOptions} placeholder="All MRR" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] font-black uppercase text-slate-500">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" placeholder="Search transaction, supplier..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-1.5 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-xs font-bold" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {(fromDate || toDate || statusFilter !== "All" || mrrFilter || searchTerm) && (
              <button
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                  setStatusFilter("All");
                  setMrrFilter("");
                  setSearchTerm("");
                }}
                className="text-[10px] font-black uppercase text-red-600 hover:text-red-800 underline"
              >
                Reset
              </button>
            )}
            <ExcelExport data={excelRows} fileName="Material_Receipt_Master" sheetName="MR Master" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="block md:hidden space-y-4 p-2">
          {filteredMaterialIn.map((entry) => (
            <div key={entry.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
              <div className="flex justify-between items-start gap-3">
                {getMrrNoElement(entry, true)}
                <span className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${entry.status === "Completed" ? "bg-emerald-100 text-emerald-900 border-emerald-900" : "bg-amber-100 text-amber-900 border-amber-900"}`}>
                  {entry.status}
                </span>
              </div>
              <div className="text-xs font-black text-slate-500 uppercase">Date / Supplier</div>
              <div className="text-sm">{formatDate(entry.date)} | {getSupplierName(entry.supplierId)}</div>
              <div className="flex justify-between items-center mt-2 border-t border-slate-100 pt-2">
                <div className="text-right">
                  <div className="font-bold text-sm text-slate-500">Invoice: {Number(entry.totalInvoiceValue || 0).toLocaleString()}</div>
                  <div className="font-bold text-sm text-slate-500">Invoice After GST: {Number(entry.totalInvoiceValueAfterGst || 0).toLocaleString()}</div>
                  <div className="font-bold text-sm text-slate-500">
                    Insurance / Other: {Number(entry.insurance || 0).toLocaleString()} / {Number(entry.otherCharges || 0).toLocaleString()}
                  </div>
                  <div className="font-bold text-sm text-slate-500">
                    Expense GST: CGST {Number(entry.expenseCGST || 0).toLocaleString()} | SGST {Number(entry.expenseSGST || 0).toLocaleString()} | IGST {Number(entry.expenseIGST || 0).toLocaleString()}
                  </div>
                  <div className="font-bold text-sm text-slate-500">Actual: {Number(entry.totalActualValue || 0).toLocaleString()}</div>
                  <div className="font-bold text-lg text-indigo-700">Final Total: {Number(entry.totalAmount || 0).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => downloadPdf(entry)} className="text-indigo-700 hover:text-indigo-900 font-bold inline-flex items-center">
                    <Download size={16} className="mr-1" /> PDF
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setReelLabelMenuId((current) => (current === entry.id ? null : entry.id))}
                      disabled={entry.mrrType !== "Reel"}
                      className="text-indigo-700 hover:text-indigo-900 font-bold inline-flex items-center disabled:cursor-not-allowed disabled:opacity-40"
                      title={entry.mrrType === "Reel" ? "Reel Labels PDF" : "Reel Labels PDF (Reel MRR only)"}
                    >
                      <QrCode size={16} className="mr-1" /> Reel Labels
                    </button>
                    {reelLabelMenuId === entry.id ? (
                      <div className="absolute left-0 top-full z-20 mt-2 w-28 rounded border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <button
                          type="button"
                          onClick={async () => {
                            setReelLabelMenuId(null);
                            await downloadReelLabelsPdf(entry, "A4");
                          }}
                          className="block w-full border-b border-black px-3 py-2 text-left text-xs font-bold uppercase hover:bg-slate-100"
                        >
                          A4
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setReelLabelMenuId(null);
                            await downloadReelLabelsPdf(entry, "A3");
                          }}
                          className="block w-full px-3 py-2 text-left text-xs font-bold uppercase hover:bg-slate-100"
                        >
                          A3
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button onClick={() => handleDelete(entry.id)} className={`${deletingId === entry.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}>
                    <Trash2 size={16} className="mr-1" /> {deletingId === entry.id ? "Confirm?" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="hidden md:table min-w-[3200px] divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">MRR No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">MRR Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Gate Entry No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Invoice No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Invoice Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">PH</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Accounts</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">MD</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Tally</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Invoice Value</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">GST</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Invoice After GST</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Actual Value</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Insurance</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Other Charges</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Expense GST</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Round Off</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Total Amount</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Debit Note No</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Debit Note Date</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Debit Amount</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Updated By</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Updated At</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredMaterialIn.length === 0 ? (
                <tr>
                  <td colSpan={27} className="px-6 py-8 text-center text-black font-medium italic">No material receipt records found.</td>
                </tr>
              ) : (
                filteredMaterialIn.map((entry) => (
                  <React.Fragment key={entry.id}>
                  <tr className="hover:bg-slate-50 divide-x divide-black transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-black border border-black whitespace-nowrap">{getMrrNoElement(entry)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{formatText(entry.mrrType)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{formatText(entry.gateEntryNo)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black min-w-[180px]">{getSupplierName(entry.supplierId)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{formatText(entry.invoiceNo)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{entry.invDate ? formatDate(entry.invDate) : "-"}</td>
                    <td className="px-4 py-3 text-xs border border-black whitespace-nowrap">
                      <span className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${entry.status === "Completed" ? "bg-emerald-100 text-emerald-900 border-emerald-900" : "bg-amber-100 text-amber-900 border-amber-900"}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-black border border-black min-w-[160px]">{getApprovalText(entry.phTimestamp, entry.phEmailId)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black min-w-[180px]">
                      <div>{getApprovalText(entry.accTimestamp, entry.accEmailId)}</div>
                      <div className="text-[11px] text-slate-500">{formatText(entry.accounts_remark)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-black border border-black min-w-[180px]">
                      <div>{getApprovalText(entry.mdTimestamp, entry.mdEmailId)}</div>
                      <div className="text-[11px] text-slate-500">{formatText(entry.md_approval_remark)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-black border border-black min-w-[180px]">
                      <div>{entry.tallyTimestamp ? formatDate(entry.tallyTimestamp) : "-"}</div>
                      <div className="text-[11px] text-slate-500">{formatText(entry.tallySyncRemark)}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.totalInvoiceValue)}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(getGstTotal(entry))}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.totalInvoiceValueAfterGst)}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.totalActualValue || entry.totalAmount)}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.insurance)}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.otherCharges)}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(getExpenseGstTotal(entry))}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.roundOff)}</td>
                    <td className="px-4 py-3 text-right text-xs font-black text-indigo-700 border border-black whitespace-nowrap">{formatMoney(entry.totalAmount)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{formatText(entry.debitNote)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{entry.debitNoteDate ? formatDate(entry.debitNoteDate) : "-"}</td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-black border border-black whitespace-nowrap">{formatMoney(entry.debitNoteAmount)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{formatText(entry.updatedBy)}</td>
                    <td className="px-4 py-3 text-xs text-black border border-black whitespace-nowrap">{entry.updateTimestamp ? formatDate(entry.updateTimestamp) : "-"}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium border border-black whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => downloadPdf(entry)} className="text-indigo-700 hover:text-indigo-900 font-bold inline-flex items-center min-w-[80px] justify-end">
                          <Download size={16} className="mr-1" /> PDF
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setReelLabelMenuId((current) => (current === entry.id ? null : entry.id))}
                            disabled={entry.mrrType !== "Reel"}
                            className="text-indigo-700 hover:text-indigo-900 font-bold inline-flex items-center min-w-[118px] justify-end disabled:cursor-not-allowed disabled:opacity-40"
                            title={entry.mrrType === "Reel" ? "Reel Labels PDF" : "Reel Labels PDF (Reel MRR only)"}
                          >
                            <QrCode size={16} className="mr-1" /> Reel Labels
                          </button>
                          {reelLabelMenuId === entry.id ? (
                            <div className="absolute right-0 top-full z-20 mt-2 w-28 rounded border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                              <button
                                type="button"
                                onClick={async () => {
                                  setReelLabelMenuId(null);
                                  await downloadReelLabelsPdf(entry, "A4");
                                }}
                                className="block w-full border-b border-black px-3 py-2 text-left text-xs font-bold uppercase hover:bg-slate-100"
                              >
                                A4
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setReelLabelMenuId(null);
                                  await downloadReelLabelsPdf(entry, "A3");
                                }}
                                className="block w-full px-3 py-2 text-left text-xs font-bold uppercase hover:bg-slate-100"
                              >
                                A3
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <button onClick={() => handleDelete(entry.id)} className={`${deletingId === entry.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}>
                          <Trash2 size={16} className="mr-1" /> {deletingId === entry.id ? "Confirm?" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedItemRows.has(entry.id) ? (
                    <tr className="bg-slate-50">
                      <td colSpan={27} className="px-4 py-3 border border-black">
                        <div className="rounded border border-slate-300 bg-white p-3 text-xs text-black">
                          {getLineItemsElement(entry.lines)}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

