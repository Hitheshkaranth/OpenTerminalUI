import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { runBacktest, type BacktestPayload, type BacktestResponse } from "../../api/client";
import { MOMENTUM_ROTATION_BASKET_CSV } from "../../utils/constants";
import { formatPct } from "../../utils/formatters";

const DEFAULT_TICKERS = MOMENTUM_ROTATION_BASKET_CSV;

type Props = {
  initialTickers?: string[];
};

export function BacktestResults({ initialTickers }: Props) {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);
  const [lookback, setLookback] = useState(63);
  const [topN, setTopN] = useState(5);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootstrappedFromPortfolioRef = useRef(false);

  useEffect(() => {
    if (bootstrappedFromPortfolioRef.current) return;
    const symbols = Array.from(
      new Set((initialTickers ?? []).map((t) => String(t).trim().toUpperCase()).filter(Boolean)),
    );
    if (symbols.length === 0) return;
    setTickers(symbols.join(","));
    bootstrappedFromPortfolioRef.current = true;
  }, [initialTickers]);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload: BacktestPayload = {
        tickers: tickers.split(",").map((t) => t.trim()).filter(Boolean),
        lookback_days: lookback,
        top_n: topN,
      };
      const res = await runBacktest(payload);
      setResult(res);
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const detail = e.response?.data?.detail;
        setError(typeof detail === "string" ? detail : e.message || "Backtest failed");
      } else {
        setError(e instanceof Error ? e.message : "Backtest failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-terminal-accent">
          Momentum Rotation Backtest
        </h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs text-terminal-muted">Tickers (comma separated)</label>
            <input
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs"
              value={tickers}
              onChange={(e) => setTickers(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-terminal-muted">Lookback (days)</label>
            <input
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs"
              type="number"
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-terminal-muted">Top N picks</label>
            <input
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs"
              type="number"
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
            />
          </div>
        </div>
        <button
          className="mt-3 rounded bg-terminal-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          onClick={() => void handleRun()}
          disabled={loading}
        >
          {loading ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Strategy Return</div>
              <div className="mt-1 text-sm font-semibold text-terminal-pos">
                {formatPct((result.summary.strategy.total_return ?? 0) * 100)}
              </div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Benchmark Return</div>
              <div className="mt-1 text-sm font-semibold text-terminal-text">
                {formatPct((result.summary.benchmark.total_return ?? 0) * 100)}
              </div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Alpha</div>
              <div className={`mt-1 text-sm font-semibold ${result.summary.alpha_total_return > 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                {formatPct((result.summary.alpha_total_return ?? 0) * 100)}
              </div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Sharpe</div>
              <div className="mt-1 text-sm font-semibold text-terminal-text">
                {(result.summary.strategy.sharpe ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Max Drawdown</div>
              <div className="mt-1 text-sm font-semibold text-terminal-neg">
                {formatPct((result.summary.strategy.max_drawdown ?? 0) * 100)}
              </div>
            </div>
          </div>

          {result.equity_curve.length > 0 && (
            <div className="rounded border border-terminal-border bg-terminal-panel p-4">
              <h4 className="mb-3 text-sm font-semibold text-terminal-accent">Equity Curve</h4>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.equity_curve}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: "4px", border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
                    />
                    <Legend wrapperStyle={{ color: "#d8dde7" }} />
                    <Line type="monotone" dataKey="strategy" name="Strategy" stroke="#ff9f1a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#8e98a8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {result.holdings.length > 0 && (
            <div className="rounded border border-terminal-border bg-terminal-panel p-4">
              <h4 className="mb-3 text-sm font-semibold text-terminal-accent">Rebalance History</h4>
              <div className="overflow-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border text-terminal-muted">
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-left">Holdings</th>
                      <th className="px-2 py-1 text-right">Turnover</th>
                      <th className="px-2 py-1 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.holdings.map((h, idx) => (
                      <tr key={idx} className="border-b border-terminal-border/50">
                        <td className="px-2 py-1">{h.rebalance_date}</td>
                        <td className="max-w-xs truncate px-2 py-1" title={h.holdings}>{h.holdings}</td>
                        <td className="px-2 py-1 text-right">{formatPct(h.turnover * 100)}</td>
                        <td className="px-2 py-1 text-right">{(h.cost_applied * 10000).toFixed(1)} bps</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
