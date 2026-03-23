import { useMemo } from "react";
import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type FactorAttributionPayload = {
  exposures: Record<string, number>;
  factor_returns: Record<string, number>;
  contributions: Record<string, number>;
  alpha: number;
  check_sum?: number;
};

type Props = {
  data: FactorAttributionPayload | null;
  activeReturn: number;
};

const FACTOR_ORDER = ["Market", "Size", "Value", "Momentum", "Quality", "Volatility"];

function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function FactorAttributionChart({ data, activeReturn }: Props) {
  const rows = useMemo(() => {
    if (!data) return [];
    const keys = [...FACTOR_ORDER, ...Object.keys(data.contributions).filter((key) => !FACTOR_ORDER.includes(key))];
    return keys.map((factor) => ({
      factor,
      exposure: data.exposures[factor] ?? 0,
      factorReturn: data.factor_returns[factor] ?? 0,
      contribution: data.contributions[factor] ?? 0,
      activeShare: activeReturn !== 0 ? ((data.contributions[factor] ?? 0) / activeReturn) * 100 : null,
    }));
  }, [activeReturn, data]);

  if (!data) {
    return <div className="text-xs text-terminal-muted">No factor attribution data available.</div>;
  }

  const alphaShare = activeReturn !== 0 ? (data.alpha / activeReturn) * 100 : null;
  const explained = rows.reduce((acc, row) => acc + row.contribution, 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2">
          <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Explained Return</div>
          <div className={explained >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatPct(explained)}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2">
          <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Alpha</div>
          <div className={data.alpha >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatPct(data.alpha)}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2">
          <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Alpha Share of Active Return</div>
          <div className={data.alpha >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
            {alphaShare == null ? "-" : `${alphaShare >= 0 ? "+" : ""}${alphaShare.toFixed(1)}%`}
          </div>
        </div>
      </div>

      <div className="h-80 w-full rounded border border-terminal-border bg-terminal-bg p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, left: 12, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#2a2f3a" />
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 10 }} />
            <YAxis
              type="category"
              dataKey="factor"
              axisLine={false}
              tickLine={false}
              width={92}
              tick={{ fill: "#d8dde7", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
              formatter={(value: number | string | undefined, name: string | undefined, item) => {
                const row = (item?.payload ?? {}) as (typeof rows)[number];
                if (name === "contribution") {
                  return [formatSigned(Number(value ?? 0)), row.factor];
                }
                return [String(value ?? "-"), name ?? "Value"];
              }}
              labelFormatter={(label) => `Factor: ${label}`}
            />
            <Bar dataKey="contribution" name="Contribution" radius={[0, 4, 4, 0]}>
              {rows.map((row) => (
                <Cell key={row.factor} fill={row.contribution >= 0 ? "#00c176" : "#ff4d4f"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-auto rounded border border-terminal-border bg-terminal-bg">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted">
              <th className="px-2 py-1 text-left">Factor</th>
              <th className="px-2 py-1 text-right">Beta</th>
              <th className="px-2 py-1 text-right">Factor Return</th>
              <th className="px-2 py-1 text-right">Contribution</th>
              <th className="px-2 py-1 text-right">% of Active Return</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.factor} className="border-b border-terminal-border/50">
                <td className="px-2 py-1">{row.factor}</td>
                <td className="px-2 py-1 text-right">{row.exposure.toFixed(3)}</td>
                <td className="px-2 py-1 text-right">{formatPct(row.factorReturn)}</td>
                <td className={`px-2 py-1 text-right ${row.contribution >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(row.contribution)}</td>
                <td className="px-2 py-1 text-right">{row.activeShare == null ? "-" : `${row.activeShare >= 0 ? "+" : ""}${row.activeShare.toFixed(1)}%`}</td>
              </tr>
            ))}
            <tr className="border-t border-terminal-border text-terminal-accent">
              <td className="px-2 py-1 font-semibold">Alpha</td>
              <td className="px-2 py-1 text-right">-</td>
              <td className="px-2 py-1 text-right">-</td>
              <td className={`px-2 py-1 text-right ${data.alpha >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(data.alpha)}</td>
              <td className="px-2 py-1 text-right">{alphaShare == null ? "-" : `${alphaShare >= 0 ? "+" : ""}${alphaShare.toFixed(1)}%`}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default FactorAttributionChart;
