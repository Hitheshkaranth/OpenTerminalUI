import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HotKeyPanel } from "../components/trading/HotKeyPanel";
import { fetchDepth, fetchPaperOrders, fetchPaperPortfolios, fetchPaperPositions, placePaperOrder } from "../api/client";
const market = vi.hoisted(() => ({ quote: { current_price: 100, currency: "USD" } as Record<string, unknown>, stock: { current_price: 100, currency: "USD" } as Record<string, unknown> }));

vi.mock("../api/client", () => ({ fetchDepth: vi.fn(), fetchPaperOrders: vi.fn(), fetchPaperPortfolios: vi.fn(), fetchPaperPositions: vi.fn(), placePaperOrder: vi.fn() }));
vi.mock("../store/settingsStore", () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ selectedMarket: "NASDAQ" }) }));
vi.mock("../store/stockStore", () => ({ useStockStore: (selector: (state: unknown) => unknown) => selector({ ticker: "AAPL", stock: market.stock }) }));
vi.mock("../realtime/useQuotesStream", () => ({ useQuotesStore: (selector: (state: unknown) => unknown) => selector({ ticksByToken: {} }) }));
vi.mock("../hooks/useStocks", () => ({ useStock: () => ({ data: market.quote }) }));
const toasts: Array<{ message: string; variant: string }> = [];
const listener = (event: Event) => toasts.push((event as CustomEvent).detail);

beforeEach(() => {
  vi.resetAllMocks(); toasts.length = 0; localStorage.clear();
  market.quote = { current_price: 100, currency: "USD" }; market.stock = { current_price: 100, currency: "USD" };
  window.addEventListener("ot:alert-toast", listener);
  vi.mocked(fetchDepth).mockResolvedValue({ bids: [], asks: [] } as never);
  vi.mocked(fetchPaperOrders).mockResolvedValue([]);
  vi.mocked(fetchPaperPositions).mockResolvedValue([]);
  vi.mocked(fetchPaperPortfolios).mockResolvedValue([{ id: "paper", name: "US Paper", initial_capital: 10000, current_cash: 10000, base_currency: "USD" }]);
});
afterEach(() => window.removeEventListener("ot:alert-toast", listener));

async function submit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><HotKeyPanel /></QueryClientProvider>);
  await screen.findByRole("option", { name: "US Paper" });
  const buy = screen.getByRole("button", { name: "BUY (B)" });
  await waitFor(() => expect(buy).toBeEnabled());
  fireEvent.click(buy);
  await waitFor(() => expect(toasts).toHaveLength(1));
}

describe("Hotkey paper-order status feedback", () => {
  it("shows a risk rejection and never claims a purchase", async () => {
    vi.mocked(placePaperOrder).mockResolvedValue({ id: "rejected", symbol: "AAPL", status: "rejected", risk_rejection: "Stop-risk budget exceeded" });
    await submit();
    expect(toasts[0]).toMatchObject({ message: "Stop-risk budget exceeded", variant: "danger" });
    expect(toasts[0].message).not.toMatch(/Bought|Sold/);
  });

  it("shows a pending order as pending without an invented execution price", async () => {
    vi.mocked(placePaperOrder).mockResolvedValue({ id: "pending", symbol: "AAPL", status: "pending", fill_price: null });
    await submit();
    expect(toasts[0].message).toContain("pending");
    expect(toasts[0].message).not.toMatch(/Bought|Sold|100/);
    expect(toasts[0].variant).toBe("info");
  });

  it("reports a confirmed fill using the returned ledger currency and fill price", async () => {
    vi.mocked(placePaperOrder).mockResolvedValue({ id: "filled", symbol: "AAPL", status: "filled", fill_price: 101.25, base_currency: "USD" });
    await submit();
    expect(toasts[0]).toMatchObject({ message: "Bought 1 AAPL @ USD 101.25", variant: "success" });
  });

  it("reports transport validation errors without an unhandled mutation rejection", async () => {
    vi.mocked(placePaperOrder).mockRejectedValue(new Error("A hypothetical stop is required"));
    await submit();
    expect(toasts[0]).toMatchObject({ message: "A hypothetical stop is required", variant: "danger" });
  });
});

describe("Hotkey cash estimates respect currencies", () => {
  async function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><HotKeyPanel /></QueryClientProvider>);
    await screen.findByRole("option", { name: "US Paper" });
  }

  it("disables Max when a native quote and cash ledger use different currencies", async () => {
    vi.mocked(fetchPaperPortfolios).mockResolvedValue([{ id: "paper", name: "US Paper", initial_capital: 10000, current_cash: 10000, base_currency: "INR" }]);
    await show();
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    expect(screen.getByText(/USD quote and INR ledger need a verified FX quote/)).toBeInTheDocument();
  });

  it("disables Max for unknown currency and never treats a base-currency position mark as a native quote", async () => {
    market.quote = {}; market.stock = {};
    vi.mocked(fetchPaperPositions).mockResolvedValue([{ id: "held", symbol: "NASDAQ:AAPL", quantity: 2, avg_entry_price: 999,
      mark_price: 999, unrealized_pnl: 0 }]);
    await show();
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    expect(screen.getByText(/quote and ledger currencies must be known/)).toBeInTheDocument();
    const quoteStrip = screen.getByTestId("hotkey-symbol").parentElement?.nextElementSibling;
    expect(quoteStrip?.textContent).not.toContain("999");
    expect(quoteStrip?.textContent).toContain("BID --");
  });

  it("estimates whole shares with a cost buffer only when currencies match", async () => {
    await show();
    const max = screen.getByRole("button", { name: "Max" });
    await waitFor(() => expect(max).toBeEnabled());
    fireEvent.click(max);
    expect(screen.getByRole("spinbutton", { name: "Quantity" })).toHaveValue(99);
  });
});
