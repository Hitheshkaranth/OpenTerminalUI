import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CryptoWorkspacePage } from "../pages/CryptoWorkspace";

const navigateMock = vi.fn();
const setTickerMock = vi.fn();
const fetchCryptoMarketsMock = vi.fn();
const fetchCryptoMoversMock = vi.fn();
const fetchCryptoDominanceMock = vi.fn();
const fetchCryptoIndexMock = vi.fn();
const fetchCryptoSectorsMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../store/stockStore", () => ({
  useStockStore: (selector: (state: { setTicker: (ticker: string) => void }) => unknown) => selector({ setTicker: setTickerMock }),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchCryptoMarkets: (...args: unknown[]) => fetchCryptoMarketsMock(...args),
    fetchCryptoMovers: (...args: unknown[]) => fetchCryptoMoversMock(...args),
    fetchCryptoDominance: (...args: unknown[]) => fetchCryptoDominanceMock(...args),
    fetchCryptoIndex: (...args: unknown[]) => fetchCryptoIndexMock(...args),
    fetchCryptoSectors: (...args: unknown[]) => fetchCryptoSectorsMock(...args),
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CryptoWorkspacePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Crypto command center", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setTickerMock.mockReset();
    fetchCryptoMarketsMock.mockReset();
    fetchCryptoMoversMock.mockReset();
    fetchCryptoDominanceMock.mockReset();
    fetchCryptoIndexMock.mockReset();
    fetchCryptoSectorsMock.mockReset();

    const rows = [
      { symbol: "BTC-USD", name: "Bitcoin", price: 50000, change_24h: 2.2, volume_24h: 1000, market_cap: 1000000, sector: "L1" },
      { symbol: "ETH-USD", name: "Ethereum", price: 3000, change_24h: 1.1, volume_24h: 900, market_cap: 900000, sector: "L1" },
    ];

    fetchCryptoMarketsMock.mockImplementation(async (query?: { q?: string }) => {
      const q = String(query?.q || "").trim().toLowerCase();
      if (!q) return rows;
      return rows.filter((row) => row.symbol.toLowerCase().includes(q) || row.name.toLowerCase().includes(q));
    });
    fetchCryptoMoversMock.mockResolvedValue([
      { symbol: "BTC-USD", name: "Bitcoin", price: 50000, change_24h: 2.2, volume_24h: 1000, market_cap: 1000000 },
    ]);
    fetchCryptoDominanceMock.mockResolvedValue({
      btc_pct: 52,
      eth_pct: 18,
      others_pct: 30,
      total_market_cap: 10000000,
      ts: "2026-03-05T00:00:00Z",
    });
    fetchCryptoIndexMock.mockResolvedValue({
      index_name: "OTUI Crypto Market Cap Index",
      top_n: 10,
      component_count: 10,
      index_value: 1002.1,
      change_24h: 0.21,
      total_market_cap: 123456,
      ts: "2026-03-05T00:00:00Z",
    });
    fetchCryptoSectorsMock.mockResolvedValue([
      { sector: "L1", change_24h: 1.2, market_cap: 10000, components: [{ symbol: "BTC-USD", name: "Bitcoin", weight: 1 }] },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/crypto/heatmap")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.includes("/v1/crypto/derivatives")) {
          return new Response(
            JSON.stringify({
              items: [],
              totals: {
                open_interest_usd: 0,
                long_liquidations_24h: 0,
                short_liquidations_24h: 0,
                liquidations_24h: 0,
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/crypto/defi")) {
          return new Response(
            JSON.stringify({
              headline: { tvl_usd: 0, dex_volume_24h: 0, lending_borrowed_usd: 0, defi_change_24h: 0 },
              protocols: [],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/crypto/correlation")) {
          return new Response(JSON.stringify({ symbols: [], matrix: [], window: 30 }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters the market board and routes the focus asset into charting", async () => {
    renderPage();

    await waitFor(() => expect(fetchCryptoMarketsMock).toHaveBeenCalled());
    await waitFor(() => {
      const initialCall = fetchCryptoMarketsMock.mock.calls.at(-1)?.[0] as { limit?: number; sortBy?: string; sortOrder?: string };
      expect(initialCall).toEqual(expect.objectContaining({ limit: 120, sortBy: "market_cap", sortOrder: "desc" }));
    });

    fireEvent.change(screen.getByLabelText("Search crypto markets"), { target: { value: "eth" } });

    await waitFor(() => {
      const lastCall = fetchCryptoMarketsMock.mock.calls.at(-1)?.[0] as { q?: string; limit?: number };
      expect(lastCall).toEqual(expect.objectContaining({ q: "eth", limit: 120 }));
    });

    await waitFor(() => expect(screen.getAllByText("Ethereum").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Open Chart" }));

    expect(setTickerMock).toHaveBeenCalledWith("ETH");
    expect(navigateMock).toHaveBeenCalledWith("/equity/chart-workstation");
  });
});
