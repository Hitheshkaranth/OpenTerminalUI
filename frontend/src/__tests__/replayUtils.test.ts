import { describe, expect, it } from "vitest";

import { clampReplayIndex, nextReplayIndex, replaySlice, replaySpeedToMs } from "../shared/chart/replay";

describe("replay utils", () => {
  it("maps speed labels to deterministic frame intervals", () => {
    expect(replaySpeedToMs("0.5x")).toBeGreaterThan(replaySpeedToMs("1x"));
    expect(replaySpeedToMs("4x")).toBeLessThan(replaySpeedToMs("2x"));
  });

  it("clamps replay index within data bounds", () => {
    expect(clampReplayIndex(-10, 5)).toBe(0);
    expect(clampReplayIndex(10, 5)).toBe(4);
  });

  it("advances replay index without exceeding bounds", () => {
    expect(nextReplayIndex(2, 5, 1)).toBe(3);
    expect(nextReplayIndex(4, 5, 3)).toBe(4);
  });

  it("returns truncated slices while replay is enabled", () => {
    const source = [1, 2, 3, 4, 5];
    expect(replaySlice(source, true, 2)).toEqual([1, 2, 3]);
    expect(replaySlice(source, false, 1)).toEqual(source);
  });
});
