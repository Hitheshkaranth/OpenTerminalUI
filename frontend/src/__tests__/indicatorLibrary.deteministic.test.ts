import { describe, expect, it } from "vitest";

import {
  computeIndicator,
  getIndicatorDefaults,
  listIndicators,
  removeCustomJsIndicator,
  upsertCustomJsIndicator,
} from "../shared/chart/IndicatorManager";
import type { Bar } from "oakscriptjs";

function fixtureBars(count = 120): Bar[] {
  const start = 1_700_000_000;
  return Array.from({ length: count }, (_, idx) => {
    const base = 100 + idx * 0.35 + Math.sin(idx / 7) * 1.5;
    return {
      time: start + idx * 60,
      open: base - 0.4,
      high: base + 0.8,
      low: base - 0.9,
      close: base,
      volume: 1_000 + idx * 11,
    } as Bar;
  });
}

describe("indicator library deterministic behavior", () => {
  it("exposes a large indicator catalog and required custom entries", () => {
    const indicators = listIndicators();
    expect(indicators.length).toBeGreaterThanOrEqual(80);
    const ids = new Set(indicators.map((row) => row.id));
    expect(ids.has("kama")).toBe(true);
    expect(ids.has("linear-regression-channel")).toBe(true);
    expect(ids.has("session-vwap")).toBe(true);
    expect(ids.has("anchored-vwap")).toBe(true);
  });

  it("produces stable output for custom indicators on same input", () => {
    const bars = fixtureBars();
    const first = computeIndicator("kama", bars, { period: 10, fastPeriod: 2, slowPeriod: 30 });
    const second = computeIndicator("kama", bars, { period: 10, fastPeriod: 2, slowPeriod: 30 });

    expect(second).toEqual(first);
    expect((first.plots.kama || []).length).toBeGreaterThan(10);
  });

  it("persists custom js indicators and resolves defaults", () => {
    const spec = upsertCustomJsIndicator({
      id: "DeterministicLine",
      name: "DeterministicLine",
      category: "Custom JS",
      overlay: true,
      defaultInputs: { scale: 1 },
      script:
        "function calculate(bars, params) { return { plots: { line: bars.map((bar) => ({ time: Number(bar.time), value: Number(bar.close) * Number(params.scale || 1) })) } }; }",
    });

    const defaults = getIndicatorDefaults(spec.id);
    expect(defaults.overlay).toBe(true);
    expect(defaults.params).toEqual({ scale: 1 });

    const computed = computeIndicator(spec.id, fixtureBars(20), { scale: 2 });
    expect(Array.isArray(computed.plots.line)).toBe(true);
    expect((computed.plots.line || []).length).toBe(20);

    removeCustomJsIndicator(spec.id);
  });
});
