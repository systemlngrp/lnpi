import type { GateEntry, GatePass, GatePassLine, MaterialIn, MaterialLine } from "../types";

export type DerivedGatePassState = "Open" | "Partially Returned" | "Closed" | "Cleared Off";

export type GatePassLineWithReturns = GatePassLine & {
  returnedQty: number;
  pendingQty: number;
};

function round2(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

export function isReturnableGatePass(gatePass: GatePass) {
  return (gatePass.gatePassType || "Non-Returnable") === "Returnable";
}

export function getReturnableReceiptLines(materialIn: MaterialIn[], gatePassId: string, excludeMaterialInId?: string) {
  return materialIn
    .filter((entry) => entry.id !== excludeMaterialInId)
    .filter((entry) => entry.mrrType === "Service Return" && entry.sourceGatePassId === gatePassId)
    .flatMap((entry) => entry.lines || []);
}

export function getReturnedQtyForGatePassLine(
  materialIn: MaterialIn[],
  gatePassId: string,
  gatePassLineId: string,
  excludeMaterialInId?: string
) {
  return round2(
    getReturnableReceiptLines(materialIn, gatePassId, excludeMaterialInId)
      .filter((line) => line.sourceGatePassLineId === gatePassLineId)
      .reduce((sum, line) => sum + Number(line.actualQty ?? line.qty ?? 0), 0)
  );
}

export function getGatePassLinesWithReturns(
  gatePass: GatePass,
  materialIn: MaterialIn[],
  excludeMaterialInId?: string
): GatePassLineWithReturns[] {
  return (gatePass.lines || []).map((line) => {
    const returnedQty = isReturnableGatePass(gatePass)
      ? getReturnedQtyForGatePassLine(materialIn, gatePass.id, line.id, excludeMaterialInId)
      : 0;
    const pendingQty = round2(Number(line.qty || 0) - returnedQty);
    return {
      ...line,
      returnedQty,
      pendingQty: pendingQty > 0 ? pendingQty : 0,
    };
  });
}

export function deriveGatePassState(gatePass: GatePass, materialIn: MaterialIn[]): DerivedGatePassState {
  if (!isReturnableGatePass(gatePass)) return "Closed";
  if (gatePass.clearOffReason && gatePass.clearedOffAt) return "Cleared Off";
  const lines = getGatePassLinesWithReturns(gatePass, materialIn);
  const totalQty = round2(lines.reduce((sum, line) => sum + Number(line.qty || 0), 0));
  const returnedQty = round2(lines.reduce((sum, line) => sum + Number(line.returnedQty || 0), 0));
  if (returnedQty <= 0) return "Open";
  if (returnedQty >= totalQty) return "Closed";
  return "Partially Returned";
}

export function getPendingQtyForGatePass(gatePass: GatePass, materialIn: MaterialIn[]) {
  return round2(getGatePassLinesWithReturns(gatePass, materialIn).reduce((sum, line) => sum + Number(line.pendingQty || 0), 0));
}

export function hasSavedReturnableReceiptGateEntry(gatePass: GatePass, gateEntries: GateEntry[]) {
  const gatePassId = String(gatePass.id || "").trim();
  if (!gatePassId) return false;

  return gateEntries.some((entry) => {
    const purpose = String(entry.purpose || "").trim();
    const sourceGatePassId = String(entry.sourceGatePassId || "").trim();
    return purpose === "Returnable Receipt" && sourceGatePassId === gatePassId;
  });
}
export function getGatePassPrimaryPartyName(gatePass: GatePass) {
  return gatePass.companyName || gatePass.recipientName || "-";
}

export function getGatePassLineLabel(line: GatePassLine | MaterialLine) {
  return line.itemDescription || line.itemName || line.sourceGatePassItemDescription || "Unknown";
}

