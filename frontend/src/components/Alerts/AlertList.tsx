import type { AlertRule } from "../../types";
import { deleteAlert, updateAlert } from "../../api/client";

type Props = {
  alerts: AlertRule[];
  onChanged: () => void;
};

export function AlertList({ alerts, onChanged }: Props) {
  return (
    <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-sm font-semibold text-terminal-accent">Active Alerts</div>
      {alerts.length === 0 ? (
        <div className="text-xs text-terminal-muted">No alerts configured.</div>
      ) : (
        <div className="space-y-1">
          {alerts.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
              <div className="space-y-0.5">
                <div className="font-medium text-terminal-text">{row.symbol || row.ticker}</div>
                <div className="text-terminal-muted">
                  {row.condition_type || `${row.condition} ${row.threshold ?? ""}`} | status: {row.status || "active"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text"
                  onClick={() => {
                    void updateAlert(String(row.id), { status: row.status === "paused" ? "active" : "paused" }).then(onChanged);
                  }}
                >
                  {row.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  className="rounded border border-terminal-neg px-2 py-1 text-terminal-neg"
                  onClick={() => {
                    void deleteAlert(String(row.id)).then(onChanged);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
