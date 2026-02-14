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
  return points.map((d) => ({
    time: Number(d.t),
    open: Number(d.o),
    high: Number(d.h),
    low: Number(d.l),
    close: Number(d.c),
    volume: Number(d.v),
  }));
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
