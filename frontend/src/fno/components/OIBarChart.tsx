import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

export function OIBarChart({ contracts, spotPrice }: Props) {
  const data = useMemo(() => {
    const strikeMap = new Map<number, { strike: number; call_oi: number; put_oi: number }>();
    for (const c of contracts) {
      const entry = strikeMap.get(c.strike) || { strike: c.strike, call_oi: 0, put_oi: 0 };
      if (c.option_type === "CE" || c.option_type === "C") {
        entry.call_oi = c.oi;
      } else {
        entry.put_oi = c.oi;
      }
      strikeMap.set(c.strike, entry);
    }
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }, [contracts]);

  const formatOI = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  };

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="strike"
            tick={{ fill: "#999", fontSize: 10 }}
            tickFormatter={(v: number) => v.toLocaleString()}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fill: "#999", fontSize: 10 }} tickFormatter={formatOI} />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }}
            formatter={(v) => {
              const num = typeof v === "number" ? v : Number(v);
              return [Number.isFinite(num) ? formatOI(num) : "-"];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine
            x={Math.round(spotPrice / 50) * 50}
            stroke="#f59e0b"
            strokeDasharray="5 5"
            label={{ value: "ATM", fill: "#f59e0b", fontSize: 10 }}
          />
          <Bar dataKey="call_oi" fill="#22c55e" name="Call OI" opacity={0.8} />
          <Bar dataKey="put_oi" fill="#ef4444" name="Put OI" opacity={0.8} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
