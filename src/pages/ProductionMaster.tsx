import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, Item, OrderSchedule, Order, Company, ProductionProcessing } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { Trash2, ClipboardList } from "lucide-react";
import { ExcelExport } from "../components/ExcelExport";
import { useNavigate } from "react-router-dom";
import { PROCESSING_MACHINE_COLUMNS } from "../lib/productionProcessingSummary";

export function ProductionMaster() {
  const navigate = useNavigate();
  const [productions, setProductions] = useData<Production>("productions", []);
  const [items] = useData<Item>("items", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const processingTotalsMap = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    processing.forEach((p) => {
      const totals = map.get(p.productionId) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
      const machineColumn = PROCESSING_MACHINE_COLUMNS.find(col => (col.machineNames as readonly string[]).includes(p.machineName));
      if (machineColumn) {
        totals[machineColumn.key] += Number(p.qty || 0);
      }
      map.set(p.productionId, totals);
    });
    return map;
  }, [processing]);

  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach(p => {
      // Skip canceled jobs for least cost calculation
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

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setProductions(productions.filter(p => p.id !== id));
    setDeletingId(null);
  };

  const filteredList = productions
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
    .sort((a, b) => b.transactionNo.localeCompare(a.transactionNo, undefined, { numeric: true, sensitivity: 'base' }));

  const getProcessingSummary = (pId: string) => {
    const records = processing.filter(p => p.productionId === pId);
    if (records.length === 0) return "Pending";
    const machines = Array.from(new Set(records.map(r => r.machineName))).join(", ");
    const totalQty = records.reduce((sum, r) => sum + r.qty, 0);
    return `${machines} (${totalQty})`;
  };

  const exportData = filteredList.map(p => {
    const item = items.find(i => i.id === p.itemId);
    const schedule = schedules.find(s => s.id === p.scheduleId);
    const order = orders.find(o => o.id === schedule?.orderId);
    const company = companies.find(c => c.id === order?.companyId);
    const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
    
    return {
      "Job No.": p.transactionNo,
      "Prod Date": formatDate(p.date),
      "Order No.": order?.orderNo || "-",
      "Order Date": order ? formatDate(order.orderDate) : "-",
      "ERP Code": p.erpCode || "-",
      "Company": company?.name || "-",
      "Item Name": item?.name || "Unknown",
      "Type": item?.typeName || "-",
      "Planned Qty": p.qty,
      "UOM": p.uom,
      "Paper": procTotals.paper,
      "Liner": procTotals.liner,
      "Printing": procTotals.printing,
      "Pasting": procTotals.pasting,
      "Stitching": procTotals.stitching,
      "Punching": procTotals.punching,
      "Gluing": procTotals.gluing,
      "Status": p.status,
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
      "ID to OD": p.idToOd,
      "Flute": p.flute,
      "Take up Factor": p.takeUpFactor,
      "L1": p.l1,
      "F1": p.f1,
      "L2": p.l2,
      "F2": p.f2,
      "L3": p.l3,
      "GSM": p.gsm,
      "Least GSM": erpLeastGsmMap.get(String(p.erpCode || "").trim()) || "-",
      "Color 1": p.color1 || "-",
      "Color 2": p.color2 || "-",
      "Printing Color": p.printingColor || "-",
      "Line Required (Nos)": p.lineRequiredNos || "-",
      "Sheet Wt": p.sheetWeight,
      "Plate Wt": p.plateWeight,
      "Total Paper Wt": p.totalPaperWeight,
      "Rate": p.rate,
      "Total Wt of Set": p.totalWeightOfSet,
      "Realization/KG": p.realizationPerKg,
      "Actual Paper Used": p.actualPaperUsed,
      "Avg Wt": p.avgWeight,
      "Prod (Sheet)": p.prodFromSheetPlant,
      "Prod (FFG)": p.prodFromFFG,
      "Wastage": p.wastage,
      "Prod (Meter)": p.productionInMeter,
      "Planned Prod (Meter)": p.plannedProductionInMeter,
      "ERP Code Reel": p.erpCodeReel,
      "Processing Info": getProcessingSummary(p.id),
      "Remarks": p.remarks,
      "Cancel Date": p.cancelTimestamp ? formatDate(p.cancelTimestamp) : "-",
      "Cancel Remarks": p.cancelRemarks || "-"
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Master</h2>
        <ExcelExport data={exportData} fileName="Production_Master" />
      </div>

      <TableControls 
        searchTerm={searchTerm} 
        onSearchChange={setSearchTerm} 
        placeholder="Search productions..." 
      />

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {/* Mobile View - Cards */}
        <div className="block md:hidden space-y-4 p-2">
            {filteredList.map((p) => {
                const schedule = schedules.find(s => s.id === p.scheduleId);
                const order = orders.find(o => o.id === schedule?.orderId);
                const company = companies.find(c => c.id === order?.companyId);
                const item = items.find(i => i.id === p.itemId);
                const erp = String(p.erpCode || "").trim();
                const leastGsm = erpLeastGsmMap.get(erp);
                const isHighGsm = p.gsm && leastGsm && Number(p.gsm) > Number(leastGsm);
                const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
                
                return (
                  <div key={p.id} className={`${isHighGsm ? "bg-amber-50" : "bg-white"} border-2 border-black p-4 space-y-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded relative`}>
                       <div className="flex justify-between items-center">
                          <div className="font-bold text-sm">Job: {p.transactionNo}</div>
                           <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                              p.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                              p.status === 'Cancelled' ? 'bg-red-100 text-red-900 border-red-900' :
                              'bg-amber-100 text-amber-900 border-amber-900'
                          }`}>
                              {p.status}
                          </span>
                      </div>
                      <div className="text-xs text-slate-500">Prod Date: {formatDate(p.date)}</div>
                      {order && (
                        <>
                          <div className="text-xs font-bold text-slate-700">Order: {order.orderNo} ({formatDate(order.orderDate)})</div>
                          <div className="text-xs font-bold text-slate-700">ERP Code: {p.erpCode || "-"}</div>
                          <div className="text-xs font-bold text-slate-700">Company: {company?.name || "Unknown"}</div>
                        </>
                      )}
                      <div className="text-sm font-bold">{item?.name || "Unknown"}</div>
                      <div className="text-[10px] text-slate-600 uppercase font-black">
                        Type: {item?.typeName || "-"} | Print: {p.printingColor || "-"}
                      </div>
                      <div className="text-[10px] text-slate-600 uppercase font-bold">
                        OD: {item?.lOd || "-"}×{item?.wOd || "-"}×{item?.hOd || "-"} | Flap: {item?.flap || "-"} | Deckle: {item?.deckleSize || "-"} | Cutting: {item?.cuttingSize || "-"}
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span>{p.qty} {p.uom}</span>
                        <div className="flex flex-col items-end text-[10px] font-bold text-indigo-700 bg-indigo-50 p-1 border border-indigo-100 rounded">
                          <div>Pa:{procTotals.paper} | Li:{procTotals.liner} | Pr:{procTotals.printing}</div>
                          <div>Ps:{procTotals.pasting} | St:{procTotals.stitching} | Pu:{procTotals.punching} | Gl:{procTotals.gluing}</div>
                        </div>
                        <div className="flex flex-col items-end">
                            {p.gsm && <span className="font-bold text-indigo-700">GSM: {p.gsm}</span>}
                            {leastGsm && <span className="text-[10px] font-black text-emerald-700">Least: {leastGsm}</span>}
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 p-1.5 rounded border border-indigo-100">
                        Processing: {getProcessingSummary(p.id)}
                      </div>
                      {p.status === 'Cancelled' && p.cancelRemarks && (
                        <div className="text-xs bg-red-50 text-red-700 p-2 border border-red-200 rounded font-medium mt-1">
                          Cancel Reason: {p.cancelRemarks}
                        </div>
                      )}
                       <div className="flex gap-2 mt-2">
                        <button 
                          onClick={() => navigate(`/production-processing/form?productionId=${p.id}`)}
                          className="flex-1 bg-indigo-600 text-white font-bold inline-flex items-center justify-center p-2 border border-black text-xs hover:bg-indigo-700"
                        >
                          <ClipboardList size={14} className="mr-1" /> Report Proc.
                        </button>
                        <button 
                          onClick={() => handleDelete(p.id)} 
                          className={`${deletingId === p.id ? "text-amber-600 animate-pulse bg-amber-50" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center justify-center p-2 border border-black text-xs min-w-[80px]`}
                        >
                          <Trash2 size={14} className="mr-1" /> {deletingId === p.id ? "Confirm?" : "Delete"}
                        </button>
                      </div>
                  </div>
                );
            })}
        </div>
        <div className="overflow-x-auto hidden md:block">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Job No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Order No.</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">ERP Code</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Prod Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Type</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Planned Qty</th>

                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Paper</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Liner</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Print</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Paste</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Stitch</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Punch</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-indigo-900 uppercase border border-black whitespace-nowrap bg-indigo-50">Glue</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">B</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">H</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">L (OD)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">W (OD)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">H (OD)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Flap</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Deckle</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Cutting</th>
                
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Ply</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Flute</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">GSM</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Least GSM</th>

                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Color 1</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Color 2</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Printing Color</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Line Req.</th>
                
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Total Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Avg Wt</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Wastage</th>
                
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Processing Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={35} className="px-6 py-8 text-center text-black font-medium">No productions found.</td>
                </tr>
              ) : (
                filteredList.map((p) => {
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = items.find(i => i.id === p.itemId);
                  const erp = String(p.erpCode || "").trim();
                  const leastGsm = erpLeastGsmMap.get(erp);
                  const isHighGsm = p.gsm && leastGsm && Number(p.gsm) > Number(leastGsm);
                  const procTotals = processingTotalsMap.get(p.id) || { paper: 0, liner: 0, printing: 0, pasting: 0, stitching: 0, punching: 0, gluing: 0 };
                  
                  return (
                    <tr key={p.id} className={`${isHighGsm ? "bg-amber-50" : "hover:bg-slate-50"} divide-x divide-black transition-colors`}>
                      <td className="px-4 py-4 text-xs font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.erpCode || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black min-w-[150px]">{item?.name || "Unknown"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{item?.typeName || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-medium text-emerald-700 border border-black whitespace-nowrap">{p.qty} {p.uom}</td>

                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.paper.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.liner.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.printing.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.pasting.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.stitching.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.punching.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap bg-indigo-50/30">{procTotals.gluing.toLocaleString()}</td>
                      
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.length || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.breadth || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.height || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.lOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.wOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-600">{item?.hOd || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{item?.flap || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{item?.deckleSize || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{item?.cuttingSize || "-"}</td>

                      <td className="px-4 py-4 text-center text-xs text-black border border-black whitespace-nowrap">{p.ply || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.flute || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-medium text-indigo-700">{p.gsm || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap font-black text-emerald-700">{erpLeastGsmMap.get(erp) || "-"}</td>

                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.color1 || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.color2 || "-"}</td>
                      <td className="px-4 py-4 text-xs text-black border border-black whitespace-nowrap">{p.printingColor || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.lineRequiredNos || "-"}</td>
                      
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.totalPaperWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.avgWeight || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs text-black border border-black whitespace-nowrap">{p.wastage || "-"}</td>

                      <td className="px-4 py-4 text-xs text-indigo-600 font-bold border border-black max-w-[200px] truncate" title={getProcessingSummary(p.id)}>
                        {getProcessingSummary(p.id)}
                      </td>

                      <td className="px-4 py-4 text-xs border border-black whitespace-nowrap">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${
                          p.status === 'Completed' ? 'bg-emerald-100 text-emerald-900 border-emerald-900' : 
                          p.status === 'Cancelled' ? 'bg-red-100 text-red-900 border-red-900' :
                          'bg-amber-100 text-amber-900 border-amber-900'
                        }`}>
                          {p.status}
                        </span>
                        {p.status === 'Cancelled' && p.cancelRemarks && (
                          <div className="text-[9px] text-red-600 font-bold mt-1 max-w-[120px] truncate" title={p.cancelRemarks}>
                            {p.cancelRemarks}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center text-xs font-medium border border-black whitespace-nowrap">
                        <div className="flex items-center justify-center gap-3">
                          <button 
                            onClick={() => navigate(`/production-processing/form?productionId=${p.id}`)}
                            title="Report Processing"
                            className="text-indigo-600 hover:text-indigo-900 transition-all p-1"
                          >
                            <ClipboardList size={16} />
                          </button>
                          <button 
                            onClick={() => handleDelete(p.id)} 
                            title={deletingId === p.id ? "Click to confirm delete" : "Delete production entry"}
                            className={`${deletingId === p.id ? "text-amber-600 animate-pulse scale-110" : "text-red-600"} hover:text-red-900 transition-all p-1`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
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
