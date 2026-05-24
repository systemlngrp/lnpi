import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Item, Production } from "../types";
import { Spinner } from "../components/Spinner";
import { Plus, Trash2, Save } from "lucide-react";
import { cn } from "../lib/utils";
import { generateTransactionNo } from "../lib/serial";
import { Select } from "../components/Select";

interface BulkRow {
  prodItemId: string;
  prodQty: string;
}

export function BulkEntry() {
  const [items, , itemsLoading] = useData<Item>("items", []);
  const [productions, setProductions, prodsLoading] = useData<Production>("productions", []);

  const isLoading = itemsLoading || prodsLoading;

  const [rows, setRows] = useState<BulkRow[]>([{ prodItemId: "", prodQty: "" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const addRow = () => {
    setRows([...rows, { prodItemId: "", prodQty: "" }]);
  };

  const removeRow = (index: number) => {
    if (rows.length > 1) {
      setRows(rows.filter((_, i) => i !== index));
    }
  };

  const updateRow = (index: number, field: keyof BulkRow, value: string) => {
    const newRows = [...rows];
    newRows[index][field] = value;
    setRows(newRows);
  };

  const itemOptions = useMemo(() => {
    return [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ value: item.id, label: item.name }));
  }, [items]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setIsSubmitting(true);
    setMessage(null);

    try {
      const today = new Date().toISOString().split("T")[0];
      const timestamp = new Date().toISOString();

      let prodCount = 0;

      const hasValidRows = rows.some(
        (row) => row.prodItemId && row.prodQty && Number(row.prodQty) > 0
      );

      if (!hasValidRows) {
        throw new Error("No valid entries to save. Please fill at least one row with Item and Quantity.");
      }

      await setProductions((prev) => {
        const updated = [...prev];
        for (const row of rows) {
          if (row.prodItemId && row.prodQty && Number(row.prodQty) > 0) {
            const item = items.find((entry) => entry.id === row.prodItemId);
            const txnNo = generateTransactionNo("PR", updated, today);
            const newEntry: Production = {
              id: crypto.randomUUID(),
              transactionNo: txnNo,
              date: today,
              itemId: row.prodItemId,
              qty: Number(row.prodQty),
              uom: item?.uom || "",
              remarks: "Bulk Entry",
              status: "Pending PH",
              updatedBy: "System User",
              updateTimestamp: timestamp,
            };
            updated.push(newEntry);
            prodCount++;
          }
        }
        return updated;
      });

      setMessage({
        type: "success",
        text: `Successfully saved ${prodCount} production ${prodCount === 1 ? "entry" : "entries"}. Entries are now visible in Pending PH Approval.`,
      });
      setRows([{ prodItemId: "", prodQty: "" }]);
    } catch (err) {
      console.error("Bulk save error:", err);
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto px-4 lg:px-8">
      <div className="flex justify-between items-center border-b-2 border-black pb-4">
        <div className="flex flex-col">
          <h2 className="text-2xl font-black text-black uppercase tracking-tight">Bulk Operations Entry</h2>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Quick production entry for multiple rows</p>
        </div>
        <div className="flex items-center gap-4">
          {!isLoading && items.length === 0 && (
            <span className="text-xs font-black text-red-600 uppercase tracking-widest bg-red-50 px-3 py-1 rounded border border-red-600 animate-bounce">
              No Items Found! Create items first.
            </span>
          )}
          {isLoading && <span className="text-xs font-black text-amber-600 animate-pulse tracking-widest uppercase bg-amber-50 px-3 py-1 rounded border border-amber-600">Syncing...</span>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white border-2 border-black rounded shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="min-w-full divide-y-2 divide-black border-collapse">
              <thead className="bg-slate-100 border-b-2 border-black">
                <tr className="divide-x-2 divide-black">
                  <th colSpan={2} className="px-4 py-3 text-center text-xs font-black text-emerald-900 uppercase bg-emerald-100 border-r-2 border-black">Production</th>
                  <th className="px-4 py-3 text-center text-xs font-black text-black uppercase w-12"></th>
                </tr>
                <tr className="divide-x-2 divide-black bg-slate-50">
                  <th className="px-4 py-2 text-left text-[10px] font-black text-black uppercase tracking-wider">Item Name</th>
                  <th className="px-4 py-2 text-left text-[10px] font-black text-black uppercase tracking-wider w-40">Qty</th>
                  <th className="px-4 py-2 text-center text-[10px] font-black text-black uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black bg-white">
                {rows.map((row, index) => {
                  const prodItem = items.find((item) => item.id === row.prodItemId);

                  return (
                    <tr key={index} className="divide-x-2 divide-black hover:bg-slate-50 transition-colors">
                      <td className="p-3 min-w-[250px]">
                        <Select
                          value={row.prodItemId}
                          onChange={(val) => updateRow(index, "prodItemId", val)}
                          options={itemOptions}
                          placeholder="Select Item..."
                        />
                      </td>
                      <td className="p-3">
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            placeholder="0.00"
                            value={row.prodQty}
                            onChange={(e) => updateRow(index, "prodQty", e.target.value)}
                            className="w-full text-sm font-bold rounded border-2 border-black focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 p-2 pr-12 shadow-sm"
                          />
                          {prodItem && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase tracking-tighter">
                              {prodItem.uom}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(index)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded transition-colors"
                          disabled={rows.length === 1}
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-slate-50 border-t-2 border-black flex items-center justify-between">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-2 px-6 py-2 bg-black text-white hover:bg-slate-800 rounded font-black text-xs uppercase tracking-widest transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              <Plus size={16} />
              Add Another Row
            </button>
          </div>
        </div>

        {message && (
          <div
            className={cn(
              "p-4 rounded border-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center gap-3",
              message.type === "success"
                ? "bg-emerald-50 text-emerald-900 border-emerald-900"
                : "bg-red-50 text-red-900 border-red-900"
            )}
          >
            <span className="text-sm font-bold">{message.text}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSubmitting || isLoading}
            className="group relative inline-flex items-center gap-3 px-12 py-4 bg-indigo-600 text-white rounded font-black text-sm uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50"
          >
            {isSubmitting ? (
              <Spinner size={24} className="text-white" />
            ) : (
              <>
                <Save size={20} />
                <span>Save All Entries</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
