import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type WaterfallChartProps = {
  data: Array<Record<string, unknown>>;
  x: string;
  y: string;
};

export function WaterfallChart({ data, x, y }: WaterfallChartProps) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid stroke="#2a2f3e" />
          <XAxis dataKey={x} stroke="#8892a4" />
          <YAxis stroke="#8892a4" />
          <Tooltip />
          <Bar dataKey={y} fill="#18ffff" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
