import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecurityHubPage } from "../pages/SecurityHub";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";

const originalUseStock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/useStocks", async (importOriginal) => ({
  useStock: (...args: unknown[]) => originalUseStock(...args),
  useStockHistory: () => ({ data: { data: [] } }),
  useFinancials: () => ({ data: { rows: [] } }),
  usePeerComparison: () => ({ data: { peers: [] } }),
  useAnalystConsensus: () => ({ data: {} }),
}));

vi.mock("../api/client", () => ({
  fetchNewsByTicker: vi.fn(async () => []),
  fetchSecurityHubOwnership: vi.fn(async () => ({})),
  fetchSecurityHubEstimates: vi.fn(async () => ({})),
  fetchSecurityHubEsg: vi.fn(async () => ({})),
  fetchInsiderStock: vi.fn(async () => ({ trades: [], summary: { total_buys: 0, total_sells: 0, net_value: 0, insider_count: 0 } })),
}));

vi.mock("../components/chart/TradingChart", () => ({
  TradingChart: () => <div>Mock Chart</div>,
}));

function renderHub(route = "/equity/security/RELIANCE") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[route]}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route
            path="/equity/security/:ticker"
            element={<SecurityHubPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("market follows symbol — SecurityHub", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      selectedCountry: "US" as any,
      selectedMarket: "NASDAQ" as any,
    } as Partial<ReturnType<typeof useSettingsStore.getState>> as any);
    useStockStore.setState({
      ticker: "RELIANCE",
      exchange: null,
    } as Partial<ReturnType<typeof useStockStore.getState>> as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches market to NSE and country to IN when snapshot exchange is NSE", async () => {
    originalUseStock.mockReturnValue({
      data: { ticker: "RELIANCE", symbol: "RELIANCE.NS", exchange: "NSE", current_price: 1 },
    });

    renderHub("/equity/security/RELIANCE");

    await waitFor(() => {
      expect(useSettingsStore.getState().selectedMarket).toBe("NSE");
    });

    expect(useSettingsStore.getState().selectedMarket).toBe("NSE");
    expect(useSettingsStore.getState().selectedCountry).toBe("IN");
    expect(useStockStore.getState().exchange).toBe("NSE");
  });

  it("does nothing when snapshot exchange matches current market (NASDAQ)", async () => {
    originalUseStock.mockReturnValue({
      data: { ticker: "AAPL", symbol: "AAPL.NS", exchange: "NASDAQ", current_price: 150 },
    });

    const setMarketSpy = vi.fn();
    useSettingsStore.setState({
      selectedCountry: "US" as any,
      selectedMarket: "NASDAQ" as any,
      setSelectedMarket: setMarketSpy,
    } as Partial<ReturnType<typeof useSettingsStore.getState>> as any);

    renderHub("/equity/security/AAPL");

    await waitFor(() => {
      expect(useSettingsStore.getState().selectedMarket).toBe("NASDAQ");
    });

    expect(setMarketSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().selectedMarket).toBe("NASDAQ");
    expect(useSettingsStore.getState().selectedCountry).toBe("US");
  });
});