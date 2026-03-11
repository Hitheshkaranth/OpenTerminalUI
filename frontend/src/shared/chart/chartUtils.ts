import type { Bar } from "oakscriptjs";
import type { ChartPoint } from "../../types";
import type { ChartTimeframe } from "./types";

type ComparableChartBar = {
  time: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume?: unknown;
  session?: unknown;
  isExtended?: unknown;
  s?: unknown;
  ext?: unknown;
};

const TF_SECONDS: Record<ChartTimeframe, number> = {
  "1m": 60,
  "2m": 120,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
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
    const bar: Bar = {
      time,
      open,
      high: normalizedHigh,
      low: normalizedLow,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    };
    // Attach metadata if present
    if ((d as any).s) (bar as any).s = (d as any).s;
    if ((d as any).ext) (bar as any).ext = (d as any).ext;

    byTime.set(time, bar);
  }
  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function normalizeTime(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSession(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function normalizeExtended(value: unknown): boolean {
  return value === true;
}

function sameStableBar(a: ComparableChartBar, b: ComparableChartBar): boolean {
  return (
    normalizeTime(a.time) === normalizeTime(b.time) &&
    normalizeValue(a.open) === normalizeValue(b.open) &&
    normalizeValue(a.high) === normalizeValue(b.high) &&
    normalizeValue(a.low) === normalizeValue(b.low) &&
    normalizeValue(a.close) === normalizeValue(b.close) &&
    normalizeValue(a.volume) === normalizeValue(b.volume) &&
    normalizeSession(a.session ?? a.s) === normalizeSession(b.session ?? b.s) &&
    normalizeExtended(a.isExtended ?? a.ext) === normalizeExtended(b.isExtended ?? b.ext)
  );
}

export function canApplyTailUpdate<T extends ComparableChartBar>(previous: T[], next: T[]): boolean {
  if (!previous.length || !next.length || previous.length !== next.length) {
    return false;
  }

  const lastIndex = next.length - 1;
  if (normalizeTime(previous[lastIndex]?.time) !== normalizeTime(next[lastIndex]?.time)) {
    return false;
  }

  for (let idx = 0; idx < lastIndex; idx += 1) {
    if (!sameStableBar(previous[idx], next[idx])) {
      return false;
    }
  }

  return true;
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
