import React, { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useNpdItems } from "../hooks/useNpdItems";
import { getInvoiceGrandTotal } from "../lib/gatePasses";
import { buildReelStockRows } from "../lib/reelStock";
import type {
  AuditDashboardSnapshot,
  Invoice,
  Item,
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
  Supplier,
} from "../types";
import { cn } from "../lib/utils";
import { formatDate } from "../lib/serial";
import { ExcelExport } from "../components/ExcelExport";

const ALL_DATA_DATE_RANGE = { from: "", to: "" };
const ALL_DATA_RANGE_LABEL = "All Dates";

type AuditMetricKey =
  | "invoiceValue"
  | "consumptionValue"
  | "manufacturingValue"
  | "saleValue"
  | "debitNote"
  | "npdStockValue"
  | "npdStockQty"
  | "reelStockQty"
  | "reelStockValue";

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
  npdStockValueTally: number;
  npdStockQtyTally: number;
  reelStockQtyTally: number;
  reelStockValueTally: number;
  invoiceCountTally: number;
  consumptionCountTally: number;
  manufacturingCountTally: number;
  saleCountTally: number;
  debitNoteCountTally: number;
  npdStockCountTally: number;
  npdStockQtyCountTally: number;
  reelStockQtyCountTally: number;
  reelStockCountTally: number;
};
type ReelMaterialMismatchRow = {
  materialId: string;
  erp: string;
  itemName: string;
  size: number;
  gsm: number;
  bf: number;
  color: string;
  appStock: number;
  tallyStock: number | null;
  difference: number | null;
  status: "DIFFERENCE" | "NO TALLY STOCK";
};

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

function formatMoney(value: number) {
  return roundMoney(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstNumber(...values: Array<number | string | null | undefined>) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getBillingSalesQty(item: Item) {
  return roundMoney(Number(item.invoiced || 0));
}

function normalizeAuditKey(value: unknown) {
  return String(value || "").trim();
}

function getAuditMfjAppQty(
  item: Item,
  productions: Production[],
  materialIssues: MaterialIssue[],
  materialIssueLines: MaterialIssueLine[],
  materialReturns: MaterialReturn[],
  materialReturnLines: MaterialReturnLine[]
) {
  const itemIds = new Set(
    [item.id, (item as any).npdId, (item as any).itemId]
      .map((value) => normalizeAuditKey(value))
      .filter(Boolean)
  );
  const itemErp = normalizeAuditKey(item.erp);
  const countedProductionIds = new Set<string>();
  const activeProductions = productions.filter((production) => !production.cancelTimestamp && production.status !== "Cancelled");
  const productionIdSet = new Set(activeProductions.map((production) => normalizeAuditKey(production.id)).filter(Boolean));
  const productionJobNoSet = new Set(activeProductions.map((production) => normalizeAuditKey(production.transactionNo)).filter(Boolean));

  const productionQty = activeProductions.reduce((sum, production) => {
    const productionId = normalizeAuditKey(production.id);
    if (productionId && countedProductionIds.has(productionId)) return sum;

    const directItemMatch = [production.npdId, production.itemId].some((value) => itemIds.has(normalizeAuditKey(value)));
    const masterErpMatch = Boolean(itemErp) && normalizeAuditKey(production.masterErp) === itemErp;
    if (!directItemMatch && !masterErpMatch) return sum;

    if (productionId) countedProductionIds.add(productionId);
    return sum + Number(production.prodFromFFG || 0);
  }, 0);

  if (roundMoney(productionQty) !== 0) return roundMoney(productionQty);

  const isManufacturingEntry = (entry: { productionId?: string; jobNo?: string }) => {
    const productionId = normalizeAuditKey(entry.productionId);
    if (productionId) return productionIdSet.has(productionId);
    const jobNo = normalizeAuditKey(entry.jobNo);
    return jobNo ? productionJobNoSet.has(jobNo) : false;
  };
  const issueIdSet = new Set(
    materialIssues
      .filter((issue) => !isCancelledIssue(issue) && !isNotApplicableIssue(issue) && isManufacturingEntry(issue))
      .map((issue) => normalizeAuditKey(issue.id))
      .filter(Boolean)
  );
  const returnIdSet = new Set(
    materialReturns
      .filter(isManufacturingEntry)
      .map((entry) => normalizeAuditKey(entry.id))
      .filter(Boolean)
  );
  const issuedQty = materialIssueLines
    .filter((line) => issueIdSet.has(normalizeAuditKey(line.materialIssueId)) && itemIds.has(normalizeAuditKey(line.materialId)))
    .reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const returnedQty = materialReturnLines
    .filter((line) => returnIdSet.has(normalizeAuditKey(line.materialReturnId)) && itemIds.has(normalizeAuditKey(line.materialId)))
    .reduce((sum, line) => sum + Number(line.qty || 0), 0);

  return roundMoney(issuedQty - returnedQty);
}

function formatCount(value: number) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatLastSync(value: string) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return "Last Sync : -";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(parsed);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const time = `${getPart("hour")}:${getPart("minute")} ${getPart("dayPeriod").toUpperCase()}`;
  const date = `${getPart("day")}-${getPart("month")}-${getPart("year")}`;

  return `Last Sync : ${time} | ${date}`;
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

function getSnapshotValues(snapshot?: AuditDashboardSnapshot): TallyValues {
  return {
    invoiceValueTally: roundMoney(Number(snapshot?.invoiceValueTally || 0)),
    consumptionValueTally: roundMoney(Number(snapshot?.consumptionValueTally || 0)),
    manufacturingValueTally: roundMoney(Number(snapshot?.manufacturingValueTally || 0)),
    saleValueTally: roundMoney(Number(snapshot?.saleValueTally || 0)),
    debitNoteTally: roundMoney(Number(snapshot?.debitNoteTally || 0)),
    npdStockValueTally: roundMoney(Number(snapshot?.npdStockValueTally || 0)),
    // npdStockQty is computed live from npdItems, not from snapshot
    npdStockQtyTally: 0,
    reelStockQtyTally: roundMoney(Number(snapshot?.reelStockQtyTally || 0)),
    reelStockValueTally: roundMoney(Number(snapshot?.reelStockValueTally || 0)),
    invoiceCountTally: Number(snapshot?.invoiceCountTally || 0),
    consumptionCountTally: Number(snapshot?.consumptionCountTally || 0),
    manufacturingCountTally: Number(snapshot?.manufacturingCountTally || 0),
    saleCountTally: Number(snapshot?.saleCountTally || 0),
    debitNoteCountTally: Number(snapshot?.debitNoteCountTally || 0),
    npdStockCountTally: Number(snapshot?.npdStockCountTally || 0),
    npdStockQtyCountTally: 0,
    reelStockQtyCountTally: Number(snapshot?.reelStockQtyCountTally || 0),
    reelStockCountTally: Number(snapshot?.reelStockCountTally || 0),
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

function isDebitNotePostedToTally(entry: MaterialIn) {
  return String(entry.debitTallySync || "").trim() !== "";
}

function isInvoicePostedToTally(invoice: Invoice) {
  return String(invoice.tallyTimestamp || "").trim() !== "";
}

function isProductionPostedToTally(production: Production) {
  return String(production.tallyTimestamp || "").trim() !== "";
}

export function AuditDashboard() {
  const [materialIn] = useData<MaterialIn>("material-in", []);
  const [materialIssues] = useData<MaterialIssue>("material-issues", []);
  const [materialIssueLines] = useData<MaterialIssueLine>("material-issue-lines", []);
  const [materialReturns] = useData<MaterialReturn>("material-returns", []);
  const [materialReturnLines] = useData<MaterialReturnLine>("material-return-lines", []);
  const [invoices] = useData<Invoice>("invoices", []);
  const [productions] = useData<Production>("productions", []);
  const [materials] = useData<Material>("materials", []);
  const [packingSlips] = useData<MaterialInPackingSlip>("material-in-packing-slips", []);
  const [issueReelLines] = useData<MaterialIssueReelLine>("material-issue-reel-lines", []);
  const [returnReelLines] = useData<MaterialReturnReelLine>("material-return-reel-lines", []);
  const [suppliers] = useData<Supplier>("suppliers", []);
  const npdItems = useNpdItems();
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
    const consumptionIssueIdSet = new Set(
      materialIssues
        .filter((entry) => !hasJobNo(entry) && !isCancelledIssue(entry) && !isNotApplicableIssue(entry))
        .map((entry) => entry.id)
    );
    const manufacturingProductions = productions.filter(
      (production) =>
        !production.cancelTimestamp &&
        production.status !== "Cancelled" &&
        isProductionPostedToTally(production) &&
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
    const tallyPostedMaterialIn = materialIn.filter(
      (entry) => String(entry.tallyTimestamp || "").trim() && String(entry.transactionNo || "").trim() !== "1"
    );
    const tallyPostedDebitNotes = materialIn.filter(isDebitNotePostedToTally);
    const tallyPostedInvoices = invoices.filter(isInvoicePostedToTally);

    const getIssueLineValue = (issueIds: Set<string>) => materialIssueLines
      .filter((line) => issueIds.has(line.materialIssueId))
      .reduce((sum, line) => {
        const savedAmount = Number(line.amount || 0);
        if (savedAmount > 0) return sum + savedAmount;
        const savedRate = Number(line.rate || 0);
        return sum + Number(line.qty || 0) * savedRate;
      }, 0);

    const getReturnLineValue = (returnIds: Set<string>) => materialReturnLines
      .filter((line) => returnIds.has(line.materialReturnId))
      .reduce((sum, line) => {
        const savedAmount = Number(line.amount || 0);
        if (savedAmount > 0) return sum + savedAmount;
        const savedRate = Number(line.rate || 0);
        return sum + Number(line.qty || 0) * savedRate;
      }, 0);

    const consumptionValue = getIssueLineValue(consumptionIssueIdSet);
    const manufacturingIssueValue = getIssueLineValue(manufacturingIssueIdSet);
    const manufacturingReturnValue = getReturnLineValue(manufacturingReturnIdSet);
    const manufacturingValue = manufacturingIssueValue - manufacturingReturnValue;

    const activeNpdItems = npdItems.filter((item) => Number(item.balance || 0) > 0);
    const npdStockValue = roundMoney(
      activeNpdItems.reduce((sum, item) => sum + Number(item.balance || 0) * Number(item.rate || 0), 0)
    );
    const npdStockCount = activeNpdItems.length;

    // NPD Stock Qty: compare Tally stock qty vs App balance qty per item
    const npdItemsWithTallyStock = npdItems.filter((item) => item.tallyStock != null);
    const npdStockQtyTally = roundMoney(
      npdItemsWithTallyStock.reduce((sum, item) => sum + Number(item.tallyStock || 0), 0)
    );
    const npdStockQtyCountTally = npdItemsWithTallyStock.length;
    const npdStockQtyApp = roundMoney(
      npdItems.reduce((sum, item) => sum + Number(item.balance || 0), 0)
    );
    const npdStockQtyCountApp = npdItems.filter((item) => Number(item.balance || 0) > 0).length;

    const reelStockRows = buildReelStockRows({
      materials,
      materialIn,
      packingSlips,
      issueReelLines,
      returnReelLines,
      suppliers,
    });
    const availableReelRows = reelStockRows.filter((row) => row.availableWeight > 0);
    const reelStockValue = roundMoney(
      availableReelRows.reduce((sum, row) => sum + Number(row.valuation || 0), 0)
    );
    const reelStockQtyApp = roundMoney(
      availableReelRows.reduce((sum, row) => sum + Number(row.availableWeight || 0), 0)
    );
    const materialsWithTallyStock = materials.filter((material) => material.type === "Reel" && material.tallyStock != null);
    const reelStockQtyTally = roundMoney(
      materialsWithTallyStock.reduce((sum, material) => sum + Number(material.tallyStock || 0), 0)
    );
    const reelStockQtyCountTally = materialsWithTallyStock.length;
    const reelStockCount = availableReelRows.length;

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
        tallyPostedInvoices.reduce((sum, invoice) => sum + getInvoiceGrandTotal(invoice), 0)
      ),
      saleCount: tallyPostedInvoices.length,
      debitNote: roundMoney(tallyPostedDebitNotes.reduce((sum, entry) => sum + Number(entry.debitNoteAmount || 0), 0)),
      debitNoteCount: tallyPostedDebitNotes.filter((entry) => roundMoney(Number(entry.debitNoteAmount || 0)) !== 0).length,
      npdStockValue,
      npdStockCount,
      npdStockQtyTally,
      npdStockQtyCountTally,
      npdStockQtyApp,
      npdStockQtyCountApp,
      reelStockValue,
      reelStockQtyApp,
      reelStockQtyTally,
      reelStockQtyCountTally,
      reelStockCount,
    };
  }, [invoices, issueReelLines, materialIn, materialIssueLines, materialIssues, materialReturnLines, materialReturns, materials, npdItems, packingSlips, productions, returnReelLines, suppliers]);

  const metrics = useMemo<AuditMetric[]>(() => {
    const baseMetrics: Array<Omit<AuditMetric, "difference">> = [
      { key: "invoiceValue", label: "Invoice Value", appValue: appValues.invoiceValue, tallyValue: tallyValues.invoiceValueTally, appCount: appValues.invoiceCount, tallyCount: tallyValues.invoiceCountTally },
      { key: "consumptionValue", label: "Consumption Value", appValue: appValues.consumptionValue, tallyValue: tallyValues.consumptionValueTally, appCount: appValues.consumptionCount, tallyCount: tallyValues.consumptionCountTally },
      { key: "manufacturingValue", label: "Manufacturing Journal Audit", appValue: appValues.manufacturingValue, tallyValue: tallyValues.manufacturingValueTally, appCount: appValues.manufacturingCount, tallyCount: tallyValues.manufacturingCountTally },
      { key: "saleValue", label: "Sale Value", appValue: appValues.saleValue, tallyValue: tallyValues.saleValueTally, appCount: appValues.saleCount, tallyCount: tallyValues.saleCountTally },
      { key: "debitNote", label: "Debit Note", appValue: appValues.debitNote, tallyValue: tallyValues.debitNoteTally, appCount: appValues.debitNoteCount, tallyCount: tallyValues.debitNoteCountTally },
      { key: "npdStockValue", label: "NPD Stock Valuation", appValue: appValues.npdStockValue, tallyValue: tallyValues.npdStockValueTally, appCount: appValues.npdStockCount, tallyCount: tallyValues.npdStockCountTally },
      { key: "npdStockQty", label: "NPD Stock (Qty)", appValue: appValues.npdStockQtyApp, tallyValue: appValues.npdStockQtyTally, appCount: appValues.npdStockQtyCountApp, tallyCount: appValues.npdStockQtyCountTally },
      { key: "reelStockQty", label: "Reel Stock (Qty)", appValue: appValues.reelStockQtyApp, tallyValue: appValues.reelStockQtyTally, appCount: appValues.reelStockCount, tallyCount: appValues.reelStockQtyCountTally },
      { key: "reelStockValue", label: "Reel Stock Valuation", appValue: appValues.reelStockValue, tallyValue: tallyValues.reelStockValueTally, appCount: appValues.reelStockCount, tallyCount: tallyValues.reelStockCountTally },
    ];

    return baseMetrics.map((metric) => ({ ...metric, difference: roundMoney(metric.tallyValue - metric.appValue) }));
  }, [appValues, tallyValues]);

  const differenceMetrics = metrics.filter((metric) => roundMoney(metric.difference) !== 0);
  const hasDifference = differenceMetrics.length > 0;

  const negativeOpeningNpdRows = useMemo(() => {
    return npdItems
      .filter((item) => roundMoney(Number(item.opening || 0)) < 0)
      .map((item) => ({
        id: String(item.id || item.erp || item.name || ""),
        itemName: String(item.name || ""),
        erp: String(item.erp || ""),
        opening: roundMoney(Number(item.opening || 0)),
        balance: roundMoney(Number(item.balance || 0)),
        tallyStock: item.tallyStock == null ? null : roundMoney(Number(item.tallyStock || 0)),
      }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.erp.localeCompare(b.erp));
  }, [npdItems]);
  const negativeOpeningExcelRows = useMemo(
    () =>
      negativeOpeningNpdRows.map((row) => ({
        "Item Name": row.itemName,
        ERP: row.erp,
        Opening: row.opening,
        Balance: row.balance,
        "Tally Stock": row.tallyStock == null ? "" : row.tallyStock,
        Status: "NEGATIVE OPENING",
      })),
    [negativeOpeningNpdRows]
  );

  const npdItemStockMismatchExcelRows = useMemo(
    () =>
      npdItems
        .filter((item) => {
          const appStock = roundMoney(Number(item.balance || 0));
          const tallyStock = roundMoney(Number(item.tallyStock || 0));
          const mfjApp = getAuditMfjAppQty(item, productions, materialIssues, materialIssueLines, materialReturns, materialReturnLines);
          const mfgTally = roundMoney(firstNumber(item.TallyMFJQty, item.tallyMFJQty));
          const salesApp = getBillingSalesQty(item);
          const salesTally = roundMoney(firstNumber(item.TallySalesQty, item.tallySalesQty)); return (
            roundMoney(tallyStock - appStock) !== 0 ||
            roundMoney(mfgTally - mfjApp) !== 0 ||
            roundMoney(salesTally - salesApp) !== 0
          );
        })
        .map((item) => {
          const opening = roundMoney(Number(item.opening || 0));
          const mfjApp = getAuditMfjAppQty(item, productions, materialIssues, materialIssueLines, materialReturns, materialReturnLines);
          const mfgTally = roundMoney(firstNumber(item.TallyMFJQty, item.tallyMFJQty));
          const salesApp = getBillingSalesQty(item);
          const salesTally = roundMoney(firstNumber(item.TallySalesQty, item.tallySalesQty));
          const appStock = roundMoney(Number(item.balance || 0));
          const tallyStock = roundMoney(Number(item.tallyStock || 0));
          const diff = roundMoney(tallyStock - appStock);

          return {
            "Item Name": item.name,
            Opening: opening,
            "MFJ App": mfjApp,
            "MFG Tally": mfgTally,
            "Sales App": salesApp,
            "Sales Tally": salesTally,
            "App Stock (Balance)": appStock,
            "Tally Stock": tallyStock,
            Difference: diff,
            Status: "DIFFERENCE",
          };
        }),
    [materialIssueLines, materialIssues, materialReturnLines, materialReturns, npdItems, productions]
  );
  const reelMaterialMismatchRows = useMemo<ReelMaterialMismatchRow[]>(() => {
    const reelStockRows = buildReelStockRows({
      materials,
      materialIn,
      packingSlips,
      issueReelLines,
      returnReelLines,
      suppliers,
    });

    return materials
      .filter((material) => material.type === "Reel")
      .map((material) => {
        const materialRows = reelStockRows.filter((row) => row.materialId === material.id);
        const appStock = roundMoney(materialRows.reduce((sum, row) => sum + Number(row.availableWeight || 0), 0));
        const hasTallyStock = material.tallyStock != null;
        const tallyStock = hasTallyStock ? roundMoney(Number(material.tallyStock || 0)) : null;
        const difference = tallyStock == null ? null : roundMoney(tallyStock - appStock);

        return {
          materialId: material.id,
          erp: String(material.erpCode || ""),
          itemName: String(material.name || ""),
          size: Number(material.size || 0),
          gsm: Number(material.gsm || 0),
          bf: Number(material.bf || 0),
          color: String(material.color || ""),
          appStock,
          tallyStock,
          difference,
          status: tallyStock == null ? "NO TALLY STOCK" as const : "DIFFERENCE" as const,
        };
      })
      .filter((row) => {
        if (row.tallyStock == null) return row.appStock > 0;
        return roundMoney(row.difference || 0) !== 0;
      })
      .sort((a, b) => a.erp.localeCompare(b.erp) || a.size - b.size || a.gsm - b.gsm || a.bf - b.bf);
  }, [issueReelLines, materialIn, materials, packingSlips, returnReelLines, suppliers]);

  const reelMaterialMismatchExcelRows = useMemo(
    () =>
      reelMaterialMismatchRows.map((row) => ({
        ERP: row.erp,
        "Material Name": row.itemName,
        Size: row.size || "",
        GSM: row.gsm || "",
        BF: row.bf || "",
        Color: row.color,
        "App Stock": row.appStock,
        "Tally Stock": row.tallyStock == null ? "" : row.tallyStock,
        Difference: row.difference == null ? "" : row.difference,
        Status: row.status,
      })),
    [reelMaterialMismatchRows]
  );

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-950 md:text-2xl">Audit Dashboard</h2>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          {formatLastSync(fetchedAt)}
        </div>
      </section>

      {hasDifference ? (
        <section className="overflow-hidden rounded-xl border-2 border-red-900 bg-red-50 shadow-[4px_4px_0px_0px_rgba(127,29,29,1)]">
          <div className="border-b-2 border-red-900 bg-red-700 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white">
            Difference Found
          </div>
          <div className="p-4">
            <div className="space-y-1 text-sm font-bold text-red-950">
              {differenceMetrics.map((metric) => (
                <div key={metric.key}>
                  {metric.label}: {formatMoney(metric.difference)}
                </div>
              ))}
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
                const mismatched = roundMoney(metric.difference) !== 0; return (
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

      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900 flex justify-between items-center gap-3">
          <span>NPD Items With Negative Opening</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-slate-300 font-normal">
              Showing Negative Opening Items ({negativeOpeningNpdRows.length})
            </span>
            <ExcelExport data={negativeOpeningExcelRows} fileName="NPD_Negative_Opening" sheetName="Negative Opening" className="h-7 border-white/40 bg-white px-2 py-0 text-[10px] text-slate-950 hover:bg-slate-100" />
          </div>
        </div>
        <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="divide-x divide-slate-900 border-b-2 border-slate-900">
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Item Name</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">ERP</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Opening</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Balance</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Tally Stock</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-white">
              {negativeOpeningNpdRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-xs font-black uppercase tracking-wide text-emerald-700">
                    No negative opening items found.
                  </td>
                </tr>
              ) : (
                negativeOpeningNpdRows.map((row) => (
                  <tr key={row.id} className="divide-x divide-slate-900 bg-red-50/50">
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">{row.itemName || "-"}</td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">{row.erp || "-"}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-red-700">{formatMoney(row.opening)}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-indigo-800">{formatMoney(row.balance)}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{row.tallyStock == null ? "-" : formatMoney(row.tallyStock)}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full border border-red-800 bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase text-red-700">
                        NEGATIVE OPENING
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900 flex justify-between items-center gap-3">
          <span>NPD Item Stock Mismatch Breakdown (Tally Stock vs App Balance)</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-slate-300 font-normal">
              Showing Mismatched Items ({npdItems.filter((item) => {
              const appStock = roundMoney(Number(item.balance || 0));
              const tallyStock = roundMoney(Number(item.tallyStock || 0));
              const mfjApp = getAuditMfjAppQty(item, productions, materialIssues, materialIssueLines, materialReturns, materialReturnLines);
              const mfgTally = roundMoney(firstNumber(item.TallyMFJQty, item.tallyMFJQty));
              const salesApp = getBillingSalesQty(item);
              const salesTally = roundMoney(firstNumber(item.TallySalesQty, item.tallySalesQty)); return (
                roundMoney(tallyStock - appStock) !== 0 ||
                roundMoney(mfgTally - mfjApp) !== 0 ||
                roundMoney(salesTally - salesApp) !== 0
              );
            }).length})
            </span>
            <ExcelExport data={npdItemStockMismatchExcelRows} fileName="NPD_Item_Stock_Mismatch" sheetName="NPD Mismatch" className="h-7 border-white/40 bg-white px-2 py-0 text-[10px] text-slate-950 hover:bg-slate-100" />
          </div>
        </div>
        <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="divide-x divide-slate-900 border-b-2 border-slate-900">
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Item Name</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Opening</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">MFJ App</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">MFG Tally</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Sales App</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Sales Tally</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">App Stock (Balance)</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Tally Stock</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Difference</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-white">
              {npdItems
                .filter((item) => {
                  const appStock = roundMoney(Number(item.balance || 0));
                  const tallyStock = roundMoney(Number(item.tallyStock || 0));
                  const mfjApp = getAuditMfjAppQty(item, productions, materialIssues, materialIssueLines, materialReturns, materialReturnLines);
                  const mfgTally = roundMoney(firstNumber(item.TallyMFJQty, item.tallyMFJQty));
                  const salesApp = getBillingSalesQty(item);
                  const salesTally = roundMoney(firstNumber(item.TallySalesQty, item.tallySalesQty)); return (
                    roundMoney(tallyStock - appStock) !== 0 ||
                    roundMoney(mfgTally - mfjApp) !== 0 ||
                    roundMoney(salesTally - salesApp) !== 0
                  );
                })
                .map((item, index) => {
                  const opening = roundMoney(Number(item.opening || 0));
                  const mfjApp = getAuditMfjAppQty(item, productions, materialIssues, materialIssueLines, materialReturns, materialReturnLines);
                  const mfgTally = roundMoney(firstNumber(item.TallyMFJQty, item.tallyMFJQty));
                  const salesApp = getBillingSalesQty(item);
                  const salesTally = roundMoney(firstNumber(item.TallySalesQty, item.tallySalesQty));
                  const mfjMismatch = roundMoney(mfgTally - mfjApp) !== 0;
                  const salesMismatch = roundMoney(salesTally - salesApp) !== 0;
                  const appStock = roundMoney(Number(item.balance || 0));
                  const tallyStock = roundMoney(Number(item.tallyStock || 0));
                  const diff = roundMoney(tallyStock - appStock); return (
                    <tr key={item.id || index} className="divide-x divide-slate-900 bg-red-50/50">
                      <td className="px-3 py-2 text-xs font-bold text-slate-900">{item.name}</td>
                      <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{formatMoney(opening)}</td>
                      <td className={cn("px-3 py-2 text-right text-xs font-black text-indigo-800", mfjMismatch && "bg-red-100 text-red-800")}>{formatMoney(mfjApp)}</td>
                      <td className={cn("px-3 py-2 text-right text-xs font-black text-slate-900", mfjMismatch && "bg-red-100 text-red-800")}>{formatMoney(mfgTally)}</td>
                      <td className={cn("px-3 py-2 text-right text-xs font-black text-indigo-800", salesMismatch && "bg-red-100 text-red-800")}>{formatMoney(salesApp)}</td>
                      <td className={cn("px-3 py-2 text-right text-xs font-black text-slate-900", salesMismatch && "bg-red-100 text-red-800")}>{formatMoney(salesTally)}</td>
                      <td className="px-3 py-2 text-right text-xs font-black text-indigo-800">{formatMoney(appStock)}</td>
                      <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{formatMoney(tallyStock)}</td>
                      <td className="px-3 py-2 text-right text-xs font-black text-red-700">{formatMoney(diff)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-full border border-red-800 bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase text-red-700">
                          DIFFERENCE
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border-2 border-slate-900 bg-white shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white border-b-2 border-slate-900 flex justify-between items-center gap-3">
          <span>Reel Material Stock Mismatch Breakdown (Tally Stock vs App Available Weight)</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-slate-300 font-normal">
              Showing Mismatched Materials ({reelMaterialMismatchRows.length})
            </span>
            <ExcelExport data={reelMaterialMismatchExcelRows} fileName="Reel_Material_Stock_Mismatch" sheetName="Reel Mismatch" className="h-7 border-white/40 bg-white px-2 py-0 text-[10px] text-slate-950 hover:bg-slate-100" />
          </div>
        </div>
        <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="divide-x divide-slate-900 border-b-2 border-slate-900">
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">ERP</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Material Name</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Size</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">GSM</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">BF</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Color</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">App Stock</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Tally Stock</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Difference</th>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-white">
              {reelMaterialMismatchRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-xs font-black uppercase tracking-wide text-emerald-700">
                    No reel stock mismatch found.
                  </td>
                </tr>
              ) : (
                reelMaterialMismatchRows.map((row) => (
                  <tr key={row.materialId} className="divide-x divide-slate-900 bg-red-50/50">
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">{row.erp || "-"}</td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">{row.itemName || "-"}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{row.size || "-"}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{row.gsm || "-"}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{row.bf || "-"}</td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-900">{row.color || "-"}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-indigo-800">{formatMoney(row.appStock)}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-slate-900">{row.tallyStock == null ? "-" : formatMoney(row.tallyStock)}</td>
                    <td className="px-3 py-2 text-right text-xs font-black text-red-700">{row.difference == null ? "-" : formatMoney(row.difference)}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase", row.status === "NO TALLY STOCK" ? "border-amber-800 bg-amber-50 text-amber-700" : "border-red-800 bg-red-50 text-red-700")}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}









