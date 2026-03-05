import { describe, expect, it } from "vitest";

import {
  sanitizeAlternativeChartParams,
  transformKagiBars,
  transformLineBreakBars,
  transformPointFigureBars,
  transformRenkoBars,
} from "../shared/chart/alternativeChartTransforms";
import type { Bar } from "oakscriptjs";

function makeBars(closes: number[]): Bar[] {
  return closes.map((close, idx) => ({
    time: 1700000000 + idx * 60,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000 + idx,
  }));
}

describe("alternative chart transforms", () => {
  it("sanitizes parameters into safe ranges", () => {
    const params = sanitizeAlternativeChartParams({
      renkoBrickSize: -10,
      lineBreakCount: 999,
      pointFigureReversalBoxes: 0,
    });
    expect(params.renkoBrickSize).toBeGreaterThan(0);
    expect(params.lineBreakCount).toBe(10);
    expect(params.pointFigureReversalBoxes).toBe(1);
  });

  it("builds deterministic renko bricks", () => {
    const out = transformRenkoBars(makeBars([100, 101.2, 102.4, 101.8]), 1);
    expect(out.length).toBe(2);
    expect(out[0].open).toBe(100);
    expect(out[1].close).toBe(102);
  });

  it("builds deterministic kagi segments", () => {
    const out = transformKagiBars(makeBars([100, 101, 102, 100.5, 99]), 1);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].open).toBe(100);
  });

  it("builds deterministic point and figure columns", () => {
    const out = transformPointFigureBars(makeBars([100, 101, 102, 99, 96]), 1, 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((b) => Number.isFinite(Number(b.close)))).toBe(true);
  });

  it("builds deterministic line break bars", () => {
    const out = transformLineBreakBars(makeBars([100, 101, 102, 101, 103, 99]), 3);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].time).toBeLessThanOrEqual(out[out.length - 1].time);
  });
});
