import { describe, expect, it } from "vitest";

import { computeIndicator, getIndicatorDefaults, listIndicators } from "../shared/chart/IndicatorManager";

function bars() {
  return [
    { time: 1_700_400_000, open: 100, high: 102, low: 98, close: 101, volume: 10 },
    { time: 1_700_400_060, open: 101, high: 103, low: 99, close: 102, volume: 20 },
    { time: 1_700_400_120, open: 102, high: 104, low: 100, close: 103, volume: 30 },
  ];
}

describe("VWAP indicators", () => {
  it("exposes session and anchored VWAP with overlay defaults", () => {
    const ids = new Set(listIndicators().map((x) => x.id));
    expect(ids.has("session-vwap")).toBe(true);
    expect(ids.has("anchored-vwap")).toBe(true);
    expect(getIndicatorDefaults("session-vwap").overlay).toBe(true);
    expect(getIndicatorDefaults("anchored-vwap").overlay).toBe(true);
  });

  it("computes deterministic session vwap values", () => {
    const result = computeIndicator("session-vwap", bars() as any, {});
    const line = result.plots.vwap ?? [];
    expect(line.length).toBe(3);
    expect(line[0].value).toBeCloseTo(100.333333, 6);
    expect(line[1].value).toBeCloseTo((100.3333333333 * 10 + 101.3333333333 * 20) / 30, 5);
  });

  it("computes anchored vwap from configured anchor bars", () => {
    const result = computeIndicator("anchored-vwap", bars() as any, { anchorBars: 2 });
    const line = result.plots.anchoredVwap ?? [];
    expect(line.length).toBe(2);
    expect(line[0].time).toBe(1_700_400_060);
    expect(line[0].value).toBeCloseTo(101.333333, 6);
    expect(line[1].value).toBeCloseTo((101.3333333333 * 20 + 102.3333333333 * 30) / 50, 5);
  });

  it("resets session vwap on day boundary", () => {
    const multiDay = [
      { time: 1_700_400_000, open: 100, high: 102, low: 98, close: 101, volume: 10 },
      { time: 1_700_400_060, open: 101, high: 103, low: 99, close: 102, volume: 20 },
      { time: 1_700_486_400, open: 110, high: 112, low: 108, close: 111, volume: 5 },
    ];
    const result = computeIndicator("session-vwap", multiDay as any, {});
    const line = result.plots.vwap ?? [];
    expect(line.length).toBe(3);
    expect(line[2].value).toBeCloseTo((112 + 108 + 111) / 3, 6);
  });
});
