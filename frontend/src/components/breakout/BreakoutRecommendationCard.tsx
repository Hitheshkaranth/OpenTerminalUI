import type { ScannerResult } from "../../types";

type Props = {
  row: ScannerResult;
  onCreateAlert: (row: ScannerResult) => void;
};

function levelAsNumber(levels: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = levels[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

export function BreakoutRecommendationCard({ row, onCreateAlert }: Props) {
  const triggerLevel = levelAsNumber(row.levels, ["trigger_level", "breakout_level", "entry", "close"]);
  const invalidationLevel = levelAsNumber(row.levels, ["invalidation_level", "stop_level", "support"]);
  const targetLevel = levelAsNumber(row.levels, ["target_level", "take_profit", "resistance", "tp1"]);
  const risk = triggerLevel != null && invalidationLevel != null ? Math.abs(triggerLevel - invalidationLevel) : null;
  const reward = triggerLevel != null && targetLevel != null ? Math.abs(targetLevel - triggerLevel) : null;
  const riskReward = risk && reward && risk > 0 && reward > 0 ? reward / risk : null;

  return (
    <article className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3" data-testid={`recommendation-${row.symbol}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-terminal-text">{row.symbol}</div>
          <div className="text-[11px] uppercase tracking-wide text-terminal-muted">{row.setup_type.replace(/_/g, " ")}</div>
        </div>
        <div className="rounded border border-terminal-accent/40 px-2 py-0.5 text-xs text-terminal-accent">
          Score {Number(row.score || 0).toFixed(2)}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Trigger</div>
          <div className="text-terminal-text">{triggerLevel != null ? triggerLevel.toFixed(2) : "-"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Invalidation</div>
          <div className="text-terminal-text">{invalidationLevel != null ? invalidationLevel.toFixed(2) : "-"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
          <div className="text-terminal-muted">Target</div>
          <div className="text-terminal-text">{targetLevel != null ? targetLevel.toFixed(2) : "-"}</div>
        </div>
      </div>
      <div className="text-[11px] text-terminal-muted">R:R {riskReward != null ? `${riskReward.toFixed(2)}:1` : "-"}</div>
      <button
        data-testid={`create-alert-${row.symbol}`}
        type="button"
        className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent hover:bg-terminal-accent/10"
        onClick={() => onCreateAlert(row)}
      >
        Create Breakout Alert
      </button>
    </article>
  );
}
