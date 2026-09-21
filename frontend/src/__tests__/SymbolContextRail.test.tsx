import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStockStore } from "../store/stockStore";
import { useSettingsStore } from "../store/settingsStore";
import { SymbolContextRail } from "../components/layout/SymbolContextRail";


// Event dates relative to the local calendar so the test doesn't expire at midnight.
function localIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

vi.mock("../store/settingsStore", () => {
  const useSettingsStore = vi.fn((selector: (state: { selectedMarket: string }) => string) => {
    const state = { selectedMarket: "NSE" };
    return selector(state);
  });
  return { useSettingsStore };
});

vi.mock("../api/portfolio", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPaperPortfolios: vi.fn().mockResolvedValue([
      { id: "p1", name: "Test Portfolio", initial_capital: 100000, current_cash: 80000, is_active: true, created_at: "2026-01-01T00:00:00Z" },
    ]),
    fetchPaperPositions: vi.fn().mockResolvedValue([{ id: "pos1", symbol: "NSE:RELIANCE", quantity: 10, avg_entry_price: 1200, mark_price: 1246.4, unrealized_pnl: 464 }]),
  };
});

vi.mock("../api/alerts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchAlertsFiltered: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../api/eventsHub", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useUpcomingEvents: vi.fn().mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        as_of: "2026-09-21T00:00:00Z",
        days: 45,
        symbols: ["RELIANCE"],
        items: [
          {
            id: "ev1",
            type: "earnings" as const,
            symbol: "RELIANCE",
            title: "Q2 FY26 earnings",
            date: localIso(3),
            time: "amc",
            impact: "high" as const,
            source: "earnings_service",
            detail: {},
          },
          {
            id: "ev2",
            type: "expiry" as const,
            symbol: "RELIANCE",
            title: "Monthly expiry",
            date: localIso(0),
            time: null,
            impact: "medium" as const,
            source: "fno",
            detail: {},
          },
        ],
        errors: [],
      },
    }),
  };
});

vi.mock("../api/client", async () => ({
  addWatchlistItem: vi.fn().mockResolvedValue(undefined),
}));

function TestProvider({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/equity/stocks/RELIANCE"]}>
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SymbolContextRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStockStore.setState({
      ticker: "RELIANCE",
      stock: {
        ticker: "RELIANCE",
        symbol: "RELIANCE.NS",
        current_price: 1246.4,
        change_pct: 1.63,
        exchange: "NSE",
        provenance: { source: "yahoo", quality: "delayed", as_of: null, latency_ms: null, note: null },
      } as any,
      interval: "1d",
      range: "1y",
      chart: null,
      loading: false,
      error: null,
      setTicker: () => {},
      setInterval: () => {},
      setRange: () => {},
      load: async () => {},
    } as any);
  });

  it("renders price text", async () => {
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("1,246.40")).toBeInTheDocument();
    });
  });

  it('renders "DELAYED" provenance chip', async () => {
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("DELAYED")).toBeInTheDocument();
    });
  });

  it("renders position qty", async () => {
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Qty 10")).toBeInTheDocument();
    });
  });

  it('renders "No alerts for RELIANCE"', async () => {
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("No alerts for RELIANCE")).toBeInTheDocument();
    });
  });

  it("renders event date labels correctly", async () => {
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("in 3 d")).toBeInTheDocument();
      expect(screen.getByText("Today")).toBeInTheDocument();
    });
  });

  it("dispatches ot:hotkey-panel:open with Paper Buy", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Paper Buy")).toBeInTheDocument();
    });
    const buyButton = screen.getByText("Paper Buy");
    act(() => {
      buyButton.click();
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("ot:hotkey-panel:open");
    expect(event.detail).toEqual({ symbol: "RELIANCE", side: "buy" });
    dispatchSpy.mockRestore();
  });

  it("dispatches ot:hotkey-panel:open with Paper Sell", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(
      <TestProvider>
        <SymbolContextRail />
      </TestProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Paper Sell")).toBeInTheDocument();
    });
    const sellButton = screen.getByText("Paper Sell");
    act(() => {
      sellButton.click();
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("ot:hotkey-panel:open");
    expect(event.detail).toEqual({ symbol: "RELIANCE", side: "sell" });
    dispatchSpy.mockRestore();
  });
});