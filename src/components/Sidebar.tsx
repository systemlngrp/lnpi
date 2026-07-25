import { useEffect, useState, useMemo, useCallback } from "react";
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
  Search,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { useAuth } from "../auth/AuthContext";
import {
  MaterialIn,
  Material,
  Machine,
  Production,
  ProductionProcessing,
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
  GatePass,
  Setting,
} from "../types";
import { cn } from "../lib/utils";
import { useAutoRefreshEffect } from "../hooks/useAutoRefresh";
import { buildPendingTaskCounts } from "../lib/pendingTaskCounts";

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

export type NavSubGroup = {
  section: string;
  items: NavItem[];
};

export type NavEntry = NavItem | NavSubGroup;

export type NavGroup = {
  section: string;
  color: string;
  items: NavEntry[];
};

function isNavSubGroup(entry: NavEntry): entry is NavSubGroup {
  return "items" in entry;
}

const indentItems: NavItem[] = [
  { name: "Indent Form", href: "/indent/form", icon: ClipboardList },
  { name: "Pending", href: "/indent/pending", icon: Activity, countKey: "/indent/pending" },
  { name: "Approved", href: "/indent/approved", icon: Database, countKey: "/indent/approved" },
  { name: "Completed", href: "/indent/completed", icon: CheckCircle, countKey: "/indent/completed" },
  { name: "Rejected", href: "/indent/rejected", icon: X, countKey: "/indent/rejected" },
];

const purchaseOrderItems: NavItem[] = [
  { name: "Pending PO Items", href: "/purchase-orders/pending-indent-lines", icon: Activity, countKey: "/purchase-orders/pending-indent-lines" },
  { name: "All", href: "/purchase-orders/all", icon: Database, countKey: "/purchase-orders/all" },
  { name: "Pending Approval", href: "/purchase-orders/pending-approval", icon: UserCheck, countKey: "/purchase-orders/pending-approval" },
  { name: "Approved", href: "/purchase-orders/approved", icon: CheckCircle, countKey: "/purchase-orders/approved" },
  { name: "Rejected", href: "/purchase-orders/rejected", icon: X, countKey: "/purchase-orders/rejected" },
];

const gateEntryItems: NavItem[] = [
  { name: "GE Form", href: "/gate-entry/form", icon: ClipboardList },
  { name: "Gate Entry Master", href: "/gate-entry/master", icon: Database },
  { name: "Cancelled Gate Entry", href: "/gate-entry/cancelled", icon: X },
];

const materialReceiptItems: NavItem[] = [
  { name: "Material Receipt Master", href: "/material-in/master", icon: Database },
  { name: "Material Receipt Item Master", href: "/material-in/item-master", icon: Database },
  { name: "Pending Material Receipt", href: "/material-receipt/pending-mrr", icon: Activity, countKey: "/material-receipt/pending-mrr" },
  { name: "Pending MRR Approvals", href: "/material-receipt/approvals", icon: CheckCircle, countKey: "/material-receipt/approvals" },
  { name: "Pending Tally Posting", href: "/material-receipt/pending-tally", icon: FileText, countKey: "/material-receipt/pending-tally" },
  { name: "Pending Debit Note", href: "/material-receipt/pending-debit-note", icon: FileText, countKey: "/material-receipt/pending-debit-note" },
];

const materialIssueReturnItems: NavItem[] = [
  { name: "Material Issue and Return", href: "/material-movement/reel-issue-return", icon: ClipboardList },
  { name: "Material Issue Form", href: "/material-movement/issue", icon: ClipboardList },
  { name: "Material Issue Master", href: "/material-movement/issue-master", icon: Database },
  { name: "Pending Non-Job Material Issue", href: "/material-movement/pending-non-job-issue", icon: FileText, countKey: "/material-movement/pending-non-job-issue" },
  { name: "Pending Consumption Tally Posting", href: "/material-movement/pending-consumption-tally", icon: FileText, countKey: "/material-movement/pending-consumption-tally" },
  { name: "Non-Job Issue Master", href: "/material-movement/non-job-issue-master", icon: Database },
  { name: "Material Return Form", href: "/material-movement/return", icon: TrendingDown },
  { name: "Material Return Master", href: "/material-movement/return-master", icon: Database },
];

const orderItems: NavItem[] = [
  { name: "Order Form", href: "/orders/form", icon: ClipboardList },
  { name: "Pending Salesman Approval", href: "/orders/pending-ph", icon: UserCheck, countKey: "/orders/pending-ph" },
  { name: "Pending Scheduling", href: "/orders/pending-scheduling", icon: Activity, countKey: "/orders/pending-scheduling" },
  { name: "Orders Master", href: "/orders/master", icon: FileText },
  { name: "Scheduled Orders Master", href: "/orders/scheduled", icon: Database },
  { name: "Canceled Orders", href: "/orders/canceled", icon: X },
];

const productionItems: NavItem[] = [
  { name: "Pending Production Plan", href: "/production/pending", icon: Activity, countKey: "/production/pending" },
  { name: "Pending NPD", href: "/production/pending-npd", icon: Activity, countKey: "/production/pending-npd" },
  { name: "Upcoming Scheduled Orders", href: "/production/upcoming", icon: Activity, countKey: "/orders/upcoming" },
  { name: "Pending Material Issue", href: "/production/pending-consumption", icon: FileText, countKey: "/production/pending-consumption" },
  { name: "Pending FG", href: "/production/pending-ffg", icon: FileText, countKey: "/production/pending-ffg" },
  { name: "Pending Printing", href: "/production/pending-printing", icon: FileText, countKey: "/production/pending-printing" },
  { name: "Pending Tally Entry", href: "/production/pending-tally", icon: FileText, countKey: "/production/pending-tally" },
  { name: "Pending Job Closure", href: "/production/pending-job-closure", icon: FileText, countKey: "/production/pending-job-closure" },
  { name: "Production Master", href: "/production/master", icon: Database },
  { name: "Itemwise Least Cost", href: "/production/least-cost", icon: BarChart3 },
  { name: "Canceled Jobs", href: "/production/canceled", icon: X },
];

const phpPlateProcessItems: NavItem[] = [
  { name: "Pending PHP Planning", href: "/production/php/pending-planning", icon: ClipboardList, countKey: "/production/php/pending-planning" },
  { name: "Pending Plate Planning", href: "/production/plate/pending-planning", icon: ClipboardList, countKey: "/production/plate/pending-planning" },
  { name: "Scheduling", href: "/production/php-plate/scheduling", icon: ClipboardList },
  { name: "Sequencing", href: "/production/php-plate/pending-sequencing", icon: Activity, countKey: "/production/php-plate/pending-sequencing" },
  { name: "Production", href: "/production/php-plate/pending-production", icon: Hammer, countKey: "/production/php-plate/pending-production" },
];

const phpMasterItems: NavItem[] = [
  { name: "PHP Production Master", href: "/production/php/master", icon: Database },
];

const plateMasterItems: NavItem[] = [
  { name: "Plate Production Master", href: "/production/plate/master", icon: Database },
];

const productionProcessingItems: NavItem[] = [
  { name: "Pending Processing", href: "/production/pending-machine-processing", icon: Hammer, countKey: "/production/pending-machine-processing" },
  { name: "Reporting Master", href: "/production-processing/master", icon: Database },
];

const sampleItems: NavItem[] = [
  { name: "Sample Form", href: "/samples/form", icon: FlaskConical },
  { name: "Pending Samples", href: "/samples/pending", icon: Activity, countKey: "/samples/pending" },
  { name: "Samples Produced", href: "/samples/produced", icon: CheckCircle },
  { name: "Sample Master", href: "/samples/master", icon: Database },
];

const dispatchItems: NavItem[] = [
  { name: "Pending Dispatch Planning", href: "/dispatch/pending-planning", icon: ClipboardList, countKey: "/dispatch/pending-planning" },
  { name: "Dispatch Plans Master", href: "/dispatch/master", icon: Database },
];

const loadingItems: NavItem[] = [
  { name: "Pending Loading", href: "/loading/pending", icon: Truck, countKey: "/loading/pending" },
  { name: "Loading Master", href: "/loading/master", icon: FileText },
];

const phpLoadingItems: NavItem[] = [
  { name: "Pending PHP Tally", href: "/loading/php/pending-tally", icon: FileText, countKey: "/loading/php/pending-tally" },
  { name: "PHP Loading Slip Master", href: "/loading/php/master", icon: FileText },
];

const plateLoadingItems: NavItem[] = [
  { name: "Pending Plate Tally", href: "/loading/plate/pending-tally", icon: FileText, countKey: "/loading/plate/pending-tally" },
  { name: "Plate Loading Slip Master", href: "/loading/plate/master", icon: FileText },
];

const billingItems: NavItem[] = [
  { name: "Pending Invoicing", href: "/billing/pending", icon: Receipt, countKey: "/billing/pending" },
  { name: "Pending Tally Posting", href: "/billing/pending-tally", icon: CheckCircle, countKey: "/billing/pending-tally" },
  { name: "Billing Master", href: "/billing/master", icon: FileText },
];

const reportStockItems: NavItem[] = [
  { name: "ERP Wise Reel Stock", href: "/reports/erp-wise-reel-stock", icon: BarChart3 },
  { name: "Reelwise Stock", href: "/reports/reelwise-stock", icon: BarChart3 },
  { name: "Jobwise Reel Consumption", href: "/reports/jobwise-reel-consumption", icon: BarChart3 },
];

const reportProductionItems: NavItem[] = [
  { name: "Jobs in Progress", href: "/reports/jobs-in-progress", icon: BarChart3 },
  { name: "Fixed Monthly Expenses", href: "/reports/fixed-monthly-expenses", icon: Database },
  { name: "Conversion Cost Report", href: "/reports/conversion-cost", icon: BarChart3 },
  { name: "Conversion Cost Month Wise", href: "/reports/conversion-cost-month-wise", icon: BarChart3 },
  { name: "Efficiency Report", href: "/reports/efficiency", icon: BarChart3 },
  { name: "Hit Vs Miss", href: "/reports/hit-vs-miss", icon: BarChart3 },
  { name: "Paper Requirement", href: "/reports/paper-requirement", icon: BarChart3 },
];

const reportSalesItems: NavItem[] = [
  { name: "Realization Report", href: "/reports/realization", icon: BarChart3 },
  { name: "Wastage Report", href: "/reports/wastage", icon: BarChart3 },
];

const reportLogisticsItems: NavItem[] = [
  { name: "Truck Status", href: "/reports/truck-status", icon: Truck },
];

export const NAVIGATION: NavGroup[] = [
  {
    section: "Quick Access",
    color: "bg-indigo-900",
    items: [
      { name: "Operation Dashboard", href: "/operations-dashboard", icon: BarChart3 },
      { name: "Audit Dashboard", href: "/audit-dashboard", icon: BarChart3 },
      { name: "Production Plan", href: "/production/plan", icon: ClipboardList },
    ],
  },
  {
    section: "Master",
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
      { name: "PHP Item Master", href: "/masters/php-item-master", icon: Database },
      { name: "Plate Item Master", href: "/masters/plate-item-master", icon: Database },
      { name: "Users", href: "/masters/users", icon: Users },
      { name: "Services", href: "/masters/services", icon: Database },
      { name: "Settings", href: "/masters/settings", icon: Database },
    ],
  },
  {
    section: "Purchase",
    color: "bg-orange-700",
    items: [
      { section: "Indent", items: indentItems },
      { section: "Purchase Order", items: purchaseOrderItems },
      { section: "Gate Entry", items: gateEntryItems },
      { section: "Material Receipt", items: materialReceiptItems },
    ],
  },
  {
    section: "Orders",
    color: "bg-lime-700",
    items: orderItems,
  },
  {
    section: "Jobs",
    color: "bg-emerald-700",
    items: [
      { section: "Material Issue and Return", items: materialIssueReturnItems },

      { section: "Production", items: productionItems },
      { section: "PHP / Plate Process", items: phpPlateProcessItems },
      { section: "PHP Master", items: phpMasterItems },
      { section: "Plate Master", items: plateMasterItems },
      { section: "Production Processing", items: productionProcessingItems },
      { section: "Samples", items: sampleItems },
    ],
  },
  {
    section: "Sales",
    color: "bg-blue-700",
    items: [
      { section: "Dispatch", items: dispatchItems },
      { section: "Loading", items: loadingItems },
      { section: "PHP Loading", items: phpLoadingItems },
      { section: "Plate Loading", items: plateLoadingItems },
      { section: "Billing", items: billingItems },
    ],
  },
  {
    section: "Truck",
    color: "bg-violet-700",
    items: [
      { name: "Truck Status", href: "/reports/truck-status", icon: Truck },
      { name: "Vehicle Live Update", href: "/truck/live-update", icon: Activity },
      { name: "Driver Form", href: "/driver-status", icon: ClipboardList },
      { name: "Truck Logs", href: "/truck/logs", icon: FileText },
    ],
  },
  {
    section: "Gate Pass",
    color: "bg-cyan-800",
    items: [
      { name: "Gate Pass Form", href: "/gate-pass/form", icon: ClipboardList },
      { name: "Gate Pass Master", href: "/gate-pass/master", icon: Database },
      { name: "Pending Returnable Items", href: "/gate-pass/pending-returnable", icon: Activity, countKey: "/gate-pass/pending-returnable" },
    ],
  },
  {
    section: "Report",
    color: "bg-sky-700",
    items: [
      { section: "Stock", items: reportStockItems },
      { section: "Production", items: reportProductionItems },
      { section: "Sales", items: reportSalesItems },
      { section: "Logistics", items: reportLogisticsItems },
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
  group.section === "Master"
    ? {
        ...group,
        items: [...group.items].sort((a, b) => {
          if (isNavSubGroup(a) || isNavSubGroup(b)) return 0;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        }),
      }
    : group
);
export function Sidebar({ isOpen, onClose, isCollapsed }: SidebarProps) {
  const location = useLocation();
  const { hasAccess, user } = useAuth();
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [menuSearchTerm, setMenuSearchTerm] = useState("");
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [productions] = useData<Production>("productions", []);
  const [phpJobMaster] = useData<Production>("php_job_master", []);
  const [plateJobMaster] = useData<Production>("plate_job_master", []);
  const [materials] = useData<Material>("materials", []);
  const [orders] = useData<Order>("orders", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem, findItemAcrossSources, itemsBySource } = useOrderItemCatalog();
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
  const [phpLoadingSlips] = useData<LoadingSlip>("php_loading_slips", []);
  const [plateLoadingSlips] = useData<LoadingSlip>("plate_loading_slips", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [gatePasses] = useData<GatePass>("gate_passes", []);
  const [machines] = useData<Machine>("machines", []);
  const [processing] = useData<ProductionProcessing>("production_processing", []);
  const [settings] = useData<Setting>("settings", []);

  const [pendingJobClosureCount, setPendingJobClosureCount] = useState<number>(0);

  const refreshPendingJobClosureCount = useCallback(async () => {
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
      setPendingJobClosureCount(Array.isArray(rows) ? rows.length : 0);
    } catch {
      setPendingJobClosureCount(0);
    }
  }, []);

  useEffect(() => {
    void refreshPendingJobClosureCount();
  }, [refreshPendingJobClosureCount]);

  useAutoRefreshEffect(() => {
    void refreshPendingJobClosureCount();
  });

  const counts = useMemo(
    () =>
      buildPendingTaskCounts({
        materialIn,
        productions,
        phpJobMaster,
        plateJobMaster,
        materials,
        orders,
        npdItems,
        consumptions,
        materialIssues,
        materialIssueLines,
        materialIssueReelLines,
        materialReturns,
        materialReturnLines,
        materialReturnReelLines,
        sampleRequests,
        indents,
        indentLines,
        purchaseOrders,
        gateEntries,
        schedules,
        dispatchPlans,
        loadingSlips,
        phpLoadingSlips,
        plateLoadingSlips,
        invoices,
        gatePasses,
        machines,
        processing,
        settings,
        pendingJobClosureCount,
        user,
        resolveOrderItem,
        findItemAcrossSources,
        itemsBySource,
      }),
    [
      materialIn,
      productions,
      phpJobMaster,
      plateJobMaster,
      materials,
      orders,
      npdItems,
      consumptions,
      materialIssues,
      materialIssueLines,
      materialIssueReelLines,
      materialReturns,
      materialReturnLines,
      materialReturnReelLines,
      sampleRequests,
      indents,
      indentLines,
      purchaseOrders,
      gateEntries,
      schedules,
      dispatchPlans,
      loadingSlips,
      phpLoadingSlips,
      plateLoadingSlips,
      invoices,
      gatePasses,
      machines,
      processing,
      settings,
      pendingJobClosureCount,
      user,
      resolveOrderItem,
      findItemAcrossSources,
      itemsBySource,
    ]
  );

  const navigation = useMemo<NavGroup[]>(() => {
    if (user?.role === "TruckDriver") {
      return [
        {
          section: "Truck",
          color: "bg-blue-700",
          items: [{ name: "Truck Status Update", href: "/truck/status-update", icon: Truck }],
        },
      ];
    }
    if (user?.role !== "Operator") return NAVIGATION_WITH_SORTED_MASTERS;
    return [
      {
        section: "Jobs",
        color: "bg-emerald-700",
        items: [
          {
            section: "Production Processing",
            items: productionProcessingItems.filter((item) => item.name === "Pending Processing"),
          },
        ],
      },
    ];
  }, [user?.role]);

  const getVisibleEntries = useCallback(
    (entries: NavEntry[]): NavEntry[] =>
      entries.reduce<NavEntry[]>((visible, entry) => {
        if (isNavSubGroup(entry)) {
          const visibleItems = entry.items.filter((item) => hasAccess(item.href));
          if (visibleItems.length > 0) visible.push({ ...entry, items: visibleItems });
          return visible;
        }

        if (hasAccess(entry.href)) visible.push(entry);
        return visible;
      }, []),
    [hasAccess]
  );
  const filteredNavigation = useMemo<NavGroup[]>(() => {
    const q = menuSearchTerm.trim().toLowerCase();
    const matches = (value?: string) => String(value || "").toLowerCase().includes(q);

    return navigation.reduce<NavGroup[]>((groups, group) => {
      const visibleEntries = getVisibleEntries(group.items);
      if (visibleEntries.length === 0) return groups;
      if (!q || matches(group.section)) {
        groups.push({ ...group, items: visibleEntries });
        return groups;
      }

      const filteredEntries = visibleEntries.reduce<NavEntry[]>((entries, entry) => {
        if (isNavSubGroup(entry)) {
          if (matches(entry.section)) {
            entries.push(entry);
            return entries;
          }

          const matchingItems = entry.items.filter((item) => matches(item.name));
          if (matchingItems.length > 0) entries.push({ ...entry, items: matchingItems });
          return entries;
        }

        if (matches(entry.name)) entries.push(entry);
        return entries;
      }, []);

      if (filteredEntries.length > 0) groups.push({ ...group, items: filteredEntries });
      return groups;
    }, []);
  }, [getVisibleEntries, menuSearchTerm, navigation]);
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const group of navigation) {
      next[group.section] = true;
      group.items.forEach((entry) => {
        if (isNavSubGroup(entry)) next[`${group.section}/${entry.section}`] = true;
      });
    }
    setCollapsedSections(next);
  }, [navigation]);

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const currentlyCollapsed = !!prev[section];
      const nextCollapsed = !currentlyCollapsed;

      if (nextCollapsed) {
        return { ...prev, [section]: true };
      }

      const next = { ...prev };
      for (const group of navigation) next[group.section] = true;
      next[section] = false;
      return next;
    });
  };

  const toggleNestedSection = (sectionKey: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const isActiveItem = (item: NavItem) => {
    const itemUrl = new URL(item.href, window.location.origin);
    return (item.href === "/" && location.pathname === "/") ||
      (item.href !== "/" &&
        location.pathname === itemUrl.pathname &&
        (!itemUrl.search || location.search === itemUrl.search));
  };

  const renderNavLink = (item: NavItem, nested = false) => {
    const isActive = isActiveItem(item);
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
            : nested
              ? "bg-white/5 text-white hover:bg-black/20 hover:text-white font-medium"
              : "text-white hover:bg-black/20 hover:text-white font-medium",
          "group flex items-center justify-between rounded-sm py-1.5 text-[11px] transition-all whitespace-nowrap",
          isCollapsed ? "px-2" : nested ? "pl-4 pr-2" : "px-2"
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
          {!isCollapsed && (
            <span className="block max-w-[180px] overflow-x-auto whitespace-nowrap scrollbar-thin">
              {item.name}
            </span>
          )}
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
  };

  const renderNavEntry = (entry: NavEntry, groupSection: string) => {
    if (!isNavSubGroup(entry)) return renderNavLink(entry);

    const sectionKey = `${groupSection}/${entry.section}`;

    if (isCollapsed) {
      return (
        <div key={sectionKey} className="space-y-px">
          {entry.items.map((item) => renderNavLink(item, true))}
        </div>
      );
    }

    return (
      <div key={sectionKey} className="rounded bg-black/10 py-0.5">
        <button
          type="button"
          onClick={() => toggleNestedSection(sectionKey)}
          className={cn(
            "flex w-full items-center justify-between rounded px-2 py-1 text-left text-[10px] font-black uppercase tracking-wide hover:bg-black/10",
            menuSearchTerm.trim() || !collapsedSections[sectionKey] ? "bg-red-600 text-white shadow-inner" : "text-white/80"
          )}
        >
          <span className="max-w-[190px] overflow-hidden text-ellipsis whitespace-nowrap">{entry.section}</span>
          {menuSearchTerm.trim() || !collapsedSections[sectionKey] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <div className={cn("mt-0.5 space-y-px", !menuSearchTerm.trim() && collapsedSections[sectionKey] && "hidden")}>
          {entry.items.map((item) => renderNavLink(item, true))}
        </div>
      </div>
    );
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
      <nav className="flex-1 space-y-3 overflow-x-auto overflow-y-auto px-2 py-4 border-r border-white/5">
        {!isCollapsed && (
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/50" aria-hidden="true" />
            <input
              type="text"
              value={menuSearchTerm}
              onChange={(event) => setMenuSearchTerm(event.target.value)}
              placeholder="Search menu..."
              className="w-full rounded border border-white/20 bg-white/10 py-2 pl-9 pr-3 text-[11px] font-semibold text-white placeholder:text-white/50 outline-none focus:border-white/70 focus:bg-white/15"
            />
          </div>
        )}
        {filteredNavigation.length === 0 && !isCollapsed ? (
          <div className="rounded border border-white/10 bg-white/5 px-3 py-3 text-[11px] font-semibold text-white/70">
            No menu found
          </div>
        ) : null}
        {filteredNavigation.map((group) => {
          const visibleEntries = group.items;

          return (
            <div key={group.section} className={cn("p-1 rounded flex flex-col border border-white/10", group.color)}>
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleSection(group.section)}
                  className="mb-1 flex w-full items-center justify-between rounded px-1 pt-0.5 pb-1 text-left text-[10px] font-bold uppercase tracking-wider text-white/70 hover:bg-black/10"
                >
                  <span className="whitespace-nowrap">{group.section}</span>
                  {menuSearchTerm.trim() || !collapsedSections[group.section] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : null}
              <div className={cn("space-y-1", !isCollapsed && !menuSearchTerm.trim() && collapsedSections[group.section] && "hidden")}>
                {visibleEntries.map((entry) => renderNavEntry(entry, group.section))}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

