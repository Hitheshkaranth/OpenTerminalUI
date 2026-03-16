import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingChart } from "../components/chart/TradingChart";

const listChartDrawingsMock = vi.fn();
const createChartDrawingMock = vi.fn();
const deleteChartDrawingMock = vi.fn();
const updateChartDrawingMock = vi.fn();
let clickHandler: ((param: any) => void) | null = null;

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
    subscribeClick: vi.fn((handler: (param: any) => void) => {
      clickHandler = handler;
    }),
    unsubscribeClick: vi.fn(),
    applyOptions: vi.fn(),
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
  listChartDrawings: (...args: unknown[]) => listChartDrawingsMock(...args),
  createChartDrawing: (...args: unknown[]) => createChartDrawingMock(...args),
  deleteChartDrawing: (...args: unknown[]) => deleteChartDrawingMock(...args),
  updateChartDrawing: (...args: unknown[]) => updateChartDrawingMock(...args),
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
    window.localStorage.clear();
    listChartDrawingsMock.mockReset();
    createChartDrawingMock.mockReset();
    deleteChartDrawingMock.mockReset();
    updateChartDrawingMock.mockReset();
    clickHandler = null;
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
    expect(updateChartDrawingMock).not.toHaveBeenCalled();
  });

  it("falls back to local drawing restore when remote list fails", async () => {
    listChartDrawingsMock.mockRejectedValue(new Error("offline"));
    window.localStorage.setItem(
      "lts:drawings:AAPL:1D:slot-local",
      JSON.stringify([
        { id: "hl-1", type: "hline", price: 123.45, style: { color: "#00ff00", lineWidth: 1 } },
        { id: "bad", type: "hline", price: "nan" },
      ]),
    );

    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          drawingWorkspaceId="slot-local"
          mode="candles"
          data={[{ t: 1_700_000_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 }]}
        />
      </div>,
    );

    await waitFor(() => expect(listChartDrawingsMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(createChartDrawingMock).not.toHaveBeenCalled();
    expect(deleteChartDrawingMock).not.toHaveBeenCalled();
    expect(updateChartDrawingMock).not.toHaveBeenCalled();

    const restored = JSON.parse(window.localStorage.getItem("lts:drawings:AAPL:1D:slot-local") || "[]");
    expect(restored).toEqual([
      {
        version: 3,
        id: "hl-1",
        tool: {
          family: "level",
          label: "Horizontal Line",
          maxAnchors: 1,
          minAnchors: 1,
          shape: "level",
          type: "hline",
        },
        anchors: [{ key: "level", role: "level", time: 0, price: 123.45 }],
        style: { color: "#00ff00", lineWidth: 1, lineStyle: "dashed", fillColor: null, fillOpacity: 0 },
        visible: true,
        locked: false,
        order: 0,
        meta: { timeframe: "1D", workspaceId: "slot-local", createdAt: null },
      },
    ]);
  });

  it("opens the object-tree manager for persisted drawings", async () => {
    listChartDrawingsMock.mockRejectedValue(new Error("offline"));
    window.localStorage.setItem(
      "lts:drawings:AAPL:1D:slot-tree",
      JSON.stringify([
        {
          version: 3,
          id: "box-1",
          order: 1,
          tool: { type: "rectangle", family: "range", label: "Rectangle", minAnchors: 2, maxAnchors: 2, shape: "range" },
          anchors: [
            { key: "start", role: "start", time: 100, price: 120 },
            { key: "end", role: "end", time: 120, price: 110 },
          ],
          style: { color: "#7bd389", lineWidth: 1, lineStyle: "solid", fillColor: "#7bd389", fillOpacity: 16 },
          visible: true,
          locked: false,
          meta: { timeframe: "1D", workspaceId: "slot-tree", createdAt: null },
        },
      ]),
    );

    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          drawingWorkspaceId="slot-tree"
          mode="candles"
          data={[{ t: 1_700_000_000, o: 100, h: 121, l: 99, c: 100.5, v: 1000 }]}
        />
      </div>,
    );

    await waitFor(() => expect(listChartDrawingsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("drawing-objects-toggle"));

    expect(screen.getByTestId("drawing-object-tree-panel")).toBeInTheDocument();
    expect(screen.getByText("Rectangle")).toBeInTheDocument();
  });

  it("creates drawing-originated alert drafts from the object tree", async () => {
    listChartDrawingsMock.mockRejectedValue(new Error("offline"));
    window.localStorage.setItem(
      "lts:drawings:AAPL:1D:slot-alerts",
      JSON.stringify([
        {
          version: 3,
          id: "hl-1",
          order: 0,
          tool: { type: "hline", family: "level", label: "Horizontal Line", minAnchors: 1, maxAnchors: 1, shape: "level" },
          anchors: [{ key: "level", role: "level", time: 100, price: 123.45 }],
          style: { color: "#4dd0e1", lineWidth: 1, lineStyle: "dashed", fillColor: null, fillOpacity: 0 },
          visible: true,
          locked: false,
          meta: { timeframe: "1D", workspaceId: "slot-alerts", createdAt: null },
        },
      ]),
    );
    const onRequestCreateAlert = vi.fn();

    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          drawingWorkspaceId="slot-alerts"
          mode="candles"
          data={[{ t: 1_700_000_000, o: 120, h: 124, l: 119, c: 121.5, v: 1000 }]}
          onRequestCreateAlert={onRequestCreateAlert}
        />
      </div>,
    );

    await waitFor(() => expect(listChartDrawingsMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("drawing-objects-toggle"));
    fireEvent.click(screen.getByTestId("drawing-alert-hl-1"));

    expect(onRequestCreateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: 123.45,
        chartContext: expect.objectContaining({
          source: "drawing",
          sourceLabel: "Horizontal Line",
        }),
      }),
    );
  });

  it("retries remote persistence after an initial list failure once local drawings change", async () => {
    listChartDrawingsMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    createChartDrawingMock.mockResolvedValue({ id: "remote-1" });

    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          drawingWorkspaceId="slot-retry-load"
          mode="candles"
          drawMode="hline"
          data={[{ t: 1_700_000_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 }]}
        />
      </div>,
    );

    await waitFor(() => expect(listChartDrawingsMock).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();

    clickHandler?.({
      time: 1_700_000_000,
      point: { x: 12, y: 123 },
      seriesData: new Map(),
    });
    await vi.advanceTimersByTimeAsync(600);

    expect(listChartDrawingsMock).toHaveBeenCalledTimes(2);
    expect(createChartDrawingMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("keeps retrying remote persistence after a debounced sync failure", async () => {
    listChartDrawingsMock.mockResolvedValue([]);
    createChartDrawingMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ id: "remote-2" });

    render(
      <div style={{ width: 800, height: 400 }}>
        <TradingChart
          ticker="AAPL"
          timeframe="1D"
          drawingWorkspaceId="slot-retry-sync"
          mode="candles"
          drawMode="hline"
          data={[{ t: 1_700_000_000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 }]}
        />
      </div>,
    );

    await waitFor(() => expect(listChartDrawingsMock).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();

    clickHandler?.({
      time: 1_700_000_000,
      point: { x: 12, y: 121 },
      seriesData: new Map(),
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(createChartDrawingMock).toHaveBeenCalledTimes(1);

    clickHandler?.({
      time: 1_700_000_060,
      point: { x: 18, y: 122 },
      seriesData: new Map(),
    });
    await vi.advanceTimersByTimeAsync(600);

    expect(listChartDrawingsMock).toHaveBeenCalledTimes(3);
    expect(createChartDrawingMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
