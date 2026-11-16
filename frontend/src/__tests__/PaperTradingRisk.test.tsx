import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperTradingPage } from "../pages/PaperTrading";
import { cancelPaperOrder, createPaperPortfolio, fetchPaperOrders, fetchPaperPerformance, fetchPaperPortfolios,
  fetchPaperPositions, fetchPaperTrades, placePaperOrder } from "../api/client";

vi.mock("../api/client", () => ({ cancelPaperOrder: vi.fn(), createPaperPortfolio: vi.fn(), fetchPaperOrders: vi.fn(),
  fetchPaperPerformance: vi.fn(), fetchPaperPortfolios: vi.fn(), fetchPaperPositions: vi.fn(), fetchPaperTrades: vi.fn(), placePaperOrder: vi.fn() }));
vi.mock("../components/trading/HotKeyPanel", () => ({ HotKeyPanel: () => null }));
const portfolio = { id: "usd", name: "US Paper", initial_capital: 10000, current_cash: 9000, base_currency: "USD" };
const performance = { portfolio_id: "usd", equity: 10000, pnl: 0, cumulative_return: 0, daily_pnl_curve: [],
  sharpe_ratio: 0, max_drawdown: 0, win_rate: 0, avg_win_loss_ratio: 0, profit_factor: 0, trade_count: 0 };
const pending = { id: "pending/order", symbol: "NASDAQ:AAPL", side: "buy", order_type: "limit", quantity: 1, status: "pending" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchPaperPortfolios).mockResolvedValue([portfolio]);
  vi.mocked(fetchPaperPositions).mockResolvedValue([]);
  vi.mocked(fetchPaperOrders).mockResolvedValue([]);
  vi.mocked(fetchPaperTrades).mockResolvedValue([]);
  vi.mocked(fetchPaperPerformance).mockResolvedValue(performance);
  vi.mocked(placePaperOrder).mockResolvedValue({ id: "new", symbol: "NASDAQ:AAPL", status: "filled" });
  vi.mocked(cancelPaperOrder).mockResolvedValue(undefined);
});
async function ready() {
  render(<PaperTradingPage />);
  await screen.findByText("Cash: USD 9,000.00");
}

describe("Paper order risk and currency integration", () => {
  it("creates the selected base-currency portfolio and labels its ledger", async () => {
    vi.mocked(createPaperPortfolio).mockResolvedValue({ ...portfolio, id: "new-eur", base_currency: "EUR" });
    await ready();
    fireEvent.change(screen.getByLabelText("Base currency"), { target: { value: "EUR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create portfolio" }));
    expect(await screen.findByText("Portfolio created in EUR.")).toBeInTheDocument();
    expect(createPaperPortfolio).toHaveBeenCalledWith({ name: "Paper Portfolio", initial_capital: 100000, base_currency: "EUR" });
    expect(await screen.findByText("Cash: EUR 9,000.00")).toBeInTheDocument();
  });

  it("submits a hypothetical buy stop separately from the stop-order trigger", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "NASDAQ:AAPL" } });
    fireEvent.change(screen.getByLabelText("Order type"), { target: { value: "sl" } });
    fireEvent.change(screen.getByLabelText("Order trigger price (quote currency)"), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText("Hypothetical risk stop (optional, quote currency)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Place paper order" }));
    await waitFor(() => expect(placePaperOrder).toHaveBeenCalledWith({ portfolio_id: "usd", symbol: "NASDAQ:AAPL", side: "buy",
      order_type: "sl", quantity: 1, sl_price: 101, stop_price: 90 }));
    expect(screen.getByText(/does not place a stop order/)).toBeInTheDocument();
  });

  it("retains policy-disabled market flow without a stop and excludes stale buy stop on sells", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Place paper order" }));
    await waitFor(() => expect(placePaperOrder).toHaveBeenCalledTimes(1));
    expect(vi.mocked(placePaperOrder).mock.calls[0][0]).not.toHaveProperty("stop_price");
    await screen.findByText("Paper order filled.");
    await waitFor(() => expect(screen.getByLabelText("Side")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Hypothetical risk stop (optional, quote currency)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Side"), { target: { value: "sell" } });
    expect(screen.queryByLabelText("Hypothetical risk stop (optional, quote currency)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Place paper order" }));
    await waitFor(() => expect(placePaperOrder).toHaveBeenCalledTimes(2));
    expect(vi.mocked(placePaperOrder).mock.calls[1][0]).not.toHaveProperty("stop_price");
  });

  it("shows risk rejection without claiming a fill", async () => {
    vi.mocked(placePaperOrder).mockResolvedValue({ id: "new", symbol: "NASDAQ:AAPL", status: "rejected", risk_rejection: "Quote drift exceeds saved limit" });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Place paper order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quote drift exceeds saved limit");
    expect(screen.queryByText("Paper order filled.")).not.toBeInTheDocument();
  });

  it("cancels only a pending order and refreshes released capacity", async () => {
    vi.mocked(fetchPaperOrders).mockResolvedValueOnce([pending, { ...pending, id: "filled", status: "filled" }]).mockResolvedValue([]);
    await ready();
    const cancel = screen.getByRole("button", { name: /Cancel pending order/ });
    fireEvent.click(cancel);
    expect(await screen.findByText("Pending order cancelled. Reserved capacity released.")).toBeInTheDocument();
    expect(cancelPaperOrder).toHaveBeenCalledWith("pending/order");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Cancel pending order/ })).not.toBeInTheDocument());
    expect(fetchPaperPortfolios).toHaveBeenCalledTimes(2);
  });

  it("renders API validation and cancellation errors without success notices", async () => {
    vi.mocked(fetchPaperOrders).mockResolvedValue([pending]);
    vi.mocked(cancelPaperOrder).mockRejectedValue(new Error("Only pending orders can be cancelled"));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Cancel pending order/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only pending orders can be cancelled");
    expect(screen.queryByText(/Reserved capacity released/)).not.toBeInTheDocument();
  });

  it("shows detail loading failures as unavailable rather than invented zero performance", async () => {
    vi.mocked(fetchPaperPerformance).mockRejectedValue(new Error("Price conversion unavailable"));
    render(<PaperTradingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Price conversion unavailable");
    expect(screen.getByText("Equity: Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Equity: USD 0.00")).not.toBeInTheDocument();
  });

  it("prevents duplicate asynchronous writes", async () => {
    let resolve!: (value: { id: string; symbol: string; status: string }) => void;
    vi.mocked(placePaperOrder).mockReturnValue(new Promise((done) => { resolve = done; }));
    await ready();
    const place = screen.getByRole("button", { name: "Place paper order" });
    fireEvent.click(place); fireEvent.click(place);
    expect(placePaperOrder).toHaveBeenCalledTimes(1);
    expect(place).toBeDisabled();
    resolve({ id: "new", symbol: "AAPL", status: "pending" });
    await screen.findByText(/awaiting execution checks/);
  });

  it("recovers from a failed portfolio list without inventing a cash balance", async () => {
    vi.mocked(fetchPaperPortfolios).mockRejectedValueOnce(new Error("Portfolio service offline")).mockResolvedValue([portfolio]);
    render(<PaperTradingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Portfolio service offline");
    expect(screen.queryByText(/^Cash:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload paper data" }));
    expect(await screen.findByText("Cash: USD 9,000.00")).toBeInTheDocument();
  });

  it("does not display an earlier portfolio's late response under the new currency", async () => {
    let resolveA!: (value: typeof performance) => void;
    vi.mocked(fetchPaperPortfolios).mockResolvedValue([portfolio, { ...portfolio, id: "eur", name: "Euro Paper", base_currency: "EUR" }]);
    vi.mocked(fetchPaperPerformance).mockImplementation((id) => id === "usd"
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ ...performance, portfolio_id: "eur", equity: 5000 }));
    render(<PaperTradingPage />);
    await screen.findByRole("option", { name: "Euro Paper (EUR)" });
    await waitFor(() => expect(fetchPaperPerformance).toHaveBeenCalledWith("usd"));
    fireEvent.change(screen.getByLabelText("Active paper portfolio"), { target: { value: "eur" } });
    expect(await screen.findByText("Equity: EUR 5,000.00")).toBeInTheDocument();
    resolveA({ ...performance, equity: 999999 });
    await waitFor(() => expect(screen.getByText("Equity: EUR 5,000.00")).toBeInTheDocument());
    expect(screen.queryByText(/999,999/)).not.toBeInTheDocument();
  });
});
