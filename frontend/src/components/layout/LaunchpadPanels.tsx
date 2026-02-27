import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchAlerts,
  fetchMarketStatus,
  fetchNewsByTicker,
  fetchPortfolio,
  fetchSectorAllocation,
  fetchTopBarTickers,
  fetchWatchlist,
} from "../../api/client";
import { useStock, useStockHistory } from "../../hooks/useStocks";
import type { AlertRule, WatchlistItem } from "../../types";
import type { LaunchpadPanelConfig } from "./LaunchpadContext";
import { TradingChart } from "../chart/TradingChart";

type PanelProps = { panel: LaunchpadPanelConfig };

function useJkListNavigation<T>(rows: T[]) {
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
  }, [rows.length, selected]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "j") {
      event.preventDefault();
      setSelected((v) => Math.min(rows.length - 1, v + 1));
    } else if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      setSelected((v) => Math.max(0, v - 1));
    }
  };
  return { selected, setSelected, onKeyDown };
}

export function LaunchpadChartPanel({ panel }: PanelProps) {
  const symbol = (panel.symbol || "RELIANCE").toUpperCase();
  const history = useStockHistory(symbol, "3mo", "1d");
  const data = history.data?.data ?? [];
  return (
    <div className="h-full p-1">
      <div className="h-[calc(100%-4px)] rounded border border-terminal-border bg-terminal-bg p-1">
        <TradingChart ticker={symbol} data={data} mode="candles" timeframe="1D" panelId={panel.id} crosshairSyncGroupId={panel.linked ? "launchpad-linked" : `solo-${panel.id}`} />
      </div>
    </div>
  );
}

export function LaunchpadWatchlistPanel(_: PanelProps) {
  const watchlist = useQuery({ queryKey: ["launchpad", "watchlist"], queryFn: fetchWatchlist, staleTime: 30_000, refetchInterval: 60_000 });
  const rows = (watchlist.data ?? []) as WatchlistItem[];
  const nav = useJkListNavigation(rows);

  return (
    <div className="h-full overflow-auto p-2" tabIndex={0} onKeyDown={nav.onKeyDown}>
      {!rows.length ? <div className="text-xs text-terminal-muted">No watchlist rows.</div> : null}
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <div key={row.id} className={`rounded border px-2 py-1 text-xs ${idx === nav.selected ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg"}`}>
            <div className="ot-type-data text-terminal-text">{row.ticker}</div>
            <div className="text-terminal-muted">{row.watchlist_name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LaunchpadNewsFeedPanel({ panel }: PanelProps) {
  const symbol = (panel.symbol || "RELIANCE").toUpperCase();
  const news = useQuery({
    queryKey: ["launchpad", "news", symbol],
    queryFn: () => fetchNewsByTicker(symbol, 25),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const rows = news.data ?? [];
  const nav = useJkListNavigation(rows);

  return (
    <div className="h-full overflow-auto p-2" tabIndex={0} onKeyDown={nav.onKeyDown}>
      <div className="mb-1 text-[10px] uppercase text-terminal-muted">j/k navigation</div>
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <a
            key={`${row.id}-${row.published_at ?? idx}`}
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className={`block rounded border px-2 py-1 text-xs ${idx === nav.selected ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg"}`}
          >
            <div className="truncate text-terminal-text">{row.title}</div>
            <div className="truncate text-[10px] text-terminal-muted">{row.source}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

export function LaunchpadOrderBookPanel({ panel }: PanelProps) {
  const symbol = (panel.symbol || "RELIANCE").toUpperCase();
  const stock = useStock(symbol);
  const last = Number(stock.data?.current_price || 0);
  const levels = useMemo(() => {
    if (!Number.isFinite(last) || last <= 0) return [] as Array<{ side: "BID" | "ASK"; px: number; qty: number }>;
    const rows: Array<{ side: "BID" | "ASK"; px: number; qty: number }> = [];
    for (let i = 5; i >= 1; i -= 1) rows.push({ side: "BID", px: last - i * 0.25, qty: 1000 + i * 120 });
    for (let i = 1; i <= 5; i += 1) rows.push({ side: "ASK", px: last + i * 0.25, qty: 1100 + i * 110 });
    return rows;
  }, [last]);
  return (
    <div className="h-full overflow-auto p-2">
      <div className="grid grid-cols-3 gap-1 text-[10px] uppercase text-terminal-muted">
        <div>Side</div><div className="text-right">Price</div><div className="text-right">Qty</div>
      </div>
      <div className="mt-1 space-y-1">
        {levels.map((row, idx) => (
          <div key={`${row.side}-${idx}`} className="grid grid-cols-3 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
            <div className={row.side === "BID" ? "text-terminal-pos" : "text-terminal-neg"}>{row.side}</div>
            <div className="text-right ot-type-data text-terminal-text">{row.px.toFixed(2)}</div>
            <div className="text-right ot-type-data text-terminal-muted">{row.qty.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LaunchpadTickerDetailPanel({ panel }: PanelProps) {
  const symbol = (panel.symbol || "RELIANCE").toUpperCase();
  const stock = useStock(symbol);
  const row = stock.data;
  return (
    <div className="h-full p-2 text-xs">
      <div className="rounded border border-terminal-border bg-terminal-bg p-2">
        <div className="ot-type-label text-terminal-muted">Symbol</div>
        <div className="ot-type-data text-terminal-text">{symbol}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">Price</div><div className="ot-type-data text-terminal-text">{Number(row?.current_price ?? 0).toLocaleString()}</div></div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">Chg%</div><div className={Number(row?.change_pct ?? 0) >= 0 ? "text-terminal-pos ot-type-data" : "text-terminal-neg ot-type-data"}>{Number(row?.change_pct ?? 0).toFixed(2)}%</div></div>
      </div>
    </div>
  );
}

export function LaunchpadScreenerResultsPanel(_: PanelProps) {
  const tickers = useQuery({ queryKey: ["launchpad", "top-tickers"], queryFn: fetchTopBarTickers, staleTime: 60_000, refetchInterval: 60_000 });
  const rows = tickers.data?.items ?? [];
  const nav = useJkListNavigation(rows);
  return (
    <div className="h-full overflow-auto p-2" tabIndex={0} onKeyDown={nav.onKeyDown}>
      <div className="mb-1 text-[10px] uppercase text-terminal-muted">Top movers proxy</div>
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <div key={row.key} className={`grid grid-cols-3 rounded border px-2 py-1 text-xs ${idx === nav.selected ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg"}`}>
            <div className="text-terminal-text">{row.symbol}</div>
            <div className="text-right ot-type-data text-terminal-muted">{row.price == null ? "NA" : Number(row.price).toFixed(2)}</div>
            <div className={`text-right ot-type-data ${Number(row.change_pct ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.change_pct == null ? "NA" : `${Number(row.change_pct).toFixed(2)}%`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LaunchpadAlertsPanel(_: PanelProps) {
  const alerts = useQuery({ queryKey: ["launchpad", "alerts"], queryFn: fetchAlerts, staleTime: 30_000, refetchInterval: 60_000 });
  const rows = ((alerts.data ?? []) as AlertRule[]).filter((r) => (r.status || "active") !== "deleted");
  const nav = useJkListNavigation(rows);
  return (
    <div className="h-full overflow-auto p-2" tabIndex={0} onKeyDown={nav.onKeyDown}>
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <div key={row.id} className={`rounded border px-2 py-1 text-xs ${idx === nav.selected ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-terminal-text">{row.ticker}</span>
              <span className="text-terminal-muted uppercase">{row.alert_type}</span>
            </div>
            <div className="truncate text-terminal-muted">{row.condition}</div>
          </div>
        ))}
        {!rows.length ? <div className="text-xs text-terminal-muted">No active alerts.</div> : null}
      </div>
    </div>
  );
}

export function LaunchpadPortfolioSummaryPanel(_: PanelProps) {
  const portfolio = useQuery({ queryKey: ["launchpad", "portfolio"], queryFn: fetchPortfolio, staleTime: 30_000, refetchInterval: 60_000 });
  const summary = portfolio.data?.summary;
  return (
    <div className="h-full p-2 text-xs">
      <div className="grid grid-cols-1 gap-2">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">Total Value</div><div className="ot-type-data text-terminal-text">{summary?.total_value == null ? "NA" : Number(summary.total_value).toLocaleString()}</div></div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">Total Cost</div><div className="ot-type-data text-terminal-text">{summary?.total_cost == null ? "NA" : Number(summary.total_cost).toLocaleString()}</div></div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">Overall PnL</div><div className={`${Number(summary?.overall_pnl ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"} ot-type-data`}>{summary?.overall_pnl == null ? "NA" : Number(summary.overall_pnl).toLocaleString()}</div></div>
      </div>
    </div>
  );
}

export function LaunchpadHeatmapPanel(_: PanelProps) {
  const sector = useQuery({ queryKey: ["launchpad", "sector-allocation"], queryFn: fetchSectorAllocation, staleTime: 60_000, refetchInterval: 120_000 });
  const rows = sector.data?.sectors ?? [];
  const max = Math.max(...rows.map((r) => r.weight_pct), 1);
  return (
    <div className="h-full overflow-auto p-2">
      {!rows.length ? <div className="text-xs text-terminal-muted">No sector data.</div> : null}
      <div className="space-y-1">
        {rows.slice(0, 12).map((row) => (
          <div key={row.sector} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-terminal-text">{row.sector}</span>
              <span className="ot-type-data text-terminal-muted">{row.weight_pct.toFixed(2)}%</span>
            </div>
            <div className="h-2 rounded bg-[#1A2332]">
              <div className="h-2 rounded bg-terminal-accent/60" style={{ width: `${(row.weight_pct / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LaunchpadMarketPulsePanel(_: PanelProps) {
  const status = useQuery({ queryKey: ["launchpad", "market-status"], queryFn: fetchMarketStatus, staleTime: 10_000, refetchInterval: 15_000 });
  const payload = (status.data ?? {}) as Record<string, unknown>;
  const rows = [
    { label: "NIFTY", value: payload.nifty50, change: payload.nifty50Pct },
    { label: "SENSEX", value: payload.sensex, change: payload.sensexPct },
    { label: "S&P 500", value: payload.sp500, change: payload.sp500Pct },
    { label: "NIKKEI", value: payload.nikkei225, change: payload.nikkei225Pct },
  ];
  return (
    <div className="h-full p-2">
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-3 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
            <div className="text-terminal-accent">{row.label}</div>
            <div className="text-right ot-type-data text-terminal-text">{Number(row.value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
            <div className={`text-right ot-type-data ${Number(row.change ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.change == null ? "NA" : `${Number(row.change).toFixed(2)}%`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LaunchpadFundamentalsPanel({ panel }: PanelProps) {
  const symbol = (panel.symbol || "AAPL").toUpperCase();
  const stock = useStock(symbol);
  return (
    <div className="h-full p-2 text-xs">
      <div className="rounded border border-terminal-border bg-terminal-bg p-2">
        <div className="text-terminal-muted">Company</div>
        <div className="text-terminal-text">{stock.data?.company_name || symbol}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">Mkt Cap</div><div className="ot-type-data text-terminal-text">{Number(stock.data?.market_cap ?? 0).toLocaleString()}</div></div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2"><div className="text-terminal-muted">P/E</div><div className="ot-type-data text-terminal-text">{Number(stock.data?.pe ?? 0).toFixed(2)}</div></div>
      </div>
    </div>
  );
}
