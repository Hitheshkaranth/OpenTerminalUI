import type { ScreenChange, ScreenCoverage } from "../../api/screenMonitoring";

export type CoverageSegment = { key: string; label: string; count: number; percentage: number };
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
export const finiteMeasurement = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function screenCoverageSegments(value: ScreenCoverage) {
  const requested = count(value.requested);
  const counts = [
    { key: "evaluated", label: "Evaluated", count: count(value.evaluated) },
    { key: "missing", label: "Missing", count: value.missing.length },
    { key: "stale", label: "Stale", count: value.stale.length },
    { key: "incomplete", label: "Incomplete", count: value.unknown.length },
  ];
  const classified = counts.reduce((total, item) => total + item.count, 0);
  if (requested > classified) counts.push({ key: "unclassified", label: "Not classified", count: requested - classified });
  return { requested, consistent: classified <= requested,
    segments: counts.map(item => ({ ...item, percentage: requested > 0 ? item.count / requested * 100 : 0 })) };
}

export function screenChangeSummary(changes: ScreenChange[]) {
  const unique = [...new Map(changes.map(change => [change.id, change])).values()];
  const dates = unique.map(change => Date.parse(change.observed_at)).filter(Number.isFinite).sort((a, b) => a - b);
  return { entered: unique.filter(c => c.kind === "entered").length,
    exited: unique.filter(c => c.kind === "exited").length, total: unique.length,
    first: dates.length ? new Date(dates[0]).toISOString() : null,
    last: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null };
}

const METRICS: Record<string, { label: string; unit: string; deltaUnit: string }> = {
  roe: { label: "Return on equity", unit: "%", deltaUnit: "percentage points" },
  roa: { label: "Return on assets", unit: "%", deltaUnit: "percentage points" },
  opm: { label: "Operating margin", unit: "%", deltaUnit: "percentage points" },
  net_margin: { label: "Net margin", unit: "%", deltaUnit: "percentage points" },
  revenue_growth: { label: "Revenue growth", unit: "%", deltaUnit: "percentage points" },
  eps_growth: { label: "EPS growth", unit: "%", deltaUnit: "percentage points" },
  pe: { label: "Price / earnings", unit: "×", deltaUnit: "×" },
  pb: { label: "Price / book", unit: "×", deltaUnit: "×" },
  ps: { label: "Price / sales", unit: "×", deltaUnit: "×" },
  ev_ebitda: { label: "Enterprise value / EBITDA", unit: "×", deltaUnit: "×" },
  beta: { label: "Beta", unit: "unitless", deltaUnit: "" },
  piotroski_f_score: { label: "Piotroski F-score", unit: "points", deltaUnit: "points" },
  altman_z_score: { label: "Altman Z-score", unit: "unitless", deltaUnit: "" },
};
export function screenMetricMeta(metric: string) {
  return METRICS[metric] ?? { label: metric.replace(/_/g, " "), unit: "unit not supplied", deltaUnit: "unit not supplied" };
}
export function screenMetricValue(value: unknown, metric: string) {
  const measurement = finiteMeasurement(value);
  if (measurement === null) return "Unavailable";
  const { unit } = screenMetricMeta(metric);
  const formatted = measurement.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return unit === "unitless" ? formatted : `${formatted}${unit === "%" || unit === "×" ? "" : " "}${unit}`;
}
export function screenMetricDifference(before: unknown, after: unknown, metric: string) {
  const oldValue = finiteMeasurement(before), newValue = finiteMeasurement(after);
  if (oldValue === null || newValue === null) return "Change unavailable";
  const difference = newValue - oldValue;
  if (!Number.isFinite(difference)) return "Change outside display range";
  return `${difference > 0 ? "+" : ""}${difference.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${screenMetricMeta(metric).deltaUnit}`.trim();
}
export function screenMetricThresholds(metric: string, rules: string[]) {
  return rules.flatMap(rule => {
    const match = /^\s*([a-z_][a-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(rule);
    const value = match ? Number(match[3]) : NaN;
    return match && match[1] === metric && Number.isFinite(value) ? [{ operator: match[2], value }] : [];
  });
}
export function screenMetricComparisons(change: ScreenChange) {
  return [...new Set([...Object.keys(change.before), ...Object.keys(change.after)])].map(metric => ({
    metric, before: finiteMeasurement(change.before[metric]), after: finiteMeasurement(change.after[metric]),
    thresholds: screenMetricThresholds(metric, change.rules),
  }));
}
export function screenMetricScale(values: Array<number | null>) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const minimum = Math.min(0, ...finite), maximum = Math.max(0, ...finite);
  const low = minimum === maximum ? 0 : minimum;
  const high = minimum === maximum ? 1 : maximum;
  const magnitude = Math.max(Math.abs(low), Math.abs(high));
  return { low, high, position: (value: number) => ((value / magnitude - low / magnitude) / (high / magnitude - low / magnitude)) * 100 };
}
