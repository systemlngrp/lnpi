import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, Save } from "lucide-react";
import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { useData } from "../hooks/useData";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getProductionMatchingFields } from "../lib/productionMatching";
import { generateTransactionNo, getProductionJobPrefix, formatDate } from "../lib/serial";
import { cn } from "../lib/utils";
import type { Company, Order, OrderItemSource, OrderSchedule, Production } from "../types";
import type { OrderCatalogItem } from "../lib/orderItems";

type PlanningSource = Extract<OrderItemSource, "PHP" | "PLATE">;
type SortKey = "scheduledDate" | "orderNo" | "companyName" | "fgItemName" | "linkedItemName" | "remainingQty";

type PendingLinkedProductionPlanningProps = {
  source: PlanningSource;
};

type PlanningRow = {
  schedule: OrderSchedule;
  order?: Order;
  company?: Company;
  fgItem?: OrderCatalogItem;
  linkedItem?: OrderCatalogItem;
  isDirectSourceOrder: boolean;
  scheduledQty: number;
  setsPerBox?: number;
  requiredQty: number;
  alreadyPlannedQty: number;
  remainingQty: number;
  selectable: boolean;
  matchStatus: string;
};

const getJobMasterEntityName = (source: PlanningSource) =>
  source === "PHP" ? "php_job_master" : "plate_job_master";

function normalizeErpCode(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function toOptionalNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function toOptionalString(value: unknown) {
  const stringValue = String(value || "").trim();
  return stringValue || undefined;
}

function firstOptionalNumber(...values: unknown[]) {
  for (const value of values) {
    const normalized = toOptionalNumber(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function firstOptionalString(...values: unknown[]) {
  for (const value of values) {
    const normalized = toOptionalString(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function round2(value: number) {
  return parseFloat(value.toFixed(2));
}

function joinPrintingColors(color1?: string, color2?: string) {
  return [color1?.trim(), color2?.trim()].filter(Boolean).join(" / ");
}

function getScheduledQty(schedule: OrderSchedule) {
  return Math.max(Number(schedule.qty || 0) - Number(schedule.canceledQty || 0), 0);
}

function findItemByErp(items: OrderCatalogItem[], erpCode: string) {
  const normalizedErp = normalizeErpCode(erpCode);
  if (!normalizedErp) return undefined;

  return items.find((item) => {
    const raw = item.raw || {};
    return [item.erp, raw.erpItemCode, raw.masterItemNameErpCode].some(
      (value) => normalizeErpCode(value) === normalizedErp
    );
  });
}

function getSetsPerBox(item?: OrderCatalogItem) {
  const raw = item?.raw || {};
  return toOptionalNumber(raw.numberOfSetsPerBox);
}

function buildPlannedProduction({
  source,
  sourceItem,
  transactionNo,
  qty,
  schedule,
  order,
  companyName,
  timestamp,
}: {
  source: PlanningSource;
  sourceItem: OrderCatalogItem;
  transactionNo: string;
  qty: number;
  schedule: OrderSchedule;
  order?: Order;
  companyName?: string;
  timestamp: string;
}): Production {
  const raw = sourceItem.raw || {};
  const setsPerBox = firstOptionalNumber(raw.numberOfSetsPerBox);
  const erpCode = firstOptionalString(raw.erpItemCode, sourceItem.erp, raw.masterItemNameErpCode);
  const printingColor = firstOptionalString(
    joinPrintingColors(raw.printingColour1, raw.printingColour2),
    joinPrintingColors(raw.color1, raw.color2)
  );
  const masterErp = firstOptionalString(order?.erpCode, raw.masterItemNameErpCode);

  const production: Production = {
    id: crypto.randomUUID(),
    transactionNo,
    date: schedule.scheduledDate,
    scheduleId: schedule.id,
    planningId: schedule.id,
    scheduledDate: schedule.scheduledDate,
    itemId: sourceItem.id,
    itemSource: source,
    qty,
    requiredQty: qty,
    plannedQty: qty,
    uom: sourceItem.uom || toOptionalString(raw.uom) || "",
    remarks: `Planned from ${order?.orderNo || "scheduled order"}`,
    status: "Pending Consumption",
    updatedBy: "System User",
    updateTimestamp: timestamp,
    companyName: sourceItem.companyName || companyName,
    masterErp,
    erpCode,
    setsPerBox,
    rate: firstOptionalNumber(raw.rate, sourceItem.rate),
    jobType: firstOptionalString(raw.jobType, raw.boxType, sourceItem.boxType, source),
    methodology: firstOptionalString(raw.methodology),
    sequence: firstOptionalString(raw.sequence),
    jobCompletionTimeOutput: firstOptionalString(raw.jobCompletionTimeOutput, raw.output),
    noOfParts: firstOptionalNumber(raw.noOfParts, raw.numberOfSetsPerBox),
    ups: firstOptionalNumber(raw.ups, raw.noOfUpsForRapc, raw.noOfUpsForCutting),
    length: firstOptionalNumber(raw.length),
    breadth: firstOptionalNumber(raw.breadth),
    height: firstOptionalNumber(raw.height),
    ply: firstOptionalNumber(raw.ply, raw.noOfPly),
    noOfHolesInPhp: firstOptionalNumber(raw.numberOfHolesInPhp),
    flute: firstOptionalString(raw.flute, raw.fluteType),
    fluteType: firstOptionalString(raw.fluteType, raw.flute),
    l1: firstOptionalNumber(raw.l1),
    f1: firstOptionalNumber(raw.f1),
    l2: firstOptionalNumber(raw.l2),
    f2: firstOptionalNumber(raw.f2),
    l3: firstOptionalNumber(raw.l3),
    gsm: firstOptionalNumber(raw.gsm, raw.boardGsmReq, raw.calculatedBGsm),
    boardGsmReq: firstOptionalNumber(raw.boardGsmReq, raw.calculatedBGsm),
    brustingStrengthReq: firstOptionalNumber(raw.brustingStrengthReq),
    printingColor,
    weightPerPcSetReq: firstOptionalNumber(raw.weightPerPcReq, raw.calculatedWeightPerPcReq, raw.totalWeightGrams),
    plateWeight: firstOptionalNumber(raw.plateWeight, raw.weightPerPcReq, raw.totalWeightGrams),
  };

  return {
    ...production,
    ...getProductionMatchingFields(production, sourceItem),
  };
}

function PendingLinkedProductionPlanning({ source }: PendingLinkedProductionPlanningProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowPlannedQty, setRowPlannedQty] = useState<Record<string, number | "">>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("scheduledDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [fgProductions] = useData<Production>("productions", []);
  const [phpJobMaster, setPhpJobMaster] = useData<Production>(getJobMasterEntityName("PHP"), []);
  const [plateJobMaster, setPlateJobMaster] = useData<Production>(getJobMasterEntityName("PLATE"), []);
  const [schedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const { resolveOrderItem, itemsBySource } = useOrderItemCatalog();

  const jobRows = source === "PHP" ? phpJobMaster : plateJobMaster;
  const setJobRows = source === "PHP" ? setPhpJobMaster : setPlateJobMaster;
  const allJobRows = useMemo(() => [...fgProductions, ...phpJobMaster, ...plateJobMaster], [fgProductions, phpJobMaster, plateJobMaster]);
  const sourceItems = itemsBySource[source] || [];
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const plannedQtyByScheduleId = useMemo(() => {
    const map = new Map<string, number>();
    jobRows.forEach((row) => {
      if (!row.scheduleId) return;
      if (row.status === "Cancelled" || row.cancelTimestamp) return;
      const effectiveQty = Math.max(0, Number(row.plannedQty || row.qty || 0));
      if (effectiveQty <= 0) return;
      map.set(row.scheduleId, (map.get(row.scheduleId) || 0) + effectiveQty);
    });
    return map;
  }, [jobRows]);

  const rows = useMemo<PlanningRow[]>(() => {
    return schedules
      .map((schedule) => {
        const order = orders.find((row) => row.id === schedule.orderId);
        const fgItem = resolveOrderItem(order);
        const company = companies.find((row) => row.id === order?.companyId);
        const scheduledQty = getScheduledQty(schedule);
        const isDirectSourceOrder = order?.itemSource === source;
        const scheduleErp = String(order?.erpCode || fgItem?.erp || "").trim();
        const linkedItem = isDirectSourceOrder
          ? sourceItems.find((item) => item.id === String(order?.itemId || "").trim())
          : findItemByErp(sourceItems, scheduleErp);
        const setsPerBox = getSetsPerBox(linkedItem);
        const requiredQty = isDirectSourceOrder
          ? scheduledQty
          : linkedItem && setsPerBox
            ? round2(scheduledQty * setsPerBox)
            : 0;
        const alreadyPlannedQty = Number(plannedQtyByScheduleId.get(schedule.id) || 0);
        const remainingQty = Math.max(0, round2(requiredQty - alreadyPlannedQty));

        let matchStatus = "Ready";
        let selectable = true;
        if (!linkedItem) {
          matchStatus = isDirectSourceOrder ? `No ${source} item found for direct order` : `No ${source} master match for ERP`;
          selectable = false;
        } else if (!isDirectSourceOrder && !setsPerBox) {
          matchStatus = "Sets/Pcs per box missing";
          selectable = false;
        } else if (remainingQty <= 0) {
          matchStatus = "Already fully planned";
          selectable = false;
        }

        return {
          schedule,
          order,
          company,
          fgItem,
          linkedItem,
          isDirectSourceOrder,
          scheduledQty,
          setsPerBox,
          requiredQty,
          alreadyPlannedQty,
          remainingQty,
          selectable,
          matchStatus,
        };
      })
      .filter((row) => {
        if (row.scheduledQty <= 0 || !row.selectable || !row.linkedItem || row.remainingQty <= 0) return false;
        return row.isDirectSourceOrder || Boolean(row.setsPerBox);
      });
  }, [companies, orders, plannedQtyByScheduleId, resolveOrderItem, schedules, source, sourceItems]);

  const availableCompanies = useMemo(() => {
    const ids = new Set(rows.map((row) => row.company?.id).filter(Boolean));
    return companies.filter((company) => ids.has(company.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, rows]);

  const companyOptions = useMemo(() => availableCompanies.map((company) => ({ value: company.id, label: company.name })), [availableCompanies]);
  const itemOptions = useMemo(() => Array.from(new Map(rows.map((row) => { const item = row.linkedItem || row.fgItem; const erp = String(item?.erp || row.order?.erpCode || ""); const name = item?.name || ""; const key = item?.id || `${name}::${erp}`; return [key, { value: key, label: erp && name && !name.toLowerCase().includes(erp.toLowerCase()) ? `${name} - ${erp}` : name || erp, searchText: `${name} ${erp}` }]; })).values()).filter((option) => option.value && option.label).sort((a, b) => a.label.localeCompare(b.label)), [rows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (selectedCompanyId && row.company?.id !== selectedCompanyId) return false;
      const item = row.linkedItem || row.fgItem;
      const itemKey = item?.id || `${item?.name || ""}::${item?.erp || row.order?.erpCode || ""}`;
      if (selectedItemId && itemKey !== selectedItemId) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        formatDate(row.schedule.scheduledDate),
        row.order?.orderNo,
        row.company?.name,
        row.fgItem?.name,
        row.fgItem?.erp,
        row.linkedItem?.name,
        row.linkedItem?.erp,
        row.matchStatus,
        String(row.remainingQty || ""),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    });

    return filtered.sort((a, b) => {
      let compare = 0;
      switch (sortKey) {
        case "scheduledDate":
          compare = new Date(a.schedule.scheduledDate).getTime() - new Date(b.schedule.scheduledDate).getTime();
          break;
        case "orderNo":
          compare = String(a.order?.orderNo || "").localeCompare(String(b.order?.orderNo || ""), undefined, { numeric: true, sensitivity: "base" });
          break;
        case "companyName":
          compare = String(a.company?.name || "").localeCompare(String(b.company?.name || ""), undefined, { sensitivity: "base" });
          break;
        case "fgItemName":
          compare = String(a.fgItem?.name || "").localeCompare(String(b.fgItem?.name || ""), undefined, { sensitivity: "base" });
          break;
        case "linkedItemName":
          compare = String(a.linkedItem?.name || "").localeCompare(String(b.linkedItem?.name || ""), undefined, { sensitivity: "base" });
          break;
        case "remainingQty":
          compare = a.remainingQty - b.remainingQty;
          break;
      }
      return sortDirection === "asc" ? compare : -compare;
    });
  }, [rows, searchTerm, selectedCompanyId, selectedItemId, sortDirection, sortKey]);

  const { page, setPage, pageSize, setPageSize, totalItems, paginatedItems } = useClientPagination(filteredRows, 25);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const renderSortHeader = (label: string, key: SortKey, align: "left" | "right" = "left") => (
    <button
      type="button"
      onClick={() => handleSort(key)}
      className={cn("inline-flex items-center gap-1 font-bold uppercase", align === "right" ? "ml-auto justify-end" : "justify-start")}
    >
      <span>{label}</span>
      <ArrowUpDown size={12} className={cn(sortKey === key ? "text-indigo-700" : "text-slate-400")} />
    </button>
  );

  const selectableIds = useMemo(
    () => new Set(filteredRows.filter((row) => row.selectable).map((row) => row.schedule.id)),
    [filteredRows]
  );

  const toggleSelect = (scheduleId: string) => {
    const row = rows.find((entry) => entry.schedule.id === scheduleId);
    if (!row?.selectable) return;
    const next = new Set(selectedIds);
    if (next.has(scheduleId)) {
      next.delete(scheduleId);
    } else {
      next.add(scheduleId);
      if (rowPlannedQty[scheduleId] === undefined) {
        setRowPlannedQty((prev) => ({ ...prev, [scheduleId]: row.remainingQty }));
      }
    }
    setSelectedIds(next);
  };

  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    const next = new Set<string>();
    const nextQty = { ...rowPlannedQty };
    filteredRows.forEach((row) => {
      if (!row.selectable) return;
      next.add(row.schedule.id);
      if (nextQty[row.schedule.id] === undefined) {
        nextQty[row.schedule.id] = row.remainingQty;
      }
    });
    setSelectedIds(next);
    setRowPlannedQty(nextQty);
  };

  const totalSelectedQty = useMemo(() => {
    return Array.from(selectedIds).reduce((sum, id) => sum + Number(rowPlannedQty[id] || 0), 0);
  }, [rowPlannedQty, selectedIds]);

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      alert(`Please select at least one ${source} planning row.`);
      return;
    }

    const selectedRows = rows.filter((row) => selectedIds.has(row.schedule.id));
    const validationErrors: string[] = [];
    selectedRows.forEach((row) => {
      const plannedQty = Number(rowPlannedQty[row.schedule.id] ?? row.remainingQty);
      if (!row.selectable) {
        validationErrors.push(`${row.order?.orderNo || row.schedule.id}: ${row.matchStatus}`);
        return;
      }
      if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
        validationErrors.push(`${row.order?.orderNo || row.schedule.id}: Planned qty must be greater than 0.`);
      }
      if (plannedQty > row.remainingQty) {
        validationErrors.push(`${row.order?.orderNo || row.schedule.id}: Planned qty cannot exceed ${row.remainingQty.toLocaleString()}.`);
      }
    });

    if (validationErrors.length > 0) {
      alert(validationErrors[0]);
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const draftRows: Production[] = [];
      selectedRows.forEach((row) => {
        if (!row.linkedItem) return;
        const transactionNo = generateTransactionNo(getProductionJobPrefix(source), [...draftRows, ...allJobRows], row.schedule.scheduledDate || todayStr);
        draftRows.push(
          buildPlannedProduction({
            source,
            sourceItem: row.linkedItem,
            transactionNo,
            qty: Number(rowPlannedQty[row.schedule.id] ?? row.remainingQty),
            schedule: row.schedule,
            order: row.order,
            companyName: row.company?.name,
            timestamp,
          })
        );
      });

      await setJobRows((prev) => [...draftRows, ...prev]);
      setSelectedIds(new Set());
      setRowPlannedQty({});
      alert(`${source} jobs created successfully.`);
    } catch (error) {
      console.error(`Failed to create ${source} jobs:`, error);
      alert(`Failed to create ${source} jobs. Please check console for details.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = source === "PHP" ? "Pending PHP Planning" : "Pending Plate Planning";
  const description = source === "PHP"
    ? "Create PHP jobs from direct PHP orders or scheduled FG orders using ERP matching and Sets/Pcs per box."
    : "Create Plate jobs from direct Plate orders or scheduled FG orders using ERP matching and Sets/Pcs per box.";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-black pb-4">
          <div>
            <h2 className="text-2xl font-black text-black tracking-tight uppercase">{title}</h2>
            <p className="text-sm font-medium text-slate-600 uppercase">{description}</p>
          </div>
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-700 transition flex items-center border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1"
              >
                <Save size={18} className="mr-2" />
                {isSubmitting ? "Saving..." : `Create Jobs (${selectedIds.size})`}
              </button>
            )}
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 border-2 border-black rounded-xl text-xs font-bold bg-white hover:bg-slate-50 transition uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              Back
            </button>
          </div>
        </div>

        <div className="bg-white border-2 border-black rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[240px] space-y-1">
              <div className="text-indigo-700 font-bold text-[10px] uppercase tracking-wider">Search Orders</div>
              <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder={`Search ${source} planning rows...`} />
            </div>
            <div className="min-w-[220px] flex-1 space-y-1">
              <div className="text-indigo-700 font-bold text-[10px] uppercase tracking-wider">Filter by Company</div>
              <Select
                value={selectedCompanyId}
                onChange={(value) => {
                  setSelectedCompanyId(value);
                  setSelectedIds(new Set());
                }}
                options={companyOptions}
                placeholder="All Companies"
              />
            </div>
            <div className="min-w-[260px] flex-1 space-y-1">
              <div className="text-indigo-700 font-bold text-[10px] uppercase tracking-wider">Filter by Item</div>
              <Select
                value={selectedItemId}
                onChange={(value) => {
                  setSelectedItemId(value);
                  setSelectedIds(new Set());
                }}
                options={itemOptions}
                placeholder="All Items"
              />
            </div>
            {(selectedCompanyId || selectedItemId || searchTerm) && (
              <button
                onClick={() => {
                  setSelectedCompanyId("");
                  setSelectedItemId("");
                  setSearchTerm("");
                  setSelectedIds(new Set());
                }}
                className="text-[10px] font-black uppercase text-red-600 hover:text-red-800 underline pb-2"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black border-collapse border border-black">
            <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
              <tr className="divide-x divide-black">
                <th className="px-4 py-3 text-center border border-black w-10">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-black text-indigo-600 focus:ring-indigo-600"
                    checked={paginatedItems.length > 0 && paginatedItems.filter((row) => row.selectable).every((row) => selectedIds.has(row.schedule.id))}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Scheduled Date", "scheduledDate")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">Schedule No</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Order No", "orderNo")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("Company", "companyName")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader("FG Item", "fgItemName")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">Main ERP</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">{renderSortHeader(`${source} Item`, "linkedItemName")}</th>
                <th className="px-4 py-3 text-right text-xs text-black uppercase border border-black">Scheduled Qty</th>
                <th className="px-4 py-3 text-right text-xs text-black uppercase border border-black">Sets/Pcs</th>
                <th className="px-4 py-3 text-right text-xs text-black uppercase border border-black">Required Qty</th>
                <th className="px-4 py-3 text-right text-xs text-black uppercase border border-black">Already Planned</th>
                <th className="px-4 py-3 text-right text-xs text-black uppercase border border-black">{renderSortHeader("Remaining Qty", "remainingQty", "right")}</th>
                <th className="px-4 py-3 text-left text-xs text-black uppercase border border-black">Status</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-black uppercase border border-black w-36">Planned Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black bg-white">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-6 py-8 text-center text-black font-medium">No pending {source} planning rows found.</td>
                </tr>
              ) : (
                paginatedItems.map((row) => {
                  const scheduleId = row.schedule.id;
                  const plannedValue = rowPlannedQty[scheduleId] !== undefined ? rowPlannedQty[scheduleId] : row.remainingQty;
                  return (
                    <tr key={scheduleId} className={cn("hover:bg-slate-50 divide-x divide-black", selectedIds.has(scheduleId) && "bg-indigo-50/50", !row.selectable && "bg-amber-50")}>
                      <td className="px-4 py-4 text-center border border-black">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-black text-indigo-600 focus:ring-indigo-600 cursor-pointer disabled:opacity-40"
                          checked={selectedIds.has(scheduleId)}
                          disabled={!row.selectable}
                          onChange={() => toggleSelect(scheduleId)}
                        />
                      </td>
                      <td className="px-4 py-4 text-xs font-bold border border-black whitespace-nowrap">{formatDate(row.schedule.scheduledDate)}</td>
                      <td className="px-4 py-4 text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">{row.schedule.scheduleNo || "-"}</td>
                      <td className="px-4 py-4 text-xs border border-black whitespace-nowrap">{row.order?.orderNo || "-"}</td>
                      <td className="px-4 py-4 text-xs border border-black">{row.company?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs border border-black">{row.isDirectSourceOrder ? "Direct Order" : row.fgItem?.name || "-"}</td>
                      <td className="px-4 py-4 text-xs border border-black whitespace-nowrap">{String(row.order?.erpCode || row.fgItem?.erp || "-")}</td>
                      <td className="px-4 py-4 text-xs border border-black">{row.linkedItem?.name || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-indigo-700 border border-black whitespace-nowrap">{row.scheduledQty.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs border border-black whitespace-nowrap">{row.isDirectSourceOrder ? "Direct" : row.setsPerBox?.toLocaleString() || "-"}</td>
                      <td className="px-4 py-4 text-right text-xs border border-black whitespace-nowrap">{row.requiredQty.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs border border-black whitespace-nowrap">{row.alreadyPlannedQty.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-xs font-bold text-emerald-700 border border-black whitespace-nowrap">{row.remainingQty.toLocaleString()}</td>
                      <td className="px-4 py-4 text-xs border border-black">{row.matchStatus}</td>
                      <td className="px-2 py-2 border border-black">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!row.selectable}
                          value={plannedValue}
                          onChange={(e) => setRowPlannedQty((prev) => ({ ...prev, [scheduleId]: e.target.value === "" ? "" : Number(e.target.value) }))}
                          className="w-full border border-slate-300 rounded p-1 text-right text-[11px] focus:outline-none focus:border-indigo-600 font-bold disabled:bg-slate-100 disabled:cursor-not-allowed"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {selectedIds.size > 0 && (
              <tfoot className="bg-slate-100 border-t-2 border-black">
                <tr className="divide-x divide-black font-black">
                  <td colSpan={14} className="px-4 py-3 text-right text-xs uppercase text-slate-600">Total Planned for Submission:</td>
                  <td className="px-4 py-3 text-right text-sm text-indigo-700 bg-indigo-50 border border-black">{totalSelectedQty.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <ClientPagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}

export function PendingPhpPlanning() {
  return <PendingLinkedProductionPlanning source="PHP" />;
}

export function PendingPlatePlanning() {
  return <PendingLinkedProductionPlanning source="PLATE" />;
}
