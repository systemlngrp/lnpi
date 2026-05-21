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
  PackageOpen,
  TrendingDown,
  Activity,
  Plus,
  Receipt,
  FlaskConical,
  BookOpenText,
  X
} from "lucide-react";
import { useData } from "../hooks/useData";
import { MaterialIn, Production, Consumption, OrderSchedule, DispatchPlan, LoadingSlip, SampleRequest } from "../types";
import { cn } from "../lib/utils";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [consumptions] = useData<Consumption>("consumptions", []);
  const [sampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [dispatchPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);

  const isPendingPH = (status?: string | null) => !status || status === "Pending PH";

  const counts: Record<string, number> = {
    "/material-in/pending-ph": materialIn.filter(m => isPendingPH(m.status)).length,
    "/material-in/pending-accounts": materialIn.filter(m => m.status === "Pending Accounts").length,
    "/material-in/pending-md": materialIn.filter(m => m.status === "Pending MD").length,
    "/material-in/pending-tally": materialIn.filter(m => m.status === "Pending Tally").length,
    "/production/pending-ph": productions.filter(p => isPendingPH(p.status)).length,
    "/production/pending": schedules.filter(s => Number(s.qty || 0) > Number(s.producedQty || 0) + Number(s.canceledQty || 0)).length,
    "/production/pending-tally": productions.filter(p => p.status === "Pending Tally").length,
    "/samples/pending": sampleRequests.filter(s => !s.jobCardNo && !s.cancelTimestamp).length,
    "/consumption/pending-ph": consumptions.filter(c => isPendingPH(c.status)).length,
    "/consumption/pending-tally": consumptions.filter(c => c.status === "Pending Tally").length,
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
                  productions.filter(p => isPendingPH(p.status)).length + 
                  consumptions.filter(c => isPendingPH(c.status)).length
  };

  const navigation = [
    {
      section: "Quick Access",
      color: "bg-indigo-900",
      items: [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Bulk Entry Form", href: "/bulk-entry", icon: Plus },
        { name: "Unified PH Approval", href: "/plant-head", icon: UserCheck, countKey: "/plant-head" },
      ],
    },
    {
      section: "Masters",
      color: "bg-indigo-700",
      items: [
        { name: "Item Groups", href: "/masters/item-groups", icon: Layers },
        { name: "Items", href: "/masters/items", icon: Boxes },
        { name: "Suppliers", href: "/masters/suppliers", icon: UserCog },
        { name: "Colors", href: "/masters/colors", icon: Plus },
        { name: "Companies", href: "/masters/companies", icon: Database },
        { name: "Trucks", href: "/masters/trucks", icon: Truck },
        { name: "Machines", href: "/masters/machines", icon: Hammer },
        { name: "Users", href: "/masters/users", icon: Users },
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
        { name: "Pending Tally Entry", href: "/production/pending-tally", icon: FileText, countKey: "/production/pending-tally" },
        { name: "Production Plan", href: "/production/plan", icon: ClipboardList },
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
      section: "Consumption",
      color: "bg-amber-700",
      items: [
        { name: "Consumption Form", href: "/consumption/form", icon: PackageOpen },
        { name: "Pending PH Approval", href: "/consumption/pending-ph", icon: UserCheck, countKey: "/consumption/pending-ph" },
        { name: "Pending Tally Entry", href: "/consumption/pending-tally", icon: FileText, countKey: "/consumption/pending-tally" },
        { name: "Consumption Master", href: "/consumption/master", icon: Database },
      ],
    },
    {
      section: "Documentation",
      color: "bg-slate-700",
      items: [
        { name: "Production Planning Logic", href: "/plans/production-planning", icon: BookOpenText },
        { name: "Items", href: "/plans/items", icon: BookOpenText },
      ],
    },
  ];



  return (
    <div className={cn(
        "fixed inset-y-0 left-0 z-50 flex h-full w-[280px] flex-col bg-black shadow-2xl transition-transform duration-300 ease-in-out md:static md:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
    )}>
      <div className="flex h-16 shrink-0 items-center justify-between px-4 bg-slate-900 border-b border-black sticky top-0 z-20">
        <div className="flex items-center">
            <Truck className="h-6 w-6 text-white mr-2 shrink-0" />
            <h1 className="text-xs font-black text-white tracking-tight leading-tight uppercase whitespace-nowrap">LNPI Ops<br/>Portal</h1>
        </div>
        <button className="md:hidden p-2 text-white" onClick={onClose}>
            <X size={20} />
        </button>
      </div>
      <nav className="flex-1 space-y-3 px-2 py-4 overflow-y-auto">
        {navigation.map((group) => (
          <div key={group.section} className={cn("p-1 rounded flex flex-col border border-white/10", group.color)}>
            <h3 className="text-[10px] font-bold text-white text-left tracking-wider uppercase mb-1.5 pl-1 pt-0.5 opacity-70 whitespace-nowrap">
               {group.section}
            </h3>
            <div className="space-y-px">
              {group.items.map((item) => {
                const isActive = (item.href === "/" && location.pathname === "/") || (item.href !== "/" && location.pathname.startsWith(item.href));
                const count = item.countKey ? counts[item.countKey] : 0;
                
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={onClose}
                    className={cn(
                      isActive
                        ? "bg-white text-black font-bold shadow-inner"
                        : "text-white hover:bg-black/20 hover:text-white font-medium",
                      "group flex items-center justify-between rounded-sm px-2 py-1.5 text-[11px] transition-all whitespace-nowrap"
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
                      <span>{item.name}</span>
                    </div>
                    {count > 0 && (
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
