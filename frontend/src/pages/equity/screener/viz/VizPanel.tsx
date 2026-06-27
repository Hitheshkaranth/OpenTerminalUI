import type { ScreenerView } from "../ScreenerContext";
import { DistributionHistogram } from "./DistributionHistogram";
import { RadarScorecard } from "./RadarScorecard";
import { ScatterPlot } from "./ScatterPlot";
import { SectorTreemap } from "./SectorTreemap";

type VizPanelProps = {
  vizData: Record<string, unknown>;
  view?: ScreenerView;
  rows?: Array<Record<string, unknown>>;
};

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function average(rows: Array<Record<string, unknown>>, key: string): number | null {
  const values = rows.map((row) => toNum(row[key])).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function buildRadar(rows: Array<Record<string, unknown>>) {
  // Derive the scorecard from the actual screen results rather than mock values.
  const roe = average(rows, "roe");
  const roce = average(rows, "roce");
  const pe = average(rows, "pe");
  const growth = average(rows, "revenue_growth");
  const quality = average(rows, "quality");
  const momentum = average(rows, "momentum");
  return [
    { axis: "ROE", value: clamp(roe ?? 0) },
    { axis: "ROCE", value: clamp(roce ?? 0) },
    { axis: "Value", value: clamp(pe === null ? 0 : 100 - pe) },
    { axis: "Growth", value: clamp(growth ?? 0) },
    { axis: "Quality", value: clamp(quality ?? 0) },
    { axis: "Momentum", value: clamp(momentum ?? 0) },
  ];
}

export function VizPanel({ vizData, view = "charts", rows = [] }: VizPanelProps) {
  const scatterData = ((vizData.scatter_pe_roe as { data?: Array<Record<string, unknown>> } | undefined)?.data || []) as Array<Record<string, unknown>>;
  const treemapData = ((vizData.sector_treemap as { data?: Array<Record<string, unknown>> } | undefined)?.data || []) as Array<Record<string, unknown>>;
  const bins = ((vizData.roe_histogram as { bins?: number[] } | undefined)?.bins || []) as number[];
  const counts = ((vizData.roe_histogram as { counts?: number[] } | undefined)?.counts || []) as number[];
  const histogramData = bins.map((bin, idx) => ({ bin, count: counts[idx] || 0 }));

  const radarData = buildRadar(rows);

  const radarCard = (
    <div className="screener-card p-2">
      <div className="mb-1 text-xs text-terminal-muted">Radar Scorecard ({rows.length} stocks avg)</div>
      <RadarScorecard data={radarData} />
    </div>
  );
  const scatterCard = (
    <div className="screener-card p-2">
      <div className="mb-1 text-xs text-terminal-muted">Scatter PE vs ROE</div>
      <ScatterPlot data={scatterData} x="x" y="y" z="size" />
    </div>
  );
  const treemapCard = (
    <div className="screener-card p-2">
      <div className="mb-1 text-xs text-terminal-muted">Sector Treemap</div>
      <SectorTreemap data={treemapData} />
    </div>
  );
  const histogramCard = (
    <div className="screener-card p-2">
      <div className="mb-1 text-xs text-terminal-muted">ROE Distribution</div>
      <DistributionHistogram data={histogramData} />
    </div>
  );

  // Each toggle renders only its focused visualization; "charts" shows the full dashboard.
  if (view === "scorecard") {
    return <section className="grid grid-cols-1 gap-2">{radarCard}</section>;
  }
  if (view === "scatter") {
    return <section className="grid grid-cols-1 gap-2">{scatterCard}</section>;
  }
  if (view === "treemap") {
    return <section className="grid grid-cols-1 gap-2">{treemapCard}</section>;
  }

  return (
    <section className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {radarCard}
      {scatterCard}
      {treemapCard}
      {histogramCard}
    </section>
  );
}
