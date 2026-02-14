import { fetchQuotesBatch } from "../api/client";

export type ConnectionState = "LIVE (polling)" | "DISCONNECTED";

export type PriceUpdate = {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  ts: number;
};

type SubscribeArgs = {
  market: string;
  symbols: string[];
  onUpdate: (updates: PriceUpdate[]) => void;
  onStateChange?: (state: ConnectionState) => void;
};

type Subscription = {
  id: number;
  market: string;
  symbols: Set<string>;
  onUpdate: (updates: PriceUpdate[]) => void;
  onStateChange?: (state: ConnectionState) => void;
};

type MarketBucket = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  state: ConnectionState;
  subscribers: Set<number>;
};

const POLL_MS = 1500;

let nextId = 1;
const subscriptions = new Map<number, Subscription>();
const markets = new Map<string, MarketBucket>();

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
}

function getBucket(market: string): MarketBucket {
  const key = market.toUpperCase();
  const existing = markets.get(key);
  if (existing) return existing;
  const created: MarketBucket = {
    timer: null,
    inFlight: false,
    state: "DISCONNECTED",
    subscribers: new Set<number>(),
  };
  markets.set(key, created);
  return created;
}

function getMarketSymbols(market: string): string[] {
  const out = new Set<string>();
  const key = market.toUpperCase();
  for (const sub of subscriptions.values()) {
    if (sub.market === key) {
      for (const symbol of sub.symbols) out.add(symbol);
    }
  }
  return Array.from(out);
}

function setState(market: string, nextState: ConnectionState) {
  const key = market.toUpperCase();
  const bucket = getBucket(key);
  if (bucket.state === nextState) return;
  bucket.state = nextState;
  for (const subId of bucket.subscribers) {
    const sub = subscriptions.get(subId);
    sub?.onStateChange?.(nextState);
  }
}

async function pollMarket(market: string) {
  const key = market.toUpperCase();
  const bucket = getBucket(key);
  if (bucket.inFlight) return;
  bucket.inFlight = true;
  const symbols = getMarketSymbols(key);
  if (!symbols.length) {
    setState(key, "DISCONNECTED");
    bucket.inFlight = false;
    return;
  }

  try {
    const payload = await fetchQuotesBatch(symbols, key);
    if (payload.status === "unavailable") {
      setState(key, "DISCONNECTED");
      return;
    }
    const updates: PriceUpdate[] = payload.quotes
      .map((row) => {
        const rawLast = Number(row.last);
        if (!Number.isFinite(rawLast)) return null;
        const change = Number.isFinite(Number(row.change)) ? Number(row.change) : 0;
        const changePct = Number.isFinite(Number(row.changePct)) ? Number(row.changePct) : 0;
        const ts = Number.isFinite(Date.parse(row.ts)) ? Date.parse(row.ts) : Date.now();
        return {
          symbol: String(row.symbol || "").toUpperCase(),
          last: rawLast,
          change,
          changePct,
          ts,
        } satisfies PriceUpdate;
      })
      .filter((item): item is PriceUpdate => Boolean(item));

    const bySymbol = new Map(updates.map((item) => [item.symbol, item]));
    for (const subId of bucket.subscribers) {
      const sub = subscriptions.get(subId);
      if (!sub) continue;
      const scoped = Array.from(sub.symbols)
        .map((symbol) => bySymbol.get(symbol))
        .filter((item): item is PriceUpdate => Boolean(item));
      if (scoped.length) sub.onUpdate(scoped);
    }
    setState(key, "LIVE (polling)");
  } catch {
    setState(key, "DISCONNECTED");
  } finally {
    bucket.inFlight = false;
  }
}

function ensureTimer(market: string) {
  const key = market.toUpperCase();
  const bucket = getBucket(key);
  if (bucket.timer) return;
  bucket.timer = setInterval(() => {
    void pollMarket(key);
  }, POLL_MS);
  void pollMarket(key);
}

function cleanupMarket(market: string) {
  const key = market.toUpperCase();
  const bucket = markets.get(key);
  if (!bucket) return;
  if (bucket.subscribers.size > 0 && getMarketSymbols(key).length > 0) return;
  if (bucket.timer) {
    clearInterval(bucket.timer);
    bucket.timer = null;
  }
  bucket.state = "DISCONNECTED";
}

export function subscribe({ market, symbols, onUpdate, onStateChange }: SubscribeArgs): () => void {
  const key = market.toUpperCase();
  const nextSymbols = normalizeSymbols(symbols);
  const id = nextId++;
  const sub: Subscription = {
    id,
    market: key,
    symbols: new Set(nextSymbols),
    onUpdate,
    onStateChange,
  };
  subscriptions.set(id, sub);
  const bucket = getBucket(key);
  bucket.subscribers.add(id);
  onStateChange?.(bucket.state);
  ensureTimer(key);

  return () => {
    const active = subscriptions.get(id);
    if (!active) return;
    subscriptions.delete(id);
    const b = markets.get(active.market);
    b?.subscribers.delete(id);
    cleanupMarket(active.market);
  };
}

export function unsubscribe(symbols: string[]) {
  const target = new Set(normalizeSymbols(symbols));
  if (!target.size) return;
  for (const sub of subscriptions.values()) {
    for (const symbol of target) {
      sub.symbols.delete(symbol);
    }
    if (sub.symbols.size === 0) {
      subscriptions.delete(sub.id);
      const bucket = markets.get(sub.market);
      bucket?.subscribers.delete(sub.id);
      cleanupMarket(sub.market);
    }
  }
}
