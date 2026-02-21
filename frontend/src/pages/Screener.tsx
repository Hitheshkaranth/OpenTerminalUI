import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createScannerAlertRule,
  createScannerPreset,
  deleteScannerPreset,
  fetchScannerPresets,
  runScanner,
  updateScannerPreset,
} from "../api/client";
import { useStockStore } from "../store/stockStore";
import { useCapexTracker, useShareholdingPattern, useStock } from "../hooks/useStocks";
import type { ScannerPreset, ScannerPresetPayload } from "../types";

function formatPct(val?: number | null) {
  if (val == null) return "--";
  return `${val.toFixed(2)}%`;
}

function formatVal(val?: number | null) {
  if (val == null) return "--";
  return val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function ScreenerFundamentals({ symbol }: { symbol: string }) {
  const { data: stock } = useStock(symbol);
  const { data: capex } = useCapexTracker(symbol);
  const { data: shareholding } = useShareholdingPattern(symbol);

  const latestCapex = capex?.points && capex.points.length > 0 ? capex.points[capex.points.length - 1].capex : null;

  return (
    <div className="rounded border border-terminal-border bg-terminal-bg p-2 space-y-2 mt-2">
      <div className="font-semibold text-terminal-accent">Fundamentals & Flow</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-terminal-muted">P/E Ratio</div>
          <div>{formatVal(stock?.pe)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">P/B Ratio</div>
          <div>{formatVal(stock?.pb_calc)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Div Yield</div>
          <div>{formatPct(stock?.div_yield_pct)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Latest Capex</div>
          <div>{latestCapex ? `${formatVal(latestCapex)} Cr` : "--"}</div>
        </div>
        <div>
          <div className="text-terminal-muted">FII Holding</div>
          <div>{formatPct(shareholding?.fii_holding)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">DII Holding</div>
          <div>{formatPct(shareholding?.dii_holding)}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Promoter</div>
          <div>{formatPct(shareholding?.promoter_holding)}</div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_PRESET: ScannerPresetPayload = {
  name: "New Preset",
  universe: "NSE:NIFTY200",
  timeframe: "1d",
  liquidity_gate: { min_price: 50, min_avg_volume: 100000, min_avg_traded_value: 5000000 },
  rules: [{ type: "breakout_n_day_high", params: { n: 20, buffer_pct: 0.001, rvol_threshold: 2.0, near_trigger_pct: 0.003 } }],
  ranking: { mode: "default", params: {} },
};

export function ScreenerPage() {
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [editPreset, setEditPreset] = useState<ScannerPresetPayload>(EMPTY_PRESET);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [summary, setSummary] = useState<Record<string, unknown>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [nearTriggerPct, setNearTriggerPct] = useState(0.003);
  const [loading, setLoading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPresets() {
    const items = await fetchScannerPresets();
    setPresets(items);
    if (!selectedPresetId && items.length > 0) {
      setSelectedPresetId(items[0].id);
      setEditPreset({
        name: items[0].name,
        universe: items[0].universe,
        timeframe: items[0].timeframe,
        liquidity_gate: items[0].liquidity_gate,
        rules: items[0].rules,
        ranking: items[0].ranking,
      });
    }
  }

  useEffect(() => {
    void loadPresets();
  }, []);

  const selectedPreset = useMemo(() => presets.find((p) => p.id === selectedPresetId) || null, [presets, selectedPresetId]);

  async function onRun() {
    if (!selectedPresetId) return;
    setLoading(true);
    setError(null);
    try {
      const out = await runScanner({ preset_id: selectedPresetId, limit: 400, offset: 0 });
      setRows(Array.isArray(out.rows) ? out.rows : []);
      setSummary(out.summary || {});
      setRunId(out.run_id);
      setSelectedRow(Array.isArray(out.rows) && out.rows.length > 0 ? (out.rows[0] as Record<string, unknown>) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scanner run failed");
      setRows([]);
      setSummary({});
      setRunId(null);
      setSelectedRow(null);
    } finally {
      setLoading(false);
    }
  }

  async function onSavePreset() {
    setSavingPreset(true);
    setError(null);
    try {
      if (selectedPresetId) {
        await updateScannerPreset(selectedPresetId, editPreset);
      } else {
        await createScannerPreset(editPreset);
      }
      await loadPresets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preset save failed");
    } finally {
      setSavingPreset(false);
    }
  }

  async function onDeletePreset() {
    if (!selectedPresetId) return;
    await deleteScannerPreset(selectedPresetId);
    setSelectedPresetId(null);
    setEditPreset(EMPTY_PRESET);
    await loadPresets();
  }

  async function onCreateScannerAlert() {
    if (!selectedRow) return;
    const symbol = String(selectedRow.symbol || "");
    const setupType = String(selectedRow.setup_type || "SCANNER_SETUP");
    const triggerLevel = Number(selectedRow.breakout_level || 0);
    if (!symbol || triggerLevel <= 0) {
      setError("Selected row missing symbol or breakout_level");
      return;
    }
    await createScannerAlertRule({
      preset_id: selectedPresetId || undefined,
      symbol,
      setup_type: setupType,
      trigger_level: triggerLevel,
      near_trigger_pct: nearTriggerPct,
      dedupe_minutes: 15,
      enabled: true,
      meta_json: { run_id: runId || undefined, explain: selectedRow.explain || {} },
    });
  }

  const columns = rows.length > 0 ? Object.keys(rows[0] || {}) : [];

  return (
    <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
      <section className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="text-sm font-semibold text-terminal-accent">Screener Presets</div>
        <div className="space-y-1">
          {presets.map((p) => (
            <button
              key={p.id}
              className={`block w-full rounded border px-2 py-1 text-left text-xs ${p.id === selectedPresetId ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => {
                setSelectedPresetId(p.id);
                setEditPreset({
                  name: p.name,
                  universe: p.universe,
                  timeframe: p.timeframe,
                  liquidity_gate: p.liquidity_gate,
                  rules: p.rules,
                  ranking: p.ranking,
                });
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <label className="block text-xs">
          Name
          <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={editPreset.name} onChange={(e) => setEditPreset((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="block text-xs">
          Universe
          <select className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={editPreset.universe} onChange={(e) => setEditPreset((s) => ({ ...s, universe: e.target.value }))}>
            <option value="NSE:NIFTY50">NSE NIFTY50</option>
            <option value="NSE:NIFTY100">NSE NIFTY100</option>
            <option value="NSE:NIFTY200">NSE NIFTY200</option>
            <option value="NSE:NIFTY500">NSE NIFTY500</option>
            <option value="NSE:FNO">NSE FnO</option>
            <option value="US:SP500">US S&amp;P500</option>
            <option value="US:NASDAQ100">US NASDAQ100</option>
          </select>
        </label>
        <label className="block text-xs">
          Rule Type
          <select
            className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1"
            value={String(editPreset.rules[0]?.type || "breakout_n_day_high")}
            onChange={(e) =>
              setEditPreset((s) => ({
                ...s,
                rules: [{ type: e.target.value, params: e.target.value === "breakout_n_day_high" ? { n: 20, buffer_pct: 0.001, rvol_threshold: 2.0, near_trigger_pct: 0.003 } : {} }],
              }))
            }
          >
            <option value="breakout_n_day_high">Breakout N-Day High</option>
            <option value="bb_squeeze_breakout">BB Squeeze Breakout</option>
            <option value="nr7_breakout">NR7 Breakout</option>
            <option value="inside_bar_breakout">Inside Bar Breakout</option>
            <option value="trend_retest">Trend Retest</option>
            <option value="supertrend_flip_ema_stack">Supertrend Flip + EMA Stack</option>
          </select>
        </label>
        <div className="flex gap-2 text-xs">
          <button className="rounded border border-terminal-border px-2 py-1" onClick={onSavePreset} disabled={savingPreset}>
            {savingPreset ? "Saving..." : "Save"}
          </button>
          <button className="rounded border border-terminal-border px-2 py-1" onClick={onRun} disabled={loading || !selectedPresetId}>
            {loading ? "Running..." : "Run Preset"}
          </button>
          <button className="rounded border border-terminal-neg px-2 py-1 text-terminal-neg" onClick={() => setEditPreset(EMPTY_PRESET)}>
            New
          </button>
          <button className="rounded border border-terminal-neg px-2 py-1 text-terminal-neg" onClick={() => void onDeletePreset()} disabled={!selectedPresetId}>
            Delete
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex items-center justify-between text-sm">
          <div className="font-semibold text-terminal-accent">Today&apos;s Setups</div>
          <div className="text-xs text-terminal-muted">Market Pulse: {Number(summary.matches || rows.length)} matches</div>
        </div>
        {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted">
                {columns.map((col) => (
                  <th key={col} className="px-2 py-1 text-left">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="cursor-pointer border-b border-terminal-border/50 hover:bg-terminal-bg" onClick={() => setSelectedRow(row)}>
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1">
                      {typeof row[col] === "number" ? Number(row[col]).toFixed(4) : String(row[col] ?? "-")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="text-sm font-semibold text-terminal-accent">Explainability</div>
        {!selectedRow ? (
          <div className="text-terminal-muted">Select a row to inspect why it triggered.</div>
        ) : (
          <>
            <div className="rounded border border-terminal-border bg-terminal-bg p-2">
              <div className="font-medium">{String(selectedRow.symbol || "-")}</div>
              <div>Setup: {String(selectedRow.setup_type || "-")}</div>
              <div>Score: {Number(selectedRow.score || 0).toFixed(4)}</div>
              <div>Breakout Level: {Number(selectedRow.breakout_level || 0).toFixed(4)}</div>
              <div>Distance: {Number(selectedRow.distance_to_trigger || 0).toFixed(4)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg p-2">
              <div className="mb-1 font-medium">Rule Steps</div>
              {Array.isArray((selectedRow.explain as { steps?: Array<Record<string, unknown>> } | undefined)?.steps) &&
                ((selectedRow.explain as { steps?: Array<Record<string, unknown>> }).steps || []).length > 0 ? (
                ((selectedRow.explain as { steps?: Array<Record<string, unknown>> }).steps || []).map((step, i) => (
                  <div key={i} className="mb-1 rounded border border-terminal-border/60 p-1">
                    <div>{String(step.rule || "-")}</div>
                    <div className={step.passed ? "text-terminal-pos" : "text-terminal-neg"}>{Boolean(step.passed) ? "PASS" : "FAIL"}</div>
                  </div>
                ))
              ) : (
                <div className="text-terminal-muted">No explain steps.</div>
              )}
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg p-2">
              <div className="mb-1 font-medium">Alert Me</div>
              <label className="block">
                Near Trigger (%)
                <input
                  type="range"
                  min={0.001}
                  max={0.01}
                  step={0.001}
                  value={nearTriggerPct}
                  onChange={(e) => setNearTriggerPct(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <div className="mb-2">{(nearTriggerPct * 100).toFixed(2)}%</div>
              <div className="flex gap-2">
                <button className="rounded border border-terminal-border px-2 py-1" onClick={() => void onCreateScannerAlert()}>
                  Create Scanner Alert
                </button>
                <button
                  className="rounded border border-terminal-border px-2 py-1"
                  onClick={() => {
                    const symbol = String(selectedRow.symbol || "");
                    if (!symbol) return;
                    setTicker(symbol);
                    navigate("/equity/stocks");
                  }}
                >
                  Open Chart
                </button>
              </div>
            </div>
            {selectedRow.symbol && <ScreenerFundamentals symbol={String(selectedRow.symbol)} />}
          </>
        )}
        <div className="text-terminal-muted mt-2">Run ID: {runId || "-"}</div>
        <div className="text-terminal-muted">Preset: {selectedPreset?.name || "-"}</div>
      </section>
    </div>
  );
}
