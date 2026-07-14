import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import { Item } from "../types";

export function LegacyItemsMaster() {
  const [items] = useData<Item>("legacy_items", [], {
    endpointOverride: "/api/legacy-items",
    storageKey: "legacy_items",
    syncEventKey: "sync-data-legacy_items",
  });
  const [searchTerm, setSearchTerm] = useState("");

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [
        item.name,
        String(item.erp || ""),
        String(item.customer || ""),
        String(item.uom || ""),
        String(item.typeName || item.itemType || ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [items, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Legacy Item Master is now read-only. Active item-linked workflows use `NPD Items` as the source of truth.
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Legacy Item Master</h2>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search legacy item, ERP, customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black text-sm">
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr>
                <th className="px-3 py-2 border border-black text-left">Name</th>
                <th className="px-3 py-2 border border-black text-left">ERP</th>
                <th className="px-3 py-2 border border-black text-left">Customer</th>
                <th className="px-3 py-2 border border-black text-left">Type</th>
                <th className="px-3 py-2 border border-black text-left">UOM</th>
                <th className="px-3 py-2 border border-black text-left">Rate</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 border border-black text-center italic">
                    No legacy items found.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 border border-black">{item.name || "-"}</td>
                    <td className="px-3 py-2 border border-black">{item.erp ?? "-"}</td>
                    <td className="px-3 py-2 border border-black">{item.customer || "-"}</td>
                    <td className="px-3 py-2 border border-black">{item.typeName || item.itemType || "-"}</td>
                    <td className="px-3 py-2 border border-black">{item.uom || "-"}</td>
                    <td className="px-3 py-2 border border-black">{item.rate ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
