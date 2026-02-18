import type { PortfolioDividendTracker } from "../../types";
import { formatInr } from "../../utils/formatters";

export function DividendTracker({ data }: { data: PortfolioDividendTracker | null }) {
  const rows = data?.upcoming ?? [];
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-terminal-accent">Dividend Tracker</div>
        <div className="text-xs text-terminal-muted">Annual projection: {formatInr(data?.annual_income_projection ?? 0)}</div>
      </div>
      {!rows.length ? <div className="text-xs text-terminal-muted">No upcoming dividends.</div> : null}
      <div className="max-h-56 space-y-2 overflow-auto">
        {rows.map((r) => (
          <div key={`${r.symbol}-${r.ex_date || r.event_date}-${r.title}`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-terminal-text">{r.symbol}</span>
              <span className="text-terminal-muted">Ex: {r.ex_date || "-"}</span>
            </div>
            <div className="text-terminal-muted">{r.title}</div>
            <div className="text-terminal-text">Projected: {formatInr(r.projected_income)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
