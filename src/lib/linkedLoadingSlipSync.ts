import { LinkedLoadingDetail, LoadingSlip } from "../types";

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
  cancelReason,
}: {
  prevSlips: LoadingSlip[];
  parentSlip: LoadingSlip;
  details: LinkedLoadingDetail[];
  cancelReason?: string;
}): LoadingSlip[] {
  const timestamp = new Date().toISOString();
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

  const nextSlip: LoadingSlip = {
    id: existing?.id || crypto.randomUUID(),
    slipNo: existing?.slipNo || "",
    date: parentSlip.date,
    truckId: parentSlip.truckId,
    loadingSource: parentSlip.loadingSource,
    companyId: parentSlip.companyId,
    companyName: parentSlip.companyName,
    fgLoadingId: parentSlip.id,
    lines: buildLinkedLines(details),
    status: "Active" as const,
    cancelReason: undefined,
    cancelledAt: undefined,
    cancelledBy: undefined,
    invoiceId: existing?.invoiceId,
    packingDetails: existing?.packingDetails,
    extraItemsQty: existing?.extraItemsQty,
    updatedBy: "System User",
    updateTimestamp: timestamp,
  };

  if (!existing) {
    return [...prevSlips, nextSlip];
  }

  return prevSlips.map((row) => (row.id === existing.id ? nextSlip : row));
}
