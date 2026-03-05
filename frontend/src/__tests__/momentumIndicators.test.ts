import { describe, expect, it } from "vitest";

import { computeIndicator, getIndicatorDefaults, listIndicators } from "../shared/chart/IndicatorManager";

function barsFromCloses(closes: number[]) {
  return closes.map((c, idx) => ({
    time: 1_700_100_000 + idx * 60,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 500 + idx * 25,
  }));
}

describe("Momentum indicator pack", () => {
  it("exposes required momentum indicators in the registry", () => {
    const ids = new Set(listIndicators().map((x) => x.id));
    ["rsi", "stoch-rsi", "macd", "cci", "williams-r", "roc", "momentum", "tsi", "ultimate-oscillator", "kdj"].forEach((id) => {
      expect(ids.has(id)).toBe(true);
    });
  });

  it("assigns all momentum pack indicators to oscillator pane defaults", () => {
    ["rsi", "stoch-rsi", "macd", "cci", "williams-r", "roc", "momentum", "tsi", "ultimate-oscillator", "kdj"].forEach((id) => {
      const meta = getIndicatorDefaults(id);
      expect(meta.overlay).toBe(false);
      expect(typeof meta.params).toBe("object");
    });
  });

  it("computes deterministic KDJ values for flat bars", () => {
    const data = barsFromCloses(Array.from({ length: 20 }, () => 100));
    const result = computeIndicator("kdj", data as any, { period: 9, kPeriod: 3, dPeriod: 3 });
    const k = result.plots.k ?? [];
    const d = result.plots.d ?? [];
    const j = result.plots.j ?? [];
    expect(k.length).toBe(20);
    expect(d.length).toBe(20);
    expect(j.length).toBe(20);
    k.forEach((p) => expect(p.value).toBeCloseTo(50, 8));
    d.forEach((p) => expect(p.value).toBeCloseTo(50, 8));
    j.forEach((p) => expect(p.value).toBeCloseTo(50, 8));
  });

  it("handles sparse bars for KDJ and ultimate oscillator alias without throwing", () => {
    const sparse = barsFromCloses([100, 101, 99]);
    const kdj = computeIndicator("kdj", sparse as any, { period: 14, kPeriod: 3, dPeriod: 3 });
    const ultimate = computeIndicator("ultimate-oscillator", sparse as any, { period1: 7, period2: 14, period3: 28 });
    const k = kdj.plots.k ?? [];
    expect(k.length).toBe(sparse.length);
    const ultimateLine = Object.values(ultimate.plots)[0] ?? [];
    expect(Array.isArray(ultimateLine)).toBe(true);
  });
});
