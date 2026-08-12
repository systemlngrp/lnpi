import {
  Material,
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturnLine,
  MaterialReturnReelLine,
} from "../types";

export function round2(value: number) {
  return Number((Number(value) || 0).toFixed(2));
}

export function calculateMaterialIssueAmount(qty: number, rate: number) {
  return round2(round2(qty) * round2(rate));
}

function getMaterialInLineRate(line: MaterialIn["lines"][number]) {
  const invoiceRate = Number(line.invoiceRate || 0);
  if (invoiceRate > 0) return invoiceRate;
  const poRate = Number(line.poRate || 0);
  if (poRate > 0) return poRate;
  const rate = Number(line.rate || 0);
  if (rate > 0) return rate;
  const actualQty = Number(line.actualQty || 0);
  const actualValue = Number(line.actualValue || 0);
  return actualQty > 0 && actualValue > 0 ? actualValue / actualQty : 0;
}

export function resolveMaterialIssueRate(
  materialId: string,
  materials: Pick<Material, "id" | "openingRate">[],
  materialIn: MaterialIn[],
  qty: number,
  options?: { useLatestRateAsOpeningRate?: boolean }
) {
  const material = materials.find((entry) => entry.id === materialId);
  const openingRate = round2(Number(material?.openingRate || 0));
  const latestPurchaseLine = materialIn
    .flatMap((entry) =>
      entry.lines
        .filter((line) => line.itemId === materialId)
        .map((line) => ({
          line,
          time: new Date(entry.timestamp || entry.date || 0).getTime() || 0,
        }))
    )
    .sort((a, b) => b.time - a.time)[0]?.line;
  const lastPurchaseRate = latestPurchaseLine ? round2(getMaterialInLineRate(latestPurchaseLine)) : 0;
  const effectiveOpeningRate = options?.useLatestRateAsOpeningRate && lastPurchaseRate > 0 ? lastPurchaseRate : openingRate;
  const rate = lastPurchaseRate > 0 ? lastPurchaseRate : openingRate;
  const effectiveRate = options?.useLatestRateAsOpeningRate ? effectiveOpeningRate : rate;
  return {
    lastPurchaseRate,
    openingRate: effectiveOpeningRate,
    rate: effectiveRate,
    amount: calculateMaterialIssueAmount(qty, effectiveRate),
  };
}

function buildSlipNetIssuedWeights(
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const weights = new Map<string, number>();
  issueReelLines.forEach((line) => {
    const key = line.packingSlipId;
    weights.set(key, (weights.get(key) || 0) + Number(line.weightKg || 0));
  });
  returnReelLines.forEach((line) => {
    const key = line.packingSlipId;
    weights.set(key, (weights.get(key) || 0) - Number(line.weightKg || 0));
  });
  return weights;
}

function buildJobReturnableWeights(
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const weights = new Map<string, number>();
  issueReelLines.forEach((line) => {
    const key = `${line.packingSlipId}::${line.productionId}`;
    weights.set(key, (weights.get(key) || 0) + Number(line.weightKg || 0));
  });
  returnReelLines.forEach((line) => {
    const key = `${line.packingSlipId}::${line.productionId}`;
    weights.set(key, (weights.get(key) || 0) - Number(line.weightKg || 0));
  });
  return weights;
}

export function getNonReelAvailableQty(
  materialId: string,
  materialIn: MaterialIn[],
  issueLines: MaterialIssueLine[],
  returnLines: MaterialReturnLine[]
) {
  const received = materialIn.reduce(
    (sum, entry) =>
      sum +
      entry.lines
        .filter((line) => line.itemId === materialId)
        .reduce((lineSum, line) => lineSum + Number(line.qty || 0), 0),
    0
  );
  const issued = issueLines
    .filter((line) => line.materialId === materialId)
    .reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const returned = returnLines
    .filter((line) => line.materialId === materialId)
    .reduce((sum, line) => sum + Number(line.qty || 0), 0);

  return Math.max(0, received - issued + returned);
}

export function getAvailableReelPackingSlips(
  materialId: string,
  packingSlips: MaterialInPackingSlip[],
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const netIssuedBySlip = buildSlipNetIssuedWeights(issueReelLines, returnReelLines);
  return packingSlips.flatMap((slip) => {
    if (slip.materialId !== materialId) return [];
    const baseWeight = Number(slip.weightKg || 0);
    if (baseWeight <= 0) return [];
    const availableWeight = Number((baseWeight - (netIssuedBySlip.get(slip.id) || 0)).toFixed(2));
    if (availableWeight <= 0) return [];
    return [{ ...slip, weightKg: availableWeight }];
  });
}

export function getReturnableReelLinesForJob(
  materialId: string,
  productionId: string,
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const returnableWeights = buildJobReturnableWeights(issueReelLines, returnReelLines);
  const latestIssueLineBySlip = new Map<string, MaterialIssueReelLine>();

  issueReelLines.forEach((line) => {
    if (line.materialId !== materialId) return;
    if (line.productionId !== productionId) return;
    latestIssueLineBySlip.set(line.packingSlipId, line);
  });

  return Array.from(latestIssueLineBySlip.values()).flatMap((line) => {
    const key = `${line.packingSlipId}::${line.productionId}`;
    const returnableWeight = Number((returnableWeights.get(key) || 0).toFixed(2));
    if (returnableWeight <= 0) return [];
    return [{ ...line, weightKg: returnableWeight }];
  });
}
