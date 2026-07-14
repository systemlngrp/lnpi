import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Setting, Supplier } from "../types";
import { formatDate } from "../lib/serial";
import { Trash2, Search } from "lucide-react";
import { useNpdItems } from "../hooks/useNpdItems";
import { normalizeMaterialInRecord, recalculateMaterialLine } from "../lib/materialInTaxes";

export function MaterialInMaster() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [settings] = useData<Setting>("settings", []);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const setting = settings[0];
  void setting;

  const statusOptions = ["All", "Pending PH", "Pending Accounts", "Pending MD", "Pending Tally", "Completed"];

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIn(materialIn.filter((entry) => entry.id !== id));
    setDeletingId(null);
  };

  const getSupplierName = (id: string) => suppliers.find((supplier) => supplier.id === id)?.name || id;

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
                PO: {line.poNo || "-"} | PO Rate: Rs {Number(line.poRate || 0).toFixed(2)} | Invoice: {Number(line.invoiceQty || 0).toFixed(2)} {line.uom} @ Rs {Number(line.invoiceRate || line.rate || 0).toFixed(2)} = Rs {Number(line.invoiceValue || 0).toFixed(2)} | Tax: CGST Rs {Number(line.cgst || 0).toFixed(2)} / SGST Rs {Number(line.sgst || 0).toFixed(2)} / IGST Rs {Number(line.igst || 0).toFixed(2)} | Actual: {Number(line.actualQty || line.qty || 0).toFixed(2)} {line.uom} = Rs {Number(line.actualValue || line.value || 0).toFixed(2)}
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

      const matchesSearch =
        (entry.transactionNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        itemNames.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === "All" || entry.status === statusFilter;
      const receiptDate = entry.date || "";
      const matchesFromDate = !fromDate || receiptDate >= fromDate;
      const matchesToDate = !toDate || receiptDate <= toDate;

      return matchesSearch && matchesStatus && matchesFromDate && matchesToDate;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material In Master</h2>
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
          <div className="text-2xl font-black">Rs {metrics.totalActual.toLocaleString()}</div>
          <div className="text-[10px] font-bold mt-1 opacity-90">Net Purchase Value</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Invoice Value</div>
          <div className="text-2xl font-black">Rs {metrics.totalInvoice.toLocaleString()}</div>
          <div className="text-[10px] font-bold mt-1 opacity-90">Reported on Invoices</div>
        </div>
        <div className="bg-gradient-to-br from-rose-500 to-rose-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest">Invoice After GST</div>
          <div className="text-2xl font-black">Rs {metrics.totalInvoiceAfterGst.toLocaleString()}</div>
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
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] font-black uppercase text-slate-500">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" placeholder="Search transaction, supplier..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-1.5 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-xs font-bold" />
            </div>
          </div>
          {(fromDate || toDate || statusFilter !== "All" || searchTerm) && (
            <button
              onClick={() => {
                setFromDate("");
                setToDate("");
                setStatusFilter("All");
                setSearchTerm("");
              }}
              className="text-[10px] font-black uppercase text-red-600 hover:text-red-800 underline ml-2 mt-4"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="block md:hidden space-y-4 p-2">
          {filteredMaterialIn.map((entry) => (
            <div key={entry.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
              <div className="flex justify-between items-center">
                <div className="font-bold">{entry.transactionNo}</div>
                <span className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${entry.status === "Completed" ? "bg-emerald-100 text-emerald-900 border-emerald-900" : "bg-amber-100 text-amber-900 border-amber-900"}`}>
                  {entry.status}
                </span>
              </div>
              <div className="text-xs font-black text-slate-500 uppercase">Date / Supplier</div>
              <div className="text-sm">{formatDate(entry.date)} | {getSupplierName(entry.supplierId)}</div>
              <div className="text-xs font-black text-slate-500 uppercase">Items</div>
              <div className="text-sm">{getLineItemsElement(entry.lines)}</div>
              <div className="flex justify-between items-center mt-2 border-t border-slate-100 pt-2">
                <div className="text-right">
                  <div className="font-bold text-sm text-slate-500">Invoice: Rs {Number(entry.totalInvoiceValue || 0).toLocaleString()}</div>
                  <div className="font-bold text-sm text-slate-500">Invoice After GST: Rs {Number(entry.totalInvoiceValueAfterGst || 0).toLocaleString()}</div>
                  <div className="font-bold text-sm text-slate-500">
                    Insurance / Other: Rs {Number(entry.insurance || 0).toLocaleString()} / Rs {Number(entry.otherCharges || 0).toLocaleString()}
                  </div>
                  <div className="font-bold text-sm text-slate-500">
                    Expense GST: CGST Rs {Number(entry.expenseCGST || 0).toLocaleString()} | SGST Rs {Number(entry.expenseSGST || 0).toLocaleString()} | IGST Rs {Number(entry.expenseIGST || 0).toLocaleString()}
                  </div>
                  <div className="font-bold text-sm text-slate-500">Actual: Rs {Number(entry.totalActualValue || 0).toLocaleString()}</div>
                  <div className="font-bold text-lg text-indigo-700">Final Total: Rs {Number(entry.totalAmount || 0).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleDelete(entry.id)} className={`${deletingId === entry.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}>
                    <Trash2 size={16} className="mr-1" /> {deletingId === entry.id ? "Confirm?" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">MRR No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Gate Entry No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Items</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Invoice Value</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Invoice After GST</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actual Value</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {filteredMaterialIn.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-black font-medium italic">No material in records found.</td>
              </tr>
            ) : (
              filteredMaterialIn.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 divide-x divide-black transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{entry.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(entry.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{entry.gateEntryNo || ""}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{getSupplierName(entry.supplierId)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{getLineItemsElement(entry.lines)}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">Rs {Number(entry.totalInvoiceValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">Rs {Number(entry.totalInvoiceValueAfterGst || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">
                    <div>Actual: Rs {Number(entry.totalActualValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div className="text-[11px] text-slate-500">
                      Exp GST: Rs {Number((entry.expenseCGST || 0) + (entry.expenseSGST || 0) + (entry.expenseIGST || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="font-bold">Final: Rs {Number(entry.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </td>
                  <td className="px-6 py-4 text-sm border border-black whitespace-nowrap">
                    <span className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${entry.status === "Completed" ? "bg-emerald-100 text-emerald-900 border-emerald-900" : "bg-amber-100 text-amber-900 border-amber-900"}`}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => handleDelete(entry.id)} className={`${deletingId === entry.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}>
                        <Trash2 size={16} className="mr-1" /> {deletingId === entry.id ? "Confirm?" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

