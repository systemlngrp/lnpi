import { MaterialIn, MaterialLine } from "../types";

export type MaterialInSupplyType = "INTRA_STATE" | "INTER_STATE";
export type MaterialInExpenseTaxes = {
  expenseCGST?: number | string;
  expenseSGST?: number | string;
  expenseIGST?: number | string;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

export function normalizeInvoiceCurrency(value: unknown): "INR" | "USD" {
  return value === "USD" ? "USD" : "INR";
}

function normalizeExchangeRate(currency: "INR" | "USD", value: unknown) {
  const numeric = Number(value || 0);
  if (currency !== "USD") return undefined;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return round2(numeric);
}

export function recalculateMaterialLine(
  line: MaterialLine,
  options?: { invoiceCurrency?: "INR" | "USD"; exchangeRate?: number | string }
): MaterialLine {
  const invoiceCurrency = normalizeInvoiceCurrency(options?.invoiceCurrency ?? line.invoiceCurrency);
  const exchangeRate = normalizeExchangeRate(invoiceCurrency, options?.exchangeRate ?? line.exchangeRate);
  const invoiceQty = Number(line.invoiceQty ?? line.qty ?? 0);
  const actualQty = Number(line.actualQty ?? line.qty ?? invoiceQty);

  let invoiceRate = Number(line.invoiceRate ?? line.rate ?? 0);
  let invoiceRateUsd: number | undefined;
  let invoiceValueUsd: number | undefined;
  let actualValueUsd: number | undefined;

  if (invoiceCurrency === "USD") {
    const derivedUsdRate = exchangeRate && invoiceRate > 0 ? round2(invoiceRate / exchangeRate) : 0;
    invoiceRateUsd = round2(Number(line.invoiceRateUsd ?? derivedUsdRate ?? 0));
    invoiceRate = exchangeRate ? round2(invoiceRateUsd * exchangeRate) : 0;
    invoiceValueUsd = round2(invoiceQty * invoiceRateUsd);
    actualValueUsd = round2(actualQty * invoiceRateUsd);
  }

  const invoiceValue = round2(invoiceQty * invoiceRate);
  const actualValue = round2(actualQty * invoiceRate);
  const taxableAmount = round2(invoiceValue);
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
    invoiceCurrency,
    exchangeRate,
    invoiceQty,
    invoiceRate,
    invoiceRateUsd: invoiceCurrency === "USD" ? invoiceRateUsd : undefined,
    invoiceValue,
    invoiceValueUsd: invoiceCurrency === "USD" ? invoiceValueUsd : undefined,
    actualQty,
    actualValue,
    actualValueUsd: invoiceCurrency === "USD" ? actualValueUsd : undefined,
    qty: actualQty,
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
  options?: { forceFromGstRate?: boolean; invoiceCurrency?: "INR" | "USD"; exchangeRate?: number | string }
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
    }, { invoiceCurrency: options?.invoiceCurrency, exchangeRate: options?.exchangeRate });
  }

  const defaultHalf = gstRate > 0 ? gstRate / 2 : 0;
  return recalculateMaterialLine({
    ...line,
    cgstRate: forceFromGstRate || !hasStoredSplit ? defaultHalf : currentCgstRate,
    sgstRate: forceFromGstRate || !hasStoredSplit ? defaultHalf : currentSgstRate,
    igstRate: 0,
    igst: 0,
  }, { invoiceCurrency: options?.invoiceCurrency, exchangeRate: options?.exchangeRate });
}

export function summarizeMaterialInLines(
  lines: MaterialLine[],
  insurance?: number | string,
  otherCharges?: number | string,
  roundOff?: number | string,
  expenseTaxes?: MaterialInExpenseTaxes,
  options?: { invoiceCurrency?: "INR" | "USD"; exchangeRate?: number | string }
) {
  const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) =>
    recalculateMaterialLine({ ...line }, { invoiceCurrency: options?.invoiceCurrency, exchangeRate: options?.exchangeRate })
  );
  const totalInvoiceValue = round2(normalizedLines.reduce((sum, line) => sum + Number(line.invoiceValue || 0), 0));
  const totalInvoiceValueUsd = round2(normalizedLines.reduce((sum, line) => sum + Number(line.invoiceValueUsd || 0), 0));
  const totalActualValue = round2(normalizedLines.reduce((sum, line) => sum + Number(line.actualValue || line.value || 0), 0));
  const totalActualValueUsd = round2(normalizedLines.reduce((sum, line) => sum + Number(line.actualValueUsd || 0), 0));
  const lineCgst = round2(normalizedLines.reduce((sum, line) => sum + Number(line.cgst || 0), 0));
  const lineSgst = round2(normalizedLines.reduce((sum, line) => sum + Number(line.sgst || 0), 0));
  const lineIgst = round2(normalizedLines.reduce((sum, line) => sum + Number(line.igst || 0), 0));
  const insuranceValue = round2(Number(insurance || 0));
  const otherChargesValue = round2(Number(otherCharges || 0));
  const expenseCGSTValue = round2(Number(expenseTaxes?.expenseCGST || 0));
  const expenseSGSTValue = round2(Number(expenseTaxes?.expenseSGST || 0));
  const expenseIGSTValue = round2(Number(expenseTaxes?.expenseIGST || 0));
  const roundOffValue = round2(Number(roundOff || 0));
  const totalCgst = round2(lineCgst + expenseCGSTValue);
  const totalSgst = round2(lineSgst + expenseSGSTValue);
  const totalIgst = round2(lineIgst + expenseIGSTValue);
  const totalInvoiceValueAfterGst = round2(totalInvoiceValue + lineCgst + lineSgst + lineIgst);
  const totalAmount = round2(
    totalInvoiceValueAfterGst +
      insuranceValue +
      otherChargesValue +
      expenseCGSTValue +
      expenseSGSTValue +
      expenseIGSTValue +
      roundOffValue
  );

  return {
    lines: normalizedLines,
    totalInvoiceValue,
    totalInvoiceValueUsd,
    totalActualValue,
    totalActualValueUsd,
    totalCgst,
    totalSgst,
    totalIgst,
    lineCgst,
    lineSgst,
    lineIgst,
    expenseCGSTValue,
    expenseSGSTValue,
    expenseIGSTValue,
    totalInvoiceValueAfterGst,
    insuranceValue,
    otherChargesValue,
    roundOffValue,
    totalAmount,
  };
}

export function normalizeMaterialInRecord(entry: MaterialIn): MaterialIn {
  const invoiceCurrency = normalizeInvoiceCurrency(entry.invoiceCurrency);
  const exchangeRate = normalizeExchangeRate(invoiceCurrency, entry.exchangeRate);
  const summary = summarizeMaterialInLines(
    entry.lines || [],
    entry.insurance,
    entry.otherCharges,
    entry.roundOff,
    {
      expenseCGST: entry.expenseCGST,
      expenseSGST: entry.expenseSGST,
      expenseIGST: entry.expenseIGST,
    },
    {
      invoiceCurrency,
      exchangeRate,
    }
  );
  return {
    ...entry,
    invoiceCurrency,
    exchangeRate,
    lines: summary.lines,
    totalInvoiceValue: summary.totalInvoiceValue,
    totalInvoiceValueUsd: summary.totalInvoiceValueUsd,
    totalActualValue: summary.totalActualValue,
    totalActualValueUsd: summary.totalActualValueUsd,
    totalCgst: summary.totalCgst,
    totalSgst: summary.totalSgst,
    totalIgst: summary.totalIgst,
    totalInvoiceValueAfterGst: summary.totalInvoiceValueAfterGst,
    insurance: summary.insuranceValue,
    otherCharges: summary.otherChargesValue,
    expenseCGST: summary.expenseCGSTValue,
    expenseSGST: summary.expenseSGSTValue,
    expenseIGST: summary.expenseIGSTValue,
    roundOff: summary.roundOffValue,
    totalAmount: summary.totalAmount,
  };
}
