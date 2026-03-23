/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiQueryMock = vi.fn();
const fetchChartMock = vi.fn();
const fetchCryptoCandlesMock = vi.fn();
const fetchCryptoCoinDetailMock = vi.fn();
const fetchCryptoSearchMock = vi.fn();
const fetchQuotesBatchMock = vi.fn();
const searchSymbolsMock = vi.fn();

vi.mock("../api/client", () => ({
  aiQuery: (...args: unknown[]) => aiQueryMock(...args),
  fetchChart: (...args: unknown[]) => fetchChartMock(...args),
  fetchCryptoCandles: (...args: unknown[]) => fetchCryptoCandlesMock(...args),
  fetchCryptoCoinDetail: (...args: unknown[]) => fetchCryptoCoinDetailMock(...args),
  fetchCryptoSearch: (...args: unknown[]) => fetchCryptoSearchMock(...args),
  fetchQuotesBatch: (...args: unknown[]) => fetchQuotesBatchMock(...args),
  searchSymbols: (...args: unknown[]) => searchSymbolsMock(...args),
}));

import { CommandBar } from "../components/layout/CommandBar";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";

describe("CommandBar recent history and preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();

    aiQueryMock.mockReset();
    fetchChartMock.mockReset();
    fetchCryptoCandlesMock.mockReset();
    fetchCryptoCoinDetailMock.mockReset();
    fetchCryptoSearchMock.mockReset();
    fetchQuotesBatchMock.mockReset();
    searchSymbolsMock.mockReset();

    fetchCryptoSearchMock.mockResolvedValue([]);
    searchSymbolsMock.mockResolvedValue([]);

    useSettingsStore.setState({
      selectedCountry: "US",
      selectedMarket: "NASDAQ",
      displayCurrency: "USD",
      realtimeMode: "polling",
      newsAutoRefresh: true,
      newsRefreshSec: 60,
      themeVariant: "terminal-noir",
      customAccentColor: "#FF6B00",
      hudOverlayEnabled: false,
      recentSecurities: [],
    } as Partial<ReturnType<typeof useSettingsStore.getState>> as any);

    useStockStore.setState({
      ticker: "AAPL",
      stock: null,
      chart: null,
      loading: false,
      error: null,
      load: vi.fn(async () => undefined),
    } as Partial<ReturnType<typeof useStockStore.getState>> as any);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows recent securities on focus, navigates them with arrow keys, and promotes the selected security", async () => {
    useSettingsStore.setState({
      recentSecurities: [
        {
          symbol: "AAPL",
          name: "Apple Inc.",
          assetClass: "equity",
          market: "US",
          visitedAt: 200,
        },
        {
          symbol: "MSFT",
          name: "Microsoft Corp.",
          assetClass: "equity",
          market: "US",
          visitedAt: 100,
        },
      ],
    } as Partial<ReturnType<typeof useSettingsStore.getState>> as any);

    const onExecute = vi.fn(async (command: string) => ({ ok: true, target: `/equity/stocks?ticker=${command}` }));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CommandBar onExecute={onExecute} />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText("Command bar");
    fireEvent.focus(input);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onExecute).toHaveBeenCalledWith("MSFT");

    expect(useSettingsStore.getState().recentSecurities.slice(0, 2).map((item) => item.symbol)).toEqual([
      "MSFT",
      "AAPL",
    ]);
  });

  it("renders the inline preview after the debounce window and clears it when the query is cleared", async () => {
    fetchQuotesBatchMock.mockResolvedValue({
      market: "NASDAQ",
      quotes: [
        {
          symbol: "AAPL",
          last: 181.12,
          change: 1.51,
          changePct: 0.84,
          ts: "2026-03-21T19:11:00Z",
        },
      ],
    });
    fetchChartMock.mockResolvedValue({
      ticker: "AAPL",
      interval: "1d",
      currency: "USD",
      data: [
        { c: 176.2 },
        { c: 177.8 },
        { c: 178.4 },
        { c: 179.6 },
        { c: 181.12 },
      ],
      meta: { warnings: [] },
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CommandBar onExecute={() => ({ ok: true, target: "/equity/stocks?ticker=AAPL" })} />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText("Command bar");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "AAPL" } });

    expect(screen.queryByText("Security Preview")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
      await Promise.resolve();
    });

    expect(fetchQuotesBatchMock).toHaveBeenCalledWith(["AAPL"], "NASDAQ");
    expect(fetchChartMock).toHaveBeenCalledWith("AAPL", "1d", "5d", "NASDAQ");
    expect(screen.getByText("Security Preview")).toBeInTheDocument();
    expect(screen.getByText("181.12")).toBeInTheDocument();
    expect(screen.getByText("+0.84%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "AAPL preview sparkline" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("Security Preview")).not.toBeInTheDocument();
  });

  it("cancels debounced preview requests when the GO bar loses focus", async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CommandBar onExecute={() => ({ ok: true, target: "/equity/stocks?ticker=AAPL" })} />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText("Command bar");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "AAPL" } });
    fireEvent.blur(input);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchQuotesBatchMock).not.toHaveBeenCalled();
    expect(fetchChartMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Security Preview")).not.toBeInTheDocument();
  });
});
