import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { OrderItemSource, Production } from "../types";
import { ClientPagination } from "../components/ClientPagination";
import { TableControls } from "../components/TableControls";
import { useClientPagination } from "../hooks/useClientPagination";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel } from "../lib/orderItems";

type StandaloneProductionMasterProps = {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
};

export function StandaloneProductionMaster({ source }: StandaloneProductionMasterProps) {
  const [productions, setProductions] = useData<Production>("productions", []);
  const { itemsBySource } = useOrderItemCatalog();
  const items = itemsBySource[source] || [];
  const [searchTerm, setSearchTerm] = useState("");

  const filteredList = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return productions
      .filter((production) => (production.itemSource || "FG") === source)
      .filter((production) => {
        if (!normalizedSearch) return true;
        const item = items.find((entry) => entry.id === String(production.itemId || "").trim());
        const haystack = [
          production.transactionNo,
          production.date,
          production.erpCode,
          production.companyName,
          production.status,
          production.remarks,
          item?.name,
          item?.erp,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => new Date(b.updateTimestamp || b.date || 0).getTime() - new Date(a.updateTimestamp || a.date || 0).getTime());
  }, [items, productions, searchTerm, source]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(filteredList, 25);

  const handleCancel = async (id: string) => {
    const remarks = window.prompt("Enter cancel reason");
    if (!remarks?.trim()) return;
    const timestamp = new Date().toISOString();
    await setProductions((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              status: "Cancelled",
              cancelRemarks: remarks.trim(),
              cancelTimestamp: timestamp,
              cancelEmailId: "System User",
              updatedBy: "System User",
              updateTimestamp: timestamp,
            }
          : row
      )
    );
  };

  const sourceLabel = getOrderItemSourceLabel(source);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">{sourceLabel} Production Master</h2>
      </div>
      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />
      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Job No</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Item</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">ERP</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Company</th>
              <th className="px-3 py-2 text-right text-xs font-black uppercase">Qty</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">UOM</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Status</th>
              <th className="px-3 py-2 text-left text-xs font-black uppercase">Remarks</th>
              <th className="px-3 py-2 text-center text-xs font-black uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
              </tr>
            ) : (
              paginatedItems.map((row) => {
                const item = items.find((entry) => entry.id === String(row.itemId || "").trim());
                return (
                  <tr key={row.id} className="border-t border-black">
                    <td className="px-3 py-2 text-sm font-semibold">{row.transactionNo}</td>
                    <td className="px-3 py-2 text-sm">{row.date}</td>
                    <td className="px-3 py-2 text-sm">{item?.name || row.itemId}</td>
                    <td className="px-3 py-2 text-sm">{row.erpCode || item?.erp || "-"}</td>
                    <td className="px-3 py-2 text-sm">{row.companyName || item?.companyName || "-"}</td>
                    <td className="px-3 py-2 text-sm text-right">{Number(row.qty || 0)}</td>
                    <td className="px-3 py-2 text-sm">{row.uom || item?.uom || "-"}</td>
                    <td className="px-3 py-2 text-sm">{row.status}</td>
                    <td className="px-3 py-2 text-sm">{row.cancelRemarks || row.remarks || "-"}</td>
                    <td className="px-3 py-2 text-center text-sm">
                      <button
                        type="button"
                        disabled={row.status === "Cancelled"}
                        onClick={() => void handleCancel(row.id)}
                        className="rounded border border-black px-2 py-1 font-bold uppercase disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
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
    </div>
  );
}
