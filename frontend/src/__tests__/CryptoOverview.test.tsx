import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { CryptoOverview } from "../components/crypto/CryptoOverview";

const fetchCryptoMarketsMock = vi.fn();
const fetchCryptoCoinDetailMock = vi.fn();

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchCryptoMarkets: (...args: unknown[]) => fetchCryptoMarketsMock(...args),
    fetchCryptoCoinDetail: (...args: unknown[]) => fetchCryptoCoinDetailMock(...args),
  };
});

describe("CryptoOverview", () => {
  it("renders overview rows and updates coin-detail panel on selection", async () => {
    fetchCryptoMarketsMock.mockResolvedValue([
      { symbol: "BTC-USD", name: "Bitcoin", price: 50000, change_24h: 2.2, volume_24h: 1000, market_cap: 50000000, sector: "L1" },
      { symbol: "ETH-USD", name: "Ethereum", price: 3000, change_24h: -1.1, volume_24h: 800, market_cap: 2400000, sector: "L1" },
    ]);
    fetchCryptoCoinDetailMock.mockImplementation(async (symbol: string) => {
      if (symbol === "ETH-USD") {
        return {
          symbol: "ETH-USD",
          name: "Ethereum",
          sector: "L1",
          price: 3000,
          change_24h: -1.1,
          volume_24h: 800,
          market_cap: 2400000,
          high_24h: 3200,
          low_24h: 2800,
          sparkline: [1, 2, 3],
          ts: "2026-03-05T00:00:00Z",
        };
      }
      return {
        symbol: "BTC-USD",
        name: "Bitcoin",
        sector: "L1",
        price: 50000,
        change_24h: 2.2,
        volume_24h: 1000,
        market_cap: 50000000,
        high_24h: 51000,
        low_24h: 49000,
        sparkline: [1, 2, 3, 4],
        ts: "2026-03-05T00:00:00Z",
      };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <CryptoOverview />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchCryptoMarketsMock).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText("BTC-USD")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "ETH-USD" })).toBeInTheDocument();
    await waitFor(() => expect(fetchCryptoCoinDetailMock).toHaveBeenCalledWith("BTC-USD"));

    fireEvent.click(screen.getByRole("button", { name: "ETH-USD" }));
    await waitFor(() => expect(fetchCryptoCoinDetailMock).toHaveBeenCalledWith("ETH-USD"));
    expect(await screen.findByText("Sparkline points: 3")).toBeInTheDocument();
  });
});
