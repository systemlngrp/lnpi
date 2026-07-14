import { useEffect, useMemo, useState } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Indent, IndentLine, Material, PurchaseOrder, PurchaseOrderLine, Supplier } from "../types";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { formatDate, generateTransactionNo } from "../lib/serial";
import { normalizeIndentLine, summarizeIndentLines, withIndentTotals } from "../lib/indentTotals";
import { computePurchaseOrderTaxes, summarizePurchaseOrderLines } from "../lib/purchaseOrderTaxes";

type RowDraft = {
  supplierId: string;
  poQty: string;
  cancelQty: string;
  rate: string;
  gstRate: string;
};

export function PurchaseOrderCreate() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const navigate = useNavigate();
  const { indentId = "" } = useParams();
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines, setIndentLines] = useData<IndentLine>("indent-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [purchaseOrders, setPurchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines, setPurchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);

  const indent = useMemo(() => indents.find((row) => row.id === indentId) || null, [indentId, indents]);
  const allIndentLines = useMemo(
    () => indentLines.filter((line) => line.indentId === indentId).map(normalizeIndentLine),
    [indentId, indentLines]
  );
  const relevantLines = useMemo(
    () => allIndentLines.filter((line) => Number(line.balanceQty || 0) > 0),
    [allIndentLines]
  );
  const normalizedIndent = useMemo(() => (indent ? withIndentTotals(indent, allIndentLines) : null), [allIndentLines, indent]);
  const [poDate, setPoDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rowDrafts, setRowDrafts] = useState<Record<string, RowDraft>>({});

  const supplierOptions = useMemo(
    () =>
      suppliers
        .filter((supplier) => supplier.active !== "No")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((supplier) => ({ value: supplier.id, label: supplier.name })),
    [suppliers]
  );

  const materialMap = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const purchaseOrderMap = useMemo(() => new Map(purchaseOrders.map((po) => [po.id, po])), [purchaseOrders]);
  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);

  const lastOrderMap = useMemo(() => {
    const best = new Map<string, { rate: number; gstRate: number; poDate: string }>();
    for (const line of purchaseOrderLines) {
      const po = purchaseOrderMap.get(line.purchaseOrderId);
      if (!po?.poDate) continue;
      const materialId = line.materialId;
      const existing = best.get(materialId);
      if (!existing || new Date(po.poDate).getTime() > new Date(existing.poDate).getTime()) {
        best.set(materialId, {
          rate: Number(line.rate || 0),
          gstRate: Number(line.gstRate || 18),
          poDate: po.poDate,
        });
      }
    }
    return best;
  }, [purchaseOrderLines, purchaseOrderMap]);

  const getDraft = (lineId: string): RowDraft => rowDrafts[lineId] || { supplierId: "", poQty: "", cancelQty: "", rate: "", gstRate: "18" };

  const setDraftField = (lineId: string, patch: Partial<RowDraft>) => {
    setRowDrafts((prev) => ({
      ...prev,
      [lineId]: {
        ...getDraft(lineId),
        ...patch,
      },
    }));
  };

  useEffect(() => {
    if (relevantLines.length === 0) return;
    setRowDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const line of relevantLines) {
        if (next[line.id]) continue;
        const balanceQty = Number(line.balanceQty || 0);
        const last = lastOrderMap.get(line.materialId);
        next[line.id] = {
          supplierId: "",
          poQty: balanceQty > 0 ? String(balanceQty) : "",
          cancelQty: "",
          rate: last?.rate ? String(last.rate) : "",
          gstRate: String(last?.gstRate || 18),
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [lastOrderMap, relevantLines]);

  const computedPreviewLines = useMemo(() => {
    return relevantLines
      .map((line) => {
        const draft = getDraft(line.id);
        const poQty = Number(draft.poQty || 0);
        const rate = Number(draft.rate || 0);
        const gstRate = Number(draft.gstRate || 0);
        const supplier = supplierMap.get(draft.supplierId);
        const taxes = computePurchaseOrderTaxes(poQty, rate, gstRate, supplier?.gstSupplyType);
        return {
          lineId: line.id,
          supplierId: draft.supplierId,
          ...taxes,
          qty: poQty,
        };
      })
      .filter((line) => line.qty > 0);
  }, [relevantLines, rowDrafts, supplierMap]);

  const previewTotals = useMemo(
    () => summarizePurchaseOrderLines(computedPreviewLines),
    [computedPreviewLines],
  );

  const handleCreatePo = async () => {
    if (!indent || !normalizedIndent) return;

    const actionableLines = relevantLines.map((line) => {
      const draft = getDraft(line.id);
      const poQty = Number(draft.poQty || 0);
      const cancelQty = Number(draft.cancelQty || 0);
          const rate = Number(draft.rate || 0);
          const gstRate = Number(draft.gstRate || 0);
      return { line, draft, poQty, cancelQty, rate, gstRate };
    });

    const hasAnyAction = actionableLines.some(({ poQty, cancelQty }) => poQty > 0 || cancelQty > 0);
    if (!hasAnyAction) {
      alert("Enter PO Quantity and/or Cancel Quantity for at least one indent line.");
      return;
    }

    for (const entry of actionableLines) {
      const { line, draft, poQty, cancelQty, rate, gstRate } = entry;
      const balanceQty = Number(line.balanceQty || 0);
      if (poQty < 0 || cancelQty < 0) {
        alert("PO Quantity and Cancel Quantity cannot be negative.");
        return;
      }
      if (poQty + cancelQty > balanceQty) {
        alert("PO Quantity + Cancel Quantity cannot be more than the current balance quantity.");
        return;
      }
      if (poQty > 0 && !draft.supplierId) {
        alert("Please select a supplier for each line with PO Quantity.");
        return;
      }
      if (poQty > 0 && rate <= 0) {
        alert("Please enter a rate greater than 0 for each ordered line.");
        return;
      }
      if (poQty > 0 && gstRate < 0) {
        alert("Please enter a GST Rate greater than or equal to 0 for each ordered line.");
        return;
      }
    }

    setIsSubmitting(true);
    const timestamp = new Date().toISOString();
    const newOrders: PurchaseOrder[] = [];
    const newOrderLines: PurchaseOrderLine[] = [];
    const orderGroups = new Map<string, { supplierId: string; lines: Array<{ line: IndentLine; poQty: number; rate: number; gstRate: number }> }>();

    actionableLines.forEach(({ line, draft, poQty, rate, gstRate }) => {
      if (poQty <= 0 || !draft.supplierId) return;
      const existing = orderGroups.get(draft.supplierId) || { supplierId: draft.supplierId, lines: [] };
      existing.lines.push({ line, poQty, rate, gstRate });
      orderGroups.set(draft.supplierId, existing);
    });

    try {
      orderGroups.forEach((group) => {
        const poNo = generateTransactionNo(
          "PO",
          [...purchaseOrders, ...newOrders].map((order) => ({
            transactionNo: order.poNo,
            date: order.poDate,
          })),
          poDate
        );
        const purchaseOrderId = crypto.randomUUID();
        const supplier = supplierMap.get(group.supplierId);
        const nextOrderLines: PurchaseOrderLine[] = [];
        group.lines.forEach(({ line, poQty, rate, gstRate }) => {
          const taxes = computePurchaseOrderTaxes(poQty, rate, gstRate, supplier?.gstSupplyType);
          nextOrderLines.push({
            id: crypto.randomUUID(),
            purchaseOrderId,
            indentLineId: line.id,
            materialId: line.materialId,
            erpCode: line.erpCode,
            uom: line.uom,
            qty: poQty,
            rate,
            amount: taxes.amount,
            gstRate: taxes.gstRate,
            cgst: taxes.cgst,
            sgst: taxes.sgst,
            igst: taxes.igst,
            lineTotal: taxes.lineTotal,
            targetDeliveryDate: (line.targetDeliveryDate || "").trim() || undefined,
            updatedBy: "System User",
            updateTimestamp: timestamp,
          });
        });
        const totals = summarizePurchaseOrderLines(nextOrderLines);
        const nextOrder: PurchaseOrder = {
          id: purchaseOrderId,
          poNo,
          indentId: indent.id,
          supplierId: group.supplierId,
          poDate,
          requiredDate: indent.requiredDate,
          totalQty: totals.totalQty,
          totalAmount: totals.taxableAmount,
          taxableAmount: totals.taxableAmount,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          grandTotal: totals.grandTotal,
          remarks: remarks.trim() || undefined,
          status: "Pending Approval",
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
        newOrders.push(nextOrder);
        newOrderLines.push(...nextOrderLines);
      });

      const nextIndentLines = indentLines.map((line) => {
        if (line.indentId !== indent.id) return line;
        const action = actionableLines.find((entry) => entry.line.id === line.id);
        if (!action) return line;
        const orderedQty = Number(line.orderedQty || 0) + action.poQty;
        const cancelledQty = Number(line.cancelledQty || 0) + action.cancelQty;
        const balanceQty = Math.max(0, Number(line.qty || 0) - orderedQty - cancelledQty);
        return {
          ...line,
          orderedQty,
          cancelledQty,
          balanceQty,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
      });

      const nextIndentSummary = summarizeIndentLines(nextIndentLines.filter((line) => line.indentId === indent.id));
      const nextIndentStatus: Indent["status"] = nextIndentSummary.totalBalanceQty <= 0 ? "Completed" : "Approved";
      const nextIndent = {
        ...indent,
        status: nextIndentStatus,
        totalIndentQty: nextIndentSummary.totalIndentQty,
        totalOrderedQty: nextIndentSummary.totalOrderedQty,
        totalCancelledQty: nextIndentSummary.totalCancelledQty,
        totalBalanceQty: nextIndentSummary.totalBalanceQty,
        completedTimestamp: nextIndentStatus === "Completed" ? (indent.completedTimestamp || timestamp) : indent.completedTimestamp,
        completedBy: nextIndentStatus === "Completed" ? (indent.completedBy || "System User") : indent.completedBy,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      await setPurchaseOrders([...newOrders, ...purchaseOrders]);
      if (newOrderLines.length > 0) {
        await setPurchaseOrderLines([...purchaseOrderLines, ...newOrderLines]);
      }
      await setIndentLines(nextIndentLines);
      await setIndents(indents.map((row) => (row.id === indent.id ? nextIndent : row)));

      alert(newOrders.length > 0 ? `${newOrders.length} purchase order(s) created.` : "Indent quantities updated.");
      navigate("/purchase-orders/pending-approval");
    } catch (error) {
      console.error("Failed to create purchase orders:", error);
      alert("Failed to create purchase orders.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!indent || !normalizedIndent) {
    return (
      <>
        <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

        <div className="bg-white rounded-xl border border-black p-6 shadow-sm space-y-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Create Purchase Order</h2>
        <p className="text-black font-medium">Approved indent not found.</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-5 py-2 rounded border border-black text-black font-bold hover:bg-slate-50 transition"
        >
          Back
        </button>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-black p-6 shadow-sm space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-black uppercase tracking-tight">Create Purchase Order</h2>
            <p className="mt-1 text-sm font-medium text-slate-600">
              Select suppliers line-wise. The system will create separate purchase orders supplier-wise in one click.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-5 py-2 rounded border border-black text-black font-bold hover:bg-slate-50 transition"
          >
            Back
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <SummaryCard label="Requested By" value={indent.requestedBy} />
          <SummaryCard label="Requisition Date" value={formatDate(indent.requisitionDate)} />
          <SummaryCard label="Required Date" value={formatDate(indent.requiredDate)} />
          <SummaryCard label="Indent Type" value={indent.indentType} />
          <SummaryCard label="Total Indent Qty" value={Number(normalizedIndent.totalIndentQty || 0).toLocaleString()} />
          <SummaryCard label="Ordered Qty" value={Number(normalizedIndent.totalOrderedQty || 0).toLocaleString()} />
          <SummaryCard label="Cancelled Qty" value={Number(normalizedIndent.totalCancelledQty || 0).toLocaleString()} />
          <SummaryCard label="Balance Qty" value={Number(normalizedIndent.totalBalanceQty || 0).toLocaleString()} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-blue-700 font-bold">PO Date</label>
            <input
              type="date"
              value={poDate}
              onChange={(e) => setPoDate(e.target.value)}
              className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <div className="space-y-2">
            <label className="text-blue-700 font-bold">Remarks</label>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full rounded border-2 border-black px-4 py-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-black bg-white">
          <div className="overflow-x-auto pb-2">
          <table className="min-w-[1680px] border-collapse">
            <thead className="sticky top-0 z-30">
              <tr className="bg-indigo-700 text-white">
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold">ERP</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold min-w-[280px]">Material</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold">Unit</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[120px]">Indent Qty</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[130px]">Already Ordered Qty</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[140px]">Already Cancelled Qty</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[120px]">Balance Qty</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold min-w-[140px]">Target Delivery</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold min-w-[220px]">Supplier</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[140px]">New PO Qty</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[150px]">New Cancel Qty</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[140px]">Rate</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[120px]">GST Rate</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[120px]">CGST</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[120px]">SGST</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[120px]">IGST</th>
                <th className="border-2 border-black px-4 py-3 text-left text-sm font-bold min-w-[150px]">Last PO</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[160px]">Amount</th>
                <th className="border-2 border-black px-4 py-3 text-right text-sm font-bold min-w-[160px]">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {relevantLines.map((line) => {
                const material = materialMap.get(line.materialId);
                const draft = getDraft(line.id);
                const poQty = Number(draft.poQty || 0);
                const rate = Number(draft.rate || 0);
                const gstRate = Number(draft.gstRate || 0);
                const supplier = supplierMap.get(draft.supplierId);
                const taxes = computePurchaseOrderTaxes(poQty, rate, gstRate, supplier?.gstSupplyType);
                const last = lastOrderMap.get(line.materialId);
                return (
                  <tr key={line.id} className="bg-white hover:bg-slate-50">
                    <td className="border-2 border-black px-4 py-3 text-sm text-black">{line.erpCode || ""}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black">{material?.name || "Unknown Material"}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black">{line.uom || material?.uom || ""}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{Number(line.qty || 0).toLocaleString()}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{Number(line.orderedQty || 0).toLocaleString()}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{Number(line.cancelledQty || 0).toLocaleString()}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm font-bold text-black text-right">{Number(line.balanceQty || 0).toLocaleString()}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black whitespace-nowrap">
                      {line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "-"}
                    </td>
                    <td className="border-2 border-black px-3 py-3">
                      <Select
                        value={draft.supplierId}
                        onChange={(value) => setDraftField(line.id, { supplierId: value })}
                        options={supplierOptions}
                        placeholder="Select supplier"
                      />
                    </td>
                    <td className="border-2 border-black px-3 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.poQty}
                        onChange={(e) => setDraftField(line.id, { poQty: e.target.value })}
                        className="w-[120px] rounded border border-slate-300 px-3 py-2 text-right text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border-2 border-black px-3 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.cancelQty}
                        onChange={(e) => setDraftField(line.id, { cancelQty: e.target.value })}
                        className="w-[130px] rounded border border-slate-300 px-3 py-2 text-right text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border-2 border-black px-3 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.rate}
                        onChange={(e) => setDraftField(line.id, { rate: e.target.value })}
                        className="w-[120px] rounded border border-slate-300 px-3 py-2 text-right text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border-2 border-black px-3 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.gstRate}
                        onChange={(e) => setDraftField(line.id, { gstRate: e.target.value })}
                        className="w-[100px] rounded border border-slate-300 px-3 py-2 text-right text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      />
                    </td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{taxes.cgst ? taxes.cgst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{taxes.sgst ? taxes.sgst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{taxes.igst ? taxes.igst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                    <td className="border-2 border-black px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                      {last ? (
                        <div>
                          <div className="font-bold">{Number(last.rate || 0).toFixed(2)}</div>
                          <div className="text-[10px] text-slate-500">{formatDate(last.poDate)}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border-2 border-black px-4 py-3 text-sm text-black text-right">{taxes.amount ? taxes.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                    <td className="border-2 border-black px-4 py-3 text-sm font-bold text-black text-right">{taxes.lineTotal ? taxes.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        <div className="ml-auto grid max-w-md grid-cols-2 gap-x-6 gap-y-2 rounded border border-black bg-slate-50 p-4 text-sm">
          <div className="font-bold text-slate-700">Taxable Amount</div>
          <div className="text-right font-bold text-black">{previewTotals.taxableAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="font-bold text-slate-700">CGST</div>
          <div className="text-right font-bold text-black">{previewTotals.cgst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="font-bold text-slate-700">SGST</div>
          <div className="text-right font-bold text-black">{previewTotals.sgst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="font-bold text-slate-700">IGST</div>
          <div className="text-right font-bold text-black">{previewTotals.igst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="font-black text-black">Grand Total</div>
          <div className="text-right font-black text-black">{previewTotals.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreatePo()}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center min-w-[160px] rounded bg-indigo-600 px-6 py-3 font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {isSubmitting ? <Spinner size={20} className="text-white" /> : "Create PO"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black bg-slate-50 p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-black">{value}</div>
    </div>
  );
}
