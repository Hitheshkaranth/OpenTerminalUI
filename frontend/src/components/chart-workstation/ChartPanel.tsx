import { useMemo, useState } from "react";
import type { ChartPoint, ChartResponse } from "../../types";
import type {
  ChartSlot,
  ChartSlotTimeframe,
  ChartSlotType,
  SlotMarket,
  ExtendedHoursConfig,
  PreMarketLevelConfig,
} from "../../store/chartWorkstationStore";
import { TradingChart } from "../chart/TradingChart";
import { IndicatorPanel } from "../../shared/chart/IndicatorPanel";
import type { IndicatorConfig } from "../../shared/chart/types";
import { ChartPanelHeader } from "./ChartPanelHeader";
import { ChartPanelFooter } from "./ChartPanelFooter";
import type { QuoteTick } from "../../realtime/useQuotesStream";
import "./ChartWorkstation.css";

const CHART_MODE_MAP: Record<ChartSlotType, "candles" | "line" | "area"> = {
  candle: "candles",
  line: "line",
  area: "area",
};

interface Props {
  slot: ChartSlot;
  isActive: boolean;
  isFullscreen: boolean;
  onActivate: () => void;
  onToggleFullscreen: () => void;
  onRemove: () => void;
  onTickerChange: (ticker: string, market: SlotMarket) => void;
  onTimeframeChange: (tf: ChartSlotTimeframe) => void;
  onChartTypeChange: (type: ChartSlotType) => void;
  onETHChange: (eth: Partial<ExtendedHoursConfig>) => void;
  onPMLevelsChange: (levels: Partial<PreMarketLevelConfig>) => void;
  onIndicatorsChange: (indicators: IndicatorConfig[]) => void;
  chartResponse?: ChartResponse | null;
  chartLoading?: boolean;
  chartError?: string | null;
  liveQuote?: QuoteTick | null;
}

export function ChartPanel({
  slot,
  isActive,
  isFullscreen,
  onActivate,
  onToggleFullscreen,
  onRemove,
  onTickerChange,
  onTimeframeChange,
  onChartTypeChange,
  onETHChange,
  onPMLevelsChange,
  onIndicatorsChange,
  chartResponse,
  chartLoading = false,
  chartError = null,
  liveQuote = null,
}: Props) {
  const [showIndicators, setShowIndicators] = useState(false);
  const chartData: ChartPoint[] = chartResponse?.data ?? [];
  const loading = chartLoading && Boolean(slot.ticker);
  const error = chartError;
  const renderChartData = useMemo(() => {
    if (!chartData.length || !liveQuote || !Number.isFinite(liveQuote.ltp)) return chartData;
    const next = chartData.slice();
    const last = next[next.length - 1];
    if (!last) return chartData;
    const ltp = Number(liveQuote.ltp);
    next[next.length - 1] = {
      ...last,
      c: ltp,
      h: Math.max(last.h, ltp),
      l: Math.min(last.l, ltp),
    };
    return next;
  }, [chartData, liveQuote]);
  const lastBar = renderChartData.length > 0 ? renderChartData[renderChartData.length - 1] : null;
  const indicatorConfigs = useMemo<IndicatorConfig[]>(
    () =>
      Array.isArray(slot.indicators)
        ? slot.indicators
            .map<IndicatorConfig | null>((row) => {
              if (!row || typeof row !== "object") return null;
              const r = row as Partial<IndicatorConfig>;
              if (!r.id) return null;
              const next: IndicatorConfig = {
                id: r.id,
                params: r.params && typeof r.params === "object" ? r.params : {},
                visible: typeof r.visible === "boolean" ? r.visible : true,
              };
              if (typeof r.color === "string") next.color = r.color;
              if (typeof r.lineWidth === "number") next.lineWidth = r.lineWidth;
              return next;
            })
            .filter((row): row is IndicatorConfig => row !== null)
        : [],
    [slot.indicators],
  );

  return (
    <div
      className={`chart-panel${isActive ? " active" : ""}${isFullscreen ? " fullscreen" : ""}`}
      onClick={onActivate}
      onFocus={onActivate}
      tabIndex={-1}
      data-testid={`chart-panel-${slot.id}`}
      data-slot-id={slot.id}
    >
      <ChartPanelHeader
        slot={slot}
        isFullscreen={isFullscreen}
        onTickerChange={onTickerChange}
        onTimeframeChange={onTimeframeChange}
        onChartTypeChange={onChartTypeChange}
        onETHChange={onETHChange}
        onRemove={onRemove}
        onToggleFullscreen={onToggleFullscreen}
        chartData={renderChartData}
      />

      <div className="chart-panel-body">
        {slot.ticker && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            <button
              type="button"
              className={`rounded border px-2 py-0.5 text-[10px] ${
                showIndicators
                  ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                  : "border-terminal-border bg-terminal-panel/90 text-terminal-muted"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setShowIndicators((v) => !v);
              }}
              aria-label={showIndicators ? "Hide indicators panel" : "Show indicators panel"}
            >
              IND {indicatorConfigs.length ? `(${indicatorConfigs.length})` : ""}
            </button>
          </div>
        )}
        {!slot.ticker && (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            Search for a ticker above
          </div>
        )}
        {slot.ticker && loading && (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            Loading {slot.ticker}...
          </div>
        )}
        {slot.ticker && error && (
          <div className="flex h-full items-center justify-center text-xs text-terminal-neg">
            {error}
          </div>
        )}
        {slot.ticker && !loading && !error && renderChartData.length > 0 && (
          <TradingChart
            ticker={slot.ticker}
            data={renderChartData}
            mode={CHART_MODE_MAP[slot.chartType]}
            drawMode="none"
            extendedHours={slot.extendedHours}
            preMarketLevels={slot.preMarketLevels}
            market={slot.market}
            indicatorConfigs={indicatorConfigs}
          />
        )}
        {slot.ticker && showIndicators && (
          <div
            className="absolute inset-y-2 right-2 z-20 w-[320px] max-w-[calc(100%-1rem)] overflow-hidden rounded border border-terminal-border bg-terminal-panel shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2 text-[11px]">
              <span className="font-semibold text-terminal-accent">Indicators</span>
              <button
                type="button"
                className="rounded border border-terminal-border px-2 py-0.5 text-terminal-muted"
                onClick={() => setShowIndicators(false)}
              >
                Close
              </button>
            </div>
            <div className="max-h-full overflow-auto p-2">
              <IndicatorPanel
                symbol={slot.ticker}
                activeIndicators={indicatorConfigs}
                onChange={onIndicatorsChange}
                templateScope="equity"
              />
            </div>
          </div>
        )}
      </div>

      <ChartPanelFooter ticker={slot.ticker} lastBar={lastBar} liveLtp={liveQuote?.ltp ?? null} liveChangePct={liveQuote?.change_pct ?? null} />
    </div>
  );
}
