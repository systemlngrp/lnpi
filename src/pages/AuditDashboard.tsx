import React, { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { useData } from "../hooks/useData";
import { getInvoiceGrandTotal } from "../lib/gatePasses";
import type {
  AuditDashboardSnapshot,
  Invoice,
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssue,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturn,
  MaterialReturnLine,
  MaterialReturnReelLine,
  Production,
} from "../types";
import { cn } from "../lib/utils";

const ALERT_EMAILS = ["cfo@lngrp.in", "vivekagarwal@lngrp.in", "pankaj@bizskilledu.com"];
const ALL_DATA_DATE_RANGE = { from: "", to: "" };
const ALL_DATA_RANGE_LABEL = "All Dates";

type AuditMetricKey = "invoiceValue" | "consumptionValue" | "manufacturingValue" | "saleValue" | "debitNote";

type AuditMetric = {
  key: AuditMetricKey;
  label: string;
  appValue: number;
  tallyValue: number;
  appCount: number;
  tallyCount: number;
  difference: number;
};

type TallyValues = {
  invoiceValueTally: number;
  consumptionValueTally: number;
  manufacturingValueTally: number;
  saleValueTally: number;
  debitNoteTally: number;
  invoiceCountTally: number;
  consumptionCountTally: number;
  manufacturingCountTally: number;
  saleCountTally: number;
  debitNoteCountTally: number;
};

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatMoney(value: number) {
  return roundMoney(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCount(value: number) {
  return Number(value || 0).toLocaleString("en-IN");
}

function getMaterialInPurchaseAuditValue(entry: MaterialIn) {
  const lineGst = roundMoney(
    (entry.lines || []).reduce(
      (sum, line) => sum + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0),
      0
    )
  );
  const expenseGst = roundMoney(Number(entry.expenseCGST || 0) + Number(entry.expenseSGST || 0) + Number(entry.expenseIGST || 0));
  const totalGst = roundMoney(Number(entry.totalCgst || 0) + Number(entry.totalSgst || 0) + Number(entry.totalIgst || 0));
  const hasExpenseOnlyGst = expenseGst !== 0 && lineGst === 0 && expenseGst === totalGst;

  if (hasExpenseOnlyGst) {
    return roundMoney(
      Number(entry.totalInvoiceValueAfterGst || 0) +
        Number(entry.insurance || 0) +
        Number(entry.otherCharges || 0) -
        Number(entry.roundOff || 0)
    );
  }

  return roundMoney(Number(entry.totalAmount || 0));
}

function getSnapshotId() {
  return `audit-${ALL_DATA_DATE_RANGE.from || "all"}-${ALL_DATA_DATE_RANGE.to || "all"}`;
}

function getReelRateForSlip({
  slip,
  materialInMap,
  materialMap,
}: {
  slip?: MaterialInPackingSlip;
  materialInMap: Map<string, MaterialIn>;
  materialMap: Map<string, Material>;
}) {
  if (!slip) return 0;
  const receipt = materialInMap.get(slip.materialInId);
  const line = receipt?.lines.find((entry) => entry.id === slip.materialLineId);
  const material = materialMap.get(slip.materialId);
  return Number(line?.invoiceRate ?? line?.poRate ?? line?.rate ?? material?.openingRate ?? 0);
}

function getSnapshotValues(snapshot?: AuditDashboardSnapshot): TallyValues {
  return {
    invoiceValueTally: roundMoney(Number(snapshot?.invoiceValueTally || 0)),
    consumptionValueTally: roundMoney(Number(snapshot?.consumptionValueTally || 0)),
    manufacturingValueTally: roundMoney(Number(snapshot?.manufacturingValueTally || 0)),
    saleValueTally: roundMoney(Number(snapshot?.saleValueTally || 0)),
    debitNoteTally: roundMoney(Number(snapshot?.debitNoteTally || 0)),
    invoiceCountTally: Number(snapshot?.invoiceCountTally || 0),
    consumptionCountTally: Number(snapshot?.consumptionCountTally || 0),
    manufacturingCountTally: Number(snapshot?.manufacturingCountTally || 0),
    saleCountTally: Number(snapshot?.saleCountTally || 0),
    debitNoteCountTally: Number(snapshot?.debitNoteCountTally || 0),
  };
}

function getSnapshotSortTime(snapshot: AuditDashboardSnapshot) {
  const parsed = new Date(snapshot.updateTimestamp || "").getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hasJobNo(issue: MaterialIssue) {
  return String(issue.jobNo || "").trim() !== "";
}

function isCancelledIssue(issue: MaterialIssue) {
  return String(issue.tallyPostingStatus || "").trim().toLowerCase() === "cancelled";
}

function isNotApplicableIssue(issue: MaterialIssue) {
  const normalized = String(issue.notApplicable || "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

export function AuditDashboard() {
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [materials] = useData<Material>("materials", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [productions] = useData<Production>("productions", []);
  const [snapshots] = useData<AuditDashboardSnapshot>("audit_dashboard_snapshots", []);
  const [tallyValues, setTallyValues] = useState<TallyValues>(getSnapshotValues());
  const [fetchedAt, setFetchedAt] = useState("");

  const snapshotId = getSnapshotId();
  const currentSnapshot = useMemo(() => {
    const exactSnapshot = snapshots.find(
      (entry) => entry.id === snapshotId || (entry.dateFrom === ALL_DATA_DATE_RANGE.from && entry.dateTo === ALL_DATA_DATE_RANGE.to)
    );
    if (exactSnapshot) return exactSnapshot;

    return [...snapshots].sort((a, b) => getSnapshotSortTime(b) - getSnapshotSortTime(a))[0];
  }, [snapshotId, snapshots]);

  useEffect(() => {
    setTallyValues(getSnapshotValues(currentSnapshot));
    setFetchedAt(currentSnapshot?.updateTimestamp || "");
  }, [currentSnapshot]);

  const appValues = useMemo(() => {
    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));
    const consumptionIssueIdSet = new Set(
      materialIssues
        .filter((entry) => !hasJobNo(entry) && !isCancelledIssue(entry) && !isNotApplicableIssue(entry))
        .map((entry) => entry.id)
    );
    const manufacturingProductions = productions.filter(
      (production) =>
        !production.cancelTimestamp &&
        production.status !== "Cancelled" &&
        Number(production.prodFromFFG || 0) > 0
    );
    const manufacturingProductionIdSet = new Set(manufacturingProductions.map((production) => production.id));
    const manufacturingProductionJobNoSet = new Set(
      manufacturingProductions
        .map((production) => String(production.transactionNo || "").trim())
        .filter(Boolean)
    );
    const isManufacturingProductionEntry = (entry: { productionId?: string; jobNo?: string }) => {
      const productionId = String(entry.productionId || "").trim();
      if (productionId) return manufacturingProductionIdSet.has(productionId);
      const jobNo = String(entry.jobNo || "").trim();
      return jobNo ? manufacturingProductionJobNoSet.has(jobNo) : false;
    };
    const manufacturingIssueIdSet = new Set(materialIssues.filter(isManufacturingProductionEntry).map((entry) => entry.id));
    const manufacturingReturnIdSet = new Set(materialReturns.filter(isManufacturingProductionEntry).map((entry) => entry.id));
    const reelIssueLineIds = new Set(issueReelLines.map((line) => line.materialIssueLineId));
    const reelReturnLineIds = new Set(returnReelLines.map((line) => line.materialReturnLineId));
    const tallyPostedMaterialIn = materialIn.filter(
      (entry) => String(entry.tallyTimestamp || "").trim() && String(entry.transactionNo || "").trim() !== "1"
    );

    const getIssueReelValue = (issueIds: Set<string>) => issueReelLines
      .filter((line) => issueIds.has(line.materialIssueId))
      .reduce((sum, line) => {
        const rate = getReelRateForSlip({ slip: packingSlipMap.get(line.packingSlipId), materialInMap, materialMap });
        return sum + Number(line.weightKg || 0) * rate;
      }, 0);

    const getConsumptionMaterialAmount = (issueIds: Set<string>) => materialIssueLines
      .filter((line) => issueIds.has(line.materialIssueId))
      .reduce((sum, line) => sum + Number(line.amount || 0), 0);

    const getManufacturingIssueMaterialValue = (issueIds: Set<string>) => materialIssueLines
      .filter((line) => issueIds.has(line.materialIssueId) && !reelIssueLineIds.has(line.id))
      .reduce((sum, line) => {
        const savedAmount = Number(line.amount || 0);
        if (savedAmount > 0) return sum + savedAmount;
        const savedRate = Number(line.rate || 0);
        if (savedRate > 0) return sum + Number(line.qty || 0) * savedRate;
        const material = materialMap.get(line.materialId);
        return sum + Number(line.qty || 0) * Number(material?.openingRate || 0);
      }, 0);

    const getReturnReelValue = (returnIds: Set<string>) => returnReelLines
      .filter((line) => returnIds.has(line.materialReturnId))
      .reduce((sum, line) => {
        const rate = getReelRateForSlip({ slip: packingSlipMap.get(line.packingSlipId), materialInMap, materialMap });
        return sum + Number(line.weightKg || 0) * rate;
      }, 0);

    const getReturnMaterialValue = (returnIds: Set<string>) => materialReturnLines
      .filter((line) => returnIds.has(line.materialReturnId) && !reelReturnLineIds.has(line.id))
      .reduce((sum, line) => {
        const savedAmount = Number(line.amount || 0);
        if (savedAmount > 0) return sum + savedAmount;
        const savedRate = Number(line.rate || 0);
        if (savedRate > 0) return sum + Number(line.qty || 0) * savedRate;
        const material = materialMap.get(line.materialId);
        return sum + Number(line.qty || 0) * Number(material?.openingRate || 0);
      }, 0);

    const consumptionValue = getConsumptionMaterialAmount(consumptionIssueIdSet);
    const manufacturingIssueValue = getIssueReelValue(manufacturingIssueIdSet) + getManufacturingIssueMaterialValue(manufacturingIssueIdSet);
    const manufacturingReturnValue = getReturnReelValue(manufacturingReturnIdSet) + getReturnMaterialValue(manufacturingReturnIdSet);
    const manufacturingValue = manufacturingIssueValue - manufacturingReturnValue;

    return {
      invoiceValue: roundMoney(
        tallyPostedMaterialIn.reduce((sum, entry) => {
          return sum + getMaterialInPurchaseAuditValue(entry);
        }, 0)
      ),
      invoiceCount: tallyPostedMaterialIn.length,
      consumptionValue: roundMoney(consumptionValue),
      consumptionCount: consumptionIssueIdSet.size,
      manufacturingValue: roundMoney(manufacturingValue),
      manufacturingCount: manufacturingProductionIdSet.size,
      saleValue: roundMoney(
        invoices.reduce((sum, invoice) => sum + getInvoiceGrandTotal(invoice), 0)
      ),
      saleCount: invoices.length,
      debitNote: roundMoney(materialIn.reduce((sum, entry) => sum + Number(entry.debitNoteAmount || 0), 0)),
      debitNoteCount: materialIn.filter((entry) => roundMoney(Number(entry.debitNoteAmount || 0)) !== 0).length,
    };
  }, [invoices, issueReelLines, materialIn, materialIssueLines, materialIssues, materialReturnLines, materialReturns, materials, packingSlips, productions, returnReelLines]);

  const metrics = useMemo<AuditMetric[]>(() => {
    const baseMetrics: Array<Omit<AuditMetric, "difference">> = [
      { key: "invoiceValue", label: "Invoice Value", appValue: appValues.invoiceValue, tallyValue: tallyValues.invoiceValueTally, appCount: appValues.invoiceCount, tallyCount: tallyValues.invoiceCountTally },
      { key: "consumptionValue", label: "Consumption Value", appValue: appValues.consumptionValue, tallyValue: tallyValues.consumptionValueTally, appCount: appValues.consumptionCount, tallyCount: tallyValues.consumptionCountTally },
      { key: "manufacturingValue", label: "Manufacturing Journal Audit", appValue: appValues.manufacturingValue, tallyValue: tallyValues.manufacturingValueTally, appCount: appValues.manufacturingCount, tallyCount: tallyValues.manufacturingCountTally },
      { key: "saleValue", label: "Sale Value", appValue: appValues.saleValue, tallyValue: tallyValues.saleValueTally, appCount: appValues.saleCount, tallyCount: tallyValues.saleCountTally },
      { key: "debitNote", label: "Debit Note", appValue: appValues.debitNote, tallyValue: tallyValues.debitNoteTally, appCount: appValues.debitNoteCount, tallyCount: tallyValues.debitNoteCountTally },
    ];

    return baseMetrics.map((metric) => ({ ...metric, difference: roundMoney(metric.tallyValue - metric.appValue) }));
  }, [appValues, tallyValues]);

  const differenceMetrics = metrics.filter((metric) => roundMoney(metric.difference) !== 0);
  const hasDifference = differenceMetrics.length > 0;

  const alertMessage = useMemo(() => {
    const lines = [
      `Audit Dashboard Difference Found`,
      `Date Range: ${ALL_DATA_RANGE_LABEL}`,
      "Tally Source: Last saved values",
      "",
      ...differenceMetrics.map(
        (metric) =>
          `${metric.label}: Tally Count ${formatCount(metric.tallyCount)} | App Count ${formatCount(metric.appCount)} | Tally ${formatMoney(metric.tallyValue)} | App ${formatMoney(metric.appValue)} | Difference ${formatMoney(metric.difference)}`
      ),
    ];
    return lines.join("\n");
  }, [differenceMetrics]);

  const emailHref = `mailto:${ALERT_EMAILS.join(",")}?subject=${encodeURIComponent("Audit Dashboard Difference Found")}&body=${encodeURIComponent(alertMessage)}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(alertMessage)}`;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-950 md:text-2xl">Audit Dashboard</h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Tally vs app value comparison</p>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Tally source: last saved values
          {fetchedAt ? ` | Fetched: ${fetchedAt}` : ""}
        </div>
      </section>

      {hasDifference ? (
        <section className="overflow-hidden rounded-xl border-2 border-red-900 bg-red-50 shadow-[4px_4px_0px_0px_rgba(127,29,29,1)]">
          <div className="border-b-2 border-red-900 bg-red-700 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white">
            Difference Found
          </div>
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1 text-sm font-bold text-red-950">
              {differenceMetrics.map((metric) => (
                <div key={metric.key}>
                  {metric.label}: {formatMoney(metric.difference)}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={emailHref}
                className="inline-flex min-h-[38px] items-center gap-2 rounded-md border-2 border-red-900 bg-white px-4 py-1 text-xs font-black uppercase text-red-700 shadow-[3px_3px_0px_0px_rgba(127,29,29,1)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
              >
                <Mail size={15} />
                Email
              </a>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[38px] items-center gap-2 rounded-md border-2 border-red-900 bg-white px-4 py-1 text-xs font-black uppercase text-red-700 shadow-[3px_3px_0px_0px_rgba(127,29,29,1)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
              >
                <MessageCircle size={15} />
                WhatsApp
              </a>
            </div>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900">
          Value Match
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-100">
              <tr className="divide-x divide-slate-900 border-b-2 border-slate-900">
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Particular</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Tally Count</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">App Count</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Tally Value</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">App Value</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Difference</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-white">
              {metrics.map((metric, index) => {
                const mismatched = roundMoney(metric.difference) !== 0;
                return (
                  <tr key={metric.key} className={cn("divide-x divide-slate-900", index % 2 === 0 ? "bg-white" : "bg-slate-50")}>
                    <td className="px-3 py-3 text-sm font-black uppercase tracking-wide text-slate-900">{metric.label}</td>
                    <td className="px-3 py-3 text-right text-sm font-black text-slate-900">{formatCount(metric.tallyCount)}</td>
                    <td className="px-3 py-3 text-right text-sm font-black text-indigo-800">{formatCount(metric.appCount)}</td>
                    <td className="px-3 py-3 text-right text-sm font-black text-slate-900">{formatMoney(metric.tallyValue)}</td>
                    <td className="px-3 py-3 text-right text-sm font-black text-indigo-800">{formatMoney(metric.appValue)}</td>
                    <td className={cn("px-3 py-3 text-right text-sm font-black", mismatched ? "text-red-700" : "text-emerald-700")}>{formatMoney(metric.difference)}</td>
                    <td className="px-3 py-3">
                      <span className={cn("inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase", mismatched ? "border-red-800 bg-red-50 text-red-700" : "border-emerald-800 bg-emerald-50 text-emerald-700")}>
                        {mismatched ? "Difference" : "Matched"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
