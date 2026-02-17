import type { AlertTriggerEvent } from "../../types";

type Props = {
  history: AlertTriggerEvent[];
};

export function AlertHistory({ history }: Props) {
  return (
    <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-sm font-semibold text-terminal-accent">Triggered History</div>
      {history.length === 0 ? (
        <div className="text-xs text-terminal-muted">No triggered alerts yet.</div>
      ) : (
        <div className="space-y-1">
          {history.map((row) => (
            <div key={row.id} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
              <div className="font-medium text-terminal-text">{row.symbol}</div>
              <div className="text-terminal-muted">
                {row.condition_type} | value: {row.triggered_value ?? "-"} | {new Date(row.triggered_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
