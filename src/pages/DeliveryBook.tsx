import React, { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { LoadingSlip, DispatchPlan, Order, Company, Item, Truck } from "../types";
import { Search, BookOpen, Calendar, MapPin, Package, User } from "lucide-react";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";

export function DeliveryBook() {
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem } = useOrderItemCatalog();
  const [trucks] = useData<Truck>("trucks", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const processedData = useMemo(() => {
    const list = loadingSlips.map((slip) => {
      const truck = trucks.find((t) => t.id === slip.truckId);
      const firstLine = slip.lines[0];
      const plan = dispatchPlans.find((p) => p.id === firstLine?.dispatchPlanId);
      const order = orders.find((o) => o.id === plan?.orderId);
      const company = companies.find((c) => c.id === order?.companyId);

      const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);
      const itemsList = Array.from(new Set(slip.lines.map(line => {
        const p = dispatchPlans.find(pl => pl.id === line.dispatchPlanId);
        const o = orders.find(ord => ord.id === p?.orderId);
        return resolveOrderItem(o)?.name || "Unknown";
      })));

      return {
        id: slip.id,
        slipNo: slip.slipNo,
        date: slip.date,
        truckNo: slip.truckNo || truck?.truckNo || "-",
        driver: truck?.driverName || "-",
        company: company?.name || "Unknown",
        itemsSummary: itemsList.join(", "),
        totalQty,
        status: slip.status,
      };
    });

    return list
      .filter((row) => {
        const matchesDate = !dateFilter || row.date.startsWith(dateFilter);
        const search = searchTerm.toLowerCase();
        const matchesSearch =
          row.slipNo.toLowerCase().includes(search) ||
          row.truckNo.toLowerCase().includes(search) ||
          row.company.toLowerCase().includes(search) ||
          row.itemsSummary.toLowerCase().includes(search);
        return matchesDate && matchesSearch;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [loadingSlips, dispatchPlans, orders, companies, npdItems, trucks, searchTerm, dateFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-3 text-indigo-700">
          <BookOpen size={24} />
          <h2 className="text-xl font-bold uppercase tracking-tight text-black">Delivery Book</h2>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 border border-black rounded text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white font-bold"
          />
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search slip, truck, company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded border border-black shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-black border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr className="divide-x divide-black">
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider">Slip Info</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider">Consignee</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider">Vehicle Details</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider">Items Summary</th>
              <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-wider">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {processedData.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500 italic">No records found for selected criteria.</td>
              </tr>
            ) : (
              processedData.map((row) => (
                <tr key={row.id} className={cn("hover:bg-slate-50 transition-colors divide-x divide-black text-[11px] font-bold uppercase", row.status === "Cancelled" && "opacity-50 line-through")}>
                  <td className="px-4 py-4 whitespace-nowrap text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} />
                      {formatDate(row.date)}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-indigo-700">{row.slipNo}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-start gap-1.5">
                      <MapPin size={12} className="mt-0.5 text-slate-400" />
                      <span className="max-w-[150px]">{row.company}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 text-black">
                        <Package size={12} className="text-slate-400" />
                        {row.truckNo}
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-500 font-normal">
                        <User size={12} className="text-slate-400" />
                        {row.driver}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-slate-600 font-medium truncate max-w-[250px]" title={row.itemsSummary}>
                      {row.itemsSummary}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right text-black font-black whitespace-nowrap">
                    {row.totalQty.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
