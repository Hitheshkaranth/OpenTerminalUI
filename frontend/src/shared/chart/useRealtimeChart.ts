import { useEffect, useMemo, useState } from "react";
import type { Bar } from "oakscriptjs";

import { useQuotesStore, useQuotesStream } from "../../realtime/useQuotesStream";
import { isUSMarketCode, useUSQuotesStore, useUSQuotesStream } from "../../realtime/useUsQuotesStream";
import { candleBoundary } from "./chartUtils";
import type { ChartTimeframe } from "./types";

type RealtimeMeta = {
  status: "live" | "delayed" | "disconnected";
  lastTickTs?: number | null;
  currentBar?: { open: number; high: number; low: number; close: number; volume: number; time: number } | null;
};

type RealtimeResult = {
  bars: Bar[];
  liveTick: { ltp: number; change_pct: number } | null;
  realtimeMeta: RealtimeMeta;
};

function normalizeBars(input: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const row of input) {
    const time = Number(row.time);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume ?? 0);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }
    const next: Bar = {
      time,
      open,
      high: Math.max(open, high, low, close),
      low: Math.min(open, high, low, close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    };
    if ((row as any).s) (next as any).s = (row as any).s;
    if ((row as any).ext) (next as any).ext = (row as any).ext;
    byTime.set(time, next);
  }
  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function wsCandleInterval(timeframe: ChartTimeframe): string | null {
  if (timeframe === "1m") return "1m";
  if (timeframe === "5m") return "5m";
  if (timeframe === "15m") return "15m";
  return null;
}

export function aggregateBarsFrom1m(input: Bar[], timeframe: ChartTimeframe): Bar[] {
  if (!["1m", "2m", "5m", "15m", "30m"].includes(timeframe)) return normalizeBars(input);
  if (timeframe === "1m") return normalizeBars(input);
  const byBucket = new Map<number, Bar>();
  for (const row of normalizeBars(input)) {
    const ts = Number(row.time);
    const bucket = candleBoundary(ts, timeframe);
    const existing = byBucket.get(bucket);
    if (!existing) {
      const next: Bar = {
        time: bucket,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
      };
      if ((row as any).s) (next as any).s = (row as any).s;
      if ((row as any).ext) (next as any).ext = (row as any).ext;
      byBucket.set(bucket, next);
      continue;
    }
    existing.high = Math.max(Number(existing.high), Number(row.high));
    existing.low = Math.min(Number(existing.low), Number(row.low));
    existing.close = Number(row.close);
    existing.volume = Number(existing.volume ?? 0) + Number(row.volume ?? 0);
    if ((row as any).ext) (existing as any).ext = true;
    const session = (existing as any).s;
    const rowSession = (row as any).s;
    if (!session && rowSession) (existing as any).s = rowSession;
    if (session === "regular" && rowSession && rowSession !== "regular") (existing as any).s = rowSession;
  }
  return Array.from(byBucket.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function mergeUSBars(closedBars: any[], partialBar?: any): Bar[] {
  const rows: Bar[] = [];
  for (const row of closedBars || []) {
    const t = Math.floor(Number(row.t) / 1000);
    if (!Number.isFinite(t)) continue;
    const bar: Bar = {
      time: t,
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v ?? 0),
    };
    if (typeof row.s === "string") (bar as any).s = row.s;
    if (typeof row.ext === "boolean") (bar as any).ext = row.ext;
    rows.push(bar);
  }
  if (partialBar && Number.isFinite(Number(partialBar.t))) {
    const t = Math.floor(Number(partialBar.t) / 1000);
    const bar: Bar = {
      time: t,
      open: Number(partialBar.o),
      high: Number(partialBar.h),
      low: Number(partialBar.l),
      close: Number(partialBar.c),
      volume: Number(partialBar.v ?? 0),
    };
    if (typeof partialBar.s === "string") (bar as any).s = partialBar.s;
    if (typeof partialBar.ext === "boolean") (bar as any).ext = partialBar.ext;
    rows.push(bar);
  }
  return normalizeBars(rows);
}

// Stable empty reference — prevents zustand from triggering re-renders on every store
// update when closedBars1mBySymbol has no entry for the current symbol yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _EMPTY_CLOSED_BARS: any[] = [];

export function useRealtimeChart(
  market: string,
  symbol: string,
  timeframe: ChartTimeframe,
  seedBars: Bar[],
  enabled: boolean,
): RealtimeResult {
  const token = `${market.toUpperCase()}:${symbol.toUpperCase()}`;
  const usSymbol = symbol.toUpperCase();
  const isUS = isUSMarketCode(market);
  const supportsUSStreamingBars = isUS && ["1m", "2m", "5m", "15m", "30m"].includes(timeframe);

  const { subscribe, unsubscribe } = useQuotesStream(market);
  const legacyConnectionState = useQuotesStore((s) => s.connectionState);
  const tick = useQuotesStore((s) => s.ticksByToken[token]);
  const candleInterval = wsCandleInterval(timeframe);
  const liveCandle = useQuotesStore((s) => (candleInterval ? s.candlesByKey[`${token}|${candleInterval}`] : undefined));

  const { subscribe: subscribeUS, unsubscribe: unsubscribeUS } = useUSQuotesStream();
  const usConnectionState = useUSQuotesStore((s) => s.connectionState);
  const usLastMessageAt = useUSQuotesStore((s) => s.lastMessageAt);
  const usTrade = useUSQuotesStore((s) => s.lastTradeBySymbol[usSymbol]);
  // Use stable module-level fallback instead of inline `|| []` to avoid creating a new
  // array reference on every store update — which would cause spurious re-renders via
  // zustand's Object.is selector comparison.
  const usClosedBars = useUSQuotesStore((s) => s.closedBars1mBySymbol[usSymbol] || _EMPTY_CLOSED_BARS);
  const usPartialBar = useUSQuotesStore((s) => s.partialBar1mBySymbol[usSymbol]);

  const [bars, setBars] = useState<Bar[]>(normalizeBars(seedBars));

  const effectiveUSBars = useMemo(() => {
    if (!supportsUSStreamingBars) return null;
    const merged1m = mergeUSBars(usClosedBars, usPartialBar);
    if (!merged1m.length) return null;
    return aggregateBarsFrom1m(merged1m, timeframe);
  }, [supportsUSStreamingBars, usClosedBars, usPartialBar, timeframe]);

  useEffect(() => {
    if (supportsUSStreamingBars && effectiveUSBars) {
      setBars(effectiveUSBars);
      return;
    }
    // Use a functional update with a structural bail-out: if normalizeBars produces a
    // result with the same length and same first/last timestamps as the current bars
    // (i.e., the data hasn't actually changed), keep the previous reference to avoid
    // triggering downstream effects that depend on `bars` (realtimeMeta → onRealtimeMeta
    // → setChartRealtimeMeta → parent re-render → React error #185 cascade).
    const next = normalizeBars(seedBars);
    setBars((prev) => {
      if (
        prev.length === next.length &&
        prev.length > 0 &&
        prev[0]?.time === next[0]?.time &&
        prev[prev.length - 1]?.time === next[next.length - 1]?.time
      ) {
        return prev;
      }
      if (prev.length === 0 && next.length === 0) return prev;
      return next;
    });
  }, [seedBars, symbol, timeframe, supportsUSStreamingBars, effectiveUSBars]);

  useEffect(() => {
    if (!enabled || !symbol) return;
    if (supportsUSStreamingBars) {
      subscribeUS([symbol], ["bars", "trades"]);
      return () => unsubscribeUS([symbol]);
    }
    subscribe([symbol]);
    return () => unsubscribe([symbol]);
  }, [enabled, symbol, supportsUSStreamingBars, subscribe, unsubscribe, subscribeUS, unsubscribeUS]);

  useEffect(() => {
    if (!enabled || supportsUSStreamingBars || !liveCandle || !candleInterval) return;
    const t = Math.floor(Number(liveCandle.t) / 1000);
    if (!Number.isFinite(t) || t <= 0) return;
    const nextBar: Bar = {
      time: t,
      open: Number(liveCandle.o),
      high: Number(liveCandle.h),
      low: Number(liveCandle.l),
      close: Number(liveCandle.c),
      volume: Number.isFinite(Number(liveCandle.v)) ? Number(liveCandle.v) : 0,
    };
    if (![nextBar.open, nextBar.high, nextBar.low, nextBar.close].every(Number.isFinite)) return;
    setBars((prev) => {
      if (!prev.length) return [nextBar];
      const next = [...prev];
      const last = next[next.length - 1];
      if (Number(last.time) === t) {
        next[next.length - 1] = nextBar;
        return next;
      }
      if (Number(last.time) > t) {
        const idx = next.findIndex((b) => Number(b.time) === t);
        if (idx >= 0) next[idx] = nextBar;
        return next;
      }
      return [...next, nextBar];
    });
  }, [candleInterval, enabled, liveCandle, supportsUSStreamingBars]);

  useEffect(() => {
    if (!enabled || supportsUSStreamingBars || !tick || !Number.isFinite(Number(tick.ltp))) return;
    if (candleInterval) return;
    const ts = Math.floor(new Date(tick.ts).getTime() / 1000);
    if (!Number.isFinite(ts) || ts <= 0) return;
    const t = candleBoundary(ts, timeframe);
    const ltp = Number(tick.ltp);

    setBars((prev) => {
      if (!prev.length) {
        return [{ time: t, open: ltp, high: ltp, low: ltp, close: ltp, volume: Number(tick.volume || 0) }];
      }
      const next = [...prev];
      const last = next[next.length - 1];
      if (Number(last.time) === t) {
        next[next.length - 1] = {
          ...last,
          high: Math.max(Number(last.high), ltp),
          low: Math.min(Number(last.low), ltp),
          close: ltp,
          volume: Number.isFinite(Number(tick.volume)) ? Number(tick.volume) : last.volume,
        };
        return next;
      }
      if (Number(last.time) > t) {
        const idx = next.findIndex((b) => Number(b.time) === t);
        if (idx >= 0) {
          const row = next[idx];
          next[idx] = {
            ...row,
            high: Math.max(Number(row.high), ltp),
            low: Math.min(Number(row.low), ltp),
            close: ltp,
            volume: Number.isFinite(Number(tick.volume)) ? Number(tick.volume) : row.volume,
          };
        }
        return next;
      }
      return [...next, { time: t, open: ltp, high: ltp, low: ltp, close: ltp, volume: Number(tick.volume || 0) }];
    });
  }, [candleInterval, enabled, tick, timeframe, supportsUSStreamingBars]);

  const liveTick = useMemo(() => {
    if (supportsUSStreamingBars && usTrade) {
      return { ltp: Number(usTrade.p), change_pct: 0 };
    }
    return tick ? { ltp: Number(tick.ltp), change_pct: Number(tick.change_pct ?? 0) } : null;
  }, [supportsUSStreamingBars, usTrade, tick]);

  const realtimeMeta = useMemo<RealtimeMeta>(() => {
    if (supportsUSStreamingBars) {
      const lastTickMs = Number(usTrade?.t ?? 0) || (typeof usLastMessageAt === "number" ? usLastMessageAt : 0);
      const ageMs = lastTickMs > 0 ? Date.now() - lastTickMs : Number.POSITIVE_INFINITY;
      const status: RealtimeMeta["status"] =
        usConnectionState !== "connected"
          ? "disconnected"
          : ageMs > 15000
          ? "delayed"
          : "live";
      const currentBar = effectiveUSBars?.length ? effectiveUSBars[effectiveUSBars.length - 1] : null;
      return {
        status,
        lastTickTs: lastTickMs || null,
        currentBar: currentBar
          ? {
              open: Number(currentBar.open),
              high: Number(currentBar.high),
              low: Number(currentBar.low),
              close: Number(currentBar.close),
              volume: Number(currentBar.volume ?? 0),
              time: Number(currentBar.time),
            }
          : null,
      };
    }

    const tickTs = tick?.ts ? new Date(tick.ts).getTime() : NaN;
    const ageMs = Number.isFinite(tickTs) ? Date.now() - tickTs : Number.POSITIVE_INFINITY;
    const status: RealtimeMeta["status"] =
      legacyConnectionState !== "connected" ? "disconnected" : ageMs > 15000 ? "delayed" : "live";
    const last = bars.length ? bars[bars.length - 1] : null;
    return {
      status,
      lastTickTs: Number.isFinite(tickTs) ? tickTs : null,
      currentBar: last
        ? {
            open: Number(last.open),
            high: Number(last.high),
            low: Number(last.low),
            close: Number(last.close),
            volume: Number(last.volume ?? 0),
            time: Number(last.time),
          }
        : null,
    };
  }, [supportsUSStreamingBars, usTrade, usLastMessageAt, usConnectionState, effectiveUSBars, tick, bars, legacyConnectionState]);

  return { bars, liveTick, realtimeMeta };
}
