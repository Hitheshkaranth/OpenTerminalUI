import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { deleteMutualFundHolding, fetchMutualFundPortfolio } from "../../api/client";
import type { PortfolioMutualFund } from "../../types";
import { formatInr } from "../../utils/formatters";

const COLORS = ["#ff9f1a", "#00c176", "#4f91ff", "#ff4d4f", "#ffb74d", "#8e98a8"];

type Props = {
  refreshToken?: number;
};

export function MutualFundPortfolioSection({ refreshToken = 0 }: Props) {
  const [items, setItems] = useState<PortfolioMutualFund[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const out = await fetchMutualFundPortfolio();
        if (!alive) return;
        setItems(out.items || []);
      } catch {
        if (alive) {
          setItems([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of items) {
      const key = (row.category || "Other").trim() || "Other";
      map[key] = (map[key] || 0) + Number(row.current_value || 0);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [items]);

  const summary = useMemo(() => {
    const totalInvested = items.reduce((acc, row) => acc + Number(row.invested_amount || 0), 0);
    const totalCurrent = items.reduce((acc, row) => acc + Number(row.current_value || 0), 0);
    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    return {
      total_invested: totalInvested,
      total_current_value: totalCurrent,
      total_pnl: totalPnl,
      total_pnl_pct: totalPnlPct,
    };
  }, [items]);

  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-accent/40 bg-terminal-panel p-3 shadow-[0_0_0_1px_rgba(0,193,118,0.08)]">
        <div className="mb-2 text-sm font-semibold">Mutual Fund Summary</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="rounded border border-terminal-accent/50 bg-terminal-bg px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Total Invested</div>
            <div className="mt-1 text-sm font-semibold text-terminal-text">{formatInr(summary.total_invested)}</div>
          </div>
          <div className="rounded border border-terminal-border/80 bg-terminal-bg px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Current Value</div>
            <div className="mt-1 text-sm font-semibold text-terminal-text">{formatInr(summary.total_current_value)}</div>
          </div>
          <div className={`rounded border bg-terminal-bg px-3 py-2 text-xs ${summary.total_pnl >= 0 ? "border-terminal-pos/60" : "border-terminal-neg/60"}`}>
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Unrealized P&L</div>
            <div className={`mt-1 text-sm font-semibold ${summary.total_pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
              {formatInr(summary.total_pnl)}
            </div>
          </div>
          <div className={`rounded border bg-terminal-bg px-3 py-2 text-xs ${summary.total_pnl_pct >= 0 ? "border-terminal-pos/60" : "border-terminal-neg/60"}`}>
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Total Return</div>
            <div className={`mt-1 text-sm font-semibold ${summary.total_pnl_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
              {summary.total_pnl_pct.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3 xl:col-span-8">
          <div className="mb-2 text-sm font-semibold">Mutual Fund Holdings</div>
          <div className="overflow-auto">
            {loading ? (
              <div className="text-xs text-terminal-muted">Loading mutual fund holdings...</div>
            ) : items.length === 0 ? (
              <div className="text-xs text-terminal-muted">No mutual fund holdings yet.</div>
            ) : (
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-terminal-muted">
                    <th className="px-2 py-1 text-left">Scheme</th>
                    <th className="px-2 py-1 text-right">Units</th>
                    <th className="px-2 py-1 text-right">Avg NAV</th>
                    <th className="px-2 py-1 text-right">Current NAV</th>
                    <th className="px-2 py-1 text-right">Invested</th>
                    <th className="px-2 py-1 text-right">Current</th>
                    <th className="px-2 py-1 text-right">P&L</th>
                    <th className="px-2 py-1 text-right">P&L%</th>
                    <th className="px-2 py-1 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b border-terminal-border/40">
                      <td className="px-2 py-1">{row.scheme_name}</td>
                      <td className="px-2 py-1 text-right">{row.units.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{row.avg_nav.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{row.current_nav.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{formatInr(row.invested_amount)}</td>
                      <td className="px-2 py-1 text-right">{formatInr(row.current_value)}</td>
                      <td className={`px-2 py-1 text-right ${row.pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatInr(row.pnl)}</td>
                      <td className={`px-2 py-1 text-right ${row.pnl_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.pnl_pct.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right">
                        <button
                          className="rounded border border-terminal-neg px-2 py-1 text-[10px] text-terminal-neg"
                          onClick={async () => {
                            await deleteMutualFundHolding(row.id);
                            setItems((prev) => prev.filter((x) => x.id !== row.id));
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-3 xl:col-span-4">
          <div className="mb-2 text-sm font-semibold">Allocation by Category</div>
          <div className="h-72 rounded border border-terminal-border bg-terminal-bg p-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" outerRadius={100}>
                  {categoryData.map((entry, idx) => (
                    <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
