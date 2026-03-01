import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import type { ChartSlot } from "../store/chartWorkstationStore";
import type { ChartResponse, ChartPoint } from "../types";

const fetchVolumeProfileMock = vi.fn();

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchVolumeProfile: (...args: unknown[]) => fetchVolumeProfileMock(...args),
  };
});

vi.mock("../components/chart/TradingChart", () => ({
  TradingChart: () => <div data-testid="mock-trading-chart" />,
}));

vi.mock("../components/chart-workstation/ChartPanelHeader", () => ({
  ChartPanelHeader: () => <div data-testid="mock-chart-panel-header" />,
}));

vi.mock("../components/chart-workstation/ChartPanelFooter", () => ({
  ChartPanelFooter: () => <div data-testid="mock-chart-panel-footer" />,
}));

vi.mock("../shared/chart/IndicatorPanel", () => ({
  IndicatorPanel: () => <div data-testid="mock-indicator-panel" />,
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
    fetchVolumeProfileMock.mockImplementation(async (_symbol: string, opts?: { period?: string; bins?: number; market?: string }) => ({
      symbol: "AAPL",
      period: opts?.period ?? "20d",
      bins: [
        { price_low: 100, price_high: 110, volume: 100, buy_volume: 60, sell_volume: 40 },
        { price_low: 110, price_high: 120, volume: 200, buy_volume: 120, sell_volume: 80 },
      ],
      poc_price: opts?.period === "10d" ? 118 : 115,
      value_area_high: 119,
      value_area_low: 108,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toggles VP overlay and reloads profile when period/bins change", async () => {
    render(
      <ChartPanel
        slot={SLOT}
        isActive={true}
        isFullscreen={false}
        onActivate={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onRemove={vi.fn()}
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show volume profile" }));
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(1));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", { period: "20d", bins: 50, market: "US" });
    expect(screen.getByTestId("volume-profile-overlay")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "10d" } });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(2));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", { period: "10d", bins: 50, market: "US" });

    fireEvent.change(selects[1], { target: { value: "80" } });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(3));
    expect(fetchVolumeProfileMock).toHaveBeenLastCalledWith("AAPL", { period: "10d", bins: 80, market: "US" });
  });

  it("refreshes VP profile on interval for incremental updates", async () => {
    render(
      <ChartPanel
        slot={SLOT}
        isActive={true}
        isFullscreen={false}
        onActivate={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onRemove={vi.fn()}
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show volume profile" }));
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(fetchVolumeProfileMock).toHaveBeenCalledTimes(2));
  });
});
