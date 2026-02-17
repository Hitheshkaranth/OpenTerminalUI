import { useEffect, useMemo, useState } from "react";

import {
  createPaperPortfolio,
  fetchPaperOrders,
  fetchPaperPerformance,
  fetchPaperPortfolios,
  fetchPaperPositions,
  fetchPaperTrades,
  placePaperOrder,
} from "../api/client";

export function PaperTradingPage() {
  const [portfolios, setPortfolios] = useState<Array<{ id: string; name: string; initial_capital: number; current_cash: number }>>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>("");
  const [name, setName] = useState("Paper Portfolio");
  const [capital, setCapital] = useState(100000);
  const [symbol, setSymbol] = useState("NSE:RELIANCE");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "sl">("market");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(0);
  const [slPrice, setSlPrice] = useState(0);
  const [positions, setPositions] = useState<Array<{ id: string; symbol: string; quantity: number; avg_entry_price: number; mark_price: number; unrealized_pnl: number }>>([]);
  const [orders, setOrders] = useState<Array<{ id: string; symbol: string; side: string; order_type: string; quantity: number; status: string; fill_price?: number | null }>>([]);
  const [trades, setTrades] = useState<Array<{ id: string; symbol: string; side: string; quantity: number; price: number; timestamp: string; pnl_realized?: number | null }>>([]);
  const [perf, setPerf] = useState<{ equity?: number; pnl?: number; cumulative_return?: number; sharpe_ratio?: number; max_drawdown?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPortfolios() {
    const items = await fetchPaperPortfolios();
    setPortfolios(items);
    if (!selectedPortfolioId && items.length > 0) {
      setSelectedPortfolioId(items[0].id);
    }
  }

  async function loadDetails(portfolioId: string) {
    if (!portfolioId) return;
    const [p, o, t, k] = await Promise.all([
      fetchPaperPositions(portfolioId),
      fetchPaperOrders(portfolioId),
      fetchPaperTrades(portfolioId),
      fetchPaperPerformance(portfolioId),
    ]);
    setPositions(p);
    setOrders(o);
    setTrades(t);
    setPerf(k);
  }

  useEffect(() => {
    void loadPortfolios();
  }, []);

  useEffect(() => {
    if (!selectedPortfolioId) return;
    void loadDetails(selectedPortfolioId);
  }, [selectedPortfolioId]);

  const selectedPortfolio = useMemo(
    () => portfolios.find((p) => p.id === selectedPortfolioId) || null,
    [portfolios, selectedPortfolioId],
  );

  return (
    <div className="space-y-3 p-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Create Virtual Portfolio</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
          <button
            className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent"
            onClick={() => {
              void (async () => {
                try {
                  await createPaperPortfolio({ name, initial_capital: capital });
                  await loadPortfolios();
                  setError(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to create portfolio");
                }
              })();
            }}
          >
            Create
          </button>
          <select
            className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            value={selectedPortfolioId}
            onChange={(e) => setSelectedPortfolioId(e.target.value)}
          >
            <option value="">Select portfolio</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Virtual Order Entry</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={orderType} onChange={(e) => setOrderType(e.target.value as "market" | "limit" | "sl")}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="sl">SL</option>
          </select>
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={limitPrice} onChange={(e) => setLimitPrice(Number(e.target.value))} placeholder="limit" />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={slPrice} onChange={(e) => setSlPrice(Number(e.target.value))} placeholder="sl" />
          <button
            className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent"
            onClick={() => {
              if (!selectedPortfolioId) {
                setError("Select portfolio first");
                return;
              }
              void (async () => {
                try {
                  await placePaperOrder({
                    portfolio_id: selectedPortfolioId,
                    symbol,
                    side,
                    order_type: orderType,
                    quantity,
                    limit_price: orderType === "limit" ? limitPrice : undefined,
                    sl_price: orderType === "sl" ? slPrice : undefined,
                  });
                  await loadDetails(selectedPortfolioId);
                  setError(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to place order");
                }
              })();
            }}
          >
            Place
          </button>
        </div>
      </div>

      {selectedPortfolio && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="mb-2 text-sm font-semibold text-terminal-accent">Performance</div>
            <div>Portfolio: {selectedPortfolio.name}</div>
            <div>Initial: {selectedPortfolio.initial_capital.toFixed(2)}</div>
            <div>Cash: {selectedPortfolio.current_cash.toFixed(2)}</div>
            <div>Equity: {Number(perf?.equity || 0).toFixed(2)}</div>
            <div className={Number(perf?.pnl || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
              P&L: {Number(perf?.pnl || 0).toFixed(2)}
            </div>
            <div>Return: {(Number(perf?.cumulative_return || 0) * 100).toFixed(2)}%</div>
            <div>Sharpe: {Number(perf?.sharpe_ratio || 0).toFixed(2)}</div>
            <div>Max DD: {(Number(perf?.max_drawdown || 0) * 100).toFixed(2)}%</div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="mb-2 text-sm font-semibold text-terminal-accent">Positions</div>
            <div className="space-y-1">
              {positions.map((p) => (
                <div key={p.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                  {p.symbol} | qty {p.quantity} | avg {p.avg_entry_price.toFixed(2)} | mark {p.mark_price.toFixed(2)} | uPnL{" "}
                  <span className={p.unrealized_pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{p.unrealized_pnl.toFixed(2)}</span>
                </div>
              ))}
              {positions.length === 0 && <div className="text-terminal-muted">No positions</div>}
            </div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="mb-2 text-sm font-semibold text-terminal-accent">Recent Orders</div>
            <div className="space-y-1">
              {orders.slice(0, 8).map((o) => (
                <div key={o.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                  {o.symbol} {o.side.toUpperCase()} {o.quantity} {o.order_type} | {o.status}
                </div>
              ))}
              {orders.length === 0 && <div className="text-terminal-muted">No orders</div>}
            </div>
          </div>
        </div>
      )}

      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Trade Blotter</div>
        <div className="space-y-1">
          {trades.slice(0, 20).map((t) => (
            <div key={t.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              {new Date(t.timestamp).toLocaleString()} | {t.symbol} {t.side.toUpperCase()} {t.quantity} @ {t.price.toFixed(2)} | rPnL{" "}
              <span className={Number(t.pnl_realized || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{Number(t.pnl_realized || 0).toFixed(2)}</span>
            </div>
          ))}
          {trades.length === 0 && <div className="text-terminal-muted">No trades</div>}
        </div>
      </div>

      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}
    </div>
  );
}
