import type { ChartKind, ChartTimeframe } from "./types";

const TIMEFRAMES: Array<{ label: string; value: ChartTimeframe }> = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1D" },
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
];

type Props = {
  symbol: string;
  ltp: number | null;
  changePct: number | null;
  ohlc: { open: number; high: number; low: number; close: number } | null;
  timeframe: ChartTimeframe;
  onTimeframeChange: (tf: ChartTimeframe) => void;
  chartType: ChartKind;
  onChartTypeChange: (kind: ChartKind) => void;
  showIndicators: boolean;
  onToggleIndicators: () => void;
};

export function SharedChartToolbar({
  symbol,
  ltp,
  changePct,
  ohlc,
  timeframe,
  onTimeframeChange,
  chartType,
  onChartTypeChange,
  showIndicators,
  onToggleIndicators,
}: Props) {
  const pctClass = changePct === null ? "text-terminal-muted" : changePct >= 0 ? "text-terminal-pos" : "text-terminal-neg";

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-semibold uppercase text-terminal-accent">{symbol}</div>
        <div className="tabular-nums text-terminal-text">{ltp === null ? "-" : ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
        <div className={`tabular-nums ${pctClass}`}>
          {changePct === null ? "-" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
        </div>
        <div className="tabular-nums text-terminal-muted">
          O:{ohlc?.open?.toFixed(2) ?? "-"} H:{ohlc?.high?.toFixed(2) ?? "-"} L:{ohlc?.low?.toFixed(2) ?? "-"} C:{ohlc?.close?.toFixed(2) ?? "-"}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`rounded border px-2 py-1 ${timeframe === tf.value ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => onTimeframeChange(tf.value)}
            >
              {tf.label}
            </button>
          ))}
          <select
            value={chartType}
            onChange={(e) => onChartTypeChange(e.target.value as ChartKind)}
            className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none"
          >
            <option value="candle">Candle</option>
            <option value="line">Line</option>
            <option value="area">Area</option>
            <option value="baseline">Baseline</option>
          </select>
          <button
            className={`rounded border px-2 py-1 ${showIndicators ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={onToggleIndicators}
          >
            Indicators
          </button>
          <button className="rounded border border-terminal-border px-2 py-1 text-terminal-muted" title="Drawing tools (stub)">
            Draw
          </button>
        </div>
      </div>
    </div>
  );
}
