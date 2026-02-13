import { useEffect, useState } from "react";

import { addHolding, deleteHolding, fetchPortfolio } from "../api/client";
import { BacktestResults } from "../components/portfolio/BacktestResults";
import type { PortfolioResponse } from "../types";
import { formatInr } from "../utils/formatters";

export function PortfolioPage() {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [ticker, setTicker] = useState("RELIANCE");
  const [quantity, setQuantity] = useState(10);
  const [avgBuyPrice, setAvgBuyPrice] = useState(2500);
  const [buyDate, setBuyDate] = useState("2025-01-01");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPortfolio();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold">Add Holding</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={avgBuyPrice} onChange={(e) => setAvgBuyPrice(Number(e.target.value))} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
          <button
            className="rounded bg-terminal-accent px-3 py-1 text-xs text-black"
            onClick={async () => {
              try {
                await addHolding({ ticker, quantity, avg_buy_price: avgBuyPrice, buy_date: buyDate });
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to add holding");
              }
            }}
          >
            Add
          </button>
        </div>
      </div>

      {loading && <div className="text-xs text-terminal-muted">Loading portfolio...</div>}
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">{error}</div>}
      {data && (
        <>
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div>Total Cost: {formatInr(data.summary.total_cost)}</div>
            <div>Total Value: {formatInr(data.summary.total_value ?? undefined)}</div>
            <div>Overall P&L: {formatInr(data.summary.overall_pnl ?? undefined)}</div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-3">
            <div className="mb-2 text-sm font-semibold">Holdings</div>
            <div className="overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-terminal-muted">
                    <th className="px-2 py-1 text-left">Ticker</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Avg Buy</th>
                    <th className="px-2 py-1 text-right">Current</th>
                    <th className="px-2 py-1 text-right">Value</th>
                    <th className="px-2 py-1 text-right">P&L</th>
                    <th className="px-2 py-1 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-b border-terminal-border/50">
                      <td className="px-2 py-1">{row.ticker}</td>
                      <td className="px-2 py-1 text-right">{row.quantity}</td>
                      <td className="px-2 py-1 text-right">{formatInr(row.avg_buy_price)}</td>
                      <td className="px-2 py-1 text-right">{formatInr(row.current_price ?? undefined)}</td>
                      <td className="px-2 py-1 text-right">{formatInr(row.current_value ?? undefined)}</td>
                      <td className="px-2 py-1 text-right">{formatInr(row.pnl ?? undefined)}</td>
                      <td className="px-2 py-1 text-right">
                        <button
                          className="rounded border border-terminal-border px-2 py-1"
                          onClick={async () => {
                            try {
                              await deleteHolding(row.id);
                              await load();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Failed to delete holding");
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <BacktestResults />
    </div>
  );
}
