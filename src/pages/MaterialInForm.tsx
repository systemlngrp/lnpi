import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  GateEntry,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialLine,
  PurchaseOrder,
  PurchaseOrderLine,
  Supplier,
} from "../types";
import { generateTransactionNo } from "../lib/serial";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";

type PackingSlipDraft = {
  id: string;
  materialLineId: string;
  materialId: string;
  supplierReelNo: string;
  ourReelNo: string;
  weightKg: string;
  supplierPoNo: string;
  ourPoId: string;
  ourPoNo: string;
};

function formatReelNo(value: number) {
  return `R${String(value).padStart(5, "0")}`;
}

export function MaterialInForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips, setPackingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [gateEntries, setGateEntries] = useData<GateEntry>("gate-entries", []);
  const [materials] = useData<Material>("materials", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [mrrType, setMrrType] = useState<"Reel" | "Others">("Others");

  const [lines, setLines] = useState<MaterialLine[]>([]);
  const [currentItemId, setCurrentItemId] = useState("");
  const [currentQty, setCurrentQty] = useState<number | "">("");
  const [currentRate, setCurrentRate] = useState<number | "">("");
  const [packingSlipDrafts, setPackingSlipDrafts] = useState<Record<string, PackingSlipDraft[]>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);

  const gateEntryId = searchParams.get("gateEntryId") || "";
  const linkedGateEntry = useMemo(
    () => gateEntries.find((entry) => entry.id === gateEntryId),
    [gateEntries, gateEntryId]
  );

  const linkedSupplierName = suppliers.find((supplier) => supplier.id === supplierId)?.name || "";

  const materialOptions = useMemo(
    () =>
      materials
        .filter((material) => material.active !== "No")
        .filter((material) => (mrrType === "Reel" ? material.type === "Reel" : material.type !== "Reel"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((material) => ({
          value: material.id,
          label: `${material.name}${material.erpCode ? ` (${material.erpCode})` : ""}`,
        })),
    [materials, mrrType]
  );

  const supplierOptions = useMemo(
    () =>
      suppliers
        .filter((supplier) => supplier.active !== "No")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((supplier) => ({ value: supplier.id, label: supplier.name })),
    [suppliers]
  );

  const mrrTypeOptions = [
    { value: "Reel", label: "Reel" },
    { value: "Others", label: "Others" },
  ];

  const totalAmount = lines.reduce((sum, line) => sum + Number(line.value || 0), 0);

  useEffect(() => {
    if (!linkedGateEntry) return;
    setDate(linkedGateEntry.date || new Date().toISOString().split("T")[0]);
    setInvoiceNo(linkedGateEntry.invoiceNo || "");
    setInvDate(linkedGateEntry.date || "");
    setSupplierId(linkedGateEntry.supplierId || "");
  }, [linkedGateEntry]);

  const getMaterial = (materialId: string) => materials.find((material) => material.id === materialId);

  const getApprovedPoOptionsForMaterial = (materialId: string) => {
    const approvedOrders = purchaseOrders.filter(
      (order) =>
        order.status === "Approved" &&
        (!supplierId || order.supplierId === supplierId)
    );

    return approvedOrders
      .filter((order) =>
        purchaseOrderLines.some(
          (line) => line.purchaseOrderId === order.id && line.materialId === materialId
        )
      )
      .map((order) => ({
        value: order.id,
        label: order.poNo,
      }));
  };

  const getAllDraftSlips = () => Object.values(packingSlipDrafts).flat();

  const getNextOurReelNo = () => {
    const persistedNumbers = packingSlips
      .map((row) => row.ourReelNo)
      .map((value) => Number(String(value).replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    const draftNumbers = getAllDraftSlips()
      .map((row) => Number(String(row.ourReelNo).replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value));
    const maxValue = Math.max(0, ...persistedNumbers, ...draftNumbers);
    return formatReelNo(maxValue + 1);
  };

  const syncReelLineTotals = (lineId: string, nextDrafts: PackingSlipDraft[]) => {
    const totalWeight = nextDrafts.reduce((sum, slip) => sum + Number(slip.weightKg || 0), 0);
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              qty: totalWeight,
              value: totalWeight * Number(line.rate || 0),
            }
          : line
      )
    );
  };

  const resetLineDrafts = () => {
    setCurrentItemId("");
    setCurrentQty("");
    setCurrentRate("");
  };

  const handleMrrTypeChange = (value: string) => {
    const nextType = value === "Reel" ? "Reel" : "Others";
    setMrrType(nextType);
    setLines([]);
    setPackingSlipDrafts({});
    resetLineDrafts();
  };

  const handleAddLine = () => {
    if (!currentItemId || currentRate === "" || Number(currentRate) <= 0) return;
    const material = getMaterial(currentItemId);
    if (!material) return;

    if (mrrType === "Others" && (currentQty === "" || Number(currentQty) <= 0)) return;

    const qty = mrrType === "Reel" ? 0 : Number(currentQty);
    const rate = Number(currentRate);
    const newLine: MaterialLine = {
      id: crypto.randomUUID(),
      itemId: currentItemId,
      qty,
      uom: material.uom || (mrrType === "Reel" ? "KG" : ""),
      rate,
      value: qty * rate,
    };

    setLines((prev) => [...prev, newLine]);
    if (mrrType === "Reel") {
      setPackingSlipDrafts((prev) => ({ ...prev, [newLine.id]: [] }));
    }
    resetLineDrafts();
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((prev) => prev.filter((line) => line.id !== lineId));
    setPackingSlipDrafts((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const handleAddPackingSlip = (line: MaterialLine) => {
    const nextDraft: PackingSlipDraft = {
      id: crypto.randomUUID(),
      materialLineId: line.id,
      materialId: line.itemId,
      supplierReelNo: "",
      ourReelNo: getNextOurReelNo(),
      weightKg: "",
      supplierPoNo: "",
      ourPoId: "",
      ourPoNo: "",
    };

    setPackingSlipDrafts((prev) => {
      const nextDrafts = [...(prev[line.id] || []), nextDraft];
      const next = { ...prev, [line.id]: nextDrafts };
      syncReelLineTotals(line.id, nextDrafts);
      return next;
    });
  };

  const updatePackingSlip = (lineId: string, slipId: string, patch: Partial<PackingSlipDraft>) => {
    setPackingSlipDrafts((prev) => {
      const nextDrafts = (prev[lineId] || []).map((slip) => (slip.id === slipId ? { ...slip, ...patch } : slip));
      const next = { ...prev, [lineId]: nextDrafts };
      syncReelLineTotals(lineId, nextDrafts);
      return next;
    });
  };

  const removePackingSlip = (lineId: string, slipId: string) => {
    setPackingSlipDrafts((prev) => {
      const nextDrafts = (prev[lineId] || []).filter((slip) => slip.id !== slipId);
      const next = { ...prev, [lineId]: nextDrafts };
      syncReelLineTotals(lineId, nextDrafts);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !invoiceNo || !invDate || !supplierId || lines.length === 0) return;

    if (mrrType === "Reel") {
      for (const line of lines) {
        const slips = packingSlipDrafts[line.id] || [];
        if (slips.length === 0) {
          alert("Please add at least one packing slip row for each reel item.");
          return;
        }
        if (slips.some((slip) => Number(slip.weightKg || 0) <= 0)) {
          alert("Each packing slip row must have weight in KG.");
          return;
        }
      }
    }

    setIsSubmitting(true);
    try {
      let transactionNo = "";
      const materialInId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      await setMaterialIn((prev) => {
        transactionNo = generateTransactionNo("MI", prev, date);

        const newEntry: MaterialIn = {
          id: materialInId,
          transactionNo,
          mrrType,
          gateEntryId: linkedGateEntry?.id,
          gateEntryNo: linkedGateEntry?.gateEntryNo,
          timestamp,
          entryEmailId: "system@lngrp.in",
          date,
          invoiceNo,
          invDate,
          supplierId,
          totalAmount,
          lines,
          status: "Pending PH",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };

        return [...prev, newEntry];
      });

      if (mrrType === "Reel") {
        const newPackingSlips: MaterialInPackingSlip[] = Object.values(packingSlipDrafts)
          .flat()
          .map((slip) => ({
            id: slip.id,
            materialInId,
            materialLineId: slip.materialLineId,
            materialId: slip.materialId,
            supplierReelNo: slip.supplierReelNo || undefined,
            ourReelNo: slip.ourReelNo,
            weightKg: Number(slip.weightKg || 0),
            supplierPoNo: slip.supplierPoNo || undefined,
            ourPoId: slip.ourPoId || undefined,
            ourPoNo: slip.ourPoNo || undefined,
            updatedBy: "System User",
            updateTimestamp: timestamp,
          }));

        if (newPackingSlips.length > 0) {
          await setPackingSlips([...packingSlips, ...newPackingSlips]);
        }
      }

      if (linkedGateEntry) {
        await setGateEntries(
          gateEntries.map((entry) =>
            entry.id === linkedGateEntry.id
              ? {
                  ...entry,
                  mrrId: materialInId,
                  mrrDate: date,
                  mrrNo: transactionNo,
                  updateTimestamp: timestamp,
                }
              : entry
          )
        );
      }

      setInvoiceNo("");
      setInvDate("");
      setSupplierId("");
      setLines([]);
      setPackingSlipDrafts({});
      alert(`Material In created with Transaction No: ${transactionNo}`);
      if (linkedGateEntry) {
        navigate("/material-receipt/pending-mrr");
      }
    } catch (err) {
      console.error("Failed to save Material In:", err);
      alert("Failed to save Material In.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black text-black">
      <h2 className="text-xl font-bold text-black mb-6 uppercase tracking-tight border-b border-black pb-2">Material In Form</h2>
      <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
        {linkedGateEntry ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded border border-emerald-700 bg-emerald-50 p-4">
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Gate Entry No</label>
              <input type="text" value={linkedGateEntry.gateEntryNo || "Syncing..."} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Supplier</label>
              <input type="text" value={linkedSupplierName} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Truck No</label>
              <input type="text" value={linkedGateEntry.truckNo || ""} disabled className="border-2 border-emerald-700 rounded p-2 text-black bg-white font-semibold" />
            </div>
          </div>
        ) : null}

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
            <label className="font-bold text-black">Transaction No (Auto)</label>
            <input type="text" value="Generated on Submit" disabled className="border-2 border-black rounded p-2 text-black bg-slate-50 w-full font-mono text-sm opacity-70" />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">
              MRR Type <span className="text-red-500">*</span>
            </label>
            <Select options={mrrTypeOptions} value={mrrType} onChange={handleMrrTypeChange} required />
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
            {linkedGateEntry ? (
              <input type="text" value={linkedSupplierName} disabled className="border-2 border-black rounded p-2 text-black bg-slate-50 w-full font-semibold opacity-80" />
            ) : (
              <Select options={supplierOptions} value={supplierId} onChange={setSupplierId} required placeholder="Select Supplier..." />
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-black pt-4">
          <h3 className="text-lg font-bold text-black mb-4 uppercase">
            {mrrType === "Reel" ? "Reel Items" : "Line Items"}
          </h3>
          <div className="flex flex-wrap gap-4 items-end mb-4 bg-slate-50 p-4 rounded border border-black">
            <div className="flex flex-col space-y-1 w-full md:w-80">
              <label className="text-sm font-bold text-black">Material</label>
              <Select options={materialOptions} value={currentItemId} onChange={setCurrentItemId} placeholder="Select Material..." />
            </div>
            {mrrType === "Others" ? (
              <div className="flex flex-col space-y-1 w-full md:w-24">
                <label className="text-sm font-bold text-black">Invoice Qty</label>
                <input
                  type="number"
                  value={currentQty}
                  onChange={(e) => setCurrentQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                  className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
                />
              </div>
            ) : null}
            <div className="flex flex-col space-y-1 w-full md:w-24">
              <label className="text-sm font-bold text-black">Rate</label>
              <input
                type="number"
                value={currentRate}
                onChange={(e) => setCurrentRate(e.target.value === "" ? "" : parseFloat(e.target.value))}
                className="border-2 border-black rounded p-[6px] text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 bg-white"
              />
            </div>
            <button type="button" onClick={handleAddLine} className="bg-black text-white p-[10px] rounded hover:bg-slate-800 transition">
              <Plus size={20} />
            </button>
          </div>

          {lines.length > 0 ? (
            <div className="space-y-4">
              <div className="overflow-x-auto shadow-sm rounded border border-black">
                <table className="min-w-full divide-y divide-black border-collapse border border-black">
                  <thead className="bg-slate-100 divide-x divide-black">
                    <tr className="divide-x divide-black">
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Material</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Qty</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">UOM</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Rate</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Value</th>
                      <th className="px-4 py-3 text-right border border-black"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black bg-white">
                    {lines.map((line) => {
                      const materialName = getMaterial(line.itemId)?.name || "Unknown";
                      return (
                        <tr key={line.id} className="divide-x divide-black">
                          <td className="px-4 py-3 text-sm text-black border border-black">{materialName}</td>
                          <td className="px-4 py-3 text-sm text-black border border-black">{line.qty}</td>
                          <td className="px-4 py-3 text-sm text-black border border-black">{line.uom}</td>
                          <td className="px-4 py-3 text-sm text-black border border-black">{line.rate}</td>
                          <td className="px-4 py-3 text-sm font-medium text-black border border-black">{line.value}</td>
                          <td className="px-4 py-3 text-right border border-black">
                            <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-600 hover:text-red-800">
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {mrrType === "Reel"
                ? lines.map((line) => {
                    const slipRows = packingSlipDrafts[line.id] || [];
                    const poOptions = getApprovedPoOptionsForMaterial(line.itemId);
                    return (
                      <div key={line.id} className="rounded border border-black bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-4">
                          <div>
                            <h4 className="font-bold text-black">{getMaterial(line.itemId)?.name || "Reel Material"}</h4>
                            <p className="text-sm text-slate-500">Packing Slip</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddPackingSlip(line)}
                            className="inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 transition"
                          >
                            <Plus size={16} /> Add Reel
                          </button>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="min-w-full border-collapse border border-black">
                            <thead className="bg-slate-100">
                              <tr>
                                {["Supplier Reel No.", "Our Reel No.", "Weight (KG)", "Supplier PO No.", "Our PO No.", "Action"].map((heading) => (
                                  <th key={heading} className="border border-black px-3 py-2 text-left text-xs font-bold uppercase text-black">
                                    {heading}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {slipRows.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="border border-black px-4 py-6 text-center text-sm text-slate-500">
                                    No reels added yet.
                                  </td>
                                </tr>
                              ) : (
                                slipRows.map((slip) => (
                                  <tr key={slip.id}>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        value={slip.supplierReelNo}
                                        onChange={(e) => updatePackingSlip(line.id, slip.id, { supplierReelNo: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        value={slip.ourReelNo}
                                        readOnly
                                        className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-black"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={slip.weightKg}
                                        onChange={(e) => updatePackingSlip(line.id, slip.id, { weightKg: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2">
                                      <input
                                        value={slip.supplierPoNo}
                                        onChange={(e) => updatePackingSlip(line.id, slip.id, { supplierPoNo: e.target.value })}
                                        className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2 min-w-[220px]">
                                      <Select
                                        options={poOptions}
                                        value={slip.ourPoId}
                                        onChange={(value) => {
                                          const selectedOption = poOptions.find((option) => option.value === value);
                                          updatePackingSlip(line.id, slip.id, {
                                            ourPoId: value,
                                            ourPoNo: selectedOption?.label || "",
                                          });
                                        }}
                                        placeholder="Select PO..."
                                      />
                                    </td>
                                    <td className="border border-black px-3 py-2 text-right">
                                      <button type="button" onClick={() => removePackingSlip(line.id, slip.id)} className="text-red-600 hover:text-red-800">
                                        <Trash2 size={16} />
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
                  })
                : null}
            </div>
          ) : (
            <div className="p-4 bg-slate-50 text-black rounded border border-dashed border-black text-sm text-center">
              No items added yet. Please add at least one line item.
            </div>
          )}
          <div className="mt-4 text-right font-bold text-black text-xl">
            Total Amount: <span className="text-indigo-700">Rs {totalAmount.toLocaleString()}</span>
          </div>
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
