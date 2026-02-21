import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import type { Bar } from "oakscriptjs";

import {
  fetchActiveDataVersion,
  fetchBacktestJobResult,
  fetchBacktestJobStatus,
  searchSymbols,
  submitBacktestJob,
  type SearchSymbolItem,
  type BacktestJobResult,
} from "../api/client";
import {
  ChartTabPanel,
  ComparePanel,
  DrawdownTerrain3DPanel,
  DistributionPanel,
  DrawdownPanel,
  EquityCurvePanel,
  MonthlyHeatmapPanel,
  ParameterSurface3DPanel,
  RegimeEfficacy3DPanel,
  RollingMetricsPanel,
  OrderbookLiquidity3DPanel,
  ImpliedVolatilitySurface3DPanel,
  VolatilitySurface3DPanel,
  MonteCarloSimulationPanel,
  TradesPanel,
} from "../components/backtesting/panels/BacktestingPanels";
import type { Surface3DPoint } from "../components/backtesting/panels/Backtesting3D";
import { ParameterSensitivityHeatmap } from "../components/backtesting/panels/ParameterSensitivityHeatmap";
import { WalkForwardTimeline } from "../components/backtesting/panels/WalkForwardTimeline";
import { MosaicWorkspace } from "../components/backtesting/workspace/MosaicWorkspace";
import type { PanelRendererMap } from "../components/backtesting/workspace/PanelRegistry";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import type { ChartKind, IndicatorConfig } from "../shared/chart/types";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";

type JobState = "idle" | "queued" | "running" | "done" | "failed";
type BacktestTimeframe = "1D" | "1W" | "1M";
type BacktestMarket = "NSE" | "BSE" | "NYSE" | "NASDAQ" | "AMEX";
type VizTab =
  | "chart"
  | "equity"
  | "drawdown"
  | "monthly"
  | "rolling"
  | "trades"
  | "compare"
  | "surface3d";

type StrategyDef = {
  key: string;
  label: string;
  category: string;
  description: string;
  default_context: Record<string, unknown>;
  default_allocation: number;
};

type Analytics = {
  monthly_returns: { year: number; month: number; return_pct: number }[];
  drawdown_series: { date: string; drawdown_pct: number; equity: number; peak: number }[];
  rolling_metrics: { date: string; rolling_sharpe: number; rolling_volatility: number; rolling_return: number }[];
  return_distribution: { bins: number[]; counts: number[]; stats: Record<string, number> };
  trade_analytics: {
    scatter: { entry_date: string; exit_date: string; pnl: number; return_pct: number; holding_days: number }[];
    streaks: { max_win_streak: number; max_loss_streak: number; current_streak: number; current_streak_type: string };
    summary: Record<string, number>;
  };
};

type CompareState = { result: BacktestJobResult | null; status: string };
type WalkForwardWindow = {
  window: string;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  sharpe: number;
  total_return: number;
  max_drawdown: number;
};
type SensitivityRow = { id: string; data: Array<{ x: string; y: number }> };

const STRATEGY_CATALOG: StrategyDef[] = [
  { key: "sma_crossover", label: "SMA Crossover (20/50)", category: "trend", description: "Trend-following model using simple moving average crossover.", default_context: { short_window: 20, long_window: 50 }, default_allocation: 1.0 },
  { key: "ema_crossover", label: "EMA Crossover (12/26)", category: "trend", description: "Faster trend model using exponential moving averages.", default_context: { short_window: 12, long_window: 26 }, default_allocation: 0.75 },
  { key: "mean_reversion", label: "Mean Reversion (Z-Score)", category: "mean_reversion", description: "Contrarian model buying weakness and selling strength.", default_context: { lookback: 20, entry_z: 1.0 }, default_allocation: 0.55 },
  { key: "breakout_20", label: "20-Day Breakout", category: "breakout", description: "Momentum breakout model using rolling high/low triggers.", default_context: { lookback: 20 }, default_allocation: 1.0 },
  { key: "rsi_overbought_oversold", label: "RSI Overbought/Oversold", category: "oscillator", description: "Buys oversold RSI and sells overbought RSI.", default_context: { period: 14, oversold: 30, overbought: 70 }, default_allocation: 0.6 },
  { key: "macd_crossover", label: "MACD Crossover", category: "trend", description: "Signals with MACD line crossing signal line.", default_context: { fast: 12, slow: 26, signal: 9 }, default_allocation: 0.8 },
  { key: "bollinger_bands", label: "Bollinger Bands", category: "volatility", description: "Mean-reversion entries at volatility band extremes.", default_context: { period: 20, std_dev: 2.0, squeeze_pct: 0.04 }, default_allocation: 0.6 },
  { key: "dual_momentum", label: "Dual Momentum", category: "momentum", description: "Directional bias from lookback momentum.", default_context: { lookback: 63, threshold: 0.0 }, default_allocation: 1.0 },
  { key: "vwap_reversion", label: "VWAP Reversion", category: "mean_reversion", description: "Reverts to cumulative VWAP with volume confirmation.", default_context: { deviation_pct: 0.02, volume_mult: 1.5 }, default_allocation: 0.65 },
  { key: "supertrend", label: "Supertrend", category: "trend", description: "ATR-based trend direction filter.", default_context: { atr_period: 10, multiplier: 3.0 }, default_allocation: 0.9 },
  { key: "ichimoku_cloud", label: "Ichimoku Cloud", category: "trend", description: "TK cross confirmation with cloud position.", default_context: { tenkan: 9, kijun: 26, senkou_b: 52 }, default_allocation: 0.85 },
  { key: "triple_ema", label: "Triple EMA Ribbon (8/21/55)", category: "trend", description: "Directional ribbon alignment of fast/mid/slow EMAs.", default_context: { fast: 8, mid: 21, slow: 55 }, default_allocation: 0.8 },
  { key: "premarket_orb_breakout", label: "Premarket + ORB Breakout", category: "breakout", description: "Breakout from prior-session range and open-range bands.", default_context: { premarket_lookback: 1, orb_window: 3 }, default_allocation: 0.8 },
  {
    key: "pure_jump_markov_vol",
    label: "Pure-Jump Markov Volatility",
    category: "volatility",
    description: "Particle-filtered jump-vol stress model with trend gating for risk-on/risk-off positioning.",
    default_context: {
      a0: -2.2,
      a1: 0.5,
      b0: 0.0,
      b1: -0.2,
      k_plus: 18.0,
      k_minus: 14.0,
      mu: 0.0,
      n_particles: 256,
      lookback: 252,
      stress_exit: 1.5,
      stress_entry: 0.5,
      hold_logic: "hold",
      seed: 42,
    },
    default_allocation: 0.7,
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  trend: "#00d4aa",
  mean_reversion: "#fbbf24",
  breakout: "#f472b6",
  oscillator: "#818cf8",
  volatility: "#fb923c",
  momentum: "#38bdf8",
};

const VIZ_TABS: { key: VizTab; label: string; icon: string }[] = [
  { key: "chart", label: "Price Chart", icon: "" },
  { key: "equity", label: "Equity Curve", icon: "" },
  { key: "drawdown", label: "Drawdown", icon: "" },
  { key: "monthly", label: "Monthly Returns", icon: "" },
  { key: "rolling", label: "Rolling Metrics", icon: "" },
  { key: "trades", label: "Trade Analysis", icon: "" },
  { key: "compare", label: "Compare", icon: "CMP" },
  { key: "surface3d", label: "3D Surface", icon: "3D" },
];

const CUSTOM_STRATEGY_VALUE = "custom";
const KNOWN_MARKETS: BacktestMarket[] = ["NSE", "BSE", "NYSE", "NASDAQ", "AMEX"];

const STRATEGY_INDICATORS: Record<string, IndicatorConfig[]> = {
  sma_crossover: [
    { id: "sma", params: { period: 20 }, visible: true, color: terminalColors.positive, lineWidth: 2 },
    { id: "rsi", params: { period: 14 }, visible: true, color: terminalColors.warning, lineWidth: 1 },
  ],
  ema_crossover: [
    { id: "ema", params: { period: 12 }, visible: true, color: terminalColors.info, lineWidth: 2 },
    { id: "macd", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, visible: true, color: terminalColors.text, lineWidth: 1 },
  ],
  mean_reversion: [
    { id: "bb", params: { period: 20, stdDev: 2 }, visible: true, color: terminalColors.accent, lineWidth: 1 },
    { id: "rsi", params: { period: 14 }, visible: true, color: terminalColors.warning, lineWidth: 1 },
  ],
  breakout_20: [
    { id: "donchian", params: { period: 20 }, visible: true, color: terminalColors.candleUp, lineWidth: 1 },
    { id: "atr", params: { period: 14 }, visible: true, color: terminalColors.candleDown, lineWidth: 1 },
  ],
  premarket_orb_breakout: [
    { id: "donchian", params: { period: 10 }, visible: true, color: terminalColors.warning, lineWidth: 1 },
    { id: "atr", params: { period: 14 }, visible: true, color: terminalColors.info, lineWidth: 1 },
  ],
  pure_jump_markov_vol: [
    { id: "atr", params: { period: 14 }, visible: true, color: terminalColors.warning, lineWidth: 1 },
    { id: "sma", params: { period: 50 }, visible: true, color: terminalColors.info, lineWidth: 1 },
    { id: "sma", params: { period: 200 }, visible: true, color: terminalColors.accent, lineWidth: 1 },
  ],
};

const DEFAULT_SCRIPT = `def generate_signals(df, context):
    # valid values: -1, 0, 1
    out = []
    for _, row in df.iterrows():
        out.append(1 if row["close"] >= row["open"] else -1)
    return out
`;

function fmtPct(value: number): string { return `${(value * 100).toFixed(2)}%`; }

function bucketKey(ts: number, tf: BacktestTimeframe): string {
  const d = new Date(ts * 1000);
  if (tf === "1D") return d.toISOString().slice(0, 10);
  if (tf === "1M") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const day = (d.getUTCDay() + 6) % 7;
  const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return weekStart.toISOString().slice(0, 10);
}

function aggregateBars(input: Bar[], tf: BacktestTimeframe): Bar[] {
  if (tf === "1D") return input;
  const groups = new Map<string, Bar[]>();
  for (const b of input) {
    const key = bucketKey(Number(b.time), tf);
    const arr = groups.get(key) ?? [];
    arr.push(b);
    groups.set(key, arr);
  }
  const out: Bar[] = [];
  for (const [, arr] of groups) {
    const sorted = [...arr].sort((a, b) => Number(a.time) - Number(b.time));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    out.push({
      time: Number(first.time),
      open: Number(first.open),
      high: Math.max(...sorted.map((x) => Number(x.high))),
      low: Math.min(...sorted.map((x) => Number(x.low))),
      close: Number(last.close),
      volume: sorted.reduce((acc, x) => acc + Number(x.volume ?? 0), 0),
    });
  }
  return out.sort((a, b) => Number(a.time) - Number(b.time));
}

function toBarsFromEquityCurve(
  equityCurve: Array<{ date: string; open: number; high: number; low: number; close: number; position?: number }>,
): Bar[] {
  return equityCurve
    .map((p) => ({
      time: Math.floor(new Date(`${p.date}T00:00:00Z`).getTime() / 1000),
      open: Number(p.open ?? p.close),
      high: Number(p.high ?? p.close),
      low: Number(p.low ?? p.close),
      close: Number(p.close),
      volume: Math.max(1, Math.round(Math.abs(Number(p.position ?? 0)) * 100)),
    }))
    .filter(
      (b) =>
        Number.isFinite(Number(b.time)) &&
        Number.isFinite(Number(b.open)) &&
        Number.isFinite(Number(b.high)) &&
        Number.isFinite(Number(b.low)) &&
        Number.isFinite(Number(b.close)),
    );
}

function mapTradeMarkersToTimeframe(
  bars: Bar[],
  timeframe: BacktestTimeframe,
  trades: Array<{ date: string; price: number; action: string }>,
): Array<{ date: string; price: number; action: "BUY" | "SELL" }> {
  const keyToTime = new Map<string, number>();
  for (const b of bars) keyToTime.set(bucketKey(Number(b.time), timeframe), Number(b.time));
  return trades.map((m) => {
    const ts = Math.floor(new Date(`${m.date}T00:00:00Z`).getTime() / 1000);
    const mapped = keyToTime.get(bucketKey(ts, timeframe));
    return {
      date: mapped ? new Date(mapped * 1000).toISOString().slice(0, 10) : m.date,
      price: Number(m.price),
      action: (String(m.action).toUpperCase() === "BUY" ? "BUY" : "SELL") as "BUY" | "SELL",
    };
  });
}

function emptyState(icon: string, text: string) {
  return (
    <div className="flex h-[56vh] min-h-[360px] items-center justify-center rounded border border-terminal-border/40 bg-terminal-bg/50 text-center">
      <div>
        <div className="text-3xl">{icon}</div>
        <div className="mt-2 text-xs text-terminal-muted">{text}</div>
      </div>
    </div>
  );
}

function buildPolylinePoints(values: number[]): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => `${((i / Math.max(values.length - 1, 1)) * 100).toFixed(2)},${(95 - ((v - min) / span) * 90).toFixed(2)}`)
    .join(" ");
}

function computePremarketOrbLines(
  bars: Bar[],
  ctx: Record<string, unknown>,
): Array<{ label: string; price: number; color: string }> {
  if (!bars.length) return [];
  const lookback = Math.max(1, Number(ctx.premarket_lookback ?? 1));
  const orbWindow = Math.max(1, Number(ctx.orb_window ?? 3));
  const preSlice = bars.slice(Math.max(0, bars.length - 1 - lookback), Math.max(0, bars.length - 1));
  const orbSlice = bars.slice(Math.max(0, bars.length - orbWindow));
  if (!preSlice.length || !orbSlice.length) return [];
  const preHigh = Math.max(...preSlice.map((b) => Number(b.high)));
  const preLow = Math.min(...preSlice.map((b) => Number(b.low)));
  const orbHigh = Math.max(...orbSlice.map((b) => Number(b.high)));
  const orbLow = Math.min(...orbSlice.map((b) => Number(b.low)));
  return [
    { label: "PRE-H", price: preHigh, color: terminalColors.warning },
    { label: "PRE-L", price: preLow, color: terminalColors.warning },
    { label: "ORB-H", price: orbHigh, color: terminalColors.info },
    { label: "ORB-L", price: orbLow, color: terminalColors.info },
  ];
}

export function BacktestingPage() {
  const location = useLocation();
  const storeTicker = useStockStore((s) => s.ticker);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);

  const [asset, setAsset] = useState((storeTicker || "RELIANCE").toUpperCase());
  const [assetSuggestions, setAssetSuggestions] = useState<SearchSymbolItem[]>([]);
  const [showAssetSuggestions, setShowAssetSuggestions] = useState(false);
  const [market, setMarket] = useState<BacktestMarket>((selectedMarket as BacktestMarket) || "NSE");
  const [tradeCapital, setTradeCapital] = useState(100000);
  const [start, setStart] = useState("2024-01-01");
  const [end, setEnd] = useState("2026-01-01");
  const [strategyMode, setStrategyMode] = useState(STRATEGY_CATALOG[0].key);
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [runId, setRunId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestJobResult | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>("1D");
  const [showVolume, setShowVolume] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showIndicators, setShowIndicators] = useState(true);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>(STRATEGY_INDICATORS.sma_crossover || []);
  const [activeTab, setActiveTab] = useState<VizTab>("chart");
  const [compareStrategies, setCompareStrategies] = useState<string[]>([]);
  const [compareResults, setCompareResults] = useState<Map<string, CompareState>>(new Map());
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareActiveStrategy, setCompareActiveStrategy] = useState<string | null>(null);
  const [walkForwardWindows, setWalkForwardWindows] = useState<WalkForwardWindow[]>([]);
  const [sensitivityRows, setSensitivityRows] = useState<SensitivityRow[]>([]);
  const [dataVersionId, setDataVersionId] = useState<string>("");
  const [adjustedSeries, setAdjustedSeries] = useState(true);
  const [executionProfile, setExecutionProfile] = useState({
    commission_bps: 5,
    slippage_bps: 3,
    spread_bps: 1,
    market_impact_bps: 0,
  });
  const proWorkspaceEnabled = import.meta.env.VITE_BACKTEST_PRO_WORKSPACE === "1";

  useEffect(() => { if (storeTicker) setAsset(storeTicker.toUpperCase()); }, [storeTicker]);
  useEffect(() => { if (selectedMarket) setMarket(selectedMarket); }, [selectedMarket]);
  useEffect(() => {
    void (async () => {
      try {
        const version = await fetchActiveDataVersion();
        setDataVersionId(version.id);
      } catch {
        setDataVersionId("");
      }
    })();
  }, []);

  useEffect(() => {
    const q = asset.trim().toUpperCase();
    if (q.length < 1) {
      setAssetSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const rows = await searchSymbols(q, market);
          if (!active) return;
          setAssetSuggestions((rows || []).slice(0, 10));
          const exact = (rows || []).find((item) => (item.ticker || "").toUpperCase() === q);
          const ex = (exact?.exchange || "").toUpperCase();
          if (KNOWN_MARKETS.includes(ex as BacktestMarket)) {
            setMarket(ex as BacktestMarket);
          }
        } catch {
          if (active) setAssetSuggestions([]);
        }
      })();
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [asset, market]);

  useEffect(() => {
    if (strategyMode === CUSTOM_STRATEGY_VALUE) {
      setActiveIndicators([]);
      return;
    }
    setActiveIndicators(STRATEGY_INDICATORS[strategyMode] || []);
  }, [strategyMode]);

  const symbol = useMemo(() => asset.trim().toUpperCase(), [asset]);
  const currencyCode = useMemo(() => (["NYSE", "NASDAQ", "AMEX"].includes(market) ? "USD" : "INR"), [market]);
  const moneyLocale = useMemo(() => (currencyCode === "USD" ? "en-US" : "en-IN"), [currencyCode]);
  const fmtMoney = useCallback(
    (value: number): string =>
      new Intl.NumberFormat(moneyLocale, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: 2,
      }).format(value),
    [currencyCode, moneyLocale],
  );
  const activePreset = useMemo(() => STRATEGY_CATALOG.find((s) => s.key === strategyMode) || STRATEGY_CATALOG[0], [strategyMode]);
  const modelAllocation = useMemo(() => (strategyMode === CUSTOM_STRATEGY_VALUE ? 1 : (activePreset?.default_allocation ?? 1)), [activePreset, strategyMode]);

  const canSubmit = useMemo(() => {
    if (!asset.trim()) return false;
    if (!Number.isFinite(tradeCapital) || tradeCapital <= 0) return false;
    if (strategyMode === CUSTOM_STRATEGY_VALUE && !script.trim()) return false;
    return jobState !== "queued" && jobState !== "running";
  }, [asset, jobState, script, strategyMode, tradeCapital]);

  const submit = async () => {
    setError(null);
    setResult(null);
    setAnalytics(null);
    const strategy = strategyMode === CUSTOM_STRATEGY_VALUE ? script : `example:${strategyMode}`;
    const context = strategyMode === CUSTOM_STRATEGY_VALUE ? {} : (activePreset?.default_context ?? {});
    const res = await submitBacktestJob({
      symbol,
      asset: symbol,
      market,
      start,
      end,
      strategy,
      context,
      config: {
        initial_cash: tradeCapital,
        position_fraction: modelAllocation,
        data_version_id: dataVersionId || undefined,
        adjusted: adjustedSeries,
        execution_profile: executionProfile,
      },
    });
    setRunId(res.run_id);
    setJobState("queued");
  };

  useEffect(() => {
    if (!runId || (jobState !== "queued" && jobState !== "running")) return;
    let active = true;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchBacktestJobStatus(runId);
          if (!active) return;
          if (status.status === "done" || status.status === "failed") {
            const payload = await fetchBacktestJobResult(runId);
            if (!active) return;
            setResult(payload);
            setJobState(payload.status === "done" ? "done" : "failed");
            if (payload.status === "failed") setError(payload.error || "Backtest failed");
            window.clearInterval(timer);
          } else {
            setJobState(status.status === "running" ? "running" : "queued");
          }
        } catch (e) {
          if (!active) return;
          setError(e instanceof Error ? e.message : "Polling failed");
          setJobState("failed");
          window.clearInterval(timer);
        }
      })();
    }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [jobState, runId]);

  const fetchAnalytics = useCallback(async () => {
    if (!runId || jobState !== "done") return;
    setAnalyticsLoading(true);
    try {
      const resp = await fetch(`/api/backtests/${runId}/analytics`);
      if (resp.ok) {
        const data = (await resp.json()) as { analytics: Analytics };
        setAnalytics(data.analytics);
      }
    } catch {
      // no-op fallback
    } finally {
      setAnalyticsLoading(false);
    }
  }, [runId, jobState]);

  useEffect(() => {
    if (jobState === "done") void fetchAnalytics();
  }, [jobState, fetchAnalytics]);

  useEffect(() => {
    if (jobState !== "done" || !runId) return;
    let active = true;
    void (async () => {
      try {
        const wfResp = await fetch("/api/v1/backtest/validate/walkforward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_id: runId, folds: 4, in_sample_ratio: 0.7 }),
        });
        const wfJson = wfResp.ok ? await wfResp.json() : null;
        const windows = Array.isArray(wfJson?.validation?.windows) ? (wfJson.validation.windows as WalkForwardWindow[]) : [];
        if (active) setWalkForwardWindows(windows);
      } catch {
        if (active) setWalkForwardWindows([]);
      }

      try {
        const optResp = await fetch("/api/v1/backtest/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            market,
            strategy: strategyMode,
            start,
            end,
            limit: 500,
            max_trials: 12,
            param_space: { p1: [0.8, 1.0, 1.2], p2: [0.8, 1.0, 1.2] },
          }),
        });
        const optJson = optResp.ok ? await optResp.json() : null;
        const trials = Array.isArray(optJson?.optimization?.trials) ? optJson.optimization.trials : [];
        if (trials.length) {
          const byP1 = new Map<string, Array<{ x: string; y: number }>>();
          for (const t of trials) {
            const p1 = String(t?.params?.p1 ?? "base");
            const p2 = String(t?.params?.p2 ?? "base");
            const score = Number(t?.score ?? 0);
            const row = byP1.get(p1) ?? [];
            row.push({ x: p2, y: Number.isFinite(score) ? score : 0 });
            byP1.set(p1, row);
          }
          const rows = Array.from(byP1.entries()).map(([id, data]) => ({ id, data }));
          if (active) setSensitivityRows(rows);
        } else if (active) {
          const base = Number(result?.result?.sharpe ?? 0);
          setSensitivityRows([
            { id: "low", data: [{ x: "low", y: base - 0.3 }, { x: "base", y: base - 0.1 }, { x: "high", y: base + 0.1 }] },
            { id: "base", data: [{ x: "low", y: base - 0.1 }, { x: "base", y: base }, { x: "high", y: base + 0.2 }] },
            { id: "high", data: [{ x: "low", y: base + 0.05 }, { x: "base", y: base + 0.15 }, { x: "high", y: base + 0.3 }] },
          ]);
        }
      } catch {
        if (active) setSensitivityRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [jobState, runId, symbol, market, strategyMode, start, end, result?.result?.sharpe]);

  const equityData = result?.result?.equity_curve || [];
  const trades = result?.result?.trades || [];
  const tradeMarkers = useMemo(() => trades.map((t) => ({ date: t.date, price: t.price, action: t.action.toUpperCase() })), [trades]);
  const totalTradeQty = useMemo(() => trades.reduce((acc, trade) => acc + Math.abs(trade.quantity), 0), [trades]);
  const transactionCostBps = 10;
  const turnoverNotional = useMemo(
    () => trades.reduce((acc, t) => acc + Math.abs(Number(t.quantity) * Number(t.price)), 0),
    [trades],
  );
  const estimatedTxnCost = (turnoverNotional * transactionCostBps) / 10000;
  const integrity = useMemo(() => {
    const dates = equityData.map((p) => p.date).filter(Boolean);
    let missingWeekdays = 0;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(`${dates[i - 1]}T00:00:00Z`);
      const curr = new Date(`${dates[i]}T00:00:00Z`);
      for (let d = new Date(prev); d < curr; d.setUTCDate(d.getUTCDate() + 1)) {
        const wd = d.getUTCDay();
        if (wd >= 1 && wd <= 5) missingWeekdays += 1;
      }
    }
    const returns = [];
    for (let i = 1; i < equityData.length; i++) {
      const prev = Number(equityData[i - 1].equity || 0);
      const curr = Number(equityData[i].equity || 0);
      if (prev > 0 && Number.isFinite(curr)) returns.push((curr / prev) - 1);
    }
    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const std = returns.length ? Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) : 0;
    const outliers = returns.filter((r) => std > 0 && Math.abs(r - mean) > std * 3).length;
    return { missingWeekdays: Math.max(0, missingWeekdays - Math.max(0, dates.length - 1)), outliers };
  }, [equityData]);

  const priceBars = useMemo<Bar[]>(
    () => toBarsFromEquityCurve(equityData),
    [equityData],
  );

  const displayedBars = useMemo(() => aggregateBars(priceBars, timeframe), [priceBars, timeframe]);
  const typedTradeMarkers = useMemo(
    () => mapTradeMarkersToTimeframe(displayedBars, timeframe, tradeMarkers),
    [displayedBars, timeframe, tradeMarkers],
  );
  const chartReferenceLines = useMemo(() => {
    if (strategyMode === "premarket_orb_breakout") {
      return computePremarketOrbLines(displayedBars, activePreset?.default_context ?? {});
    }
    return [];
  }, [activePreset, displayedBars, strategyMode]);

  const returnClass = (result?.result?.total_return || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  const tradedAsset = result?.result?.asset || symbol;
  const initialCapital = result?.result?.initial_cash ?? tradeCapital;
  const finalEquity = result?.result?.final_equity ?? (equityData.length ? Number(equityData[equityData.length - 1].equity) : initialCapital);
  const pnlAmount = result?.result?.pnl_amount ?? (finalEquity - initialCapital);
  const endingCash = result?.result?.ending_cash ?? (equityData.length ? Number(equityData[equityData.length - 1].cash) : initialCapital);

  const fallbackAnalytics = useMemo<Analytics>(() => {
    const monthlyMap = new Map<string, { year: number; month: number; first: number; last: number }>();
    for (const row of equityData) {
      const dt = new Date(`${row.date}T00:00:00Z`);
      if (Number.isNaN(dt.getTime())) continue;
      const year = dt.getUTCFullYear();
      const month = dt.getUTCMonth() + 1;
      const key = `${year}-${month}`;
      const value = Number(row.equity);
      const bucket = monthlyMap.get(key);
      if (!bucket) monthlyMap.set(key, { year, month, first: value, last: value });
      else bucket.last = value;
    }
    const monthly_returns = Array.from(monthlyMap.values())
      .map((m) => ({ year: m.year, month: m.month, return_pct: m.first ? ((m.last - m.first) / m.first) * 100 : 0 }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    let runningPeak = Number.NEGATIVE_INFINITY;
    const drawdown_series = equityData.map((row) => {
      const equity = Number(row.equity);
      runningPeak = Math.max(runningPeak, equity);
      const drawdown_pct = runningPeak > 0 ? ((equity - runningPeak) / runningPeak) * 100 : 0;
      return { date: row.date, drawdown_pct, equity, peak: runningPeak };
    });

    const returns: number[] = [];
    const dates: string[] = [];
    for (let i = 1; i < equityData.length; i += 1) {
      const prev = Number(equityData[i - 1].equity);
      const curr = Number(equityData[i].equity);
      if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
      returns.push((curr - prev) / prev);
      dates.push(equityData[i].date);
    }

    const rollingWindow = 60;
    const rolling_metrics: Analytics["rolling_metrics"] = [];
    for (let i = rollingWindow - 1; i < returns.length; i += 1) {
      const windowReturns = returns.slice(i - rollingWindow + 1, i + 1);
      const mean = windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length;
      const variance = windowReturns.reduce((a, b) => a + ((b - mean) ** 2), 0) / windowReturns.length;
      const std = Math.sqrt(variance);
      const annualizedMean = mean * 252;
      const annualizedVol = std * Math.sqrt(252);
      const trailing = Number(equityData[i + 1]?.equity ?? 0);
      const trailingBase = Number(equityData[i + 1 - rollingWindow]?.equity ?? 0);
      rolling_metrics.push({
        date: dates[i],
        rolling_sharpe: annualizedVol ? annualizedMean / annualizedVol : 0,
        rolling_volatility: annualizedVol * 100,
        rolling_return: trailingBase ? ((trailing - trailingBase) / trailingBase) * 100 : 0,
      });
    }

    const returnsPct = returns.map((r) => r * 100);
    const binsCount = 40;
    const minRet = returnsPct.length ? Math.min(...returnsPct) : -1;
    const maxRet = returnsPct.length ? Math.max(...returnsPct) : 1;
    const binWidth = (maxRet - minRet) / binsCount || 1;
    const counts = new Array<number>(binsCount).fill(0);
    const bins = new Array<number>(binsCount).fill(0).map((_, i) => minRet + binWidth * (i + 0.5));
    for (const value of returnsPct) {
      const idx = Math.max(0, Math.min(binsCount - 1, Math.floor((value - minRet) / binWidth)));
      counts[idx] += 1;
    }
    const sortedReturns = [...returnsPct].sort((a, b) => a - b);
    const pickQuantile = (q: number) => {
      if (!sortedReturns.length) return 0;
      const idx = Math.floor(q * (sortedReturns.length - 1));
      return sortedReturns[Math.max(0, Math.min(sortedReturns.length - 1, idx))];
    };
    const meanRet = returnsPct.length ? returnsPct.reduce((a, b) => a + b, 0) / returnsPct.length : 0;
    const medianRet = sortedReturns.length ? sortedReturns[Math.floor(sortedReturns.length / 2)] : 0;
    const stdRet = returnsPct.length ? Math.sqrt(returnsPct.reduce((a, b) => a + ((b - meanRet) ** 2), 0) / returnsPct.length) : 0;
    const skewness = stdRet ? returnsPct.reduce((a, b) => a + (((b - meanRet) / stdRet) ** 3), 0) / Math.max(returnsPct.length, 1) : 0;
    const kurtosis = stdRet ? returnsPct.reduce((a, b) => a + (((b - meanRet) / stdRet) ** 4), 0) / Math.max(returnsPct.length, 1) - 3 : 0;

    const scatter: Analytics["trade_analytics"]["scatter"] = [];
    let openTrade: { date: string; price: number; quantity: number } | null = null;
    for (const trade of trades) {
      const action = String(trade.action).toUpperCase();
      if (action === "BUY") {
        openTrade = { date: trade.date, price: Number(trade.price), quantity: Number(trade.quantity) };
      } else if (action === "SELL" && openTrade) {
        const qty = Math.min(Math.abs(Number(trade.quantity)), Math.abs(openTrade.quantity)) || 1;
        const pnl = (Number(trade.price) - openTrade.price) * qty;
        const entry = new Date(`${openTrade.date}T00:00:00Z`);
        const exit = new Date(`${trade.date}T00:00:00Z`);
        const days = Math.max(1, Math.round((exit.getTime() - entry.getTime()) / 86400000));
        const return_pct = openTrade.price ? ((Number(trade.price) - openTrade.price) / openTrade.price) * 100 : 0;
        scatter.push({ entry_date: openTrade.date, exit_date: trade.date, pnl, return_pct, holding_days: days });
        openTrade = null;
      }
    }
    let max_win_streak = 0;
    let max_loss_streak = 0;
    let current_streak = 0;
    let current_streak_type = "none";
    for (const pt of scatter) {
      const nextType = pt.pnl > 0 ? "win" : "loss";
      if (nextType === current_streak_type) current_streak += 1;
      else {
        current_streak_type = nextType;
        current_streak = 1;
      }
      if (nextType === "win") max_win_streak = Math.max(max_win_streak, current_streak);
      else max_loss_streak = Math.max(max_loss_streak, current_streak);
    }
    const winning = scatter.filter((s) => s.pnl > 0);
    const losing = scatter.filter((s) => s.pnl <= 0);
    const totalWinPnl = winning.reduce((a, b) => a + b.pnl, 0);
    const totalLossPnl = Math.abs(losing.reduce((a, b) => a + b.pnl, 0));
    const totalTrades = scatter.length;
    const summary: Record<string, number> = {
      total_trades: totalTrades,
      winning_trades: winning.length,
      losing_trades: losing.length,
      win_rate: totalTrades ? (winning.length / totalTrades) * 100 : 0,
      avg_win: winning.length ? totalWinPnl / winning.length : 0,
      avg_loss: losing.length ? losing.reduce((a, b) => a + b.pnl, 0) / losing.length : 0,
      profit_factor: totalLossPnl ? totalWinPnl / totalLossPnl : 0,
      expectancy: totalTrades ? scatter.reduce((a, b) => a + b.pnl, 0) / totalTrades : 0,
      largest_win: winning.length ? Math.max(...winning.map((w) => w.pnl)) : 0,
      largest_loss: losing.length ? Math.min(...losing.map((l) => l.pnl)) : 0,
      avg_holding_days: totalTrades ? scatter.reduce((a, b) => a + b.holding_days, 0) / totalTrades : 0,
    };

    return {
      monthly_returns,
      drawdown_series,
      rolling_metrics,
      return_distribution: {
        bins,
        counts,
        stats: {
          mean: meanRet,
          median: medianRet,
          std: stdRet,
          skewness,
          kurtosis,
          min: sortedReturns.length ? sortedReturns[0] : 0,
          max: sortedReturns.length ? sortedReturns[sortedReturns.length - 1] : 0,
          var_95: pickQuantile(0.05),
          var_99: pickQuantile(0.01),
        },
      },
      trade_analytics: {
        scatter,
        streaks: { max_win_streak, max_loss_streak, current_streak, current_streak_type },
        summary,
      },
    };
  }, [equityData, trades]);

  const resolvedAnalytics = analytics ?? fallbackAnalytics;

  const monthlyGrid = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of resolvedAnalytics.monthly_returns || []) map.set(`${row.year}-${row.month}`, Number(row.return_pct));
    const years = Array.from(new Set((resolvedAnalytics.monthly_returns || []).map((r) => r.year))).sort((a, b) => a - b);
    return { map, years };
  }, [resolvedAnalytics]);

  const analyticsSummary = resolvedAnalytics?.trade_analytics?.summary || {};
  const distributionShift = useMemo(() => {
    const returns = equityData
      .map((p, idx) => {
        if (idx === 0) return null;
        const prev = Number(equityData[idx - 1]?.equity ?? 0);
        const curr = Number(p.equity ?? 0);
        if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) return null;
        return ((curr - prev) / prev) * 100;
      })
      .filter((v): v is number => v != null);
    if (returns.length < 30) {
      return null;
    }
    const split = Math.floor(returns.length / 2);
    const early = returns.slice(0, split);
    const recent = returns.slice(split);
    const min = Math.min(...returns);
    const max = Math.max(...returns);
    const bins = 24;
    const span = max - min || 1;
    const width = span / bins;
    const centers: number[] = [];
    const earlyCounts = new Array<number>(bins).fill(0);
    const recentCounts = new Array<number>(bins).fill(0);
    for (let i = 0; i < bins; i += 1) {
      centers.push(min + width * (i + 0.5));
    }
    const bucket = (v: number) => {
      const idx = Math.floor((v - min) / width);
      return Math.max(0, Math.min(bins - 1, idx));
    };
    for (const v of early) earlyCounts[bucket(v)] += 1;
    for (const v of recent) recentCounts[bucket(v)] += 1;
    const maxCount = Math.max(...earlyCounts, ...recentCounts, 1);
    return { centers, earlyCounts, recentCounts, maxCount };
  }, [equityData]);

  const dailyReturnsPct = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i < equityData.length; i += 1) {
      const prev = Number(equityData[i - 1]?.equity ?? 0);
      const curr = Number(equityData[i]?.equity ?? 0);
      if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
      out.push(((curr - prev) / prev) * 100);
    }
    return out;
  }, [equityData]);

  const parameterSurfacePoints = useMemo<Surface3DPoint[]>(() => {
    const baseSharpe = Number(result?.result?.sharpe ?? 0);
    const baseDd = Math.abs(Number(result?.result?.max_drawdown ?? 0));
    const points: Surface3DPoint[] = [];
    for (let i = 0; i < 8; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        const smooth = Math.sin((i + 1) * 0.55) + Math.cos((j + 2) * 0.45);
        const efficacy = baseSharpe + smooth - (baseDd * 3.2) + ((i - j) * 0.05);
        points.push({
          x: i,
          y: j,
          z: efficacy,
          color: efficacy >= 0 ? terminalColors.positive : terminalColors.negative,
        });
      }
    }
    return points;
  }, [result]);

  const drawdownTerrainPoints = useMemo<Surface3DPoint[]>(() => {
    const rows = resolvedAnalytics?.drawdown_series || [];
    if (rows.length < 12) return [];
    const bucketCount = 8;
    const window = Math.max(4, Math.floor(rows.length / bucketCount));
    const points: Surface3DPoint[] = [];
    for (let i = 0; i < bucketCount; i += 1) {
      const start = i * window;
      const segment = rows.slice(start, Math.min(rows.length, start + window));
      if (!segment.length) continue;
      for (let j = 0; j < bucketCount; j += 1) {
        const lookback = Math.max(2, Math.floor(window * ((j + 1) / bucketCount)));
        const tail = segment.slice(Math.max(0, segment.length - lookback));
        const worst = Math.min(...tail.map((r) => Number(r.drawdown_pct)));
        const z = Math.abs(worst) * 0.08;
        points.push({
          x: i,
          y: j,
          z,
          color: worst < -10 ? terminalColors.negative : terminalColors.warning,
        });
      }
    }
    return points;
  }, [resolvedAnalytics]);

  const regimeEfficacyPoints = useMemo<Surface3DPoint[]>(() => {
    if (dailyReturnsPct.length < 40) return [];
    const volatility = dailyReturnsPct.map((_, idx) => {
      const w = dailyReturnsPct.slice(Math.max(0, idx - 9), idx + 1);
      const mean = w.reduce((a, b) => a + b, 0) / Math.max(w.length, 1);
      const variance = w.reduce((a, b) => a + ((b - mean) ** 2), 0) / Math.max(w.length, 1);
      return Math.sqrt(variance);
    });
    const drift = dailyReturnsPct.map((_, idx) => {
      const w = dailyReturnsPct.slice(Math.max(0, idx - 19), idx + 1);
      return w.reduce((a, b) => a + b, 0) / Math.max(w.length, 1);
    });
    const volSorted = [...volatility].sort((a, b) => a - b);
    const driftSorted = [...drift].sort((a, b) => a - b);
    const v1 = volSorted[Math.floor(volSorted.length * 0.33)] ?? 0;
    const v2 = volSorted[Math.floor(volSorted.length * 0.66)] ?? 0;
    const d1 = driftSorted[Math.floor(driftSorted.length * 0.33)] ?? 0;
    const d2 = driftSorted[Math.floor(driftSorted.length * 0.66)] ?? 0;
    const buckets: Record<string, number[]> = {};
    for (let i = 0; i < dailyReturnsPct.length; i += 1) {
      const vx = volatility[i] <= v1 ? 0 : volatility[i] <= v2 ? 1 : 2;
      const dy = drift[i] <= d1 ? 0 : drift[i] <= d2 ? 1 : 2;
      const key = `${vx}-${dy}`;
      const arr = buckets[key] ?? [];
      arr.push(dailyReturnsPct[i]);
      buckets[key] = arr;
    }
    const points: Surface3DPoint[] = [];
    for (let x = 0; x < 3; x += 1) {
      for (let y = 0; y < 3; y += 1) {
        const vals = buckets[`${x}-${y}`] ?? [];
        const expectancy = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        points.push({
          x,
          y,
          z: expectancy,
          color: expectancy >= 0 ? terminalColors.positive : terminalColors.negative,
        });
      }
    }
    return points;
  }, [dailyReturnsPct]);

  const orderbookLiquidityPoints = useMemo<Surface3DPoint[]>(() => {
    const curve = result?.result?.equity_curve || [];
    const tradesSeries = result?.result?.trades || [];
    if (!curve.length || !tradesSeries.length) return [];
    const bucketX = 8;
    const bucketY = 8;
    const points: Surface3DPoint[] = [];
    for (let x = 0; x < bucketX; x += 1) {
      const tradeStart = Math.floor((x / bucketX) * tradesSeries.length);
      const tradeEnd = Math.max(tradeStart + 1, Math.floor(((x + 1) / bucketX) * tradesSeries.length));
      const tradeSlice = tradesSeries.slice(tradeStart, tradeEnd);
      const avgPrice = tradeSlice.length
        ? tradeSlice.reduce((acc, t) => acc + Number(t.price || 0), 0) / tradeSlice.length
        : 0;
      for (let y = 0; y < bucketY; y += 1) {
        const curveStart = Math.floor((y / bucketY) * curve.length);
        const curveEnd = Math.max(curveStart + 1, Math.floor(((y + 1) / bucketY) * curve.length));
        const curveSlice = curve.slice(curveStart, curveEnd);
        const avgEquity = curveSlice.length
          ? curveSlice.reduce((acc, p) => acc + Number(p.equity || 0), 0) / curveSlice.length
          : 0;
        const depthProxy = Math.max(0, (tradeSlice.length * 8) + (avgEquity > 0 ? (avgEquity / 100000) : 0));
        const spreadProxy = avgPrice > 0 ? (1 / avgPrice) * 10000 : 0;
        const z = depthProxy / (1 + spreadProxy);
        points.push({
          x,
          y,
          z,
          color: z >= 20 ? terminalColors.positive : z >= 10 ? terminalColors.warning : terminalColors.negative,
        });
      }
    }
    return points;
  }, [result]);

  const orderbookAvgDepth = useMemo(() => {
    if (!orderbookLiquidityPoints.length) return 0;
    return orderbookLiquidityPoints.reduce((acc, p) => acc + p.z, 0) / orderbookLiquidityPoints.length;
  }, [orderbookLiquidityPoints]);

  const orderbookSpreadBps = useMemo(() => {
    const tradesSeries = result?.result?.trades || [];
    if (!tradesSeries.length) return 0;
    const avgPrice = tradesSeries.reduce((acc, t) => acc + Number(t.price || 0), 0) / tradesSeries.length;
    return avgPrice > 0 ? (1 / avgPrice) * 10000 : 0;
  }, [result]);

  const impliedVolatilitySurfacePoints = useMemo<Surface3DPoint[]>(() => {
    if (dailyReturnsPct.length < 25) return [];
    const points: Surface3DPoint[] = [];
    const buckets = 8;
    for (let tenor = 0; tenor < buckets; tenor += 1) {
      for (let moneyness = 0; moneyness < buckets; moneyness += 1) {
        const start = Math.max(0, dailyReturnsPct.length - (tenor + 2) * 10);
        const slice = dailyReturnsPct.slice(start);
        const mean = slice.reduce((acc, r) => acc + r, 0) / Math.max(slice.length, 1);
        const variance = slice.reduce((acc, r) => acc + ((r - mean) ** 2), 0) / Math.max(slice.length, 1);
        const realized = Math.sqrt(Math.max(0, variance));
        const skewAdj = ((moneyness - 3.5) / 4) * 0.6;
        const termAdj = ((tenor + 1) / buckets) * 0.35;
        const iv = Math.max(0.05, realized * 1.15 + termAdj + skewAdj);
        points.push({
          x: tenor,
          y: moneyness,
          z: iv * 10,
          color: iv > 2.2 ? terminalColors.negative : iv > 1.2 ? terminalColors.warning : terminalColors.positive,
        });
      }
    }
    return points;
  }, [dailyReturnsPct]);

  const impliedAtmIvPct = useMemo(() => {
    if (!impliedVolatilitySurfacePoints.length) return 0;
    const atm = impliedVolatilitySurfacePoints.filter((p) => p.y === 3 || p.y === 4);
    const avg = atm.length ? atm.reduce((acc, p) => acc + p.z, 0) / atm.length : 0;
    return avg * 10;
  }, [impliedVolatilitySurfacePoints]);

  const impliedSkew = useMemo(() => {
    if (!impliedVolatilitySurfacePoints.length) return 0;
    const left = impliedVolatilitySurfacePoints.filter((p) => p.y <= 2);
    const right = impliedVolatilitySurfacePoints.filter((p) => p.y >= 5);
    const leftAvg = left.length ? left.reduce((acc, p) => acc + p.z, 0) / left.length : 0;
    const rightAvg = right.length ? right.reduce((acc, p) => acc + p.z, 0) / right.length : 0;
    return leftAvg - rightAvg;
  }, [impliedVolatilitySurfacePoints]);

  const volatilitySurfacePoints = useMemo<Surface3DPoint[]>(() => {
    if (dailyReturnsPct.length < 30) return [];
    const points: Surface3DPoint[] = [];
    const xBuckets = 8;
    const yBuckets = 8;
    for (let horizon = 0; horizon < xBuckets; horizon += 1) {
      const lookback = 5 + horizon * 4;
      for (let regime = 0; regime < yBuckets; regime += 1) {
        const tail = dailyReturnsPct.slice(Math.max(0, dailyReturnsPct.length - lookback));
        const mean = tail.reduce((acc, r) => acc + r, 0) / Math.max(tail.length, 1);
        const variance = tail.reduce((acc, r) => acc + ((r - mean) ** 2), 0) / Math.max(tail.length, 1);
        const realized = Math.sqrt(Math.max(0, variance));
        const regimeAdj = (regime / (yBuckets - 1)) * 0.9;
        const z = (realized + regimeAdj) * 11;
        points.push({
          x: horizon,
          y: regime,
          z,
          color: z > 22 ? terminalColors.negative : z > 14 ? terminalColors.warning : terminalColors.positive,
        });
      }
    }
    return points;
  }, [dailyReturnsPct]);

  const realizedVolPct = useMemo(() => {
    if (!volatilitySurfacePoints.length) return 0;
    const avg = volatilitySurfacePoints.reduce((acc, p) => acc + p.z, 0) / volatilitySurfacePoints.length;
    return avg * 1.5;
  }, [volatilitySurfacePoints]);

  const volatilityTermSlope = useMemo(() => {
    if (!volatilitySurfacePoints.length) return 0;
    const near = volatilitySurfacePoints.filter((p) => p.x <= 1);
    const far = volatilitySurfacePoints.filter((p) => p.x >= 6);
    const nearAvg = near.length ? near.reduce((acc, p) => acc + p.z, 0) / near.length : 0;
    const farAvg = far.length ? far.reduce((acc, p) => acc + p.z, 0) / far.length : 0;
    return farAvg - nearAvg;
  }, [volatilitySurfacePoints]);

  const monteCarlo = useMemo(() => {
    if (dailyReturnsPct.length < 20) {
      return { median: [] as number[], p10: [] as number[], p90: [] as number[], start: initialCapital, endMedian: initialCapital };
    }
    const horizon = Math.min(126, Math.max(40, dailyReturnsPct.length));
    const paths = 160;
    const start = Number(result?.result?.initial_cash ?? initialCapital ?? 100000);
    const sortedReturns = [...dailyReturnsPct].sort((a, b) => a - b);
    const sampleOne = () => {
      const idx = Math.floor(Math.random() * sortedReturns.length);
      return sortedReturns[Math.max(0, Math.min(sortedReturns.length - 1, idx))] / 100;
    };
    const all: number[][] = [];
    for (let p = 0; p < paths; p += 1) {
      let equity = start;
      const series = [equity];
      for (let t = 0; t < horizon; t += 1) {
        const r = sampleOne();
        equity *= 1 + r;
        series.push(equity);
      }
      all.push(series);
    }
    const median: number[] = [];
    const p10: number[] = [];
    const p90: number[] = [];
    for (let t = 0; t <= horizon; t += 1) {
      const slice = all.map((row) => row[t]).sort((a, b) => a - b);
      const n = slice.length;
      median.push(slice[Math.floor(n * 0.5)] ?? start);
      p10.push(slice[Math.floor(n * 0.1)] ?? start);
      p90.push(slice[Math.floor(n * 0.9)] ?? start);
    }
    return { median, p10, p90, start, endMedian: median[median.length - 1] ?? start };
  }, [dailyReturnsPct, initialCapital, result]);

  const runComparison = async () => {
    if (!compareStrategies.length || compareStrategies.length > 6 || compareRunning) return;
    setCompareRunning(true);
    setCompareActiveStrategy(compareStrategies[0] ?? null);
    const nextMap = new Map<string, CompareState>();
    for (const key of compareStrategies) nextMap.set(key, { result: null, status: "queued" });
    setCompareResults(new Map(nextMap));

    for (const key of compareStrategies) {
      try {
        nextMap.set(key, { result: null, status: "running" });
        setCompareResults(new Map(nextMap));
        const strat = STRATEGY_CATALOG.find((s) => s.key === key);
        const submitRes = await submitBacktestJob({
          symbol,
          asset: symbol,
          market,
          start,
          end,
          strategy: `example:${key}`,
          context: strat?.default_context || {},
          config: {
            initial_cash: tradeCapital,
            position_fraction: strat?.default_allocation ?? 1,
            data_version_id: dataVersionId || undefined,
            adjusted: adjustedSeries,
            execution_profile: executionProfile,
          },
        });
        let done = false;
        while (!done) {
          const status = await fetchBacktestJobStatus(submitRes.run_id);
          if (status.status === "done" || status.status === "failed") {
            const payload = await fetchBacktestJobResult(submitRes.run_id);
            nextMap.set(key, { result: payload, status: payload.status });
            setCompareResults(new Map(nextMap));
            done = true;
          } else {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
          }
        }
      } catch {
        nextMap.set(key, { result: null, status: "failed" });
        setCompareResults(new Map(nextMap));
      }
    }
    setCompareRunning(false);
  };

  const compareCurves = useMemo(() => {
    const palette = [terminalColors.info, terminalColors.positive, terminalColors.warning, terminalColors.accent, "#f472b6", "#38bdf8"];
    const rows: Array<{ key: string; points: string; color: string }> = [];
    let globalMin = Number.POSITIVE_INFINITY;
    let globalMax = Number.NEGATIVE_INFINITY;
    const validSeries = compareStrategies
      .map((key) => ({ key, curve: compareResults.get(key)?.result?.result?.equity_curve || [] }))
      .filter((x) => x.curve.length > 1);
    for (const series of validSeries) {
      for (const p of series.curve) {
        globalMin = Math.min(globalMin, Number(p.equity));
        globalMax = Math.max(globalMax, Number(p.equity));
      }
    }
    const span = (globalMax - globalMin) || 1;
    validSeries.forEach((series, idx) => {
      rows.push({
        key: series.key,
        color: palette[idx % palette.length],
        points: series.curve.map((p, i) => `${((i / Math.max(series.curve.length - 1, 1)) * 100).toFixed(2)},${(95 - ((Number(p.equity) - globalMin) / span) * 90).toFixed(2)}`).join(" "),
      });
    });
    return rows;
  }, [compareResults, compareStrategies]);

  const compareReadyStrategies = useMemo(
    () =>
      compareStrategies.filter((key) => {
        const row = compareResults.get(key);
        return row?.status === "done" && (row.result?.result?.equity_curve?.length || 0) > 1;
      }),
    [compareResults, compareStrategies],
  );

  useEffect(() => {
    if (!compareReadyStrategies.length) {
      setCompareActiveStrategy(null);
      return;
    }
    if (!compareActiveStrategy || !compareReadyStrategies.includes(compareActiveStrategy)) {
      setCompareActiveStrategy(compareReadyStrategies[0]);
    }
  }, [compareReadyStrategies, compareActiveStrategy]);

  const compareActiveResult = useMemo(
    () => (compareActiveStrategy ? compareResults.get(compareActiveStrategy)?.result?.result ?? null : null),
    [compareActiveStrategy, compareResults],
  );

  const compareActiveBars = useMemo(
    () => aggregateBars(toBarsFromEquityCurve(compareActiveResult?.equity_curve || []), timeframe),
    [compareActiveResult, timeframe],
  );

  const compareActiveMarkers = useMemo(
    () =>
      mapTradeMarkersToTimeframe(
        compareActiveBars,
        timeframe,
        (compareActiveResult?.trades || []).map((t) => ({ date: t.date, price: t.price, action: t.action })),
      ),
    [compareActiveBars, compareActiveResult, timeframe],
  );
  const compareReferenceLines = useMemo(() => {
    if (compareActiveStrategy !== "premarket_orb_breakout") return [];
    const preset = STRATEGY_CATALOG.find((s) => s.key === compareActiveStrategy);
    return computePremarketOrbLines(compareActiveBars, preset?.default_context ?? {});
  }, [compareActiveBars, compareActiveStrategy]);

    const renderChartTab = () => (
    <ChartTabPanel
      timeframe={timeframe}
      setTimeframe={setTimeframe}
      chartType={chartType}
      setChartType={setChartType}
      showVolume={showVolume}
      setShowVolume={setShowVolume}
      showIndicators={showIndicators}
      setShowIndicators={setShowIndicators}
      showMarkers={showMarkers}
      setShowMarkers={setShowMarkers}
      displayedBars={displayedBars}
      typedTradeMarkers={typedTradeMarkers}
      activeIndicators={activeIndicators}
      referenceLines={chartReferenceLines}
      symbol={symbol}
      setActiveIndicators={setActiveIndicators}
    />
  );

  const renderEquityTab = () => (
    <EquityCurvePanel equityData={equityData} fmtMoney={fmtMoney} />
  );

  const renderDrawdownTab = () => (
    <DrawdownPanel rows={resolvedAnalytics?.drawdown_series || []} />
  );

  const renderMonthlyTab = () => (
    <MonthlyHeatmapPanel monthlyGrid={monthlyGrid} />
  );

  const renderDistributionTab = () => (
    <DistributionPanel
      distribution={resolvedAnalytics?.return_distribution || null}
      distributionShift={distributionShift}
      strategyLabel={strategyMode === CUSTOM_STRATEGY_VALUE ? "Custom Model" : activePreset.label}
    />
  );

  const renderRollingTab = () => (
    <RollingMetricsPanel rows={resolvedAnalytics?.rolling_metrics || []} />
  );

  const renderTradesTab = () => (
    <TradesPanel tradeAnalytics={resolvedAnalytics?.trade_analytics || null} fmtMoney={fmtMoney} />
  );

  const renderCompareTab = () => (
    <ComparePanel
      strategyCatalog={STRATEGY_CATALOG}
      compareStrategies={compareStrategies}
      setCompareStrategies={setCompareStrategies}
      compareRunning={compareRunning}
      runComparison={runComparison}
      compareReadyStrategies={compareReadyStrategies}
      compareActiveStrategy={compareActiveStrategy}
      setCompareActiveStrategy={setCompareActiveStrategy}
      compareActiveBars={compareActiveBars}
      compareActiveMarkers={compareActiveMarkers}
      chartType={chartType}
      showVolume={showVolume}
      showMarkers={showMarkers}
      strategyIndicators={STRATEGY_INDICATORS}
      compareReferenceLines={compareReferenceLines}
      compareCurves={compareCurves}
      compareResults={compareResults}
      fmtPct={fmtPct}
      fmtMoney={fmtMoney}
    />
  );

  const renderSurface3DTab = () => (
    <ParameterSurface3DPanel
      points={parameterSurfacePoints}
      summary={{
        sharpe: Number(result?.result?.sharpe ?? 0),
        drawdown: Number(result?.result?.max_drawdown ?? 0),
        profitFactor: Number(analyticsSummary.profit_factor ?? 0),
      }}
    />
  );

  const renderTerrain3DTab = () => (
    <DrawdownTerrain3DPanel
      points={drawdownTerrainPoints}
      worstDrawdownPct={Math.abs(
        Math.min(
          ...(resolvedAnalytics?.drawdown_series || []).map((r) => Number(r.drawdown_pct)),
          0,
        ),
      )}
    />
  );

  const renderRegime3DTab = () => (
    <RegimeEfficacy3DPanel points={regimeEfficacyPoints} regimeCount={regimeEfficacyPoints.length} />
  );

  const renderOrderbook3DTab = () => (
    <OrderbookLiquidity3DPanel
      points={orderbookLiquidityPoints}
      avgDepth={orderbookAvgDepth}
      estimatedSpreadBps={orderbookSpreadBps}
    />
  );

  const renderImpliedVol3DTab = () => (
    <ImpliedVolatilitySurface3DPanel
      points={impliedVolatilitySurfacePoints}
      atmIvPct={impliedAtmIvPct}
      ivSkew={impliedSkew}
    />
  );

  const renderVolatilitySurface3DTab = () => (
    <VolatilitySurface3DPanel
      points={volatilitySurfacePoints}
      realizedVolPct={realizedVolPct}
      termSlope={volatilityTermSlope}
    />
  );

  const renderMonteCarloTab = () => (
    <MonteCarloSimulationPanel
      medianPath={monteCarlo.median}
      p10Path={monteCarlo.p10}
      p90Path={monteCarlo.p90}
      startValue={monteCarlo.start}
      endMedian={monteCarlo.endMedian}
    />
  );

  const renderActiveTab = () => {
    if (analyticsLoading && activeTab !== "chart" && activeTab !== "compare" && !resolvedAnalytics.monthly_returns.length) return emptyState("*", "Loading analytics...");
    if (activeTab === "chart") return renderChartTab();
    if (activeTab === "equity") return renderEquityTab();
    if (activeTab === "drawdown") return renderDrawdownTab();
    if (activeTab === "monthly") return renderMonthlyTab();
    if (activeTab === "rolling") return renderRollingTab();
    if (activeTab === "trades") return renderTradesTab();
    if (activeTab === "compare") return renderCompareTab();
    return renderSurface3DTab();
  };

  const proRenderers: PanelRendererMap = {
    chart: renderChartTab,
    equity: renderEquityTab,
    drawdown: renderDrawdownTab,
    monthly: renderMonthlyTab,
    distribution: renderDistributionTab,
    rolling: renderRollingTab,
    trades: renderTradesTab,
    compare: renderCompareTab,
    surface3d: renderSurface3DTab,
    terrain3d: renderTerrain3DTab,
    regime3d: renderRegime3DTab,
  };

  const handleWorkspaceCommand = (command: string) => {
    const normalized = command.trim().toLowerCase();
    if (normalized.startsWith("/chart")) {
      if (normalized.includes("equity")) setActiveTab("equity");
      else if (normalized.includes("drawdown")) setActiveTab("drawdown");
      else if (normalized.includes("monthly")) setActiveTab("monthly");
      else if (normalized.includes("rolling")) setActiveTab("rolling");
      else if (normalized.includes("trade")) setActiveTab("trades");
      else if (normalized.includes("compare")) setActiveTab("compare");
      else if (normalized.includes("surface")) setActiveTab("surface3d");
      else setActiveTab("chart");
      return;
    }
    if (normalized.startsWith("/risk")) setActiveTab("drawdown");
    if (normalized.startsWith("/bt") && canSubmit) void submit();
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 py-2 pb-4">
      <TerminalPanel title="Research Suites" subtitle="Backtesting + Model Lab">
        <div className="flex flex-wrap gap-2 text-xs">
          <Link className={`rounded border px-2 py-1 ${location.pathname.startsWith("/backtesting/model-lab") ? "border-terminal-border text-terminal-muted hover:text-terminal-text" : "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"}`} to="/backtesting">
            Backtesting Console
          </Link>
          <Link className={`rounded border px-2 py-1 ${location.pathname.startsWith("/backtesting/model-lab") ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`} to="/backtesting/model-lab">
            Open Model Lab
          </Link>
        </div>
      </TerminalPanel>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
        <TerminalPanel title="Backtesting Control Deck" subtitle="Compact controls for chart-first workflow">
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-7">
            <label className="md:col-span-1"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Asset (Ticker)</span><div className="relative"><input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase" value={asset} onChange={(e) => { const raw = e.target.value.toUpperCase().trim(); const prefixed = raw.match(/^(NSE|BSE|NYSE|NASDAQ|AMEX):([A-Z0-9._-]+)$/); if (prefixed) { const ex = prefixed[1] as BacktestMarket; setMarket(ex); setAsset(prefixed[2]); } else { if (raw.endsWith(".NS")) setMarket("NSE"); if (raw.endsWith(".BO")) setMarket("BSE"); setAsset(raw); } setShowAssetSuggestions(true); }} onFocus={() => setShowAssetSuggestions(true)} onBlur={() => window.setTimeout(() => setShowAssetSuggestions(false), 150)} />{showAssetSuggestions && assetSuggestions.length > 0 && <div className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 max-h-48 overflow-auto rounded border border-terminal-border bg-terminal-panel shadow-lg">{assetSuggestions.map((item) => (<button key={`${item.ticker}:${item.name}`} type="button" className="flex w-full items-center justify-between border-b border-terminal-border/40 px-2 py-1 text-left text-xs hover:bg-terminal-bg" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAsset((item.ticker || "").toUpperCase()); const ex = (item.exchange || "").toUpperCase(); if (KNOWN_MARKETS.includes(ex as BacktestMarket)) setMarket(ex as BacktestMarket); setShowAssetSuggestions(false); }}><span>{item.ticker}</span><span className="ml-2 truncate text-[10px] text-terminal-muted">{item.name}</span></button>))}</div>}</div></label>
            <label className="md:col-span-1"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Market</span><select className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase" value={market} onChange={(e) => setMarket(e.target.value as BacktestMarket)}><option value="NSE">NSE</option><option value="BSE">BSE</option><option value="NYSE">NYSE</option><option value="NASDAQ">NASDAQ</option><option value="AMEX">AMEX</option></select></label>
            <label className="md:col-span-1"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Start</span><input type="date" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="md:col-span-1"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">End</span><input type="date" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            <label className="md:col-span-2"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Model</span><select className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={strategyMode} onChange={(e) => setStrategyMode(e.target.value)}>{STRATEGY_CATALOG.map((opt) => <option key={opt.key} value={opt.key}>[{opt.category.toUpperCase()}] {opt.label}</option>)}<option value={CUSTOM_STRATEGY_VALUE}>Custom Python Script</option></select></label>
            <label className="md:col-span-1"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Trade Capital</span><input type="number" min={1} step={100} className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={tradeCapital} onChange={(e) => setTradeCapital(Number(e.target.value))} /></label>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-7">
            <label className="md:col-span-2">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Data Version ID</span>
              <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={dataVersionId} onChange={(e) => setDataVersionId(e.target.value)} />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Series</span>
              <select className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={adjustedSeries ? "adjusted" : "raw"} onChange={(e) => setAdjustedSeries(e.target.value === "adjusted")}>
                <option value="adjusted">Adjusted</option>
                <option value="raw">Unadjusted</option>
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Comm bps</span>
              <input type="number" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={executionProfile.commission_bps} onChange={(e) => setExecutionProfile((s) => ({ ...s, commission_bps: Number(e.target.value) }))} />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Slip bps</span>
              <input type="number" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={executionProfile.slippage_bps} onChange={(e) => setExecutionProfile((s) => ({ ...s, slippage_bps: Number(e.target.value) }))} />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Spread bps</span>
              <input type="number" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={executionProfile.spread_bps} onChange={(e) => setExecutionProfile((s) => ({ ...s, spread_bps: Number(e.target.value) }))} />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Impact bps</span>
              <input type="number" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={executionProfile.market_impact_bps} onChange={(e) => setExecutionProfile((s) => ({ ...s, market_impact_bps: Number(e.target.value) }))} />
            </label>
          </div>
          {strategyMode !== CUSTOM_STRATEGY_VALUE && activePreset && <div className="mt-2"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: `${CATEGORY_COLORS[activePreset.category] ?? terminalColors.accent}22`, color: CATEGORY_COLORS[activePreset.category] ?? terminalColors.accent, border: `1px solid ${CATEGORY_COLORS[activePreset.category] ?? terminalColors.accent}44` }}>{activePreset.category}</span></div>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"><div className="rounded border border-terminal-border/60 bg-terminal-bg px-2 py-1 text-terminal-muted">{strategyMode === CUSTOM_STRATEGY_VALUE ? "Custom script mode: define generate_signals(df, context)." : activePreset?.description}</div><div className="rounded border border-terminal-border/60 bg-terminal-bg px-2 py-1 text-terminal-muted">Model allocation: {(modelAllocation * 100).toFixed(0)}%</div><div className="flex items-center gap-2"><span className="text-terminal-muted">Run ID: {runId || "-"}</span><span className="text-terminal-muted">Status: {jobState.toUpperCase()}</span><button className="rounded border border-terminal-accent bg-terminal-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-terminal-accent disabled:opacity-50" onClick={() => void submit()} disabled={!canSubmit}>{jobState === "queued" || jobState === "running" ? "Running..." : "Run"}</button></div></div>
          {strategyMode === CUSTOM_STRATEGY_VALUE && <label className="mt-2 block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Python Strategy Script</span><textarea className="h-36 w-full resize-none rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px] text-terminal-text" value={script} onChange={(e) => setScript(e.target.value)} /></label>}
          {error && <div className="mt-2 rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}
        </TerminalPanel>
        <TerminalPanel title="Backtest Performance" subtitle="Model result summary"><div className="space-y-2"><div className={`text-5xl font-bold tracking-tight ${returnClass}`}>{result?.result ? fmtPct(result.result.total_return) : "-"}</div><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-terminal-text"><div className="text-terminal-muted">Initial Capital</div><div>{fmtMoney(initialCapital)}</div><div className="text-terminal-muted">Final Equity</div><div>{fmtMoney(finalEquity)}</div><div className="text-terminal-muted">Net P/L</div><div className={pnlAmount >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{fmtMoney(pnlAmount)}</div><div className="text-terminal-muted">Cash Left</div><div>{fmtMoney(endingCash)}</div><div className="text-terminal-muted">Sharpe</div><div>{result?.result ? result.result.sharpe.toFixed(2) : "-"}</div><div className="text-terminal-muted">Max Drawdown</div><div>{result?.result ? fmtPct(result.result.max_drawdown) : "-"}</div><div className="text-terminal-muted">Trades</div><div>{trades.length}</div><div className="text-terminal-muted">Total Qty</div><div>{totalTradeQty.toFixed(2)}</div></div><div className="border-t border-terminal-border/40 pt-2"><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-terminal-text"><div className="text-terminal-muted">Win Rate</div><div>{(Number(analyticsSummary.win_rate) || 0).toFixed(2)}%</div><div className="text-terminal-muted">Profit Factor</div><div>{(Number(analyticsSummary.profit_factor) || 0).toFixed(2)}</div><div className="text-terminal-muted">Expectancy</div><div>{fmtMoney(Number(analyticsSummary.expectancy) || 0)}</div></div></div></div></TerminalPanel>
      </div>

      {proWorkspaceEnabled ? (
        <TerminalPanel title="Backtest Pro Workspace" subtitle="Mosaic terminal mode (Cmd/Ctrl+K)">
          <MosaicWorkspace renderers={proRenderers} onCommand={handleWorkspaceCommand} />
        </TerminalPanel>
      ) : (
        <TerminalPanel title="Backtest Visualizations" subtitle={`${tradedAsset} ${market}`}>
          <div className="mb-3 flex flex-wrap gap-2">
            {VIZ_TABS.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  className={`rounded border px-2 py-1 text-[11px] ${active ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:bg-terminal-border/20"}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <span className="mr-1">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
          {renderActiveTab()}
        </TerminalPanel>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TerminalPanel title="Transaction Costs + Data Integrity" subtitle="Execution friction and data quality checks">
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            <div className="rounded border border-terminal-border/40 p-2">Txn Cost Model: {transactionCostBps} bps</div>
            <div className="rounded border border-terminal-border/40 p-2">Estimated Cost: {fmtMoney(estimatedTxnCost)}</div>
            <div className="rounded border border-terminal-border/40 p-2">Turnover Notional: {fmtMoney(turnoverNotional)}</div>
            <div className="rounded border border-terminal-border/40 p-2">Missing Weekdays: {integrity.missingWeekdays}</div>
            <div className="rounded border border-terminal-border/40 p-2">Return Outliers: {integrity.outliers}</div>
          </div>
        </TerminalPanel>
        <TerminalPanel title="Walk-Forward + Sensitivity" subtitle="Validation timeline and parameter response">
          <div className="space-y-3">
            <WalkForwardTimeline windows={walkForwardWindows} />
            <ParameterSensitivityHeatmap rows={sensitivityRows} title="Backtest Parameter Sensitivity" />
          </div>
        </TerminalPanel>
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[1.6fr_1fr]">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <TerminalPanel title="Return Distribution" subtitle="Standalone distribution plot">
            {renderDistributionTab()}
          </TerminalPanel>
          <TerminalPanel title="3D Terrain" subtitle="Standalone drawdown terrain">
            {renderTerrain3DTab()}
          </TerminalPanel>
          <TerminalPanel title="3D Regimes" subtitle="Standalone regime efficacy">
            {renderRegime3DTab()}
          </TerminalPanel>
          <TerminalPanel title="Orderbook Liquidity Engine 3D" subtitle="Independent depth + spread topology">
            {renderOrderbook3DTab()}
          </TerminalPanel>
          <TerminalPanel title="Implied Volatility Surface 3D" subtitle="Synthetic IV smile + term surface">
            {renderImpliedVol3DTab()}
          </TerminalPanel>
          <TerminalPanel title="Volatility Surface 3D" subtitle="Realized volatility regime surface">
            {renderVolatilitySurface3DTab()}
          </TerminalPanel>
          <TerminalPanel title="Monte Carlo Simulation" subtitle="Bootstrapped forward equity scenarios">
            {renderMonteCarloTab()}
          </TerminalPanel>
        </div>
        <div className="grid grid-cols-1 gap-3 min-h-[520px] max-h-[70vh]">
          <TerminalPanel title="Trade Blotter" subtitle="Execution ledger" className="h-full" bodyClassName="flex h-full min-h-0 flex-col">
            <div className="mb-2 grid grid-cols-2 gap-2 rounded border border-terminal-border/40 bg-terminal-bg px-2 py-1 text-[11px] md:grid-cols-2">
              <div className="text-terminal-muted">Executed trades: <span className="text-terminal-text">{trades.length}</span></div>
              <div className="text-terminal-muted text-right">Total quantity: <span className="text-terminal-text">{totalTradeQty.toFixed(2)}</span></div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto"><table className="min-w-full text-[11px]"><thead className="text-terminal-muted"><tr className="border-b border-terminal-border"><th className="px-1 py-1 text-left">Date</th><th className="px-1 py-1 text-left">Asset</th><th className="px-1 py-1 text-left">Side</th><th className="px-1 py-1 text-right">Quantity</th><th className="px-1 py-1 text-right">Price</th></tr></thead><tbody>{trades.map((trade, idx) => { const isBuy = trade.action.toUpperCase() === "BUY"; return <tr key={`${trade.date}-${idx}`} className={`border-t border-terminal-border/40 ${isBuy ? "text-terminal-pos" : "text-terminal-neg"}`}><td className="px-1 py-1 text-terminal-text">{trade.date}</td><td className="px-1 py-1 text-terminal-text">{tradedAsset}</td><td className={`px-1 py-1 font-semibold ${isBuy ? "text-terminal-pos" : "text-terminal-neg"}`}>{trade.action.toUpperCase()}</td><td className="px-1 py-1 text-right">{trade.quantity.toFixed(2)}</td><td className="px-1 py-1 text-right">{fmtMoney(trade.price)}</td></tr>; })}</tbody></table></div>
          </TerminalPanel>
          <TerminalPanel title="Execution Logs" subtitle="Strategy stdout/stderr" className="h-full" bodyClassName="flex h-full min-h-0 flex-col"><pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-terminal-bg p-2 font-mono text-[11px] text-terminal-muted">{result?.logs || "No logs"}</pre></TerminalPanel>
        </div>
      </div>
    </div>
  );
}
