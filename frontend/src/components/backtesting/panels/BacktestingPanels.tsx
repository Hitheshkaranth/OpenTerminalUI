import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { Bar } from "oakscriptjs";

import { terminalColors } from "../../../theme/terminal";
import { BacktestingTradingChart } from "../BacktestingTradingChart";
import { IndicatorPanel } from "../../../shared/chart/IndicatorPanel";
import type { ChartKind, IndicatorConfig } from "../../../shared/chart/types";
import { ThreeDSurface, type Surface3DPoint } from "./Backtesting3D";

type BacktestTimeframe = "1D" | "1W" | "1M";

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
  return values.map((v, i) => `${((i / Math.max(values.length - 1, 1)) * 100).toFixed(2)},${(95 - ((v - min) / span) * 90).toFixed(2)}`).join(" ");
}

export type ChartTabProps = {
  timeframe: BacktestTimeframe;
  setTimeframe: Dispatch<SetStateAction<BacktestTimeframe>>;
  chartType: ChartKind;
  setChartType: Dispatch<SetStateAction<ChartKind>>;
  showVolume: boolean;
  setShowVolume: Dispatch<SetStateAction<boolean>>;
  showIndicators: boolean;
  setShowIndicators: Dispatch<SetStateAction<boolean>>;
  showMarkers: boolean;
  setShowMarkers: Dispatch<SetStateAction<boolean>>;
  displayedBars: Bar[];
  typedTradeMarkers: Array<{ date: string; price: number; action: "BUY" | "SELL" }>;
  activeIndicators: IndicatorConfig[];
  referenceLines?: Array<{ label: string; price: number; color: string }>;
  symbol: string;
  setActiveIndicators: Dispatch<SetStateAction<IndicatorConfig[]>>;
};

export function ChartTabPanel(props: ChartTabProps) {
  const {
    timeframe,
    setTimeframe,
    chartType,
    setChartType,
    showVolume,
    setShowVolume,
    showIndicators,
    setShowIndicators,
    showMarkers,
    setShowMarkers,
    displayedBars,
    typedTradeMarkers,
    activeIndicators,
    referenceLines = [],
    symbol,
    setActiveIndicators,
  } = props;
  const [visibleLogicalRange, setVisibleLogicalRange] = useState<{ from: number; to: number } | null>(null);
  const [brushMode, setBrushMode] = useState(false);
  const [lockedBrushRange, setLockedBrushRange] = useState<{ from: number; to: number } | null>(null);
  const [previewBrushRange, setPreviewBrushRange] = useState<{ from: number; to: number } | null>(null);

  const selectedBars = useMemo(() => {
    const activeRange = lockedBrushRange ?? visibleLogicalRange;
    if (!displayedBars.length || !activeRange) return displayedBars;
    const from = Math.max(0, Math.floor(Math.min(activeRange.from, activeRange.to)));
    const to = Math.min(displayedBars.length - 1, Math.ceil(Math.max(activeRange.from, activeRange.to)));
    if (to <= from) return displayedBars.slice(Math.max(0, from - 1), Math.min(displayedBars.length, from + 2));
    return displayedBars.slice(from, to + 1);
  }, [displayedBars, visibleLogicalRange, lockedBrushRange]);

  const selectionLabel = useMemo(() => {
    if (!selectedBars.length) return "";
    const first = new Date(Number(selectedBars[0].time) * 1000).toISOString().slice(0, 10);
    const last = new Date(Number(selectedBars[selectedBars.length - 1].time) * 1000).toISOString().slice(0, 10);
    return `${first} -> ${last} (${selectedBars.length} bars)`;
  }, [selectedBars]);
  const previewSelectionLabel = useMemo(() => {
    if (!previewBrushRange || !displayedBars.length) return null;
    const from = Math.max(0, Math.floor(Math.min(previewBrushRange.from, previewBrushRange.to)));
    const to = Math.min(displayedBars.length - 1, Math.ceil(Math.max(previewBrushRange.from, previewBrushRange.to)));
    if (to < from) return null;
    const first = new Date(Number(displayedBars[from].time) * 1000).toISOString().slice(0, 10);
    const last = new Date(Number(displayedBars[to].time) * 1000).toISOString().slice(0, 10);
    return `${first} -> ${last}`;
  }, [previewBrushRange, displayedBars]);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as BacktestTimeframe)} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text">
            <option value="1D">1D</option><option value="1W">1W</option><option value="1M">1M</option>
          </select>
          <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartKind)} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text">
            <option value="candle">Candles</option><option value="line">Line</option><option value="area">Area</option>
          </select>
          <button className={`rounded border px-2 py-1 ${showVolume ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setShowVolume((v) => !v)}>Volume</button>
          <button className={`rounded border px-2 py-1 ${showIndicators ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setShowIndicators((v) => !v)}>Indicators</button>
          <button className={`rounded border px-2 py-1 ${showMarkers ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setShowMarkers((v) => !v)}>Markers</button>
        </div>
        <div className="h-[62vh] min-h-[420px]">
          <BacktestingTradingChart
            bars={displayedBars}
            trades={typedTradeMarkers}
            chartType={chartType}
            showVolume={showVolume}
            showMarkers={showMarkers}
            activeIndicators={activeIndicators}
            referenceLines={referenceLines}
            onVisibleLogicalRangeChange={(range) => {
              if (!lockedBrushRange) setVisibleLogicalRange(range);
            }}
            enableBrushSelection={brushMode}
            brushRange={lockedBrushRange}
            onBrushRangeChange={(range) => {
              setLockedBrushRange(range);
              setPreviewBrushRange(null);
              setBrushMode(false);
            }}
            onBrushPreviewRangeChange={setPreviewBrushRange}
          />
        </div>
        <div className="mt-3 rounded border border-terminal-border/40 bg-terminal-bg/50 p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="text-terminal-muted">{selectionLabel ? `Selection: ${selectionLabel}` : "Selection idle"}{previewSelectionLabel ? ` | Dragging: ${previewSelectionLabel}` : ""}</div>
            <div className="flex items-center gap-2">
              <button className={`rounded border px-2 py-1 ${brushMode ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setBrushMode((v) => !v)}>{brushMode ? "Selecting..." : "Brush Select"}</button>
              <button
                className="rounded border border-terminal-border px-2 py-1 text-terminal-muted"
                onClick={() => {
                  setLockedBrushRange(null);
                  setPreviewBrushRange(null);
                }}
              >
                Clear Selection
              </button>
            </div>
          </div>
        </div>
      </div>
      <div>{showIndicators ? <IndicatorPanel symbol={symbol} activeIndicators={activeIndicators} onChange={setActiveIndicators} /> : <div className="rounded border border-terminal-border/40 p-3 text-[11px] text-terminal-muted">Indicators hidden. Use the chart toolbar toggle to show.</div>}</div>
    </div>
  );
}

export function EquityCurvePanel({ equityData, fmtMoney }: { equityData: Array<{ equity: number }>; fmtMoney: (value: number) => string }) {
  if (!equityData.length) return emptyState("*", "Run a backtest to see equity curve");
  const values = equityData.map((p) => Number(p.equity));
  const points = buildPolylinePoints(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <div className="space-y-2">
      <div className="h-[56vh] min-h-[360px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={terminalColors.positive} stopOpacity="0.4" /><stop offset="100%" stopColor={terminalColors.positive} stopOpacity="0.05" /></linearGradient></defs><polyline fill="none" stroke={terminalColors.positive} strokeWidth="1.5" points={points} /><polygon points={`0,95 ${points} 100,95`} fill="url(#equityFill)" /></svg></div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-terminal-muted"><div>Max {fmtMoney(max)}</div><div className="text-center">Mid {fmtMoney((min + max) / 2)}</div><div className="text-right">Min {fmtMoney(min)}</div></div>
    </div>
  );
}

export function DrawdownPanel({ rows }: { rows: Array<{ drawdown_pct: number }> }) {
  if (!rows.length) return emptyState("*", "Run a backtest to see drawdown profile");
  const values = rows.map((r) => Number(r.drawdown_pct));
  const min = Math.min(...values);
  const span = 0 - min || 1;
  const points = values.map((v, i) => `${((i / Math.max(values.length - 1, 1)) * 100).toFixed(2)},${(5 + ((0 - v) / span) * 90).toFixed(2)}`).join(" ");
  return (
    <div className="space-y-2">
      <div className="h-[56vh] min-h-[360px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><defs><linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={terminalColors.negative} stopOpacity="0.45" /><stop offset="100%" stopColor={terminalColors.negative} stopOpacity="0.08" /></linearGradient></defs><polyline fill="none" stroke={terminalColors.negative} strokeWidth="1.5" points={points} /><polygon points={`0,95 ${points} 100,95`} fill="url(#ddFill)" /></svg></div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-terminal-muted"><div>0.00%</div><div className="text-center">{(min / 2).toFixed(2)}%</div><div className="text-right">{min.toFixed(2)}%</div></div>
    </div>
  );
}

export function MonthlyHeatmapPanel({ monthlyGrid }: { monthlyGrid: { years: number[]; map: Map<string, number> } }) {
  if (!monthlyGrid.years.length) return emptyState("*", "Run a backtest to see monthly return heatmap");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const colorFor = (val: number | undefined) => {
    if (val == null || !Number.isFinite(val)) return "bg-terminal-border/20 text-terminal-muted";
    if (val > 5) return "bg-terminal-pos/35 text-terminal-pos";
    if (val > 2) return "bg-terminal-pos/25 text-terminal-pos";
    if (val > 0) return "bg-terminal-pos/15 text-terminal-pos";
    if (val < -5) return "bg-terminal-neg/35 text-terminal-neg";
    if (val < -2) return "bg-terminal-neg/25 text-terminal-neg";
    if (val < 0) return "bg-terminal-neg/15 text-terminal-neg";
    return "bg-terminal-border/20 text-terminal-muted";
  };
  return (
    <div className="overflow-auto rounded border border-terminal-border/40 p-2">
      <table className="min-w-full text-[10px] font-mono"><thead className="text-terminal-muted"><tr><th className="px-1 py-1 text-left">Year</th>{months.map((m) => <th key={m} className="px-1 py-1 text-center">{m}</th>)}<th className="px-1 py-1 text-center">Annual</th></tr></thead><tbody>{monthlyGrid.years.map((year) => { const vals = months.map((_, idx) => monthlyGrid.map.get(`${year}-${idx + 1}`)); const annual = vals.filter((v): v is number => v != null).reduce((a, b) => a + b, 0); return <tr key={year} className="border-t border-terminal-border/30"><td className="px-1 py-1 text-terminal-text">{year}</td>{vals.map((val, idx) => <td key={`${year}-${idx}`} className="px-1 py-1 text-center"><div className={`rounded px-1 py-0.5 ${colorFor(val)}`}>{val == null ? "-" : `${val >= 0 ? "+" : ""}${val.toFixed(1)}`}</div></td>)}<td className="px-1 py-1 text-center"><div className={`rounded px-1 py-0.5 ${colorFor(annual)}`}>{annual >= 0 ? "+" : ""}{annual.toFixed(1)}</div></td></tr>; })}</tbody></table>
    </div>
  );
}

export function DistributionPanel(props: {
  distribution: { bins: number[]; counts: number[]; stats: Record<string, number> } | null;
  distributionShift: { earlyCounts: number[]; recentCounts: number[]; maxCount: number } | null;
  strategyLabel: string;
}) {
  const { distribution, distributionShift, strategyLabel } = props;
  if (!distribution || !distribution.bins.length) return emptyState("*", "Run a backtest to see return distribution");
  const maxCount = Math.max(...distribution.counts, 1);
  return (
    <div className="space-y-3">
      <div className="h-[36vh] min-h-[220px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">{distribution.counts.map((count, i) => { const w = 100 / distribution.counts.length; const h = (count / maxCount) * 88; const x = i * w; const y = 94 - h; const bin = distribution.bins[i] ?? 0; const color = bin >= 0 ? terminalColors.positive : terminalColors.negative; return <rect key={`bin-${i}`} x={x.toFixed(2)} y={y.toFixed(2)} width={(w * 0.9).toFixed(2)} height={h.toFixed(2)} fill={color} opacity="0.75" />; })}</svg></div>
      <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-5"><div className="rounded border border-terminal-border/40 p-2">Mean: {(distribution.stats.mean ?? 0).toFixed(3)}%</div><div className="rounded border border-terminal-border/40 p-2">Std Dev: {(distribution.stats.std ?? 0).toFixed(3)}%</div><div className="rounded border border-terminal-border/40 p-2">Skewness: {(distribution.stats.skewness ?? 0).toFixed(3)}</div><div className="rounded border border-terminal-border/40 p-2">Kurtosis: {(distribution.stats.kurtosis ?? 0).toFixed(3)}</div><div className="rounded border border-terminal-border/40 p-2">VaR 95%: {(distribution.stats.var_95 ?? 0).toFixed(3)}%</div></div>
      <div className="rounded border border-terminal-border/40 bg-terminal-bg/50 p-2">
        <div className="mb-1 text-[11px] text-terminal-muted">Distribution Shift ({strategyLabel})</div>
        {!distributionShift ? (
          <div className="text-[11px] text-terminal-muted">Need more bars to compute early vs recent shift.</div>
        ) : (
          <div className="h-[26vh] min-h-[170px]">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              <polyline fill="none" stroke={terminalColors.info} strokeWidth="1.2" points={distributionShift.earlyCounts.map((v, i) => `${((i / Math.max(distributionShift.earlyCounts.length - 1, 1)) * 100).toFixed(2)},${(95 - (v / distributionShift.maxCount) * 90).toFixed(2)}`).join(" ")} />
              <polyline fill="none" stroke={terminalColors.warning} strokeWidth="1.2" points={distributionShift.recentCounts.map((v, i) => `${((i / Math.max(distributionShift.recentCounts.length - 1, 1)) * 100).toFixed(2)},${(95 - (v / distributionShift.maxCount) * 90).toFixed(2)}`).join(" ")} />
            </svg>
            <div className="mt-1 flex items-center gap-3 text-[10px]">
              <span className="inline-flex items-center gap-1 text-terminal-info"><span className="inline-block h-2 w-2 rounded-full bg-terminal-info" />Early</span>
              <span className="inline-flex items-center gap-1 text-terminal-warning"><span className="inline-block h-2 w-2 rounded-full bg-terminal-warning" />Recent</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function RollingMetricsPanel({ rows }: { rows: Array<{ rolling_sharpe: number; rolling_volatility: number }> }) {
  if (!rows.length) return emptyState("*", "Run a backtest to see rolling metrics");
  const sharpe = rows.map((r) => Number(r.rolling_sharpe));
  const vol = rows.map((r) => Number(r.rolling_volatility));
  const sharpePoints = buildPolylinePoints(sharpe);
  const volPoints = buildPolylinePoints(vol);
  const min = Math.min(...sharpe);
  const max = Math.max(...sharpe);
  const span = max - min || 1;
  const zeroY = (95 - ((0 - min) / span) * 90).toFixed(2);
  return (
    <div className="space-y-3">
      <div className="h-[28vh] min-h-[180px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2"><div className="mb-1 text-[11px] text-terminal-muted">Rolling Sharpe</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[calc(100%-14px)] w-full"><line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke={terminalColors.border} strokeDasharray="1 1" /><polyline fill="none" stroke="#a78bfa" strokeWidth="1.5" points={sharpePoints} /></svg></div>
      <div className="h-[28vh] min-h-[180px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2"><div className="mb-1 text-[11px] text-terminal-muted">Rolling Annualized Volatility (%)</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[calc(100%-14px)] w-full"><polyline fill="none" stroke="#fb923c" strokeWidth="1.5" points={volPoints} /></svg></div>
    </div>
  );
}

export function TradesPanel(props: {
  tradeAnalytics: { scatter: Array<{ holding_days: number; pnl: number }>; streaks: { max_win_streak: number; max_loss_streak: number; current_streak: number; current_streak_type: string }; summary: Record<string, number> } | null;
  fmtMoney: (value: number) => string;
}) {
  const { tradeAnalytics, fmtMoney } = props;
  if (!tradeAnalytics || !tradeAnalytics.scatter.length) return emptyState("*", "Run a backtest to see trade analytics");
  const scatter = tradeAnalytics.scatter;
  const xMax = Math.max(...scatter.map((s) => Number(s.holding_days)), 1);
  const yMin = Math.min(...scatter.map((s) => Number(s.pnl)), 0);
  const yMax = Math.max(...scatter.map((s) => Number(s.pnl)), 0);
  const ySpan = yMax - yMin || 1;
  const zeroY = 95 - ((0 - yMin) / ySpan) * 90;
  const s = tradeAnalytics.summary || {};
  const streaks = tradeAnalytics.streaks || { max_win_streak: 0, max_loss_streak: 0, current_streak: 0, current_streak_type: "none" };
  return (
    <div className="space-y-3">
      <div className="h-[34vh] min-h-[220px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2"><div className="mb-1 text-[11px] text-terminal-muted">PnL vs Holding Days</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[calc(100%-14px)] w-full"><line x1="0" y1={zeroY.toFixed(2)} x2="100" y2={zeroY.toFixed(2)} stroke={terminalColors.border} strokeDasharray="1 1" />{scatter.map((pt, idx) => { const x = 5 + (Number(pt.holding_days) / xMax) * 90; const y = 95 - ((Number(pt.pnl) - yMin) / ySpan) * 90; const fill = Number(pt.pnl) >= 0 ? terminalColors.positive : terminalColors.negative; return <circle key={`sc-${idx}`} cx={x.toFixed(2)} cy={y.toFixed(2)} r="1.2" fill={fill} opacity="0.85" />; })}</svg></div>
      <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4"><div className="rounded border border-terminal-border/40 p-2 text-terminal-pos">Win Rate: {(Number(s.win_rate) || 0).toFixed(2)}%</div><div className="rounded border border-terminal-border/40 p-2 text-terminal-info">Profit Factor: {(Number(s.profit_factor) || 0).toFixed(2)}</div><div className="rounded border border-terminal-border/40 p-2 text-terminal-accent">Expectancy: {fmtMoney(Number(s.expectancy) || 0)}</div><div className="rounded border border-terminal-border/40 p-2 text-terminal-warning">Avg Hold: {(Number(s.avg_holding_days) || 0).toFixed(1)}d</div></div>
      <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-3"><div className="rounded border border-terminal-border/40 p-2">Max Win Streak: {streaks.max_win_streak}</div><div className="rounded border border-terminal-border/40 p-2">Max Loss Streak: {streaks.max_loss_streak}</div><div className="rounded border border-terminal-border/40 p-2">Current: {streaks.current_streak_type} ({streaks.current_streak})</div></div>
    </div>
  );
}

export function ComparePanel(props: {
  strategyCatalog: Array<{ key: string; category: string; label: string }>;
  compareStrategies: string[];
  setCompareStrategies: Dispatch<SetStateAction<string[]>>;
  compareRunning: boolean;
  runComparison: () => Promise<void>;
  compareReadyStrategies: string[];
  compareActiveStrategy: string | null;
  setCompareActiveStrategy: Dispatch<SetStateAction<string | null>>;
  compareActiveBars: Bar[];
  compareActiveMarkers: Array<{ date: string; price: number; action: "BUY" | "SELL" }>;
  chartType: ChartKind;
  showVolume: boolean;
  showMarkers: boolean;
  strategyIndicators: Record<string, IndicatorConfig[]>;
  compareReferenceLines?: Array<{ label: string; price: number; color: string }>;
  compareCurves: Array<{ key: string; color: string; points: string }>;
  compareResults: Map<string, { result: any; status: string }>;
  fmtPct: (value: number) => string;
  fmtMoney: (value: number) => string;
}) {
  const {
    strategyCatalog,
    compareStrategies,
    setCompareStrategies,
    compareRunning,
    runComparison,
    compareReadyStrategies,
    compareActiveStrategy,
    setCompareActiveStrategy,
    compareActiveBars,
    compareActiveMarkers,
    chartType,
    showVolume,
    showMarkers,
    strategyIndicators,
    compareReferenceLines = [],
    compareCurves,
    compareResults,
    fmtPct,
    fmtMoney,
  } = props;
  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-border/40 p-2">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-terminal-muted">Select up to 6 strategies</div>
        <div className="flex flex-wrap gap-2">
          {strategyCatalog.map((s) => {
            const selected = compareStrategies.includes(s.key);
            return (
              <button
                key={s.key}
                className={`rounded border px-2 py-1 text-[11px] ${selected ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:bg-terminal-border/20"}`}
                onClick={() =>
                  setCompareStrategies((prev) =>
                    prev.includes(s.key) ? prev.filter((k) => k !== s.key) : (prev.length >= 6 ? prev : [...prev, s.key]))
                }
              >
                [{s.category.toUpperCase()}] {s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="text-[11px] text-terminal-muted">Selected: {compareStrategies.length}/6</div>
          <button className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-xs font-semibold text-terminal-accent disabled:opacity-50" disabled={!compareStrategies.length || compareRunning} onClick={() => void runComparison()}>
            {compareRunning ? "Running..." : "Run Comparison"}
          </button>
        </div>
      </div>

      {!!compareReadyStrategies.length && (
        <div className="rounded border border-terminal-border/40 p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-terminal-muted">Compare chart:</span>
            {compareReadyStrategies.map((key) => (
              <button key={`cmp-active-${key}`} className={`rounded border px-2 py-1 ${compareActiveStrategy === key ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:bg-terminal-border/20"}`} onClick={() => setCompareActiveStrategy(key)}>
                {key}
              </button>
            ))}
          </div>
          <div className="h-[56vh] min-h-[360px]">
            <BacktestingTradingChart
              bars={compareActiveBars}
              trades={compareActiveMarkers}
              chartType={chartType}
              showVolume={showVolume}
              showMarkers={showMarkers}
              activeIndicators={strategyIndicators[compareActiveStrategy ?? ""] || []}
              referenceLines={compareReferenceLines}
            />
          </div>
        </div>
      )}

      {!!compareCurves.length && (
        <div className="rounded border border-terminal-border/40 p-2">
          <div className="mb-2 text-[11px] text-terminal-muted">Overlaid Equity Curves</div>
          <div className="h-[30vh] min-h-[200px] bg-terminal-bg/50 p-2">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              {compareCurves.map((c) => <polyline key={c.key} fill="none" stroke={c.color} strokeWidth="1.2" points={c.points} />)}
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {compareCurves.map((c) => (
              <div key={`lg-${c.key}`} className="flex items-center gap-1 rounded border border-terminal-border/40 px-2 py-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                <span>{c.key}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded border border-terminal-border/40 p-2">
        <div className="mb-2 text-[11px] text-terminal-muted">Comparison Results</div>
        <div className="max-h-64 overflow-auto">
          <table className="min-w-full text-[11px]">
            <thead className="text-terminal-muted">
              <tr className="border-b border-terminal-border/40">
                <th className="px-1 py-1 text-left">Strategy</th>
                <th className="px-1 py-1 text-right">Return</th>
                <th className="px-1 py-1 text-right">Sharpe</th>
                <th className="px-1 py-1 text-right">Max DD</th>
                <th className="px-1 py-1 text-right">Trades</th>
                <th className="px-1 py-1 text-right">P&L</th>
                <th className="px-1 py-1 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {compareStrategies.map((key) => {
                const row = compareResults.get(key);
                const out = row?.result?.result;
                return (
                  <tr key={`cmp-${key}`} className="border-t border-terminal-border/30">
                    <td className="px-1 py-1">{key}</td>
                    <td className="px-1 py-1 text-right">{out ? fmtPct(out.total_return) : "-"}</td>
                    <td className="px-1 py-1 text-right">{out ? out.sharpe.toFixed(2) : "-"}</td>
                    <td className="px-1 py-1 text-right">{out ? fmtPct(out.max_drawdown) : "-"}</td>
                    <td className="px-1 py-1 text-right">{out ? out.trades.length : "-"}</td>
                    <td className="px-1 py-1 text-right">{out ? fmtMoney(out.pnl_amount) : "-"}</td>
                    <td className="px-1 py-1 text-right">{row?.status || "idle"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ParameterSurface3DPanel(props: {
  points: Surface3DPoint[];
  summary: { sharpe: number; drawdown: number; profitFactor: number };
}) {
  const { points, summary } = props;
  return (
    <div className="space-y-2">
      <ThreeDSurface points={points} emptyText="Run a backtest to render parameter efficacy surface." />
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded border border-terminal-border/40 p-2">Sharpe: {summary.sharpe.toFixed(2)}</div>
        <div className="rounded border border-terminal-border/40 p-2">Max DD: {(summary.drawdown * 100).toFixed(2)}%</div>
        <div className="rounded border border-terminal-border/40 p-2">Profit Factor: {summary.profitFactor.toFixed(2)}</div>
      </div>
    </div>
  );
}

export function DrawdownTerrain3DPanel(props: {
  points: Surface3DPoint[];
  worstDrawdownPct: number;
}) {
  const { points, worstDrawdownPct } = props;
  return (
    <div className="space-y-2">
      <ThreeDSurface points={points} emptyText="Run a backtest to render drawdown terrain." />
      <div className="rounded border border-terminal-border/40 p-2 text-[11px] text-terminal-muted">
        Worst observed drawdown: {worstDrawdownPct.toFixed(2)}%
      </div>
    </div>
  );
}

export function RegimeEfficacy3DPanel(props: {
  points: Surface3DPoint[];
  regimeCount: number;
}) {
  const { points, regimeCount } = props;
  return (
    <div className="space-y-2">
      <ThreeDSurface points={points} emptyText="Need enough bars to estimate regime efficacy cube." />
      <div className="rounded border border-terminal-border/40 p-2 text-[11px] text-terminal-muted">
        Regime states: {regimeCount} | Color: green=positive expectancy, red=negative expectancy
      </div>
    </div>
  );
}

export function OrderbookLiquidity3DPanel(props: {
  points: Surface3DPoint[];
  avgDepth: number;
  estimatedSpreadBps: number;
}) {
  const { points, avgDepth, estimatedSpreadBps } = props;
  return (
    <div className="space-y-2">
      <ThreeDSurface points={points} emptyText="Run a backtest to build liquidity depth map." />
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-terminal-border/40 p-2">Avg Depth: {avgDepth.toFixed(2)}</div>
        <div className="rounded border border-terminal-border/40 p-2">Est. Spread: {estimatedSpreadBps.toFixed(2)} bps</div>
      </div>
    </div>
  );
}

export function ImpliedVolatilitySurface3DPanel(props: {
  points: Surface3DPoint[];
  atmIvPct: number;
  ivSkew: number;
}) {
  const { points, atmIvPct, ivSkew } = props;
  return (
    <div className="space-y-2">
      <ThreeDSurface points={points} emptyText="Run a backtest to estimate implied volatility surface." />
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-terminal-border/40 p-2">ATM IV: {atmIvPct.toFixed(2)}%</div>
        <div className="rounded border border-terminal-border/40 p-2">IV Skew: {ivSkew.toFixed(2)}</div>
      </div>
    </div>
  );
}

export function VolatilitySurface3DPanel(props: {
  points: Surface3DPoint[];
  realizedVolPct: number;
  termSlope: number;
}) {
  const { points, realizedVolPct, termSlope } = props;
  return (
    <div className="space-y-2">
      <ThreeDSurface points={points} emptyText="Run a backtest to estimate realized volatility surface." />
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-terminal-border/40 p-2">Realized Vol: {realizedVolPct.toFixed(2)}%</div>
        <div className="rounded border border-terminal-border/40 p-2">Term Slope: {termSlope.toFixed(2)}</div>
      </div>
    </div>
  );
}

export function MonteCarloSimulationPanel(props: {
  medianPath: number[];
  p10Path: number[];
  p90Path: number[];
  startValue: number;
  endMedian: number;
}) {
  const { medianPath, p10Path, p90Path, startValue, endMedian } = props;
  const hasData = medianPath.length > 1 && p10Path.length === medianPath.length && p90Path.length === medianPath.length;
  const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  const toPoints = (arr: number[], min: number, max: number) => {
    const span = max - min || 1;
    return arr
      .map((v, i) => `${((i / Math.max(arr.length - 1, 1)) * 100).toFixed(2)},${(95 - ((v - min) / span) * 90).toFixed(2)}`)
      .join(" ");
  };

  if (!hasData) {
    return (
      <div className="space-y-2">
        <div className="flex h-[32vh] min-h-[220px] items-center justify-center rounded border border-terminal-border/40 bg-terminal-bg/50 text-[11px] text-terminal-muted">
          Not enough data to run Monte Carlo simulation.
        </div>
      </div>
    );
  }

  const min = Math.min(...p10Path, ...medianPath, ...p90Path);
  const max = Math.max(...p10Path, ...medianPath, ...p90Path);
  const p10Points = toPoints(p10Path, min, max);
  const p90Points = toPoints(p90Path, min, max);
  const medianPoints = toPoints(medianPath, min, max);
  const bandPolygon = `0,95 ${p90Points} 100,95 ${p10Path
    .map((v, i) => {
      const idx = p10Path.length - 1 - i;
      const x = (idx / Math.max(p10Path.length - 1, 1)) * 100;
      const y = 95 - ((v - min) / (max - min || 1)) * 90;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ")}`;

  return (
    <div className="space-y-2">
      <div className="h-[34vh] min-h-[230px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-2">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
          <polygon points={bandPolygon} fill={terminalColors.info} opacity="0.12" />
          <polyline fill="none" stroke={terminalColors.info} strokeWidth="1.1" points={p10Points} opacity="0.7" />
          <polyline fill="none" stroke={terminalColors.info} strokeWidth="1.1" points={p90Points} opacity="0.7" />
          <polyline fill="none" stroke={terminalColors.warning} strokeWidth="1.8" points={medianPoints} />
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-terminal-border/40 p-2">Start: {fmt(startValue)}</div>
        <div className="rounded border border-terminal-border/40 p-2">Median End: {fmt(endMedian)}</div>
      </div>
    </div>
  );
}
