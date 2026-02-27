import type { ChartKind, ChartTimeframe } from "./types";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { TerminalBadge } from "../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../components/terminal/TerminalButton";
import { TerminalInput } from "../../components/terminal/TerminalInput";
import { TerminalTooltip } from "../../components/terminal/TerminalTooltip";

const TIMEFRAMES: Array<{ label: string; value: ChartTimeframe }> = [
  { label: "1m", value: "1m" },
  { label: "2m", value: "2m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
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
  ohlcv?: { open: number; high: number; low: number; close: number; volume?: number | null } | null;
  timeframe: ChartTimeframe;
  onTimeframeChange: (tf: ChartTimeframe) => void;
  chartType: ChartKind;
  onChartTypeChange: (kind: ChartKind) => void;
  showIndicators: boolean;
  onToggleIndicators: () => void;
  extended?: boolean;
  onExtendedChange?: (v: boolean) => void;
  liveStatus?: "live" | "delayed" | "disconnected";
};

export function SharedChartToolbar({
  symbol,
  ltp,
  changePct,
  ohlc,
  ohlcv,
  timeframe,
  onTimeframeChange,
  chartType,
  onChartTypeChange,
  showIndicators,
  onToggleIndicators,
  extended = false,
  onExtendedChange,
  liveStatus,
}: Props) {
  const { formatDisplayMoney } = useDisplayCurrency();
  const pctBadgeVariant: "neutral" | "success" | "danger" =
    changePct === null ? "neutral" : changePct >= 0 ? "success" : "danger";

  const isDailyPlus = ["1D", "1W", "1M"].includes(timeframe);
  const liveStatusClass =
    liveStatus === "live"
      ? "text-terminal-pos border-terminal-pos"
      : liveStatus === "delayed"
      ? "text-terminal-warn border-terminal-warn"
      : "text-terminal-neg border-terminal-neg";

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-1.5 text-xs">
      <div className="flex items-center gap-4">
        {/* Market Data Strip */}
        <div className="flex items-center gap-3 border-r border-terminal-border pr-4">
          <TerminalBadge variant="accent" size="sm">
            {symbol}
          </TerminalBadge>

          <div className="tabular-nums font-bold text-terminal-text">
            {ltp === null ? "-" : formatDisplayMoney(ltp)}
          </div>

          <TerminalBadge variant={pctBadgeVariant} size="sm" className="tabular-nums font-bold">
            {changePct === null ? "-" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
          </TerminalBadge>
          {liveStatus && (
            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${liveStatusClass}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${liveStatus === "live" ? "animate-pulse bg-current" : "bg-current"}`} />
              {liveStatus.toUpperCase()}
            </span>
          )}

          <div className="hidden tabular-nums text-terminal-muted xl:block">
            <span className="mr-2">O:{(ohlcv ?? ohlc)?.open?.toFixed(2) ?? "-"}</span>
            <span className="mr-2">H:{(ohlcv ?? ohlc)?.high?.toFixed(2) ?? "-"}</span>
            <span className="mr-2">L:{(ohlcv ?? ohlc)?.low?.toFixed(2) ?? "-"}</span>
            <span className="mr-2">C:{(ohlcv ?? ohlc)?.close?.toFixed(2) ?? "-"}</span>
            <span>V:{Number.isFinite(Number(ohlcv?.volume)) ? Number(ohlcv?.volume).toLocaleString() : "-"}</span>
          </div>
        </div>

        {/* Controls Strip (Horizontal) */}
        <div className="flex flex-1 items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="mr-2 text-[10px] font-bold text-terminal-muted uppercase tracking-wider">Timing</span>
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                type="button"
                className={`min-w-8 px-1.5 py-0.5 rounded-sm border text-[10px] font-bold transition-colors ${
                  timeframe === tf.value
                    ? "bg-terminal-accent/20 border-terminal-accent text-terminal-accent"
                    : "bg-transparent border-terminal-border text-terminal-muted hover:text-terminal-text"
                }`}
                onClick={() => onTimeframeChange(tf.value)}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-terminal-border" />

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isDailyPlus}
              className={`px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase transition-colors ${
                extended
                  ? "bg-blue-600/20 border-blue-500 text-blue-400"
                  : "bg-transparent border-terminal-border text-terminal-muted hover:text-terminal-text"
              } ${isDailyPlus ? "opacity-30 cursor-not-allowed" : ""}`}
              onClick={() => onExtendedChange?.(!extended)}
              title="Toggle Extended Hours (Pre/Post Market)"
            >
              ETH
            </button>
          </div>

          <div className="h-4 w-px bg-terminal-border" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-wider">Type</span>
            <select
              value={chartType}
              onChange={(e) => onChartTypeChange(e.target.value as ChartKind)}
              className="bg-terminal-bg border border-terminal-border rounded-sm px-2 py-0.5 text-[10px] font-bold text-terminal-text focus:outline-none focus:border-terminal-accent"
            >
              <option value="candle">Candlestick</option>
              <option value="line">Line</option>
              <option value="area">Area</option>
              <option value="baseline">Baseline</option>
            </select>
          </div>

          <div className="h-4 w-px bg-terminal-border" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`px-3 py-0.5 rounded-sm border text-[10px] font-bold uppercase transition-colors ${
                showIndicators
                  ? "bg-terminal-accent/20 border-terminal-accent text-terminal-accent"
                  : "bg-transparent border-terminal-border text-terminal-muted hover:text-terminal-text"
              }`}
              onClick={onToggleIndicators}
            >
              Indicators
            </button>

            <TerminalTooltip content="Drawing tools (stub)">
              <span>
                <button
                  type="button"
                  className="px-3 py-0.5 rounded-sm border border-terminal-border text-[10px] font-bold text-terminal-muted uppercase hover:text-terminal-text"
                >
                  Draw
                </button>
              </span>
            </TerminalTooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
