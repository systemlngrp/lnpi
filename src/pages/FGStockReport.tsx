import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { fetchNpdItems } from "../lib/npdItems";
import type { Item } from "../types";

type FgStockRow = {
  id: string;
  erp: string;
  itemName: string;
  customer: string;
  uom: string;
  opening: number;
  receipt: number;
  production: number;
  invoiced: number;
  balance: number;
  rate: number;
  stockValue: number;
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQty(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "-";
}

function toRow(item: Item): FgStockRow {
  const opening = numberValue(item.opening);
  const receipt = numberValue(item.receipt);
  const production = numberValue(item.production);
  const invoiced = numberValue(item.invoiced);
  const balance = numberValue(item.balance);
  const rate = numberValue(item.rate);

  return {
    id: String(item.id || item.npdId || item.itemId || item.erp || item.name || crypto.randomUUID()),
    erp: textValue(item.erp, (item as any).erpCode, (item as any).masterItemNameErpCode),
    itemName: textValue(item.name, (item as any).itemName),
    customer: textValue(item.customer, (item as any).customerName, (item as any).companyName, (item as any).partyName),
    uom: textValue(item.uom),
    opening,
    receipt,
    production,
    invoiced,
    balance,
    rate,
    stockValue: balance * rate,
  };
}

export function FGStockReport() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    fetchNpdItems()
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((err) => {
        if (active) setError((err as Error).message || "Failed to fetch FG stock.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const rows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return items
      .map(toRow)
      .filter((row) => row.balance > 0)
      .filter((row) => {
        if (!query) return true;
        return [row.erp, row.itemName, row.customer, row.uom].some((value) => String(value || "").toLowerCase().includes(query));
      })
      .sort((a, b) => b.balance - a.balance || a.erp.localeCompare(b.erp, undefined, { numeric: true, sensitivity: "base" }));
  }, [items, searchTerm]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          balance: acc.balance + row.balance,
          stockValue: acc.stockValue + row.stockValue,
        }),
        { balance: 0, stockValue: 0 },
      ),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-black pb-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">FG Stock</h2>
        </div>
        <div className="text-xs font-bold text-slate-700">Balance greater than 0 from NPD Items</div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Total FG Items</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{rows.length}</div>
        </div>
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Total Balance Qty</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{formatQty(totals.balance)}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Total Stock Value</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{formatQty(totals.stockValue)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_auto] md:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search ERP / item / customer / UOM"
              className="w-full rounded border-2 border-black py-2.5 pl-9 pr-3 text-sm focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          {searchTerm ? (
            <button type="button" onClick={() => setSearchTerm("")} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded border-2 border-black bg-white shadow-sm">
        <div className="max-h-[calc(100vh-220px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {["ERP", "Item Name", "Customer / Party", "UOM", "Opening", "Receipt", "Production", "Invoiced", "Balance", "Rate", "Stock Value"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap border-2 border-black bg-indigo-700 px-3 py-3 text-left text-xs font-black uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
              {rows.length > 0 ? (
                <tr className="bg-slate-100 text-black">
                  <th className="border-2 border-black bg-slate-100 px-3 py-3 text-left text-sm font-black" colSpan={8}>TOTAL</th>
                  <th className="border-2 border-black bg-emerald-100 px-3 py-3 text-left text-sm font-black text-emerald-900">{formatQty(totals.balance)}</th>
                  <th className="border-2 border-black bg-slate-100 px-3 py-3 text-left text-sm font-black">-</th>
                  <th className="border-2 border-black bg-purple-100 px-3 py-3 text-left text-sm font-black text-purple-900">{formatQty(totals.stockValue)}</th>
                </tr>
              ) : null}
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="border-2 border-black px-6 py-10 text-center font-medium text-black">Loading FG stock...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={11} className="border-2 border-black px-6 py-10 text-center font-medium text-red-700">{error}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="border-2 border-black px-6 py-10 text-center font-medium text-black">No FG stock found with balance greater than 0.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{row.erp}</td>
                    <td className="min-w-[260px] max-w-[420px] whitespace-normal break-words border-2 border-black px-3 py-3 text-sm text-black">{row.itemName}</td>
                    <td className="min-w-[180px] max-w-[320px] whitespace-normal break-words border-2 border-black px-3 py-3 text-sm text-black">{row.customer}</td>
                    <td className="whitespace-nowrap border-2 border-black px-3 py-3 text-sm text-black">{row.uom}</td>
                    <td className="border-2 border-black px-3 py-3 text-right text-sm text-black">{formatQty(row.opening)}</td>
                    <td className="border-2 border-black bg-blue-50/50 px-3 py-3 text-right text-sm text-blue-900">{formatQty(row.receipt)}</td>
                    <td className="border-2 border-black bg-cyan-50/50 px-3 py-3 text-right text-sm text-cyan-900">{formatQty(row.production)}</td>
                    <td className="border-2 border-black bg-red-50/40 px-3 py-3 text-right text-sm text-red-800">{formatQty(row.invoiced)}</td>
                    <td className="border-2 border-black bg-emerald-50 px-3 py-3 text-right text-sm font-bold text-emerald-900">{formatQty(row.balance)}</td>
                    <td className="border-2 border-black px-3 py-3 text-right text-sm text-black">{formatQty(row.rate)}</td>
                    <td className="border-2 border-black bg-purple-50 px-3 py-3 text-right text-sm font-bold text-purple-900">{formatQty(row.stockValue)}</td>
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
