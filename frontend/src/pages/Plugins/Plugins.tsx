import { useEffect, useState } from "react";

import { fetchPlugins, reloadPlugin, setPluginEnabled } from "../../api/client";
import type { PluginManifestItem } from "../../types";

export function PluginsPage() {
  const [items, setItems] = useState<PluginManifestItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      setItems(await fetchPlugins());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plugins");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Installed Plugins</div>
        {error ? <div className="text-xs text-terminal-neg">{error}</div> : null}
        {!items.length ? <div className="text-xs text-terminal-muted">No plugins discovered.</div> : null}
        <div className="space-y-2">
          {items.map((row) => (
            <div key={row.id} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-terminal-text">{row.name} v{row.version}</div>
                  <div className="text-terminal-muted">{row.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={`rounded border px-2 py-1 ${row.enabled ? "border-terminal-pos text-terminal-pos" : "border-terminal-border text-terminal-muted"}`}
                    onClick={async () => {
                      await setPluginEnabled(row.id, !row.enabled);
                      await load();
                    }}
                  >
                    {row.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="rounded border border-terminal-border px-2 py-1 text-terminal-muted"
                    onClick={async () => {
                      await reloadPlugin(row.id);
                      await load();
                    }}
                  >
                    Reload
                  </button>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-terminal-muted">Permissions: {row.required_permissions.join(", ") || "none"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">
        Plugin marketplace placeholder: registry integration will be added in a future release.
      </div>
    </div>
  );
}
