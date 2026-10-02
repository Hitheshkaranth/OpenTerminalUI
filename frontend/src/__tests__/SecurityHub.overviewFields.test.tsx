import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SecurityHubPage } from "../pages/SecurityHub";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";

vi.mock("../hooks/useStocks", () => ({
  useStock: () => ({
    data: {
      company_name: "Apple Inc.",
      exchange: "NASDAQ",
      current_price: 328.64,
      pe: null,
      div_yield_pct: 0.32,
      high_52w: 345.34,
      low_52w: 243.42,
      previous_close: 333.02,
      classification: { currency: "USD" },
    },
  }),
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

// jsdom has no canvas; lightweight-charts cannot render here.
vi.mock("../components/security/PriceOverviewChart", () => ({
  PriceOverviewChart: () => <div>Mock Price Chart</div>,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderHub(route: string) {
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
            element={
              <>
                <SecurityHubPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SecurityHub overview fields", () => {
  beforeEach(() => {
    useSettingsStore.setState({ selectedMarket: "NASDAQ" } as Partial<ReturnType<typeof useSettingsStore.getState>> as any);
    useStockStore.setState({
      ticker: "AAPL",
      setTicker: vi.fn(),
      load: vi.fn(async () => undefined),
    } as Partial<ReturnType<typeof useStockStore.getState>> as any);
  });

  it("maps the snapshot API fields and renders missing values as '-' rather than 0", async () => {
    renderHub("/equity/security/AAPL?tab=overview");
    const cell = async (label: string) => (await screen.findByText(label)).parentElement?.textContent ?? "";

    expect(await cell("Div Yield")).toContain("0.32%");
    expect(await cell("Div Yield")).not.toContain("+");
    expect(await cell("52W Range")).toContain("243.42 - 345.34");
    expect(await cell("Prev Close")).toContain("333.02");
    expect(await cell("P/E")).not.toMatch(/\b0\b/);
    expect(screen.getByText("Currency:").parentElement?.textContent).toContain("USD");
  });
});
