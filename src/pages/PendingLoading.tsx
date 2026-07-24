import React, { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../hooks/useData";
import {
  DispatchPlan,
  Truck,
  Item,
  Order,
  Company,
  LoadingSlip,
  LoadingSlipAllocation,
  LoadingSlipLine,
  Production,
  PackingDetail,
  LinkedLoadingDetail,
  OrderItemSource,
} from "../types";
import {
  Truck as TruckIcon,
  Package,
  Search,
  X,
  Check,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import { useNpdItems } from "../hooks/useNpdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { normalizeOrderItemSource } from "../lib/orderItems";
import { buildLinkedLoadingDetailsFromSlip, findLinkedItemByMasterErp, getLinkedSetsPerBox } from "../lib/linkedLoading";
import { upsertFgLinkedChildSlip } from "../lib/linkedLoadingSlipSync";
import { buildPhpPlateStockAlertMessage, getPhpPlateStockShortages } from "../lib/phpPlateStockValidation";
import { normalizeTruckStatus } from "../lib/truckStatus";

interface PendingPlan extends DispatchPlan {
  companyName: string;
  itemSource: OrderItemSource;
  orderNo: string;
  pendingQty: number;
}

interface GroupedPlan {
  companyId: string;
  companyName: string;
  itemSource: OrderItemSource;
  itemId: string;
  itemName: string;
  plans: PendingPlan[];
}

interface LoadingModalState {
  companyId: string;
  itemSource: OrderItemSource;
  itemId: string;
  itemName: string;
  plans: PendingPlan[];
}

interface JobOption {
  jobId: string;
  jobNo: string;
  ffg: number;
}

type LinkedSide = Extract<OrderItemSource, "PHP" | "PLATE">;

function createEmptyPackingRows(): PackingDetail[] {
  return [{ bundles: 0, packSize: 0, quantity: 0 }];
}

function getLoadingSlipJobAllocations(line: LoadingSlipLine): Array<{ jobId: string; jobNo: string; qty: number }> {
  if (Array.isArray(line.allocations) && line.allocations.length > 0) {
    return line.allocations
      .filter((allocation): allocation is Extract<LoadingSlipAllocation, { sourceType: "job" }> => allocation.sourceType === "job")
      .map((allocation) => ({
        jobId: allocation.jobId,
        jobNo: allocation.jobNo,
        qty: Number(allocation.qty || 0),
      }));
  }

  return [];
}

export function PendingLoading() {
  const [plans, updatePlans, plansLoading] = useData<DispatchPlan>("dispatch_plans", []);
  const [trucks] = useData<Truck>("trucks", []);
  const npdItems = useNpdItems();
  const { resolveOrderItem, itemsBySource } = useOrderItemCatalog();
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [productions] = useData<Production>("productions", []);
  const [phpJobs] = useData<Production>("php_job_master", []);
  const [plateJobs] = useData<Production>("plate_job_master", []);
  const [phpItemMaster] = useData<any>("php_item_master", []);
  const [plateItemMaster] = useData<any>("plate_item_master", []);
  const [loadingSlips, updateLoadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [phpLoadingSlips, updatePhpLoadingSlips] = useData<LoadingSlip>("php_loading_slips", []);
  const [plateLoadingSlips, updatePlateLoadingSlips] = useData<LoadingSlip>("plate_loading_slips", []);

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);
  const [loadingModal, setLoadingModal] = useState<LoadingModalState | null>(null);
  const [loadedQuantities, setLoadedQuantities] = useState<Record<string, number>>({});
  const [jobSplitQtys, setJobSplitQtys] = useState<Record<string, Record<string, number | "">>>({});
  const [openingStockQtys, setOpeningStockQtys] = useState<Record<string, number | "">>({});
  const [cancelingPlanId, setCancelingPlanId] = useState<string | null>(null);
  const [cancelQty, setCancelQty] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [modalTruckId, setModalTruckId] = useState<string>("");
  const [modalManualTruckNo, setModalManualTruckNo] = useState("");
  const availableTrucks = useMemo(
    () => trucks
      .filter((truck) => {
        const status = normalizeTruckStatus(truck.liveStatus);
        const isInternal = String(truck.truckType || "").trim().toLowerCase() === "internal";
        return isInternal && (!status || status === "EMPTY");
      })
      .sort((a, b) => a.truckNo.localeCompare(b.truckNo)),
    [trucks]
  );
  const [packingDetails, setPackingDetails] = useState<PackingDetail[]>(createEmptyPackingRows());
  const [extraItemsQty, setExtraItemsQty] = useState<number | "">("");
  const [linkedPackingDetails, setLinkedPackingDetails] = useState<Record<LinkedSide, PackingDetail[]>>({
    PHP: createEmptyPackingRows(),
    PLATE: createEmptyPackingRows(),
  });
  const [linkedExtraItemsQty, setLinkedExtraItemsQty] = useState<Record<LinkedSide, number | "">>({
    PHP: "",
    PLATE: "",
  });

  const allProductionJobs = useMemo(() => [...productions, ...phpJobs, ...plateJobs], [phpJobs, plateJobs, productions]);
  const productionMap = useMemo(() => new Map(allProductionJobs.map((production) => [production.id, production])), [allProductionJobs]);

  const isOpenJob = (production?: Production | null) => {
    if (!production) return false;
    if (production.status === "Cancelled" || production.cancelTimestamp) return false;
    if (production.status === "Completed" || production.tallyTimestamp) return false;
    if (production.closeDate) return false;
    if (String(production.closeBy || "").trim().toLowerCase() === "yes") return false;
    return true;
  };

  const existingLoadedByJobId = useMemo(() => {
    const map = new Map<string, number>();
    loadingSlips.forEach((slip) => {
      if (slip.status === "Cancelled") return;
      slip.lines.forEach((line) => {
        getLoadingSlipJobAllocations(line).forEach((allocation) => {
          map.set(allocation.jobId, (map.get(allocation.jobId) || 0) + allocation.qty);
        });
      });
    });
    return map;
  }, [loadingSlips]);

  const groupedData = useMemo(() => {
    const filtered = plans.filter((plan) => {
      const pending = Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0);
      if (pending <= 0) return false;

      const order = orders.find((row) => row.id === plan.orderId);
      const item = resolveOrderItem(order);
      const company = companies.find((row) => row.id === order?.companyId);

      const searchBlob = `${item?.name || ""} ${company?.name || ""} ${order?.orderNo || ""}`.toLowerCase();
      return searchBlob.includes(searchTerm.toLowerCase());
    });

    const map = new Map<string, GroupedPlan>();

    filtered.forEach((plan) => {
      const order = orders.find((row) => row.id === plan.orderId);
      const item = resolveOrderItem(order);
      const company = companies.find((row) => row.id === order?.companyId);
      if (!item || !company) return;

      const itemSource = normalizeOrderItemSource(order?.itemSource || item.source);
      const key = `${company.id}::${itemSource}::${item.id}`;
      if (!map.has(key)) {
        map.set(key, {
          companyId: company.id,
          companyName: company.name,
          itemSource,
          itemId: item.id,
          itemName: item.name,
          plans: [],
        });
      }

      const group = map.get(key)!;
      group.plans.push({
        ...plan,
        companyName: company.name,
        itemSource,
        orderNo: order?.orderNo || "N/A",
        pendingQty: Number(plan.plannedQty || 0) - Number(plan.loadedQty || 0) - Number(plan.canceledQty || 0),
      });
    });

    const result = Array.from(map.values()).sort((a, b) => a.companyName.localeCompare(b.companyName));
    
    // Group results by company for the UI
    const final: Array<{ companyId: string; companyName: string; items: GroupedPlan[] }> = [];
    result.forEach(group => {
      let companyGroup = final.find(f => f.companyId === group.companyId);
      if (!companyGroup) {
        companyGroup = { companyId: group.companyId, companyName: group.companyName, items: [] };
        final.push(companyGroup);
      }
      companyGroup.items.push(group);
    });

    return final;
  }, [companies, orders, plans, resolveOrderItem, searchTerm]);

  useEffect(() => {
    if (didInitExpand.current) return;
    if (groupedData.length === 0) return;
    didInitExpand.current = true;
    setExpandedCompanies(new Set(groupedData.map((group) => group.companyId)));
  }, [groupedData]);

  const currentAdjustmentByJobId = useMemo(() => {
    const map = new Map<string, number>();
    Object.values(jobSplitQtys).forEach((byJobId) => {
      Object.entries(byJobId).forEach(([jobId, qty]) => {
        if (!jobId) return;
        map.set(jobId, (map.get(jobId) || 0) + Number(qty || 0));
      });
    });
    return map;
  }, [jobSplitQtys]);

  const getPlanOpeningStockQty = (key: string) => Number(openingStockQtys[key] || 0);
  const getAlreadyLoadedForJob = (jobId: string) => existingLoadedByJobId.get(jobId) || 0;

  const isTruckAvailableForLoading = (truckId: string) => {
    const truck = trucks.find((row) => row.id === truckId);
    if (!truck) return false;
    const isInternal = String(truck.truckType || "").trim().toLowerCase() === "internal";
    const status = normalizeTruckStatus(truck.liveStatus);
    return isInternal && (!status || status === "EMPTY");
  };

  useEffect(() => {
    if (!modalTruckId) return;
    if (isTruckAvailableForLoading(modalTruckId)) return;
    setModalTruckId("");
  }, [modalTruckId, trucks]);

  const getRemainingCapacityForJob = (jobId: string, currentRowQty = 0) => {
    const production = productionMap.get(jobId);
    const jobSource = normalizeOrderItemSource(production?.itemSource);
    const ffg = Number(jobSource === "FG" ? production?.prodFromFFG || 0 : production?.productionOutputQty || 0);
    const alreadyLoaded = getAlreadyLoadedForJob(jobId);
    const currentAdjustments = currentAdjustmentByJobId.get(jobId) || 0;
    return Math.max(0, ffg - alreadyLoaded - currentAdjustments + currentRowQty);
  };

  const getModalKey = (companyId: string, itemSource: OrderItemSource, itemId: string) => `${companyId}::${itemSource}::${itemId}`;

  const getModalValidation = (modal: LoadingModalState) => {
    const modalKey = getModalKey(modal.companyId, modal.itemSource, modal.itemId);
    const rowLoadedQty = Number(loadedQuantities[modalKey] || 0);
    const byJobId = jobSplitQtys[modalKey] || {};
    const openingStockQty = getPlanOpeningStockQty(modalKey);
    const jobAllocatedTotal = Object.values(byJobId).reduce<number>((sum, qty) => sum + Number(qty || 0), 0);
    const allocatedTotal = jobAllocatedTotal + openingStockQty;
    const errors: string[] = [];

    const totalPending = modal.plans.reduce((sum, plan) => sum + Number(plan.pendingQty || 0), 0);

    const truckNoInput = modalManualTruckNo.trim();
    if (!truckNoInput) errors.push("Please enter truck number.");
    if (modalTruckId && !isTruckAvailableForLoading(modalTruckId)) errors.push("Selected truck is not an EMPTY internal truck. Please select another truck.");
    if (rowLoadedQty <= 0) errors.push("Loaded qty must be greater than 0.");
    if (rowLoadedQty > totalPending + 0.0001) errors.push("Loaded qty cannot exceed total pending for loading.");

    Object.entries(byJobId).forEach(([jobId, qty]) => {
      const value = Number(qty || 0);
      if (value <= 0) return;
      const remainingCapacity = getRemainingCapacityForJob(jobId, value);
      if (value > remainingCapacity + 0.0001) {
        errors.push("Adjust Now cannot exceed Yet to Load for a job.");
      }
    });

    const stockLabel = modal.itemSource === "FG" ? "FG Stock" : `${modal.itemSource} Stock`;
    if (openingStockQty < 0) errors.push(`${stockLabel} quantity cannot be negative.`);
    if (allocatedTotal <= 0) errors.push("At least one positive adjustment is required.");
    if (Math.abs(allocatedTotal - rowLoadedQty) > 0.0001) errors.push(`Job/${stockLabel} total must exactly match Loaded qty.`);

    const packingTotal = packingDetails.reduce((sum, d) => sum + Number(d.quantity || 0), 0) + Number(extraItemsQty || 0);
    if (Math.abs(packingTotal - rowLoadedQty) > 0.0001) {
      errors.push(`Packing Details total (${packingTotal.toLocaleString()}) must match Loaded qty (${rowLoadedQty.toLocaleString()}).`);
    }

    return { isValid: errors.length === 0, errors, allocatedTotal, openingStockQty, totalPending, packingTotal };
  };

  const modalHasErrors = useMemo(() => {
    if (!loadingModal) return false;
    return !getModalValidation(loadingModal).isValid;
  }, [jobSplitQtys, loadedQuantities, loadingModal, openingStockQtys, currentAdjustmentByJobId, existingLoadedByJobId, productionMap, modalTruckId, modalManualTruckNo, packingDetails, extraItemsQty]);

  const handleOpenLoad = (companyId: string, itemSource: OrderItemSource, itemId: string, itemName: string, itemPlans: PendingPlan[]) => {
    setLoadingModal({ companyId, itemSource, itemId, itemName, plans: itemPlans });
    const modalKey = getModalKey(companyId, itemSource, itemId);
    const totalPending = itemPlans.reduce((sum, plan) => sum + Number(plan.pendingQty || 0), 0);

    const sourceJobs = itemSource === "PHP" ? phpJobs : itemSource === "PLATE" ? plateJobs : productions;
    const eligibleJobs = sourceJobs
      .filter((p) => 
        p.itemId === itemId && 
        isOpenJob(p) &&
        Number(itemSource === "FG" ? p.prodFromFFG || 0 : p.productionOutputQty || 0) > 0
      )
      .map((p) => {
        const ffg = Number(itemSource === "FG" ? p.prodFromFFG || 0 : p.productionOutputQty || 0);
        const alreadyLoaded = getAlreadyLoadedForJob(p.id);
        return { jobId: p.id, jobNo: String(p.transactionNo || "").trim(), ffg, yetToLoad: Math.max(0, ffg - alreadyLoaded) };
      })
      .filter((j) => j.jobNo && j.yetToLoad > 0)
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" }));

    setLoadedQuantities({ [modalKey]: totalPending });
    setOpeningStockQtys({ [modalKey]: "" });
    setJobSplitQtys({
      [modalKey]: Object.fromEntries(eligibleJobs.map((j) => [j.jobId, ""])),
    });
    setModalTruckId("");
    setModalManualTruckNo("");
    setPackingDetails(createEmptyPackingRows());
    setExtraItemsQty("");
    setLinkedPackingDetails({ PHP: createEmptyPackingRows(), PLATE: createEmptyPackingRows() });
    setLinkedExtraItemsQty({ PHP: "", PLATE: "" });
  };

  const handleCloseLoad = () => {
    setLoadingModal(null);
    setLoadedQuantities({});
    setJobSplitQtys({});
    setOpeningStockQtys({});
    setModalTruckId("");
    setModalManualTruckNo("");
    setPackingDetails(createEmptyPackingRows());
    setExtraItemsQty("");
    setLinkedPackingDetails({ PHP: createEmptyPackingRows(), PLATE: createEmptyPackingRows() });
    setLinkedExtraItemsQty({ PHP: "", PLATE: "" });
  };

  const getPreviewLinkedDetails = (source: LinkedSide, loadedQty: number): LinkedLoadingDetail[] => {
    if (!loadingModal || !(loadedQty > 0)) return [];
    const firstPlan = loadingModal.plans[0];
    const order = orders.find((row) => row.id === firstPlan?.orderId);
    const fgItem = resolveOrderItem(order);
    const sourceItems = itemsBySource[source] || [];
    const itemErp = String(order?.erpCode || fgItem?.erp || "").trim();
    const linkedItem = findLinkedItemByMasterErp(sourceItems, itemErp);
    const setsPerBox = getLinkedSetsPerBox(linkedItem);
    if (!linkedItem || !setsPerBox) return [];
    const raw = linkedItem.raw || {};
    const sidePackingDetails = linkedPackingDetails[source]
      .filter((row) => Number(row.bundles || 0) > 0 && Number(row.packSize || 0) > 0)
      .map((row) => ({
        bundles: Number(row.bundles || 0),
        packSize: Number(row.packSize || 0),
        quantity: Number(row.quantity || 0),
      }));
    return [{
      source,
      itemId: linkedItem.id,
      itemName: linkedItem.name,
      companyName: linkedItem.companyName,
      erpCode: itemErp || undefined,
      masterErp: String(raw.masterItemNameErpCode || "").trim() || undefined,
      setsPerBox,
      requiredQty: parseFloat((loadedQty * setsPerBox).toFixed(2)),
      packingDetails: sidePackingDetails.length > 0 ? sidePackingDetails : undefined,
      extraItemsQty: Number(linkedExtraItemsQty[source] || 0) || undefined,
    }];
  };

  const handleAddPackingRow = () => {
    setPackingDetails([...packingDetails, { bundles: 0, packSize: 0, quantity: 0 }]);
  };

  const handleRemovePackingRow = (index: number) => {
    const next = [...packingDetails];
    next.splice(index, 1);
    setPackingDetails(next);
  };

  const handleUpdatePackingRow = (index: number, field: keyof PackingDetail, value: number) => {
    const next = [...packingDetails];
    const row = { ...next[index], [field]: value };
    row.quantity = row.bundles * row.packSize;
    next[index] = row;
    setPackingDetails(next);
  };

  const getLinkedPackingTotal = (source: LinkedSide) =>
    linkedPackingDetails[source].reduce((sum, row) => sum + Number(row.quantity || 0), 0) + Number(linkedExtraItemsQty[source] || 0);

  const handleAddLinkedPackingRow = (source: LinkedSide) => {
    setLinkedPackingDetails((prev) => ({
      ...prev,
      [source]: [...prev[source], { bundles: 0, packSize: 0, quantity: 0 }],
    }));
  };

  const handleRemoveLinkedPackingRow = (source: LinkedSide, index: number) => {
    setLinkedPackingDetails((prev) => {
      const nextRows = [...prev[source]];
      nextRows.splice(index, 1);
      return {
        ...prev,
        [source]: nextRows.length > 0 ? nextRows : createEmptyPackingRows(),
      };
    });
  };

  const handleUpdateLinkedPackingRow = (source: LinkedSide, index: number, field: keyof PackingDetail, value: number) => {
    setLinkedPackingDetails((prev) => {
      const nextRows = [...prev[source]];
      const row = { ...nextRows[index], [field]: value };
      row.quantity = row.bundles * row.packSize;
      nextRows[index] = row;
      return {
        ...prev,
        [source]: nextRows,
      };
    });
  };

  const handleSubmitLoading = async () => {
    if (!loadingModal) return;

    const modalKey = getModalKey(loadingModal.companyId, loadingModal.itemSource, loadingModal.itemId);
    const rowLoadedQty = Number(loadedQuantities[modalKey] || 0);
    const validation = getModalValidation(loadingModal);

    if (!validation.isValid) {
      alert(validation.errors[0] || "Loading data is invalid.");
      return;
    }

    if (modalTruckId && !isTruckAvailableForLoading(modalTruckId)) {
      alert("Selected truck is not an EMPTY internal truck. Please select another truck.");
      setModalTruckId("");
      return;
    }

    const byJobId = jobSplitQtys[modalKey] || {};
    const allocationPool: LoadingSlipAllocation[] = [];

    Object.entries(byJobId).forEach(([jobId, qty]) => {
      const value = Number(qty || 0);
      if (!jobId || value <= 0) return;
      const production = productionMap.get(jobId);
      const jobNo = String(production?.transactionNo || "").trim();
      if (!jobNo) return;
      allocationPool.push({ sourceType: "job", jobId, jobNo, qty: value });
    });

    const openingStockQty = getPlanOpeningStockQty(modalKey);
    if (openingStockQty > 0) {
      allocationPool.push({ sourceType: "opening_stock", sourceRef: loadingModal.itemSource === "FG" ? "FG Stock" : `${loadingModal.itemSource} Stock`, qty: openingStockQty });
    }

    const sortedPlans = [...loadingModal.plans].sort((a, b) =>
      (a.planNo || "").localeCompare(b.planNo || "", undefined, { numeric: true, sensitivity: "base" })
    );

    const consumeFromPool = (need: number) => {
      const allocations: LoadingSlipAllocation[] = [];
      let remaining = need;
      while (remaining > 0.0001 && allocationPool.length > 0) {
        const head = allocationPool[0];
        const take = Math.min(remaining, Number(head.qty || 0));
        if (take <= 0) {
          allocationPool.shift();
          continue;
        }
        allocations.push({ ...(head as any), qty: take });
        remaining -= take;
        const left = Number(head.qty || 0) - take;
        if (left <= 0.0001) allocationPool.shift();
        else allocationPool[0] = { ...(head as any), qty: left };
      }
      return { allocations, remaining };
    };

    const lines: LoadingSlipLine[] = [];
    let remainingToDistribute = rowLoadedQty;
    for (const plan of sortedPlans) {
      if (remainingToDistribute <= 0.0001) break;
      const planPending = Math.max(0, Number(plan.pendingQty || 0));
      const planLoad = Math.min(planPending, remainingToDistribute);
      if (planLoad <= 0.0001) continue;

      const consumed = consumeFromPool(planLoad);
      if (consumed.remaining > 0.0001) {
        alert("Job split allocations are insufficient to cover Loaded qty.");
        return;
      }

      const order = orders.find((row) => row.id === plan.orderId);
      const item = resolveOrderItem(order);
      lines.push({
        dispatchPlanId: plan.id,
        loadedQty: planLoad,
        allocations: consumed.allocations,
        companyId: loadingModal.companyId,
        companyName: plan.companyName,
        itemId: loadingModal.itemId,
        itemName: item?.name,
        itemSource: loadingModal.itemSource,
        erpCode: String(order?.erpCode || item?.erp || "").trim() || undefined,
        rate: Number(order?.rate ?? item?.rate ?? 0) || undefined,
        gstRate: Number((item as any)?.gstRate ?? 18),
        uom: item?.uom,
      });
      remainingToDistribute -= planLoad;
    }

    if (remainingToDistribute > 0.0001) {
      alert("Unable to distribute Loaded qty across pending dispatch plans.");
      return;
    }

    setIsSubmitting(true);
    try {
      const baseSlip: LoadingSlip = {
        id: crypto.randomUUID(),
        slipNo: "",
        date: new Date().toISOString().slice(0, 10),
        truckId: modalTruckId,
        truckNo: modalManualTruckNo.trim() || trucks.find((truck) => truck.id === modalTruckId)?.truckNo || undefined,
        lines,
        packingDetails: packingDetails.filter(d => d.bundles > 0 && d.packSize > 0),
        extraItemsQty: Number(extraItemsQty || 0) || undefined,
      };
      const phpDetails = buildLinkedLoadingDetailsFromSlip({
        slip: baseSlip,
        source: "PHP",
        plans,
        orders,
        resolveOrderItem,
        sourceItems: itemsBySource.PHP || [],
      }).map((detail) => ({
        ...detail,
        packingDetails: linkedPackingDetails.PHP.filter((row) => Number(row.bundles || 0) > 0 && Number(row.packSize || 0) > 0),
        extraItemsQty: Number(linkedExtraItemsQty.PHP || 0) || undefined,
      }));
      const plateDetails = buildLinkedLoadingDetailsFromSlip({
        slip: baseSlip,
        source: "PLATE",
        plans,
        orders,
        resolveOrderItem,
        sourceItems: itemsBySource.PLATE || [],
      }).map((detail) => ({
        ...detail,
        packingDetails: linkedPackingDetails.PLATE.filter((row) => Number(row.bundles || 0) > 0 && Number(row.packSize || 0) > 0),
        extraItemsQty: Number(linkedExtraItemsQty.PLATE || 0) || undefined,
      }));
      const newSlip: LoadingSlip = {
        ...baseSlip,
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
        parentFgLoadingId: newSlip.id,
      });
      if (shortages.length > 0) {
        alert(buildPhpPlateStockAlertMessage(shortages));
        return;
      }

      await updateLoadingSlips((prev) => [...prev, newSlip]);
      await updatePhpLoadingSlips((prev) => upsertFgLinkedChildSlip({ prevSlips: prev, parentSlip: newSlip, details: phpDetails, source: "PHP" }));
      await updatePlateLoadingSlips((prev) => upsertFgLinkedChildSlip({ prevSlips: prev, parentSlip: newSlip, details: plateDetails, source: "PLATE" }));

      await updatePlans((prev) =>
        prev.map((plan) => {
          const line = lines.find((row) => row.dispatchPlanId === plan.id);
          if (!line) return plan;
          const nextLoaded = Number(plan.loadedQty || 0) + line.loadedQty;
          const remaining = Math.max(0, Number(plan.plannedQty || 0) - nextLoaded - Number(plan.canceledQty || 0));
          return {
            ...plan,
            loadedQty: nextLoaded,
            canceledQty: Number(plan.canceledQty || 0) + remaining,
          };
        })
      );

      handleCloseLoad();
    } catch (err) {
      console.error("Failed to submit loading:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelClick = (plan: PendingPlan) => {
    setCancelingPlanId(plan.id);
    setCancelQty(plan.pendingQty);
  };

  const handleCancelPlan = async (planId: string) => {
    if (cancelQty === "" || Number(cancelQty) <= 0) return;

    setIsSubmitting(true);
    try {
      await updatePlans((prev) =>
        prev.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                canceledQty: Number(plan.canceledQty || 0) + Number(cancelQty),
              }
            : plan
        )
      );
      setCancelingPlanId(null);
      setCancelQty("");
    } catch (err) {
      console.error("Failed to cancel plan:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black pb-4">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Pending Loading</h2>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search company, item, order..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-black rounded focus:outline-none focus:ring-1 focus:ring-black text-sm"
          />
        </div>
      </div>

      {plansLoading ? (
        <div className="flex justify-center p-12">
          <Spinner />
        </div>
      ) : groupedData.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium">No pending loading plans found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedData.map((company) => (
            <div key={company.companyId} className="bg-white border border-black rounded shadow-sm overflow-hidden">
              <button
                onClick={() => {
                  const next = new Set(expandedCompanies);
                  if (next.has(company.companyId)) next.delete(company.companyId);
                  else next.add(company.companyId);
                  setExpandedCompanies(next);
                }}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 transition-colors border-b border-black"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-600 text-white p-1.5 rounded shadow-inner">
                    <TruckIcon size={18} />
                  </div>
                  <span className="font-bold text-lg text-black uppercase">{company.companyName}</span>
                  <span className="text-xs font-black bg-black text-white px-2 py-0.5 rounded-full uppercase">
                    {company.items.length} {company.items.length === 1 ? "Item" : "Items"}
                  </span>
                </div>
                {expandedCompanies.has(company.companyId) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </button>

              {expandedCompanies.has(company.companyId) ? (
                <div className="p-4 space-y-8">
                  {company.items.map((itemGroup) => (
                    <div key={itemGroup.itemId} className="space-y-3">
                      <div className="flex items-center justify-between px-2 py-1 bg-indigo-50 border-l-4 border-indigo-600">
                        <div className="flex items-center gap-2">
                          <Package size={18} className="text-indigo-600" />
                          <span className="font-bold text-sm text-black uppercase tracking-wider">{itemGroup.itemName}</span>
                        </div>
                        <button
                          onClick={() => handleOpenLoad(company.companyId, itemGroup.itemSource, itemGroup.itemId, itemGroup.itemName, itemGroup.plans)}
                          className="bg-black text-white px-5 py-2 rounded text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition shadow-[4px_4px_0px_0px_rgba(79,70,229,1)] active:shadow-none active:translate-y-[2px]"
                        >
                          LOAD ITEM
                        </button>
                      </div>

                      <div className="table-frozen-scroll border border-black">
                        <table className="min-w-full divide-y divide-black border-collapse">
                          <thead className="sticky top-0 z-30 bg-slate-50">
                            <tr className="divide-x divide-black">
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-600">Order No</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-600">Plan No</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-600">Planned</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-600">Loaded</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wider text-indigo-700">Pending</th>
                              <th className="px-3 py-2 text-center text-[10px] font-black uppercase tracking-wider text-slate-600">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-black">
                            {itemGroup.plans.map((plan) => (
                              <tr key={plan.id} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                                <td className="px-3 py-2 text-xs font-medium text-black">{plan.orderNo}</td>
                                <td className="px-3 py-2 text-xs font-bold text-slate-500">{plan.planNo || "-"}</td>
                                <td className="px-3 py-2 text-xs text-right text-black">{Number(plan.plannedQty || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 text-xs text-right text-emerald-700 font-bold">{Number(plan.loadedQty || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 text-xs text-right font-black text-indigo-700 bg-indigo-50/20">{plan.pendingQty.toLocaleString()}</td>
                                <td className="px-3 py-2 text-center">
                                  {cancelingPlanId === plan.id ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <input
                                        type="number"
                                        value={cancelQty}
                                        onChange={(e) => setCancelQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                        className="w-16 px-1 py-0.5 border-2 border-red-500 rounded text-[10px] font-bold focus:outline-none"
                                        autoFocus
                                      />
                                      <button
                                        onClick={() => handleCancelPlan(plan.id)}
                                        disabled={isSubmitting || cancelQty === "" || Number(cancelQty) <= 0}
                                        className="p-1 bg-red-600 text-white rounded hover:bg-red-700 transition shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                      >
                                        <Check size={12} />
                                      </button>
                                      <button
                                        onClick={() => setCancelingPlanId(null)}
                                        className="p-1 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition"
                                      >
                                        <X size={12} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => handleCancelClick(plan)}
                                      className="text-red-700 hover:text-white hover:bg-red-700 text-[10px] font-black uppercase border border-red-200 px-3 py-1 rounded bg-red-50 transition-all active:scale-95"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {loadingModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl max-h-[92vh] border-2 border-black rounded shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b-2 border-black sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <TruckIcon size={20} className="text-indigo-400" />
                <h3 className="font-black uppercase tracking-widest text-sm">Loading Slip - {companies.find(c => c.id === loadingModal.companyId)?.name}</h3>
              </div>
              <button onClick={handleCloseLoad} className="hover:rotate-90 transition-transform duration-200 bg-white/10 p-1 rounded">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-8 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-50 p-4 border border-black rounded shadow-inner">
                  <div className="text-[10px] text-slate-500 uppercase font-black mb-1">Item Being Loaded</div>
                  <div className="font-bold text-black text-sm">{loadingModal.itemName}</div>
                </div>
                
                <div className="bg-slate-50 p-4 border border-black rounded shadow-inner">
                  <div className="text-[10px] text-slate-500 uppercase font-black mb-1">Loading Date</div>
                  <div className="font-bold text-black text-sm">{formatDate(new Date().toISOString())}</div>
                </div>

                <div className="bg-slate-50 p-4 border border-black rounded shadow-inner flex flex-col justify-center">
                  <div className="text-[10px] text-slate-500 uppercase font-black mb-1">Truck Number *</div>
                  <input
                    list="pending-loading-truck-options"
                    value={modalManualTruckNo}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      const match = availableTrucks.find((truck) => truck.truckNo.trim().toUpperCase() === value.trim().toUpperCase());
                      setModalManualTruckNo(value);
                      setModalTruckId(match?.id || "");
                    }}
                    placeholder="Select or enter truck no"
                    className="w-full border-2 border-black rounded p-1 text-sm font-bold uppercase focus:outline-none focus:border-indigo-600 bg-white"
                  />
                  <datalist id="pending-loading-truck-options">
                    {availableTrucks.map((truck) => (
                      <option key={truck.id} value={truck.truckNo} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-6">
                {(() => {
                  const modalKey = getModalKey(loadingModal.companyId, loadingModal.itemSource, loadingModal.itemId);
                  const totalPlanned = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.plannedQty || 0), 0);
                  const totalLoaded = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.loadedQty || 0), 0);
                  const totalCancelled = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.canceledQty || 0), 0);
                  const totalPending = loadingModal.plans.reduce((sum, plan) => sum + Number(plan.pendingQty || 0), 0);
                  const rowLoadedQty = Number(loadedQuantities[modalKey] || 0);
                  const validation = getModalValidation(loadingModal);
                  const phpDetailsPreview = getPreviewLinkedDetails("PHP", rowLoadedQty);
                  const plateDetailsPreview = getPreviewLinkedDetails("PLATE", rowLoadedQty);

                  const modalSourceJobs = loadingModal.itemSource === "PHP" ? phpJobs : loadingModal.itemSource === "PLATE" ? plateJobs : productions;
                  const jobs = modalSourceJobs
                    .filter((p) => 
                      p.itemId === loadingModal.itemId && 
                      isOpenJob(p) &&
                      Number(loadingModal.itemSource === "FG" ? p.prodFromFFG || 0 : p.productionOutputQty || 0) > 0
                    )
                    .map((p) => {
                      const ffg = Number(loadingModal.itemSource === "FG" ? p.prodFromFFG || 0 : p.productionOutputQty || 0);
                      const alreadyLoaded = getAlreadyLoadedForJob(p.id);
                      const yetToLoad = Math.max(0, ffg - alreadyLoaded);
                      return { jobId: p.id, jobNo: String(p.transactionNo || "").trim(), ffg, alreadyLoaded, yetToLoad };
                    })
                    .filter((j) => j.jobNo && j.yetToLoad > 0)
                    .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true, sensitivity: "base" }));

                  return (
                    <div className="space-y-6">
                      <div className="border-2 border-black rounded overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 bg-slate-900 text-white">
                          <div className="px-4 py-3 border-r border-white/20">
                            <div className="text-[10px] uppercase text-slate-400 font-black">Planned Total</div>
                            <div className="font-black text-lg">{totalPlanned.toLocaleString()}</div>
                          </div>
                          <div className="px-4 py-3 border-r border-white/20">
                            <div className="text-[10px] uppercase text-slate-400 font-black">Yet to Load</div>
                            <div className="font-black text-lg text-indigo-400">{totalPending.toLocaleString()}</div>
                          </div>
                          <div className="px-4 py-3 border-r border-white/20 bg-indigo-900/40">
                            <div className="text-[10px] uppercase text-indigo-200 font-black">Load Quantity</div>
                            <input
                              type="number"
                              value={rowLoadedQty || ""}
                              onChange={(e) => {
                                const nextValue = e.target.value === "" ? 0 : parseFloat(e.target.value);
                                setLoadedQuantities((prev) => ({
                                  ...prev,
                                  [modalKey]: Math.min(Math.max(nextValue, 0), totalPending),
                                }));
                              }}
                              max={totalPending}
                              min={0}
                              className="mt-1 w-full rounded bg-yellow-100 px-2 py-1 border-2 border-yellow-400 text-xl font-black text-black focus:outline-none"
                            />
                          </div>
                          <div className="px-4 py-3">
                            <div className="text-[10px] uppercase text-slate-400 font-black">Balance</div>
                            <div className={cn("text-xl font-black", Math.abs(validation.allocatedTotal - rowLoadedQty) < 0.0001 ? "text-emerald-400" : "text-rose-400")}>
                              {(rowLoadedQty - validation.allocatedTotal).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="table-frozen-scroll">
                          <table className="min-w-full divide-y divide-black border-collapse">
                            <thead className="sticky top-0 z-30 bg-slate-50">
                              <tr className="divide-x divide-black">
                                <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">Job Allocation</th>
                                <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider">Prod (FG)</th>
                                <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider">Already Loaded</th>
                                <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider text-emerald-700">Available</th>
                                <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider bg-indigo-50">Load Now</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black bg-white">
                              {jobs.map((job) => {
                                const currentValue = jobSplitQtys[modalKey]?.[job.jobId] ?? "";
                                return (
                                  <tr key={job.jobId} className="divide-x divide-black hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3 text-xs font-black text-black">{job.jobNo}</td>
                                    <td className="px-4 py-3 text-right text-xs text-slate-600 font-medium">{job.ffg.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-xs text-slate-600 font-medium">{job.alreadyLoaded.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-xs font-black text-emerald-700">{job.yetToLoad.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-right bg-indigo-50/30">
                                      <input
                                        type="number"
                                        value={currentValue}
                                        min={0}
                                        max={job.yetToLoad}
                                        onChange={(e) => {
                                          const next = e.target.value === "" ? "" : Math.min(parseFloat(e.target.value), job.yetToLoad);
                                          setJobSplitQtys((prev) => ({
                                            ...prev,
                                            [modalKey]: { ...(prev[modalKey] || {}), [job.jobId]: next },
                                          }));
                                        }}
                                        className="w-28 rounded border-2 border-yellow-500 bg-yellow-100 px-2 py-1.5 text-right font-black text-xs text-black focus:ring-0"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr className="divide-x divide-black bg-emerald-50/40 border-t-2 border-black">
                                <td className="px-4 py-4 text-xs font-black uppercase text-emerald-800">{loadingModal.itemSource === "FG" ? "FG Stock" : `${loadingModal.itemSource} Stock`}</td>
                                <td className="px-4 py-4 text-right text-xs text-slate-500">-</td>
                                <td className="px-4 py-4 text-right text-xs text-slate-500">-</td>
                                <td className="px-4 py-4 text-right text-xs text-slate-500">-</td>
                                <td className="px-4 py-2 text-right">
                                  <input
                                    type="number"
                                    value={openingStockQtys[modalKey] ?? ""}
                                    min={0}
                                    onChange={(e) =>
                                      setOpeningStockQtys((prev) => ({
                                        ...prev,
                                        [modalKey]: e.target.value === "" ? "" : parseFloat(e.target.value),
                                      }))
                                    }
                                    className="w-28 rounded border-2 border-yellow-500 bg-yellow-100 px-2 py-1.5 text-right font-black text-xs text-black focus:ring-0"
                                  />
                                </td>
                              </tr>
                            </tbody>
                            <tfoot className="bg-slate-900 text-white font-black border-t-2 border-black">
                                <tr className="divide-x divide-white/20">
                                    <td colSpan={4} className="px-4 py-3 text-right text-xs uppercase tracking-widest">Total Allocated</td>
                                    <td className="px-4 py-3 text-right text-sm">{validation.allocatedTotal.toLocaleString()}</td>
                                </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {[
                          { source: "PHP" as const, title: "PHP Details", rows: phpDetailsPreview, emptyLabel: "No matched PHP item" },
                          { source: "PLATE" as const, title: "Plate Details", rows: plateDetailsPreview, emptyLabel: "No matched Plate item" },
                        ].map((section) => (
                          <div key={section.title} className="border-2 border-black rounded overflow-hidden bg-white">
                            <div className="bg-slate-900 px-4 py-3 text-sm font-black uppercase tracking-wider text-white">{section.title}</div>
                            <table className="min-w-full divide-y divide-black border-collapse">
                              <thead className="sticky top-0 z-30 bg-slate-100">
                                <tr className="divide-x divide-black">
                                  <th className="px-4 py-2 text-left text-[10px] font-black uppercase">SL</th>
                                  <th className="px-4 py-2 text-left text-[10px] font-black uppercase">Item ERP</th>
                                  <th className="px-4 py-2 text-left text-[10px] font-black uppercase">Master ERP</th>
                                  <th className="px-4 py-2 text-left text-[10px] font-black uppercase">{section.title === "PHP Details" ? "PHP Item Name" : "Plate Item Name"}</th>
                                  <th className="px-4 py-2 text-right text-[10px] font-black uppercase">Sets/Box</th>
                                  <th className="px-4 py-2 text-right text-[10px] font-black uppercase">Required Qty</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-black">
                                {section.rows.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="px-4 py-5 text-center text-xs font-semibold text-slate-500">{section.emptyLabel}</td>
                                  </tr>
                                ) : (
                                  section.rows.map((detail, index) => (
                                    <tr key={`${section.title}-${detail.itemId}`} className="divide-x divide-black">
                                      <td className="px-4 py-2 text-xs font-black">{index + 1}</td>
                                      <td className="px-4 py-2 text-xs font-semibold text-slate-700">{detail.erpCode || "-"}</td>
                                      <td className="px-4 py-2 text-xs font-semibold text-slate-700">{detail.masterErp || "-"}</td>
                                      <td className="px-4 py-2 text-xs font-semibold text-black">{detail.itemName}</td>
                                      <td className="px-4 py-2 text-right text-xs font-black text-slate-700">{detail.setsPerBox.toLocaleString()}</td>
                                      <td className="px-4 py-2 text-right text-xs font-black text-indigo-700">{detail.requiredQty.toLocaleString()}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>

                            {section.rows.length > 0 ? (
                              <div className="border-t-2 border-black">
                                <div className="flex items-center justify-between px-4 py-3 bg-indigo-50/60 border-b border-black">
                                  <div className="text-xs font-black uppercase tracking-wider text-black">{section.source} Packing Details</div>
                                  <div className="text-[11px] font-bold text-slate-500">
                                    Total: <span className="text-sm font-black text-emerald-700">{getLinkedPackingTotal(section.source).toLocaleString()}</span>
                                  </div>
                                </div>
                                <table className="min-w-full divide-y divide-black border-collapse">
                                  <thead className="sticky top-0 z-30 bg-slate-100">
                                    <tr className="divide-x divide-black">
                                      <th className="px-4 py-2 text-left text-[10px] font-black uppercase">No. of Bundles</th>
                                      <th className="px-4 py-2 text-left text-[10px] font-black uppercase">Pack Size</th>
                                      <th className="px-4 py-2 text-right text-[10px] font-black uppercase">Quantity</th>
                                      <th className="px-4 py-2 text-center text-[10px] font-black uppercase w-16">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-black">
                                    {linkedPackingDetails[section.source].map((detail, idx) => (
                                      <tr key={`${section.source}-${idx}`} className="divide-x divide-black">
                                        <td className="px-4 py-2">
                                          <input
                                            type="number"
                                            value={detail.bundles || ""}
                                            onChange={(e) => handleUpdateLinkedPackingRow(section.source, idx, "bundles", parseFloat(e.target.value) || 0)}
                                            className="w-full rounded border-2 border-yellow-400 bg-yellow-100 px-2 py-1 text-xs font-bold text-black focus:border-black focus:outline-none"
                                          />
                                        </td>
                                        <td className="px-4 py-2">
                                          <input
                                            type="number"
                                            value={detail.packSize || ""}
                                            onChange={(e) => handleUpdateLinkedPackingRow(section.source, idx, "packSize", parseFloat(e.target.value) || 0)}
                                            className="w-full rounded border-2 border-yellow-400 bg-yellow-100 px-2 py-1 text-xs font-bold text-black focus:border-black focus:outline-none"
                                          />
                                        </td>
                                        <td className="px-4 py-2 text-right text-xs font-black bg-slate-50">
                                          {detail.quantity.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                          <button
                                            onClick={() => handleRemoveLinkedPackingRow(section.source, idx)}
                                            disabled={linkedPackingDetails[section.source].length <= 1}
                                            className="text-rose-600 hover:text-rose-800 disabled:opacity-30"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                    <tr className="bg-emerald-50/30 border-t-2 border-black">
                                      <td colSpan={2} className="px-4 py-3 text-xs font-black uppercase text-emerald-800 italic">Extra ({section.source})</td>
                                      <td className="px-4 py-2">
                                        <input
                                          type="number"
                                          value={linkedExtraItemsQty[section.source] ?? ""}
                                          onChange={(e) =>
                                            setLinkedExtraItemsQty((prev) => ({
                                              ...prev,
                                              [section.source]: e.target.value === "" ? "" : parseFloat(e.target.value),
                                            }))
                                          }
                                          className="w-full rounded border-2 border-yellow-500 bg-yellow-100 px-2 py-1.5 text-right font-black text-xs text-black focus:ring-0"
                                          placeholder={`Enter ${section.source} Extra Qty`}
                                        />
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        <button
                                          onClick={() => handleAddLinkedPackingRow(section.source)}
                                          className="bg-black text-white p-1.5 rounded-full hover:bg-slate-800 transition shadow-[2px_2px_0px_0px_rgba(79,70,229,1)] active:shadow-none"
                                        >
                                          <Plus size={16} />
                                        </button>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-black uppercase tracking-wider text-black flex items-center gap-2">
                                <Package size={16} /> Packing Details
                            </h4>
                            <div className="text-[11px] font-bold text-slate-500">
                                Total: <span className={cn("text-sm font-black", Math.abs(validation.packingTotal - rowLoadedQty) < 0.0001 ? "text-emerald-700" : "text-rose-600")}>
                                    {validation.packingTotal.toLocaleString()}
                                </span> / {rowLoadedQty.toLocaleString()}
                            </div>
                        </div>

                        <div className="border-2 border-black rounded overflow-hidden">
                            <table className="min-w-full divide-y divide-black border-collapse">
                                <thead className="sticky top-0 z-30 bg-slate-100">
                                    <tr className="divide-x divide-black">
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase">No. of Bundles</th>
                                        <th className="px-4 py-2 text-left text-[10px] font-black uppercase">Pack Size</th>
                                        <th className="px-4 py-2 text-right text-[10px] font-black uppercase">Quantity</th>
                                        <th className="px-4 py-2 text-center text-[10px] font-black uppercase w-16">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-black">
                                    {packingDetails.map((detail, idx) => (
                                        <tr key={idx} className="divide-x divide-black">
                                            <td className="px-4 py-2">
                                                <input
                                                    type="number"
                                                    value={detail.bundles || ""}
                                                    onChange={(e) => handleUpdatePackingRow(idx, "bundles", parseFloat(e.target.value) || 0)}
                                                    className="w-full rounded border-2 border-yellow-400 bg-yellow-100 px-2 py-1 text-xs font-bold text-black focus:border-black focus:outline-none"
                                                />
                                            </td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="number"
                                                    value={detail.packSize || ""}
                                                    onChange={(e) => handleUpdatePackingRow(idx, "packSize", parseFloat(e.target.value) || 0)}
                                                    className="w-full rounded border-2 border-yellow-400 bg-yellow-100 px-2 py-1 text-xs font-bold text-black focus:border-black focus:outline-none"
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-right text-xs font-black bg-slate-50">
                                                {detail.quantity.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <button
                                                    onClick={() => handleRemovePackingRow(idx)}
                                                    disabled={packingDetails.length <= 1}
                                                    className="text-rose-600 hover:text-rose-800 disabled:opacity-30"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    <tr className="bg-emerald-50/30 border-t-2 border-black">
                                        <td colSpan={2} className="px-4 py-3 text-xs font-black uppercase text-emerald-800 italic">Extra Items (Loose)</td>
                                        <td className="px-4 py-2">
                                            <input
                                                type="number"
                                                value={extraItemsQty ?? ""}
                                                onChange={(e) => setExtraItemsQty(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                                className="w-full rounded border-2 border-yellow-500 bg-yellow-100 px-2 py-1.5 text-right font-black text-xs text-black focus:ring-0"
                                                placeholder="Enter Extra Qty"
                                            />
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                            <button
                                                onClick={handleAddPackingRow}
                                                className="bg-black text-white p-1.5 rounded-full hover:bg-slate-800 transition shadow-[2px_2px_0px_0px_rgba(79,70,229,1)] active:shadow-none"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-between items-center p-6 bg-slate-50 border-t-2 border-black sticky bottom-0 z-10">
                <div className="flex flex-col">
                    <div className="text-[10px] font-black uppercase text-slate-500">Remaining Balance</div>
                    <div className={cn("text-2xl font-black", Math.abs(getModalValidation(loadingModal).allocatedTotal - Number(loadedQuantities[getModalKey(loadingModal.companyId, loadingModal.itemSource, loadingModal.itemId)] || 0)) < 0.0001 ? "text-emerald-600" : "text-rose-600")}>
                        {(Number(loadedQuantities[getModalKey(loadingModal.companyId, loadingModal.itemSource, loadingModal.itemId)] || 0) - getModalValidation(loadingModal).allocatedTotal).toLocaleString()}
                    </div>
                </div>
                <div className="flex gap-4">
                    <button
                    onClick={handleCloseLoad}
                    className="px-8 py-3 border-2 border-black font-black uppercase text-xs tracking-widest hover:bg-white transition active:translate-y-[2px]"
                    >
                    Cancel
                    </button>
                    <button
                    onClick={handleSubmitLoading}
                    disabled={isSubmitting || modalHasErrors}
                    className="px-10 py-3 bg-indigo-600 text-white border-2 border-black font-black uppercase text-xs tracking-widest shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-700 transition disabled:opacity-50 disabled:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1"
                    >
                    {isSubmitting ? <Spinner size={16} className="text-white" /> : "Confirm & Save Loading"}
                    </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
