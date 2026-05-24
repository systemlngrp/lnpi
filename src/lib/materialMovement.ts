import {
  MaterialIn,
  MaterialInPackingSlip,
  MaterialIssueLine,
  MaterialIssueReelLine,
  MaterialReturnLine,
  MaterialReturnReelLine,
} from "../types";

function buildOpenReelCounts(
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const counts = new Map<string, number>();
  issueReelLines.forEach((line) => {
    const key = `${line.packingSlipId}::${line.productionId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  returnReelLines.forEach((line) => {
    const key = `${line.packingSlipId}::${line.productionId}`;
    counts.set(key, (counts.get(key) || 0) - 1);
  });
  return counts;
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
  const openCounts = buildOpenReelCounts(issueReelLines, returnReelLines);
  return packingSlips.filter((slip) => {
    if (slip.materialId !== materialId) return false;
    const issuedOpenCount = Array.from(openCounts.entries())
      .filter(([key, count]) => key.startsWith(`${slip.id}::`) && count > 0)
      .reduce((sum, [, count]) => sum + count, 0);
    return issuedOpenCount === 0;
  });
}

export function getReturnableReelLinesForJob(
  materialId: string,
  productionId: string,
  issueReelLines: MaterialIssueReelLine[],
  returnReelLines: MaterialReturnReelLine[]
) {
  const openCounts = buildOpenReelCounts(issueReelLines, returnReelLines);
  return issueReelLines.filter((line) => {
    if (line.materialId !== materialId) return false;
    if (line.productionId !== productionId) return false;
    const key = `${line.packingSlipId}::${line.productionId}`;
    return (openCounts.get(key) || 0) > 0;
  });
}
