import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingChart } from "../components/chart/TradingChart";

const listChartDrawingsMock = vi.fn();
const createChartDrawingMock = vi.fn();
const deleteChartDrawingMock = vi.fn();

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
  listChartDrawings: (...args: unknown[]) => listChartDrawingsMock(...args),
  createChartDrawing: (...args: unknown[]) => createChartDrawingMock(...args),
  deleteChartDrawing: (...args: unknown[]) => deleteChartDrawingMock(...args),
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
  useQuotesStore: vi.fn((selector: any) => selector({ ticksByToken: {} })),
  useQuotesStream: () => ({ subscribe: vi.fn() }),
}));

describe("TradingChart drawing persistence scope", () => {
  beforeEach(() => {
    vi.useRealTimers();
    listChartDrawingsMock.mockReset();
    createChartDrawingMock.mockReset();
    deleteChartDrawingMock.mockReset();
  });

  it("loads drawings scoped by timeframe and workspace, without immediate resync rewrite", async () => {
    listChartDrawingsMock.mockResolvedValue([
      {
        id: "d1",
        symbol: "AAPL",
        tool_type: "hline",
        coordinates: { price: 101, timeframe: "1D", workspace_id: "slot-1" },
        style: { color: "#00ff00", lineWidth: 2 },
      },
    ]);

    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          drawingWorkspaceId="slot-1"
          mode="candles"
          data={[{ t: 1_700_000_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 }]}
        />
      </div>,
    );

    await waitFor(() => expect(listChartDrawingsMock).toHaveBeenCalled());
    expect(listChartDrawingsMock).toHaveBeenLastCalledWith("AAPL", {
      timeframe: "1D",
      workspaceId: "slot-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(deleteChartDrawingMock).not.toHaveBeenCalled();
    expect(createChartDrawingMock).not.toHaveBeenCalled();
  });
});
