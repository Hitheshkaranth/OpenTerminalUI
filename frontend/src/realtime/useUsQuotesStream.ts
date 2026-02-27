import { useCallback } from "react";
import { create } from "zustand";

export type USQuotesConnectionState = "connecting" | "connected" | "disconnected";

export type USRawTrade = {
  symbol: string;
  p: number;
  v: number;
  t: number;
  ts: string;
  provider?: string;
  latency_ms?: number | null;
};

export type USMinuteBar = {
  symbol: string;
  interval: "1m";
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vwap?: number;
  s?: string;
  ext?: boolean;
  status?: "partial" | "closed" | string;
};

type ProviderHealthPayload = {
  primary_provider?: string;
  providers?: Record<string, Record<string, unknown>>;
  timestamp?: string;
};

type USQuotesStore = {
  connectionState: USQuotesConnectionState;
  lastMessageAt: number | null;
  lastTradeBySymbol: Record<string, USRawTrade>;
  closedBars1mBySymbol: Record<string, USMinuteBar[]>;
  partialBar1mBySymbol: Record<string, USMinuteBar | undefined>;
  providerHealth: ProviderHealthPayload | null;
  setConnectionState: (state: USQuotesConnectionState) => void;
  markMessage: () => void;
  setProviderHealth: (payload: ProviderHealthPayload) => void;
  setBackfill: (symbol: string, bars: USMinuteBar[]) => void;
  upsertBar: (bar: USMinuteBar) => void;
  upsertTrade: (trade: USRawTrade) => void;
  clearSymbol: (symbol: string) => void;
};

function normalizeSymbol(symbol: string): string {
  return String(symbol || "").trim().toUpperCase().replace(/^US:/, "");
}

function buildUsQuotesWsUrl(): string {
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api").trim();
  if (apiBase.startsWith("http://") || apiBase.startsWith("https://")) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/us-quotes`;
    return url.toString();
  }
  if (typeof window === "undefined") return "/api/ws/us-quotes";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const normalizedBase = apiBase.startsWith("/") ? apiBase : `/${apiBase}`;
  return `${wsProtocol}//${window.location.host}${normalizedBase.replace(/\/+$/, "")}/ws/us-quotes`;
}

function sortDedupBars(input: USMinuteBar[], cap = 5000): USMinuteBar[] {
  const byTime = new Map<number, USMinuteBar>();
  for (const row of input) {
    const t = Number(row.t);
    const o = Number(row.o);
    const h = Number(row.h);
    const l = Number(row.l);
    const c = Number(row.c);
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    byTime.set(t, {
      ...row,
      t,
      o,
      h: Math.max(o, h, l, c),
      l: Math.min(o, h, l, c),
      c,
      v: Number.isFinite(Number(row.v)) ? Number(row.v) : 0,
    });
  }
  const out = Array.from(byTime.values()).sort((a, b) => a.t - b.t);
  return out.length > cap ? out.slice(out.length - cap) : out;
}

export const useUSQuotesStore = create<USQuotesStore>((set) => ({
  connectionState: "disconnected",
  lastMessageAt: null,
  lastTradeBySymbol: {},
  closedBars1mBySymbol: {},
  partialBar1mBySymbol: {},
  providerHealth: null,
  setConnectionState: (connectionState) => set({ connectionState }),
  markMessage: () => set({ lastMessageAt: Date.now() }),
  setProviderHealth: (providerHealth) => set({ providerHealth }),
  setBackfill: (symbol, bars) =>
    set((state) => ({
      closedBars1mBySymbol: {
        ...state.closedBars1mBySymbol,
        [normalizeSymbol(symbol)]: sortDedupBars(bars.map((b) => ({ ...b, symbol: normalizeSymbol(symbol), interval: "1m" }))),
      },
    })),
  upsertBar: (bar) =>
    set((state) => {
      const symbol = normalizeSymbol(bar.symbol);
      const normalized: USMinuteBar = {
        ...bar,
        symbol,
        interval: "1m",
        t: Number(bar.t),
        o: Number(bar.o),
        h: Number(bar.h),
        l: Number(bar.l),
        c: Number(bar.c),
        v: Number.isFinite(Number(bar.v)) ? Number(bar.v) : 0,
      };
      if (!["partial", "closed"].includes(String(normalized.status || ""))) {
        normalized.status = "closed";
      }
      if (normalized.status === "partial") {
        return {
          partialBar1mBySymbol: {
            ...state.partialBar1mBySymbol,
            [symbol]: normalized,
          },
        };
      }
      const current = state.closedBars1mBySymbol[symbol] || [];
      const next = sortDedupBars([...current, { ...normalized, status: "closed" }], 5000);
      return {
        closedBars1mBySymbol: {
          ...state.closedBars1mBySymbol,
          [symbol]: next,
        },
        partialBar1mBySymbol: {
          ...state.partialBar1mBySymbol,
          [symbol]: state.partialBar1mBySymbol[symbol]?.t === normalized.t ? undefined : state.partialBar1mBySymbol[symbol],
        },
      };
    }),
  upsertTrade: (trade) =>
    set((state) => ({
      lastTradeBySymbol: {
        ...state.lastTradeBySymbol,
        [normalizeSymbol(trade.symbol)]: { ...trade, symbol: normalizeSymbol(trade.symbol) },
      },
    })),
  clearSymbol: (symbol) =>
    set((state) => {
      const key = normalizeSymbol(symbol);
      const closedBars1mBySymbol = { ...state.closedBars1mBySymbol };
      const partialBar1mBySymbol = { ...state.partialBar1mBySymbol };
      const lastTradeBySymbol = { ...state.lastTradeBySymbol };
      delete closedBars1mBySymbol[key];
      delete partialBar1mBySymbol[key];
      delete lastTradeBySymbol[key];
      return { closedBars1mBySymbol, partialBar1mBySymbol, lastTradeBySymbol };
    }),
}));

class USQuotesWsManager {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = false;
  private wantedSymbolCounts = new Map<string, number>();
  private wantedChannels = new Set<"bars" | "trades">(["bars", "trades"]);
  private sentSymbols = new Set<string>();
  private sentChannels = new Set<"bars" | "trades">();

  subscribe(symbols: string[], channels: Array<"bars" | "trades"> = ["bars", "trades"]) {
    const normalized = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
    if (!normalized.length) return;
    for (const symbol of normalized) {
      this.wantedSymbolCounts.set(symbol, (this.wantedSymbolCounts.get(symbol) || 0) + 1);
    }
    this.wantedChannels = new Set([...(this.wantedChannels || []), ...channels]);
    this.shouldReconnect = true;
    this.ensureConnected();
    this.flushSubscriptions();
  }

  unsubscribe(symbols: string[]) {
    const normalized = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
    if (!normalized.length) return;
    for (const symbol of normalized) {
      const count = this.wantedSymbolCounts.get(symbol) || 0;
      if (count <= 1) {
        this.wantedSymbolCounts.delete(symbol);
      } else {
        this.wantedSymbolCounts.set(symbol, count - 1);
      }
    }
    this.flushSubscriptions();
    if (this.wantedSymbolCounts.size === 0) {
      this.shouldReconnect = false;
      this.closeSocket();
    }
  }

  private ensureConnected() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    this.connect();
  }

  private connect() {
    this.clearReconnectTimer();
    useUSQuotesStore.getState().setConnectionState("connecting");
    const ws = new WebSocket(buildUsQuotesWsUrl());
    this.socket = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.sentSymbols.clear();
      this.sentChannels.clear();
      useUSQuotesStore.getState().setConnectionState("connected");
      this.flushSubscriptions();
    };

    ws.onmessage = (event) => {
      useUSQuotesStore.getState().markMessage();
      try {
        const payload = JSON.parse(String(event.data));
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "provider_health") {
          useUSQuotesStore.getState().setProviderHealth(payload as ProviderHealthPayload);
          return;
        }
        if (payload.type === "backfill") {
          const symbol = normalizeSymbol(String(payload.symbol || ""));
          const bars = Array.isArray((payload as any).bars) ? (payload as any).bars : [];
          useUSQuotesStore.getState().setBackfill(
            symbol,
            bars.map((b: any) => ({
              symbol,
              interval: "1m",
              t: Number(b.t),
              o: Number(b.o),
              h: Number(b.h),
              l: Number(b.l),
              c: Number(b.c),
              v: Number(b.v ?? 0),
              vwap: Number.isFinite(Number(b.vwap)) ? Number(b.vwap) : undefined,
              s: typeof b.s === "string" ? b.s : undefined,
              ext: Boolean(b.ext),
              status: "closed",
            })),
          );
          return;
        }
        if (payload.type === "bar") {
          const bar: USMinuteBar = {
            symbol: normalizeSymbol(String(payload.symbol || "")),
            interval: "1m",
            t: Number(payload.t),
            o: Number(payload.o),
            h: Number(payload.h),
            l: Number(payload.l),
            c: Number(payload.c),
            v: Number(payload.v ?? 0),
            vwap: Number.isFinite(Number(payload.vwap)) ? Number(payload.vwap) : undefined,
            s: typeof payload.s === "string" ? payload.s : undefined,
            ext: Boolean(payload.ext),
            status: typeof payload.status === "string" ? payload.status : "closed",
          };
          useUSQuotesStore.getState().upsertBar(bar);
          return;
        }
        if (payload.type === "trade") {
          const trade: USRawTrade = {
            symbol: normalizeSymbol(String(payload.symbol || "")),
            p: Number(payload.p),
            v: Number(payload.v ?? 0),
            t: Number(payload.t),
            ts: typeof payload.ts === "string" ? payload.ts : new Date(Number(payload.t) || Date.now()).toISOString(),
            provider: typeof payload.provider === "string" ? payload.provider : undefined,
            latency_ms: Number.isFinite(Number(payload.latency_ms)) ? Number(payload.latency_ms) : null,
          };
          if (Number.isFinite(trade.p) && Number.isFinite(trade.t)) {
            useUSQuotesStore.getState().upsertTrade(trade);
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      this.socket = null;
      this.sentSymbols.clear();
      this.sentChannels.clear();
      useUSQuotesStore.getState().setConnectionState("disconnected");
      if (this.shouldReconnect && this.wantedSymbolCounts.size > 0) this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempt) + Math.round(Math.random() * 300);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private flushSubscriptions() {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const desiredSymbols = new Set(this.wantedSymbolCounts.keys());
    const channels = Array.from(this.wantedChannels);
    const toSubscribe = Array.from(desiredSymbols).filter((s) => !this.sentSymbols.has(s));
    const toUnsubscribe = Array.from(this.sentSymbols).filter((s) => !desiredSymbols.has(s));
    if (toSubscribe.length) {
      ws.send(JSON.stringify({ op: "subscribe", symbols: toSubscribe, channels }));
      for (const symbol of toSubscribe) this.sentSymbols.add(symbol);
      this.sentChannels = new Set(channels);
    }
    if (toUnsubscribe.length) {
      ws.send(JSON.stringify({ op: "unsubscribe", symbols: toUnsubscribe }));
      for (const symbol of toUnsubscribe) this.sentSymbols.delete(symbol);
    }
  }

  private closeSocket() {
    this.clearReconnectTimer();
    this.sentSymbols.clear();
    this.sentChannels.clear();
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
    else useUSQuotesStore.getState().setConnectionState("disconnected");
  }
}

const manager = new USQuotesWsManager();

export function isUSMarketCode(market: string): boolean {
  const code = String(market || "").trim().toUpperCase();
  return code === "US" || code === "NASDAQ" || code === "NYSE";
}

export function useUSQuotesStream() {
  const connectionState = useUSQuotesStore((s) => s.connectionState);
  const subscribe = useCallback((symbols: string[], channels?: Array<"bars" | "trades">) => manager.subscribe(symbols, channels), []);
  const unsubscribe = useCallback((symbols: string[]) => manager.unsubscribe(symbols), []);
  return {
    subscribe,
    unsubscribe,
    connectionState,
    isConnected: connectionState === "connected",
  };
}
