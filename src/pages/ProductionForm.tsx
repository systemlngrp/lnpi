import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "../hooks/useData";
import { Company, Item, Order, OrderSchedule, Production } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { generateTransactionNo, formatDate } from "../lib/serial";

function getPendingProductionQty(schedule: OrderSchedule) {
  return Math.max(
    Number(schedule.qty || 0) - Number(schedule.producedQty || 0) - Number(schedule.canceledQty || 0),
    0
  );
}

export function ProductionForm() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [productions, setProductions] = useData<Production>("productions", []);
  const [schedules, setSchedules] = useData<OrderSchedule>("orders_schedule", []);
  const [orders] = useData<Order>("orders", []);
  const [items] = useData<Item>("items", []);
  const [companies] = useData<Company>("companies", []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState(searchParams.get("scheduleId") || "");
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
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
    realizationApprovalStatus: "",
    wastageApproval: "",
    productionInMeter: "" as number | "",
    plannedProductionInMeter: "" as number | "",
    leastSheetWeight: "" as number | "",
    fluteBatches: "",
    erpCodeReel: ""
  });

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

  const selectedSchedule = pendingSchedules.find((schedule) => schedule.id === selectedScheduleId);
  const selectedOrder = orders.find((order) => order.id === selectedSchedule?.orderId);
  const selectedItem = items.find((item) => item.id === selectedOrder?.itemId);
  const selectedCompany = companies.find((company) => company.id === selectedOrder?.companyId);
  const pendingQty = selectedSchedule ? getPendingProductionQty(selectedSchedule) : 0;

  // Auto-lookup from Item Master
  useEffect(() => {
    if (selectedItem) {
      setFormData(prev => ({
        ...prev,
        companyName: selectedCompany?.name || "",
        rate: selectedOrder?.rate || 0,
        qty: pendingQty,
        noOfParts: selectedItem.noOfParts || "",
        ups: selectedItem.ups || "",
        length: selectedItem.length || "",
        breadth: selectedItem.breadth || "",
        height: selectedItem.height || "",
        ply: selectedItem.ply || "",
        flute: selectedItem.flute || "",
        plateWeight: selectedItem.plateWeight || "",
        gsmLeastCost: selectedItem.gsmLeastCost || "",
        l1: selectedItem.l1 || "",
        f1: selectedItem.f1 || "",
        l2: selectedItem.l2 || "",
        f2: selectedItem.f2 || "",
        l3: selectedItem.l3 || "",
      }));
    }
  }, [selectedItem, selectedCompany, selectedOrder, pendingQty]);

  // Real-time Calculations
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

    // 1. ID to OD
    const idToOd = ply === 3 ? 6 : (ply === 5 ? 10 : 0);
    const idToOd17 = ply === 3 ? 40 : (ply === 5 ? 50 : 0);

    // 2. Take up Factor
    const factorMap: Record<string, number> = { "A": 1.5, "B": 1.35, "C": 1.42, "E": 1.26, "B+C": 1.38, "B+E": 1.3 };
    const takeUpFactor = factorMap[formData.flute] || 0;

    // 3. GSM
    const gsm = Number(formData.l1) + (Number(formData.f1) * takeUpFactor) + Number(formData.l2) + (Number(formData.f2) * takeUpFactor) + Number(formData.l3);

    // 4. Reel As Per Calc
    const reelAsPerCalc = (!breadth) ? (height * ups) : (((breadth + height) * ups) + ((idToOd * ups) + 16));

    // 5. Cutting with Trimming
    let cutting = 0;
    if (!breadth) {
        cutting = length;
    } else if (noOfParts === 1) {
        cutting = ((length + breadth) * 2) + (idToOd17 * noOfParts);
    } else if (noOfParts === 2) {
        cutting = (length + breadth) + idToOd17;
    }

    // 6. Reel Actual (default to Calc if not set)
    const reelActual = Number(formData.reelActualWithTrimming) || reelAsPerCalc;

    // 7. Sheet Weight
    const sheetWeight = (ups > 0) ? ((reelActual * cutting * gsm) / 1000000000) / ups : 0;

    // 8. Totals
    const totalPaperWeight = sheetWeight * qty;
    const totalWeightOfSet = sheetWeight + plateWeight;
    const realizationPerKg = (totalWeightOfSet !== 0) ? (rate / totalWeightOfSet) * noOfParts : 0;
    const productionInMeter = (ups > 0) ? ((cutting * qty) / 1000) / ups : 0;

    setFormData(prev => ({
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
        productionInMeter: parseFloat(productionInMeter.toFixed(2))
    }));

  }, [formData.ply, formData.flute, formData.length, formData.breadth, formData.height, formData.ups, formData.noOfParts, formData.l1, formData.f1, formData.l2, formData.f2, formData.l3, formData.qty, formData.rate, formData.plateWeight, formData.reelActualWithTrimming]);

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
    if (!selectedSchedule || !selectedOrder || !selectedItem || !formData.qty) return;

    const qty = Number(formData.qty);
    if (qty <= 0 || qty > pendingQty) return;

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      const nextPendingQty = pendingQty - qty;

      await setProductions((prev) => {
        const txnNo = generateTransactionNo("PR", prev, formData.date);
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
            Object.entries(formData).filter(([key]) => !['date', 'qty', 'remarks'].includes(key))
          )
        } as Production;
        return [newEntry, ...prev];
      });

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

      setFormData({
        date: new Date().toISOString().split("T")[0],
        qty: "",
        remarks: "",
        noOfParts: "",
        ups: "",
        planQty: "",
        length: "",
        breadth: "",
        height: "",
        reelAsPerCalc: "",
        reelActualWithTrimming: "",
        cuttingWithTrimming: "",
        ply: "",
        idToOd: "",
        flute: "",
        takeUpFactor: "",
        l1: "",
        f1: "",
        l2: "",
        f2: "",
        l3: "",
        gsm: "",
        sheetWeight: "",
        plateWeight: "",
        totalPaperWeight: "",
        rate: "",
        totalWeightOfSet: "",
        realizationPerKg: "",
        companyName: "",
        actualPaperUsed: "",
        avgWeight: "",
        prodFromSheetPlant: "",
        prodFromFFG: "",
        wastage: "",
        realizationApprovalStatus: "",
        wastageApproval: "",
        productionInMeter: "",
        plannedProductionInMeter: "",
        leastSheetWeight: "",
        fluteBatches: "",
        erpCodeReel: ""
      });

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

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Scheduled Order <span className="text-red-500">*</span></label>
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
              <InfoTile label="Schedule Date" value={formatDate(selectedSchedule.scheduledDate)} />
              <InfoTile label="Scheduled Qty" value={`${selectedSchedule.qty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Produced Qty" value={`${selectedSchedule.producedQty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Cancelled Qty" value={`${selectedSchedule.canceledQty || 0} ${selectedItem?.uom || ""}`} />
              <InfoTile label="Pending Qty" value={`${pendingQty} ${selectedItem?.uom || ""}`} />
            </div>
          )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Production Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black">Quantity <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                    type="number"
                  step="any"
                  min={0}
                  max={pendingQty || undefined}
                    value={formData.qty}
                    onChange={(e) => setFormData({ ...formData, qty: e.target.value === "" ? "" : parseFloat(e.target.value) })}
                    required
                  placeholder="Enter produced quantity"
                  className="w-full border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
                />
                {selectedItem && <span className="absolute right-3 top-2.5 text-black font-bold opacity-60">{selectedItem.uom}</span>}
              </div>
              {selectedSchedule && <span className="text-xs font-bold text-slate-500">Max allowed: {pendingQty}</span>}
            </div>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="font-bold text-black">Remarks</label>
            <input
              type="text"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm"
            />
          </div>

          <div className="border-t border-black pt-4 mt-6">
            <h3 className="font-black uppercase text-xs text-slate-500 mb-4">Detailed Specifications</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormInput label="No. of Parts" value={formData.noOfParts} readOnly type="number" />
              <FormInput label="UPS" value={formData.ups} onChange={(v) => setFormData({...formData, ups: v})} type="number" />
              <FormInput label="Plan QTY" value={formData.planQty} onChange={(v) => setFormData({...formData, planQty: v})} type="number" />

              <FormInput label="Length" value={formData.length} readOnly type="number" />
              <FormInput label="Breadth" value={formData.breadth} readOnly type="number" />
              <FormInput label="Height" value={formData.height} readOnly type="number" />

              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase">PLY</label>
                <select value={formData.ply} onChange={(e) => setFormData({...formData, ply: e.target.value})} className="border border-black rounded px-2 py-1 text-sm bg-slate-50">
                    <option value="">-</option>
                    <option value="3">3 PLY</option>
                    <option value="5">5 PLY</option>
                </select>
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase">Flute</label>
                <select value={formData.flute} onChange={(e) => setFormData({...formData, flute: e.target.value})} className="border border-black rounded px-2 py-1 text-sm bg-slate-50">
                    <option value="">-</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="E">E</option>
                    <option value="B+C">B+C</option>
                    <option value="B+E">B+E</option>
                </select>
              </div>
              <FormInput label="ID to OD" value={formData.idToOd} readOnly />

              <FormInput label="Take up Factor" value={formData.takeUpFactor} readOnly />
              <FormInput label="GSM" value={formData.gsm} readOnly />
              <FormInput label="ERP Code Reel" value={formData.erpCodeReel} readOnly />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
               <FormInput label="L1" value={formData.l1} onChange={(v) => setFormData({...formData, l1: v})} type="number" />
               <FormInput label="F1" value={formData.f1} onChange={(v) => setFormData({...formData, f1: v})} type="number" />
               <FormInput label="L2" value={formData.l2} onChange={(v) => setFormData({...formData, l2: v})} type="number" />
               <FormInput label="F2" value={formData.f2} onChange={(v) => setFormData({...formData, f2: v})} type="number" />
               <FormInput label="L3" value={formData.l3} onChange={(v) => setFormData({...formData, l3: v})} type="number" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <FormInput label="Reel Per Calc" value={formData.reelAsPerCalc} readOnly />
              <FormInput label="Reel Actual Trim" value={formData.reelActualWithTrimming} onChange={(v) => setFormData({...formData, reelActualWithTrimming: v})} type="number" />
              <FormInput label="Cutting Trim" value={formData.cuttingWithTrimming} readOnly />
              
              <FormInput label="Sheet Weight" value={formData.sheetWeight} readOnly />
              <FormInput label="Plate/PHP Weight" value={formData.plateWeight} readOnly type="number" step="0.00001" />
              <FormInput label="Total Paper Wt" value={formData.totalPaperWeight} readOnly />
              
              <FormInput label="Total Wt of Set" value={formData.totalWeightOfSet} readOnly />
              <FormInput label="Avg Weight" value={formData.avgWeight} readOnly type="number" step="0.00001" />
              <FormInput label="Actual Paper Used" value={formData.actualPaperUsed} readOnly type="number" step="0.00001" />
              
              <FormInput label="Rate" value={formData.rate} readOnly type="number" />
              <FormInput label="Realization/KG" value={formData.realizationPerKg} readOnly />
              <FormInput label="Realization Status" value={formData.realizationApprovalStatus} readOnly />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <FormInput label="Prod (Sheet Plant)" value={formData.prodFromSheetPlant} readOnly type="number" />
              <FormInput label="Prod (FFG)" value={formData.prodFromFFG} readOnly type="number" />
              <FormInput label="Wastage" value={formData.wastage} readOnly type="number" />
              
              <FormInput label="Wastage Approval" value={formData.wastageApproval} readOnly />
              <FormInput label="Prod (Meter)" value={formData.productionInMeter} readOnly />
              <FormInput label="Planned Prod (Mtr)" value={formData.plannedProductionInMeter} readOnly type="number" />
              
              <FormInput label="Least Sheet Wt" value={formData.leastSheetWeight} readOnly type="number" step="0.00001" />
              <FormInput label="Flute Batches" value={formData.fluteBatches} readOnly />
              <FormInput label="Company Name" value={formData.companyName} readOnly />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !selectedSchedule || Number(formData.qty || 0) <= 0 || Number(formData.qty || 0) > pendingQty}
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

function FormInput({ label, value, onChange, type = "text", step = "any", readOnly = false }: { 
  label: string; 
  value: string | number; 
  onChange?: (v: any) => void;
  type?: string;
  step?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col space-y-1">
      <label className="text-[10px] font-black text-slate-500 uppercase">{label}</label>
      <input
        readOnly={readOnly}
        type={type}
        step={type === "number" ? step : undefined}
        value={value}
        onChange={(e) => onChange?.(type === "number" ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value)}
        className={cn(
            "border border-black rounded px-2 py-1 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600",
            readOnly && "bg-slate-100 cursor-not-allowed opacity-70"
        )}
      />
    </div>
  );
}
