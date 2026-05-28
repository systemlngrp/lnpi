import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Eye } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { ExcelExport } from "../components/ExcelExport";

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
};

export function PurchaseOrderPendingIndentLines() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PendingIndentLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchRows = async () => {
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
  };

  useEffect(() => {
    fetchRows();
  }, []);

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

  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-black pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Indent Lines (PO)</h2>
          <ExcelExport data={filteredRows} fileName="Pending_Indent_Lines_PO" />
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search requisition no, item, ERP, requested by..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded border border-black bg-white py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded border border-black bg-white shadow-sm overflow-hidden">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100">
            <tr>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Requisition No</th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Requisition Date</th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black">Requested By</th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black min-w-[320px]">Material</th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">UOM</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Qty</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Cancelled</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">PO Created</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Pending</th>
              <th className="border border-black px-4 py-3 text-left text-xs font-bold uppercase text-black whitespace-nowrap">Target Delivery</th>
              <th className="border border-black px-4 py-3 text-right text-xs font-bold uppercase text-black whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="border border-black px-6 py-10 text-center text-sm text-slate-600">
                  No pending indent lines found.
                </td>
              </tr>
            ) : (
              filteredRows
                .slice()
                .sort((a, b) => {
                  const ad = new Date(a.targetDeliveryDate || a.requisitionDate || 0).getTime();
                  const bd = new Date(b.targetDeliveryDate || b.requisitionDate || 0).getTime();
                  return ad - bd;
                })
                .map((row) => (
                  <tr key={row.indentLineId} className="hover:bg-slate-50">
                    <td className="border border-black px-4 py-3 text-sm font-bold text-black whitespace-nowrap">
                      {row.indentNo || row.indentId}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">
                      {row.requisitionDate ? formatDate(row.requisitionDate) : ""}
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black">{row.requestedBy}</td>
                    <td className="border border-black px-4 py-3 text-sm text-black">
                      <div className="font-bold">{row.materialName}</div>
                      <div className="text-xs text-slate-500 uppercase">{row.materialErpCode}</div>
                    </td>
                    <td className="border border-black px-4 py-3 text-sm text-black whitespace-nowrap">{row.uom}</td>
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
                        <button
                          type="button"
                          onClick={() => navigate(`/indent/view/${row.indentId}`)}
                          title="View Indent"
                          className="inline-flex h-9 w-9 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-50 transition"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

