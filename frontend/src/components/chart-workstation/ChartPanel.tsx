import { useEffect, useMemo, useState } from "react";
import { fetchVolumeProfile, type VolumeProfileResponse } from "../../api/client";
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
import { VolumeProfile } from "../chart/VolumeProfile";
import { DrawingTools, type DrawMode } from "../chart/DrawingTools";
import { IndicatorPanel } from "../../shared/chart/IndicatorPanel";
import type { IndicatorConfig } from "../../shared/chart/types";
import { ChartPanelHeader } from "./ChartPanelHeader";
import { ChartPanelFooter } from "./ChartPanelFooter";
import type { QuoteTick } from "../../realtime/useQuotesStream";
import { quickAddToFirstPortfolio } from "../../shared/portfolioQuickAdd";
import type { WorkspaceLinkGroup } from "../../pages/ChartWorkstationPage";
import "./ChartWorkstation.css";

const CHART_MODE_MAP: Record<ChartSlotType, "candles" | "line" | "area"> = {
  candle: "candles",
  line: "line",
  area: "area",
};

function crosshairGroupIdForSlot(slotId: string, linkGroup: WorkspaceLinkGroup): string {
  if (linkGroup === "off") return `chart-workstation-solo-${slotId}`;
  return `chart-workstation-linked-${linkGroup}`;
}

interface Props {
  slot: ChartSlot;
  isActive: boolean;
  isFullscreen: boolean;
  onActivate: () => void;
  onToggleFullscreen: () => void;
  onRemove: () => void;
  linkGroup: WorkspaceLinkGroup;
  onLinkGroupChange: (group: WorkspaceLinkGroup) => void;
  onTickerChange: (ticker: string, market: SlotMarket, companyName?: string | null) => void;
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
  linkGroup,
  onLinkGroupChange,
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
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [clearDrawingsSignal, setClearDrawingsSignal] = useState(0);
  const [pendingTrendPoint, setPendingTrendPoint] = useState(false);
  const [showVolumeProfile, setShowVolumeProfile] = useState(false);
  const [vpMode, setVpMode] = useState<"fixed" | "session" | "visible">("fixed");
  const [vpPeriod, setVpPeriod] = useState("20d");
  const [vpLookbackBars, setVpLookbackBars] = useState(300);
  const [vpBins, setVpBins] = useState(50);
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfileResponse | null>(null);
  const [vpLoading, setVpLoading] = useState(false);
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

  useEffect(() => {
    if (!showVolumeProfile || !slot.ticker) return;
    const symbol = String(slot.ticker);
    let cancelled = false;
    const load = async () => {
      setVpLoading(true);
      try {
        const payload = await fetchVolumeProfile(symbol, {
          period: vpPeriod,
          bins: vpBins,
          market: slot.market,
          mode: vpMode,
          lookbackBars: vpMode === "visible" ? vpLookbackBars : undefined,
        });
        if (!cancelled) setVolumeProfile(payload);
      } catch {
        if (!cancelled) setVolumeProfile(null);
      } finally {
        if (!cancelled) setVpLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showVolumeProfile, slot.ticker, slot.market, vpMode, vpPeriod, vpLookbackBars, vpBins]);

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
        linkGroup={linkGroup}
        onLinkGroupChange={onLinkGroupChange}
        chartData={renderChartData}
      />

      <div className="chart-panel-body">
        {slot.ticker && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            <button
              type="button"
              className={`rounded border px-2 py-0.5 text-[10px] ${
                showVolumeProfile
                  ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                  : "border-terminal-border bg-terminal-panel/90 text-terminal-muted"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setShowVolumeProfile((v) => !v);
              }}
              aria-label={showVolumeProfile ? "Hide volume profile" : "Show volume profile"}
            >
              VP
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-0.5 text-[10px] ${
                showDrawingTools
                  ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                  : "border-terminal-border bg-terminal-panel/90 text-terminal-muted"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setShowDrawingTools((v) => !v);
              }}
              aria-label={showDrawingTools ? "Hide drawing tools" : "Show drawing tools"}
            >
              DRAW {drawMode !== "none" ? `(${drawMode})` : ""}
            </button>
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
          <>
            <TradingChart
              ticker={slot.ticker}
              data={renderChartData}
              mode={CHART_MODE_MAP[slot.chartType]}
              timeframe={slot.timeframe}
              extendedHours={slot.extendedHours}
              preMarketLevels={slot.preMarketLevels}
              market={slot.market}
              indicatorConfigs={indicatorConfigs}
              drawMode={drawMode}
              clearDrawingsSignal={clearDrawingsSignal}
              onPendingTrendPointChange={setPendingTrendPoint}
              drawingWorkspaceId={slot.id}
              panelId={slot.id}
              crosshairSyncGroupId={crosshairGroupIdForSlot(slot.id, linkGroup)}
              onAddToPortfolio={(symbol, priceHint) => {
                void quickAddToFirstPortfolio(symbol, priceHint, "Added from Chart Workstation");
              }}
            />
            {showVolumeProfile ? <VolumeProfile profile={volumeProfile} liveQuote={liveQuote} /> : null}
          </>
        )}
        {showVolumeProfile && slot.ticker ? (
          <div className="absolute right-2 top-10 z-10 flex items-center gap-1 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[10px] text-terminal-muted">
            <span>VP</span>
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
              value={vpMode}
              onChange={(e) => setVpMode(e.target.value as "fixed" | "session" | "visible")}
            >
              <option value="fixed">Fixed</option>
              <option value="session">Session</option>
              <option value="visible">Visible</option>
            </select>
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
              value={vpPeriod}
              onChange={(e) => setVpPeriod(e.target.value)}
              disabled={vpMode !== "fixed"}
            >
              <option value="5d">5d</option>
              <option value="10d">10d</option>
              <option value="20d">20d</option>
              <option value="30d">30d</option>
            </select>
            {vpMode === "visible" ? (
              <select
                className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
                value={vpLookbackBars}
                onChange={(e) => setVpLookbackBars(Number(e.target.value))}
              >
                <option value={150}>150</option>
                <option value={300}>300</option>
                <option value={500}>500</option>
              </select>
            ) : null}
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
              value={vpBins}
              onChange={(e) => setVpBins(Number(e.target.value))}
            >
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={80}>80</option>
            </select>
            {vpLoading ? <span className="text-terminal-accent">...</span> : null}
          </div>
        ) : null}
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
        {slot.ticker && showDrawingTools && (
          <div
            className="absolute bottom-2 left-2 z-20 w-[260px] max-w-[calc(100%-1rem)] overflow-hidden rounded border border-terminal-border bg-terminal-panel shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2 text-[11px]">
              <span className="font-semibold text-terminal-accent">Drawings</span>
              <button
                type="button"
                className="rounded border border-terminal-border px-2 py-0.5 text-terminal-muted"
                onClick={() => setShowDrawingTools(false)}
              >
                Close
              </button>
            </div>
            <div className="p-2">
              <DrawingTools
                mode={drawMode}
                onModeChange={setDrawMode}
                onClear={() => {
                  setPendingTrendPoint(false);
                  setClearDrawingsSignal((v) => v + 1);
                }}
                pendingTrendPoint={pendingTrendPoint}
              />
            </div>
          </div>
        )}
      </div>

      <ChartPanelFooter ticker={slot.ticker} lastBar={lastBar} liveLtp={liveQuote?.ltp ?? null} liveChangePct={liveQuote?.change_pct ?? null} />
    </div>
  );
}
