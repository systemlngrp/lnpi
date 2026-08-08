import { describe, it, expect } from "vitest";
import { shouldBlockDuplicateReelScan } from "./reelStockTakerDuplicate";

describe("shouldBlockDuplicateReelScan", () => {
  it("blocks a repeated scan for the same reel on the same day", () => {
    const now = new Date("2026-08-08T10:00:00.000Z");
    const logs = [{ reelNo: "R1001", timestamp: "2026-08-08T09:00:00.000Z" }];
    expect(shouldBlockDuplicateReelScan(logs, "R1001", now)).toBe(true);
  });

  it("allows a new scan for the same reel on a different day", () => {
    const now = new Date("2026-08-08T10:00:00.000Z");
    const logs = [{ reelNo: "R1001", timestamp: "2026-08-07T23:59:59.000Z" }];
    expect(shouldBlockDuplicateReelScan(logs, "R1001", now)).toBe(false);
  });
});
