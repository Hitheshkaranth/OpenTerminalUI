import type { DashboardResults, LabLeaderboardEntry } from "../../api/intelligence";
import { GuidedEmptyState } from "./GuidedEmptyState";

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function pct(value: unknown): string {
  const next = asNumber(value);
  if (next == null) return "--";
  const scaled = Math.abs(next) <= 1 ? next * 100 : next;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(1)}%`;
}

function metric(row: LabLeaderboardEntry, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(row[key]);
    if (value != null) return value;
  }
  return null;
}

function labelFor(row: LabLeaderboardEntry): string {
  return String(row.name || row.strategy || row.symbol || row.experiment_id || row.portfolio_id || row.run_id || "Validated run");
}

function ResultCard({ title, rows }: { title: string; rows: LabLeaderboardEntry[] }) {
  const best = rows[0];
  if (!best) return null;
  const sharpe = metric(best, ["sharpe", "sharpe_ratio"]);
  const ret = metric(best, ["total_return", "cagr", "return_pct"]);
  const drawdown = metric(best, ["max_drawdown"]);
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="ot-type-label text-terminal-muted">{title}</span>
        <span className="rounded-sm border border-terminal-accent/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-terminal-accent">
          Validated
        </span>
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-terminal-text">{labelFor(best)}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-terminal-muted">Sharpe</div>
          <div className="mt-1 text-terminal-accent">{sharpe == null ? "--" : sharpe.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Return</div>
          <div className={`mt-1 ${ret != null && ret < 0 ? "text-terminal-neg" : "text-terminal-pos"}`}>{pct(ret)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Max DD</div>
          <div className="mt-1 text-terminal-warn">{pct(drawdown)}</div>
        </div>
      </div>
    </div>
  );
}

export function ResultsSummaryCards({
  results,
  loading,
  onRunBacktest,
}: {
  results?: DashboardResults | null;
  loading?: boolean;
  onRunBacktest?: () => void;
}) {
  const modelRows = results?.modelLab ?? [];
  const portfolioRows = results?.portfolioLab ?? [];
  const hasRows = modelRows.length > 0 || portfolioRows.length > 0;

  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Validated Results</h3>
          <p className="mt-1 text-xs text-terminal-muted">Latest leaderboard winners from Model Lab and Portfolio Lab.</p>
        </div>
        {loading ? <span className="text-[11px] uppercase tracking-[0.12em] text-terminal-muted">Syncing...</span> : null}
      </div>
      {hasRows ? (
        <div className="grid gap-2 md:grid-cols-2">
          <ResultCard title="Model Lab" rows={modelRows} />
          <ResultCard title="Portfolio Lab" rows={portfolioRows} />
        </div>
      ) : (
        <GuidedEmptyState
          title="No validated runs yet"
          message="Run a preset backtest or Model Lab experiment, then the top validated result appears here automatically."
          icon="BT"
          actions={onRunBacktest ? [{ label: "Run Preset Backtest", onClick: onRunBacktest }] : []}
        />
      )}
    </div>
  );
}
