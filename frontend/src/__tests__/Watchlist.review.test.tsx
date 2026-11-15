/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContextRef } from "../contexts/AuthContext";
import { WatchlistManager } from "../components/watchlist/WatchlistManager";
import { reviewInstrument } from "../components/watchlist/reviewInstrument";

const mocks = vi.hoisted(() => ({ lists: vi.fn(), quotes: vi.fn(), remove: vi.fn(), ticks: {} as Record<string, unknown>, market: "NASDAQ" }));
vi.mock("../api/client", () => ({ fetchWatchlists: (...a: unknown[]) => mocks.lists(...a), createWatchlist: vi.fn(), deleteWatchlist: vi.fn(), addWatchlistSymbols: vi.fn(), removeWatchlistSymbol: (...a: unknown[]) => mocks.remove(...a), searchSymbols: vi.fn() }));
vi.mock("../api/marketData", () => ({ fetchQuotesBatch: (...a: unknown[]) => mocks.quotes(...a) }));
vi.mock("../realtime/useQuotesStream", () => ({ useQuotesStream: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn(), connectionState: "connected" }), useQuotesStore: (select: (s: unknown) => unknown) => select({ ticksByToken: mocks.ticks }) }));
vi.mock("../store/settingsStore", () => ({ useSettingsStore: (select: (s: unknown) => unknown) => select({ selectedMarket: mocks.market }) }));
vi.mock("../components/security/PriceOverviewChart", () => ({ PriceOverviewChart: ({ symbol, market }: { symbol: string; market: string }) => <div data-testid="review-chart">{market}:{symbol}</div> }));
vi.mock("../components/watchlist/InstrumentNotesPanel", () => ({ InstrumentNotesPanel: ({ symbol }: { symbol: string }) => <div data-testid="review-notes">Notes for {symbol}</div> }));
vi.mock("../components/common/SymbolContextMenu", () => ({ SymbolContextMenu: () => null }));

function Location() { return <output data-testid="review-location">{useLocation().pathname}{useLocation().search}</output>; }
function mount(path = "/equity/watchlist?view=review", accountId = "review-test") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<AuthContextRef.Provider value={{ user: { id: accountId, email: "test@example.test", role: "trader" } } as any}><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><WatchlistManager /><Location /></MemoryRouter></QueryClientProvider></AuthContextRef.Provider>);
  return client;
}

describe("watchlist linked review desk", () => {
  beforeEach(() => {
    localStorage.clear(); mocks.market = "NASDAQ"; mocks.remove.mockReset(); mocks.ticks = { "NASDAQ:AAPL": { ltp: 0, change_pct: 0, market: "NASDAQ", ts: "2026-11-13T10:00:00Z" } };
    mocks.lists.mockResolvedValue([{ id: "one", name: "Shortlist", symbols: ["AAPL", "GC=F", "NIFTY", "RELIANCE.NS"] }, { id: "two", name: "Other", symbols: ["TCS.NS"] }]);
    mocks.quotes.mockImplementation(async (symbols: string[]) => ({ quotes: symbols.map(symbol => ({ symbol, last: 125, changePct: 1.5, volume: 0, ts: "2026-11-14T10:00:00Z" })) }));
  });

  it("updates chart, notes and asset actions on row focus without leaving the list", async () => {
    mount();
    await screen.findByRole("complementary", { name: "Review AAPL" });
    expect(screen.getByTestId("review-chart")).toHaveTextContent("NASDAQ:AAPL");
    expect(within(screen.getByRole("complementary", { name: "Review AAPL" })).getByText("125.00")).toBeInTheDocument();
    const row = document.querySelector<HTMLTableRowElement>('[data-watchlist-symbol="AAPL"]')!;
    fireEvent.keyDown(row, { key: "ArrowDown" });
    await screen.findByRole("complementary", { name: "Review GC=F" });
    expect(screen.getByTestId("review-notes")).toHaveTextContent("Notes for GC=F");
    expect(screen.getByRole("link", { name: "Open commodity" })).toHaveAttribute("href", "/equity/commodities?symbol=GC%3DF");
    expect(screen.queryByRole("link", { name: "Manage alerts" })).not.toBeInTheDocument();
    expect(screen.getByTestId("review-location")).toHaveTextContent("/equity/watchlist?view=review&symbol=GC%3DF");
    fireEvent.click(screen.getByRole("button", { name: "Review next symbol" }));
    expect(screen.getByTestId("review-chart")).toHaveTextContent("NSE:^NSEI");
    expect(screen.getByRole("link", { name: "Open futures" })).toHaveAttribute("href", "/fno/futures?symbol=NIFTY");
  });

  it("keeps selection stable on sorting and clears a stale preview when filters hide it", async () => {
    mount("/equity/watchlist?view=review&symbol=NIFTY");
    await screen.findByRole("complementary", { name: "Review NIFTY" });
    fireEvent.change(screen.getByLabelText("Sort rows"), { target: { value: "symbol" } });
    expect(screen.getByRole("complementary", { name: "Review NIFTY" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter watchlist"), { target: { value: "GC" } });
    expect(screen.getByRole("complementary", { name: "Review GC=F" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter watchlist"), { target: { value: "NOTFOUND" } });
    expect(screen.queryByTestId("review-chart")).not.toBeInTheDocument();
    expect(screen.getByText(/No symbols match these filters/)).toBeInTheDocument();
  });

  it("switches away from a named URL watchlist and preserves unrelated parameters", async () => {
    mount("/equity/watchlist?view=review&name=Shortlist&symbol=AAPL&layout=compact");
    await screen.findByRole("complementary", { name: "Review AAPL" });
    fireEvent.click(screen.getByRole("button", { name: /Other 1 items/ }));
    await screen.findByRole("complementary", { name: "Review TCS.NS" });
    expect(screen.getByTestId("review-location")).toHaveTextContent("layout=compact");
    expect(screen.getByTestId("review-location").textContent).not.toContain("name=Shortlist");
    expect(screen.getByTestId("review-chart")).toHaveTextContent("NSE:TCS.NS");
  });

  it("tries the alternate market after a failed primary request and does not use a zero tick", async () => {
    mocks.market = "NSE";
    mocks.quotes.mockImplementation(async (symbols: string[], market: string) => {
      if (market === "NSE") throw new Error("Unavailable");
      return { quotes: symbols.map(symbol => ({ symbol, last: 125, changePct: 1.5, ts: "2026-11-14T10:00:00Z" })) };
    });
    mount(); await screen.findByRole("complementary", { name: "Review AAPL" });
    await waitFor(() => expect(screen.getByTestId("review-chart")).toHaveTextContent("NASDAQ:AAPL"));
    expect(mocks.quotes).toHaveBeenCalledWith(expect.any(Array), "NASDAQ");
  });

  it.each([
    { market: "NASDAQ", ts: "2026-11-12T10:00:00Z" },
    { market: "NASDAQ" },
    { market: "NSE", ts: "2026-11-15T10:00:00Z" },
  ])("keeps observed REST price over stale, undated or wrong-market ticks: %j", tick => {
    mocks.ticks = { "NASDAQ:AAPL": { ltp: 999, change_pct: 99, ...tick } };
    mount();
    return screen.findByRole("complementary", { name: "Review AAPL" }).then(async panel => {
      await within(panel).findByText("125.00");
      expect(within(panel).queryByText("999.00")).not.toBeInTheDocument();
    });
  });

  it("selects a visible remaining member after deleting the selected row", async () => {
    mocks.remove.mockImplementation(async () => { mocks.lists.mockResolvedValue([{ id: "one", name: "Shortlist", symbols: ["GC=F"] }]); });
    mount(); await screen.findByRole("complementary", { name: "Review AAPL" });
    fireEvent.click(screen.getByRole("button", { name: "Remove AAPL from watchlist" }));
    await screen.findByRole("complementary", { name: "Review GC=F" });
    expect(screen.queryByRole("complementary", { name: "Review AAPL" })).not.toBeInTheDocument();
  });

  it("does not reuse cached private watchlists when the mounted account changes", async () => {
    mocks.lists.mockResolvedValueOnce([{ id: "private-a", name: "Private Alpha", symbols: ["AAPL"] }]).mockResolvedValueOnce([{ id: "private-b", name: "Private Beta", symbols: ["GC=F"] }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (id: string) => <AuthContextRef.Provider value={{ user: { id, email: "test@example.test", role: "trader" } } as any}><QueryClientProvider client={client}><MemoryRouter initialEntries={["/equity/watchlist?view=review"]}><WatchlistManager /></MemoryRouter></QueryClientProvider></AuthContextRef.Provider>;
    const rendered = render(tree("alpha"));
    await screen.findByRole("complementary", { name: "Review AAPL" });
    rendered.rerender(tree("beta"));
    await screen.findByRole("complementary", { name: "Review GC=F" });
    expect(screen.queryByText("Private Alpha")).not.toBeInTheDocument();
  });

  it("filters the shortlist by the saved review status", async () => {
    localStorage.setItem("ot:instrument-review:v1:review-test:AAPL", JSON.stringify({ version: 1, status: "researching", updatedAt: "2026-11-15T00:00:00Z" }));
    mount(); await screen.findByRole("complementary", { name: "Review AAPL" });
    fireEvent.change(screen.getByLabelText("Filter by review status"), { target: { value: "researching" } });
    expect(document.querySelectorAll("tr[data-watchlist-symbol]")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Filter by review status"), { target: { value: "archived" } });
    expect(screen.queryByTestId("review-chart")).not.toBeInTheDocument();
  });

  it.each([false, true])("distinguishes missing snapshot change from a genuine zero (available=%s)", async available => {
    mocks.quotes.mockImplementation(async (symbols: string[]) => ({ quotes: symbols.map(symbol => ({ symbol, last: 125, changePct: 0, change_available: available, volume: 1, ts: "2026-11-15T00:00:00Z" })) }));
    mount(); const panel = await screen.findByRole("complementary", { name: "Review AAPL" });
    await waitFor(() => expect(within(panel).getByText(available ? "0.00%" : "Unavailable", { exact: true })).toBeInTheDocument());
  });

  it("scopes private watchlist queries by account", async () => {
    const client = mount(); await screen.findByRole("complementary", { name: "Review AAPL" });
    expect(client.getQueryData(["watchlists", "review-test"])).toBeDefined();
    expect(client.getQueryData(["watchlists"])).toBeUndefined();
  });
});

it.each([
  ["AAPL", "NASDAQ", "equity", "AAPL"], ["RELIANCE.NS", "NASDAQ", "equity", "RELIANCE.NS"],
  ["GC=F", "NSE", "commodity", "GC=F"], ["BTC-USD", "NSE", "crypto", "BTC-USD"],
  ["EURUSD=X", "NSE", "forex", "EURUSD=X"], ["NIFTY", "NASDAQ", "index", "^NSEI"],
  ["BANKNIFTY", "NASDAQ", "index", "^NSEBANK"], ["^GSPC", "NSE", "index", "^GSPC"],
])("preserves %s instrument class and chart identity", (symbol, market, kind, chart) => {
  const resolved = reviewInstrument(symbol, market);
  expect(resolved.kind).toBe(kind); expect(resolved.chartSymbol).toBe(chart);
});

it("does not substitute an unsupported USDT chart with USD history", () => { expect(reviewInstrument("BTC-USDT", "NSE").chartAvailable).toBe(false); });
