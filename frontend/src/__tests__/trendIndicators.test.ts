import { describe, expect, it } from "vitest";

import {
  computeIndicator,
  getIndicatorDefaults,
  listIndicators,
} from "../shared/chart/IndicatorManager";

function barsFromCloses(closes: number[]) {
  return closes.map((c, idx) => ({
    time: 1_700_000_000 + idx * 60,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1000 + idx * 10,
  }));
}

describe("Trend indicator pack", () => {
  it("exposes required trend indicators in the registry", () => {
    const ids = new Set(listIndicators().map((x) => x.id));
    [
      "sma",
      "ema",
      "wma",
      "dema",
      "tema",
      "kama",
      "hma",
      "vwma",
      "supertrend",
      "ichimoku",
      "parabolic-sar",
      "adx",
      "aroon",
      "linear-regression-channel",
    ].forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it("returns configurable defaults and correct overlay/pane placement rules", () => {
    const overlayOnPrice = ["sma", "ema", "wma", "dema", "tema", "kama", "hma", "vwma", "supertrend", "ichimoku", "parabolic-sar", "linear-regression-channel"];
    const oscillatorPane = ["adx", "aroon", "dmi"];

    overlayOnPrice.forEach((id) => {
      const meta = getIndicatorDefaults(id);
      expect(meta.overlay).toBe(true);
      expect(typeof meta.params).toBe("object");
    });
    oscillatorPane.forEach((id) => {
      const meta = getIndicatorDefaults(id);
      expect(meta.overlay).toBe(false);
      expect(typeof meta.params).toBe("object");
    });
  });

  it("computes deterministic KAMA values on flat price data", () => {
    const data = barsFromCloses(Array.from({ length: 40 }, () => 100));
    const result = computeIndicator("kama", data as any, { period: 10, fastPeriod: 2, slowPeriod: 30 });
    const values = result.plots.kama?.map((p) => p.value) ?? [];
    expect(values.length).toBe(31);
    expect(result.plots.kama?.[0]?.time).toBe(data[9].time);
    values.forEach((v) => expect(v).toBeCloseTo(100, 8));
  });

  it("computes linear regression channel deterministically on perfect linear trend", () => {
    const data = barsFromCloses(Array.from({ length: 140 }, (_, i) => 50 + i));
    const result = computeIndicator("linear-regression-channel", data as any, { period: 100, stdDevMultiplier: 2 });
    const center = result.plots.center ?? [];
    const upper = result.plots.upper ?? [];
    const lower = result.plots.lower ?? [];
    expect(center.length).toBeGreaterThan(0);
    expect(center.length).toBe(upper.length);
    expect(center.length).toBe(lower.length);
    expect(center.length).toBe(41);
    expect(center[0].time).toBe(data[99].time);
    expect(center[0].value).toBeCloseTo(149, 6);

    const lastCenter = center[center.length - 1].value;
    const lastUpper = upper[upper.length - 1].value;
    const lastLower = lower[lower.length - 1].value;
    expect(lastCenter).toBeCloseTo(189, 6);
    expect(lastUpper).toBeCloseTo(lastCenter, 6);
    expect(lastLower).toBeCloseTo(lastCenter, 6);
  });
});
