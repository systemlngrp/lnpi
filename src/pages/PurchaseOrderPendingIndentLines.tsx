import { useCallback, useEffect, useMemo, useState } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Eye, RotateCcw } from "lucide-react";
import { useData } from "../hooks/useData";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { ExcelExport } from "../components/ExcelExport";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import type { Indent, IndentLine, Supplier } from "../types";
import { useAutoRefreshEffect, useAutoRefreshPause } from "../hooks/useAutoRefresh";
import { computePurchaseOrderTaxes } from "../lib/purchaseOrderTaxes";
import { canIndentBeUnapproved, revertIndentToPending } from "../lib/indentTotals";

type PendingIndentLineRow = {
  indentLineId: string;
  indentId: string;
  indentNo: string;
  requestedBy: string;
  requisitionDate: string;
  targetDeliveryDate: string;
  materialId: string;
  materialErpCode: string;
  materialName: string;
  uom: string;
  qty: number;
  cancelledQty: number;
  poQtyCreated: number;
  pendingQty: number;
  suggestedRate?: number;
  lastPoRate?: number;
  lastPoDate?: string;
};

export function PurchaseOrderPendingIndentLines() {
  const navigate = useNavigate();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [indents, setIndents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [rows, setRows] = useState<PendingIndentLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowInputs, setRowInputs] = useState<Record<string, { supplierId: string; qty: string; rate: string; gstRate: string }>>({});
  const [creating, setCreating] = useState(false);
  const [unapprovingIndentId, setUnapprovingIndentId] = useState<string | null>(null);

  useAutoRefreshPause(
    selectedIds.size > 0 ||
    Object.keys(rowInputs).length > 0 ||
    creating
  );

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/purchase-orders/pending-indent-lines", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Failed to fetch pending indent lines");
      const data = await response.json();
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useAutoRefreshEffect(() => {
    void fetchRows();
  });

  useEffect(() => {
    setSelectedIds(new Set());
    setRowInputs({});
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        String(r.indentNo || "").toLowerCase().includes(q) ||
        String(r.materialName || "").toLowerCase().includes(q) ||
        String(r.materialErpCode || "").toLowerCase().includes(q) ||
        String(r.requestedBy || "").toLowerCase().includes(q)
      );
    });
  }, [rows, searchTerm]);

  const sortedFilteredRows = useMemo(() =>
    filteredRows
      .slice()
      .sort((a, b) => {
        const ad = new Date(a.targetDeliveryDate || a.requisitionDate || 0).getTime();
        const bd = new Date(b.targetDeliveryDate || b.requisitionDate || 0).getTime();
        return ad - bd;
      }),
    [filteredRows]
  );

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedRows,
  } = useClientPagination(sortedFilteredRows, 25);

  const filteredRowIds = useMemo(() => new Set(filteredRows.map((r) => r.indentLineId)), [filteredRows]);
  const allVisibleSelected = useMemo(() => {
    if (filteredRows.length === 0) return false;
    return filteredRows.every((r) => selectedIds.has(r.indentLineId));
  }, [filteredRows, selectedIds]);

  const toggleSelect = (row: PendingIndentLineRow) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.indentLineId)) next.delete(row.indentLineId);
      else next.add(row.indentLineId);
      return next;
    });
    setRowInputs((prev) => {
      if (prev[row.indentLineId]) return prev;
      const suggestedRate = Number(row.suggestedRate || 0);
      return {
        ...prev,
        [row.indentLineId]: {
          supplierId: "",
          qty: String(Number(row.pendingQty || 0)),
          rate: String(Number.isFinite(suggestedRate) ? suggestedRate : 0),
          gstRate: "18",
        },
      };
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = !allVisibleSelected;
      filteredRows.forEach((r) => {
        if (shouldSelect) next.add(r.indentLineId);
        else next.delete(r.indentLineId);
      });
      return next;
    });
    setRowInputs((prev) => {
      const next = { ...prev };
      filteredRows.forEach((r) => {
        if (!next[r.indentLineId]) {
          const suggestedRate = Number(r.suggestedRate || 0);
          next[r.indentLineId] = {
            supplierId: "",
            qty: String(Number(r.pendingQty || 0)),
            rate: String(Number.isFinite(suggestedRate) ? suggestedRate : 0),
            gstRate: "18",
          };
        }
      });
      return next;
    });
  };

  const updateInput = (indentLineId: string, patch: Partial<{ supplierId: string; qty: string; rate: string; gstRate: string }>) => {
    setRowInputs((prev) => ({
      ...prev,
      [indentLineId]: { supplierId: "", qty: "0", rate: "0", gstRate: "18", ...(prev[indentLineId] || {}), ...patch },
    }));
  };

  const canCreate = useMemo(() => {
    if (creating) return false;
    if (selectedIds.size === 0) return false;
    const selectedInView = Array.from(selectedIds).filter((id) => filteredRowIds.has(id));
    if (selectedInView.length === 0) return false;
    for (const id of selectedInView) {
      const input = rowInputs[id];
      if (!input?.supplierId) return false;
      const qty = Number(input.qty || 0);
      const rate = Number(input.rate || 0);
      const gstRate = Number(input.gstRate || 0);
      if (!Number.isFinite(qty) || qty <= 0) return false;
      if (!Number.isFinite(rate) || rate <= 0) return false;
      if (!Number.isFinite(gstRate) || gstRate < 0) return false;
    }
    return true;
  }, [creating, filteredRowIds, rowInputs, selectedIds]);

  const handleCreatePOs = async () => {
    const selectedInView = Array.from(selectedIds).filter((id) => filteredRowIds.has(id));
    if (selectedInView.length === 0) return;

    const payloadLines = selectedInView.map((id) => {
      const input = rowInputs[id];
      return {
        indentLineId: id,
        supplierId: input?.supplierId,
        qty: Number(input?.qty || 0),
        rate: Number(input?.rate || 0),
        gstRate: Number(input?.gstRate || 0),
      };
    });

    if (payloadLines.some((l) => !l.supplierId)) {
      alert("Please select supplier for all selected lines.");
      return;
    }

    if (payloadLines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) {
      alert("Please enter valid order qty (> 0) for all selected lines.");
      return;
    }

    if (payloadLines.some((l) => !Number.isFinite(l.rate) || l.rate < 0)) {
      alert("Please enter valid rate (>= 0) for all selected lines.");
      return;
    }

    if (payloadLines.some((l) => !Number.isFinite(l.gstRate) || l.gstRate < 0)) {
      alert("Please enter valid GST Rate (>= 0) for all selected lines.");
      return;
    }

    try {
      setCreating(true);
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/purchase-orders/create-from-indent-lines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          poDate: new Date().toISOString().slice(0, 10),
          remarks: "PO from Pending Indent Lines",
          lines: payloadLines,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create PO(s)");
      }

      const result = await response.json();
      const created = Array.isArray(result?.created) ? result.created : [];
      const poNos = created.map((c: any) => c.poNo).filter(Boolean);
      alert(poNos.length ? `PO created: ${poNos.join(", ")}` : "PO(s) created.");

      await fetchRows();
      setSelectedIds(new Set());
      setRowInputs({});
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleUnapproveIndent = async (indentId: string) => {
    const indent = indents.find((row) => row.id === indentId);
    if (!indent) {
      alert("Indent not found.");
      return;
    }

    const indentSpecificLines = indentLines.filter((line) => line.indentId === indentId);
    if (!canIndentBeUnapproved(indentSpecificLines)) {
      alert("This indent cannot be unapproved because PO quantity has already been created against it.");
      return;
    }

    setUnapprovingIndentId(indentId);
    try {
      const nextIndent = revertIndentToPending(indent, indentSpecificLines);
      await setIndents(indents.map((row) => (row.id === indentId ? nextIndent : row)));
      await fetchRows();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rows.filter((row) => row.indentId === indentId).forEach((row) => next.delete(row.indentLineId));
        return next;
      });
      setRowInputs((prev) => {
        const next = { ...prev };
        rows.filter((row) => row.indentId === indentId).forEach((row) => {
          delete next[row.indentLineId];
        });
        return next;
      });
    } catch (error) {
      console.error(`Failed to unapprove indent ${indentId}:`, error);
      alert("Failed to move indent back to Pending.");
    } finally {
      setUnapprovingIndentId(null);
    }
  };

  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Indent Lines for PO</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCreatePOs()}
            disabled={!canCreate}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-bold text-white border border-black hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create PO(s)"}
          </button>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search indent no, item, ERP, requested by..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded border border-black bg-white py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded border border-black bg-white shadow-sm overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="min-w-full border-collapse">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr>
                <th className="border border-black bg-slate-100 px-3 py-3 text-center text-xs font-bold uppercase text-black whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => toggleSelectAllVisible()}
                  />
                </th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Indent No</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Indent Date</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black">Requested By</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">ERP</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black min-w-[320px]">Item Name</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">UOM</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Supplier <span className="text-red-500">*</span></th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Last PO Rate</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Last PO Date</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Indent Qty <span className="text-red-500">*</span></th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Rate <span className="text-red-500">*</span></th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">GST Rate</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">CGST</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">SGST</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">IGST</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Qty</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Cancelled</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">PO Created</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Pending Indent Qty</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Target Delivery</th>
              <th className="border border-black bg-slate-100 px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={22} className="border border-black px-6 py-10 text-center text-sm text-slate-600">
                  No pending indent lines found.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                  const input = rowInputs[row.indentLineId];
                  const supplier = suppliers.find((s) => s.id === input?.supplierId);
                  const taxes = computePurchaseOrderTaxes(
                    Number(input?.qty || 0),
                    Number(input?.rate || 0),
                    Number(input?.gstRate || 0),
                    supplier?.gstSupplyType,
                  );
                  return (
                  <tr key={row.indentLineId} className="hover:bg-slate-50">
                    <td className="border border-black px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.indentLineId)}
                        onChange={() => toggleSelect(row)}
                      />
                    </td>
                    <td className="border border-black px-4 py-3 text-sm font-bold text-black whitespace-nowrap">
                      {row.indentNo || `IND-${row.indentId.slice(0, 8)}`}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">
                      {row.requisitionDate ? formatDate(row.requisitionDate) : ""}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{row.requestedBy}</td>
                    <td className="border border-black px-4 py-3 text-sm font-bold text-black whitespace-nowrap">{row.materialErpCode}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">
                      <div className="font-bold">{row.materialName}</div>
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">{row.uom}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">
                      <select
                        value={rowInputs[row.indentLineId]?.supplierId || ""}
                        onChange={(e) => updateInput(row.indentLineId, { supplierId: e.target.value })}
                        disabled={!selectedIds.has(row.indentLineId)}
                        className={`w-48 rounded border ${!rowInputs[row.indentLineId]?.supplierId && selectedIds.has(row.indentLineId) ? 'border-red-500' : 'border-black'} bg-white px-2 py-1 text-sm disabled:opacity-50`}
                      >
                        <option value="">-- Supplier --</option>
                        {suppliers
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right whitespace-nowrap">
                      {row.lastPoRate ? Number(row.lastPoRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">
                      {row.lastPoDate ? formatDate(row.lastPoDate) : "-"}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        max={Number(row.pendingQty || 0)}
                        value={rowInputs[row.indentLineId]?.qty || String(Number(row.pendingQty || 0))}
                        onChange={(e) => updateInput(row.indentLineId, { qty: e.target.value })}
                        disabled={!selectedIds.has(row.indentLineId)}
                        className={`w-24 rounded border ${!rowInputs[row.indentLineId]?.qty || Number(rowInputs[row.indentLineId]?.qty) <= 0 ? 'border-red-500' : 'border-black'} bg-white px-2 py-1 text-right text-sm disabled:opacity-50`}
                      />
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        value={rowInputs[row.indentLineId]?.rate ?? String(Number(row.suggestedRate || 0))}
                        onChange={(e) => updateInput(row.indentLineId, { rate: e.target.value })}
                        disabled={!selectedIds.has(row.indentLineId)}
                        className={`w-24 rounded border ${!rowInputs[row.indentLineId]?.rate || Number(rowInputs[row.indentLineId]?.rate) <= 0 ? 'border-red-500' : 'border-black'} bg-white px-2 py-1 text-right text-sm disabled:opacity-50`}
                      />
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={rowInputs[row.indentLineId]?.gstRate || "18"}
                        onChange={(e) => updateInput(row.indentLineId, { gstRate: e.target.value })}
                        disabled={!selectedIds.has(row.indentLineId)}
                        className="w-20 rounded border border-black bg-white px-2 py-1 text-right text-sm disabled:opacity-50"
                      />
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right">{taxes.cgst ? taxes.cgst.toFixed(2) : "-"}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right">{taxes.sgst ? taxes.sgst.toFixed(2) : "-"}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right">{taxes.igst ? taxes.igst.toFixed(2) : "-"}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right">{Number(row.qty || 0).toLocaleString()}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right">{Number(row.cancelledQty || 0).toLocaleString()}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black text-right">{Number(row.poQtyCreated || 0).toLocaleString()}</td>
                    <td className="border border-black px-4 py-3 text-sm font-bold text-indigo-700 text-right">
                      {Number(row.pendingQty || 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">
                      {row.targetDeliveryDate ? formatDate(row.targetDeliveryDate) : ""}
                    </td>
                    <td className="border border-black px-4 py-3">
                      <div className="flex justify-end">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleUnapproveIndent(row.indentId)}
                            disabled={
                              unapprovingIndentId === row.indentId ||
                              !canIndentBeUnapproved(indentLines.filter((line) => line.indentId === row.indentId))
                            }
                            title="Move indent back to Pending"
                            className="inline-flex h-9 w-9 items-center justify-center rounded border border-orange-700 bg-orange-100 text-orange-800 hover:bg-orange-200 transition disabled:opacity-50"
                          >
                            {unapprovingIndentId === row.indentId ? <Spinner size={16} /> : <RotateCcw size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/indent/view/${row.indentId}`)}
                            title="View Indent"
                            className="inline-flex h-9 w-9 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-50 transition"
                          >
                            <Eye size={16} />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )})
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
    </div>
    </div>
  );
}
