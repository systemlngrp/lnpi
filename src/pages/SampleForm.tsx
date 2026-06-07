import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { SampleRequest } from "../types";
import { Select } from "../components/Select";
import { Spinner } from "../components/Spinner";
import { useNpdItems } from "../hooks/useNpdItems";

export function SampleForm() {
  const [, setSampleRequests] = useData<SampleRequest>("sample_requests", []);
  const npdItems = useNpdItems();

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [itemId, setItemId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sortedItems = useMemo(
    () =>
      [...npdItems].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [npdItems]
  );

  const itemOptions = useMemo(
    () =>
      sortedItems.map((item) => ({
        value: item.id,
        label: item.erp ? `${item.name} (${item.erp})` : item.name,
      })),
    [sortedItems]
  );

  const selectedItem = sortedItems.find((item) => item.id === itemId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !selectedItem || plannedQuantity === "" || Number(plannedQuantity) <= 0) return;

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const newRequest: SampleRequest = {
        id: crypto.randomUUID(),
        timestamp,
        date,
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        erp: selectedItem.erp ?? "",
        plannedQuantity: Number(plannedQuantity),
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      await setSampleRequests((prev) => [...prev, newRequest]);

      setDate(new Date().toISOString().split("T")[0]);
      setItemId("");
      setPlannedQuantity("");
      alert("Sample request created successfully.");
    } catch (err) {
      console.error("Failed to save sample request:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">
        Sample Form
      </h2>

      <form onSubmit={handleSubmit} className="space-y-5">
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
            <label className="font-bold text-black">ERP</label>
            <input
              type="text"
              value={selectedItem?.erp ?? ""}
              disabled
              className="border-2 border-black rounded p-2 text-black bg-slate-100 w-full font-medium"
              placeholder="Auto fetched from item"
            />
          </div>

          <div className="flex flex-col space-y-1 md:col-span-2">
            <label className="font-bold text-black">
              Item Name <span className="text-red-500">*</span>
            </label>
            <Select
              options={itemOptions}
              value={itemId}
              onChange={setItemId}
              required
              placeholder="Search and select item..."
            />
          </div>

          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">
              Planned Quantity <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={plannedQuantity}
              onChange={(e) =>
                setPlannedQuantity(e.target.value === "" ? "" : Number(e.target.value))
              }
              required
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors bg-white w-full"
              placeholder="Enter planned quantity"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !itemId || plannedQuantity === "" || Number(plannedQuantity) <= 0}
            className="flex items-center justify-center min-w-[150px] bg-indigo-600 text-white px-6 py-3 rounded font-bold hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={24} className="text-white" /> : "Save Sample"}
          </button>
        </div>
      </form>
    </div>
  );
}
