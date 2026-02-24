import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

type ScatterPlotProps = {
  data: Array<Record<string, unknown>>;
  x: string;
  y: string;
  z?: string;
};

export function ScatterPlot({ data, x, y, z }: ScatterPlotProps) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <ScatterChart>
          <CartesianGrid stroke="#2a2f3e" />
          <XAxis type="number" dataKey={x} stroke="#8892a4" />
          <YAxis type="number" dataKey={y} stroke="#8892a4" />
          {z ? <ZAxis type="number" dataKey={z} range={[30, 220]} /> : null}
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill="#448aff" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
