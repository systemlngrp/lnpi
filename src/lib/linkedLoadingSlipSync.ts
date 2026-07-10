import { LinkedLoadingDetail, LoadingSlip } from "../types";
import { generateTransactionNo } from "./serial";

function getLinkedConsumptionConfig(source: Extract<LinkedLoadingDetail["source"], "PHP" | "PLATE">) {
  if (source === "PHP") {
    return {
      fieldName: "phpConsumptionTransactionNo" as const,
      prefix: "PHPCON",
      voucherType: "PHP Consumption Journal",
    };
  }

  return {
    fieldName: "plateConsumptionTransactionNo" as const,
    prefix: "PLCON",
    voucherType: "Plate Consumption Journal",
  };
}

function getLinkedConsumptionTransactionNo(
  prevSlips: LoadingSlip[],
  existing: LoadingSlip | undefined,
  source: Extract<LinkedLoadingDetail["source"], "PHP" | "PLATE">,
  date: string
) {
  const { fieldName, prefix } = getLinkedConsumptionConfig(source);
  const existingValue = String(existing?.[fieldName] || "").trim();
  if (existingValue) return existingValue;

  const eligibleRecords = prevSlips
    .filter((row) => String(row.fgLoadingId || "").trim())
    .map((row) => ({
      transactionNo: String(row[fieldName] || "").trim(),
      date: row.date,
    }));

  return generateTransactionNo(prefix, eligibleRecords, date || new Date().toISOString());
}

function buildLinkedLines(details: LinkedLoadingDetail[]): LoadingSlip["lines"] {
  return details.map((detail) => ({
    dispatchPlanId: "",
    loadedQty: detail.requiredQty,
    itemId: detail.itemId,
    itemName: detail.itemName,
    companyName: detail.companyName,
    erpCode: detail.erpCode,
    masterErp: detail.masterErp,
    itemSource: detail.source,
  }));
}

export function upsertFgLinkedChildSlip({
  prevSlips,
  parentSlip,
  details,
  source,
  cancelReason,
}: {
  prevSlips: LoadingSlip[];
  parentSlip: LoadingSlip;
  details: LinkedLoadingDetail[];
  source: Extract<LinkedLoadingDetail["source"], "PHP" | "PLATE">;
  cancelReason?: string;
}): LoadingSlip[] {
  const timestamp = new Date().toISOString();
  const { fieldName, voucherType } = getLinkedConsumptionConfig(source);
  const existing = prevSlips.find((row) => String(row.fgLoadingId || "").trim() === parentSlip.id);

  if (details.length === 0) {
    if (!existing) return prevSlips;
    return prevSlips.map((row) =>
      row.id === existing.id
        ? {
            ...row,
            status: "Cancelled" as const,
            cancelReason: cancelReason || "Auto-cancelled because parent FG loading no longer has linked rows.",
            cancelledAt: timestamp,
            cancelledBy: "System User",
            updatedBy: "System User",
            updateTimestamp: timestamp,
          }
        : row
    );
  }

  const nextConsumptionTransactionNo = String(parentSlip.id || "").trim()
    ? getLinkedConsumptionTransactionNo(prevSlips, existing, source, parentSlip.date)
    : "";

  const nextSlip: LoadingSlip = {
    id: existing?.id || crypto.randomUUID(),
    slipNo: existing?.slipNo || "",
    date: parentSlip.date,
    truckId: parentSlip.truckId,
    loadingSource: parentSlip.loadingSource,
    companyId: parentSlip.companyId,
    companyName: parentSlip.companyName,
    fgLoadingId: parentSlip.id,
    [fieldName]: nextConsumptionTransactionNo || undefined,
    lines: buildLinkedLines(details),
    status: "Active" as const,
    cancelReason: undefined,
    cancelledAt: undefined,
    cancelledBy: undefined,
    invoiceId: existing?.invoiceId,
    invoiceNo: existing?.invoiceNo,
    packingDetails: existing?.packingDetails,
    extraItemsQty: existing?.extraItemsQty,
    tallyTimestamp: existing?.tallyTimestamp,
    tallyPostingStatus: existing?.tallyPostingStatus,
    tallyPostingError: existing?.tallyPostingError,
    tallyPostingAttemptCount: existing?.tallyPostingAttemptCount,
    tallyLastAttemptAt: existing?.tallyLastAttemptAt,
    tallyVoucherNo: existing?.tallyVoucherNo,
    tallyVoucherDate: existing?.tallyVoucherDate,
    tallyVoucherType: existing?.tallyVoucherType || voucherType,
    tallyPostedBy: existing?.tallyPostedBy,
    tallyPostingRemark: existing?.tallyPostingRemark,
    updatedBy: "System User",
    updateTimestamp: timestamp,
  };

  if (!existing) {
    return [...prevSlips, nextSlip];
  }

  return prevSlips.map((row) => (row.id === existing.id ? nextSlip : row));
}
