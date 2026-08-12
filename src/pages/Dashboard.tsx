import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronRight, Info } from "lucide-react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import {
  Company,
  Consumption,
  DispatchPlan,
  Invoice,
  Item,
  LoadingSlip,
  Material,
  MaterialIn,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Order,
  OrderSchedule,
  Production,
} from "../types";
import { cn, formatDate, formatNumber } from "../lib/utils";
import { isProductionPendingPH, isProductionReadyForTally } from "../lib/productionStageFilters";
import {
  buildProductionCorrugatedSheetUsageMap,
  buildProductionMaterialUsageMap,
  getProductionActualPaperUsed,
  hasProductionCorrugatedSheetUsage,
} from "../lib/productionMaterialUsage";

type Range = {
  from: string;
  to: string;
};

export function Dashboard() {
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const npdItems = useNpdItems();
  const [materials] = useData<Material>("materials", []);
  const [orders] = useData<Order>("orders", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [companies] = useData<Company>("companies", []);

  const today = getLocalDateInputValue(new Date());
  const [dateRange, setDateRange] = useState<Range>({ from: today, to: today });

  const parseAppDate = (dateStr?: string | null) => {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return new Date(year, month - 1, day);
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split("/").map(Number);
      return new Date(year, month - 1, day);
    }

    const datePartMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (datePartMatch) {
      const [, year, month, day] = datePartMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const parseTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split("/").map(Number);
      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const normalizeDateValue = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const getSafeRange = () => {
    const from = parseAppDate(dateRange.from);
    const to = parseAppDate(dateRange.to);
    if (!from || !to) return null;

    const fromTime = normalizeDateValue(from);
    const toTime = normalizeDateValue(to);
    return fromTime <= toTime
      ? { fromTime, toTime }
      : { fromTime: toTime, toTime: fromTime };
  };

  const safeRange = getSafeRange();

  const isWithinSelectedRange = (dateStr?: string) => {
    const parsed = parseAppDate(dateStr);
    if (!parsed || !safeRange) return false;

    const target = normalizeDateValue(parsed);
    return target >= safeRange.fromTime && target <= safeRange.toTime;
  };

  const filteredMaterialIn = materialIn.filter((entry) => isWithinSelectedRange(entry.date));
  const filteredProductions = productions.filter((entry) => isWithinSelectedRange(entry.date));
  const filteredMaterialIssues = materialIssues.filter((entry) => isWithinSelectedRange(entry.date));
  const filteredMaterialReturns = materialReturns.filter((entry) => isWithinSelectedRange(entry.date));
  const productionUsageMap = buildProductionMaterialUsageMap(
    filteredMaterialIssues,
    materialIssueLines,
    filteredMaterialReturns,
    materialReturnLines,
    materialIssueReelLines,
    materialReturnReelLines
  );
  const productionCorrugatedSheetUsageMap = buildProductionCorrugatedSheetUsageMap(
    materials,
    filteredMaterialIssues,
    materialIssueLines,
    filteredMaterialReturns,
    materialReturnLines
  );
  const yesterdayDate = (() => {
    const date = parseAppDate(today);
    if (!date) return today;
    date.setDate(date.getDate() - 1);
    return getLocalDateInputValue(date);
  })();

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

  const materialInCount = filteredMaterialIn.length;
  const productionCount = filteredProductions.length;
  const materialIssueCount = filteredMaterialIssues.length;

  const pendingPH =
    filteredMaterialIn.filter((entry) => isPendingPH(entry.status)).length +
    filteredProductions.filter((entry) => isProductionPendingPH(entry)).length +
    orders.filter((entry) => isPendingPH(entry.status) && isWithinSelectedRange(entry.orderDate)).length +
    consumptions.filter((entry) => isPendingPH(entry.status) && isWithinSelectedRange(entry.date)).length;

  const pendingAccounts = filteredMaterialIn.filter((entry) => entry.status === "Pending Accounts").length;
  const pendingMD = filteredMaterialIn.filter((entry) => entry.status === "Pending MD").length;

  const tallyMatIn = filteredMaterialIn.filter((entry) => entry.status === "Pending Tally" && String(entry.mrrType || "").trim().toLowerCase() !== "rejection in").length;
  const tallyProd = filteredProductions.filter((entry) => isProductionReadyForTally(entry, getProductionActualPaperUsed(entry, productionUsageMap), hasProductionCorrugatedSheetUsage(entry, productionCorrugatedSheetUsageMap))).length;
  const pendingDispatchPlanning = schedules.filter((s) => {
    if (!s?.scheduledDate) return false;
    const todayDate = parseAppDate(today);
    if (!todayDate) return false;
    todayDate.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);
    const schedDate = new Date(s.scheduledDate);
    const alreadyPlanned = dispatchPlans
      .filter((plan) => plan.scheduleId === s.id)
      .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
    const balance = Number(s.qty || 0) - Number(s.canceledQty || 0) - alreadyPlanned;
    return !Number.isNaN(schedDate.getTime()) && schedDate <= tomorrow && balance > 0;
  }).length;
  const pendingLoading = dispatchPlans.filter((plan) => Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0) > 0).length;
  const pendingBilling = loadingSlips.filter((slip) => !slip.invoiceId).length;
  const pendingTasks = pendingPH + pendingAccounts + pendingMD + tallyMatIn + tallyProd + pendingDispatchPlanning + pendingLoading + pendingBilling;
  const pendingTaskRows = [
    { name: "PH Approval (All)", count: pendingPH, href: "/plant-head" },
    { name: "Accounts Approval", count: pendingAccounts, href: "/material-in/pending-accounts" },
    { name: "MD Approval", count: pendingMD, href: "/material-in/pending-md" },
    { name: "Tally Entry (Material In)", count: tallyMatIn, href: "/material-in/pending-tally" },
    { name: "Tally Entry (Production)", count: tallyProd, href: "/production/pending-tally" },
    { name: "Dispatch Planning", count: pendingDispatchPlanning, href: "/dispatch/pending-planning" },
    { name: "Loading", count: pendingLoading, href: "/loading/pending" },
    { name: "Billing", count: pendingBilling, href: "/billing/pending" },
  ];

  const getProductionTotalForDate = (dateValue: string) =>
    productions
      .filter((entry) => entry.date === dateValue && entry.status !== "Cancelled" && !entry.cancelTimestamp)
      .reduce((sum, entry) => sum + Number(entry.prodFromFFG || entry.qty || 0), 0);

  const todaysProduction = getProductionTotalForDate(today);
  const yesterdaysProduction = getProductionTotalForDate(yesterdayDate);
  const totalProduction = filteredProductions
    .filter((entry) => entry.status !== "Cancelled" && !entry.cancelTimestamp)
    .reduce((sum, entry) => sum + Number(entry.prodFromFFG || entry.qty || 0), 0);

  const todaysPlanValue = schedules
    .filter((schedule) => schedule.scheduledDate === today)
    .reduce((sum, schedule) => {
      const order = orders.find((row) => row.id === schedule.orderId);
      return sum + Number(schedule.qty || 0) * Number(order?.rate || 0);
    }, 0);

  const totalActualPaperUsed = filteredProductions.reduce(
    (sum, entry) => sum + Number(getProductionActualPaperUsed(entry, productionUsageMap) || 0),
    0
  );
  const totalUsefulWeight = filteredProductions.reduce(
    (sum, entry) => sum + Number(entry.prodFromFFG || 0) * Number(entry.sheetWeight || 0),
    0
  );
  const totalWastage = totalActualPaperUsed > 0
    ? Math.max(0, 100 - (totalUsefulWeight / totalActualPaperUsed) * 100)
    : 0;

  const getInvoiceTotalForDate = (dateValue: string) =>
    invoices
      .filter((invoice) => invoice.date === dateValue)
      .reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);

  const todaysSale = getInvoiceTotalForDate(today);
  const yesterdaysSale = getInvoiceTotalForDate(yesterdayDate);
  const totalSale = invoices
    .filter((invoice) => isWithinSelectedRange(invoice.date))
    .reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0);

  const hourlyTotals = filteredProductions.reduce<Record<string, number>>((acc, entry) => {
    const timestamp = parseTimestamp(entry.updateTimestamp || entry.date);
    if (!timestamp) return acc;

    const hourLabel = `${String(timestamp.getHours()).padStart(2, "0")}:00`;
    acc[hourLabel] = (acc[hourLabel] || 0) + Number(entry.qty || 0);
    return acc;
  }, {});

  const hasHourlyData = Object.keys(hourlyTotals).length > 0;
  const hourlyData = (hasHourlyData
    ? Object.keys(hourlyTotals)
        .sort((a, b) => Number(a.slice(0, 2)) - Number(b.slice(0, 2)))
        .map((hour) => ({ hour, units: hourlyTotals[hour] || 0 }))
    : []
  );

  const getTopItems = (data: Array<Production | MaterialIn>, type: "prod" | "pur") => {
    const stats: Record<string, number> = {};

    data.forEach((entry) => {
      const targetId = type === "pur" ? (entry as MaterialIn).lines?.[0]?.itemId : (entry as Production).itemId;
      if (!targetId) return;

      const itemName = materials.find((item) => item.id === targetId)?.name || npdItems.find((item) => item.id === targetId)?.name || "Unknown Item";
      const amount = type === "pur" ? Number((entry as MaterialIn).totalAmount || 0) : Number((entry as Production).qty || 0);
      stats[itemName] = (stats[itemName] || 0) + amount;
    });

    const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const max = entries[0]?.[1] || 1;
    return entries.map(([name, value]) => ({
      name,
      percentage: Math.round((value / max) * 100),
    }));
  };

  const topProduced = getTopItems(filteredProductions, "prod");
  const topPurchased = getTopItems(filteredMaterialIn, "pur");
  const topIssued = Object.entries(
    filteredMaterialIssues.reduce<Record<string, number>>((acc, issue) => {
      materialIssueLines
        .filter((line) => line.materialIssueId === issue.id)
        .forEach((line) => {
          const itemName = materials.find((item) => item.id === line.materialId)?.name || "Unknown Material";
          acc[itemName] = (acc[itemName] || 0) + Number(line.qty || 0);
        });
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const topIssuedData = topIssued.map(([name, value]) => ({
    name,
    percentage: Math.round((value / (topIssued[0]?.[1] || 1)) * 100),
  }));

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf5_0%,#eef6ff_45%,#f6f0ff_100%)] text-black font-sans p-4 md:p-8 space-y-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 border-b-4 border-black pb-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-black uppercase italic">LNPI ERP</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DateInput label="From" value={dateRange.from} onChange={(value) => setDateRange((prev) => ({ ...prev, from: value }))} />
          <DateInput label="To" value={dateRange.to} onChange={(value) => setDateRange((prev) => ({ ...prev, to: value }))} />
        </div>
      </div>

      <section className="space-y-4">
        <DashboardHero
          todaysProduction={formatNumber(todaysProduction, false)}
          yesterdaysProduction={formatNumber(yesterdaysProduction, false)}
          totalProduction={formatNumber(totalProduction, false)}
          todaysPlanValue={todaysPlanValue > 0 ? formatNumber(todaysPlanValue, false) : "N/A"}
          totalWastage={`${totalWastage.toFixed(2)}%`}
          yesterdaysSale={formatNumber(yesterdaysSale, false)}
          totalSale={formatNumber(totalSale, false)}
          todaysSale={formatNumber(todaysSale, false)}
        />
        {false ? <div className="rounded-none border-2 border-black bg-white shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="bg-cyan-400 px-4 py-2 text-center text-xl font-black tracking-tight text-red-700">|| à¤¶à¥à¤°à¥€ à¤—à¤£à¥‡à¤¶à¤¾à¤¯ à¤¨à¤®à¤ƒ ||</div>
          <div className="grid grid-cols-1 md:grid-cols-4">
            <DashboardStatCell label="Today's Production" value={formatNumber(todaysProduction)} tone="bg-[#ffe8a3]" />
            <DashboardStatCell label="Total Production" value={formatNumber(totalProduction)} tone="bg-[#d4a5c5]" />
            <DashboardStatCell label="Today's Plan Value" value={todaysPlanValue > 0 ? formatNumber(todaysPlanValue) : "N/A"} tone="bg-[#40227a] text-white" />
            <DashboardStatCell label="Yesterday's Production" value={formatNumber(yesterdaysProduction)} tone="bg-[#aec9d1]" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 border-t-2 border-black">
            <DashboardStatCell label="Yesterday's Sale" value={formatNumber(yesterdaysSale)} tone="bg-[#f4c8c8]" />
            <DashboardStatCell label="Total Sale" value={formatNumber(totalSale)} tone="bg-[#6f55b3] text-white" />
            <DashboardStatCell label="Today's Sale" value={formatNumber(todaysSale)} tone="bg-[#16e0eb]" />
            <DashboardStatCell label="Total Wastage" value={`${totalWastage.toFixed(2)}%`} tone="bg-[#ff1e1e] text-white" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 border-t-2 border-black">
            <DashboardBannerCell label="Dispatch Report" value={`${formatDisplayDate(dateRange.from)} to ${formatDisplayDate(dateRange.to)}`} tone="bg-[#294f92] text-white" />
            <DashboardBannerCell label="Pending Task" value={formatNumber(pendingTasks)} tone="bg-[#111827] text-white" />
            <DashboardBannerCell label="Today's Snapshot" value={`${formatDisplayDate(today)} / ${formatDisplayDate(yesterdayDate)}`} tone="bg-[#143d59] text-white" />
          </div>
        </div> : null}
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between border-b-4 border-black pb-4">
          <h2 className="text-2xl font-black tracking-tight text-black uppercase">Pending Approvals</h2>
          <Link
            to="/plant-head"
            className="flex items-center gap-2 px-5 py-2 bg-black text-white text-[11px] font-black uppercase rounded-none border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none transition-all"
          >
            View All Tasks <ChevronRight size={14} strokeWidth={4} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <WorkflowCard label="PH Approval" count={pendingPH} tone="bg-[#fff3cd]" />
          <WorkflowCard label="Accounts Approval" count={pendingAccounts} tone="bg-[#d9f2ff]" />
          <WorkflowCard label="MD Approval" count={pendingMD} tone="bg-[#f3e5f5]" />
          <WorkflowCard label="Pending Task" count={pendingTasks} tone="bg-[#e5e7eb]" />
        </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white/90 rounded-none border-2 border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b-2 border-black flex items-center justify-between">
            <div className="text-sm font-black uppercase tracking-widest">Pending Task List</div>
            <div className="text-xs font-black text-slate-600">Total: {formatNumber(pendingTasks, false)}</div>
          </div>
          <table className="min-w-full divide-y divide-black">
            <thead className="sticky top-0 z-30 bg-white border-b-2 border-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-2 text-left text-xs font-black uppercase tracking-widest">Task</th>
                <th className="px-4 py-2 text-right text-xs font-black uppercase tracking-widest w-28">Count</th>
                <th className="px-4 py-2 text-right text-xs font-black uppercase tracking-widest w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {pendingTaskRows.map((row) => (
                <tr key={row.name} className={cn("divide-x divide-black", row.count > 0 ? "bg-amber-50/40" : "bg-white")}>
                  <td className="px-4 py-2 text-sm font-bold">{row.name}</td>
                  <td className="px-4 py-2 text-right text-sm font-black tabular-nums">{formatNumber(row.count, false)}</td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to={row.href}
                      className={cn(
                        "inline-flex items-center justify-center px-3 py-1.5 rounded-none border-2 text-[10px] font-black uppercase tracking-widest transition-all",
                        row.count > 0
                          ? "bg-black text-white border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none"
                          : "bg-white text-slate-500 border-slate-300 pointer-events-none"
                      )}
                      aria-disabled={row.count === 0}
                      tabIndex={row.count === 0 ? -1 : 0}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between border-b-4 border-black pb-4">
          <h2 className="text-2xl font-black tracking-tight text-black uppercase">Tally Integration</h2>
          <Link
            to="/material-in/pending-tally"
            className="flex items-center gap-2 px-5 py-2 bg-white text-black text-[11px] font-black uppercase rounded-none border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:translate-y-px hover:translate-x-px hover:shadow-none transition-all"
          >
            Manage Entries
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TallyCard label="Material In" count={tallyMatIn} tone="bg-[#ffe0b2]" />
          <TallyCard label="Production" count={tallyProd} tone="bg-[#d1f2eb]" />
          <TallyCard label="Material Issues" count={materialIssueCount} tone="bg-[#f8bbd0]" />
        </div>
      </section>

      <section className="bg-white/90 p-8 rounded-none border-2 border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] space-y-8">
        <h2 className="text-3xl font-black tracking-tighter text-black uppercase leading-none italic">Hourly Output</h2>
        <div className="h-[400px] w-full">
          {hasHourlyData ? (
            <ResponsiveContainer width="100%" height="100%" minHeight={0}>
              <BarChart data={hourlyData} margin={{ top: 30, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#000000" strokeOpacity={0.15} />
                <XAxis
                  dataKey="hour"
                  axisLine={{ stroke: "#000000", strokeWidth: 3 }}
                  tickLine={{ stroke: "#000000", strokeWidth: 3 }}
                  fontSize={11}
                  fontWeight={900}
                  tick={{ fill: "#000000" }}
                  dy={12}
                />
                <YAxis
                  axisLine={{ stroke: "#000000", strokeWidth: 3 }}
                  tickLine={{ stroke: "#000000", strokeWidth: 3 }}
                  fontSize={11}
                  fontWeight={900}
                  tick={{ fill: "#000000" }}
                />
                <Tooltip
                  cursor={{ fill: "#000000", fillOpacity: 0.08 }}
                  contentStyle={{
                    borderRadius: "0px",
                    border: "3px solid #000000",
                    boxShadow: "6px 6px 0px 0px rgba(0,0,0,1)",
                    fontSize: "12px",
                    fontWeight: "900",
                    padding: "16px",
                    textTransform: "uppercase",
                  }}
                />
                <Bar dataKey="units" fill="#2563eb" radius={[0, 0, 0, 0]} barSize={window.innerWidth > 1024 ? 60 : 32}>
                  <LabelList dataKey="units" position="top" style={{ fill: "#000000", fontSize: "13px", fontWeight: "900" }} offset={15} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center border-4 border-dashed border-black/10">
              <span className="text-sm font-black uppercase tracking-[0.25em] text-black/40">No production records in selected range</span>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">
        <RankList title="Top Produced" items={topProduced} tone="bg-[#fff8e1]" />
        <RankList title="Top Issued" items={topIssuedData} tone="bg-[#e8f5e9]" />
        <RankList title="Top Purchased" items={topPurchased} tone="bg-[#fce4ec]" />
      </div>
    </div>
  );
}

function DashboardHero({
  todaysProduction,
  yesterdaysProduction,
  totalProduction,
  todaysPlanValue,
  totalWastage,
  yesterdaysSale,
  totalSale,
  todaysSale,
}: {
  todaysProduction: string;
  yesterdaysProduction: string;
  totalProduction: string;
  todaysPlanValue: string;
  totalWastage: string;
  yesterdaysSale: string;
  totalSale: string;
  todaysSale: string;
}) {
  return (
    <div className="overflow-hidden border-2 border-black bg-white shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]">
      <div className="grid grid-cols-1 md:grid-cols-10">
        <HeroMetricCell label="Today's Production" value={todaysProduction} tone="bg-[#f7cf79]" className="md:col-span-3" />
        <HeroTitleCell title="LNPI Production Management" className="md:col-span-4" />
        <HeroMetricCell label="Yesterday's Production" value={yesterdaysProduction} tone="bg-[#a8c8d6]" className="md:col-span-3" />
        <HeroMetricCell label="Total Production" value={totalProduction} tone="bg-[#d4a8c2]" className="md:col-span-3 md:border-t-2" />
        <HeroMetricCell label="Today's Plan Value" value={todaysPlanValue} tone="bg-[#4f2fa4] text-white" className="md:col-span-4 md:border-t-2" />
        <HeroMetricCell label="Total Wastage" value={totalWastage} tone="bg-[#ffe28d]" valueTone="text-[#ff1f1f]" className="md:col-span-3 md:border-t-2" />
        <HeroMetricCell label="Yesterday's Sale" value={yesterdaysSale} tone="bg-[#efc3c3]" valueTone="text-[#ff1f1f]" className="md:col-span-3 md:border-t-2" />
        <HeroMetricCell label="Total Sale" value={totalSale} tone="bg-[#6a54b6] text-white" className="md:col-span-4 md:border-t-2" />
        <HeroMetricCell label="Today's Sale" value={todaysSale} tone="bg-[#1adbe6]" className="md:col-span-3 md:border-t-2" />
      </div>
    </div>
  );
}

function formatDisplayDate(value: string) {
  return formatDate(value) || "-";
}

function getLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-4 bg-white px-5 py-2.5 rounded-none border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col">
        <span className="text-[10px] font-black text-black uppercase tracking-tighter leading-none mb-1.5 opacity-60">{label}</span>
        <input
          type="date"
          className="text-sm font-black bg-transparent border-none p-0 focus:ring-0 leading-tight uppercase cursor-pointer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="mt-1 text-[10px] font-black text-slate-500 tracking-wide">{formatDisplayDate(value)}</span>
      </div>
    </div>
  );
}

function KpiCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <div className="rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden bg-white">
      <div className={`h-4 bg-gradient-to-r ${accent}`} />
      <div className="p-7">
        <p className="text-[10px] font-black text-black uppercase tracking-[0.22em] leading-none opacity-60">{title}</p>
        <p className="mt-5 text-4xl font-black text-black tracking-tighter leading-none italic">{value}</p>
      </div>
    </div>
  );
}

function HeroMetricCell({
  label,
  value,
  tone,
  className,
  valueTone,
}: {
  label: string;
  value: string;
  tone: string;
  className?: string;
  valueTone?: string;
}) {
  return (
    <div className={cn("min-h-[92px] border-r-2 border-black last:border-r-0 flex flex-col justify-center px-4 py-4 text-center", tone, className)}>
      <div className="text-sm font-black uppercase tracking-tight text-current">{label}</div>
      <div className={cn("mt-3 text-3xl md:text-4xl font-black leading-none tracking-tight", valueTone)}>{value}</div>
    </div>
  );
}

function HeroTitleCell({ title, tone = "bg-[#6a1400] text-white", className }: { title: string; tone?: string; className?: string }) {
  return (
    <div className={cn("min-h-[92px] border-r-2 border-black last:border-r-0 px-4 py-4 flex items-center justify-center text-center", tone, className)}>
      <span className="text-2xl md:text-[2rem] font-black uppercase tracking-tight">{title}</span>
    </div>
  );
}

function HeroDateCell({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn("min-h-[74px] border-r-2 border-black last:border-r-0 px-4 py-4 flex items-center justify-center text-center bg-[#4f86db]", className)}>
      <span className="text-2xl font-black tracking-tight text-white">{value}</span>
    </div>
  );
}

function DashboardStatCell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <HeroMetricCell label={label} value={value} tone={tone} />;
}

function DashboardBannerCell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={cn("min-h-[78px] border-r-2 border-black last:border-r-0 px-4 py-4 flex items-center justify-between gap-4", tone)}>
      <span className="text-lg font-black uppercase tracking-tight">{label}</span>
      <span className="text-xl font-black tracking-tight">{value}</span>
    </div>
  );
}

function WorkflowCard({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={`${tone} p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1`}>
      <p className="text-[11px] font-black text-black uppercase tracking-[0.25em] opacity-70">{label}</p>
      <span className="mt-4 block text-6xl font-black text-black leading-none tracking-tighter italic">{count}</span>
    </div>
  );
}

function TallyCard({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={`${tone} p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1`}>
      <p className="text-[11px] font-black text-black uppercase tracking-[0.22em] opacity-70">{label}</p>
      <span className="mt-4 block text-6xl font-black text-black leading-none tracking-tighter italic">{count}</span>
    </div>
  );
}

function RankList({
  title,
  items,
  tone,
}: {
  title: string;
  items: { name: string; percentage: number }[];
  tone: string;
}) {
  return (
    <div className={`${tone} p-8 rounded-none border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] space-y-8 transition-all`}>
      <div className="space-y-2 border-b-4 border-black pb-6">
        <h3 className="text-xl font-black text-black uppercase tracking-tighter italic">{title}</h3>
      </div>
      <div className="space-y-8">
        {items.map((item, index) => (
          <div key={index} className="space-y-3">
            <div className="flex justify-between items-center text-xs font-black uppercase tracking-wide text-black gap-4">
              <span className="truncate leading-none">{item.name}</span>
              <span className="tabular-nums bg-black text-white px-2 py-0.5">{item.percentage}%</span>
            </div>
            <div className="w-full bg-white/70 h-3 rounded-none border-2 border-black overflow-hidden">
              <div className="h-full bg-black transition-all duration-[1.2s] ease-out" style={{ width: `${item.percentage}%` }} />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-14 flex flex-col items-center justify-center border-4 border-dashed border-black/10 transition-colors">
            <Info size={32} className="text-black opacity-10 mb-4" />
            <span className="text-[11px] font-black text-black opacity-30 uppercase tracking-[0.3em]">No Data</span>
          </div>
        )}
      </div>
    </div>
  );
}

