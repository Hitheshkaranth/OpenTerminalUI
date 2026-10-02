import { useCallback, useEffect, useMemo, useState } from "react";

import { TerminalBadge, TerminalButton, TerminalInput, TerminalPanel, TerminalSelect } from "../terminal/index";
import {
  fetchFilingsWatchEvents,
  fetchFilingsWatchSettings,
  runFilingsWatchNow,
  saveFilingsWatchSettings,
  type FilingsWatchEvent,
  type FilingsWatchNotifyKind,
  type FilingsWatchSettings,
  FILINGS_WATCH_NOTIFY_OPTIONS,
} from "../../api/filingsWatch";

const EMPTY_SETTINGS: FilingsWatchSettings = {
  enabled: false,
  symbols_source: "watchlists",
  custom_symbols: [],
  run_hour_utc: 13,
  notify_on: [],
  sources: ["sec", "nse"],
  import_limit: 5,
};

const KIND_VARIANT: Record<FilingsWatchNotifyKind, "neutral" | "live" | "warn" | "danger" | "info" | "accent" | "success"> = {
  new_document: "info",
  adverse_regulatory: "danger",
  guidance_cut: "warn",
  stance_change: "accent",
};

const KIND_LABEL: Record<FilingsWatchNotifyKind, string> = {
  new_document: "New filing",
  adverse_regulatory: "Adverse regulatory",
  guidance_cut: "Guidance cut",
  stance_change: "Stance change",
};

function formatAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mergeNotify(list: FilingsWatchNotifyKind[], value: FilingsWatchNotifyKind, next: boolean): FilingsWatchNotifyKind[] {
  return next ? [...new Set([...list, value])] : list.filter((item) => item !== value);
}

export function FilingsWatchPanel() {
  const [settings, setSettings] = useState<FilingsWatchSettings>(EMPTY_SETTINGS);
  const [events, setEvents] = useState<FilingsWatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(settings.enabled);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRow, eventsRow] = await Promise.all([fetchFilingsWatchSettings(), fetchFilingsWatchEvents(50)]);
      setSettings(settingsRow);
      setEvents(eventsRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const eventsBySymbol = useMemo(() => {
    const grouped: Record<string, FilingsWatchEvent[]> = {};
    for (const event of events) {
      const symbol = event.symbol || "—";
      (grouped[symbol] ||= []).push(event);
    }
    return grouped;
  }, [events]);

  const symbols = useMemo(() => Object.keys(eventsBySymbol).sort(), [eventsBySymbol]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveFilingsWatchSettings(settings);
      setSettings(saved);
      window.dispatchEvent(
        new CustomEvent("ot:alert-toast", {
          detail: { title: "Filings watch saved", message: "Your filings watch settings were updated.", variant: "success", ttlMs: 4000 },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setError(null);
    try {
      await runFilingsWatchNow();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function updateSettings(partial: Partial<FilingsWatchSettings>): void {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  return (
    <TerminalPanel
      title="Filings watch"
      subtitle="Scheduled auto-import + alerts across your watchlists"
      actions={
        <TerminalButton size="sm" variant="accent" loading={running} disabled={!enabled} onClick={handleRunNow}>
          Run now
        </TerminalButton>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => updateSettings({ enabled: event.target.checked })}
              className="h-4 w-4 accent-[#FF6B00]"
              aria-label="Enable filings watch"
            />
            <span className="text-terminal-text">{enabled ? "Enabled" : "Disabled"}</span>
          </label>
          {!enabled ? (
            <div className="text-terminal-muted">Enable to collect filings and alert you on new documents and analysis changes.</div>
          ) : null}
        </div>

        {enabled ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-terminal-muted">Symbols from</div>
                <TerminalSelect
                  value={settings.symbols_source}
                  onChange={(event) => updateSettings({ symbols_source: event.target.value as FilingsWatchSettings["symbols_source"] })}
                  aria-label="Symbols source"
                >
                  <option value="watchlists">Watchlists</option>
                  <option value="custom">Custom list</option>
                </TerminalSelect>
              </div>

              <div>
                <div className="mb-1 text-terminal-muted">Run hour (UTC)</div>
                <TerminalInput
                  type="number"
                  min={0}
                  max={23}
                  value={String(settings.run_hour_utc)}
                  onChange={(event) =>
                    updateSettings({
                      run_hour_utc: Math.min(23, Math.max(0, parseInt(event.target.value || "0", 10) || 0)),
                    })
                  }
                  aria-label="Run hour UTC"
                />
              </div>
            </div>

            {settings.symbols_source === "custom" ? (
              <div>
                <div className="mb-1 text-terminal-muted">Custom symbols (comma separated)</div>
                <TerminalInput
                  as="textarea"
                  rows={2}
                  value={(settings.custom_symbols || []).join(", ")}
                  onChange={(event) =>
                    updateSettings({
                      custom_symbols: event.target.value
                        .split(",")
                        .map((token) => token.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                  placeholder="e.g. TATA, INFOSYS, WIPRO"
                  aria-label="Custom symbols"
                />
              </div>
            ) : (
              <div className="text-terminal-muted">Automatically sweeps every symbol in your watchlists.</div>
            )}

            <div>
              <div className="mb-1 text-terminal-muted">Notify on</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {FILINGS_WATCH_NOTIFY_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(settings.notify_on || []).includes(option.value)}
                      onChange={(event) =>
                        updateSettings({ notify_on: mergeNotify(settings.notify_on || [], option.value, event.target.checked) })
                      }
                      className="h-4 w-4 accent-[#FF6B00]"
                      aria-label={`Notify on ${option.value}`}
                    />
                    <span className="text-terminal-text">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-terminal-border pt-3">
              <div className="text-terminal-muted">{events.length} event(s) recorded across {symbols.length} symbol(s).</div>
              <TerminalButton size="sm" onClick={handleSave} loading={saving}>
                {saving ? "Saving…" : "Save"}
              </TerminalButton>
            </div>
          </>
        ) : null}

        {error ? <div className="rounded border border-terminal-neg/50 bg-terminal-neg/10 p-2 text-terminal-neg">{error}</div> : null}

        {loading ? (
          <div className="text-terminal-muted">Loading filings watch…</div>
        ) : (
          <div className="space-y-3">
            {symbols.length === 0 ? (
              <div className="rounded border border-terminal-border bg-terminal-bg p-3 text-terminal-muted">
                No filings-watch events yet. Enable the watch and run it once to see results.
              </div>
            ) : (
              symbols.map((symbol) => {
                const list = eventsBySymbol[symbol] || [];
                const latest = list[0] || null;
                return (
                  <div key={symbol} className="rounded border border-terminal-border bg-terminal-bg p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-terminal-text">{symbol}</div>
                      {latest?.action_url ? (
                        <a
                          href={latest.action_url}
                          className="text-xs text-terminal-accent hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open filings →
                        </a>
                      ) : null}
                    </div>
                    <ul className="mt-1.5 space-y-1.5">
                      {list.map((event, index) => (
                        <li key={`${event.kind}-${event.at}-${index}`} className="flex items-start justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <TerminalBadge size="sm" variant={KIND_VARIANT[event.kind] ?? "neutral"}>
                              {KIND_LABEL[event.kind] ?? event.kind}
                            </TerminalBadge>
                            <span className="truncate text-terminal-text">{event.title || "—"}</span>
                          </div>
                          <span className="shrink-0 text-terminal-muted">{formatAt(event.at)}</span>
                        </li>
                      ))}
                    </ul>
                    {latest?.detail ? (
                      <div className="mt-1.5 border-l-2 border-terminal-border pl-2 text-terminal-muted">{latest.detail}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </TerminalPanel>
  );
}