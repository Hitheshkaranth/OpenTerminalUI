import { useMemo } from "react";

import { useCapexTracker } from "../../hooks/useStocks";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";

type Props = {
  ticker: string;
};

export function CapexTrackerCard({ ticker }: Props) {
  const { data, isLoading } = useCapexTracker(ticker);
  const { formatFinancialCompact } = useDisplayCurrency();

  const latest = useMemo(() => {
    const rows = data?.points ?? [];
    if (!rows.length) return null;
    return rows[rows.length - 1];
  }, [data?.points]);
  const previous = useMemo(() => {
    const rows = data?.points ?? [];
    if (rows.length < 2) return null;
    return rows[rows.length - 2];
  }, [data?.points]);

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded border border-terminal-border bg-terminal-panel" />;
  }

  const deltaPct =
    latest && previous && previous.capex > 0
      ? ((latest.capex - previous.capex) / previous.capex) * 100
      : null;
  const deltaClass = deltaPct == null ? "text-terminal-muted" : deltaPct >= 0 ? "text-terminal-neg" : "text-terminal-pos";

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="text-xs uppercase tracking-wide text-terminal-accent">Capex Tracker</div>
      <div className="mt-1 text-[11px] text-terminal-muted">{latest?.date ?? "No period available"}</div>
      <div className="mt-3 text-lg font-semibold tabular-nums">
        {latest ? formatFinancialCompact(latest.capex) : "-"}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={`text-xs font-semibold ${deltaClass}`}>
          {deltaPct == null ? "-" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}% vs prev`}
        </span>
        {latest?.source ? (
          <span className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted">
            {latest.source}
          </span>
        ) : null}
      </div>
    </div>
  );
}
