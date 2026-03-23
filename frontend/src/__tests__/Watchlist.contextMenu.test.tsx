/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WatchlistManager } from "../components/watchlist/WatchlistManager";

const fetchWatchlistsMock = vi.fn();
const createWatchlistMock = vi.fn();
const deleteWatchlistMock = vi.fn();
const addWatchlistSymbolsMock = vi.fn();
const removeWatchlistSymbolMock = vi.fn();
const searchSymbolsMock = vi.fn();
const addWatchlistItemMock = vi.fn();

vi.mock("../api/client", () => ({
  fetchWatchlists: (...args: unknown[]) => fetchWatchlistsMock(...args),
  createWatchlist: (...args: unknown[]) => createWatchlistMock(...args),
  deleteWatchlist: (...args: unknown[]) => deleteWatchlistMock(...args),
  addWatchlistSymbols: (...args: unknown[]) => addWatchlistSymbolsMock(...args),
  removeWatchlistSymbol: (...args: unknown[]) => removeWatchlistSymbolMock(...args),
  searchSymbols: (...args: unknown[]) => searchSymbolsMock(...args),
  addWatchlistItem: (...args: unknown[]) => addWatchlistItemMock(...args),
}));

vi.mock("../realtime/useQuotesStream", () => ({
  useQuotesStream: () => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    connectionState: "LIVE",
  }),
  useQuotesStore: (selector: (state: { ticksByToken: Record<string, { ltp?: number; change_pct?: number; volume?: number }> }) => unknown) =>
    selector({
      ticksByToken: {
        "NSE:AAPL": {
          ltp: 123.45,
          change_pct: 1.25,
          volume: 1200,
        },
      },
    }),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: (selector: (state: { selectedMarket: string }) => unknown) =>
    selector({
      selectedMarket: "NSE",
    }),
}));

vi.mock("../hooks/useDisplayCurrency", () => ({
  useDisplayCurrency: () => ({
    formatDisplayMoney: (value: number | null | undefined) => String(value ?? "--"),
  }),
}));

describe("Watchlist symbol context menu", () => {
  beforeEach(() => {
    fetchWatchlistsMock.mockResolvedValue([
      {
        id: "wl-1",
        name: "Default",
        symbols: ["AAPL"],
      },
    ]);
    createWatchlistMock.mockResolvedValue({ id: "wl-2", name: "Growth" });
    deleteWatchlistMock.mockResolvedValue(undefined);
    addWatchlistSymbolsMock.mockResolvedValue(undefined);
    removeWatchlistSymbolMock.mockResolvedValue(undefined);
    searchSymbolsMock.mockResolvedValue([]);
    addWatchlistItemMock.mockResolvedValue(undefined);
  });

  it("opens the shared menu on right-click and supports watchlist removal", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WatchlistManager />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("AAPL");
    fireEvent.contextMenu(screen.getByText("AAPL"), { clientX: 80, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(menu).toBeTruthy();
    expect(within(menu).getByText("View Chart")).toBeTruthy();
    expect(within(menu).getByText("Security Hub")).toBeTruthy();
    expect(within(menu).getByText("Add to Watchlist")).toBeTruthy();
    expect(within(menu).getByText("Create Alert")).toBeTruthy();
    expect(within(menu).getByText("Compare")).toBeTruthy();
    expect(within(menu).getByText("Copy Ticker")).toBeTruthy();
    expect(within(menu).getByText("Remove from Watchlist")).toBeTruthy();

    fireEvent.click(within(menu).getByText("Remove from Watchlist"));

    await waitFor(() => {
      expect(removeWatchlistSymbolMock).toHaveBeenCalledWith("wl-1", "AAPL");
    });
  });
});
