import React, { useCallback, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Save,
  Search,
  X,
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { ClientPagination } from "../components/ClientPagination";
import { useData } from "../hooks/useData";
import { useClientPagination } from "../hooks/useClientPagination";
import { computePurchaseOrderTaxes, summarizePurchaseOrderLines } from "../lib/purchaseOrderTaxes";
import { renderOrganizationHeader } from "../lib/pdfOrganizationHeader";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import type {
  Indent,
  IndentLine,
  Material,
  PurchaseOrder,
  PurchaseOrderLine,
  Setting,
  Supplier,
} from "../types";

type Mode = "pending-approval" | "approved" | "rejected" | "all";

interface PurchaseOrderListProps {
  mode?: Mode;
}

type EditingHeader = {
  poDate: string;
  requiredDate: string;
  roundOff: string;
};

type EditingLineDraft = {
  qty: string;
  rate: string;
  gstRate: string;
  targetDeliveryDate: string;
};

export function PurchaseOrderAll() {
  return <PurchaseOrderList mode="all" />;
}

export function PurchaseOrderPendingApproval() {
  return <PurchaseOrderList mode="pending-approval" />;
}

export function PurchaseOrderApproved() {
  return <PurchaseOrderList mode="approved" />;
}

export function PurchaseOrderRejected() {
  return <PurchaseOrderList mode="rejected" />;
}

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PurchaseOrderList({ mode = "all" }: PurchaseOrderListProps) {
  const [purchaseOrders, setPurchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [orderLines, setPurchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [indents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [pdfOrderId, setPdfOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState<EditingHeader | null>(null);
  const [editingLines, setEditingLines] = useState<Record<string, EditingLineDraft>>({});

  const currentSetting = settings[0];
  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplierNameMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const indentMap = useMemo(() => new Map(indents.map((indent) => [indent.id, indent])), [indents]);
  const indentLineMap = useMemo(() => new Map(indentLines.map((line) => [line.id, line])), [indentLines]);

  const getOrderIndentRefs = useCallback((order: PurchaseOrder, lines: PurchaseOrderLine[]) => {
    const refs = new Set<string>();
    if (order.indentId) {
      const indentNo = indentMap.get(order.indentId)?.indentNo;
      if (indentNo) refs.add(indentNo);
    }
    for (const line of lines) {
      const indentId = indentLineMap.get(line.indentLineId)?.indentId;
      const indentNo = indentId ? indentMap.get(indentId)?.indentNo : "";
      if (indentNo) refs.add(indentNo);
    }
    return Array.from(refs);
  }, [indentLineMap, indentMap]);

  const filteredOrders = useMemo(() => {
    return purchaseOrders
      .filter((po) => {
        if (mode === "pending-approval") return po.status === "Pending Approval";
        if (mode === "approved") return po.status === "Approved";
        if (mode === "rejected") return po.status === "Rejected";
        return true;
      })
      .filter((po) => {
        const supplierName = (supplierNameMap.get(po.supplierId) || "").toLowerCase();
        const poNo = (po.poNo || "").toLowerCase();
        const search = searchTerm.toLowerCase();
        return supplierName.includes(search) || poNo.includes(search);
      })
      .sort(
        (a, b) =>
          new Date(b.updateTimestamp || b.poDate || 0).getTime() -
          new Date(a.updateTimestamp || a.poDate || 0).getTime(),
      );
  }, [mode, purchaseOrders, searchTerm, supplierNameMap]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedOrders,
  } = useClientPagination(filteredOrders, 25);

  const handleToggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const cancelEditing = useCallback(() => {
    setEditingOrderId(null);
    setEditingHeader(null);
    setEditingLines({});
  }, []);

  const startEditing = useCallback((order: PurchaseOrder, lines: PurchaseOrderLine[]) => {
    setEditingOrderId(order.id);
    setEditingHeader({
      poDate: order.poDate || "",
      requiredDate: order.requiredDate || "",
      roundOff: String(Number(order.roundOff || 0)),
    });
    setEditingLines(
      Object.fromEntries(
        lines.map((line) => [
          line.id,
          {
            qty: String(Number(line.qty || 0)),
            rate: String(Number(line.rate || 0)),
            gstRate: String(Number(line.gstRate || 0)),
            targetDeliveryDate: line.targetDeliveryDate || "",
          },
        ]),
      ),
    );
    setRejectingId(null);
    setConfirmId(null);
    setRemarks("");
    setExpandedRows((prev) => new Set(prev).add(order.id));
  }, []);

  const getRenderedLines = useCallback((order: PurchaseOrder, lines: PurchaseOrderLine[]) => {
    if (editingOrderId !== order.id) return lines;
    const supplyType = supplierMap.get(order.supplierId)?.gstSupplyType;

    return lines.map((line) => {
      const draft = editingLines[line.id];
      if (!draft) return line;

      const taxes = computePurchaseOrderTaxes(
        Number(draft.qty || 0),
        Number(draft.rate || 0),
        Number(draft.gstRate || 0),
        supplyType,
      );

      return {
        ...line,
        qty: Number(draft.qty || 0),
        rate: Number(draft.rate || 0),
        gstRate: taxes.gstRate,
        amount: taxes.amount,
        cgst: taxes.cgst,
        sgst: taxes.sgst,
        igst: taxes.igst,
        lineTotal: taxes.lineTotal,
        targetDeliveryDate: draft.targetDeliveryDate || undefined,
      };
    });
  }, [editingLines, editingOrderId, supplierMap]);

  const getRenderedTotals = useCallback((order: PurchaseOrder, lines: PurchaseOrderLine[]) => {
    const previewLines = getRenderedLines(order, lines);
    const totals = summarizePurchaseOrderLines(previewLines);
    const roundOff = editingOrderId === order.id
      ? Number(editingHeader?.roundOff || 0)
      : Number(order.roundOff || 0);

    return {
      ...totals,
      roundOff,
      grandTotal: Number((totals.grandTotal + roundOff).toFixed(2)),
    };
  }, [editingHeader?.roundOff, editingOrderId, getRenderedLines]);

  const handleSaveEdit = async (order: PurchaseOrder, lines: PurchaseOrderLine[]) => {
    if (editingOrderId !== order.id || !editingHeader) return;

    const roundOff = Number(editingHeader.roundOff || 0);
    if (!Number.isFinite(roundOff)) {
      alert("Please enter a valid round off value.");
      return;
    }

    const timestamp = new Date().toISOString();
    const supplyType = supplierMap.get(order.supplierId)?.gstSupplyType;

    try {
      const updatedLines = lines.map((line) => {
        const draft = editingLines[line.id];
        const itemName = materialMap.get(line.materialId)?.name || "the item";
        const qty = Number(draft?.qty || 0);
        const rate = Number(draft?.rate || 0);
        const gstRate = Number(draft?.gstRate || 0);

        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`Please enter a valid qty for ${itemName}.`);
        }
        if (!Number.isFinite(rate) || rate < 0) {
          throw new Error(`Please enter a valid rate for ${itemName}.`);
        }
        if (!Number.isFinite(gstRate) || gstRate < 0) {
          throw new Error(`Please enter a valid GST Rate for ${itemName}.`);
        }

        const taxes = computePurchaseOrderTaxes(qty, rate, gstRate, supplyType);

        return {
          ...line,
          qty,
          rate,
          amount: taxes.amount,
          gstRate: taxes.gstRate,
          cgst: taxes.cgst,
          sgst: taxes.sgst,
          igst: taxes.igst,
          lineTotal: taxes.lineTotal,
          targetDeliveryDate: draft?.targetDeliveryDate || undefined,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
      });

      const totals = summarizePurchaseOrderLines(updatedLines);
      const updatedOrder: PurchaseOrder = {
        ...order,
        poDate: editingHeader.poDate || order.poDate,
        requiredDate: editingHeader.requiredDate || order.requiredDate,
        totalQty: totals.totalQty,
        totalAmount: totals.taxableAmount,
        taxableAmount: totals.taxableAmount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff,
        grandTotal: Number((totals.grandTotal + roundOff).toFixed(2)),
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };

      await setPurchaseOrderLines((prev) =>
        prev.map((row) => updatedLines.find((line) => line.id === row.id) || row),
      );
      await setPurchaseOrders((prev) =>
        prev.map((row) => (row.id === order.id ? updatedOrder : row)),
      );
      cancelEditing();
    } catch (error) {
      console.error("Failed to save purchase order:", error);
      alert((error as Error).message || "Failed to save purchase order.");
    }
  };

  const handleApprove = async (order: PurchaseOrder) => {
    if (editingOrderId) {
      alert("Please save or cancel the current edit before approving a purchase order.");
      return;
    }

    if (confirmId !== order.id) {
      setConfirmId(order.id);
      setRejectingId(null);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }

    setSubmittingId(order.id);
    try {
      const timestamp = new Date().toISOString();
      await setPurchaseOrders((prev) =>
        prev.map((row) =>
          row.id === order.id
            ? {
                ...row,
                status: "Approved",
                approvedBy: "System User",
                approvedTimestamp: timestamp,
                updatedBy: "System User",
                updateTimestamp: timestamp,
              }
            : row,
        ),
      );
      setConfirmId(null);
    } catch (error) {
      console.error("Failed to approve purchase order:", error);
      alert("Failed to approve purchase order.");
    } finally {
      setSubmittingId(null);
    }
  };

  const handleReject = async (order: PurchaseOrder) => {
    if (editingOrderId && editingOrderId !== order.id) {
      alert("Please save or cancel the current edit before rejecting another purchase order.");
      return;
    }

    if (rejectingId !== order.id) {
      setRejectingId(order.id);
      setConfirmId(null);
      setRemarks("");
      return;
    }

    if (!remarks.trim()) {
      alert("Please enter rejection remarks.");
      return;
    }

    setSubmittingId(order.id);
    try {
      const timestamp = new Date().toISOString();
      await setPurchaseOrders((prev) =>
        prev.map((row) =>
          row.id === order.id
            ? {
                ...row,
                status: "Rejected",
                rejectedBy: "System User",
                rejectedTimestamp: timestamp,
                rejectedRemarks: remarks.trim(),
                updatedBy: "System User",
                updateTimestamp: timestamp,
              }
            : row,
        ),
      );
      setConfirmId(null);
      cancelEditing();
    } catch (error) {
      console.error("Failed to reject purchase order:", error);
      alert("Failed to reject purchase order.");
    } finally {
      setSubmittingId(null);
    }
  };

  const getTitle = (m: Mode) => {
    switch (m) {
      case "pending-approval":
        return "Pending PO Approvals";
      case "approved":
        return "Approved Purchase Orders";
      case "rejected":
        return "Rejected Purchase Orders";
      default:
        return "Purchase Orders Master";
    }
  };

  const handleExportPdf = () => {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(16);
    doc.text(getTitle(mode), 14, 16);
    doc.setFontSize(10);
    doc.text(`Search: ${searchTerm || "All"} | Total POs: ${filteredOrders.length}`, 14, 24);

    autoTable(doc, {
      head: [[
        "PO No",
        "Date",
        "Supplier",
        "Items Summary",
        "Total Qty",
        "Total Amount",
        ...(mode === "rejected" ? ["Rejection Reason"] : []),
        "Status",
      ]],
      body: filteredOrders.map((order) => {
        const lines = orderLines.filter((line) => line.purchaseOrderId === order.id);
        const itemsSummary = lines
          .map((line) => materialMap.get(line.materialId)?.name || "Unknown")
          .join(", ");

        return [
          order.poNo || "DRAFT",
          formatDate(order.poDate),
          supplierNameMap.get(order.supplierId) || "Unknown",
          itemsSummary,
          Number(order.totalQty || 0).toLocaleString(),
          Number(order.grandTotal ?? order.totalAmount ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          ...(mode === "rejected" ? [order.rejectedRemarks || ""] : []),
          order.status,
        ];
      }),
      startY: 30,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: {
        3: { cellWidth: 90 },
      },
    });

    doc.save(`${getTitle(mode).replace(/\s+/g, "_")}.pdf`);
  };

  const handleRowPdf = async (order: PurchaseOrder) => {
    const lines = orderLines.filter((line) => line.purchaseOrderId === order.id);
    const indentRefs = getOrderIndentRefs(order, lines);
    const supplierName = supplierNameMap.get(order.supplierId) || "Unknown";
    const showIntegratedTax = Number(order.igst || 0) > 0 && Number(order.cgst || 0) === 0 && Number(order.sgst || 0) === 0;
    const doc = new jsPDF("p", "mm", "a4");
    setPdfOrderId(order.id);

    try {
      const { currentY } = await renderOrganizationHeader(doc, currentSetting, { startY: 12 });
      let y = currentY;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Purchase Order", 105, y, { align: "center" });
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`PO No: ${order.poNo || "DRAFT"}`, 14, y);
      doc.text(`Status: ${order.status}`, 140, y);
      y += 6;
      doc.text(`Supplier: ${supplierName}`, 14, y);
      doc.text(`Indent Ref: ${indentRefs.join(", ") || "-"}`, 140, y);
      y += 6;
      doc.text(`PO Date: ${formatDate(order.poDate)}`, 14, y);
      doc.text(`Required Date: ${formatDate(order.requiredDate)}`, 140, y);
      y += 6;
      doc.text(`Total Qty: ${Number(order.totalQty || 0).toLocaleString()}`, 14, y);
      doc.text(`Grand Total: ${formatMoney(Number(order.grandTotal ?? order.totalAmount ?? 0))}`, 140, y);
      y += 8;

      if (order.rejectedRemarks?.trim()) {
        doc.setFont("helvetica", "normal");
        const noteLines = doc.splitTextToSize(`Rejection Reason: ${order.rejectedRemarks.trim()}`, 180);
        doc.text(noteLines, 14, y);
        y += noteLines.length * 5 + 2;
      }

      autoTable(doc, {
        startY: y,
        theme: "grid",
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 8, cellPadding: 2 },
        head: [[
          "ERP",
          "Item",
          "Qty",
          "UOM",
          "Rate",
          "GST Rate",
          ...(showIntegratedTax ? ["IGST"] : ["CGST", "SGST"]),
          "Amount",
          "Amount after GST",
          "Target Delivery",
        ]],
        body: lines.map((line) => [
          line.erpCode || materialMap.get(line.materialId)?.erpCode || "",
          materialMap.get(line.materialId)?.name || "Unknown",
          Number(line.qty || 0).toLocaleString(),
          line.uom || "",
          formatMoney(Number(line.rate || 0)),
          `${Number(line.gstRate || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
          ...(showIntegratedTax
            ? [formatMoney(Number(line.igst || 0))]
            : [formatMoney(Number(line.cgst || 0)), formatMoney(Number(line.sgst || 0))]),
          formatMoney(Number(line.amount || line.qty * line.rate || 0)),
          formatMoney(Number(line.lineTotal ?? (Number(line.amount || 0) + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0)))),
          line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "-",
        ]),
      });

      const finalY = (doc as any).lastAutoTable?.finalY || y;
      const taxableAmount = Number(order.taxableAmount ?? order.totalAmount ?? 0);
      const cgst = Number(order.cgst || 0);
      const sgst = Number(order.sgst || 0);
      const igst = Number(order.igst || 0);
      const roundOff = Number(order.roundOff || 0);
      const grandTotal = Number(order.grandTotal ?? order.totalAmount ?? 0);
      const summaryY = finalY + 8;

      doc.setFont("helvetica", "bold");
      doc.text("Summary", 140, summaryY);
      doc.setFont("helvetica", "normal");
      doc.text(`Taxable Amount: ${formatMoney(taxableAmount)}`, 140, summaryY + 6);
      if (showIntegratedTax) {
        doc.text(`IGST: ${formatMoney(igst)}`, 140, summaryY + 12);
        doc.text(`Round Off: ${formatMoney(roundOff)}`, 140, summaryY + 18);
        doc.setFont("helvetica", "bold");
        doc.text(`Grand Total: ${formatMoney(grandTotal)}`, 140, summaryY + 26);
      } else {
        doc.text(`CGST: ${formatMoney(cgst)}`, 140, summaryY + 12);
        doc.text(`SGST: ${formatMoney(sgst)}`, 140, summaryY + 18);
        doc.text(`Round Off: ${formatMoney(roundOff)}`, 140, summaryY + 24);
        doc.setFont("helvetica", "bold");
        doc.text(`Grand Total: ${formatMoney(grandTotal)}`, 140, summaryY + 32);
      }

      doc.save(`PO_${order.poNo || order.id}.pdf`);
    } finally {
      setPdfOrderId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{getTitle(mode)}</h2>
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:justify-end">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search PO, supplier..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100">
            <tr className="divide-x divide-black border-b border-black">
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">PO Info</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">Supplier</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">Items Summary</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Total Qty</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Total Amount</th>
              {mode === "rejected" ? (
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">Rejection Reason</th>
              ) : null}
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black">
            {paginatedOrders.length === 0 ? (
              <tr>
                <td colSpan={mode === "rejected" ? 8 : 7} className="px-4 py-12 text-center text-slate-500 italic">
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((order) => {
                const isExpanded = expandedRows.has(order.id);
                const lines = orderLines.filter((line) => line.purchaseOrderId === order.id);
                const renderedLines = getRenderedLines(order, lines);
                const renderedTotals = getRenderedTotals(order, lines);
                const indentRefs = getOrderIndentRefs(order, lines);
                const showIntegratedTax = Number(renderedTotals.igst || 0) > 0 && Number(renderedTotals.cgst || 0) === 0 && Number(renderedTotals.sgst || 0) === 0;
                const isEditing = editingOrderId === order.id;
                const isAnotherOrderEditing = Boolean(editingOrderId && editingOrderId !== order.id);

                return (
                  <React.Fragment key={order.id}>
                    <tr className={cn("hover:bg-slate-50 transition-colors divide-x divide-black", isExpanded && "bg-slate-50/50")}>
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => handleToggleRow(order.id)}
                          className="p-1 hover:bg-slate-200 rounded transition"
                        >
                          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-bold text-sm text-black uppercase">{order.poNo || "DRAFT"}</div>
                        <div className="text-[10px] text-slate-500 font-bold uppercase">{formatDate(order.poDate)}</div>
                        {mode !== "pending-approval" && (
                          <div
                            className={cn(
                              "mt-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase",
                              order.status === "Approved"
                                ? "border-emerald-700 bg-emerald-100 text-emerald-800"
                                : order.status === "Rejected"
                                  ? "border-red-700 bg-red-100 text-red-800"
                                  : "border-amber-700 bg-amber-100 text-amber-800",
                            )}
                          >
                            {order.status}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-black font-medium">{supplierNameMap.get(order.supplierId) || "Unknown"}</td>
                      <td className="px-4 py-4">
                        <ul className="list-none space-y-0.5">
                          {renderedLines.slice(0, 2).map((line, idx) => (
                            <li key={idx} className="text-[10px] text-slate-700 font-bold uppercase truncate max-w-[200px]">
                              - {materialMap.get(line.materialId)?.name || "Unknown"}
                            </li>
                          ))}
                          {renderedLines.length > 2 && (
                            <li className="text-[9px] text-indigo-600 font-black uppercase">
                              + {renderedLines.length - 2} MORE ITEMS
                            </li>
                          )}
                        </ul>
                      </td>
                      <td className="px-4 py-4 text-sm text-black text-right font-bold">
                        {Number(renderedTotals.totalQty || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-sm text-black text-right font-mono font-bold">
                        {formatMoney(Number(renderedTotals.grandTotal || 0))}
                      </td>
                      {mode === "rejected" ? (
                        <td className="px-4 py-4 text-sm text-red-700 italic">{order.rejectedRemarks || ""}</td>
                      ) : null}
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRowPdf(order)}
                            disabled={pdfOrderId === order.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-300 bg-rose-50 text-rose-700 font-black text-[10px] uppercase hover:bg-rose-100 transition disabled:opacity-50"
                          >
                            {pdfOrderId === order.id ? <Spinner size={12} /> : <FileText size={14} />}
                            PDF
                          </button>
                          {mode === "pending-approval" ? (
                            isEditing ? (
                              <>
                                <button
                                  onClick={() => void handleSaveEdit(order, lines)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border-2 border-emerald-700 bg-emerald-50 text-emerald-700 font-black text-[10px] uppercase hover:bg-emerald-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                >
                                  <Save size={14} /> Save
                                </button>
                                <button
                                  onClick={cancelEditing}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border-2 border-slate-500 bg-slate-50 text-slate-700 font-black text-[10px] uppercase hover:bg-slate-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                >
                                  <X size={14} /> Cancel
                                </button>
                              </>
                            ) : rejectingId === order.id ? (
                              <div className="flex flex-col gap-2 min-w-[200px]">
                                <textarea
                                  value={remarks}
                                  onChange={(e) => setRemarks(e.target.value)}
                                  placeholder="Enter reason for rejection..."
                                  className="w-full rounded border-2 border-red-600 p-2 text-xs focus:outline-none"
                                  rows={2}
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => void handleReject(order)}
                                    disabled={submittingId === order.id}
                                    className="flex-1 bg-red-600 text-white px-3 py-1.5 rounded text-[10px] font-black uppercase"
                                  >
                                    Confirm Reject
                                  </button>
                                  <button
                                    onClick={() => setRejectingId(null)}
                                    className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-[10px] font-black uppercase"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEditing(order, lines)}
                                  disabled={isAnotherOrderEditing}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border-2 border-indigo-700 bg-indigo-50 text-indigo-700 font-black text-[10px] uppercase hover:bg-indigo-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
                                >
                                  <Pencil size={14} /> Edit
                                </button>
                                <button
                                  onClick={() => void handleApprove(order)}
                                  disabled={submittingId === order.id || isAnotherOrderEditing}
                                  className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded border-2 font-black text-[10px] uppercase transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50",
                                    confirmId === order.id
                                      ? "bg-emerald-600 text-white border-black animate-pulse"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-700 hover:bg-emerald-100",
                                  )}
                                >
                                  {submittingId === order.id ? (
                                    <Spinner size={12} />
                                  ) : (
                                    <>
                                      <Check size={14} />
                                      {confirmId === order.id ? "Confirm Approve?" : "Approve"}
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={() => void handleReject(order)}
                                  disabled={submittingId === order.id || isAnotherOrderEditing}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border-2 border-red-700 bg-red-50 text-red-700 font-black text-[10px] uppercase hover:bg-red-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
                                >
                                  <X size={14} /> Reject
                                </button>
                              </>
                            )
                          ) : (
                            <button
                              onClick={() => void handleToggleRow(order.id)}
                              className="text-indigo-600 hover:text-indigo-900 font-bold uppercase flex items-center gap-1 text-[11px]"
                            >
                              {isExpanded ? "Hide" : "Details"}
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={mode === "rejected" ? 8 : 7} className="px-12 py-4">
                          <div className="border-2 border-black rounded overflow-hidden shadow-sm">
                            <div className="bg-slate-200 px-4 py-2 text-[10px] font-black uppercase tracking-wider flex justify-between border-b border-black">
                              <span>PO Items Details</span>
                              <span>Indent Ref: {indentRefs.join(", ") || "-"}</span>
                            </div>
                            <div className="grid gap-3 border-b border-black bg-white px-4 py-3 md:grid-cols-4">
                              <label className="text-[10px] font-black uppercase text-slate-600">
                                PO Date
                                <input
                                  type="date"
                                  value={isEditing ? editingHeader?.poDate || "" : order.poDate || ""}
                                  onChange={(e) => setEditingHeader((prev) => (prev ? { ...prev, poDate: e.target.value } : prev))}
                                  disabled={!isEditing}
                                  className="mt-1 w-full rounded border border-black px-2 py-1.5 text-xs font-medium text-black disabled:bg-slate-100"
                                />
                              </label>
                              <label className="text-[10px] font-black uppercase text-slate-600">
                                Required Date
                                <input
                                  type="date"
                                  value={isEditing ? editingHeader?.requiredDate || "" : order.requiredDate || ""}
                                  onChange={(e) => setEditingHeader((prev) => (prev ? { ...prev, requiredDate: e.target.value } : prev))}
                                  disabled={!isEditing}
                                  className="mt-1 w-full rounded border border-black px-2 py-1.5 text-xs font-medium text-black disabled:bg-slate-100"
                                />
                              </label>
                              <label className="text-[10px] font-black uppercase text-slate-600">
                                Round Off
                                <input
                                  type="number"
                                  step="0.01"
                                  value={isEditing ? editingHeader?.roundOff || "0" : String(Number(order.roundOff || 0))}
                                  onChange={(e) => setEditingHeader((prev) => (prev ? { ...prev, roundOff: e.target.value } : prev))}
                                  disabled={!isEditing}
                                  className="mt-1 w-full rounded border border-black px-2 py-1.5 text-xs font-medium text-black disabled:bg-slate-100"
                                />
                              </label>
                              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-[10px] font-black uppercase text-slate-600">Grand Total</div>
                                <div className="mt-1 text-sm font-black text-slate-900">{formatMoney(renderedTotals.grandTotal)}</div>
                              </div>
                            </div>
                            <table className="min-w-full divide-y divide-black">
                              <thead className="bg-slate-100">
                                <tr className="divide-x divide-black text-[9px] font-black uppercase text-slate-500">
                                  <th className="px-3 py-2 text-left">ERP</th>
                                  <th className="px-3 py-2 text-left">Item Name</th>
                                  <th className="px-3 py-2 text-right">Qty</th>
                                  <th className="px-3 py-2 text-center">UOM</th>
                                  <th className="px-3 py-2 text-right">Rate</th>
                                  <th className="px-3 py-2 text-right">GST Rate</th>
                                  {showIntegratedTax ? (
                                    <th className="px-3 py-2 text-right">IGST</th>
                                  ) : (
                                    <>
                                      <th className="px-3 py-2 text-right">CGST</th>
                                      <th className="px-3 py-2 text-right">SGST</th>
                                    </>
                                  )}
                                  <th className="px-3 py-2 text-right">Amount</th>
                                  <th className="px-3 py-2 text-right">Amount after GST</th>
                                  <th className="px-3 py-2 text-left">Target Delivery</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-black">
                                {renderedLines.map((line) => (
                                  <tr key={line.id} className="divide-x divide-black text-[10px] font-bold">
                                    <td className="px-3 py-2 text-black">{line.erpCode || materialMap.get(line.materialId)?.erpCode || ""}</td>
                                    <td className="px-3 py-2 text-black uppercase">{materialMap.get(line.materialId)?.name || "Unknown"}</td>
                                    <td className="px-3 py-2 text-right">
                                      {isEditing ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={editingLines[line.id]?.qty || ""}
                                          onChange={(e) =>
                                            setEditingLines((prev) => ({
                                              ...prev,
                                              [line.id]: { ...prev[line.id], qty: e.target.value },
                                            }))
                                          }
                                          className="w-20 rounded border border-black px-2 py-1 text-right"
                                        />
                                      ) : (
                                        Number(line.qty || 0).toLocaleString()
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-center">{line.uom}</td>
                                    <td className="px-3 py-2 text-right">
                                      {isEditing ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={editingLines[line.id]?.rate || ""}
                                          onChange={(e) =>
                                            setEditingLines((prev) => ({
                                              ...prev,
                                              [line.id]: { ...prev[line.id], rate: e.target.value },
                                            }))
                                          }
                                          className="w-24 rounded border border-black px-2 py-1 text-right"
                                        />
                                      ) : (
                                        formatMoney(Number(line.rate || 0))
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {isEditing ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={editingLines[line.id]?.gstRate || ""}
                                          onChange={(e) =>
                                            setEditingLines((prev) => ({
                                              ...prev,
                                              [line.id]: { ...prev[line.id], gstRate: e.target.value },
                                            }))
                                          }
                                          className="w-20 rounded border border-black px-2 py-1 text-right"
                                        />
                                      ) : (
                                        `${Number(line.gstRate || 0).toLocaleString(undefined, {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}%`
                                      )}
                                    </td>
                                    {showIntegratedTax ? (
                                      <td className="px-3 py-2 text-right">{formatMoney(Number(line.igst || 0))}</td>
                                    ) : (
                                      <>
                                        <td className="px-3 py-2 text-right">{formatMoney(Number(line.cgst || 0))}</td>
                                        <td className="px-3 py-2 text-right">{formatMoney(Number(line.sgst || 0))}</td>
                                      </>
                                    )}
                                    <td className="px-3 py-2 text-right">{formatMoney(Number(line.amount || 0))}</td>
                                    <td className="px-3 py-2 text-right">
                                      {formatMoney(Number(line.lineTotal ?? (Number(line.amount || 0) + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0))))}
                                    </td>
                                    <td className="px-3 py-2 text-left">
                                      {isEditing ? (
                                        <input
                                          type="date"
                                          value={editingLines[line.id]?.targetDeliveryDate || ""}
                                          onChange={(e) =>
                                            setEditingLines((prev) => ({
                                              ...prev,
                                              [line.id]: { ...prev[line.id], targetDeliveryDate: e.target.value },
                                            }))
                                          }
                                          className="rounded border border-black px-2 py-1"
                                        />
                                      ) : (
                                        line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "-"
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                <tr className="divide-x divide-black bg-slate-100 text-[10px] font-black">
                                  <td className="px-3 py-2" colSpan={showIntegratedTax ? 7 : 8}>Summary</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(renderedTotals.taxableAmount)}</td>
                                  <td className="px-3 py-2 text-right">{formatMoney(renderedTotals.grandTotal)}</td>
                                  <td className="px-3 py-2 text-left">Round Off: {formatMoney(renderedTotals.roundOff)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExportPdf}
          className="inline-flex min-w-[96px] items-center justify-center gap-2 rounded border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100"
        >
          <FileText size={14} />
          PDF
        </button>
      </div>
    </div>
  );
}
