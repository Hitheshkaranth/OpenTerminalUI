import { useEffect, useState } from "react";

import { fetchFeedHealth, fetchKillSwitches, setKillSwitch } from "../api/client";
import type { KillSwitch } from "../types";

export function OpsDashboardPage() {
  const [feed, setFeed] = useState<Record<string, unknown>>({});
  const [switches, setSwitches] = useState<KillSwitch[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [health, kill] = await Promise.all([fetchFeedHealth(), fetchKillSwitches()]);
    setFeed(health);
    setSwitches(kill);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Ops Dashboard</div>
        <button className="rounded border border-terminal-border px-2 py-1 text-xs" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="mb-2 font-semibold">Feed Health</div>
        <div>State: {String(feed.feed_state || "-")}</div>
        <div>Kite Stream: {String(feed.kite_stream_status || "-")}</div>
        <div>WS Clients: {String(feed.ws_connected_clients || 0)}</div>
        <div>WS Subs: {String(feed.ws_subscriptions || 0)}</div>
      </div>
      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="mb-2 font-semibold">Kill Switches</div>
        <div className="space-y-2">
          {switches.map((sw) => (
            <div key={sw.id} className="flex items-center justify-between">
              <div>
                {sw.scope} | {sw.enabled ? "ENABLED" : "DISABLED"} | {sw.reason}
              </div>
              <button
                className="rounded border border-terminal-border px-2 py-1"
                onClick={async () => {
                  await setKillSwitch({ scope: sw.scope, enabled: !sw.enabled, reason: !sw.enabled ? "Manual emergency stop" : "Resumed" });
                  setMessage(`${sw.scope} -> ${!sw.enabled ? "enabled" : "disabled"}`);
                  await load();
                }}
              >
                Toggle
              </button>
            </div>
          ))}
        </div>
        {message && <div className="mt-2 text-terminal-muted">{message}</div>}
      </div>
    </div>
  );
}
