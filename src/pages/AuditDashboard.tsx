import React, { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, RefreshCw } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useData } from "../hooks/useData";
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
} from "../types";
import { getLocalDateInputValue, getSafeRange, isDateWithinRange, type OperationDashboardDateRange } from "../lib/operationDashboard";
import { cn } from "../lib/utils";

const ALERT_EMAILS = ["cfo@lngrp.in", "vivekagarwal@lngrp.in", "pankaj@bizskilledu.com"];
const TALLY_HELPER_URL = "http://127.0.0.1:8765/audit-dashboard/tally-values";

type AuditMetricKey = "invoiceValue" | "consumptionValue" | "saleValue" | "debitNote";

type AuditMetric = {
  key: AuditMetricKey;
  label: string;
  tallyField: keyof Pick<
    AuditDashboardSnapshot,
    "invoiceValueTally" | "consumptionValueTally" | "saleValueTally" | "debitNoteTally"
  >;
  appValue: number;
  tallyValue: number;
  difference: number;
};

type TallyValues = Pick<
  AuditDashboardSnapshot,
  "invoiceValueTally" | "consumptionValueTally" | "saleValueTally" | "debitNoteTally"
>;

type TallyFetchResponse = TallyValues & {
  ok?: boolean;
  sourceUrl?: string;
  fetchedAt?: string;
  counts?: Record<string, number>;
  error?: string;
};

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatMoney(value: number) {
  return `INR ${roundMoney(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getDefaultRange(): OperationDashboardDateRange {
  const today = getLocalDateInputValue(new Date());
  return { from: today, to: today };
}

function getSnapshotId(dateRange: OperationDashboardDateRange) {
  return `audit-${dateRange.from || "all"}-${dateRange.to || "all"}`;
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

function getVoucherCountKey(metricKey: AuditMetricKey) {
  const map: Record<AuditMetricKey, string> = {
    invoiceValue: "Purchase",
    consumptionValue: "Consumption Journal",
    saleValue: "Sales",
    debitNote: "Debit Note",
  };
  return map[metricKey];
}
function getSnapshotValues(snapshot?: AuditDashboardSnapshot): TallyValues {
  return {
    invoiceValueTally: roundMoney(Number(snapshot?.invoiceValueTally || 0)),
    consumptionValueTally: roundMoney(Number(snapshot?.consumptionValueTally || 0)),
    saleValueTally: roundMoney(Number(snapshot?.saleValueTally || 0)),
    debitNoteTally: roundMoney(Number(snapshot?.debitNoteTally || 0)),
  };
}

export function AuditDashboard() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<OperationDashboardDateRange>(getDefaultRange);
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
  const [snapshots, , snapshotsLoading, snapshotActions] = useData<AuditDashboardSnapshot>("audit_dashboard_snapshots", []);
  const [tallyValues, setTallyValues] = useState<TallyValues>(getSnapshotValues());
  const [isFetchingTally, setIsFetchingTally] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [voucherCounts, setVoucherCounts] = useState<Record<string, number>>({});

  const snapshotId = getSnapshotId(dateRange);
  const currentSnapshot = useMemo(
    () => snapshots.find((entry) => entry.id === snapshotId || (entry.dateFrom === dateRange.from && entry.dateTo === dateRange.to)),
    [dateRange.from, dateRange.to, snapshotId, snapshots]
  );

  useEffect(() => {
    setTallyValues(getSnapshotValues(currentSnapshot));
    setFetchError("");
    setSourceUrl("");
    setFetchedAt(currentSnapshot?.updateTimestamp || "");
    setVoucherCounts({});
  }, [currentSnapshot]);

  const safeRange = useMemo(() => getSafeRange(dateRange), [dateRange]);

  const appValues = useMemo(() => {
    const materialInInRange = safeRange ? materialIn.filter((entry) => isDateWithinRange(entry.date, safeRange)) : materialIn;
    const invoicesInRange = safeRange ? invoices.filter((entry) => isDateWithinRange(entry.date, safeRange)) : invoices;
    const issuesInRange = safeRange ? materialIssues.filter((entry) => isDateWithinRange(entry.date, safeRange)) : materialIssues;
    const returnsInRange = safeRange ? materialReturns.filter((entry) => isDateWithinRange(entry.date, safeRange)) : materialReturns;

    const materialMap = new Map(materials.map((material) => [material.id, material]));
    const materialInMap = new Map(materialIn.map((entry) => [entry.id, entry]));
    const packingSlipMap = new Map(packingSlips.map((slip) => [slip.id, slip]));
    const issueIdSet = new Set(issuesInRange.map((entry) => entry.id));
    const returnIdSet = new Set(returnsInRange.map((entry) => entry.id));
    const reelIssueLineIds = new Set(issueReelLines.map((line) => line.materialIssueLineId));
    const reelReturnLineIds = new Set(returnReelLines.map((line) => line.materialReturnLineId));

    const issueReelValue = issueReelLines
      .filter((line) => issueIdSet.has(line.materialIssueId))
      .reduce((sum, line) => {
        const rate = getReelRateForSlip({ slip: packingSlipMap.get(line.packingSlipId), materialInMap, materialMap });
        return sum + Number(line.weightKg || 0) * rate;
      }, 0);

    const returnReelValue = returnReelLines
      .filter((line) => returnIdSet.has(line.materialReturnId))
      .reduce((sum, line) => {
        const rate = getReelRateForSlip({ slip: packingSlipMap.get(line.packingSlipId), materialInMap, materialMap });
        return sum + Number(line.weightKg || 0) * rate;
      }, 0);

    const issueMaterialValue = materialIssueLines
      .filter((line) => issueIdSet.has(line.materialIssueId) && !reelIssueLineIds.has(line.id))
      .reduce((sum, line) => {
        const material = materialMap.get(line.materialId);
        return sum + Number(line.qty || 0) * Number(material?.openingRate || 0);
      }, 0);

    const returnMaterialValue = materialReturnLines
      .filter((line) => returnIdSet.has(line.materialReturnId) && !reelReturnLineIds.has(line.id))
      .reduce((sum, line) => {
        const material = materialMap.get(line.materialId);
        return sum + Number(line.qty || 0) * Number(material?.openingRate || 0);
      }, 0);

    return {
      invoiceValue: roundMoney(
        materialInInRange.reduce((sum, entry) => {
          const afterGst = Number(entry.totalInvoiceValueAfterGst || 0);
          return sum + (afterGst > 0 ? afterGst : Number(entry.totalInvoiceValue || 0));
        }, 0)
      ),
      consumptionValue: roundMoney(issueReelValue + issueMaterialValue - returnReelValue - returnMaterialValue),
      saleValue: roundMoney(invoicesInRange.reduce((sum, invoice) => sum + Number(invoice.totalAfterGst || 0), 0)),
      debitNote: roundMoney(materialInInRange.reduce((sum, entry) => sum + Number(entry.debitNoteAmount || 0), 0)),
    };
  }, [invoices, issueReelLines, materialIn, materialIssueLines, materialIssues, materialReturnLines, materialReturns, materials, packingSlips, returnReelLines, safeRange]);

  const metrics = useMemo<AuditMetric[]>(() => {
    const baseMetrics: Array<Omit<AuditMetric, "difference">> = [
      { key: "invoiceValue", label: "Invoice Value", tallyField: "invoiceValueTally", appValue: appValues.invoiceValue, tallyValue: tallyValues.invoiceValueTally },
      { key: "consumptionValue", label: "Consumption Value", tallyField: "consumptionValueTally", appValue: appValues.consumptionValue, tallyValue: tallyValues.consumptionValueTally },
      { key: "saleValue", label: "Sale Value", tallyField: "saleValueTally", appValue: appValues.saleValue, tallyValue: tallyValues.saleValueTally },
      { key: "debitNote", label: "Debit Note", tallyField: "debitNoteTally", appValue: appValues.debitNote, tallyValue: tallyValues.debitNoteTally },
    ];

    return baseMetrics.map((metric) => ({ ...metric, difference: roundMoney(metric.tallyValue - metric.appValue) }));
  }, [appValues, tallyValues]);

  const differenceMetrics = metrics.filter((metric) => roundMoney(metric.difference) !== 0);
  const hasDifference = differenceMetrics.length > 0;

  const alertMessage = useMemo(() => {
    const lines = [
      `Audit Dashboard Difference Found`,
      `Date Range: ${dateRange.from || "All"} to ${dateRange.to || "All"}`,
      sourceUrl ? `Tally Source: ${sourceUrl}` : "Tally Source: Last saved values / not fetched in this session",
      "",
      ...differenceMetrics.map(
        (metric) =>
          `${metric.label}: Tally ${formatMoney(metric.tallyValue)} | App ${formatMoney(metric.appValue)} | Difference ${formatMoney(metric.difference)}`
      ),
    ];
    return lines.join("\n");
  }, [dateRange.from, dateRange.to, differenceMetrics, sourceUrl]);

  const emailHref = `mailto:${ALERT_EMAILS.join(",")}?subject=${encodeURIComponent("Audit Dashboard Difference Found")}&body=${encodeURIComponent(alertMessage)}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(alertMessage)}`;

  const persistFetchedValues = async (values: TallyValues, timestamp: string) => {
    await snapshotActions.saveItem({
      id: snapshotId,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      ...values,
      updatedBy: user?.name || user?.email || "System User",
      updateTimestamp: timestamp,
    });
    await snapshotActions.refresh({ force: true });
  };

  const fetchTallyValues = async () => {
    setIsFetchingTally(true);
    setFetchError("");
    try {
      const response = await fetch(TALLY_HELPER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: dateRange.from, dateTo: dateRange.to }),
      });
      const payload = (await response.json().catch(() => ({}))) as TallyFetchResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Failed to fetch Tally values from local helper.");
      }

      const nextValues: TallyValues = {
        invoiceValueTally: roundMoney(Number(payload.invoiceValueTally || 0)),
        consumptionValueTally: roundMoney(Number(payload.consumptionValueTally || 0)),
        saleValueTally: roundMoney(Number(payload.saleValueTally || 0)),
        debitNoteTally: roundMoney(Number(payload.debitNoteTally || 0)),
      };
      const timestamp = payload.fetchedAt || new Date().toISOString();
      setTallyValues(nextValues);
      setSourceUrl(payload.sourceUrl || "");
      setFetchedAt(timestamp);
      setVoucherCounts(payload.counts || {});
      await persistFetchedValues(nextValues, timestamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to fetch Tally values.";
      setFetchError(
        message.includes("Failed to fetch")
          ? "Local Tally helper is not reachable. Start python\\tally_audit_dashboard_helper.py on this PC, then retry."
          : message
      );
    } finally {
      setIsFetchingTally(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-950 md:text-2xl">Audit Dashboard</h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Tally vs app value comparison</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateInput value={dateRange.from} onChange={(value) => setDateRange((prev) => ({ ...prev, from: value }))} />
            <DateInput value={dateRange.to} onChange={(value) => setDateRange((prev) => ({ ...prev, to: value }))} />
            <button
              type="button"
              onClick={fetchTallyValues}
              disabled={isFetchingTally || snapshotsLoading}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-md border-2 border-slate-900 bg-emerald-50 px-4 py-1 text-xs font-black uppercase text-emerald-700 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none disabled:opacity-50"
            >
              <RefreshCw size={15} className={cn(isFetchingTally && "animate-spin")} />
              {isFetchingTally ? "Fetching" : "Fetch From Tally"}
            </button>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          {sourceUrl ? `Connected Tally: ${sourceUrl}` : "Tally source: last saved values until Fetch From Tally is clicked"}
          {fetchedAt ? ` | Fetched: ${fetchedAt}` : ""}
        </div>
      </section>

      {fetchError ? (
        <section className="rounded-xl border-2 border-amber-800 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 shadow-[4px_4px_0px_0px_rgba(146,64,14,1)]">
          {fetchError}
        </section>
      ) : null}

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
                    <td className="px-3 py-3 text-right text-sm font-black text-slate-900">
                      {formatMoney(metric.tallyValue)}
                      {voucherCounts[getVoucherCountKey(metric.key)] !== undefined ? (
                        <div className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                          {voucherCounts[getVoucherCountKey(metric.key)]} voucher(s)
                        </div>
                      ) : null}
                    </td>
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

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-h-[38px] items-center rounded-md border-2 border-slate-900 bg-slate-50 px-2.5 py-0.5 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]">
      <input
        type="date"
        className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-black leading-tight uppercase text-slate-900 outline-none focus:ring-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}