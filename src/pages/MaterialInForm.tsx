import React, { useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { MaterialIn, MaterialLine, Item } from "../types";
import { Plus, Trash2 } from "lucide-react";
import { generateTransactionNo } from "../lib/serial";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";

export function MaterialInForm() {
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [items] = useData<Item>("items", []);
  const [suppliers] = useData<{ id: string; name: string }>("suppliers", []);
  
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  
  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [currentItemId, setCurrentItemId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [currentRate, setCurrentRate] = useState<number | "">("");
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalAmount = lines.reduce((sum, line) => sum + line.value, 0);

  const itemOptions = items.map(i => ({ value: i.id, label: i.name }));
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));

  const handleAddLine = () => {
    if (!currentItemId || currentQty === "" || currentQty <= 0 || currentRate === "" || currentRate <= 0) return;
    const item = items.find(i => i.id === currentItemId);
    if (!item) return;

    const newLine: MaterialLine = {
      id: crypto.randomUUID(),
      itemId: currentItemId,
      qty: Number(currentQty),
      uom: item.uom,
      rate: Number(currentRate),
      value: Number(currentQty) * Number(currentRate),
    };

    setLines([...lines, newLine]);
    setCurrentItemId("");
    setCurrentQty("");
    setCurrentRate("");
  };

  const handleRemoveLine = (id: string) => {
    setLines(lines.filter(l => l.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !invoiceNo || !invDate || !supplierId || lines.length === 0) return;

    setIsSubmitting(true);
    try {
      let transactionNo = "";
      await setMaterialIn(prev => {
        transactionNo = generateTransactionNo("MI", prev, date);

        const newEntry: MaterialIn = {
          id: crypto.randomUUID(),
          transactionNo,
          timestamp: new Date().toISOString(),
          entryEmailId: "system@lngrp.in",
          date,
          invoiceNo,
          invDate,
          supplierId,
          totalAmount,
          lines,
          status: "Pending PH",
        };

        return [...prev, newEntry];
      });
      
      setInvoiceNo("");
      setInvDate("");
      setSupplierId("");
      setLines([]);
      alert(`Material In created with Transaction No: ${transactionNo}`);
    } catch (err) {
      console.error("Failed to save Material In:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Material In Form</h2>
      <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">
                Transaction No (Auto)
              </label>
              <input
                type="text"
                value="Generated on Submit"
                disabled
                className="border-2 border-black rounded p-2 text-black bg-slate-50 w-full font-mono text-sm opacity-70"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">
                Invoice No <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">
                Invoice Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={invDate}
                onChange={(e) => setInvDate(e.target.value)}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
              />
            </div>
            <div className="flex flex-col space-y-1 md:col-span-2">
              <label className="font-bold text-black">
                Supplier Name <span className="text-red-500">*</span>
              </label>
              <Select 
                 options={supplierOptions}
                 value={supplierId}
                 onChange={setSupplierId}
                 required
                 placeholder="Select Supplier..."
              />
            </div>
        </div>
        
        <div className="mt-6 border-t border-black pt-4">
            <h3 className="text-lg font-bold text-black mb-4 uppercase">Line Items</h3>
            <div className="flex flex-wrap gap-4 items-end mb-4 bg-slate-50 p-4 rounded border border-black">
                <div className="flex flex-col space-y-1 w-full md:w-64">
                   <label className="text-sm font-bold text-black">Item</label>
                   <Select 
                      options={itemOptions}
                      value={currentItemId}
                      onChange={setCurrentItemId}
                      placeholder="Select Item..."
                   />
                </div>
                <div className="flex flex-col space-y-1 w-full md:w-24">
                   <label className="text-sm font-bold text-black">Qty</label>
                   <input 
                      type="number"
                      value={currentQty}
                      onChange={e => setCurrentQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                      className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
                   />
                </div>
                <div className="flex flex-col space-y-1 w-full md:w-24">
                   <label className="text-sm font-bold text-black">Rate</label>
                   <input 
                      type="number"
                      value={currentRate}
                      onChange={e => setCurrentRate(e.target.value === "" ? "" : parseFloat(e.target.value))}
                      className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
                   />
                </div>
                <button type="button" onClick={handleAddLine} className="bg-black text-white p-[10px] rounded hover:bg-slate-800 transition">
                    <Plus size={20}/>
                </button>
            </div>
            
            {lines.length > 0 ? (
                <div className="overflow-x-auto shadow-sm rounded border border-black">
                    <table className="min-w-full divide-y divide-black border-collapse border border-black">
                        <thead className="bg-slate-100 divide-x divide-black">
                            <tr className="divide-x divide-black">
                                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Item</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Qty</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">UOM</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Rate</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Value</th>
                                <th className="px-4 py-3 text-right border border-black"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black bg-white">
                            {lines.map(line => {
                                const itemName = items.find(i => i.id === line.itemId)?.name;
                                return (
                                    <tr key={line.id} className="divide-x divide-black">
                                        <td className="px-4 py-3 text-sm text-black border border-black">{itemName}</td>
                                        <td className="px-4 py-3 text-sm text-black border border-black">{line.qty}</td>
                                        <td className="px-4 py-3 text-sm text-black border border-black">{line.uom}</td>
                                        <td className="px-4 py-3 text-sm text-black border border-black">{line.rate}</td>
                                        <td className="px-4 py-3 text-sm font-medium text-black border border-black">{line.value}</td>
                                        <td className="px-4 py-3 text-right border border-black">
                                            <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-600 hover:text-red-800"><Trash2 size={18}/></button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="p-4 bg-slate-50 text-black rounded border border-dashed border-black text-sm text-center">
                    No items added yet. Please add at least one line item.
                </div>
            )}
            <div className="mt-4 text-right font-bold text-black text-xl">Total Amount: <span className="text-indigo-700">₹{totalAmount.toLocaleString()}</span></div>
        </div>
        
        <div className="pt-4 flex justify-end">
            <button
                type="submit"
                disabled={isSubmitting || lines.length === 0}
                className="flex items-center justify-center min-w-[150px] bg-indigo-600 text-white px-6 py-3 rounded font-bold hover:bg-indigo-700 transition disabled:opacity-50"
            >
                {isSubmitting ? <Spinner size={24} className="text-white" /> : "Submit Form"}
            </button>
        </div>
      </form>
    </div>
  );
}
