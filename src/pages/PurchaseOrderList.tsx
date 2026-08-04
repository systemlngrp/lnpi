import React, { useCallback, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Select from "react-select";
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
  MaterialIn,
  PurchaseOrder,
  PurchaseOrderLine,
  Setting,
  Supplier,
} from "../types";

type Mode = "pending-approval" | "approved" | "rejected" | "all" | "item-not-received" | "item-cancelled";

type SelectOption = {
  value: string;
  label: string;
};

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

type NotReceivedItemRow = {
  order: PurchaseOrder;
  line: PurchaseOrderLine;
  indent?: Indent;
  supplierName: string;
  itemLabel: string;
  erpCode: string | number;
  receivedQty: number;
  cancelledQty: number;
  pendingQty: number;
};

type NotReceivedCancelRequest = {
  row: NotReceivedItemRow;
  cancelQty: number;
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

export function PurchaseOrderItemNotReceived() {
  return <PurchaseOrderList mode="item-not-received" />;
}

export function PurchaseOrderItemCancelled() {
  return <PurchaseOrderList mode="item-cancelled" />;
}

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PurchaseOrderList({ mode = "all" }: PurchaseOrderListProps) {
  const [purchaseOrders, setPurchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [orderLines, setPurchaseOrderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines, setIndentLines] = useData<IndentLine>("indent-lines", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [poNumberFilter, setPoNumberFilter] = useState("");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [cancelQtyByLineId, setCancelQtyByLineId] = useState<Record<string, string>>({});
  const [cancelRequest, setCancelRequest] = useState<NotReceivedCancelRequest | null>(null);
  const [cancelReasonDraft, setCancelReasonDraft] = useState("");
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
  const receivedQtyByPoLineId = useMemo(() => {
    const map = new Map<string, number>();
    materialIn.forEach((entry) => {
      if (!Array.isArray(entry.lines)) return;
      entry.lines.forEach((line) => {
        const poLineId = String(line?.poLineId || "").trim();
        if (!poLineId) return;
        const qty = Number(line.actualQty ?? line.qty ?? line.invoiceQty ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) return;
        map.set(poLineId, (map.get(poLineId) || 0) + qty);
      });
    });
    return map;
  }, [materialIn]);

  const getLineReceivedQty = useCallback((lineId: string) => Number(receivedQtyByPoLineId.get(lineId) || 0), [receivedQtyByPoLineId]);
  const getLineCancelledQty = useCallback((line: PurchaseOrderLine) => Math.max(0, Number(line.cancelledQty || 0)), []);
  const getLinePendingQty = useCallback((line: PurchaseOrderLine) => {
    return Math.max(0, Number(line.qty || 0) - getLineReceivedQty(line.id) - getLineCancelledQty(line));
  }, [getLineCancelledQty, getLineReceivedQty]);

  const getOrderQtySummary = useCallback((lines: PurchaseOrderLine[]) => {
    return lines.reduce(
      (summary, line) => {
        const totalQty = Number(line.qty || 0);
        const receivedQty = getLineReceivedQty(line.id);
        const cancelledQty = getLineCancelledQty(line);
        const yetToReceive = Math.max(0, totalQty - receivedQty - cancelledQty);
        return {
          totalQty: summary.totalQty + totalQty,
          totalReceived: summary.totalReceived + receivedQty,
          totalCancel: summary.totalCancel + cancelledQty,
          totalYetToReceive: summary.totalYetToReceive + yetToReceive,
        };
      },
      { totalQty: 0, totalReceived: 0, totalCancel: 0, totalYetToReceive: 0 },
    );
  }, [getLineCancelledQty, getLineReceivedQty]);

  const getActiveLineForTotals = useCallback((order: PurchaseOrder, line: PurchaseOrderLine): PurchaseOrderLine => {
    const activeQty = Math.max(0, Number(line.qty || 0) - getLineCancelledQty(line));
    const taxes = computePurchaseOrderTaxes(activeQty, Number(line.rate || 0), Number(line.gstRate || 0), supplierMap.get(order.supplierId)?.gstSupplyType);
    return {
      ...line,
      qty: activeQty,
      amount: taxes.amount,
      gstRate: taxes.gstRate,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      igst: taxes.igst,
      lineTotal: taxes.lineTotal,
    };
  }, [getLineCancelledQty, supplierMap]);

  const getLinesForTotals = useCallback(
    (order: PurchaseOrder, lines: PurchaseOrderLine[]) => lines.map((line) => getActiveLineForTotals(order, line)),
    [getActiveLineForTotals],
  );

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

  const isFlatItemMode = mode === "item-not-received" || mode === "item-cancelled";
  const isLineMode = isFlatItemMode;

  const getModeLines = useCallback((lines: PurchaseOrderLine[]) => {
    if (mode === "item-not-received") return lines.filter((line) => getLinePendingQty(line) > 0);
    if (mode === "item-cancelled") return lines.filter((line) => getLineCancelledQty(line) > 0);
    return lines;
  }, [getLineCancelledQty, getLinePendingQty, mode]);

  const filteredOrders = useMemo(() => {
    return purchaseOrders
      .filter((po) => {
        if (mode === "pending-approval") return po.status === "Pending Approval";
        if (mode === "approved") return po.status === "Approved";
        if (mode === "rejected") return po.status === "Rejected";
        return true;
      })
      .filter((po) => !supplierFilter || po.supplierId === supplierFilter)
      .filter((po) => {
        const lines = orderLines.filter((line) => line.purchaseOrderId === po.id);
        const modeLines = getModeLines(lines);
        if (isLineMode && modeLines.length === 0) return false;

        const supplierName = (supplierNameMap.get(po.supplierId) || "").toLowerCase();
        const poNo = (po.poNo || "").toLowerCase();
        const itemText = modeLines
          .map((line) => [line.erpCode, materialMap.get(line.materialId)?.erpCode, materialMap.get(line.materialId)?.name].filter(Boolean).join(" "))
          .join(" ")
          .toLowerCase();
        const search = searchTerm.toLowerCase();
        return supplierName.includes(search) || poNo.includes(search) || itemText.includes(search);
      })
      .sort(
        (a, b) =>
          new Date(b.updateTimestamp || b.poDate || 0).getTime() -
          new Date(a.updateTimestamp || a.poDate || 0).getTime(),
      );
  }, [getModeLines, isLineMode, materialMap, mode, orderLines, purchaseOrders, searchTerm, supplierFilter, supplierNameMap]);
  const filteredQtySummary = useMemo(() => {
    return filteredOrders.reduce(
      (summary, order) => {
        const lines = getModeLines(orderLines.filter((line) => line.purchaseOrderId === order.id));
        const orderSummary = getOrderQtySummary(lines);
        return {
          totalQty: summary.totalQty + orderSummary.totalQty,
          totalReceived: summary.totalReceived + orderSummary.totalReceived,
          totalCancel: summary.totalCancel + orderSummary.totalCancel,
          totalYetToReceive: summary.totalYetToReceive + orderSummary.totalYetToReceive,
        };
      },
      { totalQty: 0, totalReceived: 0, totalCancel: 0, totalYetToReceive: 0 },
    );
  }, [filteredOrders, getModeLines, getOrderQtySummary, orderLines]);

  const supplierOptions = useMemo(() => {
    return suppliers
      .filter((supplier) => purchaseOrders.some((order) => order.supplierId === supplier.id))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [purchaseOrders, suppliers]);

  const supplierSelectOptions = useMemo<SelectOption[]>(() =>
    supplierOptions.map((supplier) => ({
      value: supplier.id,
      label: supplier.name || supplier.id,
    })),
    [supplierOptions],
  );

  const baseFlatItemRows = useMemo<NotReceivedItemRow[]>(() => {
    const search = searchTerm.trim().toLowerCase();
    return purchaseOrders
      .filter((order) => !supplierFilter || order.supplierId === supplierFilter)
      .filter((order) => !fromDateFilter || String(order.poDate || "") >= fromDateFilter)
      .filter((order) => !toDateFilter || String(order.poDate || "") <= toDateFilter)
      .flatMap((order) => {
        const supplierName = supplierNameMap.get(order.supplierId) || "Unknown";
        return orderLines
          .filter((line) => line.purchaseOrderId === order.id)
          .map((line) => {
            const indentLine = indentLineMap.get(line.indentLineId);
            const indent = (order.indentId ? indentMap.get(order.indentId) : undefined) || (indentLine?.indentId ? indentMap.get(indentLine.indentId) : undefined);
            const item = materialMap.get(line.materialId);
            const receivedQty = getLineReceivedQty(line.id);
            const cancelledQty = getLineCancelledQty(line);
            const pendingQty = getLinePendingQty(line);
            return {
              order,
              line,
              indent,
              supplierName,
              itemLabel: item?.name || "Unknown",
              erpCode: line.erpCode || item?.erpCode || "",
              receivedQty,
              cancelledQty,
              pendingQty,
            };
          });
      })
      .filter((row) => (mode === "item-cancelled" ? row.cancelledQty > 0 : row.pendingQty > 0))
      .filter((row) => {
        if (!search) return true;
        const haystack = [
          row.order.poNo,
          row.supplierName,
          row.itemLabel,
          row.erpCode,
          row.indent?.indentNo,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
      .sort(
        (a, b) =>
          new Date(b.order.updateTimestamp || b.order.poDate || 0).getTime() -
            new Date(a.order.updateTimestamp || a.order.poDate || 0).getTime() ||
          String(a.order.poNo || "").localeCompare(String(b.order.poNo || "")) ||
          String(a.itemLabel || "").localeCompare(String(b.itemLabel || "")),
      );
  }, [fromDateFilter, getLineCancelledQty, getLinePendingQty, getLineReceivedQty, indentLineMap, indentMap, materialMap, orderLines, purchaseOrders, searchTerm, mode, supplierFilter, supplierNameMap, toDateFilter]);

  const poNumberOptions = useMemo(() => {
    const byId = new Map<string, string>();
    baseFlatItemRows.forEach((row) => {
      if (!byId.has(row.order.id)) byId.set(row.order.id, row.order.poNo || "DRAFT");
    });
    return Array.from(byId.entries())
      .map(([id, poNo]) => ({ id, poNo }))
      .sort((a, b) => a.poNo.localeCompare(b.poNo));
  }, [baseFlatItemRows]);

  const filteredFlatItemRows = useMemo(() => {
    return baseFlatItemRows.filter((row) => !poNumberFilter || row.order.id === poNumberFilter);
  }, [baseFlatItemRows, poNumberFilter]);

  const filteredNotReceivedQtySummary = useMemo(() => {
    return filteredFlatItemRows.reduce(
      (summary, row) => ({
        totalQty: summary.totalQty + Number(row.line.qty || 0),
        totalReceived: summary.totalReceived + row.receivedQty,
        totalCancel: summary.totalCancel + row.cancelledQty,
        totalYetToReceive: summary.totalYetToReceive + row.pendingQty,
      }),
      { totalQty: 0, totalReceived: 0, totalCancel: 0, totalYetToReceive: 0 },
    );
  }, [filteredFlatItemRows]);

  const displayQtySummary = isFlatItemMode ? filteredNotReceivedQtySummary : filteredQtySummary;

  const {
    page: orderPage,
    setPage: setOrderPage,
    pageSize: orderPageSize,
    setPageSize: setOrderPageSize,
    totalItems: totalOrderItems,
    paginatedItems: paginatedOrders,
  } = useClientPagination(filteredOrders, 25);

  const {
    page: itemPage,
    setPage: setItemPage,
    pageSize: itemPageSize,
    setPageSize: setItemPageSize,
    totalItems: totalNotReceivedItems,
    paginatedItems: paginatedFlatItemRows,
  } = useClientPagination(filteredFlatItemRows, 25);

  const page = isFlatItemMode ? itemPage : orderPage;
  const setPage = isFlatItemMode ? setItemPage : setOrderPage;
  const pageSize = isFlatItemMode ? itemPageSize : orderPageSize;
  const setPageSize = isFlatItemMode ? setItemPageSize : setOrderPageSize;
  const totalItems = isFlatItemMode ? totalNotReceivedItems : totalOrderItems;

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

      const orderedQty = Number(draft.qty || 0);
      const activeQty = Math.max(0, orderedQty - getLineCancelledQty(line));
      const taxes = computePurchaseOrderTaxes(
        activeQty,
        Number(draft.rate || 0),
        Number(draft.gstRate || 0),
        supplyType,
      );

      return {
        ...line,
        qty: orderedQty,
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
  }, [editingLines, editingOrderId, getLineCancelledQty, supplierMap]);

  const getRenderedTotals = useCallback((order: PurchaseOrder, lines: PurchaseOrderLine[]) => {
    const previewLines = getLinesForTotals(order, getRenderedLines(order, lines));
    const totals = summarizePurchaseOrderLines(previewLines);
    const roundOff = editingOrderId === order.id
      ? Number(editingHeader?.roundOff || 0)
      : Number(order.roundOff || 0);

    return {
      ...totals,
      roundOff,
      grandTotal: Number((totals.grandTotal + roundOff).toFixed(2)),
    };
  }, [editingHeader?.roundOff, editingOrderId, getLinesForTotals, getRenderedLines]);

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
        const closedQty = getLineReceivedQty(line.id) + getLineCancelledQty(line);
        if (qty + 0.0001 < closedQty) {
          throw new Error(`Qty for ${itemName} cannot be less than received plus cancelled qty.`);
        }
        if (!Number.isFinite(rate) || rate < 0) {
          throw new Error(`Please enter a valid rate for ${itemName}.`);
        }
        if (!Number.isFinite(gstRate) || gstRate < 0) {
          throw new Error(`Please enter a valid GST Rate for ${itemName}.`);
        }

        const activeQty = Math.max(0, qty - getLineCancelledQty(line));
        const taxes = computePurchaseOrderTaxes(activeQty, rate, gstRate, supplyType);

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

      const totals = summarizePurchaseOrderLines(updatedLines.map((line) => getActiveLineForTotals(order, line)));
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

  const handleCancelPoLine = async (order: PurchaseOrder, line: PurchaseOrderLine, requestedCancelQty?: number, requestedReason?: string) => {
    const pendingQty = getLinePendingQty(line);
    if (pendingQty <= 0) {
      alert("This PO item has no not-received quantity available to cancel.");
      return false;
    }

    const rawQty =
      requestedCancelQty === undefined
        ? window.prompt(`Enter cancel qty for ${materialMap.get(line.materialId)?.name || "this item"}. Pending: ${pendingQty.toLocaleString()}`, String(pendingQty))
        : String(requestedCancelQty);
    if (rawQty === null) return false;
    const cancelQty = Number(rawQty);
    if (!Number.isFinite(cancelQty) || cancelQty <= 0 || cancelQty > pendingQty + 0.0001) {
      alert("Cancel qty must be greater than 0 and cannot exceed not-received qty.");
      return false;
    }

    const reason = requestedReason === undefined ? window.prompt("Enter cancellation reason:") : requestedReason;
    if (reason === null) return false;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      alert("Cancellation reason is required.");
      return false;
    }

    const timestamp = new Date().toISOString();
    const activeQty = Math.max(0, Number(line.qty || 0) - Number(line.cancelledQty || 0) - cancelQty);
    const taxes = computePurchaseOrderTaxes(activeQty, Number(line.rate || 0), Number(line.gstRate || 0), supplierMap.get(order.supplierId)?.gstSupplyType);
    const updatedLine: PurchaseOrderLine = {
      ...line,
      amount: taxes.amount,
      gstRate: taxes.gstRate,
      cgst: taxes.cgst,
      sgst: taxes.sgst,
      igst: taxes.igst,
      lineTotal: taxes.lineTotal,
      cancelledQty: Number(line.cancelledQty || 0) + cancelQty,
      cancelReason: trimmedReason,
      cancelledAt: timestamp,
      cancelledBy: "System User",
      updatedBy: "System User",
      updateTimestamp: timestamp,
    };

    const nextOrderLines = orderLines.map((row) => (row.id === line.id ? updatedLine : row));
    const orderLinesForOrder = nextOrderLines.filter((row) => row.purchaseOrderId === order.id);
    const totals = summarizePurchaseOrderLines(orderLinesForOrder.map((row) => getActiveLineForTotals(order, row)));
    const updatedOrder: PurchaseOrder = {
      ...order,
      totalQty: totals.totalQty,
      totalAmount: totals.taxableAmount,
      taxableAmount: totals.taxableAmount,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      grandTotal: Number((totals.grandTotal + Number(order.roundOff || 0)).toFixed(2)),
      updatedBy: "System User",
      updateTimestamp: timestamp,
    };

    const nextIndentLines = indentLines.map((indentLine) => {
      if (indentLine.id !== line.indentLineId) return indentLine;
      const orderedQty = Math.max(0, Number(indentLine.orderedQty || 0) - cancelQty);
      const cancelledQty = Number(indentLine.cancelledQty || 0) + cancelQty;
      const balanceQty = Math.max(0, Number(indentLine.qty || 0) - orderedQty - cancelledQty);
      return {
        ...indentLine,
        orderedQty,
        cancelledQty,
        balanceQty,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
    });

    const nextIndents = indents.map((indent) => {
      if (indent.id !== order.indentId) return indent;
      const lines = nextIndentLines.filter((row) => row.indentId === indent.id);
      const totalIndentQty = lines.reduce((sum, row) => sum + Number(row.qty || 0), 0);
      const totalOrderedQty = lines.reduce((sum, row) => sum + Number(row.orderedQty || 0), 0);
      const totalCancelledQty = lines.reduce((sum, row) => sum + Number(row.cancelledQty || 0), 0);
      const totalBalanceQty = lines.reduce((sum, row) => sum + Number(row.balanceQty || 0), 0);
      return {
        ...indent,
        totalIndentQty,
        totalOrderedQty,
        totalCancelledQty,
        totalBalanceQty,
        status: (totalBalanceQty <= 0 ? "Completed" : "Approved") as Indent["status"],
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
    });

    try {
      await setPurchaseOrderLines(nextOrderLines);
      await setPurchaseOrders((prev) => prev.map((row) => (row.id === order.id ? updatedOrder : row)));
      await setIndentLines(nextIndentLines);
      await setIndents(nextIndents);
      return true;
    } catch (error) {
      console.error("Failed to cancel PO item:", error);
      alert("Failed to cancel PO item.");
      return false;
    }
  };

  const handleCancelNotReceivedRow = (row: NotReceivedItemRow) => {
    const rawQty = cancelQtyByLineId[row.line.id] || "";
    const cancelQty = Number(rawQty);
    if (!Number.isFinite(cancelQty) || cancelQty <= 0 || cancelQty > row.pendingQty + 0.0001) {
      alert("Cancel qty must be greater than 0 and cannot exceed not-received qty.");
      return;
    }

    setCancelRequest({ row, cancelQty });
    setCancelReasonDraft("");
  };

  const closeCancelReasonModal = () => {
    setCancelRequest(null);
    setCancelReasonDraft("");
  };

  const confirmCancelNotReceivedRow = async () => {
    if (!cancelRequest) return;
    const reason = cancelReasonDraft.trim();
    if (!reason) {
      alert("Cancellation reason is required.");
      return;
    }

    const didCancel = await handleCancelPoLine(cancelRequest.row.order, cancelRequest.row.line, cancelRequest.cancelQty, reason);
    if (!didCancel) return;
    setCancelQtyByLineId((prev) => {
      const next = { ...prev };
      delete next[cancelRequest.row.line.id];
      return next;
    });
    closeCancelReasonModal();
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
      case "item-not-received":
        return "PO Item Not Received";
      case "item-cancelled":
        return "PO Item Cancel";
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

    if (isFlatItemMode) {
      doc.text(`Total Items: ${filteredFlatItemRows.length}`, 14, 28);
      autoTable(doc, {
        head: [[
          "PO Number",
          "PO Date",
          "Indent Number",
          "Indent Date",
          "Supplier",
          "ERP",
          "Item Label",
          "Ordered Qty",
          "Received",
          "Cancelled",
          ...(mode === "item-cancelled" ? ["Cancel By", "Cancel Reason"] : []),
          "Not Received",
          "Target Delivery",
          ...(mode === "item-not-received" ? ["Cancel Qty", "Action", "Status"] : []),
        ]],
        body: filteredFlatItemRows.map((row) => [
          row.order.poNo || "DRAFT",
          formatDate(row.order.poDate),
          row.indent?.indentNo || "-",
          row.indent?.requisitionDate ? formatDate(row.indent.requisitionDate) : "-",
          row.supplierName,
          row.erpCode,
          row.itemLabel,
          Number(row.line.qty || 0).toLocaleString(),
          row.receivedQty.toLocaleString(),
          row.cancelledQty.toLocaleString(),
          ...(mode === "item-cancelled" ? [row.line.cancelledBy || "-", row.line.cancelReason || "-"] : []),
          row.pendingQty.toLocaleString(),
          row.line.targetDeliveryDate ? formatDate(row.line.targetDeliveryDate) : "-",
          ...(mode === "item-not-received"
            ? [cancelQtyByLineId[row.line.id] || "", row.order.status !== "Rejected" ? "Cancel" : "-", row.order.status]
            : []),
        ]),
        startY: 34,
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 1.8 },
        headStyles: { fillColor: [37, 99, 235] },
      });

      doc.save(`${getTitle(mode).replace(/\s+/g, "_")}.pdf`);
      return;
    }

    autoTable(doc, {
      head: [[
        "PO No",
        "Date",
        "Supplier",
        "Total Qty",
        "Total Received",
        "Total Cancel",
        "Total Yet To Receive",
        "Total Amount",
        ...(mode === "rejected" ? ["Rejection Reason"] : []),
        "Status",
      ]],
      body: filteredOrders.map((order) => {
        const lines = getModeLines(orderLines.filter((line) => line.purchaseOrderId === order.id));
        const qtySummary = getOrderQtySummary(lines);

        return [
          order.poNo || "DRAFT",
          formatDate(order.poDate),
          supplierNameMap.get(order.supplierId) || "Unknown",
          qtySummary.totalQty.toLocaleString(),
          qtySummary.totalReceived.toLocaleString(),
          qtySummary.totalCancel.toLocaleString(),
          qtySummary.totalYetToReceive.toLocaleString(),
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
      columnStyles: {},
    });

    doc.save(`${getTitle(mode).replace(/\s+/g, "_")}.pdf`);
  };

  const handleRowPdf = async (order: PurchaseOrder) => {
    const lines = getModeLines(orderLines.filter((line) => line.purchaseOrderId === order.id));
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
              placeholder="Search PO, supplier, item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
          {isFlatItemMode ? (
            <select
              value={poNumberFilter}
              onChange={(e) => setPoNumberFilter(e.target.value)}
              className="w-full rounded border border-black bg-white px-3 py-2 text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-black md:w-44"
            >
              <option value="">All PO Numbers</option>
              {poNumberOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.poNo}
                </option>
              ))}
            </select>
          ) : null}
          <div className="w-full md:w-64">
            <Select<SelectOption, false>
              options={supplierSelectOptions}
              value={supplierSelectOptions.find((option) => option.value === supplierFilter) || null}
              onChange={(option) => setSupplierFilter(option?.value || "")}
              isClearable
              placeholder="All Suppliers"
              menuPlacement="bottom"
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              menuPosition="fixed"
              styles={{
                control: (provided) => ({ ...provided, minHeight: 38, borderColor: "black", borderRadius: 4, fontSize: 14, fontWeight: 600 }),
                menu: (provided) => ({ ...provided, zIndex: 9999 }),
                menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
              }}
            />
          </div>
          {isFlatItemMode ? (
            <>
              <input
                type="date"
                value={fromDateFilter}
                onChange={(e) => setFromDateFilter(e.target.value)}
                className="w-full rounded border border-black bg-white px-3 py-2 text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-black md:w-40"
                aria-label="From Date"
              />
              <input
                type="date"
                value={toDateFilter}
                onChange={(e) => setToDateFilter(e.target.value)}
                className="w-full rounded border border-black bg-white px-3 py-2 text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-black md:w-40"
                aria-label="To Date"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {[
          { label: "Total Qty", value: displayQtySummary.totalQty, className: "bg-indigo-50 text-indigo-800" },
          { label: "Total Received", value: displayQtySummary.totalReceived, className: "bg-emerald-50 text-emerald-800" },
          { label: "Total Cancel", value: displayQtySummary.totalCancel, className: "bg-red-50 text-red-800" },
          { label: "Total Yet To Receive", value: displayQtySummary.totalYetToReceive, className: "bg-amber-50 text-amber-800" },
        ].map((tile) => (
          <div key={tile.label} className={cn("rounded border border-black px-4 py-3", tile.className)}>
            <div className="text-[10px] font-black uppercase tracking-wide opacity-80">{tile.label}</div>
            <div className="mt-1 text-2xl font-black">{tile.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      {isFlatItemMode ? (
        <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr className="divide-x divide-black border-b border-black">
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">PO Number</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">PO Date</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Indent Number</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Indent Date</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Supplier</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">ERP</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Item Label</th>
                <th className="px-3 py-3 text-right text-xs font-bold uppercase text-black">Ordered Qty</th>
                <th className="px-3 py-3 text-right text-xs font-bold uppercase text-black">Received</th>
                <th className="px-3 py-3 text-right text-xs font-bold uppercase text-black">Cancelled</th>
                {mode === "item-cancelled" ? (
                  <>
                    <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Cancel By</th>
                    <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Cancel Reason</th>
                  </>
                ) : null}
                <th className="px-3 py-3 text-right text-xs font-bold uppercase text-black">Not Received</th>
                <th className="px-3 py-3 text-left text-xs font-bold uppercase text-black">Target Delivery</th>
                {mode === "item-not-received" ? (
                  <>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase text-black">Cancel Qty</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase text-black">Action</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {paginatedFlatItemRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-slate-500 italic">
                    No PO items found.
                  </td>
                </tr>
              ) : (
                paginatedFlatItemRows.map((row) => (
                  <tr key={row.line.id} className="divide-x divide-black text-[10px] font-bold hover:bg-slate-50">
                    <td className="px-3 py-3 text-black uppercase">{row.order.poNo || "DRAFT"}</td>
                    <td className="px-3 py-3 text-black">{formatDate(row.order.poDate)}</td>
                    <td className="px-3 py-3 text-black uppercase">{row.indent?.indentNo || "-"}</td>
                    <td className="px-3 py-3 text-black">{row.indent?.requisitionDate ? formatDate(row.indent.requisitionDate) : "-"}</td>
                    <td className="px-3 py-3 text-black uppercase">{row.supplierName}</td>
                    <td className="px-3 py-3 text-black">{row.erpCode}</td>
                    <td className="px-3 py-3 text-black uppercase min-w-[220px]">{row.itemLabel}</td>
                    <td className="px-3 py-3 text-right text-black">{Number(row.line.qty || 0).toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-emerald-700">{row.receivedQty.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-red-700">{row.cancelledQty.toLocaleString()}</td>
                    {mode === "item-cancelled" ? (
                      <>
                        <td className="px-3 py-3 text-black uppercase">{row.line.cancelledBy || "-"}</td>
                        <td className="px-3 py-3 text-black min-w-[180px]">{row.line.cancelReason || "-"}</td>
                      </>
                    ) : null}
                    <td className="px-3 py-3 text-right text-amber-700">{row.pendingQty.toLocaleString()}</td>
                    <td className="px-3 py-3 text-black">{row.line.targetDeliveryDate ? formatDate(row.line.targetDeliveryDate) : "-"}</td>
                    {mode === "item-not-received" ? (
                      <>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            min="0"
                            max={row.pendingQty}
                            step="0.01"
                            value={cancelQtyByLineId[row.line.id] || ""}
                            onChange={(e) =>
                              setCancelQtyByLineId((prev) => ({
                                ...prev,
                                [row.line.id]: e.target.value,
                              }))
                            }
                            disabled={row.order.status === "Rejected" || row.pendingQty <= 0}
                            className="w-24 rounded border border-black px-2 py-1 text-right text-xs font-bold disabled:bg-slate-100"
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          {row.order.status !== "Rejected" && row.pendingQty > 0 ? (
                            <button
                              type="button"
                              onClick={() => void handleCancelNotReceivedRow(row)}
                              className="inline-flex items-center gap-1 rounded border border-red-700 bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700 hover:bg-red-100"
                            >
                              <X size={12} /> Cancel
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr className="divide-x divide-black border-b border-black">
              <th className="w-10 px-4 py-3"></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">PO Number</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">PO Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">Required Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase text-black">Supplier</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Total Qty</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Total Received</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Total Cancel</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase text-black">Total Yet To Receive</th>
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
                <td colSpan={mode === "rejected" ? 12 : 11} className="px-4 py-12 text-center text-slate-500 italic">
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((order) => {
                const isExpanded = isLineMode || expandedRows.has(order.id);
                const lines = orderLines.filter((line) => line.purchaseOrderId === order.id);
                const visibleLines = getModeLines(lines);
                const renderedLines = getRenderedLines(order, visibleLines);
                const renderedTotals = getRenderedTotals(order, visibleLines);
                const qtySummary = getOrderQtySummary(visibleLines);
                const indentRefs = getOrderIndentRefs(order, visibleLines);
                const showIntegratedTax = Number(renderedTotals.igst || 0) > 0 && Number(renderedTotals.cgst || 0) === 0 && Number(renderedTotals.sgst || 0) === 0;
                const isEditing = editingOrderId === order.id;
                const isAnotherOrderEditing = Boolean(editingOrderId && editingOrderId !== order.id);

                return (
                  <React.Fragment key={order.id}>
                    <tr className={cn("hover:bg-slate-50 transition-colors divide-x divide-black", isExpanded && "bg-slate-50/50")}>
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => !isLineMode && handleToggleRow(order.id)}
                          disabled={isLineMode}
                          className="p-1 hover:bg-slate-200 rounded transition disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>
                      </td>
                      <td className="px-4 py-4 font-bold text-sm text-black uppercase">{order.poNo || "DRAFT"}</td>
                      <td className="px-4 py-4 text-sm text-black font-medium whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editingHeader?.poDate || ""}
                            onChange={(e) => setEditingHeader((prev) => (prev ? { ...prev, poDate: e.target.value } : prev))}
                            className="w-32 rounded border border-black px-2 py-1 text-xs font-bold"
                          />
                        ) : (
                          formatDate(order.poDate)
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-black font-medium whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editingHeader?.requiredDate || ""}
                            onChange={(e) => setEditingHeader((prev) => (prev ? { ...prev, requiredDate: e.target.value } : prev))}
                            className="w-32 rounded border border-black px-2 py-1 text-xs font-bold"
                          />
                        ) : (
                          formatDate(order.requiredDate)
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-black font-medium">{supplierNameMap.get(order.supplierId) || "Unknown"}</td>
                      <td className="px-4 py-4 text-sm text-black text-right font-bold">
                        {qtySummary.totalQty.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-sm text-emerald-700 text-right font-bold">
                        {qtySummary.totalReceived.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-sm text-red-700 text-right font-bold">
                        {qtySummary.totalCancel.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-sm text-amber-700 text-right font-bold">
                        {qtySummary.totalYetToReceive.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-sm text-black text-right font-mono font-bold">
                        {formatMoney(Number(renderedTotals.grandTotal || 0))}
                      </td>
                      {mode === "rejected" ? (
                        <td className="px-4 py-4 text-sm text-red-700 italic">{order.rejectedRemarks || ""}</td>
                      ) : null}
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void handleRowPdf(order)}
                              disabled={pdfOrderId === order.id}
                              className="inline-flex h-8 w-8 items-center justify-center rounded border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                              title="Download PO PDF"
                              aria-label="Download PO PDF"
                            >
                              {pdfOrderId === order.id ? <Spinner size={12} /> : <FileText size={14} />}
                            </button>
                            {mode === "pending-approval" ? (
                              <>
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void handleSaveEdit(order, visibleLines)}
                                      disabled={submittingId === order.id}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                                      title="Save changes"
                                      aria-label="Save changes"
                                    >
                                      <Save size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditing}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-400 bg-white text-slate-700 hover:bg-slate-100 transition"
                                      title="Cancel edit"
                                      aria-label="Cancel edit"
                                    >
                                      <X size={14} />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => startEditing(order, visibleLines)}
                                    disabled={isAnotherOrderEditing || submittingId === order.id}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-blue-700 bg-blue-50 text-blue-700 hover:bg-blue-100 transition disabled:cursor-not-allowed disabled:opacity-50"
                                    title={isAnotherOrderEditing ? "Save or cancel the current edit first" : "Edit PO"}
                                    aria-label="Edit PO"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleApprove(order)}
                                  disabled={submittingId === order.id || isAnotherOrderEditing || isEditing}
                                  className={cn(
                                    "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded border px-2 text-[10px] font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-50",
                                    confirmId === order.id
                                      ? "border-emerald-800 bg-emerald-700 text-white hover:bg-emerald-800"
                                      : "border-emerald-700 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                                  )}
                                  title={confirmId === order.id ? "Confirm approve" : "Approve"}
                                  aria-label={confirmId === order.id ? "Confirm approve" : "Approve"}
                                >
                                  <Check size={14} />
                                  {confirmId === order.id ? "Confirm" : ""}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleReject(order)}
                                  disabled={submittingId === order.id || isAnotherOrderEditing || isEditing}
                                  className={cn(
                                    "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded border px-2 text-[10px] font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-50",
                                    rejectingId === order.id
                                      ? "border-red-800 bg-red-700 text-white hover:bg-red-800"
                                      : "border-red-700 bg-red-50 text-red-700 hover:bg-red-100",
                                  )}
                                  title={rejectingId === order.id ? "Confirm reject" : "Reject"}
                                  aria-label={rejectingId === order.id ? "Confirm reject" : "Reject"}
                                >
                                  <X size={14} />
                                  {rejectingId === order.id ? "Reject" : ""}
                                </button>
                              </>
                            ) : null}
                          </div>
                          {rejectingId === order.id ? (
                            <input
                              type="text"
                              value={remarks}
                              onChange={(e) => setRemarks(e.target.value)}
                              placeholder="Rejection remarks"
                              className="w-52 rounded border border-red-700 px-2 py-1 text-xs font-bold text-black placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-red-700"
                              autoFocus
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={mode === "rejected" ? 12 : 11} className="px-12 py-4">
                          <div className="overflow-hidden rounded border-2 border-black shadow-sm">
                            {isEditing ? (
                              <div className="flex flex-wrap items-center gap-3 border-b-2 border-black bg-white p-3">
                                <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-600">
                                  Round Off
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editingHeader?.roundOff || "0"}
                                    onChange={(e) => setEditingHeader((prev) => (prev ? { ...prev, roundOff: e.target.value } : prev))}
                                    className="w-28 rounded border border-black px-2 py-1 text-right text-xs font-bold text-black"
                                  />
                                </label>
                              </div>
                            ) : null}
                            <table className="min-w-full divide-y divide-black">
                              <thead className="sticky top-0 z-30 bg-slate-100">
                                <tr className="divide-x divide-black text-[9px] font-black uppercase text-slate-500">
                                  <th className="px-3 py-2 text-left">ERP</th>
                                  <th className="px-3 py-2 text-left">Item Name</th>
                                  <th className="px-3 py-2 text-right">Ordered Qty</th>
                                  <th className="px-3 py-2 text-right">Received</th>
                                  <th className="px-3 py-2 text-right">Cancelled</th>
                                  <th className="px-3 py-2 text-right">Not Received</th>
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
                                {renderedLines.map((line) => {
                                  const activeLine = getActiveLineForTotals(order, line);
                                  const receivedQty = getLineReceivedQty(line.id);
                                  const cancelledQty = getLineCancelledQty(line);
                                  const pendingQty = getLinePendingQty(line);
                                  return (
                                    <tr key={line.id} className="divide-x divide-black text-[10px] font-bold">
                                      <td className="px-3 py-2 text-black">{line.erpCode || materialMap.get(line.materialId)?.erpCode || ""}</td>
                                      <td className="px-3 py-2 text-black uppercase">{materialMap.get(line.materialId)?.name || "Unknown"}</td>
                                      <td className="px-3 py-2 text-right">
                                        {isEditing ? (
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={editingLines[line.id]?.qty || ""}
                                            onChange={(e) =>
                                              setEditingLines((prev) => ({
                                                ...prev,
                                                [line.id]: { ...prev[line.id], qty: e.target.value },
                                              }))
                                            }
                                            className="w-24 rounded border border-black px-2 py-1 text-right text-xs font-bold"
                                          />
                                        ) : (
                                          Number(line.qty || 0).toLocaleString()
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right text-emerald-700">{receivedQty.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right text-red-700">{cancelledQty.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-right text-amber-700">{pendingQty.toLocaleString()}</td>
                                      <td className="px-3 py-2 text-center">{line.uom}</td>
                                      <td className="px-3 py-2 text-right">
                                        {isEditing ? (
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={editingLines[line.id]?.rate || ""}
                                            onChange={(e) =>
                                              setEditingLines((prev) => ({
                                                ...prev,
                                                [line.id]: { ...prev[line.id], rate: e.target.value },
                                              }))
                                            }
                                            className="w-24 rounded border border-black px-2 py-1 text-right text-xs font-bold"
                                          />
                                        ) : (
                                          formatMoney(Number(line.rate || 0))
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        {isEditing ? (
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={editingLines[line.id]?.gstRate || ""}
                                            onChange={(e) =>
                                              setEditingLines((prev) => ({
                                                ...prev,
                                                [line.id]: { ...prev[line.id], gstRate: e.target.value },
                                              }))
                                            }
                                            className="w-20 rounded border border-black px-2 py-1 text-right text-xs font-bold"
                                          />
                                        ) : (
                                          `${Number(line.gstRate || 0).toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}%`
                                        )}
                                      </td>
                                      {showIntegratedTax ? (
                                        <td className="px-3 py-2 text-right">{formatMoney(Number(activeLine.igst || 0))}</td>
                                      ) : (
                                        <>
                                          <td className="px-3 py-2 text-right">{formatMoney(Number(activeLine.cgst || 0))}</td>
                                          <td className="px-3 py-2 text-right">{formatMoney(Number(activeLine.sgst || 0))}</td>
                                        </>
                                      )}
                                      <td className="px-3 py-2 text-right">{formatMoney(Number(activeLine.amount || 0))}</td>
                                      <td className="px-3 py-2 text-right">
                                        {formatMoney(Number(activeLine.lineTotal ?? (Number(activeLine.amount || 0) + Number(activeLine.cgst || 0) + Number(activeLine.sgst || 0) + Number(activeLine.igst || 0))))}
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
                                            className="w-32 rounded border border-black px-2 py-1 text-xs font-bold"
                                          />
                                        ) : (
                                          line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "-"
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
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
      )}

      {cancelRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border-2 border-black bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-black pb-3">
              <div>
                <h3 className="text-sm font-black uppercase text-black">Cancel Reason</h3>
                <p className="mt-1 text-xs font-bold text-slate-600">
                  {cancelRequest.row.order.poNo || "DRAFT"} | {cancelRequest.row.itemLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCancelReasonModal}
                className="rounded border border-black px-2 py-1 text-xs font-black uppercase text-black hover:bg-slate-100"
              >
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 py-3 text-xs font-bold text-black">
              <div className="rounded border border-slate-300 bg-slate-50 p-2">
                <div className="text-[10px] font-black uppercase text-slate-500">Pending Qty</div>
                <div className="mt-1 text-sm font-black">{cancelRequest.row.pendingQty.toLocaleString()}</div>
              </div>
              <div className="rounded border border-red-300 bg-red-50 p-2">
                <div className="text-[10px] font-black uppercase text-red-600">Cancel Qty</div>
                <div className="mt-1 text-sm font-black text-red-700">{cancelRequest.cancelQty.toLocaleString()}</div>
              </div>
            </div>
            <label className="block text-xs font-black uppercase text-slate-600">
              Reason
              <textarea
                value={cancelReasonDraft}
                onChange={(e) => setCancelReasonDraft(e.target.value)}
                className="mt-1 w-full rounded border-2 border-black p-2 text-sm font-semibold text-black focus:outline-none focus:ring-1 focus:ring-black"
                rows={4}
                autoFocus
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCancelReasonModal}
                className="rounded border border-black bg-white px-3 py-2 text-xs font-black uppercase text-black hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void confirmCancelNotReceivedRow()}
                className="rounded border border-red-700 bg-red-600 px-3 py-2 text-xs font-black uppercase text-white hover:bg-red-700"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
