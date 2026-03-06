import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CryptoWorkspacePage } from "../pages/CryptoWorkspace";

const navigateMock = vi.fn();
const setTickerMock = vi.fn();

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

vi.mock("../api/client", () => ({
  fetchCryptoMarkets: vi.fn(async () => [
    { symbol: "BTC-USD", name: "Bitcoin", price: 50000, change_24h: 2.2, volume_24h: 1000, market_cap: 1000000, sector: "L1" },
    { symbol: "ETH-USD", name: "Ethereum", price: 3000, change_24h: 1.1, volume_24h: 900, market_cap: 900000, sector: "L1" },
  ]),
  fetchCryptoMovers: vi.fn(async () => [{ symbol: "BTC-USD", name: "Bitcoin", price: 50000, change_24h: 2.2, volume_24h: 1000, market_cap: 1000000 }]),
  fetchCryptoDominance: vi.fn(async () => ({ btc_pct: 52, eth_pct: 18, others_pct: 30, total_market_cap: 10000000, ts: "2026-03-05T00:00:00Z" })),
  fetchCryptoIndex: vi.fn(async () => ({
    index_name: "OTUI Crypto Market Cap Index",
    top_n: 10,
    component_count: 10,
    index_value: 1002.1,
    change_24h: 0.21,
    total_market_cap: 123456,
    ts: "2026-03-05T00:00:00Z",
  })),
  fetchCryptoSectors: vi.fn(async () => [
    { sector: "L1", change_24h: 1.2, market_cap: 10000, components: [{ symbol: "BTC-USD", name: "Bitcoin", weight: 1 }] },
  ]),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CryptoWorkspacePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("CryptoWorkspace advanced tabs", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setTickerMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/crypto/heatmap")) {
          return new Response(
            JSON.stringify({
              items: [{ symbol: "BTC-USD", name: "Bitcoin", sector: "L1", change_24h: 2.2, market_cap: 1000000, depth_imbalance: 0.14, bucket: "bullish" }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/crypto/derivatives")) {
          return new Response(
            JSON.stringify({
              items: [{ symbol: "BTC-USD", funding_rate_8h: 0.0003, open_interest_usd: 5200000, long_liquidations_24h: 100000, short_liquidations_24h: 120000, liquidations_24h: 220000 }],
              totals: { open_interest_usd: 5200000, long_liquidations_24h: 100000, short_liquidations_24h: 120000, liquidations_24h: 220000 },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/crypto/defi")) {
          return new Response(
            JSON.stringify({
              headline: { tvl_usd: 2000000, dex_volume_24h: 350000, lending_borrowed_usd: 250000, defi_change_24h: 1.8 },
              protocols: [{ symbol: "UNI-USD", name: "Uniswap", change_24h: 1.4, dominance_pct: 54.2, tvl_proxy_usd: 900000 }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/crypto/correlation")) {
          return new Response(
            JSON.stringify({
              symbols: ["BTC-USD", "ETH-USD"],
              matrix: [[1, 0.87], [0.87, 1]],
              window: 30,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders heatmap, derivatives, defi, and correlation tabs", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "heatmap" }));
    await waitFor(() => expect(screen.getByTestId("crypto-heatmap-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Depth 14.0%")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "derivatives" }));
    await waitFor(() => expect(screen.getByTestId("crypto-derivatives-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("BTC-USD").length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole("button", { name: "defi" }));
    await waitFor(() => expect(screen.getByTestId("crypto-defi-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Uniswap")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "correlation" }));
    await waitFor(() => expect(screen.getByTestId("crypto-correlation-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("corr-cell-0-1")).toHaveTextContent("0.87"));
  });
});
