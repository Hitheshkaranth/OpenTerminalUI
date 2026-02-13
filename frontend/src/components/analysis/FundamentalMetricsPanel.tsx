import { useScores } from "../../hooks/useStocks";
import { formatPct } from "../../utils/formatters";

type Props = {
  ticker: string;
};

function fmt(value: number | undefined, digits = 2): string {
  return typeof value === "number" ? value.toFixed(digits) : "-";
}

export function FundamentalMetricsPanel({ ticker }: Props) {
  const { data, isLoading: loading, error } = useScores(ticker);

  return (
    <div className="space-y-3">
      {loading && <div className="text-xs text-terminal-muted">Loading fundamental metrics...</div>}
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">Failed to load fundamental metrics</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Piotroski F-Score</div>
              <div className="mt-1 text-sm font-semibold">{fmt(data.piotroski_f_score, 0)} / 9</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Altman Z-Score</div>
              <div className="mt-1 text-sm font-semibold">{fmt(data.altman_z_score)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Graham Number</div>
              <div className="mt-1 text-sm font-semibold">{fmt(data.graham_number)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">PEG Ratio</div>
              <div className="mt-1 text-sm font-semibold">{fmt(data.peg_ratio)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3">
              <div className="text-xs text-terminal-muted">Magic Formula Rank</div>
              <div className="mt-1 text-sm font-semibold">{fmt(data.magic_formula_rank, 0)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
              <div className="mb-2 text-sm font-semibold">DuPont Analysis</div>
              <div>Profit Margin: {formatPct(data.dupont_analysis.profit_margin * 100)}</div>
              <div>Asset Turnover: {fmt(data.dupont_analysis.asset_turnover, 4)}</div>
              <div>Equity Multiplier: {fmt(data.dupont_analysis.equity_multiplier, 4)}</div>
              <div>ROE: {formatPct(data.dupont_analysis.roe * 100)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
              <div className="mb-2 text-sm font-semibold">Cash & Growth</div>
              <div>Cash Conversion Cycle: {fmt(data.cash_conversion_cycle)} days</div>
              <div>FCF Yield: {formatPct(data.fcf_yield_pct)}</div>
              <div>Revenue CAGR (3Y): {formatPct(data.cagr.revenue_3y_pct)}</div>
              <div>Profit CAGR (3Y): {formatPct(data.cagr.profit_3y_pct)}</div>
            </div>
          </div>

          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="mb-2 text-sm font-semibold">DVM Score</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <div>Durability: {fmt(data.dvm_score.durability, 1)}</div>
              <div>Valuation: {fmt(data.dvm_score.valuation, 1)}</div>
              <div>Momentum: {fmt(data.dvm_score.momentum, 1)}</div>
              <div>Overall: {fmt(data.dvm_score.overall, 1)}</div>
              <div>Band: {data.dvm_score.band || "-"}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
