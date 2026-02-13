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
      {loading && <div className="text-xs text-terminal-muted">Loading valuation...</div>}
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">Failed to load valuation</div>}

      {dcf && (
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="mb-2 text-sm font-semibold">DCF (Auto)</div>
          <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
            <div>Enterprise: {formatInr(dcf.enterprise_value)}</div>
            <div>Equity: {formatInr(dcf.equity_value)}</div>
            <div>Per Share: {formatInr(dcf.per_share_value)}</div>
            <div>Terminal: {formatInr(dcf.terminal_value)}</div>
          </div>
        </div>
      )}

      {relative && (
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="mb-2 text-sm font-semibold">Relative Valuation</div>
          <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-3">
            {relative.methods && Object.entries(relative.methods).map(([k, v]) => (
              <div key={k}>
                {k.replace(/_/g, " ")}: {formatInr(v)}
              </div>
            ))}
            <div>Blended: {formatInr(relative.blended_fair_value)}</div>
            <div>Upside: {formatPct(relative.upside_pct)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
