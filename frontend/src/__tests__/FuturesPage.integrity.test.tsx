import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FuturesPage } from "../fno/pages/FuturesPage";
const mocks = vi.hoisted(() => ({ context: { symbol: "NIFTY", expiry: "2026-11-26", market: "NSE" }, history: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() } as any }));
vi.mock("../fno/FnoLayout", () => ({ useFnoContext: () => mocks.context }));
const historyHook = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useStocks", () => ({ useStockHistory: (...args: unknown[]) => { historyHook(...args); return mocks.history; } }));
vi.mock("../fno/api/fnoApi", () => ({ fetchChainSummary: vi.fn(async () => ({})) }));
vi.mock("../hooks/useDisplayCurrency", () => ({ useDisplayCurrency: () => ({ formatDisplayMoney: (value: number) => String(value) }) }));
vi.mock("../shared/chart/ChartEngine", () => ({ ChartEngine: () => <div>Underlying candles</div> }));
vi.mock("../components/market/FuturesPanel", () => ({ FuturesPanel: ({ underlying }: { underlying: string }) => <div>Contracts for {underlying}</div> }));
vi.mock("../shared/chart/IndicatorPanel", () => ({ IndicatorPanel: () => null }));
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FuturesPage /></QueryClientProvider>);
describe("futures result integrity", () => {
  beforeEach(() => { mocks.context = { symbol: "NIFTY", expiry: "2026-11-26", market: "NSE" }; mocks.history = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() }; });
  it.each([["NIFTY", "^NSEI"], ["BANKNIFTY", "^NSEBANK"]])("requests the canonical index history for %s", (symbol, canonical) => {
    mocks.context.symbol = symbol;
    historyHook.mockClear();
    renderPage();
    expect(historyHook).toHaveBeenCalledWith(canonical, "1y", "1d");
  });
  it("shows an empty outcome instead of an endless loading indicator", () => {
    renderPage();
    expect(screen.getByText("No valid chart bars for NIFTY")).toBeInTheDocument();
    expect(screen.queryByText(/Loading.*chart/)).toBeNull();
    expect(screen.queryByText("F&O LIVE")).toBeNull();
    expect(screen.getByText("Contracts for NIFTY")).toBeInTheDocument();
    expect(screen.getByText(/not a selected futures contract/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "4H", exact: true })).toBeNull();
  });
  it("gives a retry action for failed history rather than claiming a live price", () => {
    mocks.history.isError = true;
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Underlying history is unavailable");
    expect(screen.getByRole("button", { name: "Retry underlying history" })).toBeInTheDocument();
  });
  it("does not show an NFO chain for a US equity underlying", () => {
    mocks.context = { symbol: "AAPL", expiry: "2026-11-20", market: "US" };
    renderPage();
    expect(screen.queryByText("Contracts for AAPL")).toBeNull();
    expect(screen.getByText(/not a US futures contract/)).toBeInTheDocument();
  });
});
