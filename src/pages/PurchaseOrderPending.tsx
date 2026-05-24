import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Indent, IndentLine } from "../types";
import { formatDate } from "../lib/serial";
import { withIndentTotals } from "../lib/indentTotals";

export function PurchaseOrderPending() {
  const navigate = useNavigate();
  const [indents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);

  const pendingPoIndents = useMemo(() => {
    return indents
      .map((indent) => withIndentTotals(indent, indentLines.filter((line) => line.indentId === indent.id)))
      .filter((indent) => indent.status === "Approved" && Number(indent.totalBalanceQty || 0) > 0)
      .sort((a, b) => {
        const timeA = new Date(a.updateTimestamp || a.requisitionDate || 0).getTime();
        const timeB = new Date(b.updateTimestamp || b.requisitionDate || 0).getTime();
        return timeB - timeA;
      });
  }, [indentLines, indents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Purchase Order: Pending PO</h2>
      </div>

      <div className="overflow-hidden rounded border border-black bg-white shadow-sm">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Requested By</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Requisition Date</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Required Date</th>
              <th className="border border-black px-4 py-3 text-left text-sm font-bold uppercase text-black">Indent Type</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Indent Qty</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Ordered Qty</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Cancelled Qty</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Balance Qty</th>
              <th className="border border-black px-4 py-3 text-right text-sm font-bold uppercase text-black">Action</th>
            </tr>
          </thead>
          <tbody>
            {pendingPoIndents.length === 0 ? (
              <tr>
                <td colSpan={9} className="border border-black px-6 py-10 text-center font-medium text-black">
                  No approved indents are waiting for purchase orders.
                </td>
              </tr>
            ) : (
              pendingPoIndents.map((indent) => (
                <tr key={indent.id} className="hover:bg-slate-50">
                  <td className="border border-black px-4 py-4 text-sm text-black">{indent.requestedBy}</td>
                  <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(indent.requisitionDate)}</td>
                  <td className="border border-black px-4 py-4 text-sm text-black whitespace-nowrap">{formatDate(indent.requiredDate)}</td>
                  <td className="border border-black px-4 py-4 text-sm text-black">{indent.indentType}</td>
                  <td className="border border-black px-4 py-4 text-sm text-black text-right">{Number(indent.totalIndentQty || 0).toLocaleString()}</td>
                  <td className="border border-black px-4 py-4 text-sm text-black text-right">{Number(indent.totalOrderedQty || 0).toLocaleString()}</td>
                  <td className="border border-black px-4 py-4 text-sm text-black text-right">{Number(indent.totalCancelledQty || 0).toLocaleString()}</td>
                  <td className="border border-black px-4 py-4 text-sm font-bold text-black text-right">{Number(indent.totalBalanceQty || 0).toLocaleString()}</td>
                  <td className="border border-black px-4 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/purchase-orders/create/${indent.id}`)}
                      className="rounded border border-black bg-indigo-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-indigo-700 transition"
                    >
                      Create PO
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
}
