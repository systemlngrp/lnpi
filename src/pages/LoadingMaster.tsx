import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { 
  LoadingSlip, 
  LoadingSlipAllocation,
  Truck, 
  DispatchPlan,
  Order,
  Item,
  Company,
  Setting
} from "../types";
import { 
  Search, 
  FileText, 
  Truck as TruckIcon, 
  Calendar, 
  Package,
  ChevronRight,
  X,
  Download
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { ExcelExport } from "../components/ExcelExport";
import { downloadLoadingSlipPdf } from "../lib/loadingSlipPdf";

function formatAllocations(line: LoadingSlip["lines"][number]) {
  if (Array.isArray(line.allocations) && line.allocations.length > 0) {
    return line.allocations.map((allocation: LoadingSlipAllocation) =>
      allocation.sourceType === "job"
        ? `${allocation.jobNo} - ${Number(allocation.qty || 0).toLocaleString()}`
        : `${allocation.sourceRef} - ${Number(allocation.qty || 0).toLocaleString()}`
    );
  }

  if (Array.isArray(line.jobNos) && line.jobNos.length > 0) {
    return line.jobNos.map((jobNo) => String(jobNo));
  }

  return [];
}

export function LoadingMaster() {
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const [items] = useData<Item>("items", []);
  const [companies] = useData<Company>("companies", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSlip, setSelectedSlip] = useState<LoadingSlip | null>(null);

  const getTruckNo = (id: string) => trucks.find(t => t.id === id)?.truckNo || "Unknown";

  const processedSlips = useMemo(() => {
    return loadingSlips.map(slip => {
      const totalQty = slip.lines.reduce((sum, line) => sum + line.loadedQty, 0);
      return {
        ...slip,
        truckNo: getTruckNo(slip.truckId),
        totalQty
      };
    }).filter(slip => {
      return slip.slipNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
             slip.truckNo.toLowerCase().includes(searchTerm.toLowerCase());
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [loadingSlips, trucks, searchTerm]);

  const slipDetails = useMemo(() => {
    if (!selectedSlip) return [];
    return selectedSlip.lines.map(line => {
      const plan = plans.find(p => p.id === line.dispatchPlanId);
      const order = orders.find(o => o.id === plan?.orderId);
      const item = items.find(i => i.id === order?.itemId);
      return {
        ...line,
        orderNo: order?.orderNo || "N/A",
        itemName: item?.name || "Unknown",
        plannedQty: plan?.plannedQty || 0
      };
    });
  }, [selectedSlip, plans, orders, items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Loading Master</h2>
          <ExcelExport data={processedSlips} fileName="Loading_Master" />
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search slip no, truck..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      <div className="bg-white border border-black rounded shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Slip No</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Date</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Truck No</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border-b border-black">Total Qty</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border-b border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {processedSlips.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500 italic">No loading slips found.</td>
              </tr>
            ) : processedSlips.map((slip) => (
              <tr key={slip.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <FileText size={16} className="text-indigo-600 mr-2" />
                    <span className="font-bold text-sm">{slip.slipNo}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {formatDate(slip.date)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm font-medium">
                    <TruckIcon size={14} className="text-slate-400 mr-2" />
                    {slip.truckNo}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600">
                  {slip.totalQty.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex justify-end items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        downloadLoadingSlipPdf({
                          slip,
                          setting: settings[0],
                          trucks,
                          plans,
                          orders,
                          items,
                          companies,
                        })
                      }
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-black rounded hover:bg-slate-50 transition-colors uppercase"
                      title="Download PDF"
                    >
                      <Download size={14} /> PDF
                    </button>
                    <button 
                      onClick={() => setSelectedSlip(slip)}
                      className="text-indigo-600 hover:text-indigo-900 font-bold uppercase flex items-center justify-end gap-1"
                    >
                      Details <ChevronRight size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Slip Details Modal */}
      {selectedSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-3xl border-2 border-black rounded shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <FileText size={20} />
                <h3 className="font-bold uppercase tracking-tight">Loading Slip: {selectedSlip.slipNo}</h3>
              </div>
              <button onClick={() => setSelectedSlip(null)} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6 bg-slate-50 p-4 border border-black rounded">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Truck</div>
                  <div className="font-bold flex items-center gap-2">
                    <TruckIcon size={14} className="text-indigo-600" />
                    {getTruckNo(selectedSlip.truckId)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Date</div>
                  <div className="font-bold flex items-center gap-2">
                    <Calendar size={14} className="text-indigo-600" />
                    {formatDate(selectedSlip.date)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Total Quantity</div>
                  <div className="font-bold text-indigo-600 text-lg">
                    {selectedSlip.lines.reduce((sum, l) => sum + l.loadedQty, 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border border-black rounded">
                <table className="min-w-full divide-y divide-black">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Item Name</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Order No</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Jobs</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Planned</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase">Loaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {slipDetails.map((line, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Package size={14} className="text-slate-400" />
                            <span className="text-sm font-bold uppercase">{line.itemName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">{line.orderNo}</td>
                        <td className="px-4 py-3 text-xs">
                          {formatAllocations(line).length ? formatAllocations(line).join(", ") : "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-sm">{line.plannedQty}</td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-indigo-600">{line.loadedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={() => setSelectedSlip(null)}
                  className="px-8 py-2 bg-slate-900 text-white border-2 border-black font-bold uppercase text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-black transition active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
