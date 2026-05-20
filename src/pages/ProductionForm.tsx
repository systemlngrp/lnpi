import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "../hooks/useData";
import {
  Company,
  DispatchPlan,
  Item,
  LoadingSlip,
  Order,
  OrderSchedule,
  Production,
  SampleRequest,
} from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { generateTransactionNo, formatDate } from "../lib/serial";
import { CircleHelp } from "lucide-react";

function getPendingProductionQty(schedule: OrderSchedule) {
  return Math.max(
    Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
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

function createInitialFormData(todayStr: string) {
  return {
    date: todayStr,
    qty: "" as number | "",
    remarks: "",
    noOfParts: "" as number | "",
    ups: "" as number | "",
    length: "" as number | "",
    breadth: "" as number | "",
    height: "" as number | "",
    reelAsPerCalc: "" as number | "",
    reelActualWithTrimming: "" as number | "",
    cuttingWithTrimming: "" as number | "",
    ply: "" as number | "",
    idToOd: "" as number | "",
    idToOd17: "" as number | "",
    flute: "",
    takeUpFactor: "" as number | "",
    l1: "" as number | "",
    f1: "" as number | "",
    l2: "" as number | "",
    f2: "" as number | "",
    l3: "" as number | "",
    gsm: "" as number | "",
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
    erpCode: "",
  };
}

export function ProductionForm() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [productions, setProductions] = useData<Production>("productions", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [items] = useData<Item>("items", []);
  const [companies] = useData<Company>("companies", []);
  const [plans] = useData<DispatchPlan>("dispatch_plans", []);
  const [loadingSlips] = useData<LoadingSlip>("loading_slips", []);
  const [sampleRequests, setSampleRequests] = useData<SampleRequest>("sample_requests", []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState(searchParams.get("scheduleId") || "");
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const [formData, setFormData] = useState(() => createInitialFormData(todayStr));

  const pendingSchedules = useMemo(
    () =>
      schedules
        .filter((schedule) => getPendingProductionQty(schedule) > 0)
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.scheduledDate || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.scheduledDate || 0).getTime();
          return timeB - timeA;
        }),
    [schedules]
  );

  const erpLeastGsmMap = useMemo(() => {
    const map = new Map<string, number>();
    productions.forEach((production) => {
      if (production.status === "Cancelled" || production.cancelTimestamp) return;

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

  const selectedSchedule = pendingSchedules.find((schedule) => schedule.id === selectedScheduleId);
  const selectedOrder = orders.find((order) => order.id === selectedSchedule?.orderId);
  const selectedItem = items.find((item) => item.id === selectedOrder?.itemId);
  const selectedCompany = companies.find((company) => company.id === selectedOrder?.companyId);
  const selectedErp = String(selectedOrder?.erpCode || "").trim();
  const pendingQty = selectedSchedule ? getPendingProductionQty(selectedSchedule) : 0;

  const latestRelevantProduction = useMemo(
    () =>
      [...productions]
        .filter((production) => production.status !== "Cancelled" && !production.cancelTimestamp)
        .sort((a, b) => {
          const timeA = new Date(a.updateTimestamp || a.date || 0).getTime();
          const timeB = new Date(b.updateTimestamp || b.date || 0).getTime();
          return timeB - timeA;
        })[0],
    [productions]
  );

  const lastItem = items.find((item) => item.id === latestRelevantProduction?.itemId);
  const lastPlanQty = Number(latestRelevantProduction?.qty || 0);
  const isSameAsLastItem = Boolean(selectedItem?.id && lastItem?.id && selectedItem.id === lastItem.id);

  const pendingSampleRows = useMemo(() => {
    if (!selectedItem?.id) return [];

    return [...sampleRequests]
      .filter(
        (row) =>
          row.itemId === selectedItem.id &&
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
      if (!order || order.itemId !== selectedItem.id) return sum;

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

        return production.itemId === selectedItem.id && !production.cancelTimestamp && !hasFFGValue;
      })
      .reduce((sum, production) => sum + (Number(production.qty) || 0), 0);
  }, [productions, selectedItem?.id]);

  const maximumAllowedProduction = Math.max(
    pendingOrderQtyForItem - Number(selectedItem?.balance || 0) - productionInProgress,
    0
  );

  const currentQty = Number(formData.qty || 0);
  const currentGsm = Number(formData.gsm || 0);
  const leastGsm = Number(formData.leastGsm || 0);
  const deviationLimit = isSameAsLastItem ? Number((lastPlanQty * (deviationAllowed / 100)).toFixed(2)) : 0;

  const quantityDeviationError =
    !isSampleItem &&
    isSameAsLastItem &&
    currentQty > 0 &&
    deviationLimit > 0 &&
    currentQty > deviationLimit;

  const gsmValidationError =
    !isSampleItem &&
    !isSameAsLastItem &&
    currentGsm > 0 &&
    leastGsm > 0 &&
    currentGsm > leastGsm;

  useEffect(() => {
    if (selectedItem) {
      setFormData((prev) => ({
        ...prev,
        companyName: selectedCompany?.name || "",
        rate: selectedOrder?.rate ?? "",
        erpCode: String(selectedOrder?.erpCode || ""),
        noOfParts: selectedItem.noOfParts ?? "",
        ups: selectedItem.ups ?? "",
        length: selectedItem.length ?? "",
        breadth: selectedItem.breadth ?? "",
        height: selectedItem.height ?? "",
        ply: selectedItem.ply ?? "",
        flute: selectedItem.flute || "",
        plateWeight: selectedItem.plateWeight ?? "",
        l1: selectedItem.l1 ?? "",
        f1: selectedItem.f1 ?? "",
        l2: selectedItem.l2 ?? "",
        f2: selectedItem.f2 ?? "",
        l3: selectedItem.l3 ?? "",
      }));
    }
  }, [selectedItem, selectedCompany, selectedOrder]);

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

    const idToOd = ply === 3 ? 6 : ply === 5 ? 10 : 0;
    const idToOd17 = ply === 3 ? 40 : ply === 5 ? 50 : 0;

    const factorMap: Record<string, number> = { A: 1.5, B: 1.35, C: 1.42, E: 1.26, "B+C": 1.38, "B+E": 1.3 };
    const takeUpFactor = factorMap[formData.flute] || 0;

    const gsm =
      Number(formData.l1) +
      Number(formData.f1) * takeUpFactor +
      Number(formData.l2) +
      Number(formData.f2) * takeUpFactor +
      Number(formData.l3);

    const reelAsPerCalc = !breadth ? height * ups : (breadth + height) * ups + (idToOd * ups + 16);

    let cutting = 0;
    if (!breadth) {
      cutting = length;
    } else if (noOfParts === 1) {
      cutting = (length + breadth) * 2 + idToOd17 * noOfParts;
    } else if (noOfParts === 2) {
      cutting = length + breadth + idToOd17;
    }

    const reelActual = Number(formData.reelActualWithTrimming) || reelAsPerCalc;
    const sheetWeight = ups > 0 ? ((reelActual * cutting * gsm) / 1000000000) / ups : 0;
    const totalPaperWeight = sheetWeight * qty;
    const totalWeightOfSet = sheetWeight + plateWeight;
    const realizationPerKg = totalWeightOfSet !== 0 ? (rate / totalWeightOfSet) * noOfParts : 0;
    const productionInMeter = ups > 0 ? ((cutting * qty) / 1000) / ups : 0;
    const plannedProductionInMeter =
      cutting > 0 && qty > 0 && ups > 0 ? parseFloat((((cutting * qty) / 1000) / ups).toFixed(2)) : "";
    const actualPaperUsed = Number(formData.actualPaperUsed);
    const prodFromFFG = Number(formData.prodFromFFG);
    const avgWeight =
      actualPaperUsed > 0 && prodFromFFG > 0 ? parseFloat((actualPaperUsed / prodFromFFG).toFixed(3)) : "";
    const wastage =
      prodFromFFG > 0 && sheetWeight > 0 && actualPaperUsed > 0
        ? parseFloat((100 - ((prodFromFFG * sheetWeight) / actualPaperUsed) * 100).toFixed(2))
        : "";
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

    setFormData((prev) => ({
      ...prev,
      idToOd,
      idToOd17,
      takeUpFactor,
      gsm: parseFloat(gsm.toFixed(2)),
      reelAsPerCalc: parseFloat(reelAsPerCalc.toFixed(2)),
      cuttingWithTrimming: parseFloat(cutting.toFixed(2)),
      sheetWeight: parseFloat(sheetWeight.toFixed(5)),
      totalPaperWeight: parseFloat(totalPaperWeight.toFixed(5)),
      totalWeightOfSet: parseFloat(totalWeightOfSet.toFixed(5)),
      realizationPerKg: parseFloat(realizationPerKg.toFixed(2)),
      productionInMeter: parseFloat(productionInMeter.toFixed(2)),
      plannedProductionInMeter,
      avgWeight,
      wastage,
      fluteBatches,
      leastGsm: leastGsmValue,
    }));
  }, [
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
    formData.reelActualWithTrimming,
    formData.actualPaperUsed,
    formData.prodFromFFG,
    erpLeastGsmMap,
    selectedErp,
  ]);

  useEffect(() => {
    const queryScheduleId = searchParams.get("scheduleId") || "";
    if (queryScheduleId && queryScheduleId !== selectedScheduleId) {
      setSelectedScheduleId(queryScheduleId);
    }
  }, [searchParams, selectedScheduleId]);

  const scheduleOptions = pendingSchedules.map((schedule) => {
    const order = orders.find((row) => row.id === schedule.orderId);
    const item = items.find((row) => row.id === order?.itemId);
    const company = companies.find((row) => row.id === order?.companyId);
    const pending = getPendingProductionQty(schedule);

    return {
      value: schedule.id,
      label: `${order?.orderNo || "Order"} | ${company?.name || "Company"} | ${item?.name || "Item"} | ${formatDate(schedule.scheduledDate)} | Pending ${pending}`,
    };
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchedule || !selectedOrder || !selectedItem || !formData.date || formData.date < todayStr) return;

    const qty = Number(formData.qty);
    if (qty <= 0 || qty > pendingQty || quantityDeviationError || gsmValidationError) return;

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextPendingQty = pendingQty - qty;
      const txnNo = generateTransactionNo("PR", productions, formData.date);

      await setProductions((prev) => {
        const newEntry: Production = {
          id: crypto.randomUUID(),
          transactionNo: txnNo,
          date: formData.date,
          scheduleId: selectedSchedule.id,
          itemId: selectedOrder.itemId,
          qty,
          uom: selectedItem.uom || "",
          remarks: formData.remarks,
          status: "Pending PH",
          updatedBy: "System User",
          updateTimestamp: timestamp,
          ...Object.fromEntries(
            Object.entries(formData).filter(([key]) => !["date", "qty", "remarks"].includes(key))
          ),
        } as Production;
        return [newEntry, ...prev];
      });

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

      setFormData(createInitialFormData(todayStr));

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

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col space-y-1">
            <LabelWithHelp
              label="Scheduled Order"
              required
              helpText="Choose the pending scheduled order you want to plan production for. Item, ERP code, company, and default specs are auto-filled from this selection."
            />
            <Select
              id="schedule"
              value={selectedScheduleId}
              onChange={(value) => {
                setSelectedScheduleId(value);
                setSearchParams(value ? { scheduleId: value } : {});
              }}
              options={scheduleOptions}
              placeholder="Select pending production schedule..."
              required
            />
          </div>

          {selectedSchedule && selectedOrder && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 border border-black p-4 rounded">
              <InfoTile label="Order No" value={selectedOrder.orderNo || "-"} />
              <InfoTile label="Company" value={selectedCompany?.name || "-"} />
              <InfoTile label="Item" value={selectedItem?.name || "-"} />
              <InfoTile label="ERP Code" value={selectedOrder.erpCode || "-"} />
              <InfoTile label="Schedule Date" value={formatDate(selectedSchedule.scheduledDate)} />
              <InfoTile label="Scheduled Qty" value={`${selectedSchedule.qty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Produced Qty" value={`${selectedSchedule.producedQty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Cancelled Qty" value={`${selectedSchedule.canceledQty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Pending Qty" value={`${pendingQty} ${selectedItem?.uom || ""}`} />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1">
              <LabelWithHelp
                label="Production Date"
                required
                helpText="This date cannot be earlier than today. Only today or future dates are allowed."
              />
              <input
                type="date"
                value={formData.date}
                min={todayStr}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
                className={cn(
                  "border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm",
                  formData.date && formData.date < todayStr && "border-red-500"
                )}
              />
              {formData.date && formData.date < todayStr && (
                <span className="text-red-600 text-xs font-bold">Date must be today or future.</span>
              )}
            </div>

            <ReadOnlyNumberField
              label="Pending Order Quantity"
              value={pendingOrderQtyForItem}
              suffix={selectedItem?.uom || ""}
              helpText="For the selected item, this is the total of all positive pending schedule quantities. Formula per schedule: Scheduled Qty - Cancelled Qty - Invoiced Qty."
            />

            <ReadOnlyNumberField
              label="Current Balance"
              value={Number(selectedItem?.balance || 0)}
              suffix={selectedItem?.uom || ""}
              helpText="This comes from the item balance logic used in Item Master. Formula: Opening + Receipt + Production - Invoiced."
            />

            <ReadOnlyNumberField
              label="Production In Progress"
              value={productionInProgress}
              suffix={selectedItem?.uom || ""}
              helpText="For the selected item, this sums production rows where Production from FFG is blank and Cancel Timestamp is blank."
            />

            <ReadOnlyNumberField
              label="Maximum Allowed Production"
              value={maximumAllowedProduction}
              suffix={selectedItem?.uom || ""}
              helpText="Formula: Pending Order Quantity - Current Balance - Production In Progress. It is never shown below zero."
            />

            <ReadOnlyTextField
              label="Sample Item"
              value={sampleItemLabel}
              helpText="YES means there is at least one pending sample request for this item with no cancel and no job card."
            />

            <ReadOnlyNumberField
              label="Sample Item Qty"
              value={sampleItemQty || 0}
              suffix={selectedItem?.uom || ""}
              helpText="One pending sample request quantity for this item. This is used to auto-fill planned quantity when the item is a sample item."
            />

            <ReadOnlyTextField
              label="Last Item"
              value={lastItem?.name || "-"}
              helpText="Latest relevant non-cancelled production item from Production Master history."
            />

            <ReadOnlyNumberField
              label="Last Plan Qty"
              value={lastPlanQty}
              suffix={lastItem?.uom || ""}
              helpText="Latest relevant non-cancelled production quantity from Production Master history."
            />

            <ReadOnlyNumberField
              label="Deviation Allowed"
              value={deviationAllowed}
              suffix="%"
              helpText="Company-wise deviation percentage from Companies Master. If company value is blank, fallback 25 is used."
            />

            <div className="flex flex-col space-y-1">
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
                  max={pendingQty || undefined}
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
                      : "focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  )}
                />
                {selectedItem && <span className="absolute right-3 top-2.5 text-black font-bold opacity-60">{selectedItem.uom}</span>}
              </div>
              {selectedSchedule && <span className="text-xs font-bold text-slate-500">Max against current schedule: {pendingQty}</span>}
              {quantityDeviationError && (
                <span className="text-red-600 text-xs font-bold">
                  Planned Quantity cannot exceed {deviationLimit.toLocaleString()} based on Last Plan Qty and Deviation Allowed.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col space-y-1">
            <LabelWithHelp label="Remarks" helpText="Optional notes for this production entry." />
            <input
              type="text"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
            />
          </div>

          <div className="border-t border-black pt-4 mt-6">
            <h3 className="font-black uppercase text-xs text-slate-500 mb-4">Detailed Specifications</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormInput label="No. of Parts" value={formData.noOfParts} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." />
              <FormInput label="UPS" value={formData.ups} onChange={(v) => setFormData({ ...formData, ups: v })} type="number" helpText="Default value comes from Item Master for the selected item. You can adjust it here if needed." />

              <FormInput label="Length" value={formData.length} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." />
              <FormInput label="Breadth" value={formData.breadth} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." />
              <FormInput label="Height" value={formData.height} readOnly type="number" helpText="Auto-fetched from Item Master for the selected item." />

              <FormInput label="PLY" value={formData.ply} readOnly helpText="Auto-fetched from Item Master for the selected item. It also drives ID to OD and ID to OD 17 calculations." />
              <FormInput label="Flute" value={formData.flute} readOnly helpText="Auto-fetched from Item Master for the selected item. It also determines the Take up Factor used in GSM calculation." />
              <FormInput label="ID to OD" value={formData.idToOd} readOnly helpText="Auto-calculated from PLY. Current logic: 3 PLY = 6, 5 PLY = 10." />

              <FormInput label="Take up Factor" value={formData.takeUpFactor} readOnly helpText="Auto-calculated from flute type using fixed factors: A=1.5, B=1.35, C=1.42, E=1.26, B+C=1.38, B+E=1.3." />
              <FormInput
                label="GSM"
                value={formData.gsm}
                readOnly
                helpText="Formula: L1 + (F1 x Take up Factor) + L2 + (F2 x Take up Factor) + L3. When this item is different from the last produced item, GSM must not exceed Least GSM."
              />
              <FormInput label="ERP Code Reel" value={formData.erpCodeReel} readOnly helpText="Read-only reference field. It is shown from the production record/defaults when available." />
            </div>
            {gsmValidationError && (
              <div className="mt-2 text-red-600 text-xs font-bold">
                GSM cannot exceed Least GSM when the current item is different from the last produced item.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
              <FormInput label="L1" value={formData.l1} onChange={(v) => setFormData({ ...formData, l1: v })} type="number" helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." />
              <FormInput label="F1" value={formData.f1} onChange={(v) => setFormData({ ...formData, f1: v })} type="number" helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." />
              <FormInput label="L2" value={formData.l2} onChange={(v) => setFormData({ ...formData, l2: v })} type="number" helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." />
              <FormInput label="F2" value={formData.f2} onChange={(v) => setFormData({ ...formData, f2: v })} type="number" helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." />
              <FormInput label="L3" value={formData.l3} onChange={(v) => setFormData({ ...formData, l3: v })} type="number" helpText="Default value comes from Item Master for the selected item. It is used in the GSM calculation." />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <FormInput label="Reel Per Calc" value={formData.reelAsPerCalc} readOnly helpText="Calculated from dimensions, UPS, and ID to OD. The formula changes slightly depending on whether breadth is available." />
              <FormInput label="Reel Actual Trim" value={formData.reelActualWithTrimming} onChange={(v) => setFormData({ ...formData, reelActualWithTrimming: v })} type="number" />
              <FormInput label="Cutting Trim" value={formData.cuttingWithTrimming} readOnly helpText="Auto-calculated from length, breadth, number of parts, and ID to OD 17 logic." />

              <FormInput label="Sheet Weight" value={formData.sheetWeight} readOnly helpText="Formula: ((Reel Actual x Cutting Trim x GSM) / 1,000,000,000) / UPS." />
              <FormInput label="Plate/PHP Weight" value={formData.plateWeight} readOnly type="number" step="0.00001" helpText="Auto-fetched from Item Master for the selected item." />
              <FormInput label="Total Paper Wt" value={formData.totalPaperWeight} readOnly helpText="Formula: Sheet Weight x Quantity." />

              <FormInput label="Total Wt of Set" value={formData.totalWeightOfSet} readOnly helpText="Formula: Sheet Weight + Plate/PHP Weight." />
              <FormInput label="Avg Weight" value={formData.avgWeight} readOnly type="number" step="0.00001" helpText="Formula: Actual Paper Used / Production from FFG." />
              <FormInput label="Actual Paper Used" value={formData.actualPaperUsed} onChange={(v) => setFormData({ ...formData, actualPaperUsed: v })} type="number" step="0.00001" helpText="Temporarily editable for formula testing. Used in Avg Weight and Wastage calculations." />

              <FormInput label="Rate" value={formData.rate} readOnly type="number" helpText="Auto-fetched from the selected order." />
              <FormInput label="Realization/KG" value={formData.realizationPerKg} readOnly helpText="Formula: (Rate / Total Weight of Set) x Number of Parts." />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <FormInput label="Prod (Sheet Plant)" value={formData.prodFromSheetPlant} onChange={(v) => setFormData({ ...formData, prodFromSheetPlant: v })} type="number" helpText="Temporarily editable for formula testing." />
              <FormInput label="Prod (FFG)" value={formData.prodFromFFG} onChange={(v) => setFormData({ ...formData, prodFromFFG: v })} type="number" helpText="Temporarily editable for formula testing. Used in Avg Weight and Wastage calculations." />
              <FormInput label="Wastage" value={formData.wastage} readOnly type="number" helpText="Formula: 100 - (((Production from FFG x Sheet Weight) / Actual Paper Used) x 100)." />

              <FormInput label="Prod (Meter)" value={formData.productionInMeter} readOnly helpText="Formula: ((Cutting Trim x Quantity) / 1000) / UPS." />
              <FormInput label="Planned Prod (Mtr)" value={formData.plannedProductionInMeter} readOnly type="number" helpText="Formula: ((Cutting Trim x Plan Qty) / 1000) / UPS. If Cutting Trim or Plan Qty is blank, this stays blank." />

              <FormInput label="Least GSM" value={formData.leastGsm} readOnly type="number" step="0.00001" helpText="Read-only least GSM reference from production history for the current ERP code." />
              <FormInput label="Flute Batches" value={formData.fluteBatches} readOnly helpText="Derived from Flute using this mapping: A=1, B=2, B+C=3, C=4, E=5. Any other value stays blank." />
              <FormInput label="Company Name" value={formData.companyName} readOnly helpText="Auto-fetched from the selected order's company." />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !selectedSchedule ||
                !formData.date ||
                formData.date < todayStr ||
                currentQty <= 0 ||
                currentQty > pendingQty ||
                quantityDeviationError ||
                gsmValidationError
              }
              className="flex items-center justify-center min-w-[120px] bg-emerald-600 text-white px-6 py-2 rounded font-bold hover:bg-emerald-700 transition disabled:opacity-50 border border-black shadow"
            >
              {isSubmitting ? <Spinner size={20} className="text-white" /> : "Submit Entry"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
        <h3 className="bg-slate-100 p-4 font-bold text-black border-b border-black uppercase tracking-wider">Recent Productions</h3>
        <table className="min-w-full divide-y divide-black border-collapse border border-black">
          <thead className="bg-slate-50 divide-x divide-black">
            <tr className="divide-x divide-black">
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Job No.</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Date</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Order No</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item</th>
              <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Qty</th>
              <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black bg-white">
            {productions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-black font-medium">No recent production entries.</td>
              </tr>
            ) : (
              productions
                .sort((a, b) => {
                  const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                  const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                  return timeB - timeA;
                })
                .slice(0, 10)
                .map((production) => {
                  const schedule = schedules.find((row) => row.id === production.scheduleId);
                  const order = orders.find((row) => row.id === schedule?.orderId);
                  const item = items.find((row) => row.id === production.itemId);

                  return (
                    <tr key={production.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-6 py-4 text-sm font-medium text-black border border-black">{production.transactionNo}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black whitespace-nowrap">{formatDate(production.date)}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{order?.orderNo || "-"}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{item?.name || "Unknown"}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-indigo-700 border border-black">{production.qty}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{production.uom}</td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>

      {pendingSchedules.length === 0 && (
        <div className="bg-amber-50 border border-black p-4 font-bold text-amber-900">
          No scheduled orders are pending production right now.
        </div>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => navigate("/production/pending")}
          className="bg-white text-black border-2 border-black px-4 py-2 rounded font-bold hover:bg-slate-50 transition"
        >
          Open Pending Production View
        </button>
      </div>
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
  helpText,
}: {
  label: string;
  value: string | number;
  onChange?: (v: any) => void;
  type?: string;
  step?: string;
  readOnly?: boolean;
  helpText?: string;
}) {
  return (
    <div className="flex flex-col space-y-1">
      <div className="text-[10px] font-black text-slate-500 uppercase inline-flex items-center gap-1">
        <span>{label}</span>
        {helpText ? <TooltipIcon helpText={helpText} size={12} /> : null}
      </div>
      <input
        readOnly={readOnly}
        type={type}
        step={type === "number" ? step : undefined}
        value={value}
        onChange={(e) => onChange?.(type === "number" ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value)}
        className={cn(
          "border border-black rounded px-2 py-1 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600",
          readOnly && "bg-slate-100 cursor-not-allowed"
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
