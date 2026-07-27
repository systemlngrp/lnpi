import { Company, GatePass, GatePassLine, Invoice, InvoiceLineItem, LoadingSlip, Truck } from "../types";

type BuildGatePassOptions = {
  company?: Company;
  date?: string;
  existingId?: string;
  gatePassNo?: string;
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  resolveItemName?: (line: InvoiceLineItem) => string;
  overrideTruckId?: string;
  remarks?: string;
  selectedLoadingSlipIds: string[];
  slips: LoadingSlip[];
  trucks: Truck[];
  updatedBy?: string;
  updateTimestamp?: string;
};

export function getInvoiceGrandTotal(invoice: Invoice) {
  const otherCharges = Number(invoice.otherCharges || 0);
  const otherChargesGstRate = Number(invoice.otherChargesGstRate || 0);
  const nonTaxableOtherCharges = otherCharges !== 0 && otherChargesGstRate > 0 ? 0 : otherCharges;
  return Number(invoice.totalAfterGst || 0) + nonTaxableOtherCharges + Number(invoice.roundOff || 0);
}

export function buildGatePassFromInvoice({
  company,
  date,
  existingId,
  gatePassNo,
  invoice,
  lineItems,
  resolveItemName,
  overrideTruckId,
  remarks,
  selectedLoadingSlipIds,
  slips,
  trucks,
  updatedBy,
  updateTimestamp,
}: BuildGatePassOptions): GatePass {
  const selectedIds = new Set(selectedLoadingSlipIds.filter(Boolean));
  const selectedSlips = slips.filter((slip) => selectedIds.has(slip.id));
  const selectedSlipNos = selectedSlips.map((slip) => slip.slipNo).filter(Boolean);
  const relevantLineItems = lineItems.filter(
    (line) => line.invoiceId === invoice.id && selectedIds.has(line.loadingSlipId)
  );
  const lineMap = new Map<string, GatePassLine>();
  relevantLineItems.forEach((line) => {
    const itemId = String(line.itemId || "").trim();
    const itemName = String(resolveItemName?.(line) || (line as InvoiceLineItem & { itemName?: string }).itemName || "Unknown").trim() || "Unknown";
    const slip = selectedSlips.find((row) => row.id === line.loadingSlipId);
    const nextQty = Number(line.qty || 0);
    const nextRate = Number(line.rate || 0);
    const existing = lineMap.get(itemId);

    if (existing) {
      const previousQty = Number(existing.qty || 0);
      existing.qty += nextQty;
      existing.rate =
        existing.qty > 0 ? Number((((existing.rate * previousQty) + nextRate * nextQty) / existing.qty).toFixed(2)) : nextRate;
      existing.amount += Number(line.amount || 0) + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0);
      if (slip?.id && !existing.loadingSlipIds.includes(slip.id)) existing.loadingSlipIds.push(slip.id);
      if (slip?.slipNo && !existing.loadingSlipNos.includes(slip.slipNo)) existing.loadingSlipNos.push(slip.slipNo);
      return;
    }

    lineMap.set(itemId, {
      id: crypto.randomUUID(),
      itemId,
      itemName,
      itemDescription: itemName,
      uom: "PCS",
      qty: nextQty,
      rate: nextRate,
      amount: Number(line.amount || 0) + Number(line.cgst || 0) + Number(line.sgst || 0) + Number(line.igst || 0),
      loadingSlipIds: slip?.id ? [slip.id] : [],
      loadingSlipNos: slip?.slipNo ? [slip.slipNo] : [],
    });
  });

  const selectedTruckIds = Array.from(
    new Set(selectedSlips.map((slip) => String(slip.truckId || "").trim()).filter(Boolean))
  );
  const overrideTruck = overrideTruckId ? trucks.find((truck) => truck.id === overrideTruckId) : undefined;
  const defaultTruck =
    !overrideTruck && selectedTruckIds.length === 1
      ? trucks.find((truck) => truck.id === selectedTruckIds[0])
      : undefined;

  const truckId = overrideTruck?.id || defaultTruck?.id || "";
  const truckNo =
    overrideTruck?.truckNo ||
    defaultTruck?.truckNo ||
    Array.from(
      new Set(
        selectedSlips
          .map((slip) => slip.truckNo || trucks.find((truck) => truck.id === slip.truckId)?.truckNo || "")
          .filter(Boolean)
      )
    ).join(", ");

  return {
    id: existingId || crypto.randomUUID(),
    gatePassNo: gatePassNo || "",
    date: date || invoice.date || new Date().toISOString().slice(0, 10),
    gatePassType: "Non-Returnable",
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    companyId: invoice.companyId,
    companyName: company?.name || "",
    recipientId: invoice.companyId,
    recipientName: company?.name || "",
    recipientType: "Customer",
    truckId: truckId || undefined,
    truckNo: truckNo || undefined,
    loadingSlipIds: selectedSlips.map((slip) => slip.id),
    loadingSlipNos: selectedSlipNos,
    remarks: remarks || "",
    totalQty: relevantLineItems.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    totalAmount: Number(getInvoiceGrandTotal(invoice).toFixed(2)),
    lines: Array.from(lineMap.values()),
    updatedBy,
    updateTimestamp,
  };
}
