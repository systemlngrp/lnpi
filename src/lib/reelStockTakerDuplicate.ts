export type ReelScanLike = {
  reelNo?: string;
  sessionId?: string;
};

export function shouldBlockDuplicateReelScan(
  existingLogs: ReelScanLike[],
  reelNo: string,
  sessionId?: string,
): boolean {
  const normalizedReelNo = String(reelNo || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedReelNo || !normalizedSessionId) return false;

  return existingLogs.some((entry) => {
    const entryReelNo = String(entry?.reelNo || "").trim().toLowerCase();
    const entrySessionId = String(entry?.sessionId || "").trim();
    return entryReelNo === normalizedReelNo && entrySessionId === normalizedSessionId;
  });
}
