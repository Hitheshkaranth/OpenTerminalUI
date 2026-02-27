import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SecurityHubPage } from "../pages/SecurityHub";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";

vi.mock("../hooks/useStocks", () => ({
  useStock: () => ({ data: { company_name: "Apple Inc.", exchange: "NASDAQ", current_price: 200 } }),
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
}));

vi.mock("../components/chart/TradingChart", () => ({
  TradingChart: () => <div>Mock Chart</div>,
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
      <MemoryRouter initialEntries={[route]}>
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

describe("SecurityHub tab URL sync", () => {
  beforeEach(() => {
    useSettingsStore.setState({ selectedMarket: "NASDAQ" } as Partial<ReturnType<typeof useSettingsStore.getState>> as any);
    useStockStore.setState({
      ticker: "AAPL",
      setTicker: vi.fn(),
      load: vi.fn(async () => undefined),
    } as Partial<ReturnType<typeof useStockStore.getState>> as any);
  });

  it("hydrates active tab from URL and writes tab to search params on click", async () => {
    renderHub("/equity/security/AAPL?tab=news");

    const newsTab = await screen.findByRole("tab", { name: /news/i });
    expect(newsTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: /financials/i }));
    expect(screen.getByTestId("location-search").textContent).toContain("tab=financials");
  });
});
