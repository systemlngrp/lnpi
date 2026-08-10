import { describe, it, expect } from "vitest";
import { shouldBlockDuplicateReelScan } from "./reelStockTakerDuplicate";

describe("shouldBlockDuplicateReelScan", () => {
  it("blocks a repeated scan for the same reel in the same session", () => {
    const logs = [{ reelNo: "R1001", sessionId: "session-1" }];
    expect(shouldBlockDuplicateReelScan(logs, "R1001", "session-1")).toBe(true);
  });

  it("allows a new scan for the same reel in a different session", () => {
    const logs = [{ reelNo: "R1001", sessionId: "session-1" }];
    expect(shouldBlockDuplicateReelScan(logs, "R1001", "session-2")).toBe(false);
  });
});
