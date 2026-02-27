import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; avg_score: number; count?: number };

type Props = {
  data: Point[];
  height?: number;
};

export function SentimentChart({ data, height = 180 }: Props) {
  if (!data.length) {
    return <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-3 text-xs text-terminal-muted">No sentiment trend data.</div>;
  }
  return (
    <div className="rounded border border-terminal-border bg-terminal-bg p-2">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2b3442" />
          <XAxis dataKey="date" tick={{ fill: "#8B949E", fontSize: 10 }} />
          <YAxis domain={[-1, 1]} tick={{ fill: "#8B949E", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#0F141B", border: "1px solid #2a3038", color: "#e6edf3" }}
          />
          <Area type="monotone" dataKey="avg_score" stroke="#22c55e" fill="#22c55e33" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
