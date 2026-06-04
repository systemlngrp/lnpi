import {
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturnLine,
  MaterialReturnReelLine,
} from "../types";

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
