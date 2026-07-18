import React, { useEffect, useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { Production, OrderSchedule, Order, Company, SampleRequest, Item, Setting } from "../types";
import { formatDate } from "../lib/serial";
import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { ExcelExport } from "../components/ExcelExport";
import { ClientPagination } from "../components/ClientPagination";
import { Spinner } from "../components/Spinner";
import { FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { exportsAllowed } from "../lib/exportPolicy";
import { fetchNpdItems } from "../lib/npdItems";
import { useClientPagination } from "../hooks/useClientPagination";
import { sortProductionPlanRows } from "../lib/productionPlanSorting";
import { findRealizationTargetForDate, parseRealizationTargets } from "../lib/realizationTargets";

export function ProductionPlan() {
  const [productions, , productionsLoading] = useData<Production>("productions", []);
  const [schedules, , schedulesLoading] = useData<OrderSchedule>("orders_schedule", []);
  const [orders, , ordersLoading] = useData<Order>("orders", []);
  const [companies, , companiesLoading] = useData<Company>("companies", []);
  const [sampleRequests, , sampleRequestsLoading] = useData<SampleRequest>("sample_requests", []);
  const [settings, , settingsLoading] = useData<Setting>("settings", []);
  const [npdItems, setNpdItems] = useState<Item[]>([]);
  const [npdLoading, setNpdLoading] = useState(true);

  useEffect(() => {
    setNpdLoading(true);
    fetchNpdItems()
      .then(setNpdItems)
      .catch((error) => {
        console.error("Failed to fetch NPD items for Production Plan:", error);
        setNpdItems([]);
      })
      .finally(() => setNpdLoading(false));
  }, []);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const allowExports = exportsAllowed();
  const isLoading =
    productionsLoading ||
    schedulesLoading ||
    ordersLoading ||
    companiesLoading ||
    sampleRequestsLoading ||
    settingsLoading ||
    npdLoading;

  const normalizeDate = (dStr: string) => {
    if (!dStr) return "";
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const format2 = (value: unknown) => {
    if (value === "" || value === null || value === undefined) return "-";
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : "-";
  };

  const sampleJobKeys = useMemo(() => {
    return new Set(
      sampleRequests.map((row) => `${String(row.itemId || "").trim()}::${String(row.jobCardNo || "").trim()}`)
    );
  }, [sampleRequests]);

  const isSampleProduction = (production: Production) => {
    return sampleJobKeys.has(
      `${String(production.itemId || "").trim()}::${String(production.transactionNo || production.jobCardNo || "").trim()}`
    );
  };

  const realizationTargets = useMemo(
    () => parseRealizationTargets(settings[0]?.realizationPerKgTargets),
    [settings]
  );
  const selectedRealizationTarget = useMemo(
    () => findRealizationTargetForDate(realizationTargets, selectedDate),
    [realizationTargets, selectedDate]
  );
  const requiredRealization = selectedRealizationTarget ? Number(selectedRealizationTarget.value || 0) * 0.98 : null;
  const shouldHighlightProduction = (production: Production, isSample: boolean) => {
    if (isSample || requiredRealization === null) return false;
    const realizationPerKg = Number(production.realizationPerKg);
    if (!Number.isFinite(realizationPerKg)) return false;
    return realizationPerKg < requiredRealization;
  };

  const filteredList = useMemo(() => {
    return productions
      .filter(p => normalizeDate(p.date) === selectedDate)
      .filter(p => {
        const item = npdItems.find(i => i.id === String(p.itemId || "").trim());
        const schedule = schedules.find(s => s.id === p.scheduleId);
        const order = orders.find(o => o.id === schedule?.orderId);
        const company = companies.find(c => c.id === order?.companyId);
        
        if (companyFilter && order?.companyId !== companyFilter) return false;
        const itemKey = item?.id || `${item?.name || ""}::${p.erpCode || ""}`;
        if (itemFilter && itemKey !== itemFilter) return false;
        return p.transactionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (order?.orderNo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (company?.name || "").toLowerCase().includes(searchTerm.toLowerCase());
      })
      .map((production) => {
        const schedule = schedules.find(s => s.id === production.scheduleId);
        const order = orders.find(o => o.id === schedule?.orderId);
        const company = companies.find(c => c.id === order?.companyId);
        return {
          ...production,
          productionPlanCompanyName: company?.name || production.companyName || "",
        };
      });
  }, [productions, selectedDate, searchTerm, companyFilter, itemFilter, npdItems, schedules, orders, companies]);

  const companyOptions = useMemo(() => Array.from(new Map(filteredList.map((row) => { const schedule = schedules.find((s) => s.id === row.scheduleId); const order = orders.find((o) => o.id === schedule?.orderId); const company = companies.find((c) => c.id === order?.companyId); return [order?.companyId || "", { value: order?.companyId || "", label: company?.name || "" }]; })).values()).filter((option) => option.value && option.label).sort((a, b) => a.label.localeCompare(b.label)), [companies, filteredList, orders, schedules]);
  const itemOptions = useMemo(() => Array.from(new Map(filteredList.map((row) => { const item = npdItems.find((i) => i.id === String(row.itemId || "").trim()); const erp = String(row.erpCode || ""); const name = item?.name || ""; const key = item?.id || `${name}::${erp}`; return [key, { value: key, label: erp && name && !name.toLowerCase().includes(erp.toLowerCase()) ? `${name} - ${erp}` : name || erp, searchText: `${name} ${erp}` }]; })).values()).filter((option) => option.value && option.label).sort((a, b) => a.label.localeCompare(b.label)), [filteredList, npdItems]);
  const sortedList = useMemo(() => sortProductionPlanRows(filteredList), [filteredList]);
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedList,
  } = useClientPagination(sortedList, 25);

  const getExportData = (data: Production[]) => {
    return data.map((p, index) => {
      const schedule = schedules.find(s => s.id === p.scheduleId);
      const order = orders.find(o => o.id === schedule?.orderId);
      const company = companies.find(c => c.id === order?.companyId);
      const item = npdItems.find(i => i.id === String(p.itemId || "").trim());
      const isSample = isSampleProduction(p);
      const value = (Number(p.qty || 0) || 0) * (Number(p.rate || 0) || 0);

      return {
        "Sr. No.": index + 1,
        "Date": formatDate(p.date),
        "Job Number": p.transactionNo || "-",
        "Company": company?.name || "-",
        "ERP": p.erpCode || "-",
        "Item Name": item?.name || "-",
        "Sample (Yes/No)": isSample ? "Yes" : "No",
        "Plan Quantity": format2(p.qty),
        "UPS": format2(p.ups),
        "Ply": format2(p.ply),
        "Flute": p.flute || "-",
        "L1": format2(p.l1),
        "F1": format2(p.f1),
        "L2": format2(p.l2),
        "F2": format2(p.f2),
        "L3": format2(p.l3),
        "GSM": format2(p.gsm),
        "Least GSM": format2(p.leastGsm),
        "Reel As Per Calculation": format2(p.reelAsPerCalc),
        "Reel Actual Trim": format2(p.reelActualWithTrimming),
        "Cutting Trim": format2(p.cuttingWithTrimming),
        "Planned Production (Meter)": format2(p.plannedProductionInMeter),
        "Sheet Weight": format2(p.sheetWeight),
        "Total Paper Weight": format2(p.totalPaperWeight),
        "Flute Batch": p.fluteBatches || "-",
        "Paper Required (Nos)": format2(p.paperRequiredNos),
        "Liner Required (Nos)": format2(p.lineRequiredNos),
      } as Record<string, string | number>;
    });
  };

  const handleExportPDF = () => {
    const doc = new jsPDF('landscape', 'mm', 'a3');
    doc.setFontSize(16);
    doc.text(`Production Plan - ${formatDate(selectedDate)}`, 14, 15);
    doc.setFontSize(10);
    
    const exportData = getExportData(sortedList);
    if (exportData.length === 0) return;

    const tableColumn = Object.keys(exportData[0]);
    const tableRows = exportData.map(row => Object.values(row));

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 20,
      theme: 'grid',
      styles: { fontSize: 6, cellPadding: 1 },
      headStyles: { fillColor: [200, 200, 200], textColor: 0, fontStyle: 'bold' },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const production = sortedList[data.row.index];
        if (!production) return;
        const isSample = isSampleProduction(production);
        if (!shouldHighlightProduction(production, isSample)) return;
        data.cell.styles.fillColor = [255, 153, 153];
      },
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
              <ExcelExport data={getExportData(sortedList)} fileName={`Production_Plan_${selectedDate}`} />
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

      <div className="grid gap-3 md:grid-cols-[minmax(260px,1.4fr)_minmax(220px,1fr)_minmax(260px,1.1fr)_auto] md:items-center">
        <TableControls
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          placeholder="Search jobs..."
        />
        <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
        <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
        {(searchTerm || companyFilter || itemFilter) ? (
          <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
        ) : null}
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        {isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center px-6 py-12">
            <div className="flex items-center gap-3 text-sm font-bold text-slate-600">
              <Spinner size={28} />
              <span>Loading production plan...</span>
            </div>
          </div>
        ) : (
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Sr. No.</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Date</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Job Number</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">ERP</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Item Name</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Sample (Yes/No)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Plan Quantity</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">UPS</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Ply</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Flute</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">L1</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">F1</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">L2</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">F2</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">L3</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">GSM</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Least GSM</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Reel As Per Calculation</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Reel Actual Trim</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Cutting Trim</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Planned Production (Meter)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Sheet Weight</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Total Paper Weight</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Realization Per Kg</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Flute Batch</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Rate</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Value</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Paper Required (Nos)</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-black uppercase border border-black whitespace-nowrap">Liner Required (Nos)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {sortedList.length === 0 ? (
                <tr>
                  <td colSpan={30} className="px-6 py-8 text-center text-black font-medium">No productions found for this date.</td>
                </tr>
              ) : (
                paginatedList.map((p, index) => {
                  const schedule = schedules.find(s => s.id === p.scheduleId);
                  const order = orders.find(o => o.id === schedule?.orderId);
                  const company = companies.find(c => c.id === order?.companyId);
                  const item = npdItems.find(i => i.id === String(p.itemId || "").trim());
                  const isSample = isSampleProduction(p);
                  const value = (Number(p.qty || 0) || 0) * (Number(p.rate || 0) || 0);
                  const highlightRow = shouldHighlightProduction(p, isSample);

                  return (
                    <tr
                      key={p.id}
                      className={`divide-x divide-black transition-colors ${highlightRow ? "hover:bg-[#FF9999]" : "hover:bg-slate-50"}`}
                      style={highlightRow ? { backgroundColor: "#FF9999" } : undefined}
                    >
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-black border border-black whitespace-nowrap">{(page - 1) * pageSize + index + 1}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-3 text-[11px] font-bold text-black border border-black whitespace-nowrap">{p.transactionNo}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-normal break-words min-w-[220px] max-w-[220px]" title={company?.name}>{company?.name || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.erpCode || "-"}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-normal break-words min-w-[320px] max-w-[320px]" title={item?.name}>{item?.name || "-"}</td>
                      <td className="px-4 py-3 text-center text-[11px] text-black border border-black whitespace-nowrap">{isSample ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-emerald-700 border border-black whitespace-nowrap">{format2(p.qty)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.ups)}</td>
                      <td className="px-4 py-3 text-center text-[11px] text-black border border-black whitespace-nowrap">{format2(p.ply)}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.flute || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.l1)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.f1)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.l2)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.f2)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.l3)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.gsm)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.leastGsm)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.reelAsPerCalc)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.reelActualWithTrimming)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.cuttingWithTrimming)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.plannedProductionInMeter)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.sheetWeight)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.totalPaperWeight)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.realizationPerKg)}</td>
                      <td className="px-4 py-3 text-[11px] text-black border border-black whitespace-nowrap">{p.fluteBatches || "-"}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.rate)}</td>
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-black border border-black whitespace-nowrap">{format2(value)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.paperRequiredNos)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-black border border-black whitespace-nowrap">{format2(p.lineRequiredNos)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}
        <ClientPagination
          page={page}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
