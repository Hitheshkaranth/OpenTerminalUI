import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingChart } from "../components/chart/TradingChart";

const updateByPane = new Map<number, ReturnType<typeof vi.fn>>();
const setDataByPane = new Map<number, ReturnType<typeof vi.fn>>();
let storeTick: any = null;

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
        coordinateToPrice: vi.fn(() => 100),
        createPriceLine: vi.fn(() => ({ remove: vi.fn() })),
        removePriceLine: vi.fn(),
      };
    },
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    panes: vi.fn(() => [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }]),
    timeScale: vi.fn(() => ({
      setVisibleLogicalRange: vi.fn(),
      fitContent: vi.fn(),
      timeToCoordinate: vi.fn(() => 12),
      subscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    applyOptions: vi.fn(),
    removeSeries: vi.fn(),
    remove: vi.fn(),
  });
  return {
    ColorType: { Solid: "solid" },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
    CandlestickSeries,
    LineSeries,
    AreaSeries,
    HistogramSeries,
    createChart,
  };
});

vi.mock("../api/client", () => ({
  createChartDrawing: vi.fn(async () => ({})),
  deleteChartDrawing: vi.fn(async () => ({})),
  listChartDrawings: vi.fn(async () => []),
}));

vi.mock("../shared/chart/useIndicators", () => ({
  useIndicators: vi.fn(),
}));

vi.mock("../contexts/CrosshairSyncContext", () => ({
  useCrosshairSync: () => ({
    pos: { time: null, sourceSlotId: null, groupId: null },
    broadcast: vi.fn(),
    syncEnabled: true,
  }),
}));

vi.mock("../realtime/useQuotesStream", () => ({
  useQuotesStore: vi.fn((selector: any) =>
    selector({
      ticksByToken: storeTick
        ? {
            "NSE:AAPL": storeTick,
            "NASDAQ:AAPL": storeTick,
          }
        : {},
    }),
  ),
  useQuotesStream: (_market: string, onTick: (tick: any) => void) => ({
    subscribe: vi.fn(() => {
      onTick({
        symbol: "AAPL",
        ltp: 101.25,
        volume: 12,
        ts: "2026-03-03T10:00:30.000Z",
      });
    }),
  }),
}));

describe("TradingChart realtime updates", () => {
  beforeEach(() => {
    storeTick = null;
    updateByPane.clear();
    setDataByPane.clear();
  });

  it("applies realtime candle and volume updates when internal stream is enabled", async () => {
    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1m"
          mode="candles"
          crosshairSyncGroupId="launchpad-linked"
          data={[
            { t: 1_772_496_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          ]}
        />
      </div>,
    );

    await waitFor(() => {
      expect(updateByPane.get(1)).toBeDefined();
      expect(updateByPane.get(1)?.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it("does not subscribe internal realtime stream for workstation sync group", async () => {
    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1m"
          mode="candles"
          crosshairSyncGroupId="chart-workstation"
          data={[
            { t: 1_772_496_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          ]}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(1)).toBeDefined();
    });
    expect(updateByPane.get(1)?.mock.calls.length ?? 0).toBe(0);
  });

  it("does not subscribe internal realtime stream for linked workstation groups", async () => {
    storeTick = {
      token: "NSE:AAPL",
      market: "NSE",
      symbol: "AAPL",
      ltp: 101.25,
      change: 0.5,
      change_pct: 0.5,
      oi: null,
      volume: 12,
      ts: "2026-03-03T10:00:30.000Z",
    };
    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1m"
          mode="candles"
          crosshairSyncGroupId="chart-workstation-linked"
          data={[
            { t: 1_772_496_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          ]}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(1)).toBeDefined();
    });
    expect(updateByPane.get(1)?.mock.calls.length ?? 0).toBeGreaterThan(0);
  });

  it("supports replay controls with deterministic truncation progress", async () => {
    await act(async () => {
      render(
        <div style={{ width: 800, height: 400 }}>
          <TradingChart
            ticker="AAPL"
            timeframe="1m"
            mode="candles"
            crosshairSyncGroupId="chart-workstation"
            data={[
              { t: 1_772_496_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
              { t: 1_772_496_060, o: 100.5, h: 101.5, l: 100, c: 101.1, v: 900 },
              { t: 1_772_496_120, o: 101.1, h: 102.0, l: 100.9, c: 101.8, v: 950 },
            ]}
          />
        </div>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable replay mode" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("replay-progress").textContent).toBe("1/3");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Step replay" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("replay-progress").textContent).toBe("2/3");
  });

  it("keeps chart state stable when extended-hours toggle config changes", async () => {
    const baseProps = {
      ticker: "AAPL",
      timeframe: "1m" as const,
      mode: "candles" as const,
      crosshairSyncGroupId: "chart-workstation",
      data: [
        { t: 1_772_496_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000, s: "pre", ext: true },
        { t: 1_772_496_060, o: 100.5, h: 101.5, l: 100, c: 101.1, v: 900, s: "rth", ext: false },
      ],
    };
    const { rerender } = render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          {...baseProps}
          extendedHours={{ enabled: true, showPreMarket: true, showAfterHours: true, visualMode: "merged", colorScheme: "dimmed" }}
        />
      </div>,
    );

    rerender(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          {...baseProps}
          extendedHours={{ enabled: false, showPreMarket: false, showAfterHours: false, visualMode: "merged", colorScheme: "dimmed" }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(0)).toBeDefined();
      expect(setDataByPane.get(1)).toBeDefined();
    });
  });

  it("falls back to setData when the last bar time regresses at the same series length", async () => {
    const initialData = [
      { t: 100, o: 10, h: 11, l: 9, c: 10.5, v: 100 },
      { t: 200, o: 10.5, h: 12, l: 10, c: 11.5, v: 110 },
      { t: 300, o: 11.5, h: 13, l: 11, c: 12.5, v: 120 },
    ];
    const regressedTailData = [
      { t: 100, o: 10, h: 11, l: 9, c: 10.5, v: 100 },
      { t: 200, o: 10.5, h: 12, l: 10, c: 11.5, v: 110 },
      { t: 250, o: 11.5, h: 12.7, l: 11, c: 12.1, v: 115 },
    ];

    const { rerender } = render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1m"
          mode="candles"
          crosshairSyncGroupId="chart-workstation"
          data={initialData}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(1)?.mock.calls.length).toBeGreaterThan(0);
    });
    const volumeSetData = setDataByPane.get(1);
    const volumeUpdate = updateByPane.get(1);
    expect(volumeSetData?.mock.calls.length).toBe(1);
    expect(volumeUpdate?.mock.calls.length ?? 0).toBe(0);

    rerender(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1m"
          mode="candles"
          crosshairSyncGroupId="chart-workstation"
          data={regressedTailData}
        />
      </div>,
    );

    await waitFor(() => {
      expect(setDataByPane.get(1)?.mock.calls.length).toBe(2);
    });
    expect(updateByPane.get(1)?.mock.calls.length ?? 0).toBe(0);
  });

  it("shows comparison mode controls for multi-symbol overlays", async () => {
    await act(async () => {
      render(
        <div style={{ width: 800, height: 400 }}>
          <TradingChart
            ticker="AAPL"
            timeframe="1D"
            mode="candles"
            crosshairSyncGroupId="chart-workstation"
            data={[
              { t: 1_772_496_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
              { t: 1_772_496_060, o: 100.5, h: 101.5, l: 100, c: 101.1, v: 900 },
            ]}
            comparisonSeries={[
              {
                symbol: "MSFT",
                data: [
                  { t: 1_772_496_000, o: 200, h: 201, l: 199, c: 200, v: 1000 },
                  { t: 1_772_496_060, o: 200, h: 202, l: 200, c: 202, v: 900 },
                ],
              },
            ]}
          />
        </div>,
      );
      await Promise.resolve();
    });

    const normalizedButton = screen.getByRole("button", { name: "Comparison normalized mode" });
    const priceButton = screen.getByRole("button", { name: "Comparison price mode" });
    expect(normalizedButton).toBeInTheDocument();
    expect(priceButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(priceButton);
      fireEvent.click(normalizedButton);
      await Promise.resolve();
    });
  });
});
