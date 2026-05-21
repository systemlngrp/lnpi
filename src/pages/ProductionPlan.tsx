import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, Item, OrderSchedule, Order, Company, ProductionProcessing } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { ExcelExport } from "../components/ExcelExport";
import { FileText } from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { buildProcessingTotalsMap } from "../lib/productionProcessingSummary";

export function ProductionPlan() {
  const [productions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [searchTerm, setSearchTerm] = useState("");

  const processingTotalsMap = useMemo(() => {
    return buildProcessingTotalsMap(processing);
  }, [processing]);

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

  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach(p => {
      if (p.status === "Cancelled" || p.cancelTimestamp) return;
      const erp = String(p.erpCode || "").trim();
      const gsm = Number(p.gsm || 0);
      if (erp && gsm > 0) {
        if (!map.has(erp) || gsm < map.get(erp)!) {
          map.set(erp, gsm);
        }
      }
    });
    return map;
  }, [productions]);

  const processingTotalsMap = useMemo(() => buildProcessingTotalsMap(processing), [processing]);

  const getExportData = (data: Production[]) => {
    return data.map(p => {
      const schedule = schedules.find(s => s.id === p.scheduleId);
      const order = orders.find(o => o.id === schedule?.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      const item = items.find(i => i.id === p.itemId);
      const processingTotals = processingTotalsMap.get(p.id);

      return {
        "Job No.": p.transactionNo,
        "Order No.": order?.orderNo || "-",
        "Company": company?.name || "-",
        "Item": item?.name || "-",
        "Type": item?.typeName || "-",
        "ERP Code": p.erpCode || "-",
        "Prod Date": formatDate(p.date),
        "Qty": p.qty,
        "UOM": p.uom,
        "Remarks": p.remarks,
        "No of Parts": p.noOfParts,
        "UPS": p.ups,
        "Length": p.length,
        "Breadth": p.breadth,
        "Height": p.height,
        "L (OD)": item?.lOd || "-",
        "W (OD)": item?.wOd || "-",
        "H (OD)": item?.hOd || "-",
        "Flap": item?.flap || "-",
        "Deckle Size": item?.deckleSize || "-",
        "Cutting Size": item?.cuttingSize || "-",
        "PLY": p.ply,
        "Flute": p.flute,
        "ID to OD": p.idToOd,
        "Take up Factor": p.takeUpFactor,
        "GSM": p.gsm,
        "Print Color 1": item?.printingColour1 || "-",
        "Print Color 2": item?.printingColour2 || "-",
        "ERP Code Reel": p.erpCodeReel,
        "L1": p.l1,
        "F1": p.f1,
        "L2": p.l2,
        "F2": p.f2,
        "L3": p.l3,
        "Reel Per Calc": p.reelAsPerCalc,
        "Reel Actual Trim": p.reelActualWithTrimming,
        "Cutting Trim": p.cuttingWithTrimming,
        "Sheet Weight": p.sheetWeight,
        "Plate/PHP Weight": p.plateWeight,
        "Total Paper Wt": p.totalPaperWeight,
        "Total Wt of Set": p.totalWeightOfSet,
        "Avg Weight": p.avgWeight,
        "Actual Paper Used": p.actualPaperUsed,
        "Rate": p.rate,
        "Realization/KG": p.realizationPerKg,
        "Prod (Sheet Plant)": p.prodFromSheetPlant,
        "Prod (FFG)": p.prodFromFFG,
        "Wastage": p.wastage,
        "Prod (Meter)": p.productionInMeter,
        "Planned Prod (Mtr)": p.plannedProductionInMeter,
        "Least GSM": erpLeastGsmMap.get(String(p.erpCode || "").trim()) || "-",
        "Flute Batches": p.fluteBatches,
        "Paper": processingTotals?.paper || "",
        "Liner": processingTotals?.liner || "",
        "Printing": processingTotals?.printing || "",
        "Pasting": processingTotals?.pasting || "",
        "Stitching": processingTotals?.stitching || ""
      };
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
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
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
          <ExcelExport data={getExportData(filteredList)} fileName={`Production_Plan_${selectedDate}`} />
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded font-bold hover:bg-red-700 transition shadow border border-black text-sm"
          >
            <FileText size={16} /> PDF
          </button>
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
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Job No.</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Order No.</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Item</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Type</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">ERP Code</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Qty</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Paper</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Liner</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Printing</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Pasting</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Stitching</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">L</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">B</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">H</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">L (OD)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">W (OD)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">H (OD)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Flap</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Deckle</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Cutting</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Ply</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Flute</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">GSM</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Color 1</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Color 2</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Sheet Wt</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={28} className="px-6 py-8 text-center text-black font-medium">No productions found for this date.</td>
                </tr>
              ) : (
                filteredList.map((p) => {
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = items.find(i => i.id === p.itemId);
                  const processingTotals = processingTotalsMap.get(p.id);

                  return (
                    <tr key={p.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-[11px] font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap max-w-[150px] truncate" title={company?.name}>{company?.name || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black max-w-[200px] truncate" title={item?.name}>{item?.name || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{item?.typeName || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.erpCode || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-emerald-700 border border-black whitespace-nowrap">{p.qty} {p.uom}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-black border border-black whitespace-nowrap">{processingTotals?.paper || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-black border border-black whitespace-nowrap">{processingTotals?.liner || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-black border border-black whitespace-nowrap">{processingTotals?.printing || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-black border border-black whitespace-nowrap">{processingTotals?.pasting || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-black border border-black whitespace-nowrap">{processingTotals?.stitching || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.length || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.breadth || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.height || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.lOd || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.wOd || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.hOd || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{item?.flap || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{item?.deckleSize || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{item?.cuttingSize || "-"}</td>
                      <td className="px-4 py-3 text-center text-[11px] text-black border border-black whitespace-nowrap">{p.ply || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.flute || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-medium text-indigo-700 border border-black whitespace-nowrap">{p.gsm || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{item?.printingColour1 || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{item?.printingColour2 || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{p.sheetWeight || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black max-w-[150px] truncate" title={p.remarks}>{p.remarks || "-"}</td>
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
