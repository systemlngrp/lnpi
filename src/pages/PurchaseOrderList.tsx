import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { 
  PurchaseOrder, 
  PurchaseOrderLine, 
  Material, 
  Supplier, 
  Indent,
  Setting
} from "../types";
import { 
  ChevronRight, 
  ChevronDown, 
  Check, 
  X,
  Search,
  Download
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";

type Mode = "pending-approval" | "approved" | "rejected" | "all";

interface PurchaseOrderListProps {
  mode?: Mode;
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

export function PurchaseOrderList({ mode = "all" }: PurchaseOrderListProps) {
  const [purchaseOrders, setPurchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [orderLines] = useData<PurchaseOrderLine>("purchase-order-lines", []);
  const [materials] = useData<Material>("materials", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [indents] = useData<Indent>("indents", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");

  const currentSetting = settings[0];
  const materialMap = useMemo(() => new Map(materials.map(m => [m.id, m])), [materials]);
  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers]);

  const filteredOrders = useMemo(() => {
    return purchaseOrders
      .filter((po) => {
        if (mode === "pending-approval") return po.status === "Pending Approval";
        if (mode === "approved") return po.status === "Approved";
        if (mode === "rejected") return po.status === "Rejected";
        return true;
      })
      .filter((po) => {
        const supplierName = (supplierMap.get(po.supplierId) || "").toLowerCase();
        const poNo = (po.poNo || "").toLowerCase();
        const search = searchTerm.toLowerCase();
        return supplierName.includes(search) || poNo.includes(search);
      })
      .sort((a, b) => new Date(b.updateTimestamp || b.timestamp || 0).getTime() - new Date(a.updateTimestamp || a.timestamp || 0).getTime());
  }, [purchaseOrders, mode, supplierMap, searchTerm]);

  const handleToggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const handleApprove = async (order: PurchaseOrder) => {
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
            : row
        )
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

  const getTitle = (m: Mode) => {
    switch (m) {
      case "pending-approval": return "Pending PO Approvals";
      case "approved": return "Approved Purchase Orders";
      case "rejected": return "Rejected Purchase Orders";
      default: return "Purchase Orders Master";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{getTitle(mode)}</h2>
        <div className="relative w-full md:w-64">
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
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={mode === "rejected" ? 8 : 7} className="px-4 py-12 text-center text-slate-500 italic">
                  No purchase orders found.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const isExpanded = expandedRows.has(order.id);
                const lines = orderLines.filter((l) => l.purchaseOrderId === order.id);
                const indent = indents.find((i) => i.id === order.indentId);
                
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
                        <div className="text-[10px] text-slate-500 font-bold uppercase">{formatDate(order.date)}</div>
                        <div className={cn(
                          "mt-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase",
                          order.status === "Approved" ? "border-emerald-700 bg-emerald-100 text-emerald-800" :
                          order.status === "Rejected" ? "border-red-700 bg-red-100 text-red-800" :
                          "border-amber-700 bg-amber-100 text-amber-800"
                        )}>
                          {order.status}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-black font-medium">{supplierMap.get(order.supplierId) || "Unknown"}</td>
                      <td className="px-4 py-4">
                        <ul className="list-none space-y-0.5">
                          {lines.slice(0, 2).map((l, idx) => (
                            <li key={idx} className="text-[10px] text-slate-700 font-bold uppercase truncate max-w-[200px]">
                              • {materialMap.get(l.materialId)?.name || "Unknown"}
                            </li>
                          ))}
                          {lines.length > 2 && (
                            <li className="text-[9px] text-indigo-600 font-black uppercase">
                              + {lines.length - 2} MORE ITEMS
                            </li>
                          )}
                        </ul>
                      </td>
                      <td className="px-4 py-4 text-sm text-black text-right font-bold">{Number(order.totalQty || 0).toLocaleString()}</td>
                      <td className="px-4 py-4 text-sm text-black text-right font-mono font-bold">₹{Number(order.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      {mode === "rejected" ? (
                        <td className="px-4 py-4 text-sm text-red-700 italic">{order.rejectedRemarks || ""}</td>
                      ) : null}
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          {mode === "pending-approval" ? (
                            <>
                              {rejectingId === order.id ? (
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
                                    onClick={() => void handleApprove(order)}
                                    disabled={submittingId === order.id}
                                    className={cn(
                                      "flex items-center gap-1.5 px-3 py-1.5 rounded border-2 font-black text-[10px] uppercase transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
                                      confirmId === order.id ? "bg-emerald-600 text-white border-black animate-pulse" : "bg-emerald-50 text-emerald-700 border-emerald-700 hover:bg-emerald-100"
                                    )}
                                  >
                                    {submittingId === order.id ? <Spinner size={12} /> : (
                                      <>
                                        <Check size={14} />
                                        {confirmId === order.id ? "Confirm Approve?" : "Approve"}
                                      </>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => void handleReject(order)}
                                    disabled={submittingId === order.id}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border-2 border-red-700 bg-red-50 text-red-700 font-black text-[10px] uppercase hover:bg-red-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                  >
                                    <X size={14} /> Reject
                                  </button>
                                </>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={() => void handleToggleRow(order.id)}
                              className="text-indigo-600 hover:text-indigo-900 font-bold uppercase flex items-center gap-1 text-[11px]"
                            >
                              {isExpanded ? "Hide" : "Details"}{" "}
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
                              {indent && <span>Indent Ref: {indent.indentNo}</span>}
                            </div>
                            <table className="min-w-full divide-y divide-black">
                              <thead className="bg-slate-100">
                                <tr className="divide-x divide-black text-[9px] font-black uppercase text-slate-500">
                                  <th className="px-3 py-2 text-left">Item Name</th>
                                  <th className="px-3 py-2 text-right">Qty</th>
                                  <th className="px-3 py-2 text-center">UOM</th>
                                  <th className="px-3 py-2 text-right">Rate</th>
                                  <th className="px-3 py-2 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-black">
                                {lines.map((l, lidx) => (
                                  <tr key={lidx} className="divide-x divide-black text-[10px] font-bold">
                                    <td className="px-3 py-2 text-black uppercase">{materialMap.get(l.materialId)?.name || "Unknown"}</td>
                                    <td className="px-3 py-2 text-right">{l.qty.toLocaleString()}</td>
                                    <td className="px-3 py-2 text-center">{l.uom}</td>
                                    <td className="px-3 py-2 text-right">₹{l.rate.toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right">₹{(l.qty * l.rate).toLocaleString()}</td>
                                  </tr>
                                ))}
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
    </div>
  );
}
