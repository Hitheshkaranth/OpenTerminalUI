import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type StackedAreaChartProps = {
  data: Array<Record<string, unknown>>;
  x: string;
  keys: string[];
};

const COLORS = ["#448aff", "#00e676", "#ffd740", "#ff5252", "#18ffff"];

export function StackedAreaChart({ data, x, keys }: StackedAreaChartProps) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid stroke="#2a2f3e" />
          <XAxis dataKey={x} stroke="#8892a4" />
          <YAxis stroke="#8892a4" />
          <Tooltip />
          {keys.map((key, index) => (
            <Area key={key} type="monotone" dataKey={key} stackId="stack" stroke={COLORS[index % COLORS.length]} fill={COLORS[index % COLORS.length]} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
