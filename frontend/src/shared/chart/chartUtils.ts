import type { Bar } from "oakscriptjs";
import type { ChartPoint } from "../../types";
import type { ChartTimeframe } from "./types";

const TF_SECONDS: Record<ChartTimeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1D": 86_400,
  "1W": 604_800,
  "1M": 2_592_000,
};

export function timeframeToSeconds(timeframe: ChartTimeframe): number {
  return TF_SECONDS[timeframe] ?? 60;
}

export function candleBoundary(tsSeconds: number, timeframe: ChartTimeframe): number {
  const sec = timeframeToSeconds(timeframe);
  return Math.floor(tsSeconds / sec) * sec;
}

export function chartPointsToBars(points: ChartPoint[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const d of points) {
    const time = Number(d.t);
    const open = Number(d.o);
    const high = Number(d.h);
    const low = Number(d.l);
    const close = Number(d.c);
    const volume = Number(d.v);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }
    const normalizedHigh = Math.max(open, high, low, close);
    const normalizedLow = Math.min(open, high, low, close);
    byTime.set(time, {
      time,
      open,
      high: normalizedHigh,
      low: normalizedLow,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
