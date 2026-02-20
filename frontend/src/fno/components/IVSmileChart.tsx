import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { OptionContractData } from "../../types/market";

interface Props {
  contracts: OptionContractData[];
  spotPrice: number;
}

export function IVSmileChart({ contracts, spotPrice }: Props) {
  const data = useMemo(() => {
    const strikeMap = new Map<number, { strike: number; call_iv?: number; put_iv?: number }>();
    for (const c of contracts) {
      const entry = strikeMap.get(c.strike) || { strike: c.strike };
      if (c.option_type === "CE" || c.option_type === "C") {
        entry.call_iv = c.iv;
      } else {
        entry.put_iv = c.iv;
      }
      strikeMap.set(c.strike, entry);
    }
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }, [contracts]);

  if (data.length === 0) {
    return <div className="p-4 text-sm text-zinc-500">No IV data available</div>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="strike"
            tick={{ fill: "#999", fontSize: 11 }}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <YAxis
            tick={{ fill: "#999", fontSize: 11 }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }}
            labelFormatter={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              return Number.isFinite(num) ? `Strike: ${num.toLocaleString()}` : "Strike";
            }}
            formatter={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              return [Number.isFinite(num) ? `${num.toFixed(2)}%` : "-"];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="call_iv"
            stroke="#22c55e"
            name="Call IV"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="put_iv"
            stroke="#ef4444"
            name="Put IV"
            dot={false}
            strokeWidth={2}
          />
          {spotPrice > 0 && (
            <ReferenceLine
              x={Math.round(spotPrice)}
              stroke="#f59e0b"
              strokeDasharray="5 5"
              label={{ value: "Spot", fill: "#f59e0b", fontSize: 10, position: "insideTop" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
