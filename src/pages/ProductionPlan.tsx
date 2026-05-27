import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, Item, OrderSchedule, Order, Company } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { ExcelExport } from "../components/ExcelExport";
import { FileText } from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { exportsAllowed } from "../lib/exportPolicy";

export function ProductionPlan() {
  const [productions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [searchTerm, setSearchTerm] = useState("");
  const allowExports = exportsAllowed();

  const normalizeDate = (dStr: string) => {
    if (!dStr) return "";
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const filteredList = useMemo(() => {
    return productions
      .filter(p => normalizeDate(p.date) === selectedDate)
      .filter(p => {
        const item = items.find(i => i.id === p.itemId);
        const schedule = schedules.find(s => s.id === p.scheduleId);
        const order = orders.find(o => o.id === schedule?.orderId);
        const company = companies.find(c => c.id === order?.companyId);
        
        return p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (order?.orderNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (company?.name || "").toLowerCase().includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => a.transactionNo.localeCompare(b.transactionNo, undefined, { numeric: true, sensitivity: 'base' }));
  }, [productions, selectedDate, searchTerm, items, schedules, orders, companies]);

  const getPrintingColour = (item?: Item) => {
    const c1 = String(item?.printingColour1 || "").trim();
    const c2 = String(item?.printingColour2 || "").trim();
    if (c1 && c2) return `${c1} / ${c2}`;
    return c1 || c2 || "-";
  };

  const getExportData = (data: Production[]) => {
    return data.map(p => {
      const schedule = schedules.find(s => s.id === p.scheduleId);
      const order = orders.find(o => o.id === schedule?.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      const item = items.find(i => i.id === p.itemId);

      return {
        "Status": p.status || "-",
        "Lot No": p.transactionNo || "-",
        "Party Name": company?.name || "-",
        "Item Name": item?.name || "-",
        "ERP Code": p.erpCode || "-",
        "TYPE": item?.typeName || "-",
        "Plan Quantity": p.qty ?? "-",
        "PART": item?.part || "-",
        "Printing Colour": getPrintingColour(item),
        "L": p.length ?? "-",
        "W": p.breadth ?? "-",
        "H": p.height ?? "-",
        "Ply": p.ply ?? "-",
        "Length (OD)": item?.lOd ?? "-",
        "Width (OD)": item?.wOd ?? "-",
        "Height (OD)": item?.hOd ?? "-",
        "FLAP": item?.flap ?? "-",
        "No. of Outs (Reel Size)": p.ups ?? "-",
        "No. of ups in Cutting (For Plates)": p.noOfUpsInCuttingForPlates ?? "-",
        "Paper Required": p.paperRequiredNos ?? "-",
        "Liner Required": p.lineRequiredNos ?? "-",
        "Top Paper Weight (KG)": p.topPaperWeightKg ?? "-",
        "Liner Weight (KG)": p.linerWeightKg ?? "-",
        "Total Job Weight": p.totalJobWeight ?? "-",
      } as Record<string, string | number>;
    });
  };

  const handleExportPDF = () => {
    const doc = new jsPDF('landscape', 'mm', 'a3');
    doc.setFontSize(16);
    doc.text(`Production Plan - ${formatDate(selectedDate)}`, 14, 15);
    doc.setFontSize(10);
    
    const exportData = getExportData(filteredList);
    if (exportData.length === 0) return;

    const tableColumn = Object.keys(exportData[0]);
    const tableRows = exportData.map(row => Object.values(row));

    (doc as any).autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 20,
      theme: 'grid',
      styles: { fontSize: 6, cellPadding: 1 },
      headStyles: { fillGray: 200, textColor: 0, fontStyle: 'bold' }
    });

    doc.save(`Production_Plan_${selectedDate}.pdf`);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center pb-2 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Plan</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-black uppercase">Plan Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border-2 border-black rounded p-1 text-sm focus:outline-none focus:border-indigo-600"
            />
          </div>
          {allowExports ? (
            <>
              <ExcelExport data={getExportData(filteredList)} fileName={`Production_Plan_${selectedDate}`} />
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded font-bold hover:bg-red-700 transition shadow border border-black text-sm"
              >
                <FileText size={16} /> PDF
              </button>
            </>
          ) : null}
        </div>
      </div>

      <TableControls
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        placeholder="Search jobs..."
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Lot No</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Party Name</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">ERP Code</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">TYPE</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Plan Quantity</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">PART</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Printing Colour</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">L</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">W</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">H</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Ply</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Length (OD)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Width (OD)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Height (OD)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">FLAP</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">No. of Outs (Reel Size)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">No. of ups in Cutting (For Plates)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Paper Required</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Liner Required</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Top Paper Weight (KG)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Liner Weight (KG)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Total Job Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={24} className="px-6 py-8 text-center text-black font-medium">No productions found for this date.</td>
                </tr>
              ) : (
                filteredList.map((p) => {
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = items.find(i => i.id === p.itemId);

                  return (
                    <tr key={p.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.status || "-"}</td>
                      <td className="px-4 py-3 text-[11px] font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap max-w-[160px] truncate" title={company?.name}>{company?.name || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black max-w-[220px] truncate" title={item?.name}>{item?.name || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.erpCode || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{item?.typeName || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-emerald-700 border border-black whitespace-nowrap">{p.qty}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{item?.part || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{getPrintingColour(item)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.length ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.breadth ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.height ?? "-"}</td>
                      <td className="px-4 py-3 text-center text-[11px] text-black border border-black whitespace-nowrap">{p.ply ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.lOd ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.wOd ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.hOd ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{item?.flap ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.ups ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.noOfUpsInCuttingForPlates ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.paperRequiredNos ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.lineRequiredNos ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.topPaperWeightKg ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.linerWeightKg ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-black border border-black whitespace-nowrap">{p.totalJobWeight ?? "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
