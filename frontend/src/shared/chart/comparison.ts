import type { UTCTimestamp } from "lightweight-charts";

import type { ChartPoint } from "../../types";

export type ComparisonMode = "normalized" | "price";

export function buildComparisonPoints(data: ChartPoint[], mode: ComparisonMode): Array<{ time: UTCTimestamp; value: number }> {
  const sorted = (data || [])
    .filter((p) => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.c)))
    .sort((a, b) => Number(a.t) - Number(b.t));
  if (!sorted.length) return [];
  if (mode === "price") {
    return sorted.map((p) => ({
      time: Number(p.t) as UTCTimestamp,
      value: Number(p.c),
    }));
  }
  const base = Number(sorted[0].c) || 1;
  return sorted.map((p) => ({
    time: Number(p.t) as UTCTimestamp,
    value: ((Number(p.c) - base) / Math.abs(base || 1)) * 100,
  }));
}
