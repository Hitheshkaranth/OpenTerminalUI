/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SymbolContextMenu } from "../components/common/SymbolContextMenu";

vi.mock("../api/client", () => ({ addWatchlistItem: vi.fn(async () => undefined) }));

function Location() {
  const location = useLocation();
  return <output data-testid="menu-location">{location.pathname}{location.search}</output>;
}

function showMenu(symbol: string, assetClass?: string) {
  const remove = vi.fn();
  render(<MemoryRouter initialEntries={["/equity/watchlist?name=Mixed"]}>
    <SymbolContextMenu open symbol={symbol} market="NSE" assetClass={assetClass} anchor={{ x: 80, y: 100 }} onClose={vi.fn()}
      customActions={[{ id: "remove", label: "Remove from Watchlist", onAction: remove }]} />
    <Location />
  </MemoryRouter>);
  return remove;
}

describe("asset-aware symbol context actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps existing equity actions and custom removal", async () => {
    const remove = showMenu("AAPL");
    const menu = screen.getByRole("menu");
    for (const label of ["View Chart", "Security Hub", "Add to Watchlist", "Create Alert", "Paper Buy", "Paper Sell", "Compare", "Copy Ticker"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${label}(?:\\s|$)`) })).toBeInTheDocument();
    }
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove from Watchlist" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("AAPL"));
  });

  it.each([
    ["GC=F", "Open commodity", "/equity/commodities?symbol=GC%3DF"],
    ["BTC-USD", "Open crypto", "/equity/crypto?symbol=BTC-USD"],
    ["EURUSD=X", "Open forex", "/equity/forex?pair=EURUSD"],
    ["NIFTY", "Open futures", "/fno/futures?symbol=NIFTY"],
    ["BANKNIFTY", "Open futures", "/fno/futures?symbol=BANKNIFTY"],
  ])("routes %s to its workspace without stock-only actions", async (symbol, label, path) => {
    showMenu(symbol);
    const menu = screen.getByRole("menu");
    for (const unavailable of ["Security Hub", "Create Alert", "Paper Buy", "Paper Sell", "Compare"]) {
      expect(within(menu).queryByRole("menuitem", { name: unavailable, exact: true })).not.toBeInTheDocument();
    }
    expect(within(menu).getByRole("menuitem", { name: "Remove from Watchlist" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: new RegExp(`^${label}(?:\\s|$)`) }));
    await waitFor(() => expect(screen.getByTestId("menu-location")).toHaveTextContent(path));
  });

  it.each([["^GSPC", undefined], ["ESZ26", "futures"]])("does not expose equity orders for explicit non-equity %s", (symbol, assetClass) => {
    showMenu(symbol, assetClass);
    expect(screen.queryByRole("menuitem", { name: "Paper Buy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Security Hub" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: symbol === "^GSPC" ? /^Open index chart(?:\s|$)/ : /^View Chart(?:\s|$)/ })).toBeInTheDocument();
  });
});
