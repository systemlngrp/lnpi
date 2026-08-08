export type ReelScanLike = {
  reelNo?: string;
  timestamp?: string;
};

export function shouldBlockDuplicateReelScan(
  existingLogs: ReelScanLike[],
  reelNo: string,
  now: Date = new Date(),
  cooldownMs = 5 * 60 * 1000,
): boolean {
  const normalizedReelNo = String(reelNo || "").trim().toLowerCase();
  if (!normalizedReelNo) return false;

  const nowTs = now.getTime();
  return existingLogs.some((entry) => {
    const entryReelNo = String(entry?.reelNo || "").trim().toLowerCase();
    if (entryReelNo !== normalizedReelNo) return false;

    const entryTimestamp = entry?.timestamp ? new Date(entry.timestamp).getTime() : Number.NaN;
    if (!Number.isFinite(entryTimestamp)) return false;

    return nowTs - entryTimestamp <= cooldownMs;
  });
}
