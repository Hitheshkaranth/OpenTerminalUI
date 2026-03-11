import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChartEngine } from "../shared/chart/ChartEngine";

const updateByPane = new Map<number, ReturnType<typeof vi.fn>>();
const setDataByPane = new Map<number, ReturnType<typeof vi.fn>>();

if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
}

vi.mock("lightweight-charts", () => {
  const CandlestickSeries = Symbol("CandlestickSeries");
  const LineSeries = Symbol("LineSeries");
  const AreaSeries = Symbol("AreaSeries");
  const BaselineSeries = Symbol("BaselineSeries");
  const HistogramSeries = Symbol("HistogramSeries");
  const createChart = () => ({
    addSeries: (_seriesType: unknown, _opts: unknown, pane = 0) => {
      const update = vi.fn();
      const setData = vi.fn();
      updateByPane.set(pane, update);
      setDataByPane.set(pane, setData);
      return {
        setData,
        update,
        applyOptions: vi.fn(),
      };
    },
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    panes: vi.fn(() => [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }]),
    timeScale: vi.fn(() => ({
      setVisibleLogicalRange: vi.fn(),
      setVisibleRange: vi.fn(),
      fitContent: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
    })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  });
  return {
    ColorType: { Solid: "solid" },
    AreaSeries,
    BaselineSeries,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    createChart,
  };
});

vi.mock("../shared/chart/useIndicators", () => ({
  useIndicators: vi.fn(),
}));

vi.mock("../shared/chart/useRealtimeChart", () => ({
  useRealtimeChart: (_market: string, _symbol: string, _timeframe: string, historicalData: any[]) => ({
    bars: historicalData,
    liveTick: null,
    realtimeMeta: { status: "disconnected", lastTickTs: null, currentBar: null },
  }),
}));

vi.mock("../shared/chart/ChartSyncContext", () => ({
  useChartSync: () => ({
    event: null,
    publish: vi.fn(),
  }),
}));

describe("ChartEngine incremental update guard", () => {
  beforeEach(() => {
    updateByPane.clear();
    setDataByPane.clear();
  });

  it("uses setData instead of update when the last bar time regresses at the same length", async () => {
    const initialBars = [
      { time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { time: 200, open: 10.5, high: 12, low: 10, close: 11.5, volume: 110 },
      { time: 300, open: 11.5, high: 13, low: 11, close: 12.5, volume: 120 },
    ];
    const regressedTailBars = [
      { time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { time: 200, open: 10.5, high: 12, low: 10, close: 11.5, volume: 110 },
      { time: 250, open: 11.5, high: 12.7, low: 11, close: 12.1, volume: 115 },
    ];

    const { rerender } = render(
      <div style={{ width: 800, height: 400 }}>
        <ChartEngine
          symbol="AAPL"
          timeframe="1m"
          historicalData={initialBars as any}
          activeIndicators={[]}
          chartType="candle"
          showVolume={true}
          enableRealtime={false}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(1)?.mock.calls.length).toBeGreaterThan(0);
    });
    const initialSetDataCalls = setDataByPane.get(1)?.mock.calls.length ?? 0;
    const initialUpdateCalls = updateByPane.get(1)?.mock.calls.length ?? 0;

    rerender(
      <div style={{ width: 800, height: 400 }}>
        <ChartEngine
          symbol="AAPL"
          timeframe="1m"
          historicalData={regressedTailBars as any}
          activeIndicators={[]}
          chartType="candle"
          showVolume={true}
          enableRealtime={false}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(1)?.mock.calls.length).toBe(initialSetDataCalls + 1);
    });
    expect(updateByPane.get(1)?.mock.calls.length ?? 0).toBe(initialUpdateCalls);
  });
});
