import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAlert,
  fetchAlertsFiltered,
  fetchMarketStatus,
  fetchPitFundamentals,
  fetchStockEvents,
  fetchVolumeProfile,
  type VolumeProfileResponse,
} from "../../api/client";
import type { AlertRule, ChartPoint, ChartResponse, CorporateEvent, PitFundamentalsResponse } from "../../types";
import type {
  ChartSlot,
  ChartSlotTimeframe,
  ChartSlotType,
  SlotMarket,
  ExtendedHoursConfig,
  PreMarketLevelConfig,
} from "../../store/chartWorkstationStore";
import { TradingChart } from "../chart/TradingChart";
import { ChartAlertComposer } from "../chart/ChartAlertComposer";
import { VolumeProfile } from "../chart/VolumeProfile";
import { DrawingTools, type DrawMode } from "../chart/DrawingTools";
import { IndicatorPanel } from "../../shared/chart/IndicatorPanel";
import { normalizeIndicatorConfigs } from "../../shared/chart/indicatorCatalog";
import type { IndicatorConfig } from "../../shared/chart/types";
import type { ReplayCommand } from "../../shared/chart/replay";
import { ChartPanelHeader } from "./ChartPanelHeader";
import { ChartPanelFooter } from "./ChartPanelFooter";
import type { QuoteTick } from "../../realtime/useQuotesStream";
import { quickAddToFirstPortfolio } from "../../shared/portfolioQuickAdd";
import {
  buildActiveChartAlertPreview,
  buildIndicatorAlertDraft,
  chartPointToAlertCandle,
  qualifyAlertSymbol,
  type ChartAlertDraft,
} from "../../shared/chart/chartAlerts";
import type { WorkspaceLinkGroup, WorkspaceLinkSettings, WorkspaceRangePresetId } from "../../pages/ChartWorkstationPage";
import "./ChartWorkstation.css";

const CHART_MODE_MAP: Record<ChartSlotType, "candles" | "line" | "area"> = {
  candle: "candles",
  line: "line",
  area: "area",
};

function toUtcDateInput(timestampSeconds: number | null | undefined): string | undefined {
  if (typeof timestampSeconds !== "number" || !Number.isFinite(timestampSeconds)) return undefined;
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function crosshairGroupIdForSlot(slotId: string, linkGroup: WorkspaceLinkGroup, crosshairLinked: boolean): string {
  if (!crosshairLinked || linkGroup === "off") return `chart-workstation-solo-${slotId}`;
  return `chart-workstation-linked-${linkGroup}`;
}

interface Props {
  slot: ChartSlot;
  isActive: boolean;
  isFullscreen: boolean;
  panelIndex?: number;
  visiblePanelCount?: number;
  denseToolbar?: boolean;
  onActivate: () => void;
  onToggleFullscreen: () => void;
  onRemove: () => void;
  linkGroup: WorkspaceLinkGroup;
  linkSettings: WorkspaceLinkSettings;
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
  comparisonSeries?: Array<{ symbol: string; data: ChartPoint[]; color?: string }>;
  comparisonMode?: "normalized" | "price";
  replayToggleRevision?: number;
  replayCommand?: ReplayCommand;
  viewRangeCommand?: {
    presetId: WorkspaceRangePresetId;
    revision: number;
  };
  panelCommand?: {
    id: "toggleIndicators" | "toggleDrawingTools" | "toggleVolumeProfile";
    revision: number;
  };
}

export function ChartPanel({
  slot,
  isActive,
  isFullscreen,
  panelIndex = 1,
  visiblePanelCount = 1,
  denseToolbar = false,
  onActivate,
  onToggleFullscreen,
  onRemove,
  linkGroup,
  linkSettings,
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
  comparisonSeries = [],
  comparisonMode = "normalized",
  replayToggleRevision,
  replayCommand,
  viewRangeCommand,
  panelCommand,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
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
  const [contextEvents, setContextEvents] = useState<CorporateEvent[]>([]);
  const [contextFundamentals, setContextFundamentals] = useState<PitFundamentalsResponse | null>(null);
  const [contextMarketStatus, setContextMarketStatus] = useState<Record<string, unknown> | null>(null);
  const [alertDraft, setAlertDraft] = useState<ChartAlertDraft | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertNotice, setAlertNotice] = useState<{ message: string; tone: "success" | "warning" } | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<AlertRule[]>([]);
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
  const currentPrice = lastBar?.c ?? (Number.isFinite(liveQuote?.ltp) ? Number(liveQuote?.ltp) : null);
  const overlayDateRange = useMemo(() => {
    const first = chartData[0]?.t;
    const last = chartData[chartData.length - 1]?.t;
    const from = toUtcDateInput(first);
    const to = toUtcDateInput(last);
    return from && to ? { from, to } : null;
  }, [chartData]);
  const indicatorConfigs = useMemo<IndicatorConfig[]>(
    () => normalizeIndicatorConfigs(slot.indicators),
    [slot.indicators],
  );
  const alertSymbol = useMemo(() => (slot.ticker ? qualifyAlertSymbol(slot.ticker, slot.market) : ""), [slot.market, slot.ticker]);
  const loadActiveAlerts = useCallback(async () => {
    if (!alertSymbol) {
      setActiveAlerts([]);
      return;
    }
    try {
      const rows = await fetchAlertsFiltered({ status: "active", symbol: alertSymbol });
      setActiveAlerts(rows);
    } catch {
      setActiveAlerts([]);
    }
  }, [alertSymbol]);
  const activeAlertPreviews = useMemo(
    () =>
      activeAlerts
        .map(buildActiveChartAlertPreview)
        .filter((row): row is Exclude<ReturnType<typeof buildActiveChartAlertPreview>, null> => row !== null),
    [activeAlerts],
  );

  const handleIndicatorAlertRequest = useCallback(
    (config: IndicatorConfig) => {
      const draft = buildIndicatorAlertDraft({
        symbol: slot.ticker || "",
        market: slot.market,
        timeframe: slot.timeframe,
        panelId: slot.id,
        workspaceId: slot.id,
        compareMode: comparisonMode,
        currentPrice,
        referenceTime: lastBar?.t ?? null,
        candle: chartPointToAlertCandle(lastBar),
        data: renderChartData,
        config,
      });
      if (!draft) {
        setAlertDraft(null);
        setAlertError(null);
        setAlertNotice({ message: `No numeric snapshot is available for ${config.id.toUpperCase()}.`, tone: "warning" });
        return;
      }
      setAlertNotice(null);
      setAlertError(null);
      setAlertDraft(draft);
    },
    [comparisonMode, currentPrice, lastBar, renderChartData, slot.id, slot.market, slot.ticker, slot.timeframe],
  );

  const handleSubmitAlert = useCallback(
    async (payload: {
      conditionType: "price_above" | "price_below";
      threshold: number;
      cooldownSeconds: number;
      note: string;
      channels: string[];
    }) => {
      if (!alertDraft) return;
      setAlertSubmitting(true);
      setAlertError(null);
      try {
        await createAlert({
          symbol: alertDraft.symbol,
          condition_type: payload.conditionType,
          parameters: {
            threshold: payload.threshold,
            note: payload.note,
            chart_context: {
              ...alertDraft.chartContext,
              referencePrice: payload.threshold,
            },
          },
          cooldown_seconds: payload.cooldownSeconds,
          channels: payload.channels,
        });
        setAlertDraft(null);
        setAlertNotice({
          message: `${alertDraft.chartContext.sourceLabel} alert created at ${payload.threshold}.`,
          tone: "success",
        });
        await loadActiveAlerts();
      } catch (submitError) {
        setAlertError(submitError instanceof Error ? submitError.message : "Failed to create chart alert");
      } finally {
        setAlertSubmitting(false);
      }
    },
    [alertDraft, loadActiveAlerts],
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

  useEffect(() => {
    if (!slot.ticker || !overlayDateRange) {
      setContextEvents([]);
      setContextFundamentals(null);
      return;
    }
    const symbol = String(slot.ticker);
    let cancelled = false;
    const load = async () => {
      const [eventsResult, fundamentalsResult] = await Promise.allSettled([
        fetchStockEvents(symbol, {
          from_date: overlayDateRange.from,
          to_date: overlayDateRange.to,
        }),
        fetchPitFundamentals(symbol, { as_of: overlayDateRange.to }),
      ]);
      if (cancelled) return;
      setContextEvents(eventsResult.status === "fulfilled" ? eventsResult.value : []);
      setContextFundamentals(fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [overlayDateRange, slot.ticker]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await fetchMarketStatus();
        if (!cancelled) setContextMarketStatus(payload);
      } catch {
        if (!cancelled) setContextMarketStatus(null);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await loadActiveAlerts();
    };
    if (alertSymbol) {
      void load();
    } else {
      setActiveAlerts([]);
    }
    const timer = window.setInterval(() => {
      if (cancelled || !alertSymbol) return;
      void load();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [alertSymbol, loadActiveAlerts]);

  useEffect(() => {
    if (!alertNotice) return;
    const timer = window.setTimeout(() => setAlertNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [alertNotice]);

  useEffect(() => {
    if (!panelCommand?.revision || !slot.ticker) return;
    if (panelCommand.id === "toggleIndicators") {
      setShowIndicators((value) => !value);
      return;
    }
    if (panelCommand.id === "toggleDrawingTools") {
      setShowDrawingTools((value) => {
        const next = !value;
        if (!next) {
          setDrawMode("none");
          setPendingTrendPoint(false);
        }
        return next;
      });
      return;
    }
    if (panelCommand.id === "toggleVolumeProfile") {
      setShowVolumeProfile((value) => !value);
    }
  }, [panelCommand, slot.ticker]);

  return (
    <div
      ref={panelRef}
      className={`chart-panel${isActive ? " active" : ""}${isFullscreen ? " fullscreen" : ""}`}
      onClick={() => {
        onActivate();
        panelRef.current?.focus();
      }}
      onFocus={onActivate}
      tabIndex={-1}
      data-testid={`chart-panel-${slot.id}`}
      data-slot-id={slot.id}
    >
      <ChartPanelHeader
        slot={slot}
        isActive={isActive}
        isFullscreen={isFullscreen}
        panelIndex={panelIndex}
        visiblePanelCount={visiblePanelCount}
        dense={denseToolbar}
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
                setShowDrawingTools((v) => {
                  const next = !v;
                  if (!next) {
                    setDrawMode("none");
                    setPendingTrendPoint(false);
                  }
                  return next;
                });
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
        {slot.ticker && activeAlertPreviews.length ? (
          <div
            className="pointer-events-none absolute left-2 top-10 z-10 max-w-[min(18rem,calc(100%-6rem))] rounded border border-terminal-border bg-terminal-panel/95 px-2 py-2 text-[10px] text-terminal-text"
            data-testid="chart-active-alerts"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold uppercase tracking-[0.18em] text-terminal-accent">Chart Alerts</span>
              <span className="text-terminal-muted">{activeAlertPreviews.length}</span>
            </div>
            <div className="mt-2 space-y-1">
              {activeAlertPreviews.slice(0, 4).map((preview) => (
                <div key={preview.id} className="rounded border border-terminal-border/70 bg-terminal-bg/40 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{preview.sourceLabel}</span>
                    <span className="text-terminal-muted">{preview.thresholdLabel}</span>
                  </div>
                  <div className="truncate text-terminal-muted">
                    {preview.conditionLabel}
                    {preview.subtitle ? ` | ${preview.subtitle}` : ""}
                  </div>
                </div>
              ))}
              {activeAlertPreviews.length > 4 ? (
                <div className="text-terminal-muted">+{activeAlertPreviews.length - 4} more active alerts</div>
              ) : null}
            </div>
          </div>
        ) : null}
        {alertNotice ? (
          <div
            className={`absolute left-1/2 top-10 z-20 -translate-x-1/2 rounded border px-3 py-1 text-[11px] ${
              alertNotice.tone === "success"
                ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-warn bg-terminal-warn/10 text-terminal-warn"
            }`}
            data-testid="chart-alert-notice"
          >
            {alertNotice.message}
          </div>
        ) : null}
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
              crosshairSyncGroupId={crosshairGroupIdForSlot(slot.id, linkGroup, linkSettings.crosshair)}
              comparisonSeries={comparisonSeries}
              comparisonMode={comparisonMode}
              contextEvents={contextEvents}
              fundamentals={contextFundamentals}
              marketStatus={contextMarketStatus}
              externalReplayToggleRevision={replayToggleRevision}
              externalReplayCommand={replayCommand}
              viewRangeCommand={viewRangeCommand}
              onRequestCreateAlert={(draft) => {
                setAlertNotice(null);
                setAlertError(null);
                setAlertDraft(draft);
              }}
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
                onCreateAlert={handleIndicatorAlertRequest}
              />
            </div>
          </div>
        )}
        {alertDraft ? (
          <div
            className="absolute inset-x-2 top-12 z-30 md:left-1/2 md:max-w-xl md:-translate-x-1/2"
            onClick={(event) => event.stopPropagation()}
          >
            <ChartAlertComposer
              draft={alertDraft}
              submitting={alertSubmitting}
              error={alertError}
              onCancel={() => {
                if (alertSubmitting) return;
                setAlertError(null);
                setAlertDraft(null);
              }}
              onSubmit={(payload) => {
                void handleSubmitAlert(payload);
              }}
            />
          </div>
        ) : null}
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
                onClick={() => {
                  setShowDrawingTools(false);
                  setDrawMode("none");
                  setPendingTrendPoint(false);
                }}
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
