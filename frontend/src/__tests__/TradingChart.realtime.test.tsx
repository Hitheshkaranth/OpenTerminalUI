import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingChart } from "../components/chart/TradingChart";

const updateByPane = new Map<number, ReturnType<typeof vi.fn>>();
const setDataByPane = new Map<number, ReturnType<typeof vi.fn>>();
const applyOptionsByPane = new Map<number, ReturnType<typeof vi.fn>>();
const chartApplyOptionsMock = vi.fn();
const timeScaleSetVisibleRangeMock = vi.fn();
let crosshairMoveHandler: ((param: any) => void) | null = null;
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
      const applyOptions = vi.fn();
      updateByPane.set(pane, update);
      setDataByPane.set(pane, setData);
      applyOptionsByPane.set(pane, applyOptions);
      return {
        setData,
        update,
        applyOptions,
        coordinateToPrice: vi.fn(() => 100),
        createPriceLine: vi.fn(() => ({ remove: vi.fn() })),
        removePriceLine: vi.fn(),
      };
    },
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    panes: vi.fn(() => [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }]),
    timeScale: vi.fn(() => ({
      setVisibleLogicalRange: vi.fn(),
      setVisibleRange: timeScaleSetVisibleRangeMock,
      fitContent: vi.fn(),
      timeToCoordinate: vi.fn(() => 12),
      subscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    })),
    subscribeCrosshairMove: vi.fn((cb: (param: any) => void) => {
      crosshairMoveHandler = cb;
    }),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
    applyOptions: chartApplyOptionsMock,
    removeSeries: vi.fn(),
    remove: vi.fn(),
  });
  return {
    ColorType: { Solid: "solid" },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
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
  updateChartDrawing: vi.fn(async () => ({})),
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
    applyOptionsByPane.clear();
    chartApplyOptionsMock.mockClear();
    timeScaleSetVisibleRangeMock.mockClear();
    crosshairMoveHandler = null;
    window.localStorage.clear();
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
      fireEvent.click(screen.getByRole("button", { name: "Step replay forward" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("replay-progress").textContent).toBe("2/3");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Step replay backward" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("replay-progress").textContent).toBe("1/3");
  });

  it("supports go-to-date and session jumps while respecting extended-hours visibility", async () => {
    await act(async () => {
      render(
        <div style={{ width: 800, height: 400 }}>
          <TradingChart
            ticker="AAPL"
            timeframe="1m"
            mode="candles"
            crosshairSyncGroupId="chart-workstation"
            extendedHours={{ enabled: true, showPreMarket: false, showAfterHours: false, visualMode: "merged", colorScheme: "dimmed" }}
            data={[
              { t: Math.floor(new Date("2026-03-02T13:00:00").getTime() / 1000), o: 99, h: 100, l: 98, c: 99.5, v: 100, s: "pre", ext: true },
              { t: Math.floor(new Date("2026-03-02T15:30:00").getTime() / 1000), o: 100, h: 101, l: 99, c: 100.5, v: 110, s: "rth", ext: false },
              { t: Math.floor(new Date("2026-03-02T20:30:00").getTime() / 1000), o: 100.5, h: 101, l: 100, c: 100.8, v: 90, s: "post", ext: true },
              { t: Math.floor(new Date("2026-03-03T15:30:00").getTime() / 1000), o: 101, h: 102, l: 100.5, c: 101.5, v: 120, s: "rth", ext: false },
            ]}
          />
        </div>,
      );
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable replay mode" }));
    fireEvent.change(screen.getByTestId("replay-go-to-date-input"), {
      target: { value: "2026-03-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go to selected date" }));

    await waitFor(() => expect(screen.getByTestId("replay-progress").textContent).toBe("2/4"));

    fireEvent.click(screen.getByRole("button", { name: "Next replay session" }));
    await waitFor(() => expect(screen.getByTestId("replay-progress").textContent).toBe("4/4"));
  });

  it("applies external go-to-date commands as live historical navigation when replay is disabled", async () => {
    const props = {
      ticker: "AAPL",
      timeframe: "1D" as const,
      mode: "candles" as const,
      crosshairSyncGroupId: "chart-workstation",
      data: [
        { t: Math.floor(new Date("2026-03-01T15:30:00").getTime() / 1000), o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
        { t: Math.floor(new Date("2026-03-02T15:30:00").getTime() / 1000), o: 101, h: 102, l: 100, c: 101.5, v: 900 },
        { t: Math.floor(new Date("2026-03-03T15:30:00").getTime() / 1000), o: 102, h: 103, l: 101, c: 102.5, v: 950 },
      ],
    };
    const { rerender } = render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart {...props} />
      </div>,
    );

    rerender(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          {...props}
          externalReplayCommand={{ type: "goToDate", revision: 1, date: "2026-03-02" }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(timeScaleSetVisibleRangeMock).toHaveBeenCalled();
      expect(screen.queryByTestId("replay-progress")).not.toBeInTheDocument();
    });
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

  it("renders replay-aware context overlays and respects overlay toggles", async () => {
    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          mode="candles"
          crosshairSyncGroupId="chart-workstation"
          market="US"
          data={[
            { t: Math.floor(new Date("2026-03-02T15:30:00Z").getTime() / 1000), o: 100, h: 101, l: 99, c: 100.5, v: 1000, s: "rth" },
            { t: Math.floor(new Date("2026-03-03T15:30:00Z").getTime() / 1000), o: 101, h: 102, l: 100, c: 101.5, v: 900, s: "rth" },
          ]}
          contextEvents={[
            {
              symbol: "AAPL",
              event_type: "dividend",
              title: "Dividend ex-date",
              description: "Dividend ex-date",
              event_date: "2026-03-02",
              ex_date: "2026-03-02",
              source: "fixture",
              impact: "positive",
            },
            {
              symbol: "AAPL",
              event_type: "earnings",
              title: "Quarterly earnings",
              description: "Quarterly earnings",
              event_date: "2026-03-03",
              source: "fixture",
              impact: "neutral",
            },
          ]}
          fundamentals={{
            symbol: "AAPL",
            as_of: "2026-03-03",
            data_version_id: "dv-1",
            metrics: {
              market_cap: 1_500_000_000_000,
              pe_ratio: 22.4,
              roe: 0.31,
            },
          }}
          marketStatus={{ nyseStatus: "OPEN" }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-market-status")).toHaveTextContent("MKT OPEN");
      expect(screen.getByTestId("chart-session-status")).toHaveTextContent("SESS RTH");
      expect(screen.getByTestId("chart-fundamental-context")).toHaveTextContent("P/E 22.4x");
      expect(screen.getByTestId("chart-action-markers")).toHaveTextContent("DIV");
      expect(screen.getByTestId("chart-event-markers")).toHaveTextContent("ER");
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable replay mode" }));

    await waitFor(() => {
      expect(screen.getByTestId("chart-market-status")).toHaveTextContent("MKT REPLAY RTH");
      expect(screen.queryByTestId("chart-event-markers")).not.toBeInTheDocument();
      expect(screen.getByTestId("chart-action-markers")).toHaveTextContent("DIV");
    });

    fireEvent.click(screen.getByRole("button", { name: "Step replay forward" }));

    await waitFor(() => {
      expect(screen.getByTestId("chart-event-markers")).toHaveTextContent("ER");
    });

    fireEvent.click(screen.getByTestId("chart-event-overlay-toggle"));
    fireEvent.click(screen.getByTestId("chart-fundamentals-overlay-toggle"));
    fireEvent.click(screen.getByTestId("chart-market-overlay-toggle"));

    await waitFor(() => {
      expect(screen.queryByTestId("chart-event-markers")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chart-fundamental-context")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chart-market-status")).not.toBeInTheDocument();
    });

    expect(JSON.parse(window.localStorage.getItem("lts:chart-surfaces:AAPL:1D") || "{}")).toEqual(
      expect.objectContaining({
        eventOverlayVisible: false,
        fundamentalsVisible: false,
        marketStatusVisible: false,
      }),
    );
  });

  it("renders persisted legend, status line, data window, and price-scale settings", async () => {
    window.localStorage.setItem(
      "lts:chart-surfaces:AAPL:1D",
      JSON.stringify({
        legendVisible: true,
        statusLineVisible: true,
        dataWindowVisible: true,
        priceScalePlacement: "left",
        priceScaleTransform: "indexedTo100",
      }),
    );

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
          overlays={{
            sma: {
              ticker: "AAPL",
              indicator: "sma",
              params: {},
              data: [
                { t: 1_772_496_000, values: { value: 100.2 } },
                { t: 1_772_496_060, values: { value: 100.8 } },
              ],
            },
          }}
        />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chart-legend")).toHaveTextContent("AAPL");
      expect(screen.getByTestId("chart-data-window")).toHaveTextContent("SMA");
      expect(screen.getByTestId("chart-status-line")).toHaveTextContent("SCALE LEFT INDEX 100");
    });

    expect(chartApplyOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leftPriceScale: expect.objectContaining({ visible: true, mode: 3 }),
        rightPriceScale: expect.objectContaining({ visible: false, mode: 3 }),
      }),
    );
  });

  it("updates inspected OHLC and overlay values from crosshair movement and persists control changes", async () => {
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
          overlays={{
            sma: {
              ticker: "AAPL",
              indicator: "sma",
              params: {},
              data: [
                { t: 1_772_496_000, values: { value: 100.2 } },
                { t: 1_772_496_060, values: { value: 100.8 } },
              ],
            },
          }}
        />
      </div>,
    );

    await waitFor(() => expect(screen.getByTestId("chart-legend")).toHaveTextContent("C 101.10"));

    await act(async () => {
      crosshairMoveHandler?.({
        time: 1_772_496_000,
        point: { x: 12, y: 18 },
        seriesData: new Map(),
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("chart-legend")).toHaveTextContent("C 100.50");
      expect(screen.getByTestId("chart-legend")).toHaveTextContent("SMA 100.20");
    });

    fireEvent.click(screen.getByTestId("chart-data-window-toggle"));
    fireEvent.click(screen.getByTestId("chart-scale-position-toggle"));
    fireEvent.change(screen.getByTestId("chart-scale-transform-select"), {
      target: { value: "indexedTo100" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("chart-data-window")).toHaveTextContent("Open");
      expect(chartApplyOptionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          leftPriceScale: expect.objectContaining({ visible: true, mode: 3 }),
          rightPriceScale: expect.objectContaining({ visible: false, mode: 3 }),
        }),
      );
    });

    expect(JSON.parse(window.localStorage.getItem("lts:chart-surfaces:AAPL:1D") || "{}")).toEqual(
      expect.objectContaining({
        dataWindowVisible: true,
        priceScalePlacement: "left",
        priceScaleTransform: "indexedTo100",
      }),
    );
  });
});
