import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueReelLine,
  MaterialReturnReelLine,
} from "../types";
import { getAvailableReelPackingSlips } from "../lib/materialMovement";

type ReelStockRow = {
  materialId: string;
  erp: string;
  size: number;
  gsm: number;
  bf: number;
  openingStock: number;
  issued: number;
  returned: number;
  availableWeight: number;
  rate: number;
  valuation: number;
  noOfReels: number;
};

export function ErpWiseReelStockReport() {
  const [materials] = useData<Material>("materials", []);
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [searchTerm, setSearchTerm] = useState("");

  const rows = useMemo<ReelStockRow[]>(() => {
    const latestMaterialIn = [...materialIn].sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
      const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
      return timeB - timeA;
    });

    return materials
      .filter((material) => material.type === "Reel")
      .map((material) => {
        const openingStock = Number(material.openingQty || 0);
        const issued = issueReelLines
          .filter((line) => line.materialId === material.id)
          .reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
        const returned = returnReelLines
          .filter((line) => line.materialId === material.id)
          .reduce((sum, line) => sum + Number(line.weightKg || 0), 0);
        const received = latestMaterialIn.reduce((sum, entry) => {
          const line = entry.lines.find((row) => row.itemId === material.id);
          if (!line) return sum;
          return sum + Number(line.actualQty ?? line.qty ?? 0);
        }, 0);
        const availableWeight = Math.max(0, Number((openingStock + received + returned - issued).toFixed(2)));
        const latestRate =
          latestMaterialIn
            .map((entry) => entry.lines.find((row) => row.itemId === material.id))
            .find(Boolean)?.invoiceRate ??
          latestMaterialIn
            .map((entry) => entry.lines.find((row) => row.itemId === material.id))
            .find(Boolean)?.rate ??
          Number(material.openingRate || 0);
        const availableReelCount = getAvailableReelPackingSlips(material.id, packingSlips, issueReelLines, returnReelLines).length;

        return {
          materialId: material.id,
          erp: String(material.erpCode || ""),
          size: Number(material.size || 0),
          gsm: Number(material.gsm || 0),
          bf: Number(material.bf || 0),
          openingStock,
          issued: Number(issued.toFixed(2)),
          returned: Number(returned.toFixed(2)),
          availableWeight,
          rate: Number(Number(latestRate || 0).toFixed(2)),
          valuation: Number((availableWeight * Number(latestRate || 0)).toFixed(2)),
          noOfReels: availableReelCount,
        };
      })
      .filter((row) => {
        const lowered = searchTerm.trim().toLowerCase();
        if (!lowered) return true;
        return (
          row.erp.toLowerCase().includes(lowered) ||
          String(row.size).includes(lowered) ||
          String(row.gsm).includes(lowered) ||
          String(row.bf).includes(lowered)
        );
      })
      .sort((a, b) => a.erp.localeCompare(b.erp) || a.size - b.size || a.gsm - b.gsm || a.bf - b.bf);
  }, [issueReelLines, materialIn, materials, packingSlips, returnReelLines, searchTerm]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          openingStock: acc.openingStock + row.openingStock,
          issued: acc.issued + row.issued,
          returned: acc.returned + row.returned,
          availableWeight: acc.availableWeight + row.availableWeight,
          valuation: acc.valuation + row.valuation,
          noOfReels: acc.noOfReels + row.noOfReels,
        }),
        { openingStock: 0, issued: 0, returned: 0, availableWeight: 0, valuation: 0, noOfReels: 0 }
      ),
    [rows]
  );

  // Downloads removed (only shown in Delivery Book)

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">ERP Wise Reel Stock</h2>
          <p className="text-sm text-slate-600 font-medium">Opening + receipts + returns - issues, with valuation by latest purchase rate or opening rate.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search ERP / size / GSM / BF"
              className="w-full rounded border-2 border-black pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
          </div>
          {/* Downloads removed (only shown in Delivery Book) */}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border border-black overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-indigo-700 text-white">
                {["ERP", "SIZE", "GSM", "BF", "Opening Stock", "ISSUED", "RETURNED", "Available Weight", "Rate Valuation", "VALUATION", "NO OF REELS"].map((heading) => (
                  <th key={heading} className="px-4 py-4 text-left text-sm font-bold border-2 border-black whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-10 text-center text-black font-medium border-2 border-black">
                    No reel stock rows found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.materialId} className="hover:bg-slate-50">
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.erp}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.size || ""}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.gsm || ""}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.bf || ""}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.openingStock.toFixed(2)}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.issued.toFixed(2)}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.returned.toFixed(2)}</td>
                    <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{row.availableWeight.toFixed(2)}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.rate.toFixed(2)}</td>
                    <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{row.valuation.toFixed(2)}</td>
                    <td className="px-4 py-4 text-black text-sm border-2 border-black">{row.noOfReels}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="bg-slate-100">
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black" colSpan={4}>TOTAL</td>
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{totals.openingStock.toFixed(2)}</td>
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{totals.issued.toFixed(2)}</td>
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{totals.returned.toFixed(2)}</td>
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{totals.availableWeight.toFixed(2)}</td>
                  <td className="px-4 py-4 text-black text-sm border-2 border-black">-</td>
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{totals.valuation.toFixed(2)}</td>
                  <td className="px-4 py-4 text-black text-sm font-bold border-2 border-black">{totals.noOfReels}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
