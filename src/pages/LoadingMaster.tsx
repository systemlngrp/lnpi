import React, { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { 
  LoadingSlip, 
  LoadingSlipAllocation,
  Truck, 
  DispatchPlan,
  Order,
  Company,
  Invoice,
  InvoiceLineItem,
  Setting
} from "../types";
import { 
  Search, 
  FileText, 
  Plus,
  ChevronDown,
  ChevronRight,
  Download
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { formatDate } from "../lib/serial";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { buildLinkedLoadingDetailsFromSlip } from "../lib/linkedLoading";
import { upsertFgLinkedChildSlip } from "../lib/linkedLoadingSlipSync";
import { downloadLoadingSlipPdf } from "../lib/loadingSlipPdf";
import { buildPhpPlateStockAlertMessage, getPhpPlateStockShortages } from "../lib/phpPlateStockValidation";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { DirectLoadingSlipModal } from "../components/DirectLoadingSlipModal";
import { isDirectLoadingSlip, resolveLoadingSlipLineContext, summarizeLoadingSlip } from "../lib/loadingSlipContext";

function getSlipNoSortValue(slipNo: string) {
  const value = String(slipNo || "").trim();
  const match = value.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : 0;
}

export function LoadingMaster() {
  const [loadingSlips, setLoadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [trucks] = useData<Truck>("trucks", []);
  const [plans, setPlans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem, itemsBySource, allItems } = useOrderItemCatalog();
  const [companies] = useData<Company>("companies", []);
  const [invoices, setInvoices] = useData<Invoice>("invoices", []);
  const [invoiceLineItems, setInvoiceLineItems] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [phpJobs] = useData<any>("php_job_master", []);
  const [plateJobs] = useData<any>("plate_job_master", []);
  const [phpItemMaster] = useData<any>("php_item_master", []);
  const [plateItemMaster] = useData<any>("plate_item_master", []);
  const [phpLoadingSlips, setPhpLoadingSlips] = useData<LoadingSlip>("php_loading_slips", []);
  const [plateLoadingSlips, setPlateLoadingSlips] = useData<LoadingSlip>("plate_loading_slips", []);
  const [settings] = useData<Setting>("settings", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [erpFilter, setErpFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [expandedSlipIds, setExpandedSlipIds] = useState<Set<string>>(new Set());
  const [editingSlipIds, setEditingSlipIds] = useState<Set<string>>(new Set());
  const [draftBySlipId, setDraftBySlipId] = useState<Record<string, LoadingSlip>>({});
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isDirectModalOpen, setIsDirectModalOpen] = useState(false);
  const [isSavingDirect, setIsSavingDirect] = useState(false);

  const getTruckNo = (slip: LoadingSlip) => String(slip.truckNo || trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "-").trim() || "-";

  const companyOptions = useMemo(() => {
    const names = new Set<string>();
    loadingSlips.forEach((slip) => {
      summarizeLoadingSlip({ slip, plans, orders, companies, resolveOrderItem }).companyNames.forEach((name) => {
        if (name) names.add(name);
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((name) => ({ value: name, label: name }));
  }, [loadingSlips, plans, orders, companies, resolveOrderItem]);

  const erpOptions = useMemo(() => {
    const codes = new Set<string>();
    loadingSlips.forEach((slip) => {
      summarizeLoadingSlip({ slip, plans, orders, companies, resolveOrderItem }).erpCodes.forEach((code) => {
        if (code) codes.add(code);
      });
    });
    return Array.from(codes).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((code) => ({ value: code, label: code }));
  }, [loadingSlips, plans, orders, companies, resolveOrderItem]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; searchText: string }>();
    loadingSlips.forEach((slip) => {
      summarizeLoadingSlip({ slip, plans, orders, companies, resolveOrderItem }).lineContexts.forEach((ctx) => {
        const itemName = String(ctx.itemName || "").trim();
        const erp = String(ctx.erpCode || "").trim();
        const key = itemName || erp ? `${itemName}::${erp}` : "";
        if (!key || map.has(key)) return;
        const label = !itemName ? erp : !erp || itemName.toLowerCase().includes(erp.toLowerCase()) ? itemName : `${itemName} - ${erp}`;
        map.set(key, { value: key, label, searchText: `${itemName} ${erp}` });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [loadingSlips, plans, orders, companies, resolveOrderItem]);
  const processedSlips = useMemo(() => {
    return loadingSlips.map((slip) => {
      const totalQty = slip.lines.reduce((sum, line) => sum + Number(line.loadedQty || 0), 0);
      const summary = summarizeLoadingSlip({ slip, plans, orders, companies, resolveOrderItem });
      return {
        ...slip,
        totalQty,
        itemNames: summary.itemNames.join(", "),
        companyNames: summary.companyNames.join(", "),
        erpCodes: summary.erpCodes.join(", "),
        itemKeys: summary.lineContexts.map((ctx) => `${ctx.itemName || ""}::${ctx.erpCode || ""}`),
        loadingSourceLabel: isDirectLoadingSlip(slip) ? "Direct" : "Dispatch Plan",
        truckNo: getTruckNo(slip),
      };
    }).filter(slip => {
      const q = searchTerm.toLowerCase().trim();
      const matchesSearch = !q || slip.slipNo.toLowerCase().includes(q) || slip.truckNo.toLowerCase().includes(q) || slip.itemNames.toLowerCase().includes(q) || slip.companyNames.toLowerCase().includes(q) || slip.erpCodes.toLowerCase().includes(q);
      const matchesCompany = !companyFilter || slip.companyNames.includes(companyFilter);
      const matchesErp = !erpFilter || slip.erpCodes.includes(erpFilter);
      const matchesItem = !itemFilter || slip.itemKeys.includes(itemFilter);
      
      return matchesSearch && matchesCompany && matchesErp && matchesItem;
    }).sort((a, b) => {
      const slipNoDiff = getSlipNoSortValue(b.slipNo) - getSlipNoSortValue(a.slipNo);
      if (slipNoDiff !== 0) return slipNoDiff;

      const textDiff = String(b.slipNo || "").localeCompare(String(a.slipNo || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (textDiff !== 0) return textDiff;

      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [loadingSlips, plans, orders, companies, resolveOrderItem, searchTerm, companyFilter, erpFilter, itemFilter, trucks]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedSlips,
  } = useClientPagination(processedSlips, 25);

  const handleDownloadPdf = async (slip: LoadingSlip) => {
    setIsDownloading(slip.id);
    try {
      const orgSetting = settings[0];
      await downloadLoadingSlipPdf({
        slip,
        setting: orgSetting,
        trucks,
        plans,
        orders,
        npdItems,
        companies
      });
    } catch (err) {
      console.error("Failed to download PDF:", err);
      alert("Failed to generate PDF. Please check console for details.");
    } finally {
      setIsDownloading(null);
    }
  };

  const getSlipLines = (slip: LoadingSlip) =>
    slip.lines.map((line) => {
      const context = resolveLoadingSlipLineContext({ slip, line, plans, orders, companies, resolveOrderItem });
      const plannedQty = Number(context.plan?.plannedQty || 0);
      const cancelledQty = Number(context.plan?.canceledQty || 0);
      const maxAllowed = context.isDirect ? Number.MAX_SAFE_INTEGER : Math.max(0, plannedQty - cancelledQty);
      return {
        ...line,
        ...context,
        plannedQty,
        maxAllowed,
      };
    });

  const toggleSlip = (id: string) => {
    setExpandedSlipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (slip: LoadingSlip) => {
    if (slip.status === "Cancelled") {
      alert("Cancelled slip cannot be edited.");
      return;
    }
    if (slip.invoiceId) {
      alert("Invoiced loading slips cannot be edited.");
      return;
    }
    setEditingSlipIds((prev) => new Set(prev).add(slip.id));
    setDraftBySlipId((prev) => ({ ...prev, [slip.id]: JSON.parse(JSON.stringify(slip)) }));
    setExpandedSlipIds((prev) => new Set(prev).add(slip.id));
  };

  const cancelEdit = (slipId: string) => {
    setEditingSlipIds((prev) => {
      const next = new Set(prev);
      next.delete(slipId);
      return next;
    });
    setDraftBySlipId((prev) => {
      const next = { ...prev };
      delete next[slipId];
      return next;
    });
  };

  const getAllocationTotal = (allocations?: LoadingSlipAllocation[]) =>
    (allocations || []).reduce((sum, a) => sum + Number(a.qty || 0), 0);

  const validateSlipDraft = (draft: LoadingSlip) => {
    const errors: string[] = [];
    const lines = getSlipLines(draft);
    lines.forEach((line, index) => {
      const loadedQty = Number(line.loadedQty || 0);
      if (loadedQty < 0) errors.push(`Line ${index + 1}: Loaded qty cannot be negative.`);
      if (!line.isDirect && loadedQty > line.maxAllowed) errors.push(`Line ${index + 1}: Loaded qty cannot exceed ${line.maxAllowed}.`);
      if (!line.isDirect) {
        const allocTotal = getAllocationTotal(line.allocations);
        if (Math.abs(allocTotal - loadedQty) > 0.0001) errors.push(`Line ${index + 1}: Allocations must equal Loaded qty.`);
        (line.allocations || []).forEach((a) => {
          if (Number(a.qty || 0) < 0) errors.push(`Line ${index + 1}: Allocation qty cannot be negative.`);
        });
      }
    });
    return errors;
  };

  const saveEdit = async (slipId: string) => {
    const original = loadingSlips.find((s) => s.id === slipId);
    const draft = draftBySlipId[slipId];
    if (!original || !draft) return;
    if (original.status === "Cancelled") {
      alert("Cancelled slip cannot be edited.");
      return;
    }

    const errors = validateSlipDraft(draft);
    if (errors.length > 0) {
      alert(errors[0]);
      return;
    }

    const now = new Date().toISOString();
    const direct = isDirectLoadingSlip(original);

    if (original.invoiceId && !direct) {
      const invoice = invoices.find((inv) => inv.id === original.invoiceId);
      if (!invoice) {
        alert("Linked invoice not found. Cannot save changes.");
        return;
      }
    }

    const originalByPlan = new Map(original.lines.map((l) => [l.dispatchPlanId, Number(l.loadedQty || 0)]));
    const draftByPlan = new Map(draft.lines.map((l) => [l.dispatchPlanId, Number(l.loadedQty || 0)]));
    const allPlanIds = new Set<string>([...originalByPlan.keys(), ...draftByPlan.keys()]);
    const phpDetails = buildLinkedLoadingDetailsFromSlip({
      slip: draft,
      source: "PHP",
      plans,
      orders,
      resolveOrderItem,
      sourceItems: itemsBySource.PHP || [],
      existingDetails: draft.phpDetails,
    });
    const plateDetails = buildLinkedLoadingDetailsFromSlip({
      slip: draft,
      source: "PLATE",
      plans,
      orders,
      resolveOrderItem,
      sourceItems: itemsBySource.PLATE || [],
      existingDetails: draft.plateDetails,
    });
    const syncedDraft: LoadingSlip = {
      ...draft,
      phpDetails,
      plateDetails,
    };
    const shortages = getPhpPlateStockShortages({
      phpDetails,
      plateDetails,
      phpMasterRows: phpItemMaster,
      plateMasterRows: plateItemMaster,
      phpJobs,
      plateJobs,
      fgLoadingSlips: loadingSlips,
      phpLoadingSlips,
      plateLoadingSlips,
      parentFgLoadingId: original.id,
    });
    if (shortages.length > 0) {
      alert(buildPhpPlateStockAlertMessage(shortages));
      return;
    }

    if (!direct) {
      await setPlans((prev) =>
        prev.map((plan) => {
          if (!allPlanIds.has(plan.id)) return plan;
          const delta = (draftByPlan.get(plan.id) || 0) - (originalByPlan.get(plan.id) || 0);
          if (Math.abs(delta) < 0.0001) return plan;
          return { ...plan, loadedQty: Math.max(0, Number(plan.loadedQty || 0) + delta), updateTimestamp: now, updatedBy: "System User" };
        })
      );
    }

    await setLoadingSlips((prev) =>
      prev.map((s) =>
        s.id === slipId ? { ...syncedDraft, updatedBy: "System User", updateTimestamp: now } : s
      )
    );
    await setPhpLoadingSlips((prev) => upsertFgLinkedChildSlip({ prevSlips: prev, parentSlip: syncedDraft, details: phpDetails, source: "PHP" }));
    await setPlateLoadingSlips((prev) => upsertFgLinkedChildSlip({ prevSlips: prev, parentSlip: syncedDraft, details: plateDetails, source: "PLATE" }));

    if (original.invoiceId && !direct) {
      const invoiceId = original.invoiceId;
      const invoice = invoices.find((inv) => inv.id === invoiceId);
      if (!invoice) return;

      const isInterState = (companies.find((c) => c.id === invoice.companyId)?.gstSupplyType || "INTRA_STATE") === "INTER_STATE";

      const qtyByItemId = new Map<string, number>();
      draft.lines.forEach((line) => {
        const plan = plans.find((p) => p.id === line.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        if (!order?.itemId) return;
        qtyByItemId.set(order.itemId, (qtyByItemId.get(order.itemId) || 0) + Number(line.loadedQty || 0));
      });

      const hadSlipLineItems = invoiceLineItems.some((li) => li.invoiceId === invoiceId && li.loadingSlipId === slipId);

      const nextInvoiceLineItems = invoiceLineItems
        .map((li) => {
          if (li.invoiceId !== invoiceId || li.loadingSlipId !== slipId) return li;
          const nextQty = Number(qtyByItemId.get(li.itemId) || 0);
          const nextAmount = nextQty * Number(li.rate || 0);
          const taxAmount = (nextAmount * Number(li.gstRate || 0)) / 100;
          return {
            ...li,
            qty: nextQty,
            amount: nextAmount,
            cgst: isInterState ? 0 : taxAmount / 2,
            sgst: isInterState ? 0 : taxAmount / 2,
            igst: isInterState ? taxAmount : 0,
          };
        })
        .filter((li) => !(li.invoiceId === invoiceId && li.loadingSlipId === slipId && Number(li.qty || 0) <= 0));

      await setInvoiceLineItems(nextInvoiceLineItems);

      const allForInvoice = nextInvoiceLineItems.filter((li) => li.invoiceId === invoiceId);
      const totals = allForInvoice.reduce(
        (acc, li) => {
          acc.totalBeforeGst += Number(li.amount || 0);
          acc.cgst += Number(li.cgst || 0);
          acc.sgst += Number(li.sgst || 0);
          acc.igst += Number(li.igst || 0);
          return acc;
        },
        { totalBeforeGst: 0, cgst: 0, sgst: 0, igst: 0 }
      );

      const roundOff = Number(invoice.roundOff || 0);
      const otherCharges = Number(invoice.otherCharges || 0);
      const nextTotalAfterGst = totals.totalBeforeGst + totals.cgst + totals.sgst + totals.igst;

      await setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invoiceId
            ? {
                ...inv,
                totalBeforeGst: totals.totalBeforeGst,
                cgst: totals.cgst,
                sgst: totals.sgst,
                igst: totals.igst,
                totalAfterGst: nextTotalAfterGst,
                otherCharges,
                roundOff,
                updatedBy: "System User",
                updateTimestamp: now,
              }
            : inv
        )
      );

      if (!hadSlipLineItems) {
        alert("Saved. Note: no existing invoice line items were found for this slip; invoice totals were recomputed from remaining items.");
      }
    }

    cancelEdit(slipId);
  };

  const cancelSlip = async (slip: LoadingSlip) => {
    if (slip.invoiceId) {
      alert("Cannot cancel a slip after invoice is created.");
      return;
    }
    if (slip.status === "Cancelled") return;

    const reason = window.prompt("Cancel reason (optional)") || "";
    const confirmed = window.confirm(isDirectLoadingSlip(slip) ? "Cancel this direct loading slip? Linked PHP/Plate child slips will also be cancelled." : "Cancel this loading slip? This will reverse loaded qty from dispatch plans.");
    if (!confirmed) return;

    const now = new Date().toISOString();
    if (!isDirectLoadingSlip(slip)) {
      const byPlan = new Map(slip.lines.map((l) => [l.dispatchPlanId, Number(l.loadedQty || 0)]));
      await setPlans((prev) =>
        prev.map((plan) => {
          if (!byPlan.has(plan.id)) return plan;
          const qty = byPlan.get(plan.id) || 0;
          return { ...plan, loadedQty: Math.max(0, Number(plan.loadedQty || 0) - qty), updateTimestamp: now, updatedBy: "System User" };
        })
      );
    }

    await setLoadingSlips((prev) =>
      prev.map((row) =>
        row.id === slip.id
          ? { ...row, status: "Cancelled" as const, cancelReason: reason, cancelledAt: now, cancelledBy: "System User", updatedBy: "System User", updateTimestamp: now }
          : row
      )
    );
    await setPhpLoadingSlips((prev) =>
      prev.map((row) =>
        String(row.fgLoadingId || "").trim() === slip.id
          ? { ...row, status: "Cancelled" as const, cancelReason: reason || "Cancelled from parent FG loading slip", cancelledAt: now, cancelledBy: "System User", updatedBy: "System User", updateTimestamp: now }
          : row
      )
    );
    await setPlateLoadingSlips((prev) =>
      prev.map((row) =>
        String(row.fgLoadingId || "").trim() === slip.id
          ? { ...row, status: "Cancelled" as const, cancelReason: reason || "Cancelled from parent FG loading slip", cancelledAt: now, cancelledBy: "System User", updatedBy: "System User", updateTimestamp: now }
          : row
      )
    );
  };

  const saveDirectSlip = async ({ slip, phpDetails, plateDetails }: { slip: LoadingSlip; phpDetails: LoadingSlip["phpDetails"]; plateDetails: LoadingSlip["plateDetails"] }) => {
    setIsSavingDirect(true);
    try {
      const timestamp = new Date().toISOString();
      const newSlip: LoadingSlip = {
        ...slip,
        id: crypto.randomUUID(),
        slipNo: "",
        loadingSource: "DIRECT",
        phpDetails,
        plateDetails,
        updatedBy: "System User",
        updateTimestamp: timestamp,
      };
      const shortages = getPhpPlateStockShortages({
        phpDetails: phpDetails || [],
        plateDetails: plateDetails || [],
        phpMasterRows: phpItemMaster,
        plateMasterRows: plateItemMaster,
        phpJobs,
        plateJobs,
        fgLoadingSlips: loadingSlips,
        phpLoadingSlips,
        plateLoadingSlips,
        parentFgLoadingId: newSlip.id,
      });
      if (shortages.length > 0) {
        alert(buildPhpPlateStockAlertMessage(shortages));
        return;
      }
      await setLoadingSlips((prev) => [newSlip, ...prev]);
      await setPhpLoadingSlips((prev) => upsertFgLinkedChildSlip({ prevSlips: prev, parentSlip: newSlip, details: phpDetails || [], source: "PHP" }));
      await setPlateLoadingSlips((prev) => upsertFgLinkedChildSlip({ prevSlips: prev, parentSlip: newSlip, details: plateDetails || [], source: "PLATE" }));
      setIsDirectModalOpen(false);
      alert("Direct loading slip created successfully.");
    } catch (error) {
      console.error("Failed to save direct loading slip:", error);
      alert("Failed to save direct loading slip.");
    } finally {
      setIsSavingDirect(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-black uppercase tracking-tight">Loading Master</h2>
        </div>
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Search slip no..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
          <button type="button" onClick={() => setIsDirectModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded border border-black bg-black px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-slate-800">
            <Plus size={16} />
            Direct Loading Slip
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-50 border border-black rounded p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-500">Company Filter</label>
            <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-500">Item Filter</label>
            <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-500">ERP Filter</label>
            <Select value={erpFilter} onChange={setErpFilter} options={erpOptions} placeholder="All ERP" />
          </div>
        </div>
      </div>

      <div className="bg-white border-2 border-black rounded shadow-sm table-frozen-scroll">
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-30 bg-slate-100">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Slip No</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Source</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Status</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Date</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Truck</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Company</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">Item</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-black uppercase tracking-wider border-b border-black">ERP</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border-b border-black">Total Qty</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-black uppercase tracking-wider border-b border-black">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-black">
            {paginatedSlips.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-slate-500 italic">No loading slips found.</td>
              </tr>
) : paginatedSlips.map((slip) => (
              <tr key={slip.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <FileText size={16} className="text-indigo-600 mr-2" />
                    <span className="font-bold text-sm">{slip.slipNo}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase ${isDirectLoadingSlip(slip) ? "border-sky-700 bg-sky-100 text-sky-800" : "border-violet-700 bg-violet-100 text-violet-800"}`}>
                    {slip.loadingSourceLabel}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {slip.status === "Cancelled" ? (
                    <span className="rounded border border-red-700 bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-800">
                      Cancelled
                    </span>
                  ) : slip.invoiceId ? (
                    <span className="rounded border border-emerald-700 bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800">
                      Invoiced
                    </span>
                  ) : (
                    <span className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700">
                      Not Invoiced
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {formatDate(slip.date)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold uppercase text-black">
                  {slip.truckNo || "-"}
                </td>
                <td className="px-6 py-4 text-sm text-black align-top">
                  <div className="max-w-[240px] whitespace-normal break-words font-medium leading-5" title={slip.companyNames}>
                    {slip.companyNames || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 align-top">
                  <div className="max-w-[280px] whitespace-normal break-words leading-5" title={slip.itemNames}>
                    {slip.itemNames || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  <div className="max-w-[100px] truncate font-bold uppercase tracking-tight" title={slip.erpCodes}>
                    {slip.erpCodes || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-indigo-600">
                  {slip.totalQty.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <div className="flex justify-end items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(slip)}
                      disabled={isDownloading === slip.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-indigo-600 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors uppercase disabled:opacity-50"
                      title="Download PDF"
                    >
                      {isDownloading === slip.id ? <Spinner size={14} /> : <Download size={14} />}
                      PDF
                    </button>
                    {slip.status !== "Cancelled" ? (
                      <button
                        type="button"
                        onClick={() => startEdit(slip)}
                        disabled={!!slip.invoiceId}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-50 transition-colors uppercase disabled:opacity-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        title={slip.invoiceId ? "Invoiced slip cannot be edited" : "Edit loading slip"}
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSlip(slip.id)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-50 transition-colors uppercase"
                        title="Open slip details"
                      >
                        Open
                      </button>
                    )}
                    <button 
                      type="button"
                      onClick={() => toggleSlip(slip.id)}
                      className="text-indigo-600 hover:text-indigo-900 font-bold uppercase flex items-center justify-end gap-1"
                    >
                      {expandedSlipIds.has(slip.id) ? "Hide" : "Details"}{" "}
                      {expandedSlipIds.has(slip.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {paginatedSlips.map((slip) => {
              const isExpanded = expandedSlipIds.has(slip.id);
              if (!isExpanded) return null;
              const draft = draftBySlipId[slip.id] || slip;
              const isEditing = editingSlipIds.has(slip.id);
              const lines = getSlipLines(draft);
              return (
                <tr key={`${slip.id}-details`} className="bg-white">
                  <td colSpan={10} className="px-6 pb-6 pt-2 border-t border-black">
                    <div className="rounded border border-black overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3 border-b border-black">
                        <div className="text-sm font-bold text-black">
                          Slip {slip.slipNo} - Date {formatDate(slip.date)}
                        </div>
                        <div className="flex items-center gap-2">
                          {slip.status !== "Cancelled" ? (
                            isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void saveEdit(slip.id)}
                                  className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-emerald-600 text-white hover:bg-emerald-700"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelEdit(slip.id)}
                                  className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-100"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(slip)}
                                  className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-100"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void cancelSlip(slip)}
                                  className="px-3 py-1.5 text-xs font-bold border border-red-700 rounded bg-red-100 text-red-800 hover:bg-red-200"
                                >
                                  Cancel Slip
                                </button>
                              </>
                            )
                          ) : null}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-black border-collapse">
                          <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
                            <tr className="divide-x divide-black">
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Company</th>
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Order No</th>
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Item</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase border border-black">Planned</th>
                              <th className="px-4 py-2 text-right text-xs font-bold uppercase border border-black">Loaded</th>
                              <th className="px-4 py-2 text-left text-xs font-bold uppercase border border-black">Allocations</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black bg-white">
                            {lines.map((line, idx) => {
                              const loadedValue = Number(line.loadedQty || 0);
                              const allocTotal = getAllocationTotal(line.allocations);
                              const balanced = line.isDirect || Math.abs(allocTotal - loadedValue) < 0.0001;
                              return (
                                <tr key={`${slip.id}-${idx}`} className="divide-x divide-black">
                                  <td className="px-4 py-3 text-xs border border-black">{line.companyName}</td>
                                  <td className="px-4 py-3 text-xs border border-black">{line.orderNo}</td>
                                  <td className="px-4 py-3 text-xs border border-black">{line.itemName}</td>
                                  <td className="px-4 py-3 text-xs text-right border border-black">{line.isDirect ? "-" : Number(line.plannedQty || 0).toLocaleString()}</td>
                                  <td className="px-4 py-3 text-xs text-right border border-black">
                                    {isEditing ? (
                                      <input
                                        type="number"
                                        min={0}
                                        max={line.maxAllowed}
                                        value={loadedValue}
                                        onChange={(e) => {
                                          const next = e.target.value === "" ? 0 : Math.max(0, Math.min(Number(e.target.value), line.maxAllowed));
                                          setDraftBySlipId((prev) => {
                                            const draftSlip = prev[slip.id];
                                            if (!draftSlip) return prev;
                                            const nextSlip: LoadingSlip = JSON.parse(JSON.stringify(draftSlip));
                                            const lineToUpdate = nextSlip.lines.find((l) => l.dispatchPlanId === line.dispatchPlanId);
                                            if (lineToUpdate) lineToUpdate.loadedQty = next;
                                            return { ...prev, [slip.id]: nextSlip };
                                          });
                                        }}
                                        className="w-24 rounded border border-black bg-yellow-200 px-2 py-1 text-xs text-right font-bold"
                                      />
                                    ) : (
                                      <span className="font-bold text-indigo-700">{loadedValue.toLocaleString()}</span>
                                    )}
                                    {!balanced ? <div className="text-[10px] font-bold text-red-600">Alloc != Loaded</div> : null}
                                  </td>
                                  <td className="px-4 py-3 text-xs border border-black">
                                    {line.isDirect ? (
                                      <span className="font-bold text-sky-700">Direct Loading</span>
                                    ) : Array.isArray(line.allocations) && line.allocations.length > 0 ? (
                                      <div className="space-y-1">
                                        {line.allocations.map((a, aidx) => (
                                          <div key={aidx} className="flex items-center gap-2">
                                            <span className="font-bold">
                                              {a.sourceType === "job" ? a.jobNo : (a as any).sourceRef}
                                            </span>
                                            {isEditing ? (
                                              <input
                                                type="number"
                                                min={0}
                                                value={Number(a.qty || 0)}
                                                onChange={(e) => {
                                                  const nextQty = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
                                                  setDraftBySlipId((prev) => {
                                                    const draftSlip = prev[slip.id];
                                                    if (!draftSlip) return prev;
                                                    const nextSlip: LoadingSlip = JSON.parse(JSON.stringify(draftSlip));
                                                    const lineToUpdate = nextSlip.lines.find((l) => l.dispatchPlanId === line.dispatchPlanId);
                                                    if (lineToUpdate?.allocations?.[aidx]) lineToUpdate.allocations[aidx].qty = nextQty as any;
                                                    return { ...prev, [slip.id]: nextSlip };
                                                  });
                                                }}
                                                className="w-20 rounded border border-black bg-yellow-200 px-2 py-1 text-xs text-right font-bold"
                                              />
                                            ) : (
                                              <span className="text-slate-700">{Number(a.qty || 0).toLocaleString()}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-500">-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {slip.status !== "Cancelled" && isEditing ? (
                        <div className="flex justify-end gap-3 border-t border-black bg-slate-50 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => cancelEdit(slip.id)}
                            className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-white hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEdit(slip.id)}
                            className="px-3 py-1.5 text-xs font-bold border border-black rounded bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            Save
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <DirectLoadingSlipModal
        open={isDirectModalOpen}
        companies={companies}
        trucks={trucks}
        allItems={allItems}
        plans={plans}
        orders={orders}
        phpItems={itemsBySource.PHP || []}
        plateItems={itemsBySource.PLATE || []}
        resolveOrderItem={resolveOrderItem}
        onClose={() => !isSavingDirect && setIsDirectModalOpen(false)}
        onSave={saveDirectSlip}
      />
    </div>
  );
}
