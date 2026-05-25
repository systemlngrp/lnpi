import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Boxes,
  ClipboardList,
  LayoutDashboard,
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
  MaterialReturn,
  MaterialReturnLine,
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

export function Sidebar({ isOpen, onClose, isCollapsed }: SidebarProps) {
  const location = useLocation();
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [orders] = useData<Order>("orders", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [sampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [indents] = useData<Indent>("indents", []);
  const [indentLines] = useData<IndentLine>("indent-lines", []);
  const [purchaseOrders] = useData<PurchaseOrder>("purchase-orders", []);
  const [gateEntries] = useData<GateEntry>("gate-entries", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const normalizedIndents = indents.map((indent) =>
    withIndentTotals(indent, indentLines.filter((line) => line.indentId === indent.id))
  );
  const productionUsageMap = buildProductionMaterialUsageMap(
    materialIssues,
    materialIssueLines,
    materialReturns,
    materialReturnLines
  );

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

  const counts: Record<string, number> = {
    "/material-in/pending-ph": materialIn.filter(m => isPendingPH(m.status)).length,
    "/material-in/pending-accounts": materialIn.filter(m => m.status === "Pending Accounts").length,
    "/material-in/pending-md": materialIn.filter(m => m.status === "Pending MD").length,
    "/material-in/pending-tally": materialIn.filter(m => m.status === "Pending Tally").length,
    "/production/pending-ph": productions.filter(isProductionPendingPH).length,
    "/production/pending": schedules.filter(s => Number(s.qty || 0) > Number(s.producedQty || 0) + Number(s.canceledQty || 0)).length,
    "/production/pending-consumption": productions.filter((p) => isProductionPendingConsumption(p, getProductionActualPaperUsed(p, productionUsageMap))).length,
    "/production/pending-ffg": productions.filter((p) => isProductionPendingFFG(p, getProductionActualPaperUsed(p, productionUsageMap))).length,
    "/production/pending-tally": productions.filter((p) => isProductionReadyForTally(p, getProductionActualPaperUsed(p, productionUsageMap))).length,
    "/indent/pending": normalizedIndents.filter(i => i.status === "Pending").length,
    "/indent/approved": normalizedIndents.filter(i => i.status === "Approved").length,
    "/indent/completed": normalizedIndents.filter(i => i.status === "Completed").length,
    "/indent/rejected": normalizedIndents.filter(i => i.status === "Rejected").length,
    "/purchase-orders/pending-po": normalizedIndents.filter(i => i.status === "Approved" && Number(i.totalBalanceQty || 0) > 0).length,
    "/purchase-orders/all": purchaseOrders.length,
    "/purchase-orders/pending-approval": purchaseOrders.filter(po => po.status === "Pending Approval").length,
    "/purchase-orders/approved": purchaseOrders.filter(po => po.status === "Approved").length,
    "/purchase-orders/rejected": purchaseOrders.filter(po => po.status === "Rejected").length,
    "/material-receipt/pending-mrr": gateEntries.filter(entry => !(entry.mrrId || "").trim() && !(entry.mrrNo || "").trim() && !(entry.mrrDate || "").trim()).length,
    "/samples/pending": sampleRequests.filter(s => !s.jobCardNo && !s.cancelTimestamp).length,
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
    "/orders/upcoming": schedules.filter(s => {
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

      return !isNaN(schedDate.getTime()) && schedDate > tomorrow && balance > 0;
    }).length,
    "/plant-head": materialIn.filter(m => isPendingPH(m.status)).length + 
                  productions.filter(isProductionPendingPH).length +
                  orders.filter(o => isPendingPH(o.status)).length +
                  consumptions.filter(c => isPendingPH(c.status)).length
  };

  const navigation = [
    {
      section: "Quick Access",
      color: "bg-indigo-900",
      items: [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Delivery Book", href: "/delivery-book", icon: BookOpenText },
        { name: "Production Plan", href: "/production/plan", icon: ClipboardList },
        { name: "Unified PH Approval", href: "/plant-head", icon: UserCheck, countKey: "/plant-head" },
      ],
    },
    {
      section: "Masters",
      color: "bg-indigo-700",
      items: [
        { name: "Item Groups", href: "/masters/item-groups", icon: Layers },
        { name: "Material Groups", href: "/masters/material-groups", icon: Layers },
        { name: "Items", href: "/masters/items", icon: Boxes },
        { name: "Material Master", href: "/masters/materials", icon: Boxes },
        { name: "Suppliers", href: "/masters/suppliers", icon: UserCog },
        { name: "States", href: "/masters/states", icon: Database },
        { name: "Units", href: "/masters/units", icon: Database },
        { name: "Colors", href: "/masters/colors", icon: Plus },
        { name: "Companies", href: "/masters/companies", icon: Database },
        { name: "Trucks", href: "/masters/trucks", icon: Truck },
        { name: "Machines", href: "/masters/machines", icon: Hammer },
        { name: "Users", href: "/masters/users", icon: Users },
        { name: "Settings", href: "/masters/settings", icon: Database },
      ],
    },
    {
      section: "Material In",
      color: "bg-slate-800",
      items: [
        { name: "Material In Form", href: "/material-in/form", icon: ClipboardList },
        { name: "Pending PH Approval", href: "/material-in/pending-ph", icon: UserCheck, countKey: "/material-in/pending-ph" },
        { name: "Pending Accounts Approval", href: "/material-in/pending-accounts", icon: CheckCircle, countKey: "/material-in/pending-accounts" },
        { name: "Pending MD Approval", href: "/material-in/pending-md", icon: UserCog, countKey: "/material-in/pending-md" },
        { name: "Pending Tally Entry", href: "/material-in/pending-tally", icon: FileText, countKey: "/material-in/pending-tally" },
        { name: "Material In Master", href: "/material-in/master", icon: Database },
        { name: "Item Master View", href: "/material-in/item-master", icon: BarChart3 },
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
        { name: "Pending PO", href: "/purchase-orders/pending-po", icon: Activity, countKey: "/purchase-orders/pending-po" },
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
        { name: "Pending MRR", href: "/material-receipt/pending-mrr", icon: Activity, countKey: "/material-receipt/pending-mrr" },
      ],
    },
    {
      section: "Material Movement",
      color: "bg-lime-700",
      items: [
        { name: "Material Issue Form", href: "/material-movement/issue", icon: ClipboardList },
        { name: "Material Return Form", href: "/material-movement/return", icon: TrendingDown },
      ],
    },
    {
      section: "Orders",
      color: "bg-rose-700",
      items: [
        { name: "Order Form", href: "/orders/form", icon: ClipboardList },
        { name: "Pending PH Approval", href: "/orders/pending-ph", icon: UserCheck },
        { name: "Pending Scheduling", href: "/orders/pending-scheduling", icon: Activity },
        { name: "Orders Master", href: "/orders/master", icon: FileText },
        { name: "Scheduled Orders Master", href: "/orders/scheduled", icon: Database },
        { name: "Upcoming Scheduled Orders", href: "/orders/upcoming", icon: Activity, countKey: "/orders/upcoming" },
        { name: "Canceled Orders", href: "/orders/canceled", icon: X },
      ],
    },
    {
      section: "Production",
      color: "bg-emerald-700",
      items: [
        { name: "Production Form", href: "/production/form", icon: Hammer },
        { name: "Pending Production", href: "/production/pending", icon: Activity, countKey: "/production/pending" },
        { name: "Pending PH Approval", href: "/production/pending-ph", icon: UserCheck, countKey: "/production/pending-ph" },
        { name: "Pending Material Issue", href: "/production/pending-consumption", icon: FileText, countKey: "/production/pending-consumption" },
        { name: "Pending FFG", href: "/production/pending-ffg", icon: FileText, countKey: "/production/pending-ffg" },
        { name: "Pending Tally Entry", href: "/production/pending-tally", icon: FileText, countKey: "/production/pending-tally" },
        { name: "Production Master", href: "/production/master", icon: Database },
        { name: "Itemwise Least Cost", href: "/production/least-cost", icon: BarChart3 },
        { name: "Canceled Jobs", href: "/production/canceled", icon: X },
      ],
    },
    {
      section: "Production Processing",
      color: "bg-teal-800",
      items: [
        { name: "Reporting Form", href: "/production-processing/form", icon: ClipboardList },
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
        { name: "Billing Master", href: "/billing/master", icon: FileText },
      ],
    },
    {
      section: "Reports",
      color: "bg-sky-700",
      items: [
        { name: "ERP Wise Reel Stock", href: "/reports/erp-wise-reel-stock", icon: BarChart3 },
        { name: "Reelwise Stock", href: "/reports/reelwise-stock", icon: BarChart3 },
        { name: "Jobwise Reel Consumption", href: "/reports/jobwise-reel-consumption", icon: BarChart3 },
      ],
    },
    {
      section: "Documentation",
      color: "bg-slate-700",
      items: [
        { name: "Production Planning Logic", href: "/plans/production-planning", icon: BookOpenText },
        { name: "Production", href: "/plans/production", icon: BookOpenText },
        { name: "Items", href: "/plans/items", icon: BookOpenText },
      ],
    },
  ];

  useEffect(() => {
    const saved = window.localStorage.getItem("sidebar-collapsed-sections");
    if (!saved) return;
    try {
      setCollapsedSections(JSON.parse(saved));
    } catch {
      setCollapsedSections({});
    }
  }, []);

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      window.localStorage.setItem("sidebar-collapsed-sections", JSON.stringify(next));
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
      <nav className="flex-1 space-y-3 px-2 py-4 overflow-y-auto">
        {navigation.map((group) => (
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
              {group.items.map((item) => {
                const isActive = (item.href === "/" && location.pathname === "/") || (item.href !== "/" && location.pathname.startsWith(item.href));
                const count = item.countKey ? counts[item.countKey] : 0;
                
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
                      {!isCollapsed && <span>{item.name}</span>}
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
        ))}
      </nav>
    </div>
  );
}
