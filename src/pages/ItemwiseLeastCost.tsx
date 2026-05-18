import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Production, Item } from "../types";
import { Spinner } from "../components/Spinner";
import { ExcelExport } from "../components/ExcelExport";
import { FileText, Search, Download } from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";

export function ItemwiseLeastCost() {
  const [productions, , prodsLoading] = useData<Production>("productions", []);
  const [items, , itemsLoading] = useData<Item>("items", []);
  const [searchTerm, setSearchTerm] = useState("");

  const isLoading = prodsLoading || itemsLoading;

  const leastCostData = useMemo(() => {
    // Group by ERP Code and find min GSM
    const erpMap = new Map<string, { erp: string; itemName: string; gsm: number }>();

    productions.forEach((prod) => {
      const erp = String(prod.erpCode || "").trim();
      const gsm = Number(prod.gsm || 0);
      
      if (!erp || isNaN(gsm) || gsm <= 0) return;

      const item = items.find(i => i.id === prod.itemId);
      const itemName = item?.name || String(prod.itemId || "Unknown Item");

      if (!erpMap.has(erp) || gsm < erpMap.get(erp)!.gsm) {
        erpMap.set(erp, { erp, itemName, gsm });
      }
    });

    return Array.from(erpMap.values()).sort((a, b) => a.erp.localeCompare(b.erp));
  }, [productions, items]);

  const filteredData = useMemo(() => {
    return leastCostData.filter(row => 
      row.erp.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.itemName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [leastCostData, searchTerm]);

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.text("Itemwise Least Cost Report", 14, 15);
    
    const tableColumn = ["ERP", "Item Name", "GSM"];
    const tableRows = filteredData.map(row => [row.erp, row.itemName, row.gsm]);

    (doc as any).autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 20,
      theme: 'grid',
      headStyles: { fillGray: 200, textColor: 0, fontStyle: 'bold' }
    });

    doc.save(`Itemwise_Least_Cost_${new Date().toISOString().split('T')[0]}.pdf`);
  };

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
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Based on Production Master</p>
        </div>
        <div className="flex flex-wrap gap-2">
           <ExcelExport 
            data={filteredData} 
            fileName="Itemwise_Least_Cost" 
            sheetName="LeastCost"
          />
          <button
            onClick={handleExportPDF}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-bold border border-red-700 text-red-700 hover:bg-red-50 transition-colors uppercase tracking-tight"
            title="Download PDF"
          >
            <Download size={16} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-white border-2 border-black rounded p-2 max-w-md">
        <Search size={20} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search by ERP or Item Name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 outline-none text-sm font-medium"
        />
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse">
            <thead className="bg-slate-50">
              <tr className="divide-x divide-black">
                <th className="px-6 py-3 text-left text-sm font-black text-black uppercase tracking-wider border-b border-black">ERP</th>
                <th className="px-6 py-3 text-left text-sm font-black text-black uppercase tracking-wider border-b border-black">Item Name</th>
                <th className="px-6 py-3 text-right text-sm font-black text-black uppercase tracking-wider border-b border-black">GSM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-500 font-bold italic uppercase tracking-widest bg-slate-50/50">
                    No data found matching your criteria
                  </td>
                </tr>
              ) : (
                filteredData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                    <td className="px-6 py-4 text-sm font-bold text-black">{row.erp}</td>
                    <td className="px-6 py-4 text-sm text-black">{row.itemName}</td>
                    <td className="px-6 py-4 text-sm text-right font-black text-indigo-700">{row.gsm}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredData.length > 0 && (
                <tfoot className="bg-slate-100 border-t border-black">
                    <tr>
                        <td colSpan={3} className="px-6 py-2 text-[10px] font-bold text-slate-500 uppercase">
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
