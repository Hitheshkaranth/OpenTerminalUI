import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useIndicators } from "../shared/chart/useIndicators";
import type { IndicatorConfig } from "../shared/chart/types";

vi.mock("../shared/chart/IndicatorManager", () => ({
  computeIndicator: vi.fn((id: string) => {
    const overlay = id.startsWith("ov-");
    return {
      metadata: { overlay },
      plots: {
        line: [
          { time: 1700000000, value: 100 },
          { time: 1700000060, value: 101 },
        ],
      },
    };
  }),
}));

vi.mock("lightweight-charts", () => ({
  LineSeries: Symbol("LineSeries"),
}));

function makeChartMock() {
  const addSeriesCalls: Array<number | undefined> = [];
  const removeSeries = vi.fn();
  const addSeries = vi.fn((_type, _opts, paneIndex?: number) => {
    addSeriesCalls.push(paneIndex);
    return {
      setData: vi.fn(),
    };
  });
  const panes = vi.fn(() =>
    Array.from({ length: 12 }, () => ({
      setStretchFactor: vi.fn(),
    })),
  );
  return {
    chart: { addSeries, removeSeries, panes } as any,
    addSeriesCalls,
  };
}

function HookProbe({
  chart,
  bars,
  configs,
}: {
  chart: any;
  bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  configs: IndicatorConfig[];
}) {
  useIndicators(chart, bars as any, configs, { nonOverlayPaneStartIndex: 1, maxNonOverlayPanes: 8 });
  return null;
}

describe("useIndicators pane placement", () => {
  it("places overlay on pane 0 and oscillator on dedicated panes", () => {
    const { chart, addSeriesCalls } = makeChartMock();
    const bars = [
      { time: 1700000000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { time: 1700000060, open: 100.5, high: 102, low: 100, close: 101.2, volume: 1200 },
    ];
    const configs: IndicatorConfig[] = [
      { id: "ov-sma", params: {}, visible: true },
      { id: "osc-rsi", params: {}, visible: true },
      { id: "osc-macd", params: {}, visible: true },
    ];
    render(<HookProbe chart={chart} bars={bars} configs={configs} />);
    expect(addSeriesCalls).toContain(0);
    expect(addSeriesCalls).toContain(1);
    expect(addSeriesCalls).toContain(2);
  });

  it("caps oscillator panes at configured max", () => {
    const { chart, addSeriesCalls } = makeChartMock();
    const bars = [
      { time: 1700000000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { time: 1700000060, open: 100.5, high: 102, low: 100, close: 101.2, volume: 1200 },
    ];
    const configs: IndicatorConfig[] = Array.from({ length: 12 }).map((_, i) => ({
      id: `osc-${i}`,
      params: {},
      visible: true,
    }));
    render(<HookProbe chart={chart} bars={bars} configs={configs} />);
    const paneIndices = addSeriesCalls.filter((x): x is number => typeof x === "number");
    expect(Math.max(...paneIndices)).toBeLessThanOrEqual(8);
  });

  it("processes 10k bars with 4 indicators within perf budget", () => {
    const { chart } = makeChartMock();
    const bars = Array.from({ length: 10_000 }).map((_, i) => ({
      time: 1_700_000_000 + i * 60,
      open: 100 + i * 0.001,
      high: 101 + i * 0.001,
      low: 99 + i * 0.001,
      close: 100.5 + i * 0.001,
      volume: 1000 + i,
    }));
    const configs: IndicatorConfig[] = [
      { id: "ov-a", params: {}, visible: true },
      { id: "ov-b", params: {}, visible: true },
      { id: "osc-a", params: {}, visible: true },
      { id: "osc-b", params: {}, visible: true },
    ];
    const t0 = performance.now();
    render(<HookProbe chart={chart} bars={bars} configs={configs} />);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(120);
  });
});
