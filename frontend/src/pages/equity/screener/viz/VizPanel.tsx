import { DistributionHistogram } from "./DistributionHistogram";
import { RadarScorecard } from "./RadarScorecard";
import { ScatterPlot } from "./ScatterPlot";
import { SectorTreemap } from "./SectorTreemap";

type VizPanelProps = {
  vizData: Record<string, unknown>;
};

export function VizPanel({ vizData }: VizPanelProps) {
  const scatterData = ((vizData.scatter_pe_roe as { data?: Array<Record<string, unknown>> } | undefined)?.data || []) as Array<Record<string, unknown>>;
  const treemapData = ((vizData.sector_treemap as { data?: Array<Record<string, unknown>> } | undefined)?.data || []) as Array<Record<string, unknown>>;
  const bins = ((vizData.roe_histogram as { bins?: number[] } | undefined)?.bins || []) as number[];
  const counts = ((vizData.roe_histogram as { counts?: number[] } | undefined)?.counts || []) as number[];
  const histogramData = bins.map((bin, idx) => ({ bin, count: counts[idx] || 0 }));

  const radarData = [
    { axis: "ROE", value: 65 },
    { axis: "ROCE", value: 58 },
    { axis: "OPM", value: 53 },
    { axis: "FCF", value: 61 },
    { axis: "Growth", value: 57 },
    { axis: "Leverage", value: 40 },
  ];

  return (
    <section className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      <div className="screener-card p-2">
        <div className="mb-1 text-xs text-terminal-muted">Radar Scorecard</div>
        <RadarScorecard data={radarData} />
      </div>
      <div className="screener-card p-2">
        <div className="mb-1 text-xs text-terminal-muted">Scatter PE vs ROE</div>
        <ScatterPlot data={scatterData} x="x" y="y" z="size" />
      </div>
      <div className="screener-card p-2">
        <div className="mb-1 text-xs text-terminal-muted">Sector Treemap</div>
        <SectorTreemap data={treemapData} />
      </div>
      <div className="screener-card p-2">
        <div className="mb-1 text-xs text-terminal-muted">ROE Distribution</div>
        <DistributionHistogram data={histogramData} />
      </div>
    </section>
  );
}
