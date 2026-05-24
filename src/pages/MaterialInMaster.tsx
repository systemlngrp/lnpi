import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier } from "../types";
import { formatDate } from "../lib/serial";
import { Trash2, Search } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";

export function MaterialInMaster() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setMaterialIn(materialIn.filter((entry) => entry.id !== id));
    setDeletingId(null);
  };

  const getLineItemsElement = (lines: MaterialIn["lines"] = []) => {
    return (
      <ul className="list-none space-y-1">
        {lines.map((line, idx) => {
          const itemName = materials.find((item) => item.id === line.itemId)?.name || items.find((item) => item.id === line.itemId)?.name;
          return (
            <li key={idx} className="border-b border-black pb-1 mb-1 last:border-0 last:pb-0 last:mb-0">
              <div className="font-medium text-black">{itemName || "Unknown"}</div>
              <div className="text-xs text-black">
                PO: {line.poNo || "-"} | PO Rate: Rs {Number(line.poRate || 0).toFixed(2)} | Invoice: {Number(line.invoiceQty || 0).toFixed(2)} {line.uom} @ Rs {Number(line.invoiceRate || line.rate || 0).toFixed(2)} = Rs {Number(line.invoiceValue || 0).toFixed(2)} | Actual: {Number(line.actualQty || line.qty || 0).toFixed(2)} {line.uom} = Rs {Number(line.actualValue || line.value || 0).toFixed(2)}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const getSupplierName = (id: string) => suppliers.find((supplier) => supplier.id === id)?.name || id;

  const filteredMaterialIn = materialIn
    .filter((entry) => {
      const supplierName = getSupplierName(entry.supplierId);
      const itemNames = entry.lines
        .map((line) => materials.find((item) => item.id === line.itemId)?.name || items.find((item) => item.id === line.itemId)?.name || "")
        .join(" ");
      return (
        entry.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        itemNames.toLowerCase().includes(searchTerm.toLowerCase())
      );
    })
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.timestamp || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.timestamp || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material In Master</h2>
          <ExcelExport data={filteredMaterialIn} fileName="Material_In_Master" />
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search transaction, supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>
      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="block md:hidden space-y-4 p-2">
          {filteredMaterialIn.map((entry) => (
            <div key={entry.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
              <div className="flex justify-between items-center">
                <div className="font-bold">{entry.transactionNo}</div>
                <span
                  className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${
                    entry.status === "Completed"
                      ? "bg-emerald-100 text-emerald-900 border-emerald-900"
                      : "bg-amber-100 text-amber-900 border-amber-900"
                  }`}
                >
                  {entry.status}
                </span>
              </div>
              <div className="text-xs font-black text-slate-500 uppercase">Date / Supplier</div>
              <div className="text-sm">{formatDate(entry.date)} | {getSupplierName(entry.supplierId)}</div>

              <div className="text-xs font-black text-slate-500 uppercase">Items</div>
              <div className="text-sm">{getLineItemsElement(entry.lines)}</div>

              <div className="flex justify-between items-center mt-2">
                <div className="text-right">
                  <div className="font-bold text-sm">PO: Rs {Number(entry.totalPoValue || 0).toLocaleString()}</div>
                  <div className="font-bold text-sm">Invoice: Rs {Number(entry.totalInvoiceValue || 0).toLocaleString()}</div>
                  <div className="font-bold text-lg">Actual: Rs {Number(entry.totalActualValue || entry.totalAmount || 0).toLocaleString()}</div>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className={`${deletingId === entry.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                >
                  <Trash2 size={16} className="mr-1" /> {deletingId === entry.id ? "Confirm?" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Gate Entry No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Items</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">PO Value</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Invoice Value</th>
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
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">Rs {Number(entry.totalPoValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">Rs {Number(entry.totalInvoiceValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-black border border-black">Rs {Number(entry.totalActualValue || entry.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm border border-black whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded text-[11px] font-bold border uppercase tracking-wider ${
                        entry.status === "Completed"
                          ? "bg-emerald-100 text-emerald-900 border-emerald-900"
                          : "bg-amber-100 text-amber-900 border-amber-900"
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className={`${deletingId === entry.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                    >
                      <Trash2 size={16} className="mr-1" /> {deletingId === entry.id ? "Confirm?" : "Delete"}
                    </button>
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
