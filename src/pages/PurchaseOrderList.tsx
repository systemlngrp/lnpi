import { useMemo, useState } from "react";
import { Download, ThumbsUp, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useData } from "../hooks/useData";
import { Indent, IndentLine, Material, PurchaseOrder, PurchaseOrderLine, Supplier } from "../types";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { summarizeIndentLines } from "../lib/indentTotals";

type PurchaseOrderMode = "all" | "pending-approval" | "approved" | "rejected";

function getTitle(mode: PurchaseOrderMode) {
  if (mode === "pending-approval") return "Purchase Order: Pending Approval";
  if (mode === "approved") return "Purchase Order: Approved";
  if (mode === "rejected") return "Purchase Order: Rejected";
  return "Purchase Order: All";
}

function getFilteredOrders(orders: PurchaseOrder[], mode: PurchaseOrderMode) {
  if (mode === "all") return orders;
  if (mode === "pending-approval") return orders.filter((order) => order.status === "Pending Approval");
  if (mode === "approved") return orders.filter((order) => order.status === "Approved");
  return orders.filter((order) => order.status === "Rejected");
}

function downloadPurchaseOrderPdf({
  order,
  indent,
  supplierName,
  lines,
  materialMap,
}: {
  order: PurchaseOrder;
  indent?: Indent;
  supplierName: string;
  lines: PurchaseOrderLine[];
  materialMap: Map<string, string>;
}) {
  const doc = new jsPDF("p", "mm", "a4");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("PURCHASE ORDER", 105, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const details: Array<[string, string]> = [
    ["PO No", order.poNo],
    ["PO Date", formatDate(order.poDate)],
    ["Supplier", supplierName],
    ["Indent", indent ? `${indent.requestedBy} (${formatDate(indent.requisitionDate)})` : "-"],
    ["Required Date", indent?.requiredDate ? formatDate(indent.requiredDate) : "-"],
    ["Status", order.status],
  ];

  let y = 24;
  details.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? 14 : 110;
    const rowY = y + Math.floor(index / 2) * 7;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, rowY);
    doc.setFont("helvetica", "normal");
    doc.text(String(value || "-"), x + 28, rowY);
  });
  y += 24;

  const rows = lines.map((line, idx) => [
    idx + 1,
    line.erpCode || "",
    materialMap.get(line.materialId) || "Unknown Material",
    Number(line.qty || 0).toLocaleString(),
    line.uom || "",
    Number(line.rate || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    Number(line.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : indent?.requiredDate ? formatDate(indent.requiredDate) : "-",
  ]);

  autoTable(doc, {
    startY: y,
    head: [["SL", "ERP", "Material", "Qty", "UOM", "Rate", "Amount", "Delivery Date"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: 0 },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      3: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
  });

  const safePoNo = String(order.poNo || "PO").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`PO_${safePoNo}.pdf`);
}

export function PurchaseOrderList({ mode }: { mode: PurchaseOrderMode }) {
  const [purchaseOrders, setPurchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [purchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines, setIndentLines] = useData<IndentLine>("indent-lines", []);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const visibleOrders = useMemo(
    () =>
      getFilteredOrders(purchaseOrders, mode).sort((a, b) => {
        const timeA = new Date(a.updateTimestamp || a.poDate || 0).getTime();
        const timeB = new Date(b.updateTimestamp || b.poDate || 0).getTime();
        return timeB - timeA;
      }),
    [mode, purchaseOrders]
  );

  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const materialMap = useMemo(() => new Map(materials.map((material) => [material.id, material.name])), [materials]);
  const indentMap = useMemo(() => new Map(indents.map((indent) => [indent.id, indent])), [indents]);

  const updateOrder = async (order: PurchaseOrder, patch: Partial<PurchaseOrder>) => {
    setSubmittingId(order.id);
    const timestamp = new Date().toISOString();
    try {
      await setPurchaseOrders(
        purchaseOrders.map((row) =>
          row.id === order.id
            ? {
                ...row,
                ...patch,
                updatedBy: "System User",
                updateTimestamp: timestamp,
              }
            : row
        )
      );
      setConfirmId(null);
    } catch (error) {
      console.error("Failed to update purchase order:", error);
      alert("Failed to update purchase order.");
    } finally {
      setSubmittingId(null);
    }
  };

  const handleApprove = async (order: PurchaseOrder) => {
    if (confirmId !== order.id) {
      setConfirmId(order.id);
      setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    await updateOrder(order, {
      status: "Approved",
      approvedBy: "System User",
      approvedTimestamp: new Date().toISOString(),
    });
  };

  const handleReject = async (order: PurchaseOrder) => {
    const remarks = window.prompt("Enter rejection remarks");
    if (remarks === null) return;
    if (!remarks.trim()) {
      alert("Rejection remarks are required.");
      return;
    }
    setSubmittingId(order.id);
    const timestamp = new Date().toISOString();
    try {
      const affectedPoLines = purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
      const nextIndentLines = indentLines.map((line) => {
        const poLine = affectedPoLines.find((row) => row.indentLineId === line.id);
        if (!poLine) return line;
        const orderedQty = Math.max(0, Number(line.orderedQty || 0) - Number(poLine.qty || 0));
        const cancelledQty = Number(line.cancelledQty || 0);
        const balanceQty = Math.max(0, Number(line.qty || 0) - orderedQty - cancelledQty);
        return {
          ...line,
          orderedQty,
          balanceQty,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
      });

      const nextIndents = indents.map((indent) => {
        if (indent.id !== order.indentId) return indent;
        const summary = summarizeIndentLines(nextIndentLines.filter((line) => line.indentId === indent.id));
        const nextStatus: Indent["status"] = summary.totalBalanceQty <= 0 ? "Completed" : "Approved";
        return {
          ...indent,
          status: nextStatus,
          totalIndentQty: summary.totalIndentQty,
          totalOrderedQty: summary.totalOrderedQty,
          totalCancelledQty: summary.totalCancelledQty,
          totalBalanceQty: summary.totalBalanceQty,
          completedTimestamp: nextStatus === "Completed" ? indent.completedTimestamp : undefined,
          completedBy: nextStatus === "Completed" ? indent.completedBy : undefined,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
      });

      await setIndentLines(nextIndentLines);
      await setIndents(nextIndents);
      await setPurchaseOrders(
        purchaseOrders.map((row) =>
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
            : row
        )
      );
      setConfirmId(null);
    } catch (error) {
      console.error("Failed to reject purchase order:", error);
      alert("Failed to reject purchase order.");
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{getTitle(mode)}</h2>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">PO No.</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">PO Date</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Supplier</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Indent</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Items</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Qty</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Amount</th>
              {mode === "rejected" ? (
                <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Remarks</th>
              ) : null}
              {(mode === "pending-approval" || mode === "all" || mode === "approved" || mode === "rejected") ? (
                <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visibleOrders.length === 0 ? (
              <tr>
                <td colSpan={mode === "rejected" ? 9 : 8} className="border border-black px-6 py-10 text-center font-medium text-black">
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              visibleOrders.map((order) => {
                const lines = purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
                const indent = indentMap.get(order.indentId);
                return (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="border border-black px-4 py-4 text-sm font-bold text-black">{order.poNo}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(order.poDate)}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black">{supplierMap.get(order.supplierId) || "Unknown Supplier"}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black">
                      <div className="font-medium">{indent?.requestedBy || "Unknown Indent"}</div>
                      <div className="text-xs text-slate-500">{indent ? formatDate(indent.requiredDate) : ""}</div>
                    </td>
                    <td className="border border-black px-4 py-4 text-sm text-black min-w-[280px]">
                      <ul className="space-y-1">
                        {lines.map((line) => (
                          <li key={line.id}>
                            <span className="font-medium">{materialMap.get(line.materialId) || line.erpCode || "Unknown Material"}</span>
                            <span className="ml-2">[{Number(line.qty).toLocaleString()} {line.uom || ""}]</span>
                            {(line.targetDeliveryDate || indent?.requiredDate) ? (
                              <span className="ml-2 text-xs text-slate-500 whitespace-nowrap">
                                (Delivery: {formatDate(line.targetDeliveryDate || indent?.requiredDate || "")})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="border border-black px-4 py-4 text-sm text-black text-right">{Number(order.totalQty || 0).toLocaleString()}</td>
                    <td className="border border-black px-4 py-4 text-sm text-black text-right">{Number(order.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    {mode === "rejected" ? (
                      <td className="border border-black px-4 py-4 text-sm text-black">{order.rejectedRemarks || ""}</td>
                    ) : null}
                    <td className="border border-black px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            downloadPurchaseOrderPdf({
                              order,
                              indent,
                              supplierName: supplierMap.get(order.supplierId) || "Unknown Supplier",
                              lines,
                              materialMap,
                            })
                          }
                          title="Download PDF"
                          className="inline-flex h-9 w-9 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-50 transition"
                        >
                          <Download size={16} />
                        </button>
                        {mode === "pending-approval" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(order)}
                              disabled={submittingId === order.id}
                              title={confirmId === order.id ? "Confirm Approve" : "Approve"}
                              className="inline-flex h-9 w-9 items-center justify-center rounded border border-sky-800 bg-sky-100 text-sky-800 hover:bg-sky-200 transition disabled:opacity-50"
                            >
                              {submittingId === order.id ? <Spinner size={16} /> : <ThumbsUp size={16} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(order)}
                              disabled={submittingId === order.id}
                              title="Reject"
                              className="inline-flex h-9 w-9 items-center justify-center rounded border border-red-700 bg-red-100 text-red-800 hover:bg-red-200 transition disabled:opacity-50"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : null}
                        {mode === "approved" ? (
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded border border-emerald-700 bg-emerald-100 text-emerald-800">
                            <CheckCircle size={16} />
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
