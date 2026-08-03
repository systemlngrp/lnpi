import React, { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
  LoadingSlip, 
  Company, 
  Invoice, 
  InvoiceLineItem,
  GatePass,
  DispatchPlan,
  Order,
  Truck
} from "../types";
import {
  FileText, 
  Search, 
  Check, 
  X, 
  ChevronRight, 
  ChevronDown,
  Receipt,
  Building2,
  Package,
  Plus,
  Truck as TruckIcon
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { normalizeOrderItemSource } from "../lib/orderItems";
import { buildGatePassFromInvoice } from "../lib/gatePasses";
import { useAutoRefreshPause } from "../hooks/useAutoRefresh";
import { useAuth } from "../auth/AuthContext";

interface GroupedLoading {
  companyId: string;
  companyName: string;
  slips: (LoadingSlip & {
    totalQty: number;
    items: string[];
    itemKeys: string[];
  })[];
}

interface InvoiceAllocationRow {
  id: string;
  orderId: string;
  qty: number;
}

const DIRECT_ALLOCATION_ID = "__DIRECT__";

interface InvoiceItemRow {
  id: string;
  itemId: string;
  itemSource: "FG" | "PHP" | "PLATE" | "MATERIAL";
  itemName: string;
  gstRate: number;
  defaultRate: number;
  totalQty: number;
  sources: Array<{ loadingSlipId: string; qty: number }>;
  allocations: InvoiceAllocationRow[];
}

const roundHalfUp = (value: number, decimals: number) => {
  const numeric = Number(value) || 0;
  const factor = 10 ** decimals;
  return (numeric < 0 ? -1 : 1) * Math.round((Math.abs(numeric) + 1e-9) * factor) / factor;
};

const roundMoney = (value: number) => roundHalfUp(value, 2);
const roundWhole = (value: number) => roundHalfUp(value, 0);
const OTHER_CHARGES_GST_RATES = [5, 12, 18, 28];

const calculateRoundedInvoiceLine = (qty: number, rate: number, gstRate: number, isInterState: boolean) => {
  const amount = roundMoney(Number(qty || 0) * Number(rate || 0));
  if (isInterState) {
    const taxAmount = roundMoney((amount * Number(gstRate || 0)) / 100);
    return { amount, cgst: 0, sgst: 0, igst: taxAmount };
  }

  const halfTax = roundMoney((amount * Number(gstRate || 0)) / 100 / 2);
  return { amount, cgst: halfTax, sgst: halfTax, igst: 0 };
};

function toPersistableLoadingSlip(slip: LoadingSlip & { totalQty?: number; items?: string[]; itemKeys?: string[] }): LoadingSlip {
  const { totalQty: _totalQty, items: _items, itemKeys: _itemKeys, ...persistableSlip } = slip;
  return persistableSlip;
}

export function PendingInvoicing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadingSlips, , , loadingSlipApi] = useData<LoadingSlip>("loading_slips", []);
  const [companies] = useData<Company>("companies", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem, findItemAcrossSources } = useOrderItemCatalog();
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [orders] = useData<Order>("orders", []);
  const [invoices, , , invoiceApi] = useData<Invoice>("invoices", []);
  const [invoiceLineItems, , , invoiceLineItemApi] = useData<InvoiceLineItem>("invoice_line_items", []);
  const [gatePasses, , , gatePassApi] = useData<GatePass>("gate_passes", []);
  const [trucks] = useData<Truck>("trucks", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);
  const [billingMode, setBillingMode] = useState<string | null>(null);
  const [selectedSlips, setSelectedSlips] = useState<Set<string>>(new Set());
  
  const [invoiceModal, setInvoiceModal] = useState<{
    companyId: string;
    slips: any[];
  } | null>(null);
  
  const [invoiceRows, setInvoiceRows] = useState<InvoiceItemRow[]>([]);
  const [gstSupplyType, setGstSupplyType] = useState<"" | "INTRA_STATE" | "INTER_STATE">("");
  const [otherCharges, setOtherCharges] = useState<number | "">("");
  const [otherChargesGstRate, setOtherChargesGstRate] = useState<number | "">("");
  const [roundOff, setRoundOff] = useState<number | "">("");
  const [isRoundOffManual, setIsRoundOffManual] = useState(false);
  const [destination, setDestination] = useState("");
  const [transporter, setTransporter] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editInvoiceId = String(searchParams.get("editInvoiceId") || "").trim();
  const currentUserEmail = String(user?.email || "").trim().toLowerCase();
  const isPankajUser = currentUserEmail === "pankaj@bizskilledu.com";

  useAutoRefreshPause(
    Boolean(billingMode) ||
    selectedSlips.size > 0 ||
    invoiceModal !== null ||
    isSubmitting
  );

  const getAuthHeaders = () => {
    const token = window.localStorage.getItem("authToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const postEntity = async (entity: string, payload: unknown) => {
    const response = await fetch(`/api/${entity.replace(/_/g, "-")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to save ${entity}`);
    }
  };

  const fetchEntities = async <T,>(entity: string): Promise<T[]> => {
    const response = await fetch(`/api/${entity.replace(/_/g, "-")}`, {
      headers: { ...getAuthHeaders() },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch ${entity}`);
    }
    const result = await response.json();
    return Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
  };

  const deleteEntity = async (entity: string, id: string) => {
    const response = await fetch(`/api/${entity.replace(/_/g, "-")}/${id}`, {
      method: "DELETE",
      headers: { ...getAuthHeaders() },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to delete ${entity}`);
    }
  };

  const toggleCompany = (id: string) => {
    const next = new Set(expandedCompanies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedCompanies(next);
  };

  const getMeaningfulItemName = (value: unknown) => {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    const lower = normalized.toLowerCase();
    if (lower === "unknown" || lower === "item") return "";
    return normalized;
  };

  const resolveSlipLineItem = (line: LoadingSlip["lines"][number], order?: Order) => {
    const itemSource = normalizeOrderItemSource(line.itemSource || order?.itemSource || "FG");
    const directItemId = String(line.itemId || order?.itemId || "").trim();
    const directErp = String(line.erpCode || line.masterErp || order?.erpCode || "").trim();

    return (
      findItemAcrossSources(directItemId, itemSource, directErp) ||
      resolveOrderItem(order) ||
      undefined
    );
  };

  const resolveSlipLineItemName = (line: LoadingSlip["lines"][number], order?: Order) => {
    const resolvedItem = resolveSlipLineItem(line, order);
    return (
      getMeaningfulItemName(resolvedItem?.name) ||
      getMeaningfulItemName(line.itemName) ||
      getMeaningfulItemName(line.erpCode) ||
      getMeaningfulItemName(line.masterErp) ||
      "Unknown"
    );
  };

  const resolveCanonicalSlipLineItemId = (line: LoadingSlip["lines"][number], order?: Order) => {
    const resolvedItem = resolveSlipLineItem(line, order);
    return String(resolvedItem?.id || line.itemId || order?.itemId || "").trim();
  };

  const getSlipLineKey = (line: LoadingSlip["lines"][number], order?: Order) => {
    const itemSource = normalizeOrderItemSource(line.itemSource || order?.itemSource || "FG");
    const itemId = resolveCanonicalSlipLineItemId(line, order);
    return itemId ? `${itemSource}::${itemId}` : "";
  };

  const getPendingSlip = (slip: LoadingSlip, includeInvoiceId = "") => {
    if (slip.status === "Cancelled") return null;

    const relevantLineItems = invoiceLineItems.filter(
      (line) =>
        String(line.loadingSlipId || "").trim() === slip.id &&
        (!includeInvoiceId || String(line.invoiceId || "").trim() !== includeInvoiceId)
    );

    if (slip.invoiceId && relevantLineItems.length === 0 && !includeInvoiceId) return null;

    const billedByLineKey = new Map<string, number>();
    relevantLineItems.forEach((line) => {
      const itemSource = normalizeOrderItemSource(line.itemSource || "FG");
      const itemId = String(line.npdId || line.itemId || "").trim();
      if (!itemId) return;
      const key = `${itemSource}::${itemId}`;
      billedByLineKey.set(key, (billedByLineKey.get(key) || 0) + Number(line.qty || 0));
    });

    const pendingLines = (slip.lines || [])
      .map((line: any) => {
        const plan = plans.find((p) => p.id === line.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        const lineKey = getSlipLineKey(line, order);
        if (!lineKey) return null;

        const loadedQty = Number(line.loadedQty || 0);
        const billedQty = Math.min(loadedQty, Math.max(0, billedByLineKey.get(lineKey) || 0));
        billedByLineKey.set(lineKey, Math.max(0, (billedByLineKey.get(lineKey) || 0) - billedQty));

        const pendingQty = roundMoney(loadedQty - billedQty);
        if (pendingQty <= 0.0001) return null;
        return { ...line, loadedQty: pendingQty };
      })
      .filter(Boolean);

    if (pendingLines.length === 0) return null;
    return { ...slip, lines: pendingLines };
  };

  const buildInvoiceRowsFromSlips = (selected: any[]) => {
    const itemMap = new Map<string, InvoiceItemRow>();
    const itemOrderQtyMap = new Map<string, Map<string, number>>();

    selected.forEach((slip) => {
      slip.lines.forEach((line: any) => {
        const plan = plans.find((p) => p.id === line.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        const itemSource = normalizeOrderItemSource(line.itemSource || order?.itemSource || "FG");
        const item = resolveSlipLineItem(line, order);
        const itemId = resolveCanonicalSlipLineItemId(line, order);
        if (!itemId) return;

        const qty = Number(line.loadedQty || 0);
        const gstRate = Number(line.gstRate ?? item?.gstRate ?? 18);
        const rate = Number(line.rate ?? item?.rate ?? order?.rate ?? 0);
        const itemName = resolveSlipLineItemName(line, order);
        const itemKey = `${itemSource}::${itemId}`;
        const existing = itemMap.get(itemKey);

        if (existing) {
          existing.totalQty += qty;
          existing.sources.push({ loadingSlipId: slip.id, qty });
          if (!existing.defaultRate && rate) existing.defaultRate = rate;
        } else {
          itemMap.set(itemKey, {
            id: crypto.randomUUID(),
            itemId,
            itemSource,
            itemName,
            gstRate,
            defaultRate: rate,
            totalQty: qty,
            sources: [{ loadingSlipId: slip.id, qty }],
            allocations: [],
          });
        }

        const byOrder = itemOrderQtyMap.get(itemKey) || new Map<string, number>();
        const allocationKey = order?.id ? order.id : DIRECT_ALLOCATION_ID;
        byOrder.set(allocationKey, (byOrder.get(allocationKey) || 0) + qty);
        itemOrderQtyMap.set(itemKey, byOrder);
      });
    });

    itemMap.forEach((row, itemKey) => {
      const byOrder = itemOrderQtyMap.get(itemKey) || new Map<string, number>();
      const allocations: InvoiceAllocationRow[] = Array.from(byOrder.entries()).map(([orderId, qty]) => ({
        id: crypto.randomUUID(),
        orderId,
        qty,
      }));
      row.allocations = allocations.length ? allocations : [{ id: crypto.randomUUID(), orderId: "", qty: row.totalQty }];
    });

    return Array.from(itemMap.values());
  };

  const applySavedInvoiceAllocations = (rows: InvoiceItemRow[], invoiceId: string) => {
    const lineItemsForInvoice = invoiceLineItems.filter((line) => line.invoiceId === invoiceId);
    if (lineItemsForInvoice.length === 0) return rows;

    return rows.map((row) => {
      const matchingLines = lineItemsForInvoice.filter((line) => String(line.itemId || "").trim() === row.itemId && normalizeOrderItemSource(line.itemSource || "FG") === row.itemSource);
      if (matchingLines.length === 0) return row;

      const allocationsByOrder = new Map<string, number>();
      let gstRate = row.gstRate;

      matchingLines.forEach((line) => {
        const slip = loadingSlips.find((entry) => entry.id === line.loadingSlipId);
        const slipLine = slip?.lines?.find((entry: any) => {
          const plan = plans.find((p) => p.id === entry.dispatchPlanId);
          const order = orders.find((o) => o.id === plan?.orderId);
          const source = normalizeOrderItemSource(entry.itemSource || order?.itemSource || "FG");
          return resolveCanonicalSlipLineItemId(entry, order) === row.itemId && source === row.itemSource;
        });
        const plan = slipLine ? plans.find((p) => p.id === slipLine.dispatchPlanId) : undefined;
        const orderId = String(plan?.orderId || "").trim();
        if (orderId) {
          allocationsByOrder.set(orderId, (allocationsByOrder.get(orderId) || 0) + Number(line.qty || 0));
        }
        gstRate = Number(line.gstRate ?? gstRate ?? 0);
      });

      const allocations = Array.from(allocationsByOrder.entries()).map(([orderId, qty]) => ({
        id: crypto.randomUUID(),
        orderId,
        qty,
      }));

      return {
        ...row,
        gstRate,
        allocations: allocations.length ? allocations : row.allocations,
      };
    });
  };

  const getInvoiceItemDisplayName = (itemRow: InvoiceItemRow) => {
    const rowName = getMeaningfulItemName(itemRow.itemName);
    if (rowName) return rowName;

    for (const allocation of itemRow.allocations) {
      if (!allocation.orderId || allocation.orderId === DIRECT_ALLOCATION_ID) continue;
      const order = orders.find((entry) => entry.id === allocation.orderId);
      if (!order) continue;
      const resolvedItem = resolveOrderItem(order);
      const orderItemName =
        getMeaningfulItemName(resolvedItem?.name) ||
        getMeaningfulItemName(order.erpCode) ||
        getMeaningfulItemName(order.poNumber) ||
        getMeaningfulItemName(order.orderNo);
      if (orderItemName) return orderItemName;
    }

    return "Unknown";
  };

  const groupedData = useMemo(() => {
    const pendingSlips = loadingSlips
      .map((slip) => getPendingSlip(slip))
      .filter(Boolean) as LoadingSlip[];
    const companyMap = new Map<string, GroupedLoading>();

    pendingSlips.forEach(s => {
      const firstLine = s.lines[0];
      if (!firstLine) return;
      const plan = plans.find(p => p.id === firstLine.dispatchPlanId);
      const order = orders.find(o => o.id === plan?.orderId);
      const company = companies.find(c => c.id === (order?.companyId || s.companyId || firstLine.companyId));
      const companyName = company?.name || s.companyName || firstLine.companyName || "";

      if (!company && !companyName) return;

      const groupId = company?.id || s.companyId || `direct-${companyName}`;
      if (!companyMap.has(groupId)) {
        companyMap.set(groupId, {
          companyId: groupId,
          companyName: company?.name || companyName,
          slips: []
        });
      }

      const totalQty = s.lines.reduce((sum, l) => sum + Number(l.loadedQty || 0), 0);
      const slipItems = s.lines.map(l => {
        const lp = plans.find(p => p.id === l.dispatchPlanId);
        const lo = orders.find(o => o.id === lp?.orderId);
        return resolveSlipLineItemName(l, lo);
      });
      const slipItemKeys = s.lines.map(l => {
        const lp = plans.find(p => p.id === l.dispatchPlanId);
        const lo = orders.find(o => o.id === lp?.orderId);
        const itemId = resolveCanonicalSlipLineItemId(l, lo);
        const itemName = resolveSlipLineItemName(l, lo);
        const erp = String(l.erpCode || l.masterErp || lo?.erpCode || "").trim();
        return itemId || `${itemName}::${erp}`;
      });

      companyMap.get(groupId)!.slips.push({
        ...s,
        totalQty,
        items: Array.from(new Set(slipItems)),
        itemKeys: Array.from(new Set(slipItemKeys))
      });
    });

    return Array.from(companyMap.values())
      .map((group) => ({ ...group, slips: group.slips.filter((slip) => !itemFilter || slip.itemKeys.includes(itemFilter)) }))
      .filter((group) => group.slips.length > 0)
      .filter((group) => !companyFilter || group.companyId === companyFilter)
      .filter((group) => {
        const needle = searchTerm.trim().toLowerCase();
        if (!needle) return true;
        const slipText = group.slips.map((slip) => `${slip.slipNo || ""} ${slip.items.join(" ")}`).join(" ");
        return `${group.companyName} ${slipText}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [loadingSlips, invoiceLineItems, companies, plans, orders, npdItems, searchTerm, companyFilter, itemFilter, findItemAcrossSources, resolveOrderItem]);

  const companyOptions = useMemo(() => Array.from(new Map(groupedData.map((group) => [group.companyId, { value: group.companyId, label: group.companyName }])).values()).filter((option) => option.value && option.label).sort((a, b) => a.label.localeCompare(b.label)), [groupedData]);
  const itemOptions = useMemo(() => { const map = new Map<string, { value: string; label: string; searchText: string }>(); groupedData.forEach((group) => group.slips.forEach((slip) => slip.items.forEach((name, index) => { const key = slip.itemKeys[index] || name; if (!key || map.has(key)) return; map.set(key, { value: key, label: name, searchText: name }); }))); return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label)); }, [groupedData]);

  useEffect(() => {
    if (didInitExpand.current) return;
    if (groupedData.length === 0) return;
    didInitExpand.current = true;
    setExpandedCompanies(new Set(groupedData.map((group) => group.companyId)));
  }, [groupedData]);

  const handleStartBilling = (companyId: string, slips: any[]) => {
    setBillingMode(companyId);
    setSelectedSlips(new Set(slips.map(s => s.id)));
  };

  const handleToggleSlip = (id: string) => {
    const next = new Set(selectedSlips);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSlips(next);
  };

  const totalDispatchedByOrderId = useMemo(() => {
    const dispatchedMap = new Map<string, number>();
    invoiceLineItems.forEach((lineItem) => {
      if (editInvoiceId && lineItem.invoiceId === editInvoiceId) return;
      const slip = loadingSlips.find((entry) => entry.id === lineItem.loadingSlipId);
      const slipLine = slip?.lines?.find((entry: any) => {
        const plan = plans.find((p) => p.id === entry.dispatchPlanId);
        const order = orders.find((o) => o.id === plan?.orderId);
        return (
          getSlipLineKey(entry, order) ===
          `${normalizeOrderItemSource(lineItem.itemSource || "FG")}::${String(lineItem.npdId || lineItem.itemId || "").trim()}`
        );
      });
      const plan = slipLine ? plans.find((entry) => entry.id === slipLine.dispatchPlanId) : undefined;
      if (!plan?.orderId) return;
      dispatchedMap.set(plan.orderId, (dispatchedMap.get(plan.orderId) || 0) + Number(lineItem.qty || 0));
    });
    return dispatchedMap;
  }, [invoiceLineItems, loadingSlips, plans, orders, editInvoiceId]);

  const handleOpenInvoiceForm = () => {
    if (!billingMode) return;
    const companyGroup = groupedData.find(g => g.companyId === billingMode);
    if (!companyGroup) return;
    
    const selected = companyGroup.slips.filter(s => selectedSlips.has(s.id));
    setInvoiceModal({ companyId: billingMode, slips: selected });
    setOtherCharges("");
    setOtherChargesGstRate("");
    setRoundOff("");
    setIsRoundOffManual(false);
    setDestination("");
    setTransporter("");
    setInvoiceRows(buildInvoiceRowsFromSlips(selected));

    const company = companies.find(c => c.id === billingMode);
    setGstSupplyType((company?.gstSupplyType as any) || "INTRA_STATE");
  };

  const closeInvoiceModal = () => {
    setInvoiceModal(null);
    setDestination("");
    setTransporter("");
    setOtherCharges("");
    setOtherChargesGstRate("");
    setRoundOff("");
    setIsRoundOffManual(false);
    if (editInvoiceId) {
      setSearchParams({});
      navigate("/billing/master");
    }
  };

  const handleAddRow = () => {
    alert("Rows are created from selected Loading Slips. Use 'Add Order' under an item to split quantities.");
  };

  const addAllocationRow = (itemRowId: string) => {
    setInvoiceRows((prev) =>
      prev.map((row) =>
        row.id === itemRowId
          ? (() => {
              const allocated = row.allocations.reduce((sum, a) => sum + Number(a.qty || 0), 0);
              const remaining = Math.max(0, Number(row.totalQty || 0) - allocated);
              return { ...row, allocations: [...row.allocations, { id: crypto.randomUUID(), orderId: "", qty: remaining }] };
            })()
          : row
      )
    );
  };

  const removeAllocationRow = (itemRowId: string, allocationId: string) => {
    setInvoiceRows((prev) =>
      prev.map((row) => {
        if (row.id !== itemRowId) return row;
        const next =
          row.allocations.length === 1
            ? [{ id: crypto.randomUUID(), orderId: "", qty: Number(row.totalQty || 0) }]
            : row.allocations.filter((a) => a.id !== allocationId);
        return { ...row, allocations: next };
      })
    );
  };

  const removeInvoiceItemRow = (itemRowId: string) => {
    setInvoiceRows((prev) => prev.filter((row) => row.id !== itemRowId));
  };

  const updateAllocation = (
    itemRowId: string,
    allocationId: string,
    patch: Partial<Pick<InvoiceAllocationRow, "orderId" | "qty">>
  ) => {
    setInvoiceRows((prev) =>
      prev.map((row) => {
        if (row.id !== itemRowId) return row;

        const nextAllocations = row.allocations.map((a) => (a.id === allocationId ? { ...a, ...patch } : a));

        // Clamp qty so that per-item allocated total never exceeds totalQty
        const totalQty = Number(row.totalQty || 0);
        const current = nextAllocations.find((a) => a.id === allocationId);
        if (current && patch.qty !== undefined) {
          const othersTotal = nextAllocations
            .filter((a) => a.id !== allocationId)
            .reduce((sum, a) => sum + Number(a.qty || 0), 0);
          const maxAllowed = Math.max(0, totalQty - othersTotal);
          const desired = Number(current.qty || 0);
          current.qty = Math.min(Math.max(0, desired), maxAllowed);
        }

        return { ...row, allocations: nextAllocations };
      })
    );
  };

  const updateItemGstRate = (itemRowId: string, gstRate: number) => {
    setInvoiceRows((prev) => prev.map((row) => (row.id === itemRowId ? { ...row, gstRate } : row)));
  };

  const calculations = useMemo(() => {
    const isInterState = gstSupplyType === "INTER_STATE";
    let totalBeforeGst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    const otherChargesValue = Number(otherCharges || 0);
    const taxableOtherCharges = otherChargesGstRate !== "" && otherChargesValue !== 0;
    const otherChargesRate = taxableOtherCharges ? Number(otherChargesGstRate || 0) : 0;
    let otherChargesCgst = 0;
    let otherChargesSgst = 0;
    let otherChargesIgst = 0;

    invoiceRows.forEach((itemRow) => {
      itemRow.allocations.forEach((alloc) => {
        const order = orders.find((o) => o.id === alloc.orderId);
        const rate = alloc.orderId === DIRECT_ALLOCATION_ID ? Number(itemRow.defaultRate || 0) : Number(order?.rate || 0);
        if (alloc.orderId !== DIRECT_ALLOCATION_ID && !order) return;
        const qty = Number(alloc.qty || 0);
        const lineAmounts = calculateRoundedInvoiceLine(qty, rate, itemRow.gstRate, isInterState);
        totalBeforeGst += lineAmounts.amount;
        totalCgst += lineAmounts.cgst;
        totalSgst += lineAmounts.sgst;
        totalIgst += lineAmounts.igst;
      });
    });

    totalBeforeGst = roundMoney(totalBeforeGst);
    totalCgst = roundMoney(totalCgst);
    totalSgst = roundMoney(totalSgst);
    totalIgst = roundMoney(totalIgst);

    if (taxableOtherCharges) {
      totalBeforeGst = roundMoney(totalBeforeGst + otherChargesValue);
      if (isInterState) {
        otherChargesIgst = roundMoney((otherChargesValue * otherChargesRate) / 100);
        totalIgst = roundMoney(totalIgst + otherChargesIgst);
      } else {
        const halfTax = roundMoney((otherChargesValue * otherChargesRate) / 100 / 2);
        otherChargesCgst = halfTax;
        otherChargesSgst = halfTax;
        totalCgst = roundMoney(totalCgst + otherChargesCgst);
        totalSgst = roundMoney(totalSgst + otherChargesSgst);
      }
    }

    const totalAfterGst = roundMoney(totalBeforeGst + totalCgst + totalSgst + totalIgst);
    const nonTaxableOtherCharges = taxableOtherCharges ? 0 : otherChargesValue;
    const baseTotal = roundMoney(totalAfterGst + nonTaxableOtherCharges);
    const roundedGrandTotal = roundWhole(baseTotal);
    const autoRoundOffValue = roundMoney(roundedGrandTotal - baseTotal);
    const roundOffValue = isRoundOffManual ? roundMoney(Number(roundOff || 0)) : autoRoundOffValue;
    const grandTotal = roundMoney(baseTotal + roundOffValue);

    return { 
      totalBeforeGst, 
      cgst: totalCgst, 
      sgst: totalSgst, 
      igst: totalIgst, 
      totalAfterGst, 
      otherCharges: otherChargesValue,
      otherChargesGstRate: taxableOtherCharges ? otherChargesRate : null,
      otherChargesCgst,
      otherChargesSgst,
      otherChargesIgst,
      nonTaxableOtherCharges,
      autoRoundOff: autoRoundOffValue,
      roundOff: roundOffValue, 
      grandTotal
    };
  }, [invoiceRows, gstSupplyType, orders, otherCharges, otherChargesGstRate, roundOff, isRoundOffManual]);

  const shouldShowTransporter = useMemo(() => {
    if (!invoiceModal) return false;
    return invoiceModal.slips.some((slip) => {
      const truckNo = slip.truckNo || trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "";
      return truckNo.trim().toLowerCase() === "other";
    });
  }, [invoiceModal, trucks]);

  useEffect(() => {
    if (!editInvoiceId) return;
    if (invoiceModal !== null && invoiceRows.length > 0) return;
    if (plans.length === 0 || orders.length === 0) return;

    const invoice = invoices.find((entry) => entry.id === editInvoiceId);
    if (!invoice) return;
    if (invoice.tallyTimestamp && !isPankajUser) {
      alert("This invoice is already posted to Tally and can no longer be edited.");
      setSearchParams({});
      navigate("/billing/master");
      return;
    }

    const savedLineItems = invoiceLineItems.filter((line) => line.invoiceId === editInvoiceId);
    const savedSlipIds = new Set(savedLineItems.map((line) => String(line.loadingSlipId || "").trim()).filter(Boolean));
    const selectedFromLines = loadingSlips
      .filter((slip) => savedSlipIds.has(slip.id) && slip.status !== "Cancelled")
      .map((slip) => getPendingSlip(slip, editInvoiceId))
      .filter(Boolean);
    const selectedFallback = loadingSlips
      .filter((slip) => slip.invoiceId === editInvoiceId && slip.status !== "Cancelled")
      .map((slip) => getPendingSlip(slip, editInvoiceId))
      .filter(Boolean);
    const selected = selectedFromLines.length > 0 ? selectedFromLines : selectedFallback;
    if (selected.length === 0) {
      alert(
        savedLineItems.length > 0
          ? "Invoice has saved lines, but related loading slip is missing or cancelled."
          : "No active loading slips were found for this invoice."
      );
      setSearchParams({});
      navigate("/billing/master");
      return;
    }

    setBillingMode(invoice.companyId);
    setSelectedSlips(new Set(selected.map((slip) => slip.id)));
    setInvoiceModal({ companyId: invoice.companyId, slips: selected });
    setOtherCharges(Number(invoice.otherCharges || 0));
    setOtherChargesGstRate(invoice.otherChargesGstRate === null || invoice.otherChargesGstRate === undefined || Number(invoice.otherChargesGstRate || 0) <= 0 ? "" : Number(invoice.otherChargesGstRate));
    setRoundOff(Number(invoice.roundOff || 0));
    setIsRoundOffManual(true);
    setDestination(invoice.destination || "");
    setTransporter(invoice.transporter || "");
    setGstSupplyType((companies.find((row) => row.id === invoice.companyId)?.gstSupplyType as any) || "INTRA_STATE");

    const seededRows = buildInvoiceRowsFromSlips(selected);
    if (seededRows.length === 0) return;
    const savedItemKeys = new Set(
      savedLineItems.map((line) => `${normalizeOrderItemSource(line.itemSource || "FG")}::${String(line.npdId || line.itemId || "").trim()}`)
    );
    const editRows =
      savedLineItems.length > 0
        ? seededRows.filter((row) => savedItemKeys.has(`${row.itemSource}::${row.itemId}`))
        : seededRows;
    setInvoiceRows(applySavedInvoiceAllocations(editRows, editInvoiceId));
  }, [
    editInvoiceId,
    invoiceModal,
    invoiceRows.length,
    invoices,
    loadingSlips,
    invoiceLineItems,
    plans,
    orders,
    companies,
    isPankajUser,
    navigate,
    setSearchParams,
  ]);

  const handleSubmitInvoice = async () => {
    if (!invoiceModal || isSubmitting) return;
    const company = companies.find(c => c.id === invoiceModal.companyId);
    if (!company) return;
    if (!destination.trim()) {
      alert("Please enter Destination.");
      return;
    }
    if (shouldShowTransporter && !transporter.trim()) {
      alert("Please enter Transporter when Truck No is Other.");
      return;
    }

    const totalLoaded = invoiceRows.reduce((sum, itemRow) => sum + Number(itemRow.totalQty || 0), 0);
    const totalInvoicedNow = invoiceRows.reduce(
      (sum, itemRow) => sum + itemRow.allocations.reduce((s, a) => s + Number(a.qty || 0), 0),
      0
    );

    if (Math.abs(totalInvoicedNow - totalLoaded) > 0.01) {
      alert(`Total quantity in invoice (${totalInvoicedNow.toLocaleString()}) must match total loaded quantity (${totalLoaded.toLocaleString()}).`);
      return;
    }

    // Item-wise validation: allocations must match item total
    for (const itemRow of invoiceRows) {
      const allocTotal = itemRow.allocations.reduce((s, a) => s + Number(a.qty || 0), 0);
      if (Math.abs(allocTotal - Number(itemRow.totalQty || 0)) > 0.01) {
        const itemName = itemRow.itemName || "Item";
        alert(
          `Item-wise quantity mismatch for ${itemName}.\nLoaded: ${Number(itemRow.totalQty || 0).toLocaleString()}\nAllocated: ${allocTotal.toLocaleString()}`
        );
        return;
      }
      if (itemRow.allocations.some((a) => !String(a.orderId || "").trim())) {
        const itemName = itemRow.itemName || "Item";
        alert(`Please select Order for all allocation rows of ${itemName}.`);
        return;
      }
    }


    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const existingInvoice = editInvoiceId ? invoices.find((invoice) => invoice.id === editInvoiceId) : undefined;
      const invoiceId = existingInvoice?.id || crypto.randomUUID();
      const newInvoice: Invoice = {
        id: invoiceId,
        invoiceNo: existingInvoice?.invoiceNo || "",
        date: existingInvoice?.date || new Date().toISOString().slice(0, 10),
        companyId: company.id,
        destination: destination.trim() || undefined,
        transporter: shouldShowTransporter ? (transporter.trim() || undefined) : undefined,
        gstRate: 0,
        totalBeforeGst: calculations.totalBeforeGst,
        cgst: calculations.cgst,
        sgst: calculations.sgst,
        igst: calculations.igst,
        totalAfterGst: calculations.totalAfterGst,
        otherCharges: calculations.otherCharges,
        otherChargesGstRate: calculations.otherChargesGstRate,
        otherChargesCgst: calculations.otherChargesCgst,
        otherChargesSgst: calculations.otherChargesSgst,
        otherChargesIgst: calculations.otherChargesIgst,
        roundOff: calculations.roundOff,
        tallyTimestamp: existingInvoice?.tallyTimestamp,
        tallyBy: existingInvoice?.tallyBy,
        tallyInvNo: existingInvoice?.tallyInvNo,
        tallyInvDate: existingInvoice?.tallyInvDate,
        tallyInvId: existingInvoice?.tallyInvId,
        tallySyncRemark: existingInvoice?.tallySyncRemark,
        updatedBy: "System User",
        updateTimestamp: timestamp
      };

      const buildPool = (sources: Array<{ loadingSlipId: string; qty: number }>) =>
        sources.map((s) => ({ loadingSlipId: s.loadingSlipId, remaining: Number(s.qty || 0) }));

      const consumeFromPool = (pool: Array<{ loadingSlipId: string; remaining: number }>, need: number) => {
        const parts: Array<{ loadingSlipId: string; qty: number }> = [];
        let remainingNeed = Number(need || 0);
        for (const src of pool) {
          if (remainingNeed <= 0.0001) break;
          if (!src.loadingSlipId) continue;
          const take = Math.min(Math.max(0, src.remaining), remainingNeed);
          if (take <= 0.0001) continue;
          parts.push({ loadingSlipId: src.loadingSlipId, qty: take });
          src.remaining -= take;
          remainingNeed -= take;
        }
        if (remainingNeed > 0.0001) {
          const firstSlipId = invoiceModal.slips[0]?.id || "";
          if (firstSlipId) parts.push({ loadingSlipId: firstSlipId, qty: remainingNeed });
        }
        return parts;
      };

      const poolsByItemId = new Map<string, Array<{ loadingSlipId: string; remaining: number }>>();
      invoiceRows.forEach((row) => poolsByItemId.set(row.itemId, buildPool(row.sources || [])));

      const lineItems: InvoiceLineItem[] = [];
      for (const itemRow of invoiceRows) {
        const pool = poolsByItemId.get(itemRow.itemId) || buildPool(itemRow.sources || []);
        for (const alloc of itemRow.allocations) {
          const order = orders.find((o) => o.id === alloc.orderId);
          if (alloc.orderId !== DIRECT_ALLOCATION_ID) {
            if (!order) continue;
            if (order.itemId !== itemRow.itemId || normalizeOrderItemSource(order.itemSource) !== itemRow.itemSource) continue;
          }
          const rate = alloc.orderId === DIRECT_ALLOCATION_ID ? Number(itemRow.defaultRate || 0) : Number(order?.rate || 0);
          const parts = consumeFromPool(pool, Number(alloc.qty || 0));
          for (const part of parts) {
            const lineAmounts = calculateRoundedInvoiceLine(part.qty, rate, itemRow.gstRate, gstSupplyType === "INTER_STATE");
            lineItems.push({
              id: crypto.randomUUID(),
              invoiceId,
              loadingSlipId: part.loadingSlipId,
              itemId: itemRow.itemId,
              itemSource: itemRow.itemSource,
              npdId: itemRow.itemSource === "FG" ? itemRow.itemId : undefined,
              qty: part.qty,
              rate,
              amount: lineAmounts.amount,
              gstRate: itemRow.gstRate,
              cgst: lineAmounts.cgst,
              sgst: lineAmounts.sgst,
              igst: lineAmounts.igst
            });
          }
        }
      }

      const updatedSlips = invoiceModal.slips.map((draftSlip) => {
        const originalSlip = loadingSlips.find((slip) => slip.id === draftSlip.id) || draftSlip;
        return {
          ...toPersistableLoadingSlip(originalSlip),
          invoiceId,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        };
      });

      const createdLineItemIds: string[] = [];
      let invoiceCreated = false;
      let gatePassCreated = false;
      const slipIdsUpdated = new Set<string>();
      let initialGatePass: GatePass | null = null;
      const existingGatePass = gatePasses.find((gatePass) => gatePass.invoiceId === invoiceId) || null;
      const existingLineItems = invoiceLineItems.filter((line) => line.invoiceId === invoiceId);

      try {
        await postEntity("invoices", newInvoice);
        invoiceCreated = true;

        const persistedInvoice =
          (await fetchEntities<Invoice>("invoices")).find((invoice) => invoice.id === invoiceId) || newInvoice;

        for (const existingLineItem of existingLineItems) {
          await deleteEntity("invoice_line_items", existingLineItem.id);
        }

        for (const lineItem of lineItems) {
          await postEntity("invoice_line_items", lineItem);
          createdLineItemIds.push(lineItem.id);
        }

        for (const slip of updatedSlips) {
          await postEntity("loading_slips", slip);
          slipIdsUpdated.add(slip.id);
        }

        initialGatePass = buildGatePassFromInvoice({
          company,
          date: persistedInvoice.date,
          existingId: existingGatePass?.id,
          gatePassNo: existingGatePass?.gatePassNo,
          invoice: persistedInvoice,
          lineItems,
          resolveItemName: (line) => {
            const slip = updatedSlips.find((entry) => entry.id === line.loadingSlipId);
            const slipLine = slip?.lines?.find((entry: any) => {
              const plan = plans.find((p) => p.id === entry.dispatchPlanId);
              const order = orders.find((o) => o.id === plan?.orderId);
              return (
                resolveCanonicalSlipLineItemId(entry, order) === String(line.itemId || "").trim() &&
                normalizeOrderItemSource(entry.itemSource || order?.itemSource || "FG") ===
                  normalizeOrderItemSource(line.itemSource || "FG")
              );
            });
            const plan = slipLine ? plans.find((p) => p.id === slipLine.dispatchPlanId) : undefined;
            const order = plan ? orders.find((entry) => entry.id === plan.orderId) : undefined;
            return resolveSlipLineItemName(slipLine || { itemId: line.itemId, itemSource: line.itemSource } as any, order);
          },
          selectedLoadingSlipIds: updatedSlips.map((slip) => slip.id),
          slips: updatedSlips,
          trucks,
          updatedBy: "System User",
          updateTimestamp: timestamp,
        });

        await postEntity("gate_passes", initialGatePass);
        gatePassCreated = true;
      } catch (saveError) {
        for (const draftSlip of invoiceModal.slips as LoadingSlip[]) {
          if (!slipIdsUpdated.has(draftSlip.id)) continue;
          const originalSlip = loadingSlips.find((slip) => slip.id === draftSlip.id) || draftSlip;
          try {
            await postEntity("loading_slips", originalSlip);
          } catch (rollbackError) {
            console.error("Failed to rollback loading slip:", rollbackError);
          }
        }
        if (gatePassCreated && initialGatePass) {
          try {
            await deleteEntity("gate_passes", initialGatePass.id);
          } catch (rollbackError) {
            console.error("Failed to rollback gate pass:", rollbackError);
          }
        }
        for (const lineItemId of [...createdLineItemIds].reverse()) {
          try {
            await deleteEntity("invoice_line_items", lineItemId);
          } catch (rollbackError) {
            console.error("Failed to rollback invoice line item:", rollbackError);
          }
        }
        if (invoiceCreated) {
          try {
            await deleteEntity("invoices", invoiceId);
          } catch (rollbackError) {
            console.error("Failed to rollback invoice:", rollbackError);
          }
        }
        throw saveError;
      }

      await Promise.all([
        loadingSlipApi.refresh(),
        invoiceApi.refresh(),
        invoiceLineItemApi.refresh(),
        gatePassApi.refresh(),
      ]);

      closeInvoiceModal();
      setBillingMode(null);
      setSelectedSlips(new Set());
      alert(existingInvoice ? "Invoice updated successfully." : "Invoice and Gate Pass generated successfully! Showing Pending Tally Posting...");
    } catch (err) {
      console.error("Failed to generate invoice:", err);
      alert(`Failed to save invoice and gate pass: ${(err as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
    };
  const format2 = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Invoicing</h2>
        <div className="grid w-full gap-3 md:grid-cols-[minmax(240px,1.4fr)_minmax(200px,1fr)_minmax(240px,1.1fr)_auto] md:items-center md:max-w-4xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search company, slip, item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
            />
          </div>
          <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="All Companies" />
          <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} placeholder="All Items" />
          {(searchTerm || companyFilter || itemFilter) ? (
            <button type="button" onClick={() => { setSearchTerm(""); setCompanyFilter(""); setItemFilter(""); }} className="rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-slate-50">Clear Filters</button>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {groupedData.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
            <p className="text-slate-500 font-medium">No pending loading slips for invoicing.</p>
          </div>
        ) : groupedData.map((group) => (
          <div key={group.companyId} className="bg-white border border-black rounded shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100 border-b border-black">
              <div className="flex items-center gap-3">
                <Building2 size={20} className="text-indigo-600" />
                <span className="font-bold text-lg">{group.companyName}</span>
                <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase">
                  {group.slips.length} Loading Slips
                </span>
              </div>
              <div className="flex items-center gap-3">
                {billingMode === group.companyId ? (
                  <button 
                    onClick={handleOpenInvoiceForm}
                    disabled={selectedSlips.size === 0}
                    className="bg-emerald-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-emerald-700 transition shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px] disabled:opacity-50 disabled:shadow-none"
                  >
                    GENERATE INVOICE ({selectedSlips.size})
                  </button>
                ) : (
                  <button 
                    onClick={() => handleStartBilling(group.companyId, group.slips)}
                    className="bg-indigo-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-indigo-700 transition shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-[2px]"
                  >
                    SELECT FOR INVOICING
                  </button>
                )}
                <button 
                  onClick={() => toggleCompany(group.companyId)}
                  className="p-1 hover:bg-slate-200 rounded"
                >
                  {expandedCompanies.has(group.companyId) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
              </div>
            </div>

            {expandedCompanies.has(group.companyId) && (
              <div className="p-4">
                <div className="overflow-hidden rounded border border-black bg-white">
                  <div className="w-full overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse">
                      <thead className="sticky top-0 z-30 bg-slate-50">
                    <tr className="divide-x divide-black border-b border-black">
                      {billingMode === group.companyId && <th className="w-10 px-2 py-2"></th>}
                      <th className="w-[150px] px-3 py-2 text-left text-[10px] font-bold uppercase">Loading Slip No</th>
                      <th className="w-[110px] px-3 py-2 text-left text-[10px] font-bold uppercase">Date</th>
                      <th className="w-[130px] px-3 py-2 text-left text-[10px] font-bold uppercase">Truck No</th>
                      <th className="min-w-[360px] px-3 py-2 text-left text-[10px] font-bold uppercase">Item Name(s)</th>
                      <th className="w-[120px] px-3 py-2 text-right text-[10px] font-bold uppercase">Total Qty</th>
                    </tr>
                  </thead>
                      <tbody className="divide-y divide-black">
                    {group.slips.map((s) => (
                      <tr key={s.id} className="divide-x divide-black hover:bg-slate-50">
                        {billingMode === group.companyId && (
                          <td className="px-2 py-2 text-center">
                            <input 
                              type="checkbox"
                              checked={selectedSlips.has(s.id)}
                              onChange={() => handleToggleSlip(s.id)}
                              className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-black rounded"
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs font-bold">{s.slipNo}</td>
                        <td className="px-3 py-2 text-xs">{formatDate(s.date)}</td>
                        <td className="px-3 py-2 text-xs font-bold text-indigo-700">
                          {s.truckNo || trucks.find(t => t.id === s.truckId)?.truckNo || "N/A"}
                        </td>
                        <td className="min-w-[360px] px-3 py-2 text-xs whitespace-normal break-words leading-relaxed">
                          <div className="space-y-1">
                            {s.items.map((itemName) => (
                              <div key={itemName} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-black">
                                {itemName}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-medium">{s.totalQty.toLocaleString()}</td>
                      </tr>
                    ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Invoice Modal */}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-[95vw] max-h-[95vh] border-2 border-black rounded shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black">
              <div className="flex items-center gap-3">
                <Receipt size={20} />
                <h3 className="font-bold uppercase tracking-tight">{editInvoiceId ? "Edit Invoice" : "Invoice Form"} - {companies.find(c => c.id === invoiceModal.companyId)?.name}</h3>
              </div>
              <button onClick={closeInvoiceModal} className="hover:text-slate-300 transition">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">Destination <span className="text-rose-600">*</span></label>
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="Enter destination"
                    required
                    className="w-full rounded border-2 border-black px-3 py-2 text-sm font-medium"
                  />
                </div>
                {shouldShowTransporter ? (
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
                      Transporter <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={transporter}
                      onChange={(e) => setTransporter(e.target.value)}
                      placeholder="Enter transporter"
                      className="w-full rounded border-2 border-black px-3 py-2 text-sm font-medium"
                    />
                  </div>
                ) : null}
              </div>

              <div className="table-frozen-scroll border border-black">
                <table className="min-w-full divide-y divide-black border-collapse">
                  <thead className="sticky top-0 z-30 bg-slate-100">
                    <tr className="divide-x divide-black">
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase">Item Name</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase min-w-[200px]">Order No / PO No</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Order Qty</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Dispatched</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Pending</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Rate</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase bg-indigo-50">DISPATCH NOW</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase w-20">GST %</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase">Amount</th>
                      <th className="px-3 py-2 text-center text-[10px] font-black uppercase w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {invoiceRows.flatMap((itemRow) => {
                      const itemName = getInvoiceItemDisplayName(itemRow);
                      const pendingOrdersForItem = orders.filter((o) => {
                        if (o.companyId !== invoiceModal.companyId) return false;
                        if (o.status === "Cancelled") return false;
                        if (o.itemId !== itemRow.itemId || normalizeOrderItemSource(o.itemSource) !== itemRow.itemSource) return false;
                        const dispatched = totalDispatchedByOrderId.get(o.id) || 0;
                        return Math.max(0, Number(o.qty || 0) - dispatched) > 0;
                      });

                      const parentRow = (
                        <tr key={itemRow.id} className="bg-slate-50 border-t-2 border-black">
                          <td colSpan={10} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              {(() => {
                                const allocatedTotal = itemRow.allocations.reduce((s, a) => s + Number(a.qty || 0), 0);
                                const remaining = Number(itemRow.totalQty || 0) - allocatedTotal;
                                return (
                              <div className="text-[11px] font-black uppercase">
                                {itemName}{" "}
                                <span className="text-slate-500 font-bold">
                                  | Total: {Number(itemRow.totalQty || 0).toLocaleString()} | Allocated: {allocatedTotal.toLocaleString()} | Remaining:{" "}
                                  <span className={cn("font-black", remaining < -0.001 ? "text-rose-700" : remaining > 0.001 ? "text-amber-700" : "text-emerald-700")}>
                                    {remaining.toLocaleString()}
                                  </span>
                                </span>
                              </div>
                                );
                              })()}
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => addAllocationRow(itemRow.id)}
                                  className="px-3 py-1.5 bg-white border-2 border-black text-[10px] font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-none transition"
                                >
                                  + Add Order
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeInvoiceItemRow(itemRow.id)}
                                  className="px-3 py-1.5 bg-white border-2 border-rose-700 text-[10px] font-black uppercase text-rose-700 hover:bg-rose-50 transition"
                                >
                                  Remove Item
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );

                      const childRows = itemRow.allocations.map((alloc) => {
                        const order = orders.find((o) => o.id === alloc.orderId);
                        const isDirectAlloc = alloc.orderId === DIRECT_ALLOCATION_ID;
                        const dispatched = order ? (totalDispatchedByOrderId.get(order.id) || 0) : 0;
                        const orderQty = order ? Number(order.qty || 0) : 0;
                        const pending = order ? Math.max(0, orderQty - dispatched) : 0;
                        const rate = isDirectAlloc ? Number(itemRow.defaultRate || 0) : order ? Number(order.rate || 0) : 0;
                        const amount = calculateRoundedInvoiceLine(
                          Number(alloc.qty || 0),
                          rate,
                          itemRow.gstRate,
                          gstSupplyType === "INTER_STATE"
                        ).amount;
                        const otherAllocated = itemRow.allocations
                          .filter((a) => a.id !== alloc.id)
                          .reduce((s, a) => s + Number(a.qty || 0), 0);
                        const maxAllowed = Math.max(0, Number(itemRow.totalQty || 0) - otherAllocated);
                        const orderOptions = Array.from(
                          new Map(
                            [
                              ...pendingOrdersForItem,
                              ...(order && order.status !== "Cancelled" ? [order] : []),
                            ].map((entry) => [entry.id, entry])
                          ).values()
                        );

                        return (
                          <tr key={alloc.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                            <td className="px-2 py-2">
                              <div className="text-[11px] font-bold uppercase truncate max-w-[220px]">{itemName}</div>
                            </td>
                            <td className="px-2 py-2">
                              <select
                                value={alloc.orderId}
                                onChange={(e) => updateAllocation(itemRow.id, alloc.id, { orderId: e.target.value })}
                                className="w-full border-2 border-black rounded p-1 text-[11px] font-bold focus:ring-0"
                              >
                                <option value="">-- Choose Order --</option>
                                {alloc.orderId === DIRECT_ALLOCATION_ID ? <option value={DIRECT_ALLOCATION_ID}>Direct Loading</option> : null}
                                {orderOptions.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.orderNo} | {o.poNumber || "No PO"}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-right text-[11px] font-medium">{isDirectAlloc ? "-" : order ? orderQty.toLocaleString() : "-"}</td>
                            <td className="px-2 py-2 text-right text-[11px] font-medium text-slate-500">{isDirectAlloc ? "-" : order ? dispatched.toLocaleString() : "-"}</td>
                            <td className="px-2 py-2 text-right text-[11px] font-black text-indigo-700">{isDirectAlloc ? "Direct" : order ? pending.toLocaleString() : "-"}</td>
                            <td className="px-2 py-2 text-right text-[11px] font-bold">{rate || "-"}</td>
                            <td className="px-2 py-2 text-right bg-indigo-50/30">
                              <input
                                type="number"
                                value={Number(alloc.qty || 0) || ""}
                                min={0}
                                max={maxAllowed}
                                onChange={(e) => updateAllocation(itemRow.id, alloc.id, { qty: e.target.value === "" ? 0 : parseFloat(e.target.value) })}
                                className="w-24 px-1 py-1 border-2 border-indigo-600 rounded text-right text-[11px] font-black focus:ring-0"
                              />
                            </td>
                            <td className="px-2 py-2 text-right text-[11px]">
                              <select
                                value={itemRow.gstRate}
                                onChange={(e) => updateItemGstRate(itemRow.id, Number(e.target.value))}
                                className="w-20 border border-black rounded px-2 py-1 text-right text-[11px] font-bold bg-white"
                              >
                                {[0, 5, 12, 18, 28].map((v) => (
                                  <option key={v} value={v}>
                                    {v}%
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-right text-[11px] font-black">{format2(amount)}</td>
                            <td className="px-2 py-2 text-center">
                              <button onClick={() => removeAllocationRow(itemRow.id, alloc.id)} className="text-rose-600 hover:text-rose-800">
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      });

                      return [parentRow, ...childRows];
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-black divide-y divide-black">
                    <tr className="divide-x divide-black">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase font-black">Total Before GST</td>
                      <td className="px-3 py-2 text-right text-[11px] font-black">{format2(calculations.totalBeforeGst)}</td>
                      <td></td>
                    </tr>
                    {gstSupplyType === "INTER_STATE" ? (
                       <tr className="divide-x divide-black text-slate-500">
                        <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total IGST</td>
                        <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.igst)}</td>
                        <td></td>
                      </tr>
                    ) : (
                      <>
                        <tr className="divide-x divide-black text-slate-500">
                          <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total CGST</td>
                          <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.cgst)}</td>
                          <td></td>
                        </tr>
                        <tr className="divide-x divide-black text-slate-500">
                          <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total SGST</td>
                          <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.sgst)}</td>
                          <td></td>
                        </tr>
                      </>
                    )}
                    {(calculations.otherChargesCgst || calculations.otherChargesSgst || calculations.otherChargesIgst) ? (
                      <tr className="divide-x divide-black text-slate-500">
                        <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Other Charges GST</td>
                        <td className="px-3 py-2 text-right text-[11px]">
                          {format2(calculations.otherChargesCgst + calculations.otherChargesSgst + calculations.otherChargesIgst)}
                        </td>
                        <td></td>
                      </tr>
                    ) : null}
                    <tr className="divide-x divide-black">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase text-slate-500">Other Charges</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={otherCharges}
                            onChange={(e) => setOtherCharges(e.target.value === "" ? "" : parseFloat(e.target.value))}
                            className="w-24 px-2 py-1 border border-black rounded text-right text-[11px] font-bold"
                          />
                          <select
                            value={otherChargesGstRate}
                            onChange={(e) => setOtherChargesGstRate(e.target.value === "" ? "" : Number(e.target.value))}
                            className="w-24 border border-black rounded px-2 py-1 text-right text-[11px] font-bold bg-white"
                            title="Blank means non-taxable"
                          >
                            <option value="">No GST</option>
                            {OTHER_CHARGES_GST_RATES.map((rate) => (
                              <option key={rate} value={rate}>
                                {rate}%
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td></td>
                    </tr>
                    <tr className="divide-x divide-black text-slate-500">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase">Total After GST</td>
                      <td className="px-3 py-2 text-right text-[11px]">{format2(calculations.totalAfterGst)}</td>
                      <td></td>
                    </tr>
                    <tr className="divide-x divide-black">
                      <td colSpan={8} className="px-3 py-2 text-right text-[10px] uppercase italic text-slate-400">Round Off</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={isRoundOffManual ? roundOff : calculations.roundOff}
                            onChange={(e) => {
                              setIsRoundOffManual(true);
                              setRoundOff(e.target.value === "" ? "" : parseFloat(e.target.value));
                            }}
                            className="w-24 px-2 py-1 border border-black rounded text-right text-[11px] font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setRoundOff("");
                              setIsRoundOffManual(false);
                            }}
                            className="rounded border border-black bg-white px-2 py-1 text-[10px] font-black uppercase text-black hover:bg-slate-50"
                            title={`Auto round off: ${format2(calculations.autoRoundOff)}`}
                          >
                            Auto
                          </button>
                        </div>
                      </td>
                      <td></td>
                    </tr>
                    <tr className="divide-x divide-black bg-slate-900 text-white">
                      <td colSpan={8} className="px-3 py-3 text-right text-xs uppercase tracking-widest font-black">Grand Total</td>
                      <td className="px-3 py-3 text-right text-lg font-black">{format2(calculations.grandTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              
              <div className="space-y-1 text-[11px] font-bold text-slate-600">
                <div>
                  Use <span className="font-black text-black">Add Order</span> on an item to split quantities across orders.
                </div>
                {shouldShowTransporter ? (
                  <div className="text-amber-700">Transporter is required because Truck No is Other on the selected loading slip.</div>
                ) : null}
              </div>

              <div className="flex justify-between items-center bg-slate-50 p-4 border-t-2 border-black -mx-6 -mb-6 sticky bottom-0">
                <div className="text-[10px] font-bold text-slate-500 uppercase">
                   Loaded Total: <span className="text-black font-black">
                    {invoiceModal.slips.reduce((sum, s) => sum + s.lines.reduce((lSum: number, l: any) => lSum + Number(l.loadedQty || 0), 0), 0).toLocaleString()}
                   </span>
                </div>
                <div className="flex gap-3">
                    <button 
                    onClick={closeInvoiceModal}
                    className="px-8 py-3 border-2 border-black font-black uppercase text-xs tracking-widest hover:bg-white transition"
                    >
                    Cancel
                    </button>
                    <button 
                    onClick={handleSubmitInvoice}
                    disabled={isSubmitting || calculations.totalBeforeGst <= 0}
                    className="px-10 py-3 bg-indigo-600 text-white border-2 border-black font-black uppercase text-xs tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-700 transition disabled:opacity-50 disabled:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 flex items-center gap-2"
                    >
                    {isSubmitting ? <Spinner size={16} className="text-white" /> : (
                        <>
                        <Check size={18} />
                        Confirm & Save Invoice
                        </>
                    )}
                    </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
