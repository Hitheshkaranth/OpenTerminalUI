import { useEffect, useState } from "react";
import { fetchCockpitSummary } from "../../api/quantClient";

type CockpitSummary = {
  portfolio_snapshot?: { total_value?: unknown; daily_pnl?: unknown; active_jobs?: unknown };
  signal_summary?: { bullish_count?: unknown; bearish_count?: unknown; neutral_count?: unknown };
  risk_summary?: { var_95?: unknown; beta?: unknown };
  events?: Array<{ symbol?: string; event_type?: string }>;
  news?: Array<{ source?: string; headline?: string }>;
};

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(value: unknown, digits = 0): string {
  const n = asNumber(value);
  if (n == null) return "--";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function CockpitDashboard() {
  const [data, setData] = useState<CockpitSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const summary = (await fetchCockpitSummary()) as CockpitSummary;
      setData(summary);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load cockpit summary";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const portfolioValue = fmtNumber(data?.portfolio_snapshot?.total_value, 0);
  const dailyPnl = asNumber(data?.portfolio_snapshot?.daily_pnl);
  const dailyPnlLabel = dailyPnl == null ? "--" : `${dailyPnl >= 0 ? "+" : ""}${fmtNumber(dailyPnl, 0)}`;
  const beta = fmtNumber(data?.risk_summary?.beta, 2);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between rounded border border-terminal-border bg-terminal-panel p-3">
        <h1 className="text-lg font-bold text-terminal-accent">Cockpit Aggregator</h1>
        <button
          className="rounded border border-terminal-border px-3 py-1 text-sm hover:bg-terminal-border/30"
          onClick={loadData}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-4 text-terminal-neg">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex justify-center p-8">
          <div className="animate-pulse text-terminal-accent">Loading...</div>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <h2 className="mb-2 font-semibold text-terminal-text">Portfolio Snapshot</h2>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Value:</span> <span>${portfolioValue}</span></div>
              <div className="flex justify-between">
                <span>PnL:</span>
                <span className={(dailyPnl ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>${dailyPnlLabel}</span>
              </div>
              <div className="flex justify-between"><span>Active Jobs:</span> <span>{fmtNumber(data.portfolio_snapshot?.active_jobs, 0)}</span></div>
            </div>
          </div>

          <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <h2 className="mb-2 font-semibold text-terminal-text">Signal Summary</h2>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Bullish:</span> <span className="text-terminal-pos">{fmtNumber(data.signal_summary?.bullish_count, 0)}</span></div>
              <div className="flex justify-between"><span>Bearish:</span> <span className="text-terminal-neg">{fmtNumber(data.signal_summary?.bearish_count, 0)}</span></div>
              <div className="flex justify-between"><span>Neutral:</span> <span>{fmtNumber(data.signal_summary?.neutral_count, 0)}</span></div>
            </div>
          </div>

          <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <h2 className="mb-2 font-semibold text-terminal-text">Risk Summary</h2>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>VaR (95%):</span> <span>{fmtNumber(data.risk_summary?.var_95, 2)}</span></div>
              <div className="flex justify-between"><span>Beta:</span> <span>{beta}</span></div>
            </div>
          </div>

          <div className="col-span-full rounded border border-terminal-border bg-terminal-panel p-4">
            <h2 className="mb-2 font-semibold text-terminal-text">Recent Events &amp; News</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 border-b border-terminal-border pb-1 text-xs font-bold text-terminal-accent">Events</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {(data.events ?? []).map((event, i) => (
                    <li key={`${event.symbol ?? "event"}-${i}`} className="flex justify-between">
                      <span>{event.symbol ?? "--"}</span>
                      <span className="text-terminal-dim">{event.event_type ?? "--"}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 border-b border-terminal-border pb-1 text-xs font-bold text-terminal-accent">News</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {(data.news ?? []).map((item, i) => (
                    <li key={`${item.source ?? "news"}-${i}`} className="truncate" title={item.headline ?? ""}>
                      <span className="mr-2 text-terminal-dim">{item.source ?? "--"}</span>
                      {item.headline ?? "--"}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded border border-terminal-border bg-terminal-panel p-12 text-center">
          <span className="text-4xl">CTRL</span>
          <p className="font-semibold text-terminal-accent">Cockpit Aggregator</p>
          <p className="max-w-md text-sm text-terminal-muted">
            Cockpit summary is not available yet. This page will aggregate portfolio, risk, signals, and news as data sources come online.
          </p>
          <button
            className="mt-2 rounded border border-terminal-accent px-4 py-1.5 text-sm text-terminal-accent hover:bg-terminal-accent/10"
            onClick={loadData}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
