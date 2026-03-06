import { useMemo } from "react";

import type { AlertSocketEvent } from "../../hooks/useAlerts";

type Props = {
  connected: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  unreadCount: number;
  events: AlertSocketEvent[];
  onDesktopToggle: (next: boolean) => void;
  onSoundToggle: (next: boolean) => void;
};

function fmtTs(value: string): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString();
}

export function BreakoutAlertCenter({
  connected,
  desktopEnabled,
  soundEnabled,
  unreadCount,
  events,
  onDesktopToggle,
  onSoundToggle,
}: Props) {
  const recentEvents = useMemo(() => events.slice(0, 8), [events]);

  return (
    <section className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-terminal-accent">Alert Center</div>
        <div className="text-xs text-terminal-muted">{connected ? "WS Connected" : "WS Reconnecting"}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          data-testid="desktop-toggle"
          type="button"
          onClick={() => onDesktopToggle(!desktopEnabled)}
          className={`rounded border px-2 py-1 ${desktopEnabled ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Desktop {desktopEnabled ? "ON" : "OFF"}
        </button>
        <button
          data-testid="sound-toggle"
          type="button"
          onClick={() => onSoundToggle(!soundEnabled)}
          className={`rounded border px-2 py-1 ${soundEnabled ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Sound {soundEnabled ? "ON" : "OFF"}
        </button>
        <span className="rounded border border-terminal-border px-2 py-1 text-terminal-muted">Unread {unreadCount}</span>
      </div>
      {recentEvents.length === 0 ? (
        <div className="text-xs text-terminal-muted">No alert events received yet.</div>
      ) : (
        <div className="space-y-1">
          {recentEvents.map((row, idx) => (
            <div key={`${row.alert_id}:${row.timestamp}:${idx}`} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-terminal-text">{row.symbol}</span>
                <span className="text-terminal-muted">{fmtTs(row.timestamp)}</span>
              </div>
              <div className="text-terminal-muted">{row.condition || "Condition met"} @ {row.triggered_value ?? "NA"}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
