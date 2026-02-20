import { ResponsiveHeatMap } from "@nivo/heatmap";

type SensitivityCell = {
  x: string;
  y: number;
};

type SensitivityRow = {
  id: string;
  data: SensitivityCell[];
};

type Props = {
  rows: SensitivityRow[];
  title?: string;
};

export function ParameterSensitivityHeatmap({
  rows,
  title = "Parameter Sensitivity Heatmap",
}: Props) {
  if (!rows.length) {
    return (
      <div className="rounded border border-terminal-border/40 bg-terminal-bg/40 p-3 text-xs text-terminal-muted">
        No sensitivity grid available.
      </div>
    );
  }

  return (
    <div className="rounded border border-terminal-border/40 bg-terminal-bg/40 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-muted">
        {title}
      </div>
      <div className="h-80 w-full">
        <ResponsiveHeatMap
          data={rows as any}
          margin={{ top: 40, right: 90, bottom: 40, left: 90 }}
          valueFormat=">-.3f"
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
          borderColor="#0f172a"
          labelTextColor="#e2e8f0"
          animate={false}
          cellOpacity={0.95}
          hoverTarget="cell"
        />
      </div>
    </div>
  );
}
