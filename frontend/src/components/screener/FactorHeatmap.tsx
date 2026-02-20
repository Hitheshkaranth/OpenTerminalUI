import { ResponsiveHeatMap } from "@nivo/heatmap";

type HeatmapRow = {
  id: string;
  data: Array<{ x: string; y: number }>;
};

type Props = {
  data: HeatmapRow[];
};

export function FactorHeatmap({ data }: Props) {
  if (!data.length) {
    return (
      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">
        No factor heatmap data yet.
      </div>
    );
  }

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Factor Heatmap (Top Ranked)</div>
      <div className="h-80 w-full">
        <ResponsiveHeatMap
          data={data as any}
          margin={{ top: 40, right: 80, bottom: 40, left: 80 }}
          valueFormat=">-.2f"
          forceSquare={false}
          axisTop={{ tickSize: 3, tickPadding: 4, tickRotation: -25 }}
          axisRight={null}
          axisBottom={null}
          axisLeft={{ tickSize: 3, tickPadding: 4, tickRotation: 0 }}
          colors={{
            type: "diverging",
            scheme: "red_yellow_blue",
            divergeAt: 0.5,
            minValue: -2,
            maxValue: 2,
          }}
          emptyColor="#1f2937"
          borderColor="#111827"
          labelTextColor="#e5e7eb"
          animate={false}
          hoverTarget="cell"
          cellOpacity={0.95}
        />
      </div>
    </div>
  );
}
