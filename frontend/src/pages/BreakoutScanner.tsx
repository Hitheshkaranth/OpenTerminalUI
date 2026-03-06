import { useEffect, useMemo, useState } from "react";

import { createScannerAlertRule, fetchScannerPresets, runScanner } from "../api/client";
import { BreakoutAlertCenter } from "../components/Alerts/BreakoutAlertCenter";
import { BreakoutRecommendations } from "../components/breakout/BreakoutRecommendations";
import { BreakoutScannerControls } from "../components/breakout/BreakoutScannerControls";
import { type AlertSocketEvent, useAlerts } from "../hooks/useAlerts";
import { useAlertsStore } from "../store/alertsStore";
import type { ScannerPreset, ScannerResult } from "../types";

const DESKTOP_KEY = "ot:breakout:desktop:v1";
const SOUND_KEY = "ot:breakout:sound:v1";

function readToggle(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) !== false;
  } catch {
    return fallback;
  }
}

function writeToggle(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function asFinite(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function inferTriggerLevels(row: ScannerResult): { triggerLevel: number; invalidationLevel?: number } {
  const levels = row.levels || {};
  const triggerLevel =
    asFinite(levels.trigger_level) ??
    asFinite(levels.breakout_level) ??
    asFinite(levels.entry) ??
    asFinite(levels.close) ??
    0;
  const invalidationLevel = asFinite(levels.invalidation_level) ?? asFinite(levels.stop_level) ?? asFinite(levels.support) ?? undefined;
  return { triggerLevel, invalidationLevel };
}

function eventToScannerResult(event: AlertSocketEvent): ScannerResult {
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const payloadScore = asFinite((payload as Record<string, unknown>).score);
  const payloadConfidence = asFinite((payload as Record<string, unknown>).confidence);
  const payloadLevels = (payload as Record<string, unknown>).levels;
  const levels: Record<string, unknown> = payloadLevels && typeof payloadLevels === "object" ? { ...(payloadLevels as Record<string, unknown>) } : {};
  if (asFinite(event.triggered_value) != null && levels.trigger_level == null) {
    levels.trigger_level = event.triggered_value;
  }
  const setup = (payload as Record<string, unknown>).setup_type;
  return {
    run_id: String((payload as Record<string, unknown>).run_id || "live"),
    symbol: event.symbol,
    setup_type: typeof setup === "string" && setup.trim() ? setup.trim() : "LIVE_ALERT",
    score: payloadScore ?? payloadConfidence ?? 1,
    signal_ts: event.timestamp,
    levels,
    features: ((payload as Record<string, unknown>).features as Record<string, unknown>) || {},
    explain: { event_type: event.event_type || "alert_triggered" },
  };
}

function sortRecommendations(items: ScannerResult[], sortBy: string): ScannerResult[] {
  const next = [...items];
  if (sortBy === "score_asc") {
    return next.sort((a, b) => Number(a.score || 0) - Number(b.score || 0));
  }
  if (sortBy === "symbol_asc") {
    return next.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  if (sortBy === "symbol_desc") {
    return next.sort((a, b) => b.symbol.localeCompare(a.symbol));
  }
  if (sortBy === "signal_desc") {
    return next.sort((a, b) => (Date.parse(b.signal_ts || "") || 0) - (Date.parse(a.signal_ts || "") || 0));
  }
  return next.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

export function BreakoutScannerPage() {
  const unreadCount = useAlertsStore((s) => s.unreadCount);
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [presetId, setPresetId] = useState("");
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ScannerResult[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [setupFilter, setSetupFilter] = useState("ALL");
  const [minScore, setMinScore] = useState(0);
  const [sortBy, setSortBy] = useState("score_desc");
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [desktopEnabled, setDesktopEnabled] = useState<boolean>(() => readToggle(DESKTOP_KEY, true));
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => readToggle(SOUND_KEY, true));
  const [events, setEvents] = useState<AlertSocketEvent[]>([]);

  const { connected } = useAlerts({
    desktopEnabled,
    soundEnabled,
    onAlert: (event) => {
      setEvents((prev) => [event, ...prev].slice(0, 40));
      setRows((prev) => {
        const liveRow = eventToScannerResult(event);
        const idx = prev.findIndex((row) => row.symbol === liveRow.symbol && row.setup_type === liveRow.setup_type);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...liveRow };
          return next;
        }
        return [liveRow, ...prev].slice(0, 200);
      });
    },
  });

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const list = await fetchScannerPresets();
        if (!mounted) return;
        setPresets(list);
        const breakoutPreset = list.find((item) => item.name.toLowerCase().includes("breakout")) || list[0];
        setPresetId(breakoutPreset?.id || "");
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load scanner presets");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const recommendations = useMemo(() => {
    const threshold = Number.isFinite(minScore) ? Math.max(0, Math.min(1, minScore)) : 0;
    const filtered = rows.filter((row) => {
      if (setupFilter !== "ALL" && row.setup_type !== setupFilter) return false;
      return Number(row.score || 0) >= threshold;
    });
    return sortRecommendations(filtered, sortBy);
  }, [minScore, rows, setupFilter, sortBy]);

  const setupTypes = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows) {
      if (row.setup_type) keys.add(row.setup_type);
    }
    return [...keys].sort();
  }, [rows]);

  async function runBreakoutScan() {
    if (!presetId) return;
    setLoading(true);
    setError(null);
    setActionStatus(null);
    try {
      const payload = await runScanner({ preset_id: presetId, limit: Math.max(5, Math.min(200, limit)), offset: 0 });
      setRows((payload.rows as ScannerResult[]) || []);
      setRunId(String(payload.run_id || ""));
      setActionStatus(`Scan complete: ${Number(payload.count || 0)} matches`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run breakout scan");
    } finally {
      setLoading(false);
    }
  }

  async function createBreakoutAlert(row: ScannerResult) {
    const { triggerLevel, invalidationLevel } = inferTriggerLevels(row);
    if (triggerLevel <= 0) {
      setActionStatus(`Skipped ${row.symbol}: missing trigger level`);
      return;
    }
    setActionStatus(`Creating alert for ${row.symbol}...`);
    try {
      await createScannerAlertRule({
        preset_id: presetId || undefined,
        symbol: row.symbol,
        setup_type: row.setup_type,
        trigger_level: triggerLevel,
        invalidation_level: invalidationLevel,
        near_trigger_pct: 0.003,
        dedupe_minutes: 15,
        enabled: true,
        meta_json: { run_id: runId || row.run_id || "", score: row.score },
      });
      setActionStatus(`Alert created for ${row.symbol}`);
    } catch (e) {
      setActionStatus(e instanceof Error ? e.message : "Failed to create breakout alert");
    }
  }

  return (
    <div className="space-y-3 p-3" data-testid="breakout-scanner-page">
      <BreakoutScannerControls
        presets={presets}
        selectedPresetId={presetId}
        limit={limit}
        setupTypes={setupTypes}
        selectedSetupType={setupFilter}
        minScore={minScore}
        sortBy={sortBy}
        loading={loading}
        onPresetChange={setPresetId}
        onLimitChange={(value) => setLimit(Math.max(5, Math.min(200, Number.isFinite(value) ? value : 30)))}
        onSetupTypeChange={setSetupFilter}
        onMinScoreChange={(value) => setMinScore(Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)}
        onSortByChange={setSortBy}
        onRun={() => void runBreakoutScan()}
      />
      {error ? <div className="rounded border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div> : null}
      {actionStatus ? <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">{actionStatus}</div> : null}
      <BreakoutAlertCenter
        connected={connected}
        desktopEnabled={desktopEnabled}
        soundEnabled={soundEnabled}
        unreadCount={unreadCount}
        events={events}
        onDesktopToggle={(next) => {
          setDesktopEnabled(next);
          writeToggle(DESKTOP_KEY, next);
        }}
        onSoundToggle={(next) => {
          setSoundEnabled(next);
          writeToggle(SOUND_KEY, next);
        }}
      />
      <BreakoutRecommendations rows={recommendations} onCreateAlert={(row) => void createBreakoutAlert(row)} />
    </div>
  );
}
