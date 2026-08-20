import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
import { ExcelExport } from "../components/ExcelExport";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
} from "../types";
import { buildReelStockRows } from "../lib/reelStock";

type ReelStockRow = {
  materialId: string;
  erp: string;
  itemName: string;
  size: number;
  gsm: number;
  bf: number;
  openingStock: number;
  receipts: number;
  issued: number;
  returned: number;
  netIssued: number;
  availableWeight: number;
  tallyStock: number | null;
  stockDifference: number | null;
  rate: number;
  valuation: number;
  noOfReels: number;
};

function makeOptions(values: Array<string | number>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

function formatQty(value: number) {
  return Number(value || 0).toFixed(2);
}

export function ErpWiseReelStockReport() {
  const [materials] = useData<Material>("materials", [], { cacheToLocalStorage: false });
  const [materialIn] = useData<MaterialIn>("material-in", [], { cacheToLocalStorage: false });
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", [], { cacheToLocalStorage: false });
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [searchTerm, setSearchTerm] = useState("");
  const [mrrFilter, setMrrFilter] = useState("");
  const [erpFilter, setErpFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [gsmFilter, setGsmFilter] = useState("");
  const [bfFilter, setBfFilter] = useState("");

  const allReelRows = useMemo(() => buildReelStockRows({
    materials,
    materialIn,
    packingSlips,
    issueReelLines,
    returnReelLines,
  }), [issueReelLines, materialIn, materials, packingSlips, returnReelLines]);

  const allRows = useMemo<ReelStockRow[]>(() => {
    const sourceReelRows = mrrFilter
      ? allReelRows.filter((row) => row.mrrNo === mrrFilter)
      : allReelRows;

    return materials
      .filter((material) => material.type === "Reel")
      .map((material) => {
        const materialReelRows = sourceReelRows.filter((row) => row.materialId === material.id);
        const openingStock = materialReelRows.reduce((sum, row) => sum + Number(row.openingQty || 0), 0);
        const receipts = materialReelRows.reduce((sum, row) => sum + Number(row.mrrQty || 0), 0);
        const issued = materialReelRows.reduce((sum, row) => sum + Number(row.issuedWeight || 0), 0);
        const returned = materialReelRows.reduce((sum, row) => sum + Number(row.returnedWeight || 0), 0);
        const netIssued = Number((issued - returned).toFixed(2));
        const availableWeight = Number(materialReelRows.reduce((sum, row) => sum + row.availableWeight, 0).toFixed(2));
        const valuation = Number(materialReelRows.reduce((sum, row) => sum + row.valuation, 0).toFixed(2));
        const noOfReels = materialReelRows.filter((row) => row.availableWeight > 0).length;
        const tallyStock = material.tallyStock == null ? null : Number(Number(material.tallyStock || 0).toFixed(2));
        const stockDifference = tallyStock == null ? null : Number((tallyStock - availableWeight).toFixed(2));
        const rate = availableWeight > 0 ? Number((valuation / availableWeight).toFixed(2)) : 0;

        return {
          materialId: material.id,
          erp: String(material.erpCode || ""),
          itemName: String(material.name || ""),
          size: Number(material.size || 0),
          gsm: Number(material.gsm || 0),
          bf: Number(material.bf || 0),
          openingStock,
          receipts: Number(receipts.toFixed(2)),
          issued: Number(issued.toFixed(2)),
          returned: Number(returned.toFixed(2)),
          netIssued,
          availableWeight,
          tallyStock,
          stockDifference,
          rate,
          valuation,
          noOfReels,
        };
      })
      .filter((row) => !mrrFilter || row.openingStock > 0 || row.receipts > 0 || row.issued > 0 || row.returned > 0 || row.availableWeight > 0)
      .sort((a, b) => a.erp.localeCompare(b.erp) || a.size - b.size || a.gsm - b.gsm || a.bf - b.bf);
  }, [allReelRows, materials, mrrFilter]);
  const mrrOptions = useMemo(() => makeOptions(allReelRows.map((row) => row.mrrNo)), [allReelRows]);
  const erpOptions = useMemo(() => makeOptions(allRows.map((row) => row.erp)), [allRows]);
  const sizeOptions = useMemo(() => makeOptions(allRows.map((row) => row.size || "")), [allRows]);
  const gsmOptions = useMemo(() => makeOptions(allRows.map((row) => row.gsm || "")), [allRows]);
  const bfOptions = useMemo(() => makeOptions(allRows.map((row) => row.bf || "")), [allRows]);

  const rows = useMemo<ReelStockRow[]>(() => {
    const query = searchTerm.trim().toLowerCase();
    return allRows
      .filter((row) => {
        if (erpFilter && row.erp !== erpFilter) return false;
        if (sizeFilter && String(row.size) !== sizeFilter) return false;
        if (gsmFilter && String(row.gsm) !== gsmFilter) return false;
        if (bfFilter && String(row.bf) !== bfFilter) return false;
        if (!query) return true;
        return [row.erp, row.itemName, row.size, row.gsm, row.bf]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const availabilityDiff = Number(a.availableWeight <= 0) - Number(b.availableWeight <= 0);
        if (availabilityDiff !== 0) return availabilityDiff;
        return a.erp.localeCompare(b.erp) || a.size - b.size || a.gsm - b.gsm || a.bf - b.bf;
      });
  }, [allRows, bfFilter, erpFilter, gsmFilter, searchTerm, sizeFilter]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          openingStock: acc.openingStock + row.openingStock,
          receipts: acc.receipts + row.receipts,
          issued: acc.issued + row.issued,
          returned: acc.returned + row.returned,
          netIssued: acc.netIssued + row.netIssued,
          availableWeight: acc.availableWeight + row.availableWeight,
          tallyStock: acc.tallyStock + Number(row.tallyStock || 0),
          stockDifference: acc.stockDifference + Number(row.stockDifference || 0),
          valuation: acc.valuation + row.valuation,
          noOfReels: acc.noOfReels + row.noOfReels,
        }),
        { openingStock: 0, receipts: 0, issued: 0, returned: 0, netIssued: 0, availableWeight: 0, tallyStock: 0, stockDifference: 0, valuation: 0, noOfReels: 0 }
      ),
    [rows]
  );

  const totalErps = useMemo(
    () => new Set(rows.map((row) => row.erp).filter(Boolean)).size,
    [rows]
  );

  const hasActiveFilters = Boolean(searchTerm || mrrFilter || erpFilter || sizeFilter || gsmFilter || bfFilter);


  const excelRows = useMemo(
    () => [
      ...(rows.length > 0 ? [{
        ERP: "TOTAL",
        "Item Name": "",
        SIZE: "",
        GSM: "",
        BF: "",
        "Opening Stock": Number(formatQty(totals.openingStock)),
        Receipt: Number(formatQty(totals.receipts)),
        Issued: "-",
        Return: "-",
        "Net Issued": Number(formatQty(totals.netIssued)),
        "Available Weight": Number(formatQty(totals.availableWeight)),
        "Tally Stock": Number(formatQty(totals.tallyStock)),
        Difference: Number(formatQty(totals.stockDifference)),
        Rate: "-",
        VALUATION: Number(formatQty(totals.valuation)),
        "NO OF REELS": totals.noOfReels,
      }] : []),
      ...rows.map((row) => ({
        ERP: row.erp,
        "Item Name": row.itemName || "-",
        SIZE: row.size || "",
        GSM: row.gsm || "",
        BF: row.bf || "",
        "Opening Stock": Number(formatQty(row.openingStock)),
        Receipt: Number(formatQty(row.receipts)),
        Issued: Number(formatQty(row.issued)),
        Return: Number(formatQty(row.returned)),
        "Net Issued": Number(formatQty(row.netIssued)),
        "Available Weight": Number(formatQty(row.availableWeight)),
        "Tally Stock": row.tallyStock == null ? "" : Number(formatQty(row.tallyStock)),
        Difference: row.stockDifference == null ? "" : Number(formatQty(row.stockDifference)),
        Rate: Number(formatQty(row.rate)),
        VALUATION: Number(formatQty(row.valuation)),
        "NO OF REELS": row.noOfReels,
      })),
    ],
    [rows, totals]
  );
  const clearFilters = () => {
    setSearchTerm("");
    setMrrFilter("");
    setErpFilter("");
    setSizeFilter("");
    setGsmFilter("");
    setBfFilter("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-black pb-3">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">ERP Wise Reel Stock</h2>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-xs font-black uppercase text-emerald-700">Total Available Stock</div>
          <div className="mt-1 text-2xl font-black text-emerald-900">{formatQty(totals.availableWeight)}</div>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase text-amber-700">Total ERPs</div>
          <div className="mt-1 text-2xl font-black text-amber-900">{totalErps}</div>
        </div>
        <div className="rounded border border-purple-300 bg-purple-50 p-4">
          <div className="text-xs font-black uppercase text-purple-700">Total Valuation</div>
          <div className="mt-1 text-2xl font-black text-purple-900">{formatQty(totals.valuation)}</div>
        </div>
      </div>

      <div className="rounded border border-black bg-white p-3">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[minmax(260px,1.4fr)_repeat(5,minmax(140px,1fr))_auto] xl:items-center">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search ERP / item / size / GSM / BF"
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          <Select value={mrrFilter} onChange={setMrrFilter} options={mrrOptions} placeholder="All MRR" />
          <Select value={erpFilter} onChange={setErpFilter} options={erpOptions} placeholder="All ERP" />
          <Select value={sizeFilter} onChange={setSizeFilter} options={sizeOptions} placeholder="All Size" />
          <Select value={gsmFilter} onChange={setGsmFilter} options={gsmOptions} placeholder="All GSM" />
          <Select value={bfFilter} onChange={setBfFilter} options={bfOptions} placeholder="All BF" />
          <div className="flex items-center justify-end gap-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-[42px] rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50"
              >
                Clear Filters
              </button>
            ) : null}
            <ExcelExport data={excelRows} fileName="ERP_Wise_Reel_Stock" sheetName="ERP Wise Stock" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border-2 border-black overflow-hidden">
        <div className="max-h-[calc(100vh-220px)] w-full overflow-auto relative">
          <table className="w-full min-w-max border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-indigo-700 text-white">
                {["ERP", "Item Name", "SIZE", "GSM", "BF", "Opening Stock", "Receipt", "Issued", "Return", "Net Issued", "Available Weight", "Tally Stock", "Difference", "Rate", "VALUATION", "NO OF REELS"].map((heading) => (
                  <th key={heading} className="bg-indigo-700 px-3 py-3 text-left text-xs font-black border-2 border-black whitespace-nowrap uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
              {rows.length > 0 ? (
                <tr className="bg-slate-100 text-black">
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100" colSpan={5}>TOTAL</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">{formatQty(totals.openingStock)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">{formatQty(totals.receipts)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">-</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">-</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">{formatQty(totals.netIssued)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-emerald-100 text-emerald-900">{formatQty(totals.availableWeight)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-cyan-100 text-cyan-900">{formatQty(totals.tallyStock)}</th>
                  <th className={`px-3 py-3 text-left text-sm font-black border-2 border-black ${Math.abs(totals.stockDifference) > 0.01 ? "bg-red-100 text-red-900" : "bg-emerald-100 text-emerald-900"}`}>{formatQty(totals.stockDifference)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-slate-100">-</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-purple-100 text-purple-900">{formatQty(totals.valuation)}</th>
                  <th className="px-3 py-3 text-left text-sm font-black border-2 border-black bg-amber-100 text-amber-900">{totals.noOfReels}</th>
                </tr>
              ) : null}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                    No reel stock rows found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.materialId} className={row.noOfReels === 0 ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-slate-50"}>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.erp}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black min-w-[220px]">{row.itemName || "-"}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.size || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.gsm || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{row.bf || ""}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{formatQty(row.openingStock)}</td>
                    <td className="px-3 py-3 text-blue-900 text-sm border-2 border-black bg-blue-50/50">{formatQty(row.receipts)}</td>
                    <td className="px-3 py-3 text-red-800 text-sm border-2 border-black bg-red-50/40">{formatQty(row.issued)}</td>
                    <td className="px-3 py-3 text-cyan-900 text-sm border-2 border-black bg-cyan-50/50">{formatQty(row.returned)}</td>
                    <td className="px-3 py-3 text-slate-900 text-sm font-bold border-2 border-black bg-slate-50">{formatQty(row.netIssued)}</td>
                    <td className="px-3 py-3 text-emerald-900 text-sm font-bold border-2 border-black bg-emerald-50">{formatQty(row.availableWeight)}</td>
                    <td className="px-3 py-3 text-cyan-900 text-sm font-bold border-2 border-black bg-cyan-50">{row.tallyStock == null ? "-" : formatQty(row.tallyStock)}</td>
                    <td className={`px-3 py-3 text-sm font-bold border-2 border-black ${row.stockDifference == null ? "text-slate-500 bg-slate-50" : Math.abs(row.stockDifference) > 0.01 ? "text-red-800 bg-red-50" : "text-emerald-800 bg-emerald-50"}`}>{row.stockDifference == null ? "-" : formatQty(row.stockDifference)}</td>
                    <td className="px-3 py-3 text-black text-sm border-2 border-black">{formatQty(row.rate)}</td>
                    <td className="px-3 py-3 text-purple-900 text-sm font-bold border-2 border-black bg-purple-50">{formatQty(row.valuation)}</td>
                    <td className="px-3 py-3 text-amber-900 text-sm font-bold border-2 border-black bg-amber-50">{row.noOfReels}</td>
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
