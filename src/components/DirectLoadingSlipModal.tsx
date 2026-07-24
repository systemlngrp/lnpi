import React, { useMemo, useState } from "react";
import type { Company, DispatchPlan, LoadingSlip, Order, PackingDetail, Truck } from "../types";
import type { OrderCatalogItem } from "../lib/orderItems";
import { buildLinkedLoadingDetailsFromSlip } from "../lib/linkedLoading";
import { normalizeTruckStatus } from "../lib/truckStatus";
import { Select } from "./Select";
import { X, Plus, Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  companies: Company[];
  trucks: Truck[];
  allItems: OrderCatalogItem[];
  plans: DispatchPlan[];
  orders: Order[];
  phpItems: OrderCatalogItem[];
  plateItems: OrderCatalogItem[];
  resolveOrderItem: (order?: Partial<Order> | null) => OrderCatalogItem | undefined;
  onClose: () => void;
  onSave: (payload: {
    slip: LoadingSlip;
    phpDetails: NonNullable<LoadingSlip["phpDetails"]>;
    plateDetails: NonNullable<LoadingSlip["plateDetails"]>;
  }) => Promise<void> | void;
};

type Draft = {
  date: string;
  companyId: string;
  itemId: string;
  truckId: string;
  manualTruckNo: string;
  loadedQty: number | "";
  rate: number | "";
  packingDetails: PackingDetail[];
  extraItemsQty: number | "";
};

const makePacking = (): PackingDetail => ({ extra: 0, bundles: 0, packSize: 0, quantity: 0 });
const makeDraft = (): Draft => ({
  date: new Date().toISOString().slice(0, 10),
  companyId: "",
  itemId: "",
  truckId: "",
  manualTruckNo: "",
  loadedQty: "",
  rate: "",
  packingDetails: [makePacking()],
  extraItemsQty: "",
});

export function DirectLoadingSlipModal({
  open,
  companies,
  trucks,
  allItems,
  plans,
  orders,
  phpItems,
  plateItems,
  resolveOrderItem,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<Draft>(makeDraft());
  const [isSaving, setIsSaving] = useState(false);
  const company = useMemo(() => companies.find((row) => row.id === draft.companyId), [companies, draft.companyId]);
  const companyOptions = useMemo(
    () =>
      [...companies]
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
        .map((row) => ({
          value: row.id,
          label: row.name,
          searchText: row.name,
        })),
    [companies]
  );
  const sortedItems = useMemo(
    () =>
      [...allItems].sort((left, right) => {
        const nameDiff = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        if (nameDiff !== 0) return nameDiff;
        return String(left.erp || "").localeCompare(String(right.erp || ""), undefined, { sensitivity: "base", numeric: true });
      }),
    [allItems]
  );
  const itemOptions = useMemo(
    () =>
      sortedItems.map((row) => ({
        value: row.id,
        label: `[${row.source}] ${row.name}${row.erp ? ` | ERP ${row.erp}` : ""}`,
        searchText: `${row.name} ${row.erp} ${row.source} ${row.companyName}`,
      })),
    [sortedItems]
  );
  const item = useMemo(() => allItems.find((row) => row.id === draft.itemId), [allItems, draft.itemId]);
  const availableTrucks = useMemo(
    () => trucks
      .filter((truck) => {
        const isInternal = String(truck.truckType || "").trim().toLowerCase() === "internal";
        const status = normalizeTruckStatus(truck.liveStatus);
        return isInternal && (!status || status === "EMPTY");
      })
      .sort((left, right) => left.truckNo.localeCompare(right.truckNo, undefined, { numeric: true, sensitivity: "base" })),
    [trucks]
  );

  const normalizedPacking = useMemo(
    () =>
      draft.packingDetails
        .map((row) => {
          const bundles = Math.max(0, Number(row.bundles || 0));
          const packSize = Math.max(0, Number(row.packSize || 0));
          return { extra: 0, bundles, packSize, quantity: bundles * packSize } as PackingDetail;
        })
        .filter((row) => row.bundles > 0 || row.packSize > 0 || row.quantity > 0),
    [draft.packingDetails]
  );

  const previewSlip = useMemo<LoadingSlip | null>(() => {
    const truckNoInput = draft.manualTruckNo.trim();
    const matchedTruck = availableTrucks.find((truck) => truck.truckNo.trim().toUpperCase() === truckNoInput.toUpperCase());
    if (!company || !item || !truckNoInput || !(Number(draft.loadedQty || 0) > 0)) return null;
    return {
      id: "direct-preview",
      slipNo: "",
      date: draft.date,
      truckId: matchedTruck?.id || "",
      truckNo: truckNoInput || undefined,
      loadingSource: "DIRECT",
      companyId: company.id,
      companyName: company.name,
      lines: [
        {
          dispatchPlanId: "",
          companyId: company.id,
          companyName: company.name,
          itemId: item.id,
          itemName: item.name,
          erpCode: item.erp,
          itemSource: item.source,
          loadedQty: Number(draft.loadedQty || 0),
          rate: draft.rate === "" ? undefined : Number(draft.rate || 0),
          gstRate: Number(item.gstRate || 0) || undefined,
          uom: item.uom || undefined,
        },
      ],
      packingDetails: normalizedPacking,
      extraItemsQty: Number(draft.extraItemsQty || 0) || undefined,
      status: "Active",
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString(),
    };
  }, [company, item, draft, normalizedPacking, availableTrucks]);

  const isFgItem = item?.source === "FG";
  const phpDetails = useMemo(
    () =>
      previewSlip && isFgItem
        ? buildLinkedLoadingDetailsFromSlip({
            slip: previewSlip,
            source: "PHP",
            plans,
            orders,
            resolveOrderItem,
            sourceItems: phpItems,
          })
        : [],
    [previewSlip, isFgItem, plans, orders, resolveOrderItem, phpItems]
  );
  const plateDetails = useMemo(
    () =>
      previewSlip && isFgItem
        ? buildLinkedLoadingDetailsFromSlip({
            slip: previewSlip,
            source: "PLATE",
            plans,
            orders,
            resolveOrderItem,
            sourceItems: plateItems,
          })
        : [],
    [previewSlip, isFgItem, plans, orders, resolveOrderItem, plateItems]
  );

  const setPackingRow = (index: number, patch: Partial<PackingDetail>) => {
    setDraft((prev) => ({
      ...prev,
      packingDetails: prev.packingDetails.map((row, rowIndex) => (rowIndex !== index ? row : { ...row, ...patch })),
    }));
  };

  const handleSave = async () => {
    if (!previewSlip) {
      alert("Please select company, item, truck number, and loaded qty.");
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ slip: previewSlip, phpDetails, plateDetails });
      setDraft(makeDraft());
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded border-2 border-black bg-white shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-center justify-between border-b-2 border-black bg-slate-900 px-6 py-4 text-white">
          <div>
            <h3 className="text-lg font-black uppercase">Direct Loading Slip</h3>
          </div>
          <button type="button" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto p-6">
          <div className="space-y-4 rounded border border-black p-4">
            <table className="w-full border-collapse border border-black">
              <tbody>
                <tr className="divide-x divide-black border-b border-black">
                  <td className="w-1/2 p-3 align-top">
                    {field(
                      "Date",
                      <input
                        type="date"
                        value={draft.date}
                        onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))}
                        className="w-full rounded border border-black px-3 py-2 text-sm"
                      />
                    )}
                  </td>
                  <td className="w-1/2 p-3 align-top">
                    {field(
                      "Company",
                      <Select
                        options={companyOptions}
                        value={draft.companyId}
                        onChange={(value) => setDraft((prev) => ({ ...prev, companyId: value }))}
                        placeholder="Select Company"
                      />,
                      true
                    )}
                  </td>
                </tr>
                <tr className="divide-x divide-black">
                  <td className="w-1/2 p-3 align-top">
                    {field(
                      "Item",
                      <Select
                        options={itemOptions}
                        value={draft.itemId}
                        onChange={(value) => {
                          const selectedItem = sortedItems.find((row) => row.id === value);
                          setDraft((prev) => ({
                            ...prev,
                            itemId: value,
                            rate: selectedItem?.rate ?? "",
                          }));
                        }}
                        placeholder="Select Item"
                        disabled={false}
                      />,
                      true
                    )}
                  </td>
                  <td className="w-1/2 p-3 align-top">
                    {field(
                      "Truck Number",
                      <>
                        <input
                          list="direct-loading-truck-options"
                          value={draft.manualTruckNo}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase();
                            const match = availableTrucks.find((truck) => truck.truckNo.trim().toUpperCase() === value.trim().toUpperCase());
                            setDraft((prev) => ({ ...prev, manualTruckNo: value, truckId: match?.id || "" }));
                          }}
                          placeholder="Select or enter truck no"
                          className="w-full rounded border border-black px-3 py-2 text-sm uppercase"
                        />
                        <datalist id="direct-loading-truck-options">
                          {availableTrucks.map((row) => (
                            <option key={row.id} value={row.truckNo} />
                          ))}
                        </datalist>
                      </>,
                      true
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                {field(
                  "Loaded Qty",
                  <input
                    type="number"
                    min={0}
                    value={draft.loadedQty}
                    onChange={(e) => setDraft((prev) => ({ ...prev, loadedQty: e.target.value === "" ? "" : Number(e.target.value) }))}
                    className="w-full rounded border border-black px-3 py-2 text-sm"
                  />,
                  true
                )}
              </div>
              <div>
                {field(
                  "Rate",
                  <input
                    type="number"
                    min={0}
                    step="0.00001"
                    value={draft.rate}
                    onChange={(e) => setDraft((prev) => ({ ...prev, rate: e.target.value === "" ? "" : Number(e.target.value) }))}
                    className="w-full rounded border border-black px-3 py-2 text-sm"
                    placeholder="Enter Rate"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="rounded border border-black p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-black uppercase">Packing Details</h4>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, packingDetails: [...prev.packingDetails, makePacking()] }))}
                className="rounded border border-black bg-white px-3 py-1 text-[10px] font-black uppercase"
              >
                <Plus size={12} className="inline" /> Add Row
              </button>
            </div>
            <table className="min-w-full border-collapse border border-black">
              <thead className="sticky top-0 z-30 bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Bundles</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Pack Size</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Quantity</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {draft.packingDetails.map((row, index) => (
                  <tr key={index} className="divide-x divide-black border-t border-black">
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={Number(row.bundles || 0) || ""}
                        onChange={(e) => setPackingRow(index, { bundles: Number(e.target.value || 0) })}
                        className="w-full rounded border border-black px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={Number(row.packSize || 0) || ""}
                        onChange={(e) => setPackingRow(index, { packSize: Number(e.target.value || 0) })}
                        className="w-full rounded border border-black px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-sm font-bold text-indigo-700">
                      {(Number(row.bundles || 0) * Number(row.packSize || 0)).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            packingDetails:
                              prev.packingDetails.length === 1
                                ? [makePacking()]
                                : prev.packingDetails.filter((_, rowIndex) => rowIndex !== index),
                          }))
                        }
                        className="text-red-700"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 max-w-xs">
              {field(
                "Extra Items Qty",
                <input
                  type="number"
                  min={0}
                  value={draft.extraItemsQty}
                  onChange={(e) => setDraft((prev) => ({ ...prev, extraItemsQty: e.target.value === "" ? "" : Number(e.target.value) }))}
                  className="w-full rounded border border-black px-3 py-2 text-sm"
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end border-t-2 border-black bg-slate-50 px-6 py-4">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="rounded border border-black bg-white px-4 py-2 text-xs font-black uppercase">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !previewSlip}
              className="rounded border border-black bg-emerald-600 px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Direct Loading Slip"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function field(label: string, control: React.ReactNode, required = false) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-black uppercase text-slate-500">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      {control}
    </div>
  );
}
