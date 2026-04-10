import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchTapeRecent, fetchTapeSummary, type TapeSummaryResponse, type TapeTrade } from "../../api/client";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { useStockStore } from "../../store/stockStore";

type TradeFilter = "all" | "buy" | "sell" | "large";

interface TimeAndSalesProps {
  ticker?: string;
  limit?: number;
  className?: string;
}

interface EnrichedTapeTrade extends TapeTrade {
  id: string;
  isLarge: boolean;
}

const ROW_HEIGHT = 34;
const OVERSCAN = 8;
const STORAGE_LIMIT = 2_000;

function formatTradeTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "--:--:--";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildTradeId(trade: TapeTrade): string {
  return `${trade.timestamp}:${trade.price}:${trade.quantity}:${trade.side}`;
}

function computeLargeTradeFlags(trades: TapeTrade[]): EnrichedTapeTrade[] {
  if (!trades.length) return [];
  const avgTradeSize = trades.reduce((sum, trade) => sum + trade.quantity, 0) / trades.length;
  return trades.map((trade) => ({
    ...trade,
    id: buildTradeId(trade),
    isLarge: trade.quantity > avgTradeSize * 2,
  }));
}

function defaultSummary(): TapeSummaryResponse {
  return {
    total_volume: 0,
    buy_volume: 0,
    sell_volume: 0,
    buy_pct: 0,
    large_trade_count: 0,
    avg_trade_size: 0,
    trades_per_min: 0,
  };
}

export function TimeAndSales({ ticker, limit = 500, className = "" }: TimeAndSalesProps) {
  const storeTicker = useStockStore((state) => state.ticker);
  const activeTicker = (ticker || storeTicker || "RELIANCE").toUpperCase();
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>("all");
  const [minSize, setMinSize] = useState("0");
  const [paused, setPaused] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [trades, setTrades] = useState<TapeTrade[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const recentQuery = useQuery({
    queryKey: ["tape", "recent", activeTicker, limit],
    queryFn: () => fetchTapeRecent(activeTicker, limit),
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  const summaryQuery = useQuery({
    queryKey: ["tape", "summary", activeTicker, limit],
    queryFn: () => fetchTapeSummary(activeTicker, limit),
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  useEffect(() => {
    setTrades([]);
    setScrollTop(0);
  }, [activeTicker]);

  useEffect(() => {
    const incoming = recentQuery.data?.trades ?? [];
    if (!incoming.length) return;
    setTrades((current) => {
      const seen = new Set(current.map(buildTradeId));
      const additions = incoming.filter((trade) => !seen.has(buildTradeId(trade)));
      const merged = [...additions, ...current];
      merged.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
      return merged.slice(0, STORAGE_LIMIT);
    });
  }, [recentQuery.data]);

  useEffect(() => {
    if (paused) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
    setScrollTop(0);
  }, [trades, paused]);

  const enrichedTrades = useMemo(() => computeLargeTradeFlags(trades), [trades]);
  const minimumSize = Number.parseInt(minSize, 10);
  const normalizedMinSize = Number.isFinite(minimumSize) ? Math.max(0, minimumSize) : 0;

  const filteredTrades = useMemo(() => {
    return enrichedTrades.filter((trade) => {
      if (trade.quantity < normalizedMinSize) return false;
      if (tradeFilter === "buy") return trade.side === "buy";
      if (tradeFilter === "sell") return trade.side === "sell";
      if (tradeFilter === "large") return trade.isLarge;
      return true;
    });
  }, [enrichedTrades, normalizedMinSize, tradeFilter]);

  const visibleCount = 18;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(filteredTrades.length, startIndex + visibleCount + OVERSCAN * 2);
  const visibleTrades = filteredTrades.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (filteredTrades.length - endIndex) * ROW_HEIGHT);

  const summary = summaryQuery.data ?? defaultSummary();
  const sellPct = summary.total_volume > 0 ? Math.max(0, Math.min(100, (summary.sell_volume / summary.total_volume) * 100)) : 0;
  const tableEmpty = !recentQuery.isLoading && filteredTrades.length === 0;

  return (
    <TerminalPanel
      title="Time & Sales"
      subtitle={`${activeTicker} tape`}
      className={className}
      bodyClassName="flex h-full min-h-0 flex-col gap-3"
      actions={paused ? <span className="rounded-sm border border-yellow-400/50 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-yellow-300">Paused</span> : null}
    >
      <div className="grid gap-3">
        <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-3">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_repeat(5,minmax(0,1fr))]">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                <span>Buy / Sell Flow</span>
                <span>{summary.buy_pct.toFixed(1)}% / {sellPct.toFixed(1)}%</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full border border-terminal-border bg-terminal-bg">
                <div className="bg-green-500/70" style={{ width: `${summary.buy_pct}%` }} />
                <div className="bg-red-500/70" style={{ width: `${sellPct}%` }} />
              </div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Total Volume</div>
              <div className="mt-1 font-mono text-sm text-terminal-text">{formatCompactNumber(summary.total_volume)}</div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Buy Vol %</div>
              <div className="mt-1 font-mono text-sm text-green-400">{summary.buy_pct.toFixed(1)}%</div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Sell Vol %</div>
              <div className="mt-1 font-mono text-sm text-red-400">{sellPct.toFixed(1)}%</div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Large Trades</div>
              <div className="mt-1 font-mono text-sm text-terminal-text">{formatCompactNumber(summary.large_trade_count)}</div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Trades / Min</div>
              <div className="mt-1 font-mono text-sm text-terminal-text">{summary.trades_per_min.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-3 py-2">
          {[
            { key: "all", label: "All" },
            { key: "buy", label: "Buys Only" },
            { key: "sell", label: "Sells Only" },
            { key: "large", label: "Large Only" },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTradeFilter(option.key as TradeFilter)}
              className={`rounded-sm border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
                tradeFilter === option.key
                  ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                  : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {option.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-[11px] text-terminal-muted">
            <span className="uppercase tracking-[0.14em]">Min Size</span>
            <input
              value={minSize}
              onChange={(event) => setMinSize(event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="w-24 rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-terminal-text outline-none focus:border-terminal-accent"
            />
          </label>
        </div>

        <div className="overflow-hidden rounded-sm border border-terminal-border bg-terminal-bg">
          <div className="grid grid-cols-[96px_1fr_1fr_1fr] gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
            <span>Time</span>
            <span className="text-right">Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Value</span>
          </div>
          <div
            ref={scrollRef}
            className="h-[640px] overflow-auto font-mono"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            {recentQuery.isLoading && !trades.length ? (
              <div className="flex h-full items-center justify-center px-3 py-10 text-xs text-terminal-muted">Loading tape...</div>
            ) : null}
            {tableEmpty ? (
              <div className="flex h-full items-center justify-center px-3 py-10 text-xs text-terminal-muted">No trades match the current filter.</div>
            ) : null}
            {!tableEmpty && !recentQuery.isLoading ? (
              <div style={{ height: filteredTrades.length * ROW_HEIGHT }}>
                <div style={{ height: topSpacerHeight }} />
                {visibleTrades.map((trade) => (
                  <div
                    key={trade.id}
                    className={`grid grid-cols-[96px_1fr_1fr_1fr] items-center gap-2 border-b border-terminal-border/40 px-3 text-[12px] ${
                      trade.side === "buy"
                        ? "bg-green-500/5 text-green-400"
                        : trade.side === "sell"
                          ? "bg-red-500/5 text-red-400"
                          : "text-terminal-muted"
                    } ${trade.isLarge ? "border-l-2 border-yellow-400 font-semibold" : ""}`}
                    style={{ height: ROW_HEIGHT }}
                    data-side={trade.side}
                  >
                    <span>{formatTradeTime(trade.timestamp)}</span>
                    <span className="text-right">{formatPrice(trade.price)}</span>
                    <span className="text-right">{formatCompactNumber(trade.quantity)}</span>
                    <span className="text-right">{formatValue(trade.value)}</span>
                  </div>
                ))}
                <div style={{ height: bottomSpacerHeight }} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </TerminalPanel>
  );
}
