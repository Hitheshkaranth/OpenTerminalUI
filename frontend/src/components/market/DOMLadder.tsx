import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchDepth, type DepthSnapshotResponse } from "../../api/client";
import { TerminalPanel } from "../terminal/TerminalPanel";

type Props = {
  symbol: string;
  market: string;
  className?: string;
  onSnapshot?: (snapshot: DepthSnapshotResponse | null) => void;
};

type LadderRow = {
  price: number;
  bidQty: number;
  askQty: number;
  bidOrders: number;
  askOrders: number;
  bidCumulative: number;
  askCumulative: number;
  bidFlash: "up" | "down" | null;
  askFlash: "up" | "down" | null;
  volumeAtPrice: number;
};

const REFRESH_OPTIONS = [
  { label: "1s", value: 1_000 },
  { label: "2s", value: 2_000 },
  { label: "5s", value: 5_000 },
] as const;

const DEPTH_OPTIONS = [10, 20, 40] as const;

function normalizeMarket(value: string): string {
  const market = String(value || "").trim().toUpperCase();
  if (market === "NSE" || market === "BSE" || market === "IN") return "IN";
  if (market === "CRYPTO" || market === "BINANCE") return "CRYPTO";
  return "US";
}

function decimalsFromTick(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize >= 1) return 0;
  const raw = String(tickSize);
  const decimalPart = raw.includes(".") ? raw.split(".")[1] || "" : "";
  return Math.min(4, decimalPart.replace(/0+$/, "").length || 2);
}

function roundToTick(price: number, tickSize: number, decimals: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return Number(price.toFixed(Math.max(0, decimals)));
  return Number((Math.round(price / tickSize) * tickSize).toFixed(Math.max(0, decimals)));
}

function formatPrice(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function buildRows(snapshot: DepthSnapshotResponse, levels: number, previous: DepthSnapshotResponse | null): LadderRow[] {
  const tickSize = snapshot.tick_size || 0.01;
  const decimals = decimalsFromTick(tickSize);
  const anchor = roundToTick(snapshot.last_price || snapshot.mid_price, tickSize, decimals);

  const bidMap = new Map(snapshot.bids.map((level) => [level.price, level]));
  const askMap = new Map(snapshot.asks.map((level) => [level.price, level]));
  const prevBidMap = new Map((previous?.bids ?? []).map((level) => [level.price, level.quantity ?? level.size ?? 0]));
  const prevAskMap = new Map((previous?.asks ?? []).map((level) => [level.price, level.quantity ?? level.size ?? 0]));

  const rows: LadderRow[] = [];
  for (let offset = levels; offset >= -levels; offset -= 1) {
    const price = Number((anchor + offset * tickSize).toFixed(decimals));
    const bid = bidMap.get(price);
    const ask = askMap.get(price);
    const bidQty = bid?.quantity ?? bid?.size ?? 0;
    const askQty = ask?.quantity ?? ask?.size ?? 0;
    const prevBidQty = prevBidMap.get(price) ?? bidQty;
    const prevAskQty = prevAskMap.get(price) ?? askQty;
    const distanceWeight = Math.max(0.15, 1 - Math.min(1, Math.abs(offset) / Math.max(1, levels)));
    const volumeAtPrice = Math.round((bidQty + askQty || snapshot.last_qty) * (0.35 + distanceWeight * 0.65));

    rows.push({
      price,
      bidQty,
      askQty,
      bidOrders: bid?.orders ?? 0,
      askOrders: ask?.orders ?? 0,
      bidCumulative: bid?.cumulative_qty ?? 0,
      askCumulative: ask?.cumulative_qty ?? 0,
      bidFlash: bidQty > prevBidQty ? "up" : bidQty < prevBidQty ? "down" : null,
      askFlash: askQty > prevAskQty ? "up" : askQty < prevAskQty ? "down" : null,
      volumeAtPrice,
    });
  }
  return rows;
}

export function DOMLadder({ symbol, market, className = "", onSnapshot }: Props) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "RELIANCE";
  const normalizedMarket = normalizeMarket(market);
  const [autoCenter, setAutoCenter] = useState(true);
  const [showCumulative, setShowCumulative] = useState(false);
  const [levels, setLevels] = useState<(typeof DEPTH_OPTIONS)[number]>(20);
  const [refreshMs, setRefreshMs] = useState<(typeof REFRESH_OPTIONS)[number]["value"]>(2_000);
  const [previousSnapshot, setPreviousSnapshot] = useState<DepthSnapshotResponse | null>(null);
  const lastPriceRowRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSnapshotRef = useRef<DepthSnapshotResponse | null>(null);

  const depthQuery = useQuery({
    queryKey: ["dom-depth", normalizedMarket, normalizedSymbol, levels],
    queryFn: async () => {
      const next = await fetchDepth(normalizedSymbol, normalizedMarket, levels);
      setPreviousSnapshot(lastSnapshotRef.current);
      lastSnapshotRef.current = next;
      return next;
    },
    refetchInterval: refreshMs,
    staleTime: Math.max(500, refreshMs - 100),
  });

  useEffect(() => {
    setPreviousSnapshot(null);
    lastSnapshotRef.current = null;
  }, [levels, normalizedMarket, normalizedSymbol]);

  useEffect(() => {
    onSnapshot?.(depthQuery.data ?? null);
  }, [depthQuery.data, onSnapshot]);

  useEffect(() => {
    if (!autoCenter) return;
    lastPriceRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [autoCenter, depthQuery.data, levels]);

  const snapshot = depthQuery.data ?? null;
  const tickSize = snapshot?.tick_size || 0.01;
  const decimals = decimalsFromTick(tickSize);
  const bestBid = snapshot?.bids[0]?.price ?? 0;
  const bestAsk = snapshot?.asks[0]?.price ?? 0;
  const anchorPrice = snapshot ? roundToTick(snapshot.last_price || snapshot.mid_price, tickSize, decimals) : 0;

  const rows = useMemo(
    () => (snapshot ? buildRows(snapshot, levels, previousSnapshot) : []),
    [levels, previousSnapshot, snapshot],
  );
  const maxDisplayedQty = useMemo(() => {
    return rows.reduce((maxValue, row) => {
      const bidValue = showCumulative ? row.bidCumulative : row.bidQty;
      const askValue = showCumulative ? row.askCumulative : row.askQty;
      return Math.max(maxValue, bidValue, askValue, row.volumeAtPrice);
    }, 0);
  }, [rows, showCumulative]);
  const totalDisplayed = (snapshot?.total_bid_qty ?? 0) + (snapshot?.total_ask_qty ?? 0);
  const bidShare = totalDisplayed > 0 ? ((snapshot?.total_bid_qty ?? 0) / totalDisplayed) * 100 : 50;
  const askShare = Math.max(0, 100 - bidShare);
  const spreadBps = snapshot?.last_price ? (snapshot.spread / snapshot.last_price) * 10_000 : 0;

  return (
    <TerminalPanel
      title="DOM Ladder"
      subtitle={`${normalizedSymbol} level 2`}
      className={className}
      bodyClassName="flex h-full min-h-0 flex-col gap-3"
      actions={
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
          <span>{normalizedMarket}</span>
          {depthQuery.isFetching ? <span className="text-terminal-accent">Live</span> : null}
        </div>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-terminal-border bg-terminal-panel px-3 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Depth Monitor</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-xl font-semibold text-terminal-text">{formatPrice(snapshot?.last_price ?? 0, decimals)}</span>
              <span className="font-mono text-xs text-terminal-muted">Last Qty {formatCompact(snapshot?.last_qty ?? 0)}</span>
            </div>
          </div>
          <div className="grid gap-2 text-right sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Spread</div>
              <div className="mt-1 font-mono text-sm text-terminal-text">{formatPrice(snapshot?.spread ?? 0, decimals)}</div>
              <div className="font-mono text-[11px] text-terminal-muted">{spreadBps.toFixed(1)} bps</div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Imbalance</div>
              <div className={`mt-1 font-mono text-sm ${(snapshot?.imbalance ?? 0) >= 0 ? "text-blue-300" : "text-red-300"}`}>
                {formatSigned((snapshot?.imbalance ?? 0) * 100)}%
              </div>
            </div>
            <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Refresh</div>
              <div className="mt-1 font-mono text-sm text-terminal-text">{refreshMs / 1000}s</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-3 py-2 text-[11px]">
          <button
            type="button"
            onClick={() => setAutoCenter((current) => !current)}
            className={`rounded-sm border px-3 py-1 uppercase tracking-[0.14em] ${
              autoCenter
                ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
            }`}
          >
            Auto-center
          </button>
          <button
            type="button"
            onClick={() => setShowCumulative((current) => !current)}
            className={`rounded-sm border px-3 py-1 uppercase tracking-[0.14em] ${
              showCumulative
                ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
            }`}
          >
            Cumulative
          </button>
          <div className="ml-0 flex items-center gap-1 sm:ml-3">
            <span className="uppercase tracking-[0.14em] text-terminal-muted">Levels</span>
            {DEPTH_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLevels(option)}
                className={`rounded-sm border px-2 py-1 font-mono ${
                  levels === option
                    ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                    : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="ml-0 flex items-center gap-1 sm:ml-3">
            <span className="uppercase tracking-[0.14em] text-terminal-muted">Refresh</span>
            {REFRESH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRefreshMs(option.value)}
                className={`rounded-sm border px-2 py-1 font-mono ${
                  refreshMs === option.value
                    ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                    : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
            <span>Bid / Ask Imbalance</span>
            <span className="font-mono">{formatCompact(snapshot?.total_bid_qty ?? 0)} vs {formatCompact(snapshot?.total_ask_qty ?? 0)}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full border border-terminal-border bg-terminal-bg">
            <div className="bg-blue-500/60 transition-all duration-200" style={{ width: `${bidShare}%` }} />
            <div className="bg-red-500/60 transition-all duration-200" style={{ width: `${askShare}%` }} />
          </div>
        </div>

        <div className="overflow-hidden rounded-sm border border-terminal-border bg-terminal-bg">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
            <span className="text-right">Bid Size</span>
            <span className="text-center">Price</span>
            <span>Ask Size</span>
          </div>
          <div ref={scrollRef} className="h-[880px] overflow-y-auto" data-testid="dom-scroll-region">
            {depthQuery.isLoading && !rows.length ? (
              <div className="flex h-full items-center justify-center px-3 py-10 text-xs text-terminal-muted">Loading DOM ladder...</div>
            ) : null}
            {!depthQuery.isLoading && !rows.length ? (
              <div className="flex h-full items-center justify-center px-3 py-10 text-xs text-terminal-muted">No depth available.</div>
            ) : null}
            {rows.map((row) => {
              const bidValue = showCumulative ? row.bidCumulative : row.bidQty;
              const askValue = showCumulative ? row.askCumulative : row.askQty;
              const bidPct = maxDisplayedQty > 0 ? Math.max(0, Math.min(100, (bidValue / maxDisplayedQty) * 100)) : 0;
              const askPct = maxDisplayedQty > 0 ? Math.max(0, Math.min(100, (askValue / maxDisplayedQty) * 100)) : 0;
              const volumePct = maxDisplayedQty > 0 ? Math.max(0, Math.min(100, (row.volumeAtPrice / maxDisplayedQty) * 100)) : 0;
              const isLastTrade = Math.abs(row.price - anchorPrice) < tickSize / 2;
              const isSpreadRow = bestBid > 0 && bestAsk > 0 && row.price < bestAsk && row.price > bestBid;
              const isBestBid = bestBid > 0 && row.price === bestBid;
              const isBestAsk = bestAsk > 0 && row.price === bestAsk;
              const imbalanceGlow =
                row.bidQty > 0 && row.askQty > 0
                  ? row.bidQty >= row.askQty * 2
                    ? "shadow-[inset_0_0_18px_rgba(59,130,246,0.18)]"
                    : row.askQty >= row.bidQty * 2
                      ? "shadow-[inset_0_0_18px_rgba(248,113,113,0.18)]"
                      : ""
                  : row.bidQty > row.askQty * 2
                    ? "shadow-[inset_0_0_18px_rgba(59,130,246,0.18)]"
                    : row.askQty > row.bidQty * 2
                      ? "shadow-[inset_0_0_18px_rgba(248,113,113,0.18)]"
                      : "";

              return (
                <div
                  key={row.price}
                  ref={isLastTrade ? lastPriceRowRef : null}
                  className={`grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] gap-2 border-b border-terminal-border/40 px-3 py-1 font-mono text-xs transition-colors duration-200 ${
                    isLastTrade
                      ? "bg-terminal-accent/20 font-semibold text-terminal-text"
                      : isSpreadRow
                        ? "bg-terminal-bg/50 text-terminal-muted"
                        : "text-terminal-text"
                  } ${imbalanceGlow}`}
                  data-testid="dom-row"
                  data-price={row.price}
                >
                  <div className="relative flex min-h-[22px] items-center justify-end overflow-hidden" data-testid="dom-bid-cell">
                    <div
                      className={`absolute right-0 top-1/2 h-[70%] -translate-y-1/2 rounded-l-sm transition-all duration-200 ${
                        isBestBid ? "bg-blue-500/50" : "bg-blue-500/30"
                      } ${row.bidFlash === "up" ? "ring-1 ring-emerald-400/60" : row.bidFlash === "down" ? "ring-1 ring-red-400/60" : ""}`}
                      style={{ width: `${bidPct}%` }}
                    />
                    <span className="relative z-10 px-2 text-right" data-testid="dom-bid-qty">
                      {formatCompact(bidValue)}
                    </span>
                  </div>
                  <div className="relative flex min-h-[22px] items-center justify-center overflow-hidden text-center" data-testid="dom-price-cell">
                    <div
                      className="absolute left-0 top-1/2 h-[62%] -translate-y-1/2 rounded-sm bg-amber-300/8"
                      style={{ width: `${volumePct}%` }}
                    />
                    <span className="relative z-10">{formatPrice(row.price, decimals)}</span>
                  </div>
                  <div className="relative flex min-h-[22px] items-center justify-start overflow-hidden" data-testid="dom-ask-cell">
                    <div
                      className={`absolute left-0 top-1/2 h-[70%] -translate-y-1/2 rounded-r-sm transition-all duration-200 ${
                        isBestAsk ? "bg-red-500/50" : "bg-red-500/30"
                      } ${row.askFlash === "up" ? "ring-1 ring-emerald-400/60" : row.askFlash === "down" ? "ring-1 ring-red-400/60" : ""}`}
                      style={{ width: `${askPct}%` }}
                    />
                    <span className="relative z-10 px-2" data-testid="dom-ask-qty">
                      {formatCompact(askValue)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </TerminalPanel>
  );
}
