import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { buildComparisonPoints } from "../shared/chart/comparison";
import { buildContextOverlayMarkers } from "../shared/chart/contextOverlays";
import {
  TRADING_SESSION_SHADE_PALETTE,
  buildCorePriceSeriesPayload,
  type RendererBarInput,
} from "../shared/chart/rendererCore";
import type { ChartPoint, CorporateEvent } from "../types";

const EXTENDED_HOURS = {
  enabled: true,
  showPreMarket: true,
  showAfterHours: true,
  visualMode: "merged",
  colorScheme: "dimmed",
} as const;

const BUDGETS_MS: Record<2 | 4 | 8, number> = {
  2: 8,
  4: 12,
  8: 16,
};

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function makeBars(count: number): RendererBarInput[] {
  const out: RendererBarInput[] = [];
  const base = Math.floor(Date.UTC(2026, 0, 1, 12, 0, 0) / 1000);
  for (let i = 0; i < count; i += 1) {
    const sessionSlot = i % 32;
    const session = sessionSlot < 2 ? "pre" : sessionSlot > 28 ? "post" : "rth";
    const close = 100 + i * 0.03 + Math.sin(i / 12) * 0.8;
    out.push({
      time: base + i * 900,
      open: close - 0.35,
      high: close + 0.7,
      low: close - 0.9,
      close,
      volume: 10_000 + i * 13,
      session,
      isExtended: session !== "rth",
    });
  }
  return out;
}

function makeChartPoints(bars: RendererBarInput[], factor: number): ChartPoint[] {
  return bars.map((bar) => ({
    t: Number(bar.time),
    o: Number(bar.open) * factor,
    h: Number(bar.high) * factor,
    l: Number(bar.low) * factor,
    c: Number(bar.close) * factor,
    v: Number(bar.volume),
    s: bar.session,
    ext: bar.isExtended,
  }));
}

function makeEvents(count: number, bars: RendererBarInput[]): CorporateEvent[] {
  const types: CorporateEvent["event_type"][] = ["earnings", "dividend", "board_meeting", "split"];
  return Array.from({ length: count }, (_, idx) => {
    const bar = bars[Math.min(bars.length - 1, Math.floor((idx / count) * bars.length))] ?? bars[0];
    const date = new Date(Number(bar.time) * 1000).toISOString().slice(0, 10);
    return {
      symbol: "AAPL",
      event_type: types[idx % types.length],
      title: `Event ${idx + 1}`,
      description: `Event ${idx + 1}`,
      event_date: date,
      ex_date: idx % 2 === 0 ? date : undefined,
      source: "fixture",
      impact: idx % 4 === 0 ? "positive" : idx % 4 === 1 ? "neutral" : "warning",
    };
  });
}

function runScenario(chartCount: 2 | 4 | 8) {
  const bars = makeBars(1_500);
  const compareA = makeChartPoints(bars, 1.01);
  const compareB = makeChartPoints(bars, 0.99);
  const events = makeEvents(48, bars);
  const barContext = bars.map((bar) => ({ time: Number(bar.time), session: bar.session }));
  const samples: number[] = [];
  let checksum = 0;

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const start = performance.now();
    for (let chartIdx = 0; chartIdx < chartCount; chartIdx += 1) {
      const payload = buildCorePriceSeriesPayload(bars, {
        extendedHours: EXTENDED_HOURS as any,
        showSessionShading: true,
        includeSessionAreas: true,
        shadePalette: TRADING_SESSION_SHADE_PALETTE,
      });
      const compareNormalized = buildComparisonPoints(compareA, "normalized");
      const comparePrice = buildComparisonPoints(compareB, "price");
      const markers = buildContextOverlayMarkers(events, barContext);
      checksum +=
        payload.candles.length +
        payload.preSessionArea.length +
        payload.postSessionArea.length +
        compareNormalized.length +
        comparePrice.length +
        markers.length;
    }
    if (iteration >= 4) {
      samples.push(performance.now() - start);
    }
  }

  const result = {
    chartCount,
    samples,
    medianMs: Number(percentile(samples, 50).toFixed(2)),
    p95Ms: Number(percentile(samples, 95).toFixed(2)),
    checksum,
  };
  expect(result.checksum).toBeGreaterThan(0);
  return result;
}

describe("Renderer core performance budgets", () => {
  it.each([2, 4, 8] as const)(
    "stays within the %ims median budget for %i charts with rich overlays",
    (chartCount) => {
      const result = runScenario(chartCount);
      console.info(
        JSON.stringify({
          suite: "renderer-core-performance",
          chartCount,
          medianMs: result.medianMs,
          p95Ms: result.p95Ms,
        }),
      );
      expect(result.medianMs).toBeLessThanOrEqual(BUDGETS_MS[chartCount]);
    },
  );
});
