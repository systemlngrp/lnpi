import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Supplier, Material } from "../types";
import { formatDate } from "../lib/serial";
import { Spinner } from "../components/Spinner";
import { Search, ChevronDown, ChevronUp, CheckSquare, Square } from "lucide-react";
import { useAutoRefreshEffect, useAutoRefreshPause } from "../hooks/useAutoRefresh";
import { computePurchaseOrderTaxes } from "../lib/purchaseOrderTaxes";

interface PendingProcurementSource {
  indentLineId: string;
  indentId: string;
  materialId: string;
  uom: string;
  qty: number;
  cancelledQty: number;
  poQtyCreated: number;
  pendingQty: number;
  targetDeliveryDate: string;
  requisitionDate: string;
}

interface PendingProcurementRow {
  materialId: string;
  materialName: string;
  materialErpCode: string;
  uom: string;
  totalPendingQty: number;
  suggestedRate: number;
  sources: PendingProcurementSource[];
}

export function PurchaseOrderPending() {
  const navigate = useNavigate();
  const [suppliers] = useData<Supplier>("suppliers", []);
  
  const [rows, setRows] = useState<PendingProcurementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [supplierId, setSupplierId] = useState("");
  const [rowInputs, setRowInputs] = useState<Record<string, { orderQty: string; rate: string; gstRate: string }>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useAutoRefreshPause(
    selectedIds.size > 0 ||
    supplierId.trim().length > 0 ||
    Object.keys(rowInputs).length > 0 ||
    isSubmitting
  );

  const fetchPending = useCallback(async () => {
    try {
      setLoading(true);
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/purchase-orders/pending-procurement", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Failed to fetch pending procurement data");
      const data = await response.json();
      setRows(data);
      
      // Initialize inputs
      const initialInputs: Record<string, { orderQty: string; rate: string; gstRate: string }> = {};
      data.forEach((row: PendingProcurementRow) => {
        const key = `${row.materialId}_${row.uom}`;
        initialInputs[key] = {
          orderQty: String(row.totalPendingQty),
          rate: String(row.suggestedRate || 0),
          gstRate: "18",
        };
      });
      setRowInputs(initialInputs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  useAutoRefreshEffect(() => {
    void fetchPending();
  });

  const filteredRows = useMemo(() => {
    return rows.filter(row => 
      row.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.materialErpCode.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [rows, searchTerm]);

  const toggleSelect = (key: string) => {
    const next = new Set(selectedIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map(r => `${r.materialId}_${r.uom}`)));
    }
  };

  const toggleExpand = (key: string) => {
    const next = new Set(expandedRows);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedRows(next);
  };

  const handleInputChange = (key: string, field: "orderQty" | "rate" | "gstRate", value: string) => {
    setRowInputs(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };

  const handleCreatePO = async () => {
    if (!supplierId) {
      alert("Please select a supplier.");
      return;
    }
    if (selectedIds.size === 0) {
      alert("Please select at least one item.");
      return;
    }

    const itemsToCreate = Array.from(selectedIds).map(key => {
      const row = rows.find(r => `${r.materialId}_${r.uom}` === key);
      const input = rowInputs[key];
      return {
        materialId: row!.materialId,
        uom: row!.uom,
        orderQty: Number(input.orderQty),
        rate: Number(input.rate),
        gstRate: Number(input.gstRate || 0),
      };
    });

    if (itemsToCreate.some(item => isNaN(item.orderQty) || item.orderQty <= 0)) {
      alert("Please enter valid order quantities.");
      return;
    }

    if (itemsToCreate.some(item => isNaN(item.rate) || item.rate < 0)) {
      alert("Please enter valid rates.");
      return;
    }

    if (itemsToCreate.some(item => isNaN(item.gstRate) || item.gstRate < 0)) {
      alert("Please enter valid GST Rates.");
      return;
    }

    try {
      setIsSubmitting(true);
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/purchase-orders/create-consolidated", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          supplierId,
          poDate: new Date().toISOString().slice(0, 10),
          items: itemsToCreate,
          remarks: "Consolidated PO from Multiple Indents"
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create PO");
      }

      const result = await response.json();
      alert(`Consolidated PO created successfully: ${result.poNo}`);
      navigate("/purchase-orders");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Consolidated Pending PO</h2>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded border border-black bg-white py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded border border-black bg-slate-50 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Select Supplier</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded border border-black bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">-- Choose Supplier --</option>
              {suppliers.sort((a,b) => a.name.localeCompare(b.name)).map(s => (
                <option key={s.id} value={s.id}>{s.name} {s.district ? `(${s.district})` : ""}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleCreatePO}
            disabled={isSubmitting || selectedIds.size === 0}
            className="rounded border border-black bg-indigo-600 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition shadow-sm"
          >
            {isSubmitting ? "Creating..." : `Create PO (${selectedIds.size} Items)`}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="bg-slate-100">
              <th className="w-10 border border-black px-4 py-3 text-center">
                <button onClick={toggleSelectAll} className="text-black hover:text-indigo-600">
                  {selectedIds.size === filteredRows.length && filteredRows.length > 0 ? (
                    <CheckSquare className="h-5 w-5" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>
              </th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black">Item Details</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black">Indent Quantity</th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black">UOM</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black text-indigo-700">Pending Indent</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black">Rate</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black">GST Rate</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black">CGST</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black">SGST</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black">IGST</th>
              <th className="border border-black px-4 py-3 text-center text-xs font-bold uppercase text-black">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="border border-black px-6 py-10 text-center font-medium text-black">
                  {searchTerm ? "No matching items found." : "No approved indents are waiting for purchase orders."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const key = `${row.materialId}_${row.uom}`;
                const isSelected = selectedIds.has(key);
                const isExpanded = expandedRows.has(key);
                const inputs = rowInputs[key] || { orderQty: "0", rate: "0", gstRate: "18" };
                const supplier = suppliers.find((s) => s.id === supplierId);
                const taxes = computePurchaseOrderTaxes(
                  Number(inputs.orderQty || 0),
                  Number(inputs.rate || 0),
                  Number(inputs.gstRate || 0),
                  supplier?.gstSupplyType,
                );

                return (
                  <>
                    <tr className={`${isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                      <td className="border border-black px-4 py-4 text-center">
                        <button onClick={() => toggleSelect(key)} className={`${isSelected ? 'text-indigo-600' : 'text-slate-400'}`}>
                          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                        </button>
                      </td>
                      <td className="border border-black px-4 py-4">
                        <div className="font-bold text-black">{row.materialName}</div>
                        <div className="text-xs text-slate-500 uppercase">{row.materialErpCode}</div>
                      </td>
                      <td className="border border-black px-4 py-4 text-right font-medium text-black">
                        {row.sources.reduce((sum, s) => sum + Number(s.qty || 0), 0).toLocaleString()}
                      </td>
                      <td className="border border-black px-4 py-4 text-sm text-black">
                        {row.uom}
                      </td>
                      <td className="border border-black px-4 py-2 text-right">
                        <input
                          type="number"
                          value={inputs.orderQty}
                          onChange={(e) => handleInputChange(key, "orderQty", e.target.value)}
                          max={row.totalPendingQty}
                          className="w-24 rounded border-2 border-indigo-600 bg-white px-2 py-1 text-right text-sm font-black focus:outline-none"
                        />
                      </td>
                      <td className="border border-black px-4 py-2 text-right">
                        <input
                          type="number"
                          value={inputs.rate}
                          onChange={(e) => handleInputChange(key, "rate", e.target.value)}
                          className="w-24 rounded border border-black bg-white px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="border border-black px-4 py-2 text-right">
                        <input
                          type="number"
                          value={inputs.gstRate}
                          onChange={(e) => handleInputChange(key, "gstRate", e.target.value)}
                          className="w-20 rounded border border-black bg-white px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="border border-black px-4 py-4 text-right text-sm">{taxes.cgst ? taxes.cgst.toFixed(2) : "-"}</td>
                      <td className="border border-black px-4 py-4 text-right text-sm">{taxes.sgst ? taxes.sgst.toFixed(2) : "-"}</td>
                      <td className="border border-black px-4 py-4 text-right text-sm">{taxes.igst ? taxes.igst.toFixed(2) : "-"}</td>
                      <td className="border border-black px-4 py-4 text-center">
                        <button onClick={() => toggleExpand(key)} className="text-slate-400 hover:text-black">
                          {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={11} className="border border-black p-0">
                          <div className="p-4 overflow-x-auto">
                            <table className="min-w-full border-collapse bg-white text-xs">
                              <thead className="sticky top-0 z-30">
                                <tr className="bg-slate-200">
                                  <th className="border border-slate-300 px-2 py-1 text-left uppercase">Indent ID</th>
                                  <th className="border border-slate-300 px-2 py-1 text-left uppercase">Requisition Date</th>
                                  <th className="border border-slate-300 px-2 py-1 text-left uppercase">Target Delivery</th>
                                  <th className="border border-slate-300 px-2 py-1 text-right uppercase">Qty</th>
                                  <th className="border border-slate-300 px-2 py-1 text-right uppercase">Ordered</th>
                                  <th className="border border-slate-300 px-2 py-1 text-right uppercase">Cancelled</th>
                                  <th className="border border-slate-300 px-2 py-1 text-right uppercase font-bold">Pending</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.sources.sort((a,b) => new Date(a.targetDeliveryDate).getTime() - new Date(b.targetDeliveryDate).getTime()).map((src, i) => (
                                  <tr key={i} className="hover:bg-slate-50">
                                    <td className="border border-slate-300 px-2 py-1 font-bold text-slate-700">{src.indentId.substring(0, 13)}...</td>
                                    <td className="border border-slate-300 px-2 py-1">{formatDate(src.requisitionDate)}</td>
                                    <td className="border border-slate-300 px-2 py-1 font-medium text-blue-700">{formatDate(src.targetDeliveryDate)}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-right">{src.qty}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-right">{src.poQtyCreated}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-right">{src.cancelledQty}</td>
                                    <td className="border border-slate-300 px-2 py-1 text-right font-bold">{src.pendingQty}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
