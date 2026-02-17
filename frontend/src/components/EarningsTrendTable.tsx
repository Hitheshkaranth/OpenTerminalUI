import { useEarningsAnalysis } from "../hooks/useStocks";

function pctCell(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return <span className="text-terminal-muted">-</span>;
  const cls = value >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  return <span className={cls}>{value.toFixed(2)}%</span>;
}

function trendArrow(value: string): string {
  if (value === "accelerating") return "?";
  if (value === "declining" || value === "decelerating") return "?";
  return "?";
}

export function EarningsTrendTable({ symbol }: { symbol: string }) {
  const { data, isLoading } = useEarningsAnalysis(symbol);

  if (isLoading) return <div className="text-xs text-terminal-muted">Loading earnings analysis...</div>;
  if (!data) return <div className="text-xs text-terminal-muted">No earnings analysis available.</div>;

  const rows = (data.quarterly_financials || []).slice(-12).reverse();

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-terminal-accent">Earnings Trend</div>
        <div className="text-xs text-terminal-muted">
          Revenue {trendArrow(data.revenue_trend)} {data.revenue_trend} | Profit {trendArrow(data.profit_trend)} {data.profit_trend}
        </div>
      </div>
      <div className="mb-2 text-xs text-terminal-muted">
        Consecutive Beats: {data.consecutive_beats} | Avg EPS Surprise (4Q): {data.avg_eps_surprise_pct.toFixed(2)}%
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted">
              <th className="px-2 py-1 text-left">Quarter</th>
              <th className="px-2 py-1 text-right">Revenue</th>
              <th className="px-2 py-1 text-right">Rev QoQ%</th>
              <th className="px-2 py-1 text-right">Rev YoY%</th>
              <th className="px-2 py-1 text-right">Net Profit</th>
              <th className="px-2 py-1 text-right">NP QoQ%</th>
              <th className="px-2 py-1 text-right">NP YoY%</th>
              <th className="px-2 py-1 text-right">EPS</th>
              <th className="px-2 py-1 text-right">EPS Surprise</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.symbol}-${row.quarter}-${row.quarter_end_date}`} className="border-b border-terminal-border/50">
                <td className="px-2 py-1">{row.quarter}</td>
                <td className="px-2 py-1 text-right">{Number(row.revenue).toLocaleString("en-IN")}</td>
                <td className="px-2 py-1 text-right">{pctCell(row.revenue_qoq_pct)}</td>
                <td className="px-2 py-1 text-right">{pctCell(row.revenue_yoy_pct)}</td>
                <td className="px-2 py-1 text-right">{Number(row.net_profit).toLocaleString("en-IN")}</td>
                <td className="px-2 py-1 text-right">{pctCell(row.net_profit_qoq_pct)}</td>
                <td className="px-2 py-1 text-right">{pctCell(row.net_profit_yoy_pct)}</td>
                <td className="px-2 py-1 text-right">{row.eps == null ? "-" : Number(row.eps).toFixed(2)}</td>
                <td className="px-2 py-1 text-right">{pctCell(row.eps_yoy_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
