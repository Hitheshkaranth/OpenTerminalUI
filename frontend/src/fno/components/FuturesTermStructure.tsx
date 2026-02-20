import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { FuturesContractData } from "../../types/market";

interface Props {
  contracts: FuturesContractData[];
  spotPrice: number;
}

export function FuturesTermStructure({ contracts, spotPrice }: Props) {
  const data = [...contracts]
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .map((c) => ({
      expiry: c.expiry,
      price: c.ltp,
      basis: c.basis,
      basisPct: c.basis_pct,
      annualized: c.annualized_basis,
      oi: c.oi,
    }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="expiry"
            tick={{ fill: "#999", fontSize: 11 }}
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return d.toLocaleDateString("en", { month: "short", day: "numeric" });
            }}
          />
          <YAxis tick={{ fill: "#999", fontSize: 11 }} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }}
            formatter={(v, name) => {
              const num = typeof v === "number" ? v : Number(v);
              if (!Number.isFinite(num)) return ["-", String(name)];
              return [
                name === "price" ? num.toLocaleString() : `${num.toFixed(2)}%`,
                String(name),
              ];
            }}
          />
          <ReferenceLine
            y={spotPrice}
            stroke="#f59e0b"
            strokeDasharray="8 4"
            label={{
              value: `Spot: ${spotPrice.toLocaleString()}`,
              fill: "#f59e0b",
              fontSize: 10,
              position: "right",
            }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ fill: "#60a5fa", r: 4 }}
            name="Futures Price"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
