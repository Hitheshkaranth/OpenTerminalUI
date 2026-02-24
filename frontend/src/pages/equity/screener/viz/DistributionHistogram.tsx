import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DistributionHistogramProps = {
  data: Array<{ bin: number; count: number }>;
  threshold?: number;
};

export function DistributionHistogram({ data, threshold }: DistributionHistogramProps) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid stroke="#2a2f3e" />
          <XAxis dataKey="bin" stroke="#8892a4" />
          <YAxis stroke="#8892a4" />
          <Tooltip />
          <Bar dataKey="count" fill="#ffd740" />
          {typeof threshold === "number" ? <ReferenceLine x={threshold} stroke="#ff5252" /> : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
