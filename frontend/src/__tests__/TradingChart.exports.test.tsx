import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingChart } from "../components/chart/TradingChart";

const exportChartPngMock = vi.fn();
const exportChartCsvMock = vi.fn();

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
    addSeries: () => ({
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      coordinateToPrice: vi.fn((y: number) => y),
      priceToCoordinate: vi.fn((p: number) => p),
      createPriceLine: vi.fn(() => ({ remove: vi.fn() })),
      removePriceLine: vi.fn(),
    }),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    panes: vi.fn(() => [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }]),
    timeScale: vi.fn(() => ({
      setVisibleLogicalRange: vi.fn(),
      fitContent: vi.fn(),
      timeToCoordinate: vi.fn(() => 12),
      coordinateToTime: vi.fn(() => 1_700_000_000),
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
    takeScreenshot: vi.fn(() => ({ toDataURL: vi.fn(() => "data:image/png;base64,abc") })),
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
  listChartDrawings: vi.fn(async () => []),
  createChartDrawing: vi.fn(),
  deleteChartDrawing: vi.fn(),
  updateChartDrawing: vi.fn(),
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
  useQuotesStore: vi.fn((selector: (value: { ticksByToken: Record<string, unknown> }) => unknown) => selector({ ticksByToken: {} })),
  useQuotesStream: () => ({ subscribe: vi.fn() }),
}));

vi.mock("../shared/chart/ChartExport", () => ({
  buildChartExportFilename: vi.fn((symbol: string, timeframe: string, extension: string) => `chart-${symbol.toLowerCase()}-${timeframe.toLowerCase()}.${extension}`),
  exportChartPng: (...args: unknown[]) => exportChartPngMock(...args),
  exportChartCsv: (...args: unknown[]) => exportChartCsvMock(...args),
}));

describe("TradingChart export controls", () => {
  beforeEach(() => {
    exportChartPngMock.mockReset();
    exportChartCsvMock.mockReset();
    window.localStorage.clear();
  });

  it("exports png and csv from the chart surface controls", async () => {
    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          mode="candles"
          data={[
            { t: 1_700_000_000, o: 100, h: 105, l: 99, c: 102, v: 1000 },
            { t: 1_700_086_400, o: 102, h: 106, l: 101, c: 105, v: 1400 },
          ]}
        />
      </div>,
    );

    await waitFor(() => expect(screen.getByTestId("chart-export-png")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chart-export-png"));
    expect(exportChartPngMock).toHaveBeenCalledWith(expect.any(Object), "chart-aapl-1d.png");

    fireEvent.click(screen.getByTestId("chart-export-csv"));
    expect(exportChartCsvMock).toHaveBeenCalledWith(
      [
        { t: 1_700_000_000, o: 100, h: 105, l: 99, c: 102, v: 1000 },
        { t: 1_700_086_400, o: 102, h: 106, l: 101, c: 105, v: 1400 },
      ],
      "chart-aapl-1d.csv",
    );
  });
});
