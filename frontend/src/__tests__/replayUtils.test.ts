import { describe, expect, it } from "vitest";

import {
  clampReplayIndex,
  findReplayIndexForDate,
  findReplaySessionIndex,
  nextReplayIndex,
  previousReplayIndex,
  replayDateKey,
  replaySlice,
  replaySpeedToMs,
  shiftReplayIndex,
} from "../shared/chart/replay";

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

  it("supports stepping backward and signed replay shifts", () => {
    expect(previousReplayIndex(2, 5, 1)).toBe(1);
    expect(previousReplayIndex(0, 5, 2)).toBe(0);
    expect(shiftReplayIndex(2, 5, -2)).toBe(0);
    expect(shiftReplayIndex(2, 5, 2)).toBe(4);
  });

  it("returns truncated slices while replay is enabled", () => {
    const source = [1, 2, 3, 4, 5];
    expect(replaySlice(source, true, 2)).toEqual([1, 2, 3]);
    expect(replaySlice(source, false, 1)).toEqual(source);
  });

  it("finds go-to-date targets while respecting extended-hours visibility", () => {
    const rows = [
      { time: Date.UTC(2026, 2, 2, 13, 0, 0) / 1000, session: "pre", isExtended: true },
      { time: Date.UTC(2026, 2, 2, 15, 30, 0) / 1000, session: "rth", isExtended: false },
      { time: Date.UTC(2026, 2, 2, 20, 30, 0) / 1000, session: "post", isExtended: true },
      { time: Date.UTC(2026, 2, 3, 15, 30, 0) / 1000, session: "rth", isExtended: false },
    ];

    expect(findReplayIndexForDate(rows, "2026-03-02")).toBe(1);
    expect(
      findReplayIndexForDate(rows, "2026-03-02", {
        extendedHours: { enabled: true, showPreMarket: true, showAfterHours: true },
      }),
    ).toBe(2);
    expect(findReplayIndexForDate(rows, "2026-03-04")).toBe(3);
  });

  it("jumps between visible trading sessions deterministically", () => {
    const rows = [
      { time: Date.UTC(2026, 2, 1, 15, 30, 0) / 1000, session: "rth", isExtended: false },
      { time: Date.UTC(2026, 2, 2, 13, 0, 0) / 1000, session: "pre", isExtended: true },
      { time: Date.UTC(2026, 2, 2, 15, 30, 0) / 1000, session: "rth", isExtended: false },
      { time: Date.UTC(2026, 2, 3, 15, 30, 0) / 1000, session: "rth", isExtended: false },
    ];

    expect(findReplaySessionIndex(rows, 0, 1)).toBe(2);
    expect(findReplaySessionIndex(rows, 3, -1)).toBe(2);
    expect(
      findReplaySessionIndex(rows, 0, 1, {
        extendedHours: { enabled: true, showPreMarket: true, showAfterHours: true },
      }),
    ).toBe(1);
  });

  it("keys replay dates using UTC calendar boundaries instead of local-time dates", () => {
    const preBoundary = Date.UTC(2026, 2, 1, 23, 30, 0) / 1000;
    const utcMidnightRow = Date.UTC(2026, 2, 2, 0, 30, 0) / 1000;
    const sameUtcSessionLater = Date.UTC(2026, 2, 2, 14, 30, 0) / 1000;
    const nextUtcSession = Date.UTC(2026, 2, 3, 14, 30, 0) / 1000;
    const rows = [
      { time: preBoundary, session: "rth", isExtended: false },
      { time: utcMidnightRow, session: "rth", isExtended: false },
      { time: sameUtcSessionLater, session: "rth", isExtended: false },
      { time: nextUtcSession, session: "rth", isExtended: false },
    ];

    expect(replayDateKey(utcMidnightRow)).toBe("2026-03-02");
    expect(findReplayIndexForDate(rows, "2026-03-02")).toBe(2);
    expect(findReplaySessionIndex(rows, 0, 1)).toBe(1);
  });
});
