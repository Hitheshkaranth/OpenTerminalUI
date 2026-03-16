import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { upsertIndicatorRouting } from "../shared/chart/indicatorCatalog";
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
  const addSeriesCalls: Array<{ paneIndex: number | undefined; priceScaleId?: string }> = [];
  const separateScaleApplyCalls: Array<Record<string, unknown>> = [];
  const removeSeries = vi.fn();
  const addSeries = vi.fn((_type, opts, paneIndex?: number) => {
    addSeriesCalls.push({
      paneIndex,
      priceScaleId: (opts as { priceScaleId?: string } | undefined)?.priceScaleId,
    });
    return {
      setData: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: vi.fn(() => ({
        applyOptions: vi.fn((next: Record<string, unknown>) => {
          separateScaleApplyCalls.push(next);
        }),
      })),
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
    separateScaleApplyCalls,
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
  useIndicators(chart, bars as any, configs, { nonOverlayPaneStartIndex: 1, maxNonOverlayPanes: 8, mainPriceScaleId: "left" });
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
      { id: "ov-sma", instanceId: "instance-ov-sma-1", params: {}, visible: true },
      { id: "osc-rsi", instanceId: "instance-osc-rsi-1", params: {}, visible: true },
      { id: "osc-macd", instanceId: "instance-osc-macd-1", params: {}, visible: true },
    ];
    render(<HookProbe chart={chart} bars={bars} configs={configs} />);
    expect(addSeriesCalls).toContainEqual(expect.objectContaining({ paneIndex: 0, priceScaleId: "left" }));
    expect(addSeriesCalls).toContainEqual(expect.objectContaining({ paneIndex: 1, priceScaleId: "right" }));
    expect(addSeriesCalls).toContainEqual(expect.objectContaining({ paneIndex: 2, priceScaleId: "right" }));
  });

  it("respects explicit overlay, existing pane, and separate-scale routing", () => {
    const { chart, addSeriesCalls, separateScaleApplyCalls } = makeChartMock();
    const bars = [
      { time: 1700000000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { time: 1700000060, open: 100.5, high: 102, low: 100, close: 101.2, volume: 1200 },
    ];
    const configs: IndicatorConfig[] = [
      upsertIndicatorRouting({ id: "osc-rsi", instanceId: "instance-osc-rsi-1", params: {}, visible: true }, { paneTarget: "new", paneId: "pane-alpha" }, false),
      upsertIndicatorRouting({ id: "osc-macd", instanceId: "instance-osc-macd-1", params: {}, visible: true }, { paneTarget: "overlay" }, false),
      upsertIndicatorRouting(
        { id: "osc-adx", instanceId: "instance-osc-adx-1", params: {}, visible: true },
        { paneTarget: "existing", paneId: "pane-alpha", scaleBehavior: "separate" },
        false,
      ),
    ];

    render(<HookProbe chart={chart} bars={bars} configs={configs} />);

    expect(addSeriesCalls).toContainEqual(expect.objectContaining({ paneIndex: 0, priceScaleId: "left" }));
    expect(addSeriesCalls).toContainEqual(expect.objectContaining({ paneIndex: 1, priceScaleId: "right" }));
    expect(addSeriesCalls).toContainEqual(
      expect.objectContaining({ paneIndex: 1, priceScaleId: expect.stringContaining("indicator-scale:pane-alpha:instance-osc-adx-1") })
    );
    expect(separateScaleApplyCalls).toContainEqual(expect.objectContaining({ visible: true }));
  });

  it("caps oscillator panes at configured max", () => {
    const { chart, addSeriesCalls } = makeChartMock();
    const bars = [
      { time: 1700000000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { time: 1700000060, open: 100.5, high: 102, low: 100, close: 101.2, volume: 1200 },
    ];
    const configs: IndicatorConfig[] = Array.from({ length: 12 }).map((_, i) => ({
      id: `osc-${i}`,
      instanceId: `instance-osc-${i}`,
      params: {},
      visible: true,
    }));
    render(<HookProbe chart={chart} bars={bars} configs={configs} />);
    const paneIndices = addSeriesCalls
      .map((call) => call.paneIndex)
      .filter((x): x is number => typeof x === "number");
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
      { id: "ov-a", instanceId: "instance-ov-a", params: {}, visible: true },
      { id: "ov-b", instanceId: "instance-ov-b", params: {}, visible: true },
      { id: "osc-a", instanceId: "instance-osc-a", params: {}, visible: true },
      { id: "osc-b", instanceId: "instance-osc-b", params: {}, visible: true },
    ];
    const t0 = performance.now();
    render(<HookProbe chart={chart} bars={bars} configs={configs} />);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(120);
  });
});
