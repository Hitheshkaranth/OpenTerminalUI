import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { StrikeData } from "../types/fno";

type Props = {
  rows: StrikeData[];
  title?: string;
};

export function OIChart({ rows, title = "OI Distribution" }: Props) {
  const data = rows.map((row) => ({
    strike: Number(row.strike_price),
    ce_oi: Number(row.ce?.oi || 0),
    pe_oi: Number(row.pe?.oi || 0),
  }));

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">{title}</h3>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
            <XAxis dataKey="strike" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
            <Legend wrapperStyle={{ color: "#d8dde7", fontSize: 11 }} />
            <Bar dataKey="ce_oi" name="CE OI" fill="#ff4d4f" radius={[2, 2, 0, 0]} />
            <Bar dataKey="pe_oi" name="PE OI" fill="#00c176" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
