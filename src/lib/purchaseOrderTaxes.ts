import type { PurchaseOrderLine, Supplier } from "../types";

export type SupplyType = Supplier["gstSupplyType"] | undefined;

export type PurchaseOrderTaxBreakup = {
  gstRate: number;
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number;
};

export type PurchaseOrderTotals = {
  totalQty: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
};

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function computePurchaseOrderTaxes(
  qty: number,
  rate: number,
  gstRate: number,
  supplyType?: SupplyType,
): PurchaseOrderTaxBreakup {
  const safeQty = Number.isFinite(Number(qty)) ? Number(qty) : 0;
  const safeRate = Number.isFinite(Number(rate)) ? Number(rate) : 0;
  const safeGstRate = Number.isFinite(Number(gstRate)) ? Number(gstRate) : 0;
  const amount = round2(safeQty * safeRate);
  const gstAmount = round2((amount * safeGstRate) / 100);

  if (supplyType === "INTER_STATE") {
    return {
      gstRate: safeGstRate,
      amount,
      cgst: 0,
      sgst: 0,
      igst: gstAmount,
      lineTotal: round2(amount + gstAmount),
    };
  }

  const halfTax = round2(gstAmount / 2);
  return {
    gstRate: safeGstRate,
    amount,
    cgst: halfTax,
    sgst: halfTax,
    igst: 0,
    lineTotal: round2(amount + halfTax + halfTax),
  };
}

export function summarizePurchaseOrderLines(
  lines: Array<Pick<PurchaseOrderLine, "qty" | "amount" | "cgst" | "sgst" | "igst" | "lineTotal">>,
): PurchaseOrderTotals {
  return {
    totalQty: round2(lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)),
    taxableAmount: round2(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)),
    cgst: round2(lines.reduce((sum, line) => sum + Number(line.cgst || 0), 0)),
    sgst: round2(lines.reduce((sum, line) => sum + Number(line.sgst || 0), 0)),
    igst: round2(lines.reduce((sum, line) => sum + Number(line.igst || 0), 0)),
    grandTotal: round2(lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0)),
  };
}
