import { MaterialIn, MaterialLine } from "../types";

export type MaterialInSupplyType = "INTRA_STATE" | "INTER_STATE";

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

export function recalculateMaterialLine(line: MaterialLine): MaterialLine {
  const invoiceQty = Number(line.invoiceQty ?? line.qty ?? 0);
  const invoiceRate = Number(line.invoiceRate ?? line.rate ?? 0);
  const actualQty = Number(line.actualQty ?? line.qty ?? invoiceQty);
  const invoiceValue = round2(invoiceQty * invoiceRate);
  const actualValue = round2(actualQty * invoiceRate);
  const taxableAmount = round2(actualValue);
  const gstRate = Number(line.gstRate || 0);
  const cgstRate = Number(line.cgstRate || 0);
  const sgstRate = Number(line.sgstRate || 0);
  const igstRate = Number(line.igstRate || 0);
  const cgst = round2((taxableAmount * cgstRate) / 100);
  const sgst = round2((taxableAmount * sgstRate) / 100);
  const igst = round2((taxableAmount * igstRate) / 100);
  const gstAmount = round2(cgst + sgst + igst);

  return {
    ...line,
    qty: actualQty,
    invoiceQty,
    invoiceRate,
    invoiceValue,
    actualQty,
    actualValue,
    rate: invoiceRate,
    value: actualValue,
    gstRate,
    cgstRate,
    sgstRate,
    igstRate,
    taxableAmount,
    gstAmount,
    cgst,
    sgst,
    igst,
    totalAmount: round2(taxableAmount + gstAmount),
  };
}

export function applySupplyTypeTaxRates(
  line: MaterialLine,
  supplyType: MaterialInSupplyType,
  options?: { forceFromGstRate?: boolean }
): MaterialLine {
  const gstRate = Number(line.gstRate || 0);
  const currentCgstRate = Number(line.cgstRate || 0);
  const currentSgstRate = Number(line.sgstRate || 0);
  const currentIgstRate = Number(line.igstRate || 0);
  const hasStoredSplit = currentCgstRate > 0 || currentSgstRate > 0 || currentIgstRate > 0;
  const forceFromGstRate = options?.forceFromGstRate === true;

  if (supplyType === "INTER_STATE") {
    return recalculateMaterialLine({
      ...line,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: forceFromGstRate || !hasStoredSplit ? gstRate : currentIgstRate,
      cgst: 0,
      sgst: 0,
    });
  }

  const defaultHalf = gstRate > 0 ? gstRate / 2 : 0;
  return recalculateMaterialLine({
    ...line,
    cgstRate: forceFromGstRate || !hasStoredSplit ? defaultHalf : currentCgstRate,
    sgstRate: forceFromGstRate || !hasStoredSplit ? defaultHalf : currentSgstRate,
    igstRate: 0,
    igst: 0,
  });
}

export function summarizeMaterialInLines(
  lines: MaterialLine[],
  insurance?: number | string,
  otherCharges?: number | string,
  roundOff?: number | string
) {
  const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) => recalculateMaterialLine({ ...line }));
  const totalInvoiceValue = round2(normalizedLines.reduce((sum, line) => sum + Number(line.invoiceValue || 0), 0));
  const totalActualValue = round2(normalizedLines.reduce((sum, line) => sum + Number(line.actualValue || line.value || 0), 0));
  const totalCgst = round2(normalizedLines.reduce((sum, line) => sum + Number(line.cgst || 0), 0));
  const totalSgst = round2(normalizedLines.reduce((sum, line) => sum + Number(line.sgst || 0), 0));
  const totalIgst = round2(normalizedLines.reduce((sum, line) => sum + Number(line.igst || 0), 0));
  const insuranceValue = round2(Number(insurance || 0));
  const otherChargesValue = round2(Number(otherCharges || 0));
  const roundOffValue = round2(Number(roundOff || 0));
  const totalInvoiceValueAfterGst = round2(totalInvoiceValue + totalCgst + totalSgst + totalIgst);
  const totalAmount = round2(
    totalActualValue + totalCgst + totalSgst + totalIgst + insuranceValue + otherChargesValue + roundOffValue
  );

  return {
    lines: normalizedLines,
    totalInvoiceValue,
    totalActualValue,
    totalCgst,
    totalSgst,
    totalIgst,
    totalInvoiceValueAfterGst,
    insuranceValue,
    otherChargesValue,
    roundOffValue,
    totalAmount,
  };
}

export function normalizeMaterialInRecord(entry: MaterialIn): MaterialIn {
  const summary = summarizeMaterialInLines(entry.lines || [], entry.insurance, entry.otherCharges, entry.roundOff);
  return {
    ...entry,
    lines: summary.lines,
    totalInvoiceValue: summary.totalInvoiceValue,
    totalActualValue: summary.totalActualValue,
    totalCgst: summary.totalCgst,
    totalSgst: summary.totalSgst,
    totalIgst: summary.totalIgst,
    totalInvoiceValueAfterGst: summary.totalInvoiceValueAfterGst,
    insurance: summary.insuranceValue,
    otherCharges: summary.otherChargesValue,
    roundOff: summary.roundOffValue,
    totalAmount: summary.totalAmount,
  };
}
