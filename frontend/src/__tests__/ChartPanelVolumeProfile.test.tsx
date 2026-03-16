import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import type { ChartSlot } from "../store/chartWorkstationStore";
import type { ChartResponse, ChartPoint } from "../types";

const fetchVolumeProfileMock = vi.fn();
const fetchAlertsMock = vi.fn();
const createAlertMock = vi.fn();
const fetchStockEventsMock = vi.fn();
const fetchPitFundamentalsMock = vi.fn();
const fetchMarketStatusMock = vi.fn();
const tradingChartMock = vi.fn();

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchVolumeProfile: (...args: unknown[]) => fetchVolumeProfileMock(...args),
    fetchAlertsFiltered: (...args: unknown[]) => fetchAlertsMock(...args),
    createAlert: (...args: unknown[]) => createAlertMock(...args),
    fetchStockEvents: (...args: unknown[]) => fetchStockEventsMock(...args),
    fetchPitFundamentals: (...args: unknown[]) => fetchPitFundamentalsMock(...args),
    fetchMarketStatus: (...args: unknown[]) => fetchMarketStatusMock(...args),
  };
});

vi.mock("../components/chart/TradingChart", () => ({
  TradingChart: (props: Record<string, unknown>) => {
    tradingChartMock(props);
    return (
      <div data-testid="mock-trading-chart">
        <button
          type="button"
          onClick={() =>
            (props.onRequestCreateAlert as ((draft: Record<string, unknown>) => void) | undefined)?.({
              symbol: "NASDAQ:AAPL",
              title: "Create Price Alert",
              threshold: 103.25,
              suggestedConditionType: "price_above",
              note: "Chart price snapshot @ 103.25",
                chartContext: {
                  version: 1,
                  surface: "chart",
                  source: "price",
                  symbol: "NASDAQ:AAPL",
                  market: "NASDAQ",
                timeframe: "1D",
                panelId: "slot-1",
                workspaceId: "slot-1",
                compareMode: "normalized",
                sourceLabel: "Price Snapshot",
                referencePrice: 103.25,
                referenceTime: 1,
              },
            })
          }
        >
          Request Alert
        </button>
      </div>
    );
  },
}));

vi.mock("../components/chart-workstation/ChartPanelHeader", () => ({
  ChartPanelHeader: () => <div data-testid="mock-chart-panel-header" />,
}));

vi.mock("../components/chart-workstation/ChartPanelFooter", () => ({
  ChartPanelFooter: () => <div data-testid="mock-chart-panel-footer" />,
}));

vi.mock("../shared/chart/IndicatorPanel", () => ({
  IndicatorPanel: (props: Record<string, unknown>) => (
    <div data-testid="mock-indicator-panel">
      <button
        type="button"
        onClick={() =>
          (props.onCreateAlert as ((config: Record<string, unknown>) => void) | undefined)?.({
            id: "sma",
            params: { period: 20 },
            visible: true,
          })
        }
      >
        Indicator Alert
      </button>
    </div>
  ),
}));

vi.mock("../shared/portfolioQuickAdd", () => ({
  quickAddToFirstPortfolio: vi.fn(async () => ({ ok: true })),
}));

const SLOT: ChartSlot = {
  id: "slot-1",
  ticker: "AAPL",
  companyName: "Apple",
  market: "US",
  timeframe: "1D",
  chartType: "candle",
  indicators: [],
  extendedHours: {
    enabled: false,
    showPreMarket: true,
    showAfterHours: true,
    visualMode: "merged",
    colorScheme: "dimmed",
  },
  preMarketLevels: {
    showPMHigh: true,
    showPMLow: true,
    showPMOpen: false,
    showPMVWAP: false,
    extendIntoRTH: true,
    daysToShow: 1,
  },
};

function makeChartResponse(points: ChartPoint[]): ChartResponse {
  return {
    ticker: "AAPL",
    interval: "1d",
    currency: "USD",
    data: points,
    meta: { warnings: [] },
  };
}

describe("ChartPanel Volume Profile controls", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchVolumeProfileMock.mockReset();
    fetchAlertsMock.mockReset();
    createAlertMock.mockReset();
    fetchStockEventsMock.mockReset();
    fetchPitFundamentalsMock.mockReset();
    fetchMarketStatusMock.mockReset();
    tradingChartMock.mockReset();
    fetchVolumeProfileMock.mockImplementation(
      async (_symbol: string, opts?: { period?: string; bins?: number; market?: string; mode?: "fixed" | "session" | "visible"; lookbackBars?: number }) => ({
      symbol: "AAPL",
      period: opts?.period ?? "20d",
      mode: opts?.mode ?? "fixed",
      lookback_bars: opts?.mode === "visible" ? (opts?.lookbackBars ?? 300) : null,
      bins: [
        { price_low: 100, price_high: 110, volume: 100, buy_volume: 60, sell_volume: 40 },
        { price_low: 110, price_high: 120, volume: 200, buy_volume: 120, sell_volume: 80 },
      ],
      poc_price: opts?.period === "10d" ? 118 : 115,
      value_area_high: 119,
      value_area_low: 108,
      }),
    );
    fetchAlertsMock.mockResolvedValue([]);
    createAlertMock.mockResolvedValue(undefined);
    fetchStockEventsMock.mockResolvedValue([
      {
        symbol: "AAPL",
        event_type: "earnings",
        title: "Quarterly earnings",
        description: "Quarterly earnings",
        event_date: "2026-03-03",
        source: "fixture",
        impact: "neutral",
      },
    ]);
    fetchPitFundamentalsMock.mockResolvedValue({
      symbol: "AAPL",
      as_of: "2026-03-03",
      data_version_id: "dv-1",
      metrics: {
        market_cap: 1_500_000_000_000,
        pe_ratio: 22,
        roe: 0.31,
      },
    });
    fetchMarketStatusMock.mockResolvedValue({ marketState: [{ marketStatus: "OPEN" }] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPanel(
    linkGroup: "off" | "A" | "B" | "C" = "off",
    compareProps?: {
      comparisonSeries?: Array<{ symbol: string; data: ChartPoint[]; color?: string }>;
      comparisonMode?: "normalized" | "price";
      crosshairLinked?: boolean;
      replayCommand?: { type: "toggle" | "stepForward" | "goToDate"; revision: number; date?: string };
      viewRangeCommand?: { presetId: "1D" | "5D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "MAX"; revision: number };
    },
  ) {
    render(
      <ChartPanel
        slot={SLOT}
        isActive={true}
        isFullscreen={false}
        onActivate={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onRemove={vi.fn()}
        linkGroup={linkGroup}
        linkSettings={{
          symbol: true,
          interval: true,
          crosshair: compareProps?.crosshairLinked ?? true,
          replay: false,
          dateRange: false,
        }}
        onLinkGroupChange={vi.fn()}
        onTickerChange={vi.fn()}
        onTimeframeChange={vi.fn()}
        onChartTypeChange={vi.fn()}
        onETHChange={vi.fn()}
        onPMLevelsChange={vi.fn()}
        onIndicatorsChange={vi.fn()}
        chartResponse={makeChartResponse([{ t: 1, o: 100, h: 105, l: 99, c: 104, v: 10 }])}
        chartLoading={false}
        chartError={null}
        liveQuote={null}
        comparisonSeries={compareProps?.comparisonSeries}
        comparisonMode={compareProps?.comparisonMode}
        replayCommand={compareProps?.replayCommand}
        viewRangeCommand={compareProps?.viewRangeCommand}
      />,
    );
  }

  it("toggles VP overlay and reloads profile when period/bins change", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Show volume profile" }));
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(1));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", {
      period: "20d",
      bins: 50,
      market: "US",
      mode: "fixed",
      lookbackBars: undefined,
    });
    expect(screen.getByTestId("volume-profile-overlay")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "10d" } });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(2));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", {
      period: "10d",
      bins: 50,
      market: "US",
      mode: "fixed",
      lookbackBars: undefined,
    });

    fireEvent.change(selects[2], { target: { value: "80" } });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(3));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", {
      period: "10d",
      bins: 80,
      market: "US",
      mode: "fixed",
      lookbackBars: undefined,
    });

    fireEvent.change(selects[0], { target: { value: "visible" } });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(4));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", {
      period: "10d",
      bins: 80,
      market: "US",
      mode: "visible",
      lookbackBars: 300,
    });
  });

  it("refreshes VP profile on interval for incremental updates", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Show volume profile" }));
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(2));
  });

  it("maps link groups to isolated or shared crosshair sync IDs", () => {
    renderPanel("off");
    const offProps = tradingChartMock.mock.calls[tradingChartMock.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect(offProps?.panelId).toBe("slot-1");
    expect(offProps?.crosshairSyncGroupId).toBe("chart-workstation-solo-slot-1");

    renderPanel("B");
    const linkedProps = tradingChartMock.mock.calls[tradingChartMock.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect(linkedProps?.panelId).toBe("slot-1");
    expect(linkedProps?.crosshairSyncGroupId).toBe("chart-workstation-linked-B");

    renderPanel("B", { crosshairLinked: false });
    const localProps = tradingChartMock.mock.calls[tradingChartMock.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect(localProps?.crosshairSyncGroupId).toBe("chart-workstation-solo-slot-1");
  });

  it("forwards compare overlays to the chart renderer", () => {
    renderPanel("off", {
      comparisonMode: "price",
      comparisonSeries: [{ symbol: "MSFT", data: [{ t: 1, o: 10, h: 11, l: 9, c: 10.5, v: 100 }], color: "#4EA1FF" }],
    });

    const props = tradingChartMock.mock.calls[tradingChartMock.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect(props?.comparisonMode).toBe("price");
    expect(props?.comparisonSeries).toEqual([
      { symbol: "MSFT", data: [{ t: 1, o: 10, h: 11, l: 9, c: 10.5, v: 100 }], color: "#4EA1FF" },
    ]);
  });

  it("loads contextual overlays and forwards them to the chart renderer", async () => {
    renderPanel();

    await waitFor(() => expect(fetchStockEventsMock).toHaveBeenCalledWith("AAPL", { from_date: "1970-01-01", to_date: "1970-01-01" }));
    await waitFor(() => expect(fetchPitFundamentalsMock).toHaveBeenCalledWith("AAPL", { as_of: "1970-01-01" }));
    await waitFor(() => expect(fetchMarketStatusMock).toHaveBeenCalledTimes(1));

    const props = tradingChartMock.mock.calls[tradingChartMock.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect(props?.contextEvents).toEqual([
      expect.objectContaining({ event_type: "earnings", title: "Quarterly earnings" }),
    ]);
    expect(props?.fundamentals).toEqual(
      expect.objectContaining({ symbol: "AAPL", metrics: expect.objectContaining({ pe_ratio: 22 }) }),
    );
    expect(props?.marketStatus).toEqual({ marketState: [{ marketStatus: "OPEN" }] });
  });

  it("forwards replay and range commands to the chart renderer", () => {
    renderPanel("A", {
      replayCommand: { type: "stepForward", revision: 2 },
      viewRangeCommand: { presetId: "1Y", revision: 4 },
    });

    const props = tradingChartMock.mock.calls[tradingChartMock.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect(props?.externalReplayCommand).toEqual({ type: "stepForward", revision: 2 });
    expect(props?.viewRangeCommand).toEqual({ presetId: "1Y", revision: 4 });
  });

  it("renders active chart alert context from filtered symbol alerts", async () => {
    fetchAlertsMock.mockResolvedValue([
      {
        id: "alert-1",
        ticker: "AAPL",
        alert_type: "price",
        condition: "above",
        threshold: 103.25,
        note: "",
        created_at: "2026-03-12T00:00:00Z",
        condition_type: "price_above",
        parameters: {
          threshold: 103.25,
          chart_context: {
            version: 1,
            surface: "chart",
            source: "indicator",
            symbol: "AAPL",
            market: "US",
            timeframe: "1D",
            panelId: "slot-1",
            workspaceId: "slot-1",
            compareMode: "normalized",
            sourceLabel: "SMA",
            referencePrice: 103.25,
            referenceTime: 1,
          },
        },
      },
    ]);

    renderPanel();

    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalledWith({ status: "active", symbol: "NASDAQ:AAPL" }));
    expect(screen.getByTestId("chart-active-alerts")).toHaveTextContent("SMA");
    expect(screen.getByTestId("chart-active-alerts")).toHaveTextContent("103.25");
  });

  it("opens the chart alert composer and submits alert payloads", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Request Alert" }));
    expect(screen.getByTestId("chart-alert-composer")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("chart-alert-threshold"), { target: { value: "104.5" } });
    fireEvent.change(screen.getByTestId("chart-alert-cooldown"), { target: { value: "90" } });
    fireEvent.click(screen.getByTestId("chart-alert-channel-push"));
    fireEvent.click(screen.getByTestId("chart-alert-submit"));

    await waitFor(() => expect(createAlertMock).toHaveBeenCalledTimes(1));
    expect(createAlertMock).toHaveBeenCalledWith({
      symbol: "NASDAQ:AAPL",
      condition_type: "price_above",
      parameters: {
        threshold: 104.5,
        note: "Chart price snapshot @ 103.25",
        chart_context: expect.objectContaining({
          source: "price",
          sourceLabel: "Price Snapshot",
          referencePrice: 104.5,
        }),
      },
      cooldown_seconds: 90,
      channels: ["in_app", "push"],
    });
    await waitFor(() => expect(fetchAlertsMock).toHaveBeenCalledTimes(2));
  });

  it("shows actionable channel misconfiguration feedback when alert creation fails", async () => {
    createAlertMock.mockRejectedValueOnce(
      new Error(
        "Selected delivery channels are not configured: webhook (set parameters.webhook_url). Remove those channels or add the required channel settings.",
      ),
    );
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Request Alert" }));
    fireEvent.click(screen.getByTestId("chart-alert-channel-webhook"));
    fireEvent.click(screen.getByTestId("chart-alert-submit"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Selected delivery channels are not configured: webhook (set parameters.webhook_url). Remove those channels or add the required channel settings.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("chart-alert-composer")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-alert-notice")).not.toBeInTheDocument();
  });
});
