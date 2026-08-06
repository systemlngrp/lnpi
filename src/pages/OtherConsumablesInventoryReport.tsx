import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
import { useData } from "../hooks/useData";
import type { Material, MaterialGroup, MaterialIn, MaterialIssueLine, MaterialReturnLine } from "../types";

type OtherConsumableRow = {
  materialId: string;
  erp: string;
  itemName: string;
  groupName: string;
  groupId: string;
  uom: string;
  openingQty: number;
  receiptQty: number;
  issuedQty: number;
  returnedQty: number;
  availableQty: number;
  rate: number;
  valuation: number;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatQty(value: number) {
  return round2(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function makeOptions(values: Array<string | number>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

function lineQty(value: unknown, fallback: unknown) {
  const primary = Number(value);
  if (Number.isFinite(primary)) return primary;
  const secondary = Number(fallback);
  return Number.isFinite(secondary) ? secondary : 0;
}

function lineValue(value: unknown, qty: number, ...rates: unknown[]) {
  const explicitValue = Number(value);
  if (Number.isFinite(explicitValue)) return explicitValue;
  for (const rate of rates) {
    const numericRate = Number(rate);
    if (Number.isFinite(numericRate)) return qty * numericRate;
  }
  return 0;
}

export function OtherConsumablesInventoryReport() {
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialGroups] = useData<MaterialGroup>("material-groups", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [issueLines] = useData<MaterialIssueLine>("material-issue-lines", [], { cacheToLocalStorage: false });
  const [returnLines] = useData<MaterialReturnLine>("material-return-lines", [], { cacheToLocalStorage: false });

  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");

  const groupById = useMemo(() => new Map(materialGroups.map((group) => [group.id, group])), [materialGroups]);

  const allRows = useMemo<OtherConsumableRow[]>(() => {
    return materials
      .filter((material) => material.type === "Other")
      .map((material) => {
        const openingQty = Number(material.openingQty || 0);
        const openingRate = Number(material.openingRate || 0);
        const openingValue = Number(material.openingValue ?? (openingQty * openingRate)) || 0;

        let receiptQty = 0;
        let receiptValue = 0;
        materialIn.forEach((entry) => {
          entry.lines
            .filter((line) => line.itemId === material.id)
            .forEach((line) => {
              const qty = lineQty(line.actualQty, line.qty);
              receiptQty += qty;
              receiptValue += lineValue(line.actualValue ?? line.value, qty, line.rate, line.poRate, material.openingRate);
            });
        });

        let issuedQty = 0;
        let issuedValue = 0;
        issueLines
          .filter((line) => line.materialId === material.id)
          .forEach((line) => {
            const qty = Number(line.qty || 0);
            issuedQty += qty;
            issuedValue += lineValue(line.amount, qty, line.rate, line.lastPurchaseRate, line.openingRate, material.openingRate);
          });

        let returnedQty = 0;
        let returnedValue = 0;
        returnLines
          .filter((line) => line.materialId === material.id)
          .forEach((line) => {
            const qty = Number(line.qty || 0);
            returnedQty += qty;
            returnedValue += lineValue(line.amount, qty, line.rate, line.lastPurchaseRate, line.openingRate, material.openingRate);
          });

        const availableQty = openingQty + receiptQty - issuedQty + returnedQty;
        const availableValue = openingValue + receiptValue - issuedValue + returnedValue;
        const rate = availableQty !== 0 && Number.isFinite(availableValue) && availableValue !== 0 ? availableValue / availableQty : openingRate;
        const valuation = availableQty * rate;
        const group = material.materialGroupId ? groupById.get(material.materialGroupId) : null;

        return {
          materialId: material.id,
          erp: String(material.erpCode || ""),
          itemName: String(material.name || ""),
          groupName: group?.name || "-",
          groupId: material.materialGroupId || "",
          uom: material.uom || "-",
          openingQty: round2(openingQty),
          receiptQty: round2(receiptQty),
          issuedQty: round2(issuedQty),
          returnedQty: round2(returnedQty),
          availableQty: round2(availableQty),
          rate: round2(rate),
          valuation: round2(valuation),
        };
      })
      .sort((a, b) => a.erp.localeCompare(b.erp, undefined, { numeric: true, sensitivity: "base" }) || a.itemName.localeCompare(b.itemName));
  }, [groupById, issueLines, materialIn, materials, returnLines]);

  const groupOptions = useMemo(() => makeOptions(allRows.map((row) => row.groupName === "-" ? "" : row.groupName)), [allRows]);
  const itemOptions = useMemo(() => makeOptions(allRows.map((row) => row.itemName)), [allRows]);

  const rows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return allRows.filter((row) => {
      if (row.availableQty <= 0) return false;
      if (groupFilter && row.groupName !== groupFilter) return false;
      if (itemFilter && row.itemName !== itemFilter) return false;
      if (!query) return true;
      return [row.erp, row.itemName, row.uom, row.groupName].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [allRows, groupFilter, itemFilter, searchTerm]);

  const totals = useMemo(
    () => rows.reduce(
      (acc, row) => ({
        openingQty: acc.openingQty + row.openingQty,
        receiptQty: acc.receiptQty + row.receiptQty,
        issuedQty: acc.issuedQty + row.issuedQty,
        returnedQty: acc.returnedQty + row.returnedQty,
        availableQty: acc.availableQty + row.availableQty,
        valuation: acc.valuation + row.valuation,
      }),
      { openingQty: 0, receiptQty: 0, issuedQty: 0, returnedQty: 0, availableQty: 0, valuation: 0 }
    ),
    [rows]
  );

  const hasActiveFilters = Boolean(searchTerm || groupFilter || itemFilter);

  const clearFilters = () => {
    setSearchTerm("");
    setGroupFilter("");
    setItemFilter("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-black pb-3">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Other Consumables Inventory</h2>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Total Stock Qty</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{formatQty(totals.availableQty)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Total Items</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{rows.length}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Total Valuation</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{formatQty(totals.valuation)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[minmax(260px,1.4fr)_repeat(2,minmax(160px,1fr))_auto] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search ERP / item / group"
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <Select value={groupFilter} onChange={setGroupFilter} options={groupOptions} placeholder="All Groups" />
          <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
            >
              Clear Filters
            </button>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border-2 border-black overflow-hidden">
        <div className="max-h-[calc(100vh-220px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                  {["ERP", "Item Name", "Group", "UOM", "Opening", "Receipt", "Issue", "Available Qty", "Rate", "Valuation"].map((heading) => (
                  <th key={heading} className="bg-indigo-700 px-3 py-3 text-left text-xs font-black border-2 border-black whitespace-nowrap uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
              {rows.length > 0 ? (
                <tr className="bg-slate-100 text-black">
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100" colSpan={4}>TOTAL</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">{formatQty(totals.openingQty)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">{formatQty(totals.receiptQty)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">{formatQty(totals.issuedQty)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-emerald-100 text-emerald-900">{formatQty(totals.availableQty)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">-</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-purple-100 text-purple-900">{formatQty(totals.valuation)}</th>
                </tr>
              ) : null}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                    No other consumable inventory rows found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.materialId} className={row.availableQty <= 0 ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-slate-50"}>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.erp}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black min-w-[240px]">{row.itemName || "-"}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black min-w-[160px]">{row.groupName}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.uom}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{formatQty(row.openingQty)}</td>
                    <td className="px-3 py-3 text-blue-900 text-sm border-2 border-black bg-blue-50/50">{formatQty(row.receiptQty)}</td>
                    <td className="px-3 py-3 text-red-800 text-sm border-2 border-black bg-red-50/40">{formatQty(row.issuedQty)}</td>
                    <td className="px-3 py-3 text-emerald-900 text-sm font-bold border-2 border-black bg-emerald-50">{formatQty(row.availableQty)}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{formatQty(row.rate)}</td>
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50">{formatQty(row.valuation)}</td>
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
