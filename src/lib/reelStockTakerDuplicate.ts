export type ReelScanLike = {
  reelNo?: string;
  timestamp?: string;
};

export function shouldBlockDuplicateReelScan(
  existingLogs: ReelScanLike[],
  reelNo: string,
  now: Date = new Date(),
): boolean {
  const normalizedReelNo = String(reelNo || "").trim().toLowerCase();
  if (!normalizedReelNo) return false;

  const nowDate = new Date(now);
  nowDate.setHours(0, 0, 0, 0);

  return existingLogs.some((entry) => {
    const entryReelNo = String(entry?.reelNo || "").trim().toLowerCase();
    if (entryReelNo !== normalizedReelNo) return false;

    const entryTimestamp = entry?.timestamp ? new Date(entry.timestamp) : null;
    if (!entryTimestamp || Number.isNaN(entryTimestamp.getTime())) return false;

    const entryDate = new Date(entryTimestamp);
    entryDate.setHours(0, 0, 0, 0);

    return entryDate.getTime() === nowDate.getTime();
  });
}
