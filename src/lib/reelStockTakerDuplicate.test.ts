import { describe, it, expect } from "vitest";
import { shouldBlockDuplicateReelScan } from "./reelStockTakerDuplicate";

describe("shouldBlockDuplicateReelScan", () => {
  it("blocks a repeated scan for the same reel within the cooldown window", () => {
    const now = new Date("2026-08-08T10:00:00.000Z");
    const logs = [{ reelNo: "R1001", timestamp: "2026-08-08T09:59:30.000Z" }];
    expect(shouldBlockDuplicateReelScan(logs, "R1001", now, 5 * 60 * 1000)).toBe(true);
  });

  it("allows a new scan after the cooldown window expires", () => {
    const now = new Date("2026-08-08T10:00:00.000Z");
    const logs = [{ reelNo: "R1001", timestamp: "2026-08-08T09:00:00.000Z" }];
    expect(shouldBlockDuplicateReelScan(logs, "R1001", now, 5 * 60 * 1000)).toBe(false);
  });
});
