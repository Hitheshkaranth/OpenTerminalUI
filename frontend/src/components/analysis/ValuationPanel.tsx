import { useValuation, useDCF } from "../../hooks/useStocks";
import { formatInr, formatPct } from "../../utils/formatters";

type Props = {
  ticker: string;
};

export function ValuationPanel({ ticker }: Props) {
  const { data: relative, isLoading: relLoading, error: relError } = useValuation(ticker);
  const { data: dcf, isLoading: dcfLoading, error: dcfError } = useDCF(ticker);

  const loading = relLoading || dcfLoading;
  const error = relError || dcfError;

  return (
    <div className="space-y-3">
      {loading && <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Loading valuation...</div>}
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">Failed to load valuation</div>}

      {dcf && (
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">DCF (Auto)</div>
            <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">{ticker.toUpperCase()}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Enterprise Value</div>
              <div className="mt-1 font-semibold tabular-nums text-terminal-text">{formatInr(dcf.enterprise_value)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Equity Value</div>
              <div className="mt-1 font-semibold tabular-nums text-terminal-text">{formatInr(dcf.equity_value)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Per Share</div>
              <div className="mt-1 font-semibold tabular-nums text-terminal-text">{formatInr(dcf.per_share_value)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Terminal Value</div>
              <div className="mt-1 font-semibold tabular-nums text-terminal-text">{formatInr(dcf.terminal_value)}</div>
            </div>
          </div>
        </div>
      )}

      {relative && (
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
          <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Relative Valuation</div>
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2 lg:grid-cols-3">
            {relative.methods && Object.entries(relative.methods).map(([k, v]) => (
              <div key={k} className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">{k.replace(/_/g, " ")}</div>
                <div className="mt-1 font-semibold tabular-nums text-terminal-text">{formatInr(v)}</div>
              </div>
            ))}
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Blended Fair Value</div>
              <div className="mt-1 font-semibold tabular-nums text-terminal-text">{formatInr(relative.blended_fair_value)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Upside</div>
              <div className={`mt-1 font-semibold tabular-nums ${Number(relative.upside_pct || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                {formatPct(relative.upside_pct)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
