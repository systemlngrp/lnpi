import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Production, Item } from "../types";
import { Spinner } from "../components/Spinner";
import { Search } from "lucide-react";
import { formatDate } from "../lib/serial";

interface LeastCostRecord {
  date: string;
  jobCardNo: string;
  itemName: string;
  erp: string;
  company: string;
  length: number;
  breadth: number;
  height: number;
  reelAsPerCalc: number;
  reelActual: number;
  cutting: number;
  l1: number;
  f1: number;
  l2: number;
  f2: number;
  l3: number;
  gsm: number;
  sheetWeight: number;
}

export function ItemwiseLeastCost() {
  const [productions, , prodsLoading] = useData<Production>("productions", []);
  const [items, , itemsLoading] = useData<Item>("items", []);
  const [searchTerm, setSearchTerm] = useState("");

  const isLoading = prodsLoading || itemsLoading;

  const leastCostData = useMemo(() => {
    const erpMap = new Map<string, LeastCostRecord>();

    productions.forEach((prod) => {
      // Skip canceled jobs
      if (prod.status === "Cancelled" || prod.cancelTimestamp) return;

      const erp = String(prod.erpCode || "").trim();
      const gsm = Number(prod.gsm || 0);
      
      if (!erp || isNaN(gsm) || gsm <= 0) return;

      const item = items.find(i => i.id === prod.itemId);
      const itemName = item?.name || String(prod.itemId || "Unknown Item");

      if (!erpMap.has(erp) || gsm < erpMap.get(erp)!.gsm) {
        erpMap.set(erp, {
          date: prod.date,
          jobCardNo: String(prod.transactionNo || ""),
          itemName,
          erp,
          company: prod.companyName || "",
          length: Number(prod.length || 0),
          breadth: Number(prod.breadth || 0),
          height: Number(prod.height || 0),
          reelAsPerCalc: Number(prod.reelAsPerCalc || 0),
          reelActual: Number(prod.reelActualWithTrimming || 0),
          cutting: Number(prod.cuttingWithTrimming || 0),
          l1: Number(prod.l1 || 0),
          f1: Number(prod.f1 || 0),
          l2: Number(prod.l2 || 0),
          f2: Number(prod.f2 || 0),
          l3: Number(prod.l3 || 0),
          gsm,
          sheetWeight: Number(prod.sheetWeight || 0)
        });
      }
    });

    return Array.from(erpMap.values()).sort((a, b) => a.erp.localeCompare(b.erp));
  }, [productions, items]);

  const filteredData = useMemo(() => {
    return leastCostData.filter(row => 
      row.erp.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.company.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [leastCostData, searchTerm]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Itemwise Least Cost</h2>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Detailed View - Lowest GSM per ERP</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-white border-2 border-black rounded p-2 max-w-md">
        <Search size={20} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search by ERP, Item or Company..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 outline-none text-sm font-medium"
        />
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="bg-slate-50 whitespace-nowrap">
              <tr className="divide-x divide-black">
                <th className="px-3 py-3 text-left text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Date</th>
                <th className="px-3 py-3 text-left text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Job No</th>
                <th className="px-3 py-3 text-left text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Item Name</th>
                <th className="px-3 py-3 text-left text-[10px] font-black text-black uppercase tracking-wider border-b border-black">ERP</th>
                <th className="px-3 py-3 text-left text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Company</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">L</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">B</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">H</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Reel Calc</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Reel Act</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Cut</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">L1</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">F1</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">L2</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">F2</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">L3</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">GSM</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-black uppercase tracking-wider border-b border-black">Sheet Wt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={18} className="px-6 py-12 text-center text-slate-500 font-bold italic uppercase tracking-widest bg-slate-50/50">
                    No data found matching your criteria
                  </td>
                </tr>
              ) : (
                filteredData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors divide-x divide-black text-[11px] whitespace-nowrap">
                    <td className="px-3 py-2 text-black">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 font-bold text-black">{row.jobCardNo}</td>
                    <td className="px-3 py-2 text-black max-w-[150px] truncate" title={row.itemName}>{row.itemName}</td>
                    <td className="px-3 py-2 font-bold text-black">{row.erp}</td>
                    <td className="px-3 py-2 text-black max-w-[120px] truncate" title={row.company}>{row.company}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{row.length}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{row.breadth}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{row.height}</td>
                    <td className="px-3 py-2 text-right text-indigo-600">{row.reelAsPerCalc}</td>
                    <td className="px-3 py-2 text-right text-indigo-600 font-medium">{row.reelActual}</td>
                    <td className="px-3 py-2 text-right text-indigo-600">{row.cutting}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.l1}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.f1}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.l2}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.f2}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.l3}</td>
                    <td className="px-3 py-2 text-right font-black text-emerald-700">{row.gsm}</td>
                    <td className="px-3 py-2 text-right text-black font-medium">{row.sheetWeight}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredData.length > 0 && (
                <tfoot className="bg-slate-100 border-t border-black">
                    <tr>
                        <td colSpan={18} className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">
                            Total Unique ERPs: {filteredData.length}
                        </td>
                    </tr>
                </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
