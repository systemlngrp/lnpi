import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Consumption, Item, Production } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { generateTransactionNo, formatDate } from "../lib/serial";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNpdItems } from "../hooks/useNpdItems";

export function ConsumptionForm() {
  const [consumptions, setConsumptions] = useData<Consumption>("consumptions", []);
  const [items, setItems] = useData<Item>("items", []);
  const npdItems = useNpdItems();
  const [productions, setProductions] = useData<Production>("productions", []);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialProductionId = searchParams.get("productionId") || "";
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    productionId: initialProductionId,
    itemId: "",
    qty: "" as number | "",
    remarks: "",
  });

  const jobOptions = productions
    .filter((production) => production.status !== "Cancelled")
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
      return timeB - timeA;
    })
    .map((production) => {
      const item = npdItems.find((row) => String(row.id) === String(production.itemId || "").trim());
      const displayedJobNo = String(production.jobCardNo || production.transactionNo || "");
      return {
        value: production.id,
        label: `Job: ${displayedJobNo} | ${item?.name || "Unknown"} | Qty ${production.qty}`,
      };
    });

  const itemOptions = npdItems
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(i => ({ value: i.id, label: i.name }));

  const selectedItem = npdItems.find(i => i.id === formData.itemId);
  const selectedProduction = productions.find((production) => production.id === formData.productionId);

  const handleAddItem = () => {
    setShowQuickAdd(true);
  };

  const handleQuickAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddName.trim()) return;
    
    alert("Quick add is disabled. Please create items in NPD Master only.");
    setQuickAddName("");
    setShowQuickAdd(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemId || !formData.qty) return;

    setIsSubmitting(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const timestamp = new Date().toISOString();
      const item = npdItems.find(i => i.id === formData.itemId);
      const nextConsumptionQty = Number(formData.qty);
      const linkedJobNo = formData.productionId ? String(selectedProduction?.jobCardNo || selectedProduction?.transactionNo || "") : undefined;

      await setConsumptions(prev => {
        const txnNo = generateTransactionNo("CN", prev, formData.date);
        const newEntry: Consumption = {
          id: crypto.randomUUID(),
          transactionNo: txnNo,
          date: formData.date,
          productionId: formData.productionId || undefined,
          jobCardNo: linkedJobNo,
          itemId: formData.itemId,
          qty: nextConsumptionQty,
          uom: item?.uom || "",
          remarks: formData.remarks,
          status: "Pending PH",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
        return [newEntry, ...prev];
      });

      if (formData.productionId) {
        const relatedConsumptionTotal = consumptions
          .filter((row) => row.productionId === formData.productionId && !row.cancelTimestamp)
          .reduce((sum, row) => sum + Number(row.qty || 0), 0) + nextConsumptionQty;

        await setProductions((prev) =>
          prev.map((production) =>
            production.id === formData.productionId
              ? {
                  ...production,
                  actualPaperUsed: relatedConsumptionTotal,
                  status: "Pending FFG",
                  updatedBy: "System User",
                  updateTimestamp: timestamp,
                }
              : production
          )
        );
      }

      setFormData({
        date: today,
        productionId: "",
        itemId: "",
        qty: "",
        remarks: "",
      });
      if (initialProductionId) {
        setSearchParams({});
        navigate("/production/pending-consumption");
      }
    } catch (err) {
      console.error("Failed to save consumption:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Consumption Form</h2>
      </div>

      {showQuickAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded border-2 border-black max-w-sm w-full shadow-2xl">
            <h3 className="font-bold text-black uppercase mb-4">Quick Add Item</h3>
            <form onSubmit={handleQuickAddSubmit} className="space-y-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-xs uppercase">Item Name</label>
                <input 
                  autoFocus
                  type="text" 
                  value={quickAddName}
                  onChange={(e) => setQuickAddName(e.target.value)}
                  className="border-2 border-black p-2 rounded focus:outline-none focus:border-indigo-600"
                  placeholder="Enter name..."
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded font-bold border border-black flex-1">Add</button>
                <button type="button" onClick={() => setShowQuickAdd(false)} className="bg-slate-200 text-black px-4 py-2 rounded font-bold border border-black flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Job No.</label>
              <Select
                id="production-job"
                value={formData.productionId}
                onChange={(val) => {
                  setFormData({ ...formData, productionId: val });
                  setSearchParams(val ? { productionId: val } : {});
                }}
                options={jobOptions}
                placeholder="Select Job..."
              />
              {selectedProduction && (
                <span className="text-xs font-bold text-slate-500">
                  Selected Job: {selectedProduction.jobCardNo || selectedProduction.transactionNo} | Qty {selectedProduction.qty}
                </span>
              )}
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>
            <div className="flex flex-col space-y-1 md:col-span-2">
              <label className="font-bold text-black">Item Consumed <span className="text-red-500">*</span></label>
              <Select
                id="item"
                value={formData.itemId}
                onChange={(val) => setFormData({ ...formData, itemId: val })}
                onAdd={handleAddItem}
                options={itemOptions}
                placeholder="Search Item..."
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Quantity <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  type="number"
                  value={formData.qty}
                  onChange={(e) => setFormData({ ...formData, qty: e.target.value === "" ? "" : parseFloat(e.target.value) })}
                  required
                  placeholder="Enter quantity"
                  className="w-full border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
                />
                {selectedItem && (
                  <span className="absolute right-3 top-2.5 text-black font-bold opacity-60">
                    {selectedItem.uom}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Remarks</label>
              <input
                type="text"
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center min-w-[120px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50 border border-black shadow"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit Entry"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <h3 className="bg-slate-100 p-4 font-bold text-black border-b border-black uppercase tracking-wider">Recent Consumptions</h3>
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {consumptions.sort((a, b) => {
                const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                return timeB - timeA;
            }).slice(0, 10).map((c) => (
                <div key={c.id} className="bg-white border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative">
                    <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{c.transactionNo}</div>
                        <div className="text-xs text-slate-500">{formatDate(c.date)}</div>
                    </div>
                    {c.jobCardNo && <div className="text-xs font-bold text-indigo-700 uppercase">Job: {c.jobCardNo}</div>}
                    <div className="text-sm font-bold">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</div>
                    <div className="text-sm">{c.qty} {c.uom}</div>
                </div>
            ))}
        </div>
        <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-50 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Trn No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Job No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {consumptions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-black font-medium">No recent consumption entries.</td>
              </tr>
            ) : (
              consumptions
                .sort((a, b) => {
                  const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                  const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                  return timeB - timeA;
                })
                .slice(0, 10)
                .map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 divide-x divide-black">
                  <td className="px-6 py-4 text-sm font-medium text-black border border-black">{c.transactionNo}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{c.jobCardNo || "-"}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(c.date)}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{npdItems.find(i => i.id === c.itemId)?.name || "Unknown"}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-amber-700 border border-black">{c.qty}</td>
                  <td className="px-6 py-4 text-sm text-black border border-black">{c.uom}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
