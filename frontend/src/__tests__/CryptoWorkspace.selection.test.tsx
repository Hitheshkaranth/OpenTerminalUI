/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CryptoWorkspacePage } from "../pages/CryptoWorkspace";

const markets = vi.hoisted(() => vi.fn());
const rows = [
  { symbol: "BTC-USD", name: "Bitcoin", price: 50000, change_24h: 2, volume_24h: 1000, market_cap: 1000000, sector: "L1" },
  { symbol: "ETH-USD", name: "Ethereum", price: 3000, change_24h: 1, volume_24h: 900, market_cap: 900000, sector: "L1" },
];
vi.mock("../store/stockStore", () => ({ useStockStore: (selector: (state: { setTicker: () => void }) => unknown) => selector({ setTicker: vi.fn() }) }));
vi.mock("../api/client", () => ({
  fetchCryptoMarkets: markets,
  fetchCryptoMovers: vi.fn(async () => []),
  fetchCryptoDominance: vi.fn(async () => ({ btc_pct: 52, eth_pct: 18, others_pct: 30 })),
  fetchCryptoIndex: vi.fn(async () => ({ index_value: 1000, change_24h: 1, component_count: 2 })),
  fetchCryptoSectors: vi.fn(async () => []),
}));

function RouterState() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="crypto-location">{location.search}</output><button onClick={() => navigate("/equity/crypto?symbol=BTC-USD&source=watchlist")}>Switch request to BTC</button></>;
}
function show(initial: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={[initial]}><QueryClientProvider client={client}><CryptoWorkspacePage /><RouterState /></QueryClientProvider></MemoryRouter>);
  return client;
}
function focusPanel() {
  return within(screen.getByText("Focus Asset", { exact: true }).closest("section")!);
}

describe("crypto requested-instrument continuity", () => {
  beforeEach(() => {
    markets.mockReset();
    markets.mockResolvedValue(rows);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], symbols: [], matrix: [], headline: {}, protocols: [], totals: {} }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps an incoming ETH selection through asynchronous market loading", async () => {
    let resolve!: (value: typeof rows) => void;
    markets.mockReturnValue(new Promise<typeof rows>((done) => { resolve = done; }));
    show("/equity/crypto?symbol=ETH-USD&source=watchlist");
    expect(focusPanel().getByText(/Loading market data for ETH-USD/)).toBeInTheDocument();
    expect(focusPanel().queryByText("BTC-USD", { exact: true })).not.toBeInTheDocument();
    await act(async () => { resolve(rows); });
    expect(await focusPanel().findByText("ETH-USD", { exact: true })).toBeInTheDocument();
    expect(screen.getByTestId("crypto-location")).toHaveTextContent("symbol=ETH-USD&source=watchlist");
  });

  it("preserves an unsupported requested pair instead of substituting BTC", async () => {
    show("/equity/crypto?symbol=DOGE-USDT&source=watchlist");
    expect(await focusPanel().findByText(/DOGE-USDT is not available in the current market board/)).toBeInTheDocument();
    expect(focusPanel().queryByText("BTC-USD", { exact: true })).not.toBeInTheDocument();
    expect(focusPanel().queryByRole("button", { name: "Open Chart" })).not.toBeInTheDocument();
    expect(screen.getByTestId("crypto-location")).toHaveTextContent("symbol=DOGE-USDT");
  });

  it("updates only the symbol query on user selection and responds to router navigation", async () => {
    show("/equity/crypto?symbol=BTC-USD&source=watchlist");
    await focusPanel().findByText("BTC-USD", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "ETH-USD", exact: true }));
    expect(await focusPanel().findByText("ETH-USD", { exact: true })).toBeInTheDocument();
    expect(screen.getByTestId("crypto-location")).toHaveTextContent("symbol=ETH-USD&source=watchlist");
    fireEvent.click(screen.getByRole("button", { name: "Switch request to BTC" }));
    await waitFor(() => expect(focusPanel().getByText("BTC-USD", { exact: true })).toBeInTheDocument());
  });

  it("does not select a different asset when a filter excludes the requested asset", async () => {
    markets.mockImplementation(async (query?: { q?: string }) => query?.q === "btc" ? [rows[0]] : rows);
    show("/equity/crypto?symbol=ETH-USD");
    await focusPanel().findByText("ETH-USD", { exact: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Search crypto markets" }), { target: { value: "btc" } });
    expect(await focusPanel().findByText(/ETH-USD is not available in the current market board/)).toBeInTheDocument();
    expect(focusPanel().queryByText("BTC-USD", { exact: true })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search crypto markets" }), { target: { value: "" } });
    expect(await focusPanel().findByText("ETH-USD", { exact: true })).toBeInTheDocument();
  });
});
