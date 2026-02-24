import { useEffect, useMemo, useState } from "react";
import type { Bar } from "oakscriptjs";

import { useQuotesStore, useQuotesStream } from "../../realtime/useQuotesStream";
import { candleBoundary } from "./chartUtils";
import type { ChartTimeframe } from "./types";

type RealtimeResult = {
  bars: Bar[];
  liveTick: { ltp: number; change_pct: number } | null;
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
    byTime.set(time, {
      time,
      open,
      high: Math.max(open, high, low, close),
      low: Math.min(open, high, low, close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function wsCandleInterval(timeframe: ChartTimeframe): string | null {
  if (timeframe === "1m") return "1m";
  if (timeframe === "5m") return "5m";
  if (timeframe === "15m") return "15m";
  return null;
}

export function useRealtimeChart(
  market: string,
  symbol: string,
  timeframe: ChartTimeframe,
  seedBars: Bar[],
  enabled: boolean,
): RealtimeResult {
  const token = `${market.toUpperCase()}:${symbol.toUpperCase()}`;
  const { subscribe, unsubscribe } = useQuotesStream(market);
  const tick = useQuotesStore((s) => s.ticksByToken[token]);
  const candleInterval = wsCandleInterval(timeframe);
  const liveCandle = useQuotesStore((s) => (candleInterval ? s.candlesByKey[`${token}|${candleInterval}`] : undefined));
  const [bars, setBars] = useState<Bar[]>(normalizeBars(seedBars));

  useEffect(() => {
    setBars(normalizeBars(seedBars));
  }, [seedBars, symbol, timeframe]);

  useEffect(() => {
    if (!enabled || !symbol) return;
    subscribe([symbol]);
    return () => unsubscribe([symbol]);
  }, [enabled, subscribe, symbol, unsubscribe]);

  useEffect(() => {
    if (!enabled || !liveCandle || !candleInterval) return;
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
        if (idx >= 0) {
          next[idx] = nextBar;
        }
        return next;
      }
      return [...next, nextBar];
    });
  }, [candleInterval, enabled, liveCandle]);

  useEffect(() => {
    if (!enabled || !tick || !Number.isFinite(Number(tick.ltp))) return;
    if (candleInterval) return; // Prefer server-built candles for supported intraday intervals.
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
          return next;
        }
        // Ignore stale/out-of-order ticks that don't map to an existing candle.
        return next;
      }
      return [
        ...next,
        {
          time: t,
          open: ltp,
          high: ltp,
          low: ltp,
          close: ltp,
          volume: Number.isFinite(Number(tick.volume)) ? Number(tick.volume) : 0,
        },
      ];
    });
  }, [candleInterval, enabled, tick, timeframe]);

  const liveTick = useMemo(
    () =>
      tick
        ? {
            ltp: Number(tick.ltp),
            change_pct: Number(tick.change_pct ?? 0),
          }
        : null,
    [tick],
  );

  return { bars, liveTick };
}
