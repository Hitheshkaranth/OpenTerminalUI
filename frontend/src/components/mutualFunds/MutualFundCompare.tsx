import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { compareMutualFunds } from "../../api/client";
import type { MutualFund, MutualFundPerformance } from "../../types";

type Props = {
  selected: MutualFund[];
};

const PERIODS = ["1m", "3m", "6m", "1y", "3y", "5y"] as const;

export function MutualFundCompare({ selected }: Props) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("1y");
  const [loading, setLoading] = useState(false);
  const [funds, setFunds] = useState<MutualFundPerformance[]>([]);
  const [normalized, setNormalized] = useState<Record<string, Array<{ date: string; value: number }>>>({});

  const loadCompare = async () => {
    if (!selected.length) return;
    setLoading(true);
    try {
      const out = await compareMutualFunds(selected.map((x) => x.scheme_code), period);
      setFunds(out.funds || []);
      setNormalized(out.normalized || {});
    } finally {
      setLoading(false);
    }
  };

  const chartRows = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    for (const fund of selected) {
      const series = normalized[String(fund.scheme_code)] || [];
      for (const point of series) {
        byDate[point.date] = byDate[point.date] || {};
        byDate[point.date][String(fund.scheme_code)] = point.value;
      }
    }
    return Object.entries(byDate)
      .map(([date, map]) => ({ date, ...map }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [normalized, selected]);

  const metricKey = `returns_${period}` as keyof MutualFundPerformance;
  const vals = funds.map((f) => Number(f[metricKey] ?? NaN)).filter((x) => Number.isFinite(x));
  const best = vals.length ? Math.max(...vals) : null;
  const worst = vals.length ? Math.min(...vals) : null;

  return (
    <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p}
            className={`rounded border px-2 py-0.5 text-[11px] ${period === p ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setPeriod(p)}
          >
            {p.toUpperCase()}
          </button>
        ))}
        <button className="rounded border border-terminal-accent px-2 py-0.5 text-[11px] text-terminal-accent" onClick={() => void loadCompare()}>
          Compare
        </button>
      </div>
      <div className="text-[11px] text-terminal-muted">Select up to 5 funds in Search, then click Compare.</div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            {selected.map((fund, idx) => (
              <Line
                key={fund.scheme_code}
                type="monotone"
                dataKey={String(fund.scheme_code)}
                dot={false}
                strokeWidth={1.6}
                stroke={["#ff9f1a", "#00c176", "#4f91ff", "#ff4d4f", "#ffb74d"][idx % 5]}
                name={fund.scheme_name}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {loading && <div className="text-xs text-terminal-muted">Comparing funds...</div>}
      {!loading && funds.length > 0 && (
        <table className="min-w-full text-xs">
          <thead className="text-terminal-muted">
            <tr className="border-b border-terminal-border">
              <th className="py-1 text-left">Fund</th>
              <th className="py-1 text-right">{period.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => {
              const value = Number(f[metricKey] ?? NaN);
              const isBest = best != null && value === best;
              const isWorst = worst != null && value === worst;
              return (
                <tr key={f.scheme_code} className="border-b border-terminal-border/40">
                  <td className="py-1">{f.scheme_name}</td>
                  <td className={`py-1 text-right ${isBest ? "text-terminal-pos" : isWorst ? "text-terminal-neg" : "text-terminal-text"}`}>
                    {Number.isFinite(value) ? `${value.toFixed(2)}%` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

