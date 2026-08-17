import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { useSearchParams } from "react-router-dom";
import { useData } from "../hooks/useData";
import {
  Company,
  DispatchPlan,
  Item,
  LoadingSlip,
  Order,
  OrderSchedule,
  Production,
  Setting,
  SampleRequest,
} from "../types";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { Select } from "../components/Select";
import { generateTransactionNo, formatDate, getProductionJobPrefix } from "../lib/serial";
import { CircleHelp } from "lucide-react";
import { parseProductionFormVisibleColumns } from "../lib/productionFormColumns";
import { fetchNpdItems } from "../lib/npdItems";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getProductionMatchingFields } from "../lib/productionMatching";
import { buildScheduleConsumptionByScheduleId } from "../lib/productionScheduleQty";
import { findRealizationTargetForDate, parseRealizationTargets } from "../lib/realizationTargets";
import { calculateInternalUps } from "../lib/internalUps";

const getJobMasterEntityName = (source: "PHP" | "PLATE") =>
  source === "PHP" ? "php_job_master" : "plate_job_master";

const REEL_FORMULA_MODE = {
  breadthHeightBased: "breadth-height-based",
  typeBased: "type-based",
} as const;

const CUTTING_SIZE_FORMULA_MODE = {
  currentLogic: "current-logic",
  typeBased: "type-based",
} as const;

const GSM_FORMULA_MODE = {
  currentLogic: "current-logic",
  plyBased: "ply-based",
} as const;

function getReelAsPerCalculationHelpText(formulaMode: string) {
  if (formulaMode === REEL_FORMULA_MODE.typeBased) {
    return "Current setting: TYPE Based Formula. TYPE based logic uses UPS in place of No. of Outs. ROTARY TRAY = ((Length (OD) + Height (OD)) x UPS + 20) / 25.4. 2 PLY LINER, U/C PLATE, Horizontal plate, and Tray = ((Width (OD) x UPS) + 20) / 25.4. die cut sheet = ((Open Width x UPS) + 20) / 25.4. RSC = ((FLAP + Height (OD) + FLAP) x UPS + 20) / 25.4. Other filled types = ((Height (OD) x UPS) + 20) / 25.4.";
  }

  return "Current setting: Breadth/Height Based Formula. If Breadth is blank or 0, use Height x UPS. Otherwise use ((Breadth + Height) x UPS) + ((ID to OD x UPS) + 16).";
}

function getCuttingSizeHelpText(formulaMode: string) {
  if (formulaMode === CUTTING_SIZE_FORMULA_MODE.typeBased) {
    return "Current setting: TYPE Based Logic. If TYPE is 2 PLY ROLL, keep Cutting Size blank. If TYPE is DIE CUT SHEET, use ((Open Length x No. of ups in Cutting (For Plates)) + 20) / 25.4. If TYPE is RSC and PART is 1, use ((2 x (Length (OD) + Width (OD))) + 50) / 25.4. If TYPE is RSC and PART is 2, use ((Length (OD) + Width (OD)) + 50) / 25.4. In other filled cases, use ((Length (OD) x No. of ups in Cutting (For Plates)) + 20) / 25.4.";
  }

  return "Current setting: Current Logic. If Breadth is blank or 0, use Length. If Number of Parts = 1, use ((Length + Breadth) x 2) + (ID to OD 17 x Number of Parts). If Number of Parts = 2, use Length + Breadth + ID to OD 17.";
}

function getGsmHelpText(formulaMode: string) {
  if (formulaMode === GSM_FORMULA_MODE.plyBased) {
    return "Current setting: Ply Based Logic. For 3 Ply: add Top, F1, B1, F2, and B2, then add 50% of F1 and 36% of F2. For 5 Ply: add Top, F1, B1, F2, and B2, then add 36% of F1 and 36% of F2. For 2 Ply: use the same 5 Ply weighting. For 7 Ply: add Top, F1, B1, F2, B2, F3, and B3, then add 36% each of F1, F2, and F3. In this form, B1 uses L2, B2 uses L3, and 7 Ply uses F3 and B3 from Item Master.";
  }

  return "Current setting: Current Logic. L1 + (F1 x Take up Factor) + L2 + (F2 x Take up Factor) + L3.";
}

function joinPrintingColors(color1?: string, color2?: string) {
  return [color1?.trim(), color2?.trim()].filter(Boolean).join(" / ");
}

function normalizeNumericPart(value?: string | number | null): 1 | 2 | null {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "1" || normalized === "SINGLE") return 1;
  if (normalized === "2" || normalized === "2 PART BOX") return 2;
  return null;
}

function round2(value: number) {
  return parseFloat(value.toFixed(2));
}

function roundUpWhole(value: number) {
  return Math.ceil(value);
}

function getMandatoryLayerFields(ply: number) {
  const fieldsByPly: Record<number, Array<"L1" | "F1" | "L2" | "F2" | "L3">> = {
    1: ["L1"],
    2: ["L1", "F1"],
    3: ["L1", "F1", "L2"],
    4: ["L1", "F1", "L2", "F2"],
    5: ["L1", "F1", "L2", "F2", "L3"],
  };
  return fieldsByPly[ply] || [];
}

function isBlankRequiredValue(value: string | number) {
  return value === "" || value === null || value === undefined;
}

function hasLayerDefaultValue(value: unknown) {
  return value !== "" && value !== null && value !== undefined;
}

function getLayerDefaultValue(
  production: Production | undefined,
  item: Item,
  field: "l1" | "f1" | "l2" | "f2" | "l3"
) {
  return hasLayerDefaultValue(production?.[field]) ? production?.[field] : item[field] ?? "";
}

function isPlateItemForProductionForm(order?: Order, item?: Item) {
  const source = String(order?.itemSource || "").trim().toUpperCase();
  const itemLabel = String((item as any)?.boxType || item?.typeName || item?.name || "").trim().toUpperCase();
  return source === "PLATE" || itemLabel.includes("PLATE");
}
function getPendingProductionQty(schedule: OrderSchedule, consumedQty: number) {
  return Math.max(
    Number(schedule.qty || 0) - Number(consumedQty || 0) - Number(schedule.canceledQty || 0),
    0
  );
}

function getScheduleInvoicedQty(scheduleId: string, plans: DispatchPlan[], loadingSlips: LoadingSlip[]) {
  const schedulePlans = plans.filter((plan) => plan.scheduleId === scheduleId);
  const planIds = new Set(schedulePlans.map((plan) => plan.id));

  let invoiced = 0;
  loadingSlips.forEach((slip) => {
    slip.lines.forEach((line) => {
      if (planIds.has(line.dispatchPlanId) && slip.invoiceId) {
        invoiced += Number(line.loadedQty) || 0;
      }
    });
  });

  return invoiced;
}

function createInitialFormData(initialDate: string) {
  return {
    date: initialDate,
    qty: "" as number | "",
    remarks: "",
    noOfParts: "" as number | "",
    ups: "" as number | "",
    length: "" as number | "",
    breadth: "" as number | "",
    height: "" as number | "",
    reelAsPerCalc: "" as number | "",
    noOfUpsInCuttingForPlates: "" as number | "",
    reelActualWithTrimming: "" as number | "",
    cuttingWithTrimming: "" as number | "",
    ply: "" as number | "",
    idToOd: "" as number | "",
    idToOd17: "" as number | "",
    flute: "",
    takeUpFactor: "" as number | "",
    top: "" as number | "",
    l1: "" as number | "",
    f1: "" as number | "",
    l2: "" as number | "",
    f2: "" as number | "",
    l3: "" as number | "",
    gsm: "" as number | "",
    color1: "",
    color2: "",
    printingColor: "",
    paperRequiredNos: "" as number | "",
    topPaperWeightKg: "" as number | "",
    linerWeightKg: "" as number | "",
    totalJobWeight: "" as number | "",
    sheetWeight: "" as number | "",
    plateWeight: "" as number | "",
    totalPaperWeight: "" as number | "",
    rate: "" as number | "",
    totalWeightOfSet: "" as number | "",
    realizationPerKg: "" as number | "",
    companyName: "",
    actualPaperUsed: "" as number | "",
    avgWeight: "" as number | "",
    prodFromSheetPlant: "" as number | "",
    prodFromFFG: "" as number | "",
    wastage: "" as number | "",
    productionInMeter: "" as number | "",
    plannedProductionInMeter: "" as number | "",
    leastGsm: "" as number | "",
    fluteBatches: "",
    erpCodeReel: "",
    lineRequiredNos: "" as number | "",
    erpCode: "",
  };
}

export function ProductionForm() {
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

  const [searchParams, setSearchParams] = useSearchParams();

  const [productions, setProductions] = useData<Production>("productions", []);
  const [phpJobMaster] = useData<Production>(getJobMasterEntityName("PHP"), []);
  const [plateJobMaster] = useData<Production>(getJobMasterEntityName("PLATE"), []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [companies] = useData<Company>("companies", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [sampleRequests, setSampleRequests] = useData<SampleRequest>("sample_requests", []);
  const [settings] = useData<Setting>("settings", []);
  const [npdItems, setNpdItems] = useState<Item[]>([]);
  const { resolveOrderItem } = useOrderItemCatalog();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const urlScheduleId = searchParams.get("scheduleId") || searchParams.get("scheduledId") || "";
  const isScheduleLocked = Boolean(urlScheduleId);
  const [selectedScheduleId, setSelectedScheduleId] = useState(urlScheduleId);
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const [formData, setFormData] = useState(() => createInitialFormData(todayStr));

  useEffect(() => {
    fetchNpdItems()
      .then(setNpdItems)
      .catch((error) => {
        console.error("Failed to fetch NPD items for Production Form:", error);
        setNpdItems([]);
      });
  }, []);

  const consumptionByScheduleId = useMemo(
    () => buildScheduleConsumptionByScheduleId(productions, phpJobMaster, plateJobMaster),
    [phpJobMaster, plateJobMaster, productions]
  );

  const pendingSchedules = useMemo(
    () =>
      schedules
        .filter((schedule) => getPendingProductionQty(schedule, Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0)) > 0)
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.scheduledDate || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.scheduledDate || 0).getTime();
          return timeB - timeA;
        }),
    [consumptionByScheduleId, schedules]
  );

  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach((production) => {
      if ((production.itemSource || "FG") !== "FG" || production.status === "Cancelled" || production.cancelTimestamp) return;

      const erp = String(production.erpCode || "").trim();
      const gsm = Number(production.gsm || 0);
      if (erp && gsm > 0) {
        if (!map.has(erp) || gsm < map.get(erp)!) {
          map.set(erp, gsm);
        }
      }
    });
    return map;
  }, [productions]);

  const erpLowestGsmProductionMap = useMemo(() => {
    const map = new Map<string, Production>();
    productions.forEach((production) => {
      if ((production.itemSource || "FG") !== "FG" || production.status === "Cancelled" || production.cancelTimestamp) return;

      const erp = String(production.erpCode || "").trim();
      const gsm = Number(production.gsm || 0);
      if (!erp || gsm <= 0) return;

      const existing = map.get(erp);
      if (!existing || gsm < Number(existing.gsm || 0)) {
        map.set(erp, production);
      }
    });
    return map;
  }, [productions]);

  const selectedSchedule = pendingSchedules.find((schedule) => schedule.id === selectedScheduleId);
  const selectedOrder = orders.find((order) => order.id === selectedSchedule?.orderId);
  const selectedItem = npdItems.find((item) => item.id === String(selectedOrder?.itemId || "").trim());
  const selectedInternalUps = calculateInternalUps((selectedItem as any)?.rapcForSingleBox);
  const selectedCompany = companies.find((company) => company.id === selectedOrder?.companyId);
  const selectedErp = String(selectedOrder?.erpCode || "").trim();
  const selectedScheduleConsumedQty = selectedSchedule
    ? Number(consumptionByScheduleId.get(selectedSchedule.id)?.effectiveConsumedQty || 0)
    : 0;
  const pendingQty = selectedSchedule ? getPendingProductionQty(selectedSchedule, selectedScheduleConsumedQty) : 0;
  const selectedScheduleInvoicedQty = selectedSchedule
    ? getScheduleInvoicedQty(selectedSchedule.id, plans, loadingSlips)
    : 0;
  const selectedOrderQty = Number(selectedOrder?.qty || 0);
  const balanceOrderQty = selectedSchedule
    ? Math.max(
        (Number(selectedSchedule.qty) || 0) -
          (Number(selectedSchedule.canceledQty) || 0) -
          selectedScheduleInvoicedQty,
        0
      )
    : 0;
  const selectedLowestGsmProduction = selectedErp ? erpLowestGsmProductionMap.get(selectedErp) : undefined;
  const reelFormulaMode = settings[0]?.reelAsPerCalculation || REEL_FORMULA_MODE.breadthHeightBased;
  const cuttingSizeFormulaMode = settings[0]?.cuttingSizeAsPerCalculation || CUTTING_SIZE_FORMULA_MODE.currentLogic;
  const gsmFormulaMode = settings[0]?.gsmAsPerCalculation || GSM_FORMULA_MODE.currentLogic;
  const realizationTargets = useMemo(
    () => parseRealizationTargets(settings[0]?.realizationPerKgTargets),
    [settings]
  );
  const selectedRealizationTarget = useMemo(
    () => findRealizationTargetForDate(realizationTargets, formData.date),
    [formData.date, realizationTargets]
  );
  const visibleColumns = useMemo(
    () => new Set(parseProductionFormVisibleColumns(settings[0]?.productionFormVisibleColumns)),
    [settings]
  );
  const showField = (label: string) => visibleColumns.has(label);

  const latestRelevantProduction = useMemo(
    () =>
      [...productions]
        .filter((production) => (production.itemSource || "FG") === "FG" && production.status !== "Cancelled" && !production.cancelTimestamp)
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
          return timeB - timeA;
        })[0],
    [productions]
  );

  const lastItem = npdItems.find((item) => item.id === String(latestRelevantProduction?.itemId || "").trim());
  const lastPlanQty = Number(latestRelevantProduction?.qty || 0);
  const isSameAsLastItem = Boolean(selectedItem?.id && lastItem?.id && selectedItem.id === lastItem.id);

  const pendingSampleRows = useMemo(() => {
    if (!selectedItem?.id) return [];

    return [...sampleRequests]
      .filter(
        (row) =>
          String(row.itemId || "").trim() === selectedItem.id &&
          !row.cancelTimestamp &&
          (row.jobCardNo === "" || row.jobCardNo === null || row.jobCardNo === undefined)
      )
      .sort((a, b) => {
        const timeA = new Date(a.updateTimestamp || a.timestamp || a.date || 0).getTime();
        const timeB = new Date(b.updateTimestamp || b.timestamp || b.date || 0).getTime();
        return timeB - timeA;
      });
  }, [sampleRequests, selectedItem?.id]);

  const sampleItemQty = pendingSampleRows.length > 0 ? Number(pendingSampleRows[0].plannedQuantity || 0) : 0;
  const isSampleItem = pendingSampleRows.length > 0;
  const sampleItemLabel = isSampleItem ? "YES" : "NO";
  const matchedSampleRequest = pendingSampleRows[0];
  const deviationAllowed = Number(selectedCompany?.deviationAllowed ?? 25);

  const pendingOrderQtyForItem = useMemo(() => {
    if (!selectedItem?.id) return 0;

    return schedules.reduce((sum, schedule) => {
      const order = orders.find((row) => row.id === schedule.orderId);
      if (!order || String(order.itemId || "").trim() !== selectedItem.id) return sum;

      const invoiced = getScheduleInvoicedQty(schedule.id, plans, loadingSlips);
      const pendingOrderQty = Math.max(
        (Number(schedule.qty) || 0) - (Number(schedule.canceledQty) || 0) - invoiced,
        0
      );

      return pendingOrderQty > 0 ? sum + pendingOrderQty : sum;
    }, 0);
  }, [selectedItem?.id, schedules, orders, plans, loadingSlips]);

  const productionInProgress = useMemo(() => {
    if (!selectedItem?.id) return 0;

    return productions
      .filter((production) => {
        const prodFromFFGValue = production.prodFromFFG;
        const hasFFGValue = !(prodFromFFGValue === null || prodFromFFGValue === undefined || String(prodFromFFGValue) === "");

        return String(production.itemId || "").trim() === selectedItem.id && !production.cancelTimestamp && !hasFFGValue;
      })
      .reduce((sum, production) => sum + (Number(production.qty) || 0), 0);
  }, [productions, selectedItem?.id]);

  const maximumAllowedProduction = Math.max(
    pendingOrderQtyForItem - Number(selectedItem?.balance || 0) - productionInProgress,
    0
  );

  const currentQty = Number(formData.qty || 0);
  const isSelectedPlateItem = isPlateItemForProductionForm(selectedOrder, selectedItem);
  const mandatoryLayerFields = getMandatoryLayerFields(Number(formData.ply)).filter((label) => showField(label));
  const missingMandatoryLayerFields = mandatoryLayerFields.filter((label) => {
    const fieldName = label.toLowerCase() as "l1" | "f1" | "l2" | "f2" | "l3";
    return isBlankRequiredValue(formData[fieldName]);
  });
  const hasMissingMandatoryLayerFields = missingMandatoryLayerFields.length > 0;
  const isLayerRequired = (label: "L1" | "F1" | "L2" | "F2" | "L3") => mandatoryLayerFields.includes(label);
  const reelActualTrimMissing = showField("Reel Actual Trim") && Number(formData.reelActualWithTrimming || 0) <= 0;
  const allJobRows = useMemo(() => [...productions, ...phpJobMaster, ...plateJobMaster], [productions, phpJobMaster, plateJobMaster]);
  const currentGsm = Number(formData.gsm || 0);
  const leastGsm = Number(formData.leastGsm || 0);
  const deviationLimit = isSameAsLastItem ? Number((lastPlanQty * (deviationAllowed / 100)).toFixed(2)) : 0;
  const maximumDeviationQty =
    isSameAsLastItem && lastPlanQty > 0
      ? Number((lastPlanQty + deviationLimit).toFixed(2))
      : 0;

  const quantityDeviationError =
    !isSampleItem &&
    isSameAsLastItem &&
    currentQty > 0 &&
    maximumDeviationQty > 0 &&
    currentQty > maximumDeviationQty;

  const maximumAllowedProductionError =
    currentQty > 0 &&
    maximumAllowedProduction > 0 &&
    currentQty > maximumAllowedProduction;

  const gsmValidationError =
    !isSampleItem &&
    !isSameAsLastItem &&
    currentGsm > 0 &&
    leastGsm > 0 &&
    currentGsm > leastGsm;

  const realizationValue = Number(formData.realizationPerKg || 0);
  const realizationTargetValue = Number(selectedRealizationTarget?.value || 0);
  const realizationBelowTarget =
    Boolean(selectedRealizationTarget) &&
    realizationValue > 0 &&
    realizationTargetValue > 0 &&
    realizationValue < realizationTargetValue;

  useEffect(() => {
    if (selectedItem) {
      setFormData((prev) => ({
        ...prev,
        companyName: selectedCompany?.name || "",
        rate: selectedOrder?.rate ?? "",
        erpCode: String(selectedOrder?.erpCode || ""),
        noOfParts: selectedItem.noOfParts ?? "",
        ups: selectedInternalUps ?? selectedItem.ups ?? "",
        length: selectedItem.length ?? "",
        breadth: selectedItem.breadth ?? "",
        height: selectedItem.height ?? "",
        ply: selectedItem.ply ?? "",
        flute: selectedItem.flute || "",
        plateWeight: selectedItem.plateWeight ?? "",
        top: selectedItem.l1 ?? "",
        takeUpFactor: selectedItem.takeUpFactor ?? "",
        l1: getLayerDefaultValue(selectedLowestGsmProduction, selectedItem, "l1"),
        f1: getLayerDefaultValue(selectedLowestGsmProduction, selectedItem, "f1"),
        l2: getLayerDefaultValue(selectedLowestGsmProduction, selectedItem, "l2"),
        f2: getLayerDefaultValue(selectedLowestGsmProduction, selectedItem, "f2"),
        l3: getLayerDefaultValue(selectedLowestGsmProduction, selectedItem, "l3"),
        color1: selectedItem.printingColour1 || "",
        color2: selectedItem.printingColour2 || "",
        printingColor: joinPrintingColors(selectedItem.printingColour1, selectedItem.printingColour2),
      }));
    }
  }, [selectedItem, selectedCompany, selectedOrder, selectedLowestGsmProduction, selectedInternalUps]);

  useEffect(() => {
    if (!selectedScheduleId) {
      setFormData((prev) => ({ ...prev, date: todayStr }));
      return;
    }
    if (!selectedSchedule) return;
    setFormData((prev) => ({ ...prev, date: selectedSchedule.scheduledDate || todayStr }));
  }, [selectedScheduleId, selectedSchedule?.id, todayStr]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      qty: isSampleItem ? sampleItemQty : "",
    }));
  }, [selectedScheduleId, selectedItem?.id, isSampleItem, sampleItemQty]);

  useEffect(() => {
    const ply = Number(formData.ply);
    const length = Number(formData.length);
    const breadth = Number(formData.breadth);
    const height = Number(formData.height);
    const ups = Number(formData.ups);
    const noOfParts = Number(formData.noOfParts);
    const qty = Number(formData.qty);
    const rate = Number(formData.rate);
    const plateWeight = Number(formData.plateWeight);
    const noOfUpsInCuttingForPlates = Number(formData.noOfUpsInCuttingForPlates);
    const lOd = Number(selectedItem?.lOd || 0);
    const wOd = Number(selectedItem?.wOd || 0);
    const hOd = Number(selectedItem?.hOd || 0);
    const flap = Number(selectedItem?.flap || 0);
    const openWidth = Number(selectedItem?.openWidth || 0);
    const openLength = Number(selectedItem?.openLength || 0);
    const normalizedType = String((selectedItem as any)?.boxType || "").trim().toUpperCase();
    const normalizedPart = normalizeNumericPart(selectedItem?.part ?? selectedItem?.noOfParts);
    const dieCutUps = Number(selectedItem?.dieCutUps || 0);
    const f3 = Number(selectedItem?.f3 || 0);
    const b3 = Number(selectedItem?.b3 || 0);

    const idToOd = ply === 3 ? 6 : ply === 5 ? 10 : 0;
    const idToOd17 = ply === 3 ? 40 : ply === 5 ? 50 : 0;

    const takeUpFactor = Number(formData.takeUpFactor || 0);
    const top = Number(formData.top || 0);
    const l1 = Number(formData.l1 || 0);
    const f1 = Number(formData.f1 || 0);
    const l2 = Number(formData.l2 || 0);
    const f2 = Number(formData.f2 || 0);
    const l3 = Number(formData.l3 || 0);

    let gsm = l1 + f1 * takeUpFactor + l2 + f2 * takeUpFactor + l3;

    if (gsmFormulaMode === GSM_FORMULA_MODE.plyBased) {
      if (ply === 3) {
        gsm = top + f1 + l2 + f2 + l3 + f1 * 0.5 + f2 * 0.36;
      } else if (ply === 5 || ply === 2) {
        gsm = top + f1 + l2 + f2 + l3 + f1 * 0.36 + f2 * 0.36;
      } else if (ply === 7) {
        gsm = top + f1 + l2 + f2 + l3 + f3 + b3 + f1 * 0.36 + f2 * 0.36 + f3 * 0.36;
      }
    }

    let reelAsPerCalc = !breadth ? height * ups : (breadth + height) * ups + (idToOd * ups + 16);

    if (reelFormulaMode === REEL_FORMULA_MODE.typeBased) {
      if (normalizedType === "ROTARY TRAY") {
        reelAsPerCalc = (((lOd + hOd) * ups) + 20) / 25.4;
      } else if (
        normalizedType === "2 PLY LINER" ||
        normalizedType === "U/C PLATE" ||
        normalizedType === "HORIZONTAL PLATE" ||
        normalizedType === "TRAY"
      ) {
        reelAsPerCalc = ((wOd * ups) + 20) / 25.4;
      } else if (normalizedType === "DIE CUT SHEET") {
        reelAsPerCalc = ((openWidth * ups) + 20) / 25.4;
      } else if (normalizedType === "RSC") {
        reelAsPerCalc = (((flap + hOd + flap) * ups) + 20) / 25.4;
      } else if (normalizedType) {
        reelAsPerCalc = ((hOd * ups) + 20) / 25.4;
      }
    }

    let cutting = 0;
    if (cuttingSizeFormulaMode === CUTTING_SIZE_FORMULA_MODE.typeBased) {
      if (normalizedType === "2 PLY ROLL") {
        cutting = 0;
      } else if (normalizedType === "DIE CUT SHEET" && openLength > 0 && noOfUpsInCuttingForPlates > 0) {
        cutting = ((openLength * noOfUpsInCuttingForPlates) + 20) / 25.4;
      } else if (normalizedType === "RSC" && normalizedPart === 1) {
        cutting = ((2 * (lOd + wOd)) + 50) / 25.4;
      } else if (normalizedType === "RSC" && normalizedPart === 2) {
        cutting = ((lOd + wOd) + 50) / 25.4;
      } else if (normalizedType && lOd > 0 && noOfUpsInCuttingForPlates > 0) {
        cutting = ((lOd * noOfUpsInCuttingForPlates) + 20) / 25.4;
      }
    } else if (!breadth) {
      cutting = length;
    } else if (noOfParts === 1) {
      cutting = (length + breadth) * 2 + idToOd17 * noOfParts;
    } else if (noOfParts === 2) {
      cutting = length + breadth + idToOd17;
    }

    const productionInMeter = ups > 0 ? ((cutting * qty) / 1000) / ups : 0;
    const plannedProductionInMeter =
      cutting > 0 && qty > 0 && ups > 0 ? parseFloat((((cutting * qty) / 1000) / ups).toFixed(2)) : "";
    const actualPaperUsed = Number(formData.actualPaperUsed);
    const prodFromFFG = Number(formData.prodFromFFG);
    const avgWeight =
      actualPaperUsed > 0 && prodFromFFG > 0 ? round2(actualPaperUsed / prodFromFFG) : "";
    // Total job weight based on paperRequiredNos (not including plate weight).
    const normalizedFlute = formData.flute.toUpperCase().trim().replace(/\s+/g, "");
    const fluteBatchMap: Record<string, string> = {
      A: "1",
      B: "2",
      "B+C": "3",
      C: "4",
      E: "5",
    };
    const fluteBatches = fluteBatchMap[normalizedFlute] || "";
    const leastGsmValue = erpLeastGsmMap.get(selectedErp) ?? "";
    const printingColor = joinPrintingColors(formData.color1, formData.color2);

    let paperRequiredNos: number | "" = "";
    if (String(formData.erpCode || "").trim()) {
      if (
        ["VERTICAL PLATE", "HORIZONTAL PLATE", "U/C PLATE", "ROTARY TRAY"].includes(normalizedType) &&
        ups > 0 &&
        noOfUpsInCuttingForPlates > 0
      ) {
        paperRequiredNos = qty / (ups * noOfUpsInCuttingForPlates);
      } else if (normalizedType === "2 PLY LINER") {
        paperRequiredNos = "";
      } else if (
        normalizedType === "DIE CUT SHEET" &&
        ups > 0 &&
        noOfUpsInCuttingForPlates > 0 &&
        dieCutUps > 0
      ) {
        paperRequiredNos = qty / (ups * noOfUpsInCuttingForPlates) / dieCutUps;
      } else if (normalizedType === "RSC" && ups > 0) {
        if (normalizedPart === 1) {
          paperRequiredNos = qty / ups;
        } else if (normalizedPart === 2) {
          paperRequiredNos = (qty / ups) * 2;
        }
      }
    }

    const topPaperWeightKg =
      paperRequiredNos !== ""
        ? (reelAsPerCalc * cutting * top * paperRequiredNos) / 1000000000
        : "";
    const linerWeightKg =
      paperRequiredNos !== ""
        ? (reelAsPerCalc * cutting * (gsm - top) * paperRequiredNos) / 1000000000
        : "";
    const totalJobWeight = topPaperWeightKg !== "" && linerWeightKg !== "" ? topPaperWeightKg + linerWeightKg : "";

    const plannedQty = qty;
    const reelActualWithTrimming = Number(formData.reelActualWithTrimming || 0);
    const sheetWeight =
      ups > 0
        ? ((reelActualWithTrimming * cutting * gsm) / 1000000000) / ups
        : "";
    const sheetWeightValue = sheetWeight === "" ? 0 : Number(sheetWeight || 0);
    const totalPaperWeight = sheetWeight === "" ? "" : sheetWeightValue * plannedQty;
    const totalWeightOfSet = sheetWeight === "" ? "" : sheetWeightValue + plateWeight;
    const totalWeightOfSetValue = totalWeightOfSet === "" ? 0 : Number(totalWeightOfSet || 0);

    const realizationPerKg =
      totalWeightOfSetValue > 0 ? rate / totalWeightOfSetValue : "";

    const wastage =
      prodFromFFG > 0 && sheetWeightValue > 0 && actualPaperUsed > 0
        ? parseFloat((100 - ((prodFromFFG * sheetWeightValue) / actualPaperUsed) * 100).toFixed(2))
        : "";

    let lineRequiredNos: number | "" = "";
    if (!String(formData.erpCode || "").trim()) {
      lineRequiredNos = "";
    } else if (ply === 3 && paperRequiredNos !== "") {
      lineRequiredNos = paperRequiredNos;
    } else if (ply === 5 && paperRequiredNos !== "") {
      lineRequiredNos = paperRequiredNos * 2;
    } else if (ply === 2 && normalizedType === "2 PLY LINER" && ups > 0 && noOfUpsInCuttingForPlates > 0) {
      lineRequiredNos = qty / (ups * noOfUpsInCuttingForPlates);
    }

    setFormData((prev) => ({
      ...prev,
      idToOd,
      idToOd17,
      gsm: round2(gsm),
      reelAsPerCalc: round2(reelAsPerCalc),
      cuttingWithTrimming: round2(cutting),
      sheetWeight: sheetWeight === "" ? "" : round2(sheetWeight),
      totalPaperWeight: totalPaperWeight === "" ? "" : round2(totalPaperWeight),
      totalWeightOfSet: totalWeightOfSet === "" ? "" : round2(totalWeightOfSet),
      realizationPerKg: realizationPerKg === "" ? "" : round2(realizationPerKg),
      productionInMeter: round2(productionInMeter),
      plannedProductionInMeter: plannedProductionInMeter === "" ? "" : round2(Number(plannedProductionInMeter)),
      avgWeight,
      wastage,
      fluteBatches,
      leastGsm: leastGsmValue,
      printingColor,
      paperRequiredNos: paperRequiredNos === "" ? "" : roundUpWhole(paperRequiredNos),
      topPaperWeightKg: topPaperWeightKg === "" ? "" : round2(topPaperWeightKg),
      linerWeightKg: linerWeightKg === "" ? "" : round2(linerWeightKg),
      totalJobWeight: totalJobWeight === "" ? "" : round2(totalJobWeight),
      lineRequiredNos: lineRequiredNos === "" ? "" : roundUpWhole(lineRequiredNos),
    }));
  }, [
    formData.color1,
    formData.color2,
    formData.erpCode,
    formData.ply,
    formData.flute,
    formData.length,
    formData.breadth,
    formData.height,
    formData.ups,
    formData.noOfParts,
    formData.l1,
    formData.f1,
    formData.l2,
    formData.f2,
    formData.l3,
    formData.qty,
    formData.rate,
    formData.plateWeight,
    formData.noOfUpsInCuttingForPlates,
    formData.reelActualWithTrimming,
    formData.actualPaperUsed,
    formData.prodFromFFG,
    erpLeastGsmMap,
    cuttingSizeFormulaMode,
    reelFormulaMode,
    gsmFormulaMode,
    selectedErp,
    selectedItem?.flap,
    selectedItem?.f3,
    selectedItem?.b3,
    selectedItem?.hOd,
    selectedItem?.lOd,
    selectedItem?.openLength,
    selectedItem?.openWidth,
    selectedItem?.part,
    selectedItem?.dieCutUps,
    (selectedItem as any)?.boxType,
    selectedItem?.wOd,
  ]);

  useEffect(() => {
    const queryScheduleId = searchParams.get("scheduleId") || "";
    if (queryScheduleId && queryScheduleId !== selectedScheduleId) {
      setSelectedScheduleId(queryScheduleId);
    }
  }, [searchParams, selectedScheduleId]);

  const scheduleOptions = pendingSchedules.map((schedule) => {
    const order = orders.find((row) => row.id === schedule.orderId);
    const item = resolveOrderItem(order);
    const company = companies.find((row) => row.id === order?.companyId);
    const pending = getPendingProductionQty(schedule, Number(consumptionByScheduleId.get(schedule.id)?.effectiveConsumedQty || 0));

    return {
      value: schedule.id,
      label: `${schedule.scheduleNo || "Schedule"} | ${order?.orderNo || "Order"} | ${company?.name || "Company"} | ${item?.name || "Item"} | ${formatDate(schedule.scheduledDate)} | Pending ${pending}`,
    };
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchedule || !selectedOrder || !selectedItem || !formData.date) return;
    if (hasMissingMandatoryLayerFields) {
      alert(`Please fill mandatory layer fields: ${missingMandatoryLayerFields.join(", ")}.`);
      return;
    }
    if (reelActualTrimMissing) {
      alert("Reel Actual Width Trimming (RAWT) is mandatory and must be greater than 0.");
      return;
    }

    const qty = Number(formData.qty);
    if (qty <= 0 || quantityDeviationError || maximumAllowedProductionError || gsmValidationError) return;

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextPendingQty = pendingQty - qty;
      const txnNo = generateTransactionNo(getProductionJobPrefix("FG"), allJobRows, formData.date);

      const newEntry: Production = {
        id: crypto.randomUUID(),
        transactionNo: txnNo,
        date: formData.date,
        scheduleId: selectedSchedule.id,
        itemId: selectedItem.id,
        itemSource: "FG",
        npdId: selectedItem.id,
        qty,
        uom: selectedItem.uom || "",
        remarks: formData.remarks,
        status: "Pending Consumption",
        updatedBy: "System User",
        updateTimestamp: timestamp,
        ...Object.fromEntries(
          Object.entries(formData).filter(([key]) => !["date", "qty", "remarks"].includes(key))
        ),
      } as Production;

      const normalizedEntry: Production = {
        ...newEntry,
        ...getProductionMatchingFields(newEntry, selectedItem),
      };

      await setProductions((prev) => [normalizedEntry, ...prev]);

      if (isSampleItem && matchedSampleRequest?.id) {
        await setSampleRequests((prev) =>
          prev.map((row) =>
            row.id === matchedSampleRequest.id
              ? {
                  ...row,
                  jobCardNo: txnNo,
                  updatedBy: "System User",
                  updateTimestamp: timestamp,
                }
              : row
          )
        );
      }

      await setSchedules((prev) =>
        prev.map((schedule) =>
          schedule.id === selectedSchedule.id
            ? {
                ...schedule,
                producedQty: Number(schedule.producedQty || 0) + qty,
                updateTimestamp: timestamp,
                updatedBy: "System User",
              }
            : schedule
        )
      );

      setFormData(createInitialFormData(selectedSchedule.scheduledDate || todayStr));

      if (nextPendingQty <= 0) {
        setSelectedScheduleId("");
        setSearchParams({});
      }
    } catch (err) {
      console.error("Failed to save production:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Production Form</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      <div className="bg-white p-4 rounded shadow-sm border border-black w-full">
        <form onSubmit={handleSubmit} className="space-y-5">
          {showField("Scheduled Order") && <div className="flex flex-col space-y-1">
            <LabelWithHelp
              label="Scheduled Order"
              required
              helpText="Choose the pending scheduled order you want to plan production for. Item, ERP code, company, and default specs are auto-filled from this selection."
            />
            <Select
              id="schedule"
              value={selectedScheduleId}
              onChange={(value) => {
                if (isScheduleLocked) return;
                setSelectedScheduleId(value);
                setSearchParams(value ? { scheduleId: value } : {});
              }}
              options={scheduleOptions}
              placeholder="Select pending production schedule..."
              required
              disabled={isScheduleLocked}
            />
          </div>}

          {selectedSchedule && selectedOrder && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 border border-black p-4 rounded">
              <InfoTile label="Order No" value={selectedOrder.orderNo || "-"} />
              <InfoTile label="Company" value={selectedCompany?.name || "-"} />
              <InfoTile label="Item" value={selectedItem?.name || "-"} />
              <InfoTile label="Type" value={String((selectedItem as any)?.boxType || "-")} />
              <InfoTile label="ERP Code" value={selectedOrder.erpCode || "-"} />
              <InfoTile label="Order Qty" value={`${selectedOrderQty}${selectedItem?.uom ? ` ${selectedItem.uom}` : ""}`} />
              <InfoTile label="Balance Order Qty" value={`${balanceOrderQty}${selectedItem?.uom ? ` ${selectedItem.uom}` : ""}`} />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {showField("Production Date") && <div className="flex flex-col space-y-1">
              <LabelWithHelp
                label="Production Date"
                required
                helpText="This defaults from the selected schedule date. Back-dated production entries are allowed and you can change it if needed."
              />
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
                className="border-2 border-black rounded p-2 text-black bg-yellow-100 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>}

            {showField("Pending Order Quantity") && <ReadOnlyNumberField
              label="Pending Order Quantity"
              value={pendingOrderQtyForItem}
              suffix={selectedItem?.uom || ""}
              helpText="For the selected item, this is the total of all positive pending schedule quantities. Formula per schedule: Scheduled Qty - Cancelled Qty - Invoiced Qty."
            />}

            {showField("Current Balance") && <ReadOnlyNumberField
              label="Current Balance"
              value={Number(selectedItem?.balance || 0)}
              suffix={selectedItem?.uom || ""}
              helpText="This comes from the item balance logic used in Item Master. Formula: Opening + Receipt + Production - Invoiced."
            />}

            {showField("Production In Progress") && <ReadOnlyNumberField
              label="Production In Progress"
              value={productionInProgress}
              suffix={selectedItem?.uom || ""}
              helpText="For the selected item, this sums production rows where Production from FFG is blank and Cancel Timestamp is blank."
            />}

            {showField("Maximum Allowed Production") && <ReadOnlyNumberField
              label="Maximum Allowed Production"
              value={maximumAllowedProduction}
              suffix={selectedItem?.uom || ""}
              helpText="Formula: Pending Order Quantity - Current Balance - Production In Progress. It is never shown below zero."
            />}

            {showField("Sample Item") && <ReadOnlyTextField
              label="Sample Item"
              value={sampleItemLabel}
              helpText="YES means there is at least one pending sample request for this item with no cancel and no job card."
            />}

            {showField("Sample Item Qty") && <ReadOnlyNumberField
              label="Sample Item Qty"
              value={sampleItemQty || 0}
              suffix={selectedItem?.uom || ""}
              helpText="One pending sample request quantity for this item. This is used to auto-fill planned quantity when the item is a sample item."
            />}

            {showField("Last Item") && <ReadOnlyTextField
              label="Last Item"
              value={lastItem?.name || "-"}
              helpText="Latest relevant non-cancelled production item from Production Master history."
            />}

            {showField("Last Plan Qty") && <ReadOnlyNumberField
              label="Last Plan Qty"
              value={lastPlanQty}
              suffix={lastItem?.uom || ""}
              helpText="Latest relevant non-cancelled production quantity from Production Master history."
            />}

            {showField("Deviation Allowed") && <ReadOnlyNumberField
              label="Deviation Allowed"
              value={deviationAllowed}
              suffix="%"
              helpText="Company-wise deviation percentage from Companies Master. If company value is blank, fallback 25 is used."
            />}

            {showField("Planned Quantity") && <div className="flex flex-col space-y-1">
              <LabelWithHelp
                label="Planned Quantity"
                required
                helpText="If this item has a pending sample request, quantity is auto-filled from sample quantity and becomes read-only. Otherwise it stays manual. If the current item is same as the last produced item, deviation validation is applied."
              />
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={formData.qty}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      qty: e.target.value === "" ? "" : parseFloat(e.target.value),
                    })
                  }
                  readOnly={isSampleItem}
                  required
                  placeholder={isSampleItem ? "Auto-filled from sample request" : "Enter planned quantity"}
                  className={cn(
                    "w-full border-2 border-black rounded p-2 text-black shadow-sm",
                    isSampleItem
                      ? "bg-slate-100 cursor-not-allowed focus:outline-none"
                      : quantityDeviationError || maximumAllowedProductionError
                        ? "border-red-600 bg-red-50 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
                        : "bg-yellow-100 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  )}
                />
                {selectedItem && <span className="absolute right-3 top-2.5 text-black font-bold opacity-60">{selectedItem.uom}</span>}
              </div>
              {maximumAllowedProductionError && (
                <span className="text-red-600 text-xs font-bold">
                  Planned Quantity cannot be greater than Maximum Allowed Production.
                </span>
              )}
              {quantityDeviationError && (
                <span className="text-red-600 text-xs font-bold">
                  Planned Quantity cannot exceed {maximumDeviationQty.toLocaleString()} based on Last Plan Qty and Deviation Allowed.
                </span>
              )}
            </div>}
          </div>

          {showField("Remarks") && <div className="flex flex-col space-y-1">
            <LabelWithHelp label="Remarks" helpText="Optional notes for this production entry." />
            <input
              type="text"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
            />
          </div>}

          <div className="border-t border-black pt-4 mt-6">
            <h3 className="font-black uppercase text-xs text-slate-500 mb-4">Detailed Specifications</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {showField("No. of Parts") ? <FormInput label="No. of Parts" value={formData.noOfParts} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." /> : null}
              {showField("UPS") ? <FormInput label="UPS" value={formData.ups} onChange={(v) => setFormData({ ...formData, ups: v })} type="number" helpText="Default value comes from Item Master for the selected item. You can adjust it here if needed." /> : null}

              {showField("Length") ? <FormInput label="Length" value={formData.length} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." /> : null}
              {showField("Breadth") ? <FormInput label="Breadth" value={formData.breadth} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." /> : null}
              {showField("Height") ? <FormInput label="Height" value={formData.height} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." /> : null}

              {showField("PLY") ? <FormInput label="PLY" value={formData.ply} readOnly helpText="Auto-fetched from Item Master for the selected item. It also drives ID to OD and ID to OD 17 calculations." /> : null}
              {showField("Flute") ? <FormInput label="Flute" value={formData.flute} readOnly helpText="Auto-fetched from Item Master for the selected item. It also determines the Take up Factor used in GSM calculation." /> : null}
              {showField("ID to OD") ? <FormInput label="ID to OD" value={formData.idToOd} readOnly helpText="Auto-calculated from PLY. Current logic: 3 PLY = 6, 5 PLY = 10." /> : null}

              {showField("Top") ? <FormInput label="Top" value={formData.top} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." /> : null}
              {showField("Take up Factor") ? <FormInput label="Take up Factor" value={formData.takeUpFactor} readOnly helpText="Auto-fetched from Item Master for the selected item." /> : null}
              {showField("GSM") ? <FormInput
                label="GSM"
                value={formData.gsm}
                readOnly
                helpText={`${getGsmHelpText(gsmFormulaMode)} When this item is different from the last produced item, GSM must not exceed Least GSM.`}
              /> : null}
              {showField("Color 1") ? <FormInput label="Color 1" value={formData.color1} readOnly helpText="Auto-filled from Item Master for the selected item." /> : null}
              {showField("Color 2") ? <FormInput label="Color 2" value={formData.color2} readOnly helpText="Auto-filled from Item Master for the selected item." /> : null}
              {showField("Printing Color") ? <FormInput label="Printing Color" value={formData.printingColor} readOnly helpText="Auto-calculated by combining Color 1 and Color 2 for the selected item." /> : null}
              {showField("ERP Code Reel") ? <FormInput label="ERP Code Reel" value={formData.erpCodeReel} readOnly helpText="Read-only reference field. It is shown from the production record/defaults when available." /> : null}
            </div>
            {gsmValidationError && (
              <div className="mt-2 text-red-600 text-xs font-bold">
                GSM cannot exceed Least GSM when the current item is different from the last produced item.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mt-4">
              {showField("L1") ? <FormInput label="L1" value={formData.l1} onChange={(v) => setFormData({ ...formData, l1: v })} type="number" required={isLayerRequired("L1")} helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." /> : null}
              {showField("F1") ? <FormInput label="F1" value={formData.f1} onChange={(v) => setFormData({ ...formData, f1: v })} type="number" required={isLayerRequired("F1")} helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." /> : null}
              {showField("L2") ? <FormInput label="L2" value={formData.l2} onChange={(v) => setFormData({ ...formData, l2: v })} type="number" required={isLayerRequired("L2")} helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." /> : null}
              {showField("F2") ? <FormInput label="F2" value={formData.f2} onChange={(v) => setFormData({ ...formData, f2: v })} type="number" required={isLayerRequired("F2")} helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." /> : null}
              {showField("L3") ? <FormInput label="L3" value={formData.l3} onChange={(v) => setFormData({ ...formData, l3: v })} type="number" required={isLayerRequired("L3")} helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." /> : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
              {showField("Reel Per Calc") ? <FormInput label="Reel as per the calculation (RAPC)" value={formData.reelAsPerCalc} readOnly helpText={getReelAsPerCalculationHelpText(reelFormulaMode)} /> : null}
              {showField("No. of ups in Cutting (For Plates)") && !isSelectedPlateItem ? <FormInput
                label="No. of ups in Cutting (For Plates)"
                value={formData.noOfUpsInCuttingForPlates}
                onChange={(v) => setFormData({ ...formData, noOfUpsInCuttingForPlates: v })}
                type="number"
                helpText="Editable field for plate-related cutting ups. It is saved with the production entry."
              /> : null}
              {showField("Reel Actual Trim") ? <FormInput label="Reel Actual Width Trimming (RAWT)" value={formData.reelActualWithTrimming} onChange={(v) => setFormData({ ...formData, reelActualWithTrimming: v })} type="number" required helpText="Mandatory. Enter the actual reel width trimming." /> : null}
              {showField("Cutting Trim") ? <FormInput label="Cutting with Trimming" value={formData.cuttingWithTrimming} readOnly helpText={getCuttingSizeHelpText(cuttingSizeFormulaMode)} /> : null}
              {showField("Paper Required (Nos)") ? <FormInput
                label="Paper Required (Nos)"
                value={formData.paperRequiredNos}
                readOnly
                type="number"
                helpText="Calculated from TYPE. For VERTICAL PLATE, HORIZONTAL PLATE, U/C PLATE, and ROTARY TRAY: Planned Quantity / (UPS x No. of ups in Cutting (For Plates)). For 2 PLY LINER: blank. For DIE CUT SHEET: Planned Quantity / (UPS x No. of ups in Cutting (For Plates)) / Die Cut Ups. For RSC with PART = 1: Planned Quantity / UPS. For RSC with PART = 2: (Planned Quantity / UPS) x 2."
              /> : null}
              {showField("Top Paper Weight (KG)") ? <FormInput
                label="Top Paper Weight (KG)"
                value={formData.topPaperWeightKg}
                readOnly
                type="number"
                step="0.00001"
                helpText="Formula: (Reel As per Calculation x Cutting Trim x Top x Paper Required (Nos)) / 1,000,000,000."
              /> : null}
              {showField("Liner Weight (KG)") ? <FormInput
                label="Liner Weight (KG)"
                value={formData.linerWeightKg}
                readOnly
                type="number"
                step="0.00001"
                helpText="Formula: (Reel As per Calculation x Cutting Trim x (GSM minus Top) x Paper Required (Nos)) / 1,000,000,000."
              /> : null}
              {showField("Total Job Weight") ? <FormInput
                label="Total Job Weight"
                value={formData.totalJobWeight}
                readOnly
                type="number"
                step="0.00001"
                helpText="Formula: Top Paper Weight (KG) + Liner Weight (KG)."
              /> : null}
              {(showField("Liner Required (Nos)") || showField("Line Required (Nos)")) ? <FormInput
                label="Liner Required (Nos)"
                value={formData.lineRequiredNos}
                readOnly
                type="number"
                helpText="If ERP Code is blank, keep blank. If PLY is 3, use the same value as Paper Required (Nos). If PLY is 5, use Paper Required (Nos) x 2. If PLY is 2 and TYPE is 2 PLY LINER, use Planned Quantity divided by (UPS x No. of ups in Cutting (For Plates))."
              /> : null}

              {showField("Sheet Weight") ? <FormInput label="Sheet Weight" value={formData.sheetWeight} readOnly helpText="Formula: ((Reel Actual with Trimming x Cutting with Trimming x GSM) / 1,000,000,000) / UPS. If UPS is 0 or blank, this stays blank." /> : null}
              {showField("Plate/PHP Weight") ? <FormInput label="Plate/PHP Weight" value={formData.plateWeight} readOnly type="number" step="0.00001" helpText="Auto-fetched from NPD Master for the selected item and divided by 1000." /> : null}
              {showField("Total Paper Wt") ? <FormInput label="Total Paper Wt" value={formData.totalPaperWeight} readOnly helpText="Formula: Sheet Weight x Planned Qty (equals Total Job Weight)." /> : null}

              {showField("Total Wt of Set") ? <FormInput label="Total Wt of Set" value={formData.totalWeightOfSet} readOnly helpText="Formula: Sheet Weight + Plate/PHP Weight." /> : null}
              {showField("Avg Weight") ? <FormInput label="Avg Weight" value={formData.avgWeight} readOnly type="number" step="0.00001" helpText="Formula: Actual Paper Used / Production from FFG." /> : null}
              {showField("Actual Paper Used") ? <FormInput label="Actual Paper Used" value={formData.actualPaperUsed} readOnly type="number" step="0.00001" helpText="Workflow-managed field. It is derived from Material Issue minus Material Return against the job, and then used in Avg Weight and Wastage calculations." /> : null}

              {showField("Rate") ? <FormInput label="Rate" value={formData.rate} readOnly type="number" helpText="Auto-fetched from the selected order." /> : null}
              {showField("Realization/KG") ? <FormInput
                label="Realization/KG"
                value={formData.realizationPerKg}
                readOnly
                inputClassName={realizationBelowTarget ? "border-red-600 bg-red-50 text-red-800 font-bold" : undefined}
                helpText="Formula: Rate / Total Wt of Set. Turns red when below the configured realization target for this production date."
              /> : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
              {showField("Prod (Sheet Plant)") ? <FormInput label="Prod (Sheet Plant)" value={formData.prodFromSheetPlant} onChange={(v) => setFormData({ ...formData, prodFromSheetPlant: v })} type="number" helpText="Temporarily editable for formula testing." /> : null}
              {showField("Prod (FFG)") ? <FormInput label="Prod (FFG)" value={formData.prodFromFFG} readOnly type="number" helpText="Workflow-managed field. It is updated from the Pending FFG view and then used in Avg Weight and Wastage calculations." /> : null}
              {showField("Wastage") ? <FormInput label="Wastage" value={formData.wastage} readOnly type="number" helpText="Formula: 100 - (((Production from FFG x Sheet Weight) / Actual Paper Used) x 100)." /> : null}

              {showField("Prod (Meter)") ? <FormInput label="Prod (Meter)" value={formData.productionInMeter} readOnly helpText="Formula: ((Cutting Trim x Quantity) / 1000) / UPS." /> : null}
              {showField("Planned Prod (Mtr)") ? <FormInput label="Planned Prod (Mtr)" value={formData.plannedProductionInMeter} readOnly type="number" helpText="Formula: ((Cutting Trim x Plan Qty) / 1000) / UPS. If Cutting Trim or Plan Qty is blank, this stays blank." /> : null}

              {showField("Least GSM") ? <FormInput label="Least GSM" value={formData.leastGsm} readOnly type="number" step="0.00001" helpText="Read-only least GSM reference from production history for the current ERP code." /> : null}
              {showField("Flute Batches") ? <FormInput label="Flute Batches" value={formData.fluteBatches} readOnly helpText="Derived from Flute using this mapping: A=1, B=2, B+C=3, C=4, E=5. Any other value stays blank." /> : null}
            </div>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !selectedSchedule ||
                !formData.date ||
                currentQty <= 0 ||
                reelActualTrimMissing ||
                hasMissingMandatoryLayerFields ||
                quantityDeviationError ||
                maximumAllowedProductionError ||
                gsmValidationError
              }
              className="flex items-center justify-center min-w-[120px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50 border border-black shadow"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit Entry"}
            </button>
          </div>
        </form>
      </div>

      {pendingSchedules.length === 0 && (
        <div className="bg-amber-50 border border-black p-4 font-bold text-amber-900">
          No scheduled orders are pending production right now.
        </div>
      )}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs font-black text-slate-500 uppercase">{label}</div>
      <div className="text-sm font-bold text-black">{value}</div>
    </div>
  );
}

function LabelWithHelp({ label, helpText, required = false }: { label: string; helpText: string; required?: boolean }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span>
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <TooltipIcon helpText={helpText} />
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  type = "text",
  step = "any",
  readOnly = false,
  required = false,
  inputClassName,
  helpText,
}: {
  label: string;
  value: string | number;
  onChange?: (v: any) => void;
  type?: string;
  step?: string;
  readOnly?: boolean;
  required?: boolean;
  inputClassName?: string;
  helpText?: string;
}) {
  return (
    <div className="flex flex-col space-y-1">
      <div className="text-[10px] font-black text-slate-500 uppercase inline-flex items-center gap-1">
        <span>{label} {required ? <span className="text-red-500">*</span> : null}</span>
        {helpText ? <TooltipIcon helpText={helpText} size={12} /> : null}
      </div>
      <input
        readOnly={readOnly}
        required={required}
        type={type}
        step={type === "number" ? step : undefined}
        value={value}
        onChange={(e) => onChange?.(type === "number" ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value)}
        className={cn(
          "border border-black rounded px-2 py-1 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600",
          readOnly ? "bg-slate-100 cursor-not-allowed" : "bg-yellow-100",
          inputClassName
        )}
      />
    </div>
  );
}

function ReadOnlyNumberField({
  label,
  value,
  suffix,
  helpText,
}: {
  label: string;
  value: number;
  suffix?: string;
  helpText: string;
}) {
  return (
    <div className="flex flex-col space-y-1">
      <LabelWithHelp label={label} helpText={helpText} />
      <div className="relative">
        <input
          type="number"
          value={value}
          readOnly
          className="w-full border-2 border-black rounded p-2 text-black bg-slate-100 focus:outline-none shadow-sm"
        />
        {suffix ? <span className="absolute right-3 top-2.5 text-black font-bold opacity-60">{suffix}</span> : null}
      </div>
    </div>
  );
}

function ReadOnlyTextField({
  label,
  value,
  helpText,
}: {
  label: string;
  value: string;
  helpText: string;
}) {
  return (
    <div className="flex flex-col space-y-1">
      <LabelWithHelp label={label} helpText={helpText} />
      <input
        type="text"
        value={value}
        readOnly
        className="w-full border-2 border-black rounded p-2 text-black bg-slate-100 focus:outline-none shadow-sm"
      />
    </div>
  );
}

function TooltipIcon({ helpText, size = 14 }: { helpText: string; size?: number }) {
  return (
    <span className="relative inline-flex items-center group">
      <span className="inline-flex items-center text-slate-500 cursor-help">
        <CircleHelp size={size} />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded border border-black bg-white px-3 py-2 text-[11px] normal-case font-medium text-slate-700 shadow-lg group-hover:block">
        {helpText}
      </span>
    </span>
  );
}
