import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Boxes,
  ClipboardList,
  Layers,
  FileText,
  UserCheck,
  UserCog,
  CheckCircle,
  Database,
  Hammer,
  Truck,
  Users,
  BarChart3,
  TrendingDown,
  Activity,
  Plus,
  Receipt,
  FlaskConical,
  BookOpenText,
  X,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useAuth } from "../auth/AuthContext";
import {
  MaterialIn,
  Production,
  Order,
  Consumption,
  OrderSchedule,
  DispatchPlan,
  LoadingSlip,
  SampleRequest,
  Indent,
  IndentLine,
  PurchaseOrder,
  GateEntry,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Invoice,
} from "../types";
import { cn } from "../lib/utils";
import { isProductionPendingConsumption, isProductionPendingFFG, isProductionPendingPH, isProductionReadyForTally } from "../lib/productionStageFilters";
import { withIndentTotals } from "../lib/indentTotals";
import { buildProductionMaterialUsageMap, getProductionActualPaperUsed } from "../lib/productionMaterialUsage";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
}

export type NavItem = {
  name: string;
  href: string;
  icon: any;
  countKey?: string;
};

export type NavGroup = {
  section: string;
  color: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    section: "Quick Access",
    color: "bg-indigo-900",
    items: [
      { name: "Operation Dashboard", href: "/operations-dashboard", icon: BarChart3 },
      { name: "Production Plan", href: "/production/plan", icon: ClipboardList },
    ],
  },
  {
    section: "Masters",
    color: "bg-indigo-700",
    items: [
      { name: "Material Master", href: "/masters/materials", icon: Boxes },
      { name: "Suppliers", href: "/masters/suppliers", icon: UserCog },
      { name: "States", href: "/masters/states", icon: Database },
      { name: "Units", href: "/masters/units", icon: Database },
      { name: "Colors", href: "/masters/colors", icon: Plus },
      { name: "GST Rate Master", href: "/masters/gst-rates", icon: Database },
      { name: "Companies", href: "/masters/companies", icon: Database },
      { name: "Trucks", href: "/masters/trucks", icon: Truck },
      { name: "Machine Master", href: "/masters/machines", icon: Hammer },
      { name: "RAPC Range Master", href: "/masters/rapc-ranges", icon: Database },
      { name: "NPD Items", href: "/masters/npd", icon: Database },
      { name: "Users", href: "/masters/users", icon: Users },
      { name: "Services", href: "/masters/services", icon: Database },
      { name: "Settings", href: "/masters/settings", icon: Database },
    ],
  },
  {
    section: "Indent",
    color: "bg-orange-700",
    items: [
      { name: "Indent Form", href: "/indent/form", icon: ClipboardList },
      { name: "Pending", href: "/indent/pending", icon: Activity, countKey: "/indent/pending" },
      { name: "Approved", href: "/indent/approved", icon: Database, countKey: "/indent/approved" },
      { name: "Completed", href: "/indent/completed", icon: CheckCircle, countKey: "/indent/completed" },
      { name: "Rejected", href: "/indent/rejected", icon: X, countKey: "/indent/rejected" },
    ],
  },
  {
    section: "Purchase Order",
    color: "bg-cyan-700",
    items: [
      { name: "Pending PO Items", href: "/purchase-orders/pending-indent-lines", icon: Activity, countKey: "/purchase-orders/pending-indent-lines" },
      { name: "All", href: "/purchase-orders/all", icon: Database, countKey: "/purchase-orders/all" },
      { name: "Pending Approval", href: "/purchase-orders/pending-approval", icon: UserCheck, countKey: "/purchase-orders/pending-approval" },
      { name: "Approved", href: "/purchase-orders/approved", icon: CheckCircle, countKey: "/purchase-orders/approved" },
      { name: "Rejected", href: "/purchase-orders/rejected", icon: X, countKey: "/purchase-orders/rejected" },
    ],
  },
  {
    section: "Gate Entry",
    color: "bg-violet-700",
    items: [
      { name: "GE Form", href: "/gate-entry/form", icon: ClipboardList },
      { name: "Gate Entry Master", href: "/gate-entry/master", icon: Database },
    ],
  },
  {
    section: "Material Receipt",
    color: "bg-fuchsia-700",
    items: [
      { name: "Material Receipt Item Master", href: "/material-in/item-master", icon: Database },
      { name: "Pending Material Receipt", href: "/material-receipt/pending-mrr", icon: Activity, countKey: "/material-receipt/pending-mrr" },
      { name: "Pending MRR Approvals", href: "/material-receipt/approvals", icon: CheckCircle, countKey: "/material-receipt/approvals" },
      { name: "Pending Tally Posting", href: "/material-receipt/pending-tally", icon: FileText, countKey: "/material-receipt/pending-tally" },
      { name: "Pending Debit Note", href: "/material-receipt/pending-debit-note", icon: FileText, countKey: "/material-receipt/pending-debit-note" },
    ],
  },
  {
    section: "Material Issue and Return",
    color: "bg-lime-700",
    items: [
      { name: "Material Issue and Return", href: "/material-movement/reel-issue-return", icon: ClipboardList },
      { name: "Material Issue Form", href: "/material-movement/issue", icon: ClipboardList },
      { name: "Material Issue Master", href: "/material-movement/issue-master", icon: Database },
      { name: "Pending Non-Job Material Issue", href: "/material-movement/pending-non-job-issue", icon: FileText, countKey: "/material-movement/pending-non-job-issue" },
      { name: "Non-Job Issue Master", href: "/material-movement/non-job-issue-master", icon: Database },
      { name: "Material Return Form", href: "/material-movement/return", icon: TrendingDown },
      { name: "Material Return Master", href: "/material-movement/return-master", icon: Database },
    ],
  },
  {
    section: "Orders",
    color: "bg-rose-700",
    items: [
      { name: "Order Form", href: "/orders/form", icon: ClipboardList },
      { name: "Pending Salesman Approval", href: "/orders/pending-ph", icon: UserCheck, countKey: "/orders/pending-ph" },
      { name: "Pending Scheduling", href: "/orders/pending-scheduling", icon: Activity, countKey: "/orders/pending-scheduling" },
      { name: "Orders Master", href: "/orders/master", icon: FileText },
      { name: "Scheduled Orders Master", href: "/orders/scheduled", icon: Database },
      { name: "Canceled Orders", href: "/orders/canceled", icon: X },
    ],
  },
  {
    section: "Production",
    color: "bg-emerald-700",
    items: [
      { name: "Pending Production Plan", href: "/production/pending", icon: Activity, countKey: "/production/pending" },
      { name: "Pending NPD", href: "/production/pending-npd", icon: Activity, countKey: "/production/pending-npd" },
      { name: "Upcoming Scheduled Orders", href: "/production/upcoming", icon: Activity, countKey: "/orders/upcoming" },
      { name: "Pending Material Issue", href: "/production/pending-consumption", icon: FileText, countKey: "/production/pending-consumption" },
      { name: "Pending FG", href: "/production/pending-ffg", icon: FileText, countKey: "/production/pending-ffg" },
      { name: "Pending Tally Entry", href: "/production/pending-tally", icon: FileText, countKey: "/production/pending-tally" },
      { name: "Pending Job Closure", href: "/production/pending-job-closure", icon: FileText, countKey: "/production/pending-job-closure" },
      { name: "Production Master", href: "/production/master", icon: Database },
      { name: "Itemwise Least Cost", href: "/production/least-cost", icon: BarChart3 },
      { name: "Canceled Jobs", href: "/production/canceled", icon: X },
    ],
  },
  {
    section: "Production Processing",
    color: "bg-teal-800",
    items: [
      { name: "Pending Processing", href: "/production/pending-machine-processing", icon: Hammer },
      { name: "Reporting Master", href: "/production-processing/master", icon: Database },
    ],
  },
  {
    section: "Samples",
    color: "bg-teal-700",
    items: [
      { name: "Sample Form", href: "/samples/form", icon: FlaskConical },
      { name: "Pending Samples", href: "/samples/pending", icon: Activity, countKey: "/samples/pending" },
      { name: "Samples Produced", href: "/samples/produced", icon: CheckCircle },
      { name: "Sample Master", href: "/samples/master", icon: Database },
    ],
  },
  {
    section: "Dispatch",
    color: "bg-blue-700",
    items: [
      { name: "Pending Dispatch Planning", href: "/dispatch/pending-planning", icon: ClipboardList, countKey: "/dispatch/pending-planning" },
      { name: "Dispatch Plans Master", href: "/dispatch/master", icon: Database },
    ],
  },
  {
    section: "Loading",
    color: "bg-indigo-600",
    items: [
      { name: "Pending Loading", href: "/loading/pending", icon: Truck, countKey: "/loading/pending" },
      { name: "Loading Master", href: "/loading/master", icon: FileText },
    ],
  },
  {
    section: "Billing",
    color: "bg-emerald-600",
    items: [
      { name: "Pending Invoicing", href: "/billing/pending", icon: Receipt, countKey: "/billing/pending" },
      { name: "Pending Tally Posting", href: "/billing/pending-tally", icon: CheckCircle, countKey: "/billing/pending-tally" },
      { name: "Billing Master", href: "/billing/master", icon: FileText },
    ],
  },
  {
    section: "Gate Pass",
    color: "bg-cyan-800",
    items: [
      { name: "Gate Pass Form", href: "/gate-pass/form", icon: ClipboardList },
      { name: "Gate Pass Master", href: "/gate-pass/master", icon: Database },
      { name: "Pending Returnable Items", href: "/gate-pass/pending-returnable", icon: Activity },
    ],
  },
  {
    section: "Reports",
    color: "bg-sky-700",
    items: [
      { name: "ERP Wise Reel Stock", href: "/reports/erp-wise-reel-stock", icon: BarChart3 },
      { name: "Reelwise Stock", href: "/reports/reelwise-stock", icon: BarChart3 },
      { name: "Jobwise Reel Consumption", href: "/reports/jobwise-reel-consumption", icon: BarChart3 },
      { name: "Efficiency Report", href: "/reports/efficiency", icon: BarChart3 },
      { name: "Hit Vs Miss", href: "/reports/hit-vs-miss", icon: BarChart3 },
      { name: "Realization Report", href: "/reports/realization", icon: BarChart3 },
      { name: "Paper Requirement", href: "/reports/paper-requirement", icon: BarChart3 },
    ],
  },
  {
    section: "Documentation",
    color: "bg-slate-700",
    items: [
      { name: "Production Planning Logic", href: "/plans/production-planning", icon: BookOpenText },
      { name: "Production", href: "/plans/production", icon: BookOpenText },
      { name: "Items", href: "/plans/items", icon: BookOpenText },
      { name: "Loading Plan", href: "/plans/loading", icon: BookOpenText },
    ],
  },
];

const NAVIGATION_WITH_SORTED_MASTERS: NavGroup[] = NAVIGATION.map((group) =>
  group.section === "Masters"
    ? {
        ...group,
        items: [...group.items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
      }
    : group
);

export function Sidebar({ isOpen, onClose, isCollapsed }: SidebarProps) {
  const location = useLocation();
  const { hasAccess, user } = useAuth();
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [orders] = useData<Order>("orders", []);
  const npdItems = useNpdItems();
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialIssueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [materialReturnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [sampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [indents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [gateEntries] = useData<GateEntry>("gate-entries", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [invoices] = useData<Invoice>("invoices", []);

  const normalizedIndents = indents.map((indent) =>
    withIndentTotals(indent, indentLines.filter((line) => line.indentId === indent.id))
  );
  const productionUsageMap = buildProductionMaterialUsageMap(
    materialIssues,
    materialIssueLines,
    materialReturns,
    materialReturnLines,
    materialIssueReelLines,
    materialReturnReelLines
  );

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";
  const normalizeDate = (value?: string | null) => String(value || "").slice(0, 10);
  const isWithoutJobIssue = (issueType?: string | null) => {
    const t = String(issueType || "").trim().toLowerCase();
    return t === "general" || t === "without job" || t === "withoutjob" || t === "without_job";
  };

  const pendingNonJobIssueCount = (() => {
    const firstJobDate = productions
      .map((p) => normalizeDate(p.date))
      .filter(Boolean)
      .sort()[0];
    if (!firstJobDate) return 0;

    const today = new Date().toISOString().slice(0, 10);
    const issuesByDate = new Set(
      materialIssues
        .filter((i) => isWithoutJobIssue(i.issueType))
        .map((i) => normalizeDate(i.date))
        .filter(Boolean)
    );

    let count = 0;
    const cursor = new Date(`${firstJobDate}T00:00:00Z`);
    const end = new Date(`${today}T00:00:00Z`);
    while (cursor <= end) {
      const d = cursor.toISOString().slice(0, 10);
      if (!issuesByDate.has(d)) count += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  })();

  const [pendingJobClosureCount, setPendingJobClosureCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = window.localStorage.getItem("authToken") || "";
        const response = await fetch("/api/get-pending-job-closure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        const nextCount = Array.isArray(rows) ? rows.length : 0;
        if (!cancelled) setPendingJobClosureCount(nextCount);
      } catch {
        if (!cancelled) setPendingJobClosureCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts: Record<string, number> = {
    "/material-receipt/approvals": materialIn.filter(m => ["Pending MRR", "Pending PH", "Pending Accounts", "Pending MD", "Pending Tally"].includes(m.status)).length,
    "/material-receipt/pending-tally": materialIn.filter(m => m.status === "Pending Tally").length,
    "/production/pending": (() => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() + 2);
      cutoffDate.setHours(23, 59, 59, 999);

      const getPendingProductionQty = (schedule: OrderSchedule) =>
        Math.max(
          Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
          0
        );

      const parseLocalYmd = (dateStr?: string) => {
        if (!dateStr) return null;
        const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        const date = new Date(year, monthIndex, day);
        if (Number.isNaN(date.getTime())) return null;
        date.setHours(0, 0, 0, 0);
        return date;
      };

      return schedules.filter((schedule) => {
        if (getPendingProductionQty(schedule) <= 0) return false;
        const scheduledDate = parseLocalYmd(schedule.scheduledDate);
        if (!scheduledDate) return false;
        return scheduledDate.getTime() <= cutoffDate.getTime();
      }).length;
    })(),
    "/production/pending-npd": schedules.filter((schedule) => {
      const order = orders.find((row) => row.id === schedule.orderId);
      if (!order || order.status === "Cancelled") return false;
      const item = npdItems.find((row) => row.id === String(order.itemId || "").trim());
      if (!item) return false;
      const boxType = String((item as any)?.boxType || "").trim();
      const rapcValue = String((item as any)?.rapc ?? "").trim();
      return !boxType || !rapcValue;
    }).length,
    "/production/pending-consumption": productions.filter((p) => isProductionPendingConsumption(p, getProductionActualPaperUsed(p, productionUsageMap))).length,
    "/production/pending-ffg": productions.filter((p) => isProductionPendingFFG(p, getProductionActualPaperUsed(p, productionUsageMap))).length,
    "/production/pending-tally": productions.filter((p) => isProductionReadyForTally(p, getProductionActualPaperUsed(p, productionUsageMap))).length,
    "/production/pending-job-closure": pendingJobClosureCount,
    "/indent/pending": normalizedIndents.filter(i => i.status === "Pending").length,
    "/indent/approved": normalizedIndents.filter(i => i.status === "Approved").length,
    "/indent/completed": normalizedIndents.filter(i => i.status === "Completed").length,
    "/indent/rejected": normalizedIndents.filter(i => i.status === "Rejected").length,
    "/purchase-orders/pending-indent-lines": indentLines.filter((l) => Number(l.qty || 0) - Number(l.cancelledQty || 0) - Number(l.orderedQty || 0) > 0).length,
    "/purchase-orders/all": purchaseOrders.length,
    "/purchase-orders/pending-approval": purchaseOrders.filter(po => po.status === "Pending Approval").length,
    "/purchase-orders/approved": purchaseOrders.filter(po => po.status === "Approved").length,
    "/purchase-orders/rejected": purchaseOrders.filter(po => po.status === "Rejected").length,
    "/material-receipt/pending-mrr": gateEntries.filter(entry => !(entry.mrrId || "").trim() && !(entry.mrrNo || "").trim() && !(entry.mrrDate || "").trim()).length,
    "/material-receipt/pending-debit-note": 0,
    "/material-movement/pending-non-job-issue": pendingNonJobIssueCount,
    "/samples/pending": sampleRequests.filter(s => !s.jobCardNo && !s.cancelTimestamp).length,
    "/orders/pending-ph": orders.filter(o => isPendingPH(o.status)).length,
    "/orders/pending-scheduling": orders.filter(o => o.status === "Pending Scheduling").length,
    "/dispatch/pending-planning": schedules.filter(s => {
      if (!s?.scheduledDate) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      const schedDate = new Date(s.scheduledDate);
      
      const alreadyPlanned = dispatchPlans
        .filter(plan => plan.scheduleId === s.id)
        .reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
      
      const balance = Number(s.qty || 0) - alreadyPlanned;

      return !isNaN(schedDate.getTime()) && schedDate <= tomorrow && balance > 0;
    }).length,
    "/loading/pending": dispatchPlans.filter(p => {
      const pending = Number(p.plannedQty || 0) - Number(p.loadedQty || 0) - Number(p.canceledQty || 0);
      return pending > 0;
    }).length,
    "/billing/pending": loadingSlips.filter(s => !s.invoiceId).length,
    "/billing/pending-tally": invoices.filter(inv => !inv.tallyTimestamp).length,
    "/orders/upcoming": schedules.filter(s => {
      if (!s?.scheduledDate) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() + 2);
      cutoffDate.setHours(23, 59, 59, 999);

      const parseLocalYmd = (dateStr?: string) => {
        if (!dateStr) return null;
        const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        const date = new Date(year, monthIndex, day);
        if (Number.isNaN(date.getTime())) return null;
        date.setHours(0, 0, 0, 0);
        return date;
      };

      const getPendingProductionQty = (schedule: OrderSchedule) =>
        Math.max(
          Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
          0
        );

      const scheduledDate = parseLocalYmd(s.scheduledDate);
      if (!scheduledDate) return false;

      return scheduledDate.getTime() > cutoffDate.getTime() && getPendingProductionQty(s) > 0;
    }).length,
    "/plant-head": materialIn.filter(m => isPendingPH(m.status)).length + 
                  productions.filter(isProductionPendingPH).length +
                  orders.filter(o => isPendingPH(o.status)).length +
                  consumptions.filter(c => isPendingPH(c.status)).length
  };

  const navigation = useMemo(() => {
    if (user?.role !== "Operator") return NAVIGATION_WITH_SORTED_MASTERS;
    return NAVIGATION_WITH_SORTED_MASTERS
      .filter((group) => group.section === "Production Processing")
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.name === "Pending Processing"),
      }));
  }, [user?.role]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const group of navigation) next[group.section] = true;
    setCollapsedSections(next);
  }, [navigation]);

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const currentlyCollapsed = !!prev[section];
      const nextCollapsed = !currentlyCollapsed;

      if (nextCollapsed) {
        return { ...prev, [section]: true };
      }

      const next: Record<string, boolean> = {};
      for (const group of navigation) next[group.section] = true;
      next[section] = false;
      return next;
    });
  };



  return (
    <div className={cn(
        "fixed inset-y-0 left-0 z-50 flex h-full w-[280px] flex-col bg-black shadow-2xl transition-all duration-300 ease-in-out md:static md:translate-x-0",
        isCollapsed ? "md:w-[78px]" : "md:w-[280px]",
        isOpen ? "translate-x-0" : "-translate-x-full"
    )}>
      <div className={cn("flex h-16 shrink-0 items-center justify-between bg-slate-900 border-b border-black sticky top-0 z-20", isCollapsed ? "px-3" : "px-4")}>
        <div className="flex items-center">
            <Truck className={cn("h-6 w-6 text-white shrink-0", isCollapsed ? "" : "mr-2")} />
            {!isCollapsed && <h1 className="text-xs font-black text-white tracking-tight leading-tight uppercase whitespace-nowrap">LNPI Ops<br/>Portal</h1>}
        </div>
        <button className="md:hidden p-2 text-white" onClick={onClose}>
            <X size={20} />
        </button>
      </div>
      <nav className="flex-1 space-y-3 px-2 py-4 overflow-y-auto border-r border-white/5">
        {navigation.map((group) => {
          const visibleItems = group.items.filter((item) => hasAccess(item.href));
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.section} className={cn("p-1 rounded flex flex-col border border-white/10", group.color)}>
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleSection(group.section)}
                  className="mb-1 flex w-full items-center justify-between rounded px-1 pt-0.5 pb-1 text-left text-[10px] font-bold uppercase tracking-wider text-white/70 hover:bg-black/10"
                >
                  <span className="whitespace-nowrap">{group.section}</span>
                  {collapsedSections[group.section] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              ) : null}
              <div className={cn("space-y-px", !isCollapsed && collapsedSections[group.section] && "hidden")}>
                {visibleItems.map((item) => {
                  const itemUrl = new URL(item.href, window.location.origin);
                  const isActive = (item.href === "/" && location.pathname === "/") || 
                                   (item.href !== "/" && (
                                     location.pathname === itemUrl.pathname && 
                                     (!itemUrl.search || location.search === itemUrl.search)
                                   ));
                  const count = item.countKey ? counts[item.countKey] : (item as any).count || 0;
                  
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      onClick={onClose}
                      title={item.name}
                      className={cn(
                        isActive
                          ? "bg-white text-black font-bold shadow-inner"
                          : "text-white hover:bg-black/20 hover:text-white font-medium",
                        "group flex items-center justify-between rounded-sm py-1.5 text-[11px] transition-all whitespace-nowrap",
                        isCollapsed ? "px-2" : "px-2"
                      )}
                    >
                      <div className="flex items-center">
                        <item.icon
                          className={cn(
                            isActive ? "text-black" : "text-white",
                            "mr-2 h-4 w-4 shrink-0"
                          )}
                          aria-hidden="true"
                        />
                        {!isCollapsed && <span className="truncate max-w-[160px]">{item.name}</span>}
                      </div>
                      {count > 0 && !isCollapsed && (
                        <span className={cn(
                          "flex items-center justify-center min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-black tracking-tighter shrink-0 ml-3",
                          isActive ? "bg-black text-white" : "bg-white text-black"
                        )}>
                          {count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
