import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { addMutualFundHolding, fetchMutualFundDetails } from "../../api/client";
import type { MutualFund } from "../../types";

type Props = {
  fund: MutualFund | null;
  onAdded?: () => void;
};

type Period = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "MAX";

const PERIOD_DAYS: Record<Period, number | null> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "3Y": 365 * 3,
  "5Y": 365 * 5,
  MAX: null,
};

export function MutualFundDetail({ fund, onAdded }: Props) {
  const [period, setPeriod] = useState<Period>("1Y");
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof fetchMutualFundDetails>> | null>(null);
  const [units, setUnits] = useState("10");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!fund) {
      setDetails(null);
      return;
    }
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const data = await fetchMutualFundDetails(fund.scheme_code);
        if (alive) setDetails(data);
      } catch {
        if (alive) setDetails(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [fund]);

  const chartData = useMemo(() => {
    const rows = details?.nav_history?.nav_history ?? [];
    const periodDays = PERIOD_DAYS[period];
    if (!periodDays) return rows;
    const now = new Date();
    const cutoff = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
    return rows.filter((row) => new Date(row.date).getTime() >= cutoff.getTime());
  }, [details?.nav_history?.nav_history, period]);

  if (!fund) {
    return <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Select a fund to view details.</div>;
  }

  const perf = details?.performance;

  const addToPortfolio = async () => {
    if (!details?.performance) return;
    const nav = details.performance.current_nav;
    const parsedUnits = Number(units);
    const parsedAmount = Number(amount);
    const finalUnits = Number.isFinite(parsedUnits) && parsedUnits > 0
      ? parsedUnits
      : Number.isFinite(parsedAmount) && parsedAmount > 0 && nav > 0
      ? parsedAmount / nav
      : 0;
    if (!Number.isFinite(finalUnits) || finalUnits <= 0) return;
    await addMutualFundHolding({
      scheme_code: fund.scheme_code,
      scheme_name: fund.scheme_name,
      fund_house: fund.fund_house,
      category: fund.scheme_sub_category || fund.scheme_category,
      units: finalUnits,
      avg_nav: nav,
      sip_transactions: [],
    });
    if (onAdded) onAdded();
  };

  return (
    <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-terminal-text">{fund.scheme_name}</div>
          <div className="text-[11px] text-terminal-muted">{fund.fund_house} | {fund.scheme_sub_category || fund.scheme_category}</div>
        </div>
        <button className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent" onClick={() => void addToPortfolio()}>
          Add to Portfolio
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {(["1M", "3M", "6M", "1Y", "3Y", "5Y", "MAX"] as Period[]).map((p) => (
          <button
            key={p}
            className={`rounded border px-2 py-0.5 text-[11px] ${period === p ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="h-56">
        {loading ? (
          <div className="text-xs text-terminal-muted">Loading NAV chart...</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="nav" stroke="#ff9f1a" dot={false} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <table className="min-w-full text-xs">
        <thead className="text-terminal-muted">
          <tr className="border-b border-terminal-border">
            <th className="py-1 text-left">1M</th>
            <th className="py-1 text-left">3M</th>
            <th className="py-1 text-left">6M</th>
            <th className="py-1 text-left">1Y</th>
            <th className="py-1 text-left">3Y</th>
            <th className="py-1 text-left">5Y</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-terminal-text">
            <td className="py-1">{perf?.returns_1m == null ? "-" : `${perf.returns_1m.toFixed(2)}%`}</td>
            <td className="py-1">{perf?.returns_3m == null ? "-" : `${perf.returns_3m.toFixed(2)}%`}</td>
            <td className="py-1">{perf?.returns_6m == null ? "-" : `${perf.returns_6m.toFixed(2)}%`}</td>
            <td className="py-1">{perf?.returns_1y == null ? "-" : `${perf.returns_1y.toFixed(2)}%`}</td>
            <td className="py-1">{perf?.returns_3y == null ? "-" : `${perf.returns_3y.toFixed(2)}%`}</td>
            <td className="py-1">{perf?.returns_5y == null ? "-" : `${perf.returns_5y.toFixed(2)}%`}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <label className="mb-1 block text-terminal-muted">Units</label>
          <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={units} onChange={(e) => setUnits(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-terminal-muted">Amount (optional)</label>
          <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
    </div>
  );
}

