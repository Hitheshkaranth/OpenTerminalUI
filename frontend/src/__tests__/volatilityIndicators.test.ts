import { describe, expect, it } from "vitest";

import { computeIndicator, getIndicatorDefaults, listIndicators } from "../shared/chart/IndicatorManager";

function flatBars(length: number, value = 100) {
  return Array.from({ length }).map((_, idx) => ({
    time: 1_700_200_000 + idx * 60,
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 1000 + idx * 5,
  }));
}

function trendBars(length: number, start = 100, step = 1) {
  return Array.from({ length }).map((_, idx) => {
    const close = start + idx * step;
    return {
      time: 1_700_300_000 + idx * 60,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + idx * 20,
    };
  });
}

describe("Volatility indicator pack", () => {
  it("exposes required volatility indicators and defaults", () => {
    const ids = new Set(listIndicators().map((x) => x.id));
    ["bb", "keltner", "donchian", "atr", "stddev", "historical-volatility", "hv", "chaikin-volatility"].forEach((id) => {
      expect(ids.has(id)).toBe(true);
      const defaults = getIndicatorDefaults(id);
      expect(typeof defaults.params).toBe("object");
    });
  });

  it("uses expected overlay/pane behavior for volatility pack", () => {
    ["bb", "keltner", "donchian"].forEach((id) => {
      expect(getIndicatorDefaults(id).overlay).toBe(true);
    });
    ["atr", "stddev", "historical-volatility", "hv", "chaikin-volatility"].forEach((id) => {
      expect(getIndicatorDefaults(id).overlay).toBe(false);
    });
  });

  it("keeps channels aligned on flat fixture bars", () => {
    const bars = flatBars(60, 100);
    ["bb", "keltner", "donchian"].forEach((id) => {
      const result = computeIndicator(id, bars as any, { period: 20 });
      const plotSeries = Object.values(result.plots).filter((v): v is Array<{ time: number; value: number }> => Array.isArray(v));
      expect(plotSeries.length).toBeGreaterThanOrEqual(2);
      const latest = plotSeries.map((series) => series[series.length - 1]?.value).filter((v): v is number => typeof v === "number");
      expect(latest.length).toBeGreaterThanOrEqual(2);
      const spread = Math.max(...latest) - Math.min(...latest);
      expect(spread).toBeLessThan(1e-6);
    });
  });

  it("handles invalid params and short-series without throwing", () => {
    const short = trendBars(5);
    expect(() => computeIndicator("bb", short as any, { period: -99, multiplier: -2 })).not.toThrow();
    expect(() => computeIndicator("keltner", short as any, { period: -20, multiplier: -2 })).not.toThrow();
    expect(() => computeIndicator("donchian", short as any, { period: -20 })).not.toThrow();
    expect(() => computeIndicator("atr", short as any, { period: -5 })).not.toThrow();
    expect(() => computeIndicator("stddev", short as any, { period: -8 })).not.toThrow();
    expect(() => computeIndicator("historical-volatility", short as any, { period: -9 })).not.toThrow();
    expect(() => computeIndicator("hv", short as any, { period: -9 })).not.toThrow();
    expect(() => computeIndicator("chaikin-volatility", short as any, { emaPeriod: -4, rocPeriod: -7 })).not.toThrow();

    const chaikin = computeIndicator("chaikin-volatility", short as any, { emaPeriod: -4, rocPeriod: -7 });
    const values = chaikin.plots.chaikinVolatility ?? [];
    expect(Array.isArray(values)).toBe(true);
  });
});
