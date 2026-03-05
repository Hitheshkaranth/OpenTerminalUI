import { beforeEach, describe, expect, it } from "vitest";

import {
  computeIndicator,
  listCustomJsIndicators,
  listIndicators,
  removeCustomJsIndicator,
  upsertCustomJsIndicator,
} from "../shared/chart/IndicatorManager";

const BARS = [
  { time: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { time: 1700000060, open: 100, high: 102, low: 99, close: 101, volume: 12 },
  { time: 1700000120, open: 101, high: 103, low: 100, close: 102, volume: 15 },
];

describe("custom JS indicators", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and computes deterministic output", () => {
    const saved = upsertCustomJsIndicator({
      id: "my custom",
      name: "My Custom",
      category: "Custom JS",
      overlay: true,
      defaultInputs: { multiplier: 2 },
      script:
        "function calculate(bars, params) { return { plots: { line: bars.map((bar) => ({ time: bar.time, value: Number(bar.close) * Number(params.multiplier || 1) })) } }; }",
    });

    expect(saved.id).toBe("custom-js:my-custom");
    expect(listCustomJsIndicators().map((row) => row.id)).toContain("custom-js:my-custom");
    expect(listIndicators().some((row) => row.id === "custom-js:my-custom")).toBe(true);

    const out = computeIndicator("custom-js:my-custom", BARS as any, { multiplier: 3 });
    expect(out.plots.line.map((p) => p.value)).toEqual([300, 303, 306]);
  });

  it("throws parser/runtime errors for invalid scripts", () => {
    expect(() =>
      upsertCustomJsIndicator({
        id: "bad-parse",
        name: "Bad Parse",
        category: "Custom JS",
        overlay: false,
        defaultInputs: {},
        script: "function calculate(bars, params) {",
      }),
    ).toThrow(/parse error/i);

    upsertCustomJsIndicator({
      id: "bad-runtime",
      name: "Bad Runtime",
      category: "Custom JS",
      overlay: false,
      defaultInputs: {},
      script: "function calculate() { throw new Error('boom'); }",
    });

    expect(() => computeIndicator("custom-js:bad-runtime", BARS as any, {})).toThrow(/runtime error/i);
  });

  it("removes persisted custom indicators", () => {
    upsertCustomJsIndicator({
      id: "to-remove",
      name: "To Remove",
      category: "Custom JS",
      overlay: true,
      defaultInputs: {},
      script: "function calculate(bars) { return { plots: { line: bars.map((bar) => ({ time: bar.time, value: Number(bar.close) })) } }; }",
    });
    expect(listCustomJsIndicators().length).toBe(1);
    removeCustomJsIndicator("custom-js:to-remove");
    expect(listCustomJsIndicators().length).toBe(0);
  });
});
