import { useCallback, useEffect } from "react";
import { create } from "zustand";

export type QuotesConnectionState = "connecting" | "connected" | "disconnected";

export type QuoteTick = {
  token: string;
  market: string;
  symbol: string;
  ltp: number;
  change: number;
  change_pct: number;
  oi: number | null;
  volume: number | null;
  ts: string;
};

export type QuoteCandle = {
  token: string;
  interval: string;
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  status?: string;
};

type QuotesStore = {
  connectionState: QuotesConnectionState;
  ticksByToken: Record<string, QuoteTick>;
  candlesByKey: Record<string, QuoteCandle>;
  marketStatus: any | null;
  setConnectionState: (state: QuotesConnectionState) => void;
  upsertTick: (tick: QuoteTick) => void;
  upsertCandle: (candle: QuoteCandle) => void;
  setMarketStatus: (status: any) => void;
};

export const useQuotesStore = create<QuotesStore>((set) => ({
  connectionState: "disconnected",
  ticksByToken: {},
  candlesByKey: {},
  marketStatus: null,
  setConnectionState: (connectionState) => set({ connectionState }),
  upsertTick: (tick) =>
    set((state) => ({
      ticksByToken: {
        ...state.ticksByToken,
        [tick.token]: tick,
      },
    })),
  upsertCandle: (candle) =>
    set((state) => ({
      candlesByKey: {
        ...state.candlesByKey,
        [`${candle.token}|${candle.interval}`]: candle,
      },
    })),
  setMarketStatus: (marketStatus) => set({ marketStatus }),
}));

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
}

function toToken(market: string, symbol: string): string {
  return `${market.trim().toUpperCase()}:${symbol.trim().toUpperCase()}`;
}

function parseToken(token: string): { market: string; symbol: string } | null {
  const [market, symbol] = token.trim().toUpperCase().split(":");
  if (!market || !symbol) return null;
  return { market, symbol };
}

function buildQuotesWsUrl(): string {
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api").trim();
  if (apiBase.startsWith("http://") || apiBase.startsWith("https://")) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/quotes`;
    return url.toString();
  }

  if (typeof window === "undefined") return "/api/ws/quotes";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const normalizedBase = apiBase.startsWith("/") ? apiBase : `/${apiBase}`;
  return `${wsProtocol}//${window.location.host}${normalizedBase.replace(/\/+$/, "")}/ws/quotes`;
}

class QuotesWsManager {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = false;
  private wantedCounts = new Map<string, number>();
  private sentSubscriptions = new Set<string>();
  private listeners = new Set<(tick: QuoteTick) => void>();

  addListener(cb: (tick: QuoteTick) => void) {
    this.listeners.add(cb);
  }

  removeListener(cb: (tick: QuoteTick) => void) {
    this.listeners.delete(cb);
  }

  subscribe(market: string, symbols: string[]) {
    const next = normalizeSymbols(symbols);
    if (!next.length) return;

    for (const symbol of next) {
      const token = toToken(market, symbol);
      this.wantedCounts.set(token, (this.wantedCounts.get(token) || 0) + 1);
    }

    this.shouldReconnect = true;
    this.ensureConnected();
    this.flushSubscriptions();
  }

  unsubscribe(market: string, symbols: string[]) {
    const next = normalizeSymbols(symbols);
    if (!next.length) return;

    for (const symbol of next) {
      const token = toToken(market, symbol);
      const count = this.wantedCounts.get(token) || 0;
      if (count <= 1) {
        this.wantedCounts.delete(token);
      } else {
        this.wantedCounts.set(token, count - 1);
      }
    }

    this.flushSubscriptions();
    if (this.wantedCounts.size === 0) {
      this.shouldReconnect = false;
      this.closeSocket();
    }
  }

  private ensureConnected() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  private connect() {
    this.clearReconnectTimer();
    useQuotesStore.getState().setConnectionState("connecting");
    const ws = new WebSocket(buildQuotesWsUrl());
    this.socket = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.sentSubscriptions.clear();
      useQuotesStore.getState().setConnectionState("connected");
      this.flushSubscriptions();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (!payload) return;

        if (payload.type === "market_status") {
          useQuotesStore.getState().setMarketStatus(payload.data);
          return;
        }

        if (typeof payload.symbol !== "string") return;
        if (payload.type === "candle") {
          const interval = String(payload.interval || "").trim();
          const t = Number(payload.t);
          const o = Number(payload.o);
          const h = Number(payload.h);
          const l = Number(payload.l);
          const c = Number(payload.c);
          const v = Number(payload.v ?? 0);
          if (!interval || ![t, o, h, l, c].every(Number.isFinite)) return;
          useQuotesStore.getState().upsertCandle({
            token: payload.symbol.toUpperCase(),
            interval,
            t,
            o,
            h,
            l,
            c,
            v: Number.isFinite(v) ? v : 0,
            status: typeof payload.status === "string" ? payload.status : undefined,
          });
          return;
        }
        if (payload.type !== "tick") return;
        const parsed = parseToken(payload.symbol);
        if (!parsed) return;
        const ltp = Number(payload.ltp);
        if (!Number.isFinite(ltp)) return;
        const tick: QuoteTick = {
          token: payload.symbol.toUpperCase(),
          market: parsed.market,
          symbol: parsed.symbol,
          ltp,
          change: Number.isFinite(Number(payload.change)) ? Number(payload.change) : 0,
          change_pct: Number.isFinite(Number(payload.change_pct)) ? Number(payload.change_pct) : 0,
          oi: Number.isFinite(Number(payload.oi)) ? Number(payload.oi) : null,
          volume: Number.isFinite(Number(payload.volume)) ? Number(payload.volume) : null,
          ts: typeof payload.ts === "string" ? payload.ts : new Date().toISOString(),
        };
        useQuotesStore.getState().upsertTick(tick);
        this.listeners.forEach((l) => l(tick));
      } catch {
        // Ignore malformed messages.
      }
    };

    ws.onclose = () => {
      this.socket = null;
      this.sentSubscriptions.clear();
      useQuotesStore.getState().setConnectionState("disconnected");
      if (this.shouldReconnect && this.wantedCounts.size > 0) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempt) + Math.round(Math.random() * 300);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private flushSubscriptions() {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const desired = new Set(this.wantedCounts.keys());
    const toSubscribe = Array.from(desired).filter((token) => !this.sentSubscriptions.has(token));
    const toUnsubscribe = Array.from(this.sentSubscriptions).filter((token) => !desired.has(token));

    if (toSubscribe.length) {
      ws.send(JSON.stringify({ op: "subscribe", symbols: toSubscribe }));
      for (const token of toSubscribe) this.sentSubscriptions.add(token);
    }
    if (toUnsubscribe.length) {
      ws.send(JSON.stringify({ op: "unsubscribe", symbols: toUnsubscribe }));
      for (const token of toUnsubscribe) this.sentSubscriptions.delete(token);
    }
  }

  private closeSocket() {
    this.clearReconnectTimer();
    this.sentSubscriptions.clear();
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    } else {
      useQuotesStore.getState().setConnectionState("disconnected");
    }
  }
}

const manager = new QuotesWsManager();

export function useQuotesStream(market: string, onTick?: (tick: QuoteTick) => void) {
  const connectionState = useQuotesStore((s) => s.connectionState);

  useEffect(() => {
    if (!onTick) return;
    manager.addListener(onTick);
    return () => manager.removeListener(onTick);
  }, [onTick]);

  const subscribe = useCallback((symbols: string[]) => manager.subscribe(market, symbols), [market]);
  const unsubscribe = useCallback((symbols: string[]) => manager.unsubscribe(market, symbols), [market]);
  return {
    subscribe,
    unsubscribe,
    connectionState,
    isConnected: connectionState === "connected",
  };
}
