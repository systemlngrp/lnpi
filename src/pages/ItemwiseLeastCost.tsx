import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { Production, Item } from "../types";
import { Spinner } from "../components/Spinner";
import { Search } from "lucide-react";
import { Select } from "../components/Select";
import { formatDate } from "../lib/serial";
import { ClientPagination } from "../components/ClientPagination";
import { DataSummaryTiles } from "../components/DataSummaryTiles";
import { useClientPagination } from "../hooks/useClientPagination";

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
  const npdItems = useNpdItems();
  const itemsLoading = false;
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");

  const isLoading = prodsLoading || itemsLoading;

  const leastCostData = useMemo(() => {
    const erpMap = new Map<string, LeastCostRecord>();

    productions.forEach((prod) => {
      // Skip canceled jobs
      if (prod.status === "Cancelled" || prod.cancelTimestamp) return;

      const erp = String(prod.erpCode || "").trim();
      const gsm = Number(prod.gsm || 0);
      
      if (!erp || isNaN(gsm) || gsm <= 0) return;

      const item = npdItems.find(i => i.id === prod.itemId);
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
  }, [productions, npdItems]);
  const filteredData = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return leastCostData.filter((row) => {
      if (!needle) return true;
      return row.erp.toLowerCase().includes(needle) || row.itemName.toLowerCase().includes(needle) || row.company.toLowerCase().includes(needle);
    });
  }, [companyFilter, itemFilter, leastCostData, searchTerm]);

  const companyOptions = useMemo(() => Array.from(new Set(leastCostData.map((row) => row.company).filter(Boolean))).sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name })), [leastCostData]);
  const itemOptions = useMemo(() => Array.from(new Map(leastCostData.map((row) => [`${row.itemName}::${row.erp}`, { value: `${row.itemName}::${row.erp}`, label: row.erp && row.itemName && !row.itemName.toLowerCase().includes(row.erp.toLowerCase()) ? `${row.itemName} - ${row.erp}` : row.itemName || row.erp, searchText: `${row.itemName} ${row.erp}` }])).values()).filter((option) => option.label).sort((a, b) => a.label.localeCompare(b.label)), [leastCostData]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedData,
  } = useClientPagination(filteredData, 25);

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

      <div className="flex flex-wrap items-end gap-3 bg-white border-2 border-black rounded p-3">
        <div className="flex min-w-72 flex-1 items-center gap-2 rounded border border-black px-3 py-2">
          <Search size={20} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search by ERP, Item or Company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 outline-none text-sm font-medium"
          />
        </div>
        <div className="min-w-[220px] flex-1"><Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" /></div>
        <div className="min-w-[260px] flex-1"><Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" /></div>
        {(searchTerm || companyFilter || itemFilter) ? (
          <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
        ) : null}
      </div>

      <DataSummaryTiles totalRecords={leastCostData.length} filteredRecords={filteredData.length} showingRecords={paginatedData.length} pageLabel={`${page} / ${Math.max(1, Math.ceil(totalItems / pageSize))}`} />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="table-sticky-scroll">
          <table className="min-w-[1600px] w-full divide-y divide-black border-collapse border border-black text-sm">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black whitespace-nowrap">
              <tr className="divide-x divide-black">
                <th className="px-3 py-3 text-left text-[10px] font-black text-black uppercase tracking-wider border-b border-black">SL No</th>
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
                  <td colSpan={19} className="px-6 py-12 text-center text-slate-500 font-bold italic uppercase tracking-widest bg-slate-50/50">
                    No data found matching your criteria
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors divide-x divide-black text-xs whitespace-nowrap">
                    <td className="px-3 py-2 font-bold text-black">{(page - 1) * pageSize + idx + 1}</td>
                    <td className="px-3 py-2 text-black">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 font-bold text-black">{row.jobCardNo}</td>
                    <td className="px-3 py-2 text-black min-w-[260px] max-w-[320px] truncate" title={row.itemName}>{row.itemName}</td>
                    <td className="px-3 py-2 font-bold text-black">{row.erp}</td>
                    <td className="px-3 py-2 text-black min-w-[180px] max-w-[240px] truncate" title={row.company}>{row.company}</td>
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
                <tfoot className="bg-slate-100 border-t border-black divide-y divide-black">
                    <tr>
                        <td colSpan={19} className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">
                            Total Unique ERPs: {filteredData.length}
                        </td>
                    </tr>
                </tfoot>
            )}
          </table>
        </div>
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
