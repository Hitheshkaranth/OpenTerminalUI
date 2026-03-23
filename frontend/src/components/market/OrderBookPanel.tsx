import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { useStock } from "../../hooks/useStocks";
import { useQuotesStore, useQuotesStream } from "../../realtime/useQuotesStream";
import { isUSMarketCode, useUSQuotesStore, useUSQuotesStream } from "../../realtime/useUsQuotesStream";

import { DepthChart, type DepthLevel } from "./DepthChart";
import { TimeSalesTape, type TimeSalesRow } from "./TimeSalesTape";

type OrderBookView = "ladder" | "depth" | "tape";
type DepthFeedState = "connecting" | "connected" | "disconnected";

type Props = {
  symbol: string;
  market: string;
  compact?: boolean;
  className?: string;
  defaultView?: OrderBookView;
};

type DepthSideLevel = {
  price: number;
  size: number;
  orders: number;
};

type DepthSnapshot = {
  symbol: string;
  market: string;
  providerKey: string;
  asOf: string;
  midPrice: number;
  spread: number;
  tickSize: number;
  levels: number;
  totalBidQuantity: number;
  totalAskQuantity: number;
  bids: DepthSideLevel[];
  asks: DepthSideLevel[];
};

type LadderRow = {
  price: number;
  bidSize: number;
  bidOrders: number;
  bidCumulative: number;
  askSize: number;
  askOrders: number;
  askCumulative: number;
};

const DEFAULT_DEPTH_LEVELS = 12;
const MAX_TAPE_ROWS = 200;
const FLASH_WINDOW_MS = 900;
const RECONNECT_BASE_DELAY_MS = 800;
const DEPTH_BAR_WIDTH_CLASSES = [
  "w-0",
  "w-[8%]",
  "w-[16%]",
  "w-[24%]",
  "w-[32%]",
  "w-[40%]",
  "w-[48%]",
  "w-[56%]",
  "w-[64%]",
  "w-[72%]",
  "w-[80%]",
  "w-[90%]",
  "w-full",
] as const;

function apiBase(): string {
  return String(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "") || "/api";
}

function buildDepthWsUrl(): string {
  const base = String(import.meta.env.VITE_API_BASE_URL || "/api").trim();
  if (base.startsWith("http://") || base.startsWith("https://")) {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/depth`;
    return url.toString();
  }

  if (typeof window === "undefined") return "/api/ws/depth";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const normalizedBase = base.startsWith("/") ? base : `/${base}`;
  return `${wsProtocol}//${window.location.host}${normalizedBase.replace(/\/+$/, "")}/ws/depth`;
}

function normalizeSymbol(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function normalizeMarket(value: string): string {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "NSE" || raw === "BSE" || raw === "IN") return "IN";
  if (raw === "CRYPTO" || raw === "BINANCE") return "CRYPTO";
  return "US";
}

function normalizeDepthSide(raw: unknown): DepthSideLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const record = row as Record<string, unknown>;
      const price = Number(record.price);
      const size = Number(record.size);
      const orders = Number(record.orders);
      if (!Number.isFinite(price) || !Number.isFinite(size)) return null;
      return {
        price,
        size: Math.max(0, Math.round(size)),
        orders: Number.isFinite(orders) ? Math.max(0, Math.round(orders)) : 0,
      };
    })
    .filter((row): row is DepthSideLevel => Boolean(row));
}

function normalizeDepthSnapshot(raw: unknown): DepthSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const symbol = normalizeSymbol(String(payload.symbol ?? ""));
  if (!symbol) return null;

  return {
    symbol,
    market: normalizeMarket(String(payload.market ?? "US")),
    providerKey: String(payload.provider_key ?? payload.providerKey ?? "synthetic").trim() || "synthetic",
    asOf: typeof payload.as_of === "string" ? payload.as_of : typeof payload.asOf === "string" ? payload.asOf : new Date().toISOString(),
    midPrice: Number.isFinite(Number(payload.mid_price ?? payload.midPrice)) ? Number(payload.mid_price ?? payload.midPrice) : 0,
    spread: Number.isFinite(Number(payload.spread)) ? Number(payload.spread) : 0,
    tickSize: Number.isFinite(Number(payload.tick_size ?? payload.tickSize)) ? Number(payload.tick_size ?? payload.tickSize) : 0,
    levels: Number.isFinite(Number(payload.levels)) ? Number(payload.levels) : DEFAULT_DEPTH_LEVELS,
    totalBidQuantity: Number.isFinite(Number(payload.total_bid_quantity ?? payload.totalBidQuantity))
      ? Number(payload.total_bid_quantity ?? payload.totalBidQuantity)
      : 0,
    totalAskQuantity: Number.isFinite(Number(payload.total_ask_quantity ?? payload.totalAskQuantity))
      ? Number(payload.total_ask_quantity ?? payload.totalAskQuantity)
      : 0,
    bids: normalizeDepthSide(payload.bids),
    asks: normalizeDepthSide(payload.asks),
  };
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "--";
  return price >= 1000 ? price.toFixed(1) : price.toFixed(2);
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function buildChartLevels(snapshot: DepthSnapshot | null): DepthLevel[] {
  if (!snapshot) return [];
  const levels: DepthLevel[] = [];
  for (const bid of snapshot.bids) {
    levels.push({ price: bid.price, bidSize: bid.size, askSize: 0 });
  }
  for (const ask of snapshot.asks) {
    levels.push({ price: ask.price, bidSize: 0, askSize: ask.size });
  }
  return levels.sort((left, right) => left.price - right.price);
}

function mergeTapeRows(rows: TimeSalesRow[], next: TimeSalesRow): TimeSalesRow[] {
  if (rows[0]?.id === next.id) return rows;
  const merged = [next, ...rows.filter((row) => row.id !== next.id)];
  return merged.slice(0, MAX_TAPE_ROWS);
}

function deriveFallbackTrade(symbol: string, lastPrice: number, volume: number, ts: string): TimeSalesRow {
  return {
    id: `${symbol}:${ts}:${lastPrice.toFixed(4)}`,
    price: lastPrice,
    size: Math.max(1, Math.round(volume || 100)),
    side: volume % 2 === 0 ? "buy" : "sell",
    ts,
  };
}

function buildLadderRows(snapshot: DepthSnapshot | null): LadderRow[] {
  if (!snapshot) return [];

  const byPrice = new Map<number, LadderRow>();
  let runningBid = 0;
  for (const level of snapshot.bids) {
    runningBid += level.size;
    byPrice.set(level.price, {
      price: level.price,
      bidSize: level.size,
      bidOrders: level.orders,
      bidCumulative: runningBid,
      askSize: 0,
      askOrders: 0,
      askCumulative: 0,
    });
  }

  let runningAsk = 0;
  for (const level of snapshot.asks) {
    runningAsk += level.size;
    const existing = byPrice.get(level.price);
    if (existing) {
      existing.askSize = level.size;
      existing.askOrders = level.orders;
      existing.askCumulative = runningAsk;
    } else {
      byPrice.set(level.price, {
        price: level.price,
        bidSize: 0,
        bidOrders: 0,
        bidCumulative: 0,
        askSize: level.size,
        askOrders: level.orders,
        askCumulative: runningAsk,
      });
    }
  }

  return Array.from(byPrice.values()).sort((left, right) => right.price - left.price);
}

function barWidthClass(size: number, maxSize: number): string {
  if (!Number.isFinite(size) || size <= 0 || maxSize <= 0) return DEPTH_BAR_WIDTH_CLASSES[0];
  const ratio = Math.min(1, Math.max(0, size / maxSize));
  const bucket = Math.max(1, Math.ceil(ratio * (DEPTH_BAR_WIDTH_CLASSES.length - 1)));
  return DEPTH_BAR_WIDTH_CLASSES[bucket];
}

async function fetchDepthSnapshot(symbol: string, market: string, levels = DEFAULT_DEPTH_LEVELS): Promise<DepthSnapshot | null> {
  const params = new URLSearchParams({
    market,
    levels: String(levels),
  });
  const response = await fetch(`${apiBase()}/depth/${encodeURIComponent(symbol)}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Depth snapshot failed: ${response.status}`);
  }
  return normalizeDepthSnapshot(await response.json());
}

export function OrderBookPanel({
  symbol,
  market,
  compact = false,
  className = "",
  defaultView = "ladder",
}: Props) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedMarket = String(market || "").trim().toUpperCase() || "NASDAQ";
  const depthMarket = normalizeMarket(normalizedMarket);
  const isUS = isUSMarketCode(normalizedMarket);
  const { data: stock } = useStock(normalizedSymbol);
  const quoteToken = `${normalizedMarket}:${normalizedSymbol}`;
  const quoteTick = useQuotesStore((state) => state.ticksByToken[quoteToken]);
  const usTrade = useUSQuotesStore((state) => state.lastTradeBySymbol[normalizedSymbol]);
  const [view, setView] = useState<OrderBookView>(defaultView);
  const [tapeRows, setTapeRows] = useState<TimeSalesRow[]>([]);
  const [depthSnapshot, setDepthSnapshot] = useState<DepthSnapshot | null>(null);
  const [depthConnectionState, setDepthConnectionState] = useState<DepthFeedState>("disconnected");
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [flashByPrice, setFlashByPrice] = useState<Record<string, number>>({});
  const lastTradeIdRef = useRef<string | null>(null);
  const lastFallbackIdRef = useRef<string | null>(null);
  const previousLadderRef = useRef<Record<string, { bidSize: number; askSize: number }>>({});
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const {
    subscribe: subscribeQuotes,
    unsubscribe: unsubscribeQuotes,
    connectionState: quotesConnectionState,
  } = useQuotesStream(normalizedMarket);
  const {
    subscribe: subscribeUS,
    unsubscribe: unsubscribeUS,
    connectionState: usConnectionState,
  } = useUSQuotesStream();

  const pullSnapshot = useCallback(async () => {
    if (!normalizedSymbol) {
      setDepthSnapshot(null);
      return;
    }
    try {
      const snapshot = await fetchDepthSnapshot(normalizedSymbol, depthMarket, DEFAULT_DEPTH_LEVELS);
      if (snapshot) {
        setDepthSnapshot(snapshot);
      }
    } catch {
      // The depth websocket can still hydrate state if the REST route is unavailable.
    }
  }, [depthMarket, normalizedSymbol]);

  useEffect(() => {
    if (!normalizedSymbol) return;
    if (isUS) {
      subscribeUS([normalizedSymbol], ["trades"]);
      return () => unsubscribeUS([normalizedSymbol]);
    }
    subscribeQuotes([normalizedSymbol]);
    return () => unsubscribeQuotes([normalizedSymbol]);
  }, [isUS, normalizedSymbol, subscribeQuotes, subscribeUS, unsubscribeQuotes, unsubscribeUS]);

  useEffect(() => {
    void pullSnapshot();
  }, [pullSnapshot]);

  useEffect(() => {
    if (!normalizedSymbol) return;
    let active = true;
    let socket: WebSocket | null = null;

    const clearReconnect = () => {
      if (!reconnectTimerRef.current) return;
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };

    const connect = () => {
      clearReconnect();
      setDepthConnectionState("connecting");
      socket = new WebSocket(buildDepthWsUrl());
      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setDepthConnectionState("connected");
        socket?.send(
          JSON.stringify({
            op: "subscribe",
            symbols: [normalizedSymbol],
            market: depthMarket,
            channels: ["depth"],
          }),
        );
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          if (payload?.type !== "depth") return;
          const next = normalizeDepthSnapshot(payload.snapshot);
          if (next) {
            setDepthSnapshot(next);
          }
        } catch {
          // Ignore malformed frames.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        socket = null;
        setDepthConnectionState("disconnected");
        if (!active) return;
        const delay = Math.min(5_000, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (active) connect();
        }, delay);
      };
    };

    connect();
    return () => {
      active = false;
      clearReconnect();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: "unsubscribe", symbols: [normalizedSymbol], channels: ["depth"] }));
      }
      socket?.close();
    };
  }, [depthMarket, normalizedSymbol]);

  const lastPrice = useMemo(() => {
    const tradePrice = Number(usTrade?.p);
    if (Number.isFinite(tradePrice) && tradePrice > 0) return tradePrice;
    const tickPrice = Number(quoteTick?.ltp);
    if (Number.isFinite(tickPrice) && tickPrice > 0) return tickPrice;
    const snapshotMid = Number(depthSnapshot?.midPrice);
    if (Number.isFinite(snapshotMid) && snapshotMid > 0) return snapshotMid;
    const stockPrice = Number(stock?.current_price);
    if (Number.isFinite(stockPrice) && stockPrice > 0) return stockPrice;
    return 0;
  }, [depthSnapshot?.midPrice, quoteTick?.ltp, stock?.current_price, usTrade?.p]);

  useEffect(() => {
    if (!normalizedSymbol) return;
    if (isUS) {
      const tradePrice = Number(usTrade?.p);
      const tradeTs = Number(usTrade?.t);
      if (!Number.isFinite(tradePrice) || !Number.isFinite(tradeTs)) return;
      const next: TimeSalesRow = {
        id: `${normalizedSymbol}:${tradeTs}:${tradePrice.toFixed(4)}`,
        price: tradePrice,
        size: Math.max(1, Math.round(Number(usTrade?.v || 0))),
        side: Number(usTrade?.latency_ms || 0) % 2 === 0 ? "buy" : "sell",
        ts: usTrade?.ts || new Date(tradeTs).toISOString(),
      };
      if (lastTradeIdRef.current === next.id) return;
      lastTradeIdRef.current = next.id;
      setTapeRows((prev) => mergeTapeRows(prev, next));
      return;
    }

    const tickPrice = Number(quoteTick?.ltp);
    const tickVolume = Number(quoteTick?.volume ?? 0);
    const tickChange = Number(quoteTick?.change ?? 0);
    const tickTs = typeof quoteTick?.ts === "string" ? quoteTick.ts : "";
    if (!Number.isFinite(tickPrice) || tickPrice <= 0 || !tickTs) return;
    const next: TimeSalesRow = {
      ...deriveFallbackTrade(normalizedSymbol, tickPrice, tickVolume, tickTs),
      side: tickChange >= 0 ? "buy" : "sell",
    };
    if (lastFallbackIdRef.current === next.id) return;
    lastFallbackIdRef.current = next.id;
    setTapeRows((prev) => mergeTapeRows(prev, next));
  }, [isUS, normalizedSymbol, quoteTick?.change, quoteTick?.ltp, quoteTick?.ts, quoteTick?.volume, usTrade?.latency_ms, usTrade?.p, usTrade?.t, usTrade?.ts, usTrade?.v]);

  const depthLevels = useMemo(() => buildChartLevels(depthSnapshot), [depthSnapshot]);
  const ladderRows = useMemo(() => buildLadderRows(depthSnapshot), [depthSnapshot]);
  const maxLevelSize = useMemo(() => ladderRows.reduce((best, row) => Math.max(best, row.bidSize, row.askSize), 1), [ladderRows]);
  const bestBid = depthSnapshot?.bids[0] ?? null;
  const bestAsk = depthSnapshot?.asks[0] ?? null;
  const spread = useMemo(() => {
    if (Number.isFinite(Number(depthSnapshot?.spread)) && Number(depthSnapshot?.spread) > 0) {
      return Number(depthSnapshot?.spread);
    }
    if (bestBid && bestAsk) {
      return bestAsk.price - bestBid.price;
    }
    return 0;
  }, [bestAsk, bestBid, depthSnapshot?.spread]);
  const midPrice = useMemo(() => {
    if (Number.isFinite(Number(depthSnapshot?.midPrice)) && Number(depthSnapshot?.midPrice) > 0) {
      return Number(depthSnapshot?.midPrice);
    }
    if (bestBid && bestAsk) {
      return (bestBid.price + bestAsk.price) / 2;
    }
    return lastPrice;
  }, [bestAsk, bestBid, depthSnapshot?.midPrice, lastPrice]);

  useEffect(() => {
    setSelectedRowIndex((prev) => {
      if (!ladderRows.length) return 0;
      return Math.max(0, Math.min(prev, ladderRows.length - 1));
    });
  }, [ladderRows.length]);

  useEffect(() => {
    if (!ladderRows.length) return;
    const nextMap: Record<string, { bidSize: number; askSize: number }> = {};
    const changed: Record<string, number> = {};
    for (const row of ladderRows) {
      const key = row.price.toFixed(6);
      nextMap[key] = { bidSize: row.bidSize, askSize: row.askSize };
      const previous = previousLadderRef.current[key];
      if (previous && (previous.bidSize !== row.bidSize || previous.askSize !== row.askSize)) {
        changed[key] = Date.now();
      }
    }
    previousLadderRef.current = nextMap;
    if (!Object.keys(changed).length) return;
    setFlashByPrice((prev) => ({ ...prev, ...changed }));
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => {
      setFlashByPrice((prev) => {
        const now = Date.now();
        return Object.fromEntries(Object.entries(prev).filter(([, ts]) => now - ts < FLASH_WINDOW_MS));
      });
    }, FLASH_WINDOW_MS);
  }, [ladderRows]);

  useEffect(() => {
    const node = rowRefs.current[selectedRowIndex];
    node?.scrollIntoView({ block: "nearest" });
  }, [selectedRowIndex]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const handleLadderKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!ladderRows.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedRowIndex((prev) => Math.min(ladderRows.length - 1, prev + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedRowIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const row = ladderRows[selectedRowIndex];
        if (row) {
          setSelectedPrice(row.price);
        }
      }
    },
    [ladderRows, selectedRowIndex],
  );

  const selectedRow = ladderRows[selectedRowIndex] ?? null;
  const densityRowClass = compact ? "py-1.5 text-[10px]" : "py-2 text-[11px]";

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Order Book</div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[10px] text-terminal-text">
            {normalizedSymbol}
          </div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[10px] text-terminal-muted">
            {depthMarket}
          </div>
          {selectedPrice !== null ? (
            <div className="rounded border border-terminal-accent/40 bg-terminal-accent/10 px-2 py-1 text-[10px] text-terminal-accent">
              Selected {formatPrice(selectedPrice)}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {(["ladder", "depth", "tape"] as OrderBookView[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                view === option
                  ? "border-terminal-accent bg-terminal-accent/12 text-terminal-accent"
                  : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
              }`}
              onClick={() => setView(option)}
            >
              {option === "tape" ? "Time & Sales" : option}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.14em]">
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Last</div>
          <div className="mt-1 text-terminal-text">{lastPrice > 0 ? formatPrice(lastPrice) : "--"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Mid</div>
          <div className="mt-1 text-terminal-text">{midPrice > 0 ? formatPrice(midPrice) : "--"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Spread</div>
          <div className="mt-1 text-terminal-text">{spread > 0 ? formatPrice(spread) : "--"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Feed</div>
          <div className={`mt-1 ${depthConnectionState === "connected" ? "text-terminal-pos" : depthConnectionState === "connecting" ? "text-terminal-warn" : "text-terminal-neg"}`}>
            {depthConnectionState}
          </div>
          <div className="mt-1 text-[9px] text-terminal-muted">
            {depthSnapshot?.providerKey ?? (isUS ? usConnectionState : quotesConnectionState)}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {view === "depth" ? <DepthChart levels={depthLevels} midPrice={midPrice} compact={compact} /> : null}
        {view === "tape" ? <TimeSalesTape rows={tapeRows} compact={compact} /> : null}
        {view === "ladder" ? (
          <div
            tabIndex={0}
            onKeyDown={handleLadderKeyDown}
            className="h-full min-h-[220px] overflow-auto rounded border border-terminal-border bg-terminal-bg outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent"
          >
            <div className="sticky top-0 grid grid-cols-[1fr_1fr_0.7fr_auto_0.7fr_1fr_1fr] gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
              <span className="text-left">Bid Size</span>
              <span className="text-left">Bid Cum</span>
              <span className="text-left">Ord</span>
              <span className="text-center">Price</span>
              <span className="text-right">Ord</span>
              <span className="text-right">Ask Cum</span>
              <span className="text-right">Ask Size</span>
            </div>
            <div className="divide-y divide-terminal-border/50">
              {!ladderRows.length ? (
                <div className="px-3 py-8 text-center text-[11px] text-terminal-muted">Depth unavailable</div>
              ) : null}
              {ladderRows.map((row, index) => {
                const priceKey = row.price.toFixed(6);
                const changed = Boolean(flashByPrice[priceKey] && Date.now() - flashByPrice[priceKey] < FLASH_WINDOW_MS);
                const selected = index === selectedRowIndex || row.price === selectedPrice;
                const previousRow = ladderRows[index - 1];
                const showSpreadRow = Boolean(previousRow && previousRow.askSize > 0 && row.bidSize > 0);
                return (
                  <div key={priceKey}>
                    {showSpreadRow ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-y border-terminal-border/60 bg-terminal-panel/60 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-terminal-muted">
                        <span>Best Ask {bestAsk ? formatPrice(bestAsk.price) : "--"}</span>
                        <span className="text-center">Spread {spread > 0 ? formatPrice(spread) : "--"}</span>
                        <span className="text-right">Best Bid {bestBid ? formatPrice(bestBid.price) : "--"}</span>
                      </div>
                    ) : null}
                    <div
                      ref={(node) => {
                        rowRefs.current[index] = node;
                      }}
                      onClick={() => {
                        setSelectedRowIndex(index);
                        setSelectedPrice(row.price);
                      }}
                      className={`grid cursor-pointer grid-cols-[1fr_1fr_0.7fr_auto_0.7fr_1fr_1fr] items-center gap-2 px-3 ${densityRowClass} ${
                        selected ? "bg-terminal-accent/10" : changed ? "bg-terminal-accent/5" : ""
                      }`}
                    >
                      <div className="relative flex items-center justify-start overflow-hidden">
                        {row.bidSize > 0 ? (
                          <>
                            <div
                              className={`absolute inset-y-0 left-0 rounded bg-emerald-500/18 ${barWidthClass(row.bidSize, maxLevelSize)} ${changed ? "animate-pulse" : ""}`}
                            />
                            <span className="relative z-10 font-mono text-terminal-pos">{formatCompactNumber(row.bidSize)}</span>
                          </>
                        ) : (
                          <span className="text-terminal-muted">-</span>
                        )}
                      </div>
                      <div className="text-left font-mono text-terminal-muted">
                        {row.bidCumulative > 0 ? formatCompactNumber(row.bidCumulative) : "-"}
                      </div>
                      <div className="text-left font-mono text-terminal-muted">
                        {row.bidOrders > 0 ? formatCompactNumber(row.bidOrders) : "-"}
                      </div>
                      <div className={`text-center font-semibold ${selected ? "text-terminal-accent" : "text-terminal-text"}`}>
                        {formatPrice(row.price)}
                      </div>
                      <div className="text-right font-mono text-terminal-muted">
                        {row.askOrders > 0 ? formatCompactNumber(row.askOrders) : "-"}
                      </div>
                      <div className="text-right font-mono text-terminal-muted">
                        {row.askCumulative > 0 ? formatCompactNumber(row.askCumulative) : "-"}
                      </div>
                      <div className="relative flex items-center justify-end overflow-hidden">
                        {row.askSize > 0 ? (
                          <>
                            <div
                              className={`absolute inset-y-0 right-0 rounded bg-rose-500/18 ${barWidthClass(row.askSize, maxLevelSize)} ${changed ? "animate-pulse" : ""}`}
                            />
                            <span className="relative z-10 font-mono text-terminal-neg">{formatCompactNumber(row.askSize)}</span>
                          </>
                        ) : (
                          <span className="text-terminal-muted">-</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedRow ? (
              <div className="sticky bottom-0 grid grid-cols-4 gap-2 border-t border-terminal-border bg-terminal-panel px-3 py-2 text-[10px] uppercase tracking-[0.14em]">
                <div>
                  <div className="text-terminal-muted">Selected</div>
                  <div className="mt-1 text-terminal-text">{formatPrice(selectedRow.price)}</div>
                </div>
                <div>
                  <div className="text-terminal-muted">Bid Qty</div>
                  <div className="mt-1 text-terminal-pos">{selectedRow.bidSize ? formatCompactNumber(selectedRow.bidSize) : "--"}</div>
                </div>
                <div>
                  <div className="text-terminal-muted">Ask Qty</div>
                  <div className="mt-1 text-terminal-neg">{selectedRow.askSize ? formatCompactNumber(selectedRow.askSize) : "--"}</div>
                </div>
                <div>
                  <div className="text-terminal-muted">Depth As Of</div>
                  <div className="mt-1 text-terminal-text">
                    {depthSnapshot?.asOf ? new Date(depthSnapshot.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
