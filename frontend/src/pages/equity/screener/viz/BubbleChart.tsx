import { ScatterPlot } from "./ScatterPlot";

type BubbleChartProps = {
  data: Array<Record<string, unknown>>;
  x: string;
  y: string;
  size: string;
};

export function BubbleChart({ data, x, y, size }: BubbleChartProps) {
  return <ScatterPlot data={data} x={x} y={y} z={size} />;
}
