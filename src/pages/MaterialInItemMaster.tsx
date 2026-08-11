import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Material, MaterialIn, Item, Supplier, MaterialInPackingSlip, GateEntry, Company, MaterialIssueReelLine, MaterialReturnReelLine } from "../types";
import { Edit2, Check, X, Search, Package, Layers, Disc, ExternalLink } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { ExcelExport } from "../components/ExcelExport";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { useNpdItems } from "../hooks/useNpdItems";
import { useNavigate } from "react-router-dom";
import { buildReelStockRows } from "../lib/reelStock";

function makeOptions(values: Array<string | number>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((value) => ({ value, label: value }));
}

function isOpeningMrrNo(value?: string | number | null) {
  return String(value ?? "").trim() === "1";
}

export function MaterialInItemMaster() {
  const navigate = useNavigate();
  const [materialIn, setMaterialIn] = useData<MaterialIn>("material-in", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materials] = useData<Material>("materials", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", [], { cacheToLocalStorage: false });
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", [], { cacheToLocalStorage: false });
  const [gateEntries] = useData<GateEntry>("gate-entries", []);
  const npdItems = useNpdItems();
  const [suppliers] = useData<Supplier>("suppliers", []);
  const [companies] = useData<Company>("companies", []);

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"others" | "reel-summary" | "reel-details">("others");
  const [mrrFilter, setMrrFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const materialMap = useMemo(() => new Map(materials.map(m => [m.id, m])), [materials]);
  const mrrOptions = useMemo(() => makeOptions(materialIn.map((entry) => entry.transactionNo)), [materialIn]);
  const gateEntryMap = useMemo(() => new Map(gateEntries.map(ge => [ge.id, ge])), [gateEntries]);

  const handleEditClick = (lineId: string, currentQty: number) => {
    setEditingLineId(lineId);
    setEditQty(currentQty);
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditQty("");
  };

  const handleSaveQty = (parentId: string, lineId: string) => {
    if (editQty === "" || Number(editQty) <= 0) return;

    setIsSubmitting(true);
    setTimeout(() => {
      setMaterialIn(prev => prev.map(m => {
        if (m.id !== parentId) return m;

        const updatedLines = m.lines.map(line => {
          if (line.id !== lineId) return line;
          return {
            ...line,
            qty: Number(editQty),
            value: Number(editQty) * (line.rate || 0)
          };
        });

        const newTotalAmount = updatedLines.reduce((sum, line) => sum + (line.value || 0), 0);

        return {
          ...m,
          lines: updatedLines,
          totalAmount: newTotalAmount
        };
      }));

      setEditingLineId(null);
      setEditQty("");
      setIsSubmitting(false);
    }, 500);
  };

  const getSupplierName = (id: string) => {
    const s = suppliers.find(s => s.id === id);
    if (s) return s.name;
    const c = companies.find(c => c.id === id);
    if (c) return c.name;
    return id;
  };

  const processedData = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();

    // 1. Base Flattening for Line Items
    const allLineItems = materialIn.flatMap(m => {
      const safeLines = Array.isArray(m.lines) ? m.lines : [];
      const gateEntry = m.gateEntryId ? gateEntryMap.get(m.gateEntryId) : null;
      
      return safeLines.map(line => {
        if (!line) return null;
        
        // Date range filter
        const entryDate = m.date || "";
        if (fromDate && entryDate < fromDate) return null;
        if (toDate && entryDate > toDate) return null;
        if (mrrFilter && m.transactionNo !== mrrFilter) return null;
        return {
          ...line,
          parentStatus: m.status,
          parentTransactionNo: m.transactionNo,
          parentDate: m.date,
          parentInvoiceNo: m.invoiceNo,
          parentSupplierId: m.supplierId,
          parentId: m.id,
          parentGateEntryNo: m.gateEntryNo || gateEntry?.gateEntryNo || "-",
          parentVehicleNo: gateEntry?.truckNo || "-",
          timestamp: m.timestamp,
          mrrType: m.mrrType || "Others",
          isOpeningMrr: isOpeningMrrNo(m.transactionNo)
        };
      }).filter((l): l is NonNullable<typeof l> => l !== null);
    });

    // 2. Reel Details Flattening
    const reelDetails = packingSlips.map(slip => {
      const parent = materialIn.find(m => m.id === slip.materialInId);
      if (!parent) return null;

      // Date range filter
      const entryDate = parent.date || "";
      if (fromDate && entryDate < fromDate) return null;
      if (toDate && entryDate > toDate) return null;
      if (mrrFilter && parent.transactionNo !== mrrFilter) return null;
      const gateEntry = parent.gateEntryId ? gateEntryMap.get(parent.gateEntryId) : null;
      const material = materialMap.get(slip.materialId);
      const specs = material ? `${material.gsm || "-"} GSM / ${material.bf || "-"} BF / ${material.size || "-"} ${(material as any).sizeUom || ""}` : "Unknown";

      return {
        ...slip,
        parentTransactionNo: parent.transactionNo,
        parentDate: parent.date,
        parentSupplierId: parent.supplierId,
        parentStatus: parent.status,
        parentGateEntryNo: parent.gateEntryNo || gateEntry?.gateEntryNo || "-",
        parentVehicleNo: gateEntry?.truckNo || "-",
        timestamp: parent.timestamp,
        specs,
        isOpeningMrr: isOpeningMrrNo(parent.transactionNo)
      };
    }).filter((l): l is NonNullable<typeof l> => l !== null);

    const filterFn = (item: any) => {
      if (!q) return true;
      const itemName = materials.find(i => i.id === item.itemId || i.id === item.materialId)?.name || npdItems.find(i => i.id === item.itemId || i.id === item.materialId)?.name || "";
      const supplierName = getSupplierName(item.parentSupplierId);
      return (
        itemName.toLowerCase().includes(q) ||
        supplierName.toLowerCase().includes(q) ||
        (item.parentTransactionNo || "").toLowerCase().includes(q) ||
        (item.parentInvoiceNo || "").toLowerCase().includes(q) ||
        (item.ourReelNo || "").toLowerCase().includes(q) ||
        (item.supplierReelNo || "").toLowerCase().includes(q) ||
        (item.parentGateEntryNo || "").toLowerCase().includes(q) ||
        (item.parentVehicleNo || "").toLowerCase().includes(q)
      );
    };

    const others = allLineItems.filter(l => l.mrrType !== "Reel").filter(filterFn);
    const reelSummary = allLineItems.filter(l => l.mrrType === "Reel").filter(filterFn);
    const filteredReelDetails = reelDetails.filter(filterFn);
    const reelStockRows = buildReelStockRows({
      materials,
      materialIn,
      packingSlips,
      issueReelLines,
      returnReelLines,
      suppliers,
    }).filter(row => {
      if (fromDate && row.mrrDate < fromDate) return false;
      if (toDate && row.mrrDate > toDate) return false;
      if (mrrFilter && row.mrrNo !== mrrFilter) return false;
      if (!q) return true;

      return [
        row.mrrNo,
        row.ourReelNo,
        row.erp,
        row.itemName,
        row.supplierName,
        row.gsm,
        row.size,
        row.bf,
      ].some(value => String(value || "").toLowerCase().includes(q));
    });

    const visibleLines = [...others, ...reelSummary];
    const openingLines = visibleLines.filter(l => l.isOpeningMrr);
    const receiptLines = visibleLines.filter(l => !l.isOpeningMrr);

    // Calculate Metrics
    const metrics = {
      openingQty: openingLines.reduce((sum, l) => sum + Number(l.actualQty ?? l.qty ?? 0), 0),
      receiptQty: receiptLines.reduce((sum, l) => sum + Number(l.actualQty ?? l.qty ?? 0), 0),
      openingValue: reelStockRows.reduce((sum, row) => sum + (Number(row.openingQty || 0) * Number(row.rate || 0)), 0),
      receiptValue: reelStockRows.reduce((sum, row) => sum + (Number(row.mrrQty || 0) * Number(row.rate || 0)), 0),
      openingReelWeight: reelStockRows.reduce((sum, row) => sum + Number(row.openingQty || 0), 0),
      receiptReelWeight: reelStockRows.reduce((sum, row) => sum + Number(row.mrrQty || 0), 0),
      totalReceipts: new Set(receiptLines.map(l => l.parentId)).size,
      othersValue: others.reduce((sum, l) => sum + Number(l.value || 0), 0),
      reelValue: reelSummary.reduce((sum, l) => sum + Number(l.value || 0), 0)
    };

    return {
      others: others.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      reelSummary: reelSummary.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      reelDetails: filteredReelDetails.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      metrics
    };
  }, [materialIn, packingSlips, materials, issueReelLines, returnReelLines, npdItems, suppliers, searchTerm, fromDate, toDate, mrrFilter, materialMap, gateEntryMap]);



  const excelRows = useMemo(() => {
    if (activeTab === "reel-details") {
      return processedData.reelDetails.map((reel: any) => ({
        "GE No": reel.parentGateEntryNo,
        "MRR No": reel.parentTransactionNo,
        Date: formatDate(reel.parentDate),
        "Vehicle No": reel.parentVehicleNo,
        Supplier: getSupplierName(reel.parentSupplierId),
        "Material Specs": reel.specs,
        "Our Reel No": reel.ourReelNo,
        "Supplier Reel No": reel.supplierReelNo || "-",
        "Weight (KG)": Number(reel.weightKg || 0),
      }));
    }

    const data = activeTab === "others" ? processedData.others : processedData.reelSummary;
    return data.map((line: any) => {
      const itemName = materials.find(i => i.id === line.itemId)?.name || npdItems.find(i => i.id === line.itemId)?.name || "Unknown";
      return {
        "GE No": line.parentGateEntryNo,
        "MRR No": line.parentTransactionNo,
        Date: formatDate(line.parentDate),
        "Vehicle No": line.parentVehicleNo,
        "Supplier / Customer": getSupplierName(line.parentSupplierId),
        "Item Name": itemName,
        "Invoice No": line.parentInvoiceNo || "-",
        Qty: Number(line.qty || 0),
        UOM: line.uom || "",
        Rate: Number(line.rate || 0),
        Value: Number(line.value || 0),
      };
    });
  }, [activeTab, processedData, materials, npdItems, suppliers, companies]);
  const renderTable = () => {
    const data = activeTab === "others" ? processedData.others : 
                 activeTab === "reel-summary" ? processedData.reelSummary : 
                 processedData.reelDetails;

    if (data.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-black font-medium italic">No items found for the current filters.</div>
      );
    }

    if (activeTab === "reel-details") {
      return (
        <table className="min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">GE No</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">MRR No</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Vehicle No</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Supplier</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Material Specs</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Our Reel No</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Supplier Reel No</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Weight (KG)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {data.map((reel: any) => (
              <tr key={reel.id} className="hover:bg-slate-50 divide-x divide-black transition-colors text-sm">
                <td className="px-4 py-3 border border-black font-medium">{reel.parentGateEntryNo}</td>
                <td className="px-4 py-3 font-medium text-indigo-700 border border-black">{reel.parentTransactionNo}</td>
                <td className="px-4 py-3 border border-black">{formatDate(reel.parentDate)}</td>
                <td className="px-4 py-3 border border-black font-medium">{reel.parentVehicleNo}</td>
                <td className="px-4 py-3 border border-black">{getSupplierName(reel.parentSupplierId)}</td>
                <td className="px-4 py-3 border border-black">{reel.specs}</td>
                <td className="px-4 py-3 font-bold border border-black">{reel.ourReelNo}</td>
                <td className="px-4 py-3 border border-black">{reel.supplierReelNo || "-"}</td>
                <td className="px-4 py-3 text-right font-black text-amber-600 border border-black">{reel.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    return (
      <table className="min-w-full divide-y divide-black border-collapse border border-black">
        <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
          <tr className="divide-x divide-black">
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">GE No</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">MRR No</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Date</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">Vehicle No</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black min-w-[240px]">Supplier / Customer</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black min-w-[320px]">Item Name</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Invoice No</th>
            <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Qty</th>
            <th className="px-4 py-3 text-left text-xs font-bold text-black uppercase border border-black">UOM</th>
            <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Rate</th>
            <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black">Value</th>
            <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black bg-white">
          {data.map((line: any) => {
            const itemName = materials.find(i => i.id === line.itemId)?.name || npdItems.find(i => i.id === line.itemId)?.name || "Unknown";
            const canEditInline = line.parentStatus === "Pending PH";
            const isEditing = editingLineId === line.id;

            return (
              <tr key={line.id} className="hover:bg-slate-50 divide-x divide-black transition-colors text-sm">
                <td className="px-4 py-3 border border-black font-medium">{line.parentGateEntryNo}</td>
                <td className="px-4 py-3 font-medium text-black border border-black whitespace-nowrap">{line.parentTransactionNo}</td>
                <td className="px-4 py-3 border border-black whitespace-nowrap">{formatDate(line.parentDate)}</td>
                <td className="px-4 py-3 border border-black font-medium">{line.parentVehicleNo}</td>
                <td className="px-4 py-3 border border-black min-w-[240px] whitespace-normal break-words leading-snug">{getSupplierName(line.parentSupplierId)}</td>
                <td className="px-4 py-3 border border-black min-w-[320px] whitespace-normal break-words leading-snug">{itemName}</td>
                <td className="px-4 py-3 border border-black whitespace-nowrap font-medium">{line.parentInvoiceNo || "-"}</td>
                <td className="px-4 py-3 font-bold text-indigo-700 border border-black text-right">
                  {isEditing ? (
                    <input 
                      type="number"
                      value={editQty}
                      onChange={(e) => setEditQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                      className="w-20 border-2 border-indigo-600 rounded p-1 text-black focus:outline-none focus:ring-1 focus:ring-indigo-600 text-right"
                      autoFocus
                    />
                  ) : (
                    line.qty.toLocaleString()
                  )}
                </td>
                <td className="px-4 py-3 text-black border border-black text-center uppercase">{line.uom}</td>
                <td className="px-4 py-3 text-black border border-black text-right">{line.rate?.toLocaleString()}</td>
                <td className="px-4 py-3 font-medium text-black border border-black text-right whitespace-nowrap">{line.value?.toLocaleString()}</td>
                <td className="px-4 py-3 text-right border border-black whitespace-nowrap">
                  {isEditing ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleSaveQty(line.parentId, line.id)}
                        disabled={isSubmitting}
                        className="p-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition disabled:opacity-50 border border-emerald-700"
                      >
                        {isSubmitting ? <Spinner size={16} /> : <Check size={18} />}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={isSubmitting}
                        className="p-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition disabled:opacity-50 border border-red-700"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                       <button
                          onClick={() => navigate(`/material-in/form?edit=${line.parentId}`)}
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-bold text-xs"
                          title="Edit MRR Entry"
                       >
                         <ExternalLink size={14} className="mr-1" /> Edit MRR
                       </button>

                       {canEditInline ? (
                        <button
                           onClick={() => handleEditClick(line.id, line.qty)}
                           className="inline-flex items-center text-indigo-600 hover:text-indigo-800 font-bold text-xs"
                           title="Edit Qty Inline"
                        >
                          <Edit2 size={14} className="mr-1" /> Qty
                        </button>
                       ) : (
                         <span className="text-[9px] text-slate-400 italic font-medium uppercase">Locked</span>
                       )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <div>
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Material Receipt Item Master</h2>
          <div className="text-xs text-slate-500 font-medium font-mono">Detailed analysis of material receipts and reel arrivals.</div>
        </div>
      </div>

      {/* Colorful Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Opening</div>
          <div className="text-3xl font-black">{processedData.metrics.openingReelWeight.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs">KG</span></div>
          <div className="text-[10px] font-bold mt-1 opacity-90">Value {processedData.metrics.openingValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Receipts</div>
          <div className="text-3xl font-black">{processedData.metrics.receiptReelWeight.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs">KG</span></div>
          <div className="text-[10px] font-bold mt-1 opacity-90">{processedData.metrics.totalReceipts.toLocaleString()} MRR | Value {processedData.metrics.receiptValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Others Value</div>
          <div className="text-3xl font-black">{processedData.metrics.othersValue.toLocaleString()}</div>
        </div>
        <div className="bg-gradient-to-br from-rose-500 to-rose-700 p-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-white transition-transform hover:scale-[1.02]">
          <div className="text-[10px] font-black uppercase opacity-80 tracking-widest mb-1">Reel Value</div>
          <div className="text-3xl font-black">{processedData.metrics.reelValue.toLocaleString()}</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-end gap-4 bg-slate-50 p-4 border border-black rounded shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">From Date</label>
          <input 
            type="date"
            value={fromDate} 
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-black rounded px-2 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">To Date</label>
          <input 
            type="date"
            value={toDate} 
            onChange={(e) => setToDate(e.target.value)}
            className="border border-black rounded px-2 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="w-[180px] flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">MRR No</label>
          <Select compact value={mrrFilter} onChange={setMrrFilter} options={mrrOptions} placeholder="All MRR" />
        </div>

        <div className="flex-1 min-w-[200px] flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase text-slate-500">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text"
              placeholder="Search MRR No, Supplier, Reel No..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border border-black rounded pl-8 pr-2 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pb-1">
          {(fromDate || toDate || mrrFilter || searchTerm) && (
            <button
              onClick={() => {
                setFromDate("");
                setToDate("");
                setMrrFilter("");
                setSearchTerm("");
              }}
              className="text-[10px] font-black uppercase text-red-600 hover:text-red-800 underline"
            >
              Reset Filters
            </button>
          )}
          <ExcelExport data={excelRows} fileName={`Material_Receipt_Item_Master_${activeTab}`} sheetName="MR Item Master" />
        </div>
      </div>

      <div className="flex border-b border-black mt-2">
        <button
          onClick={() => setActiveTab("others")}
          className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-t border-l border-r border-black -mb-[1px] flex items-center gap-2 transition-all ${
            activeTab === "others" ? "bg-white border-b-transparent text-indigo-700 shadow-[0_-2px_0_0_#4f46e5]" : "bg-slate-50 text-slate-400 opacity-70 hover:opacity-100"
          }`}
        >
          <Package size={14} /> General Material ({processedData.others.length})
        </button>
        <button
          onClick={() => setActiveTab("reel-summary")}
          className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-t border-l border-r border-black -mb-[1px] ml-1 flex items-center gap-2 transition-all ${
            activeTab === "reel-summary" ? "bg-white border-b-transparent text-emerald-700 shadow-[0_-2px_0_0_#059669]" : "bg-slate-50 text-slate-400 opacity-70 hover:opacity-100"
          }`}
        >
          <Layers size={14} /> Reel Summary ({processedData.reelSummary.length})
        </button>
        <button
          onClick={() => setActiveTab("reel-details")}
          className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-t border-l border-r border-black -mb-[1px] ml-1 flex items-center gap-2 transition-all ${
            activeTab === "reel-details" ? "bg-white border-b-transparent text-amber-700 shadow-[0_-2px_0_0_#d97706]" : "bg-slate-50 text-slate-400 opacity-70 hover:opacity-100"
          }`}
        >
          <Disc size={14} /> Reel Details ({processedData.reelDetails.length})
        </button>
      </div>

      <div className="bg-white rounded-b shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          {renderTable()}
        </div>
      </div>
    </div>
  );
}

