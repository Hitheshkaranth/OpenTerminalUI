import { useEffect, useMemo, useState } from "react";
import type { Bar } from "oakscriptjs";

import {
  fetchBacktestJobResult,
  fetchBacktestJobStatus,
  submitBacktestJob,
  type BacktestJobResult,
} from "../api/client";
import { BacktestingTradingChart } from "../components/backtesting/BacktestingTradingChart";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { IndicatorPanel } from "../shared/chart/IndicatorPanel";
import type { ChartKind, IndicatorConfig } from "../shared/chart/types";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";

type JobState = "idle" | "queued" | "running" | "done" | "failed";
type BacktestTimeframe = "1D" | "1W" | "1M";

type StrategyPreset = {
  label: string;
  value: string;
  context: Record<string, unknown>;
  allocationPct: number;
  description: string;
};

const EXAMPLE_STRATEGIES: StrategyPreset[] = [
  {
    label: "SMA Crossover (20/50)",
    value: "example:sma_crossover",
    context: { short_window: 20, long_window: 50 },
    allocationPct: 1.0,
    description: "Trend-following model using simple moving average crossover.",
  },
  {
    label: "EMA Crossover (12/26)",
    value: "example:ema_crossover",
    context: { short_window: 12, long_window: 26 },
    allocationPct: 0.75,
    description: "Faster trend model using exponential moving averages.",
  },
  {
    label: "Mean Reversion (Z-Score)",
    value: "example:mean_reversion",
    context: { lookback: 20, entry_z: 1.0 },
    allocationPct: 0.55,
    description: "Contrarian model buying weakness and selling strength.",
  },
  {
    label: "20-Day Breakout",
    value: "example:breakout_20",
    context: { lookback: 20 },
    allocationPct: 1.0,
    description: "Momentum breakout model using rolling high/low triggers.",
  },
];

const CUSTOM_STRATEGY_VALUE = "custom";

const STRATEGY_INDICATORS: Record<string, IndicatorConfig[]> = {
  "example:sma_crossover": [
    { id: "sma", params: { period: 20 }, visible: true, color: terminalColors.positive, lineWidth: 2 },
    { id: "rsi", params: { period: 14 }, visible: true, color: terminalColors.warning, lineWidth: 1 },
  ],
  "example:ema_crossover": [
    { id: "ema", params: { period: 12 }, visible: true, color: terminalColors.info, lineWidth: 2 },
    { id: "macd", params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, visible: true, color: terminalColors.text, lineWidth: 1 },
  ],
  "example:mean_reversion": [
    { id: "bb", params: { period: 20, stdDev: 2 }, visible: true, color: terminalColors.accent, lineWidth: 1 },
    { id: "rsi", params: { period: 14 }, visible: true, color: terminalColors.warning, lineWidth: 1 },
  ],
  "example:breakout_20": [
    { id: "donchian", params: { period: 20 }, visible: true, color: terminalColors.candleUp, lineWidth: 1 },
    { id: "atr", params: { period: 14 }, visible: true, color: terminalColors.candleDown, lineWidth: 1 },
  ],
};

const DEFAULT_SCRIPT = `def generate_signals(df, context):
    # valid values: -1, 0, 1
    out = []
    for _, row in df.iterrows():
        out.append(1 if row["close"] >= row["open"] else -1)
    return out
`;

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMoney(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

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
    const high = Math.max(...sorted.map((x) => Number(x.high)));
    const low = Math.min(...sorted.map((x) => Number(x.low)));
    const volume = sorted.reduce((acc, x) => acc + Number(x.volume ?? 0), 0);
    out.push({
      time: Number(first.time),
      open: Number(first.open),
      high,
      low,
      close: Number(last.close),
      volume,
    });
  }
  return out.sort((a, b) => Number(a.time) - Number(b.time));
}

export function BacktestingPage() {
  const storeTicker = useStockStore((s) => s.ticker);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);

  const [asset, setAsset] = useState((storeTicker || "RELIANCE").toUpperCase());
  const [market, setMarket] = useState(selectedMarket || "NSE");
  const [tradeCapital, setTradeCapital] = useState(100000);
  const [start, setStart] = useState("2024-01-01");
  const [end, setEnd] = useState("2026-01-01");
  const [strategyMode, setStrategyMode] = useState(EXAMPLE_STRATEGIES[0].value);
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [runId, setRunId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestJobResult | null>(null);
  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>("1D");
  const [showVolume, setShowVolume] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showIndicators, setShowIndicators] = useState(true);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>(
    STRATEGY_INDICATORS["example:sma_crossover"] || [],
  );

  useEffect(() => {
    if (storeTicker) {
      setAsset(storeTicker.toUpperCase());
    }
  }, [storeTicker]);

  useEffect(() => {
    if (selectedMarket) {
      setMarket(selectedMarket);
    }
  }, [selectedMarket]);

  useEffect(() => {
    if (strategyMode === CUSTOM_STRATEGY_VALUE) {
      setActiveIndicators([]);
      return;
    }
    setActiveIndicators(STRATEGY_INDICATORS[strategyMode] || []);
  }, [strategyMode]);

  const symbol = useMemo(() => asset.trim().toUpperCase(), [asset]);
  const activePreset = useMemo(
    () => EXAMPLE_STRATEGIES.find((s) => s.value === strategyMode) || null,
    [strategyMode],
  );
  const modelAllocation = useMemo(
    () => (strategyMode === CUSTOM_STRATEGY_VALUE ? 1 : (activePreset?.allocationPct ?? 1)),
    [activePreset, strategyMode],
  );

  const canSubmit = useMemo(() => {
    if (!asset.trim()) return false;
    if (!Number.isFinite(tradeCapital) || tradeCapital <= 0) return false;
    if (strategyMode === CUSTOM_STRATEGY_VALUE && !script.trim()) return false;
    return jobState !== "queued" && jobState !== "running";
  }, [asset, jobState, script, strategyMode, tradeCapital]);

  const submit = async () => {
    setError(null);
    setResult(null);
    const strategy = strategyMode === CUSTOM_STRATEGY_VALUE ? script : strategyMode;
    const context = strategyMode === CUSTOM_STRATEGY_VALUE ? {} : (activePreset?.context ?? {});
    const res = await submitBacktestJob({
      symbol,
      asset: symbol,
      market,
      start,
      end,
      strategy,
      context,
      config: { initial_cash: tradeCapital, position_fraction: modelAllocation },
    });
    setRunId(res.run_id);
    setJobState("queued");
  };

  useEffect(() => {
    if (!runId) return;
    if (jobState !== "queued" && jobState !== "running") return;
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
            if (payload.status === "failed") {
              setError(payload.error || "Backtest failed");
            }
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
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobState, runId]);

  const equityData = result?.result?.equity_curve || [];
  const trades = result?.result?.trades || [];
  const tradeMarkers = useMemo(
    () =>
      trades.map((t) => ({
        date: t.date,
        price: t.price,
        action: t.action.toUpperCase(),
      })),
    [trades],
  );
  const totalTradeQty = useMemo(
    () => trades.reduce((acc, trade) => acc + Math.abs(trade.quantity), 0),
    [trades],
  );
  const priceBars = useMemo<Bar[]>(
    () =>
      equityData
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
        ),
    [equityData],
  );
  const displayedBars = useMemo(() => aggregateBars(priceBars, timeframe), [priceBars, timeframe]);
  const typedTradeMarkers = useMemo(
    () => {
      const keyToTime = new Map<string, number>();
      for (const b of displayedBars) {
        keyToTime.set(bucketKey(Number(b.time), timeframe), Number(b.time));
      }
      return tradeMarkers
        .map((m) => ({
          date: (() => {
            const ts = Math.floor(new Date(`${m.date}T00:00:00Z`).getTime() / 1000);
            const mapped = keyToTime.get(bucketKey(ts, timeframe));
            if (!mapped) return m.date;
            return new Date(mapped * 1000).toISOString().slice(0, 10);
          })(),
          price: m.price,
          action: (m.action === "BUY" ? "BUY" : "SELL") as "BUY" | "SELL",
        }));
    },
    [displayedBars, timeframe, tradeMarkers],
  );

  const returnClass =
    (result?.result?.total_return || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  const tradedAsset = result?.result?.asset || symbol;
  const initialCapital = result?.result?.initial_cash ?? tradeCapital;
  const finalEquity = result?.result?.final_equity ?? (equityData.length ? Number(equityData[equityData.length - 1].equity) : initialCapital);
  const pnlAmount = result?.result?.pnl_amount ?? (finalEquity - initialCapital);
  const endingCash = result?.result?.ending_cash ?? (equityData.length ? Number(equityData[equityData.length - 1].cash) : initialCapital);

  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 py-2 pb-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
        <TerminalPanel title="Backtesting Control Deck" subtitle="Compact controls for chart-first workflow">
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-7">
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Asset (Ticker)</span>
              <input
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
              />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Market</span>
              <select
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs uppercase"
                value={market}
                onChange={(e) => setMarket(e.target.value as "NSE" | "BSE" | "NYSE" | "NASDAQ")}
              >
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Start</span>
              <input
                type="date"
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">End</span>
              <input
                type="date"
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Model</span>
              <select
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={strategyMode}
                onChange={(e) => setStrategyMode(e.target.value)}
              >
                {EXAMPLE_STRATEGIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                <option value={CUSTOM_STRATEGY_VALUE}>Custom Python Script</option>
              </select>
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Trade Capital</span>
              <input
                type="number"
                min={1}
                step={100}
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={tradeCapital}
                onChange={(e) => setTradeCapital(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="rounded border border-terminal-border/60 bg-terminal-bg px-2 py-1 text-terminal-muted">
              {strategyMode === CUSTOM_STRATEGY_VALUE
                ? "Custom script mode: define generate_signals(df, context)."
                : activePreset?.description}
            </div>
            <div className="rounded border border-terminal-border/60 bg-terminal-bg px-2 py-1 text-terminal-muted">
              Model allocation: {(modelAllocation * 100).toFixed(0)}%
            </div>
            <div className="flex items-center gap-2">
              <span className="text-terminal-muted">Run ID: {runId || "-"}</span>
              <span className="text-terminal-muted">Status: {jobState.toUpperCase()}</span>
              <button
                className="rounded border border-terminal-accent bg-terminal-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-terminal-accent disabled:opacity-50"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {jobState === "queued" || jobState === "running" ? "Running..." : "Run"}
              </button>
            </div>
          </div>
          {strategyMode === CUSTOM_STRATEGY_VALUE && (
            <label className="mt-2 block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Python Strategy Script</span>
              <textarea
                className="h-36 w-full resize-none rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px] text-terminal-text"
                value={script}
                onChange={(e) => setScript(e.target.value)}
              />
            </label>
          )}
          {error && (
            <div className="mt-2 rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">
              {error}
            </div>
          )}
        </TerminalPanel>

        <TerminalPanel title="Backtest Performance" subtitle="Model result summary">
          <div className="space-y-2">
            <div className={`text-5xl font-bold tracking-tight ${returnClass}`}>
              {result?.result ? fmtPct(result.result.total_return) : "-"}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-terminal-text">
              <div className="text-terminal-muted">Initial Capital</div>
              <div>{fmtMoney(initialCapital)}</div>
              <div className="text-terminal-muted">Final Equity</div>
              <div>{fmtMoney(finalEquity)}</div>
              <div className="text-terminal-muted">Net P/L</div>
              <div className={pnlAmount >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{fmtMoney(pnlAmount)}</div>
              <div className="text-terminal-muted">Cash Left</div>
              <div>{fmtMoney(endingCash)}</div>
              <div className="text-terminal-muted">Sharpe</div>
              <div>{result?.result ? result.result.sharpe.toFixed(2) : "-"}</div>
              <div className="text-terminal-muted">Max Drawdown</div>
              <div>{result?.result ? fmtPct(result.result.max_drawdown) : "-"}</div>
              <div className="text-terminal-muted">Trades</div>
              <div>{trades.length}</div>
              <div className="text-terminal-muted">Total Qty</div>
              <div>{totalTradeQty.toFixed(2)}</div>
            </div>
          </div>
        </TerminalPanel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
        <TerminalPanel title="Underlying Price with Buy/Sell Events" subtitle={`${tradedAsset} ${market}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as BacktestTimeframe)}
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text"
            >
              <option value="1D">1D</option>
              <option value="1W">1W</option>
              <option value="1M">1M</option>
            </select>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as ChartKind)}
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text"
            >
              <option value="candle">Candles</option>
              <option value="line">Line</option>
              <option value="area">Area</option>
            </select>
            <button
              className={`rounded border px-2 py-1 ${showVolume ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => setShowVolume((v) => !v)}
            >
              Volume
            </button>
            <button
              className={`rounded border px-2 py-1 ${showIndicators ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => setShowIndicators((v) => !v)}
            >
              Indicators
            </button>
            <button
              className={`rounded border px-2 py-1 ${showMarkers ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => setShowMarkers((v) => !v)}
            >
              Markers
            </button>
          </div>
          <div className="h-[62vh] min-h-[420px]">
            <BacktestingTradingChart
              bars={displayedBars}
              trades={typedTradeMarkers}
              chartType={chartType}
              showVolume={showVolume}
              showMarkers={showMarkers}
              activeIndicators={activeIndicators}
            />
          </div>
        </TerminalPanel>

        <TerminalPanel title="Indicators" subtitle="Chart overlays and oscillators">
          {showIndicators ? (
            <IndicatorPanel symbol={symbol} activeIndicators={activeIndicators} onChange={setActiveIndicators} />
          ) : (
            <div className="text-[11px] text-terminal-muted">Indicators hidden. Use the chart toolbar toggle to show.</div>
          )}
        </TerminalPanel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TerminalPanel
          title="Trade Blotter"
          subtitle={`Executed trades: ${trades.length} | Total quantity: ${totalTradeQty.toFixed(2)}`}
        >
          <div className="max-h-56 overflow-auto">
            <table className="min-w-full text-[11px]">
              <thead className="text-terminal-muted">
                <tr className="border-b border-terminal-border">
                  <th className="px-1 py-1 text-left">Date</th>
                  <th className="px-1 py-1 text-left">Asset</th>
                  <th className="px-1 py-1 text-left">Side</th>
                  <th className="px-1 py-1 text-right">Quantity</th>
                  <th className="px-1 py-1 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade, idx) => {
                  const isBuy = trade.action.toUpperCase() === "BUY";
                  return (
                    <tr
                      key={`${trade.date}-${idx}`}
                      className={`border-t border-terminal-border/40 ${isBuy ? "text-terminal-pos" : "text-terminal-neg"}`}
                    >
                      <td className="px-1 py-1 text-terminal-text">{trade.date}</td>
                      <td className="px-1 py-1 text-terminal-text">{tradedAsset}</td>
                      <td className={`px-1 py-1 font-semibold ${isBuy ? "text-terminal-pos" : "text-terminal-neg"}`}>
                        {trade.action.toUpperCase()}
                      </td>
                      <td className="px-1 py-1 text-right">{trade.quantity.toFixed(2)}</td>
                      <td className="px-1 py-1 text-right">{trade.price.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Execution Logs" subtitle="Strategy stdout/stderr">
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap bg-terminal-bg p-2 font-mono text-[11px] text-terminal-muted">
            {result?.logs || "No logs"}
          </pre>
        </TerminalPanel>
      </div>
    </div>
  );
}
