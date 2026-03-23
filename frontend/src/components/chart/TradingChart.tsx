import { Fragment, startTransition, useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  PriceScaleMode,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  createChart,
  type IPriceLine,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  createChartDrawing,
  deleteChartDrawing,
  listChartDrawings,
  updateChartDrawing,
} from "../../api/client";

import type { ChartPoint, CorporateEvent, IndicatorResponse, PitFundamentalsResponse } from "../../types";
import type { DrawMode } from "./DrawingTools";
import { terminalChartTheme } from "../../shared/chart/chartTheme";
import { useIndicators } from "../../shared/chart/useIndicators";
import type { IndicatorConfig } from "../../shared/chart/types";
import {
  REPLAY_SPEEDS,
  findReplayIndexForDate,
  findReplaySessionIndex,
  nextReplayIndex,
  previousReplayIndex,
  replayDateInputValue,
  replaySlice,
  replaySpeedToMs,
  type ReplayCommand,
  type ReplaySpeed,
} from "../../shared/chart/replay";
import {
  buildEnhancedCandle,
  buildEnhancedVolumeBar,
} from "../../shared/chart/candlePresentation";
import { canApplyTailUpdate } from "../../shared/chart/chartUtils";
import { terminalColors, terminalOverlayPalette } from "../../theme/terminal";
import type { Bar } from "oakscriptjs";
import { useQuotesStore, useQuotesStream, type QuoteTick } from "../../realtime/useQuotesStream";
import { buildComparisonPoints, type ComparisonMode } from "../../shared/chart/comparison";
import {
  buildContextOverlayMarkers,
  describeMarketState,
  describeSessionState,
  pickFundamentalContext,
  type ContextOverlayMarker,
  type ContextOverlayTone,
} from "../../shared/chart/contextOverlays";
import {
  buildChartExportFilename,
  exportChartCsv,
  exportChartPng,
} from "../../shared/chart/ChartExport";
import {
  TRADING_SESSION_SHADE_PALETTE,
  buildCorePriceSeriesPayload,
  buildCorePriceSeriesUpdate,
  hasVisibleSessionShading,
} from "../../shared/chart/rendererCore";
import { createRafBatcher } from "../../shared/chart/rafBatcher";

import type {
  ExtendedHoursConfig,
  PreMarketLevelConfig,
} from "../../store/chartWorkstationStore";
import { calculatePreMarketLevels, drawPreMarketLevels } from "./PreMarketLevels";
import { useCrosshairSync } from "../../contexts/CrosshairSyncContext";
import {
  DRAWING_HANDLE_FALLBACK_X,
  applyDrawingHandleDrag,
  buildDrawingSyncPlan,
  buildRemoteDrawingPayload,
  createDrawing,
  findDrawingHit,
  getDrawingHandles,
  listDrawingTools,
  moveDrawingLayer,
  normalizeRemoteDrawingRecord,
  normalizeStoredDrawingCollection,
  serializeDrawingCollection,
  snapDrawingPoint,
  sortDrawingsByOrder,
  toggleDrawingLocked,
  toggleDrawingVisibility,
  updateDrawingStyle,
  type DrawingPoint,
  type DrawingStyle,
  type DrawingToolMeta,
  type DrawingToolType,
  type NormalizedChartDrawing,
} from "../../shared/chart/drawingEngine";
import {
  DRAWING_TEMPLATE_STORAGE_KEY,
  applyDrawingTemplate,
  createDrawingTemplateFromDrawing,
  deleteDrawingTemplate,
  normalizeStoredDrawingTemplates,
  resolvePreferredTemplate,
  templatesForDrawingTool,
  toggleDrawingTemplateFavorite,
  upsertDrawingTemplate,
  type DrawingTemplateRecord,
} from "../../shared/chart/drawingTemplates";
import {
  buildDrawingAlertDraft,
  buildPriceAlertDraft,
  chartPointToAlertCandle,
  isDrawingAlertSupported,
  type ChartAlertDraft,
} from "../../shared/chart/chartAlerts";
import { DrawingObjectTree } from "./DrawingObjectTree";

type ChartMode = "candles" | "line" | "area";

type CandlePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session?: string;
  isExtended?: boolean;
};

type PriceScalePlacement = "left" | "right";
type PriceScaleTransform = "normal" | "logarithmic" | "percentage" | "indexedTo100";

type ChartSurfaceSettings = {
  legendVisible: boolean;
  statusLineVisible: boolean;
  dataWindowVisible: boolean;
  priceScalePlacement: PriceScalePlacement;
  priceScaleTransform: PriceScaleTransform;
  sessionOverlayVisible: boolean;
  eventOverlayVisible: boolean;
  actionOverlayVisible: boolean;
  marketStatusVisible: boolean;
  fundamentalsVisible: boolean;
};

type InspectorRow = {
  id: string;
  label: string;
  value: string;
  color?: string;
};

const DEFAULT_SURFACE_SETTINGS: ChartSurfaceSettings = {
  legendVisible: true,
  statusLineVisible: true,
  dataWindowVisible: false,
  priceScalePlacement: "right",
  priceScaleTransform: "normal",
  sessionOverlayVisible: true,
  eventOverlayVisible: true,
  actionOverlayVisible: true,
  marketStatusVisible: true,
  fundamentalsVisible: true,
};

const SCALE_TRANSFORM_LABELS: Record<PriceScaleTransform, string> = {
  normal: "Linear",
  logarithmic: "Log",
  percentage: "Percent",
  indexedTo100: "Index 100",
};

const DRAWING_TOOL_MAP = Object.fromEntries(
  listDrawingTools().map((tool) => [tool.type, tool]),
) as Record<DrawingToolType, DrawingToolMeta>;

function resolvePriceScaleMode(transform: PriceScaleTransform): PriceScaleMode {
  if (transform === "logarithmic") return PriceScaleMode.Logarithmic;
  if (transform === "percentage") return PriceScaleMode.Percentage;
  if (transform === "indexedTo100") return PriceScaleMode.IndexedTo100;
  return PriceScaleMode.Normal;
}

function getChartSurfaceStorageKey(
  ticker: string,
  timeframe: string | undefined,
  drawingWorkspaceId: string,
  panelId?: string,
): string {
  const scopedId =
    panelId ||
    (drawingWorkspaceId && drawingWorkspaceId !== "default-workspace"
      ? drawingWorkspaceId
      : `${ticker.toUpperCase()}:${timeframe ?? "1D"}`);
  return `lts:chart-surfaces:${scopedId}`;
}

function parseChartSurfaceSettings(
  raw: string | null,
  logarithmic: boolean,
): ChartSurfaceSettings {
  const base: ChartSurfaceSettings = {
    ...DEFAULT_SURFACE_SETTINGS,
    priceScaleTransform: logarithmic ? "logarithmic" : DEFAULT_SURFACE_SETTINGS.priceScaleTransform,
  };
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<ChartSurfaceSettings>;
    return {
      legendVisible: typeof parsed.legendVisible === "boolean" ? parsed.legendVisible : base.legendVisible,
      statusLineVisible: typeof parsed.statusLineVisible === "boolean" ? parsed.statusLineVisible : base.statusLineVisible,
      dataWindowVisible: typeof parsed.dataWindowVisible === "boolean" ? parsed.dataWindowVisible : base.dataWindowVisible,
      priceScalePlacement:
        parsed.priceScalePlacement === "left" || parsed.priceScalePlacement === "right"
          ? parsed.priceScalePlacement
          : base.priceScalePlacement,
      priceScaleTransform:
        parsed.priceScaleTransform === "normal" ||
        parsed.priceScaleTransform === "logarithmic" ||
        parsed.priceScaleTransform === "percentage" ||
        parsed.priceScaleTransform === "indexedTo100"
          ? parsed.priceScaleTransform
          : base.priceScaleTransform,
      sessionOverlayVisible:
        typeof parsed.sessionOverlayVisible === "boolean"
          ? parsed.sessionOverlayVisible
          : base.sessionOverlayVisible,
      eventOverlayVisible:
        typeof parsed.eventOverlayVisible === "boolean"
          ? parsed.eventOverlayVisible
          : base.eventOverlayVisible,
      actionOverlayVisible:
        typeof parsed.actionOverlayVisible === "boolean"
          ? parsed.actionOverlayVisible
          : base.actionOverlayVisible,
      marketStatusVisible:
        typeof parsed.marketStatusVisible === "boolean"
          ? parsed.marketStatusVisible
          : base.marketStatusVisible,
      fundamentalsVisible:
        typeof parsed.fundamentalsVisible === "boolean"
          ? parsed.fundamentalsVisible
          : base.fundamentalsVisible,
    };
  } catch {
    return base;
  }
}

function formatPriceValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(Math.abs(value) >= 1000 ? 1 : 2);
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatVolumeValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString();
}

function formatInspectorTime(time: number | null): string {
  if (typeof time !== "number" || !Number.isFinite(time)) return "-";
  return new Date(time * 1000).toLocaleString();
}

function overlayToneClass(tone: ContextOverlayTone): string {
  if (tone === "positive") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (tone === "negative") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (tone === "warning") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (tone === "info") return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  return "border-terminal-border bg-terminal-bg/80 text-terminal-text";
}

function labelizeOverlayKey(indicator: string, key: string): string {
  if (key === "value") return indicator.toUpperCase();
  return `${indicator.toUpperCase()}.${key.toUpperCase()}`;
}

function findPointAtOrBefore<T extends { t: number }>(points: T[], targetTime: number | null): T | null {
  if (!points.length) return null;
  if (targetTime === null) return points[points.length - 1] ?? null;
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const pointTime = Number(points[mid]?.t);
    if (!Number.isFinite(pointTime)) {
      hi = mid - 1;
      continue;
    }
    if (pointTime <= targetTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? points[best] ?? null : null;
}

function findComparisonPointAtOrBefore(
  points: Array<{ time: Time; value: number }>,
  targetTime: number | null,
): { time: Time; value: number } | null {
  if (!points.length) return null;
  if (targetTime === null) return points[points.length - 1] ?? null;
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const pointTime = typeof points[mid]?.time === "number" ? Number(points[mid]?.time) : NaN;
    if (!Number.isFinite(pointTime)) {
      hi = mid - 1;
      continue;
    }
    if (pointTime <= targetTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? points[best] ?? null : null;
}

function getDrawingLineWidth(drawing: NormalizedChartDrawing): 1 | 2 | 3 | 4 {
  return drawing.style.lineWidth;
}

function getDrawingColor(drawing: NormalizedChartDrawing): string {
  return drawing.style.color;
}

function resolveChartLineStyle(lineStyle: DrawingStyle["lineStyle"]): 0 | 2 {
  return lineStyle === "dashed" ? 2 : 0;
}

function getPrimaryDrawingAnchor(drawing: NormalizedChartDrawing): DrawingPoint | null {
  return drawing.anchors[0] ?? null;
}

function getTwoAnchorDrawingAnchors(drawing: NormalizedChartDrawing): [DrawingPoint, DrawingPoint] | null {
  if (drawing.anchors.length !== 2) return null;
  const [first, second] = drawing.anchors;
  return [first, second];
}

function getProjectedRayEndpoint(anchors: [DrawingPoint, DrawingPoint], candles: CandlePoint[]): DrawingPoint {
  const [start, end] = anchors;
  const lastTime = candles[candles.length - 1]?.time ?? end.time;
  const extension = Math.max(Math.abs(end.time - start.time) * 6, lastTime - end.time, 300);
  const safeSpan = end.time - start.time || 1;
  const slope = (end.price - start.price) / safeSpan;
  return {
    time: end.time + extension,
    price: end.price + slope * extension,
  };
}

function getVisiblePriceBounds(candles: CandlePoint[]): { low: number; high: number } | null {
  if (!candles.length) return null;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    low = Math.min(low, candle.low);
    high = Math.max(high, candle.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (low === high) {
    return { low: low - 1, high: high + 1 };
  }
  return { low, high };
}

function rangePresetDays(presetId: string | null | undefined): number {
  if (presetId === "1D") return 1;
  if (presetId === "5D") return 5;
  if (presetId === "1W") return 7;
  if (presetId === "1M") return 30;
  if (presetId === "3M") return 90;
  if (presetId === "6M") return 180;
  if (presetId === "1Y") return 365;
  return 0;
}

function navigationWindowSeconds(timeframe: string | undefined): number {
  if (timeframe === "1m") return 8 * 3600;
  if (timeframe === "5m") return 3 * 86400;
  if (timeframe === "15m") return 7 * 86400;
  if (timeframe === "1h") return 30 * 86400;
  if (timeframe === "1D") return 180 * 86400;
  if (timeframe === "1W") return 720 * 86400;
  return 365 * 86400;
}

function candlePointFromReplayBar(point: CandlePoint): CandlePoint {
  return {
    time: point.time,
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volume,
    session: point.session,
    isExtended: point.isExtended,
  };
}

type Props = {
  ticker: string;
  data: ChartPoint[];
  mode: ChartMode;
  timeframe?: string;
  overlays?: Record<string, IndicatorResponse | undefined>;
  indicatorConfigs?: IndicatorConfig[];
  showVolume?: boolean;
  showHighLow?: boolean;
  logarithmic?: boolean;
  drawMode?: DrawMode;
  clearDrawingsSignal?: number;
  onPendingTrendPointChange?: (pending: boolean) => void;
  drawingWorkspaceId?: string;
  extendedHours?: ExtendedHoursConfig;
  preMarketLevels?: PreMarketLevelConfig;
  market?: "US" | "IN";
  panelId?: string;
  crosshairSyncGroupId?: string | null;
  comparisonSeries?: Array<{ symbol: string; data: ChartPoint[]; color?: string }>;
  comparisonMode?: ComparisonMode;
  contextEvents?: CorporateEvent[];
  fundamentals?: PitFundamentalsResponse | null;
  marketStatus?: Record<string, unknown> | null;
  externalReplayToggleRevision?: number;
  externalReplayCommand?: ReplayCommand;
  viewRangeCommand?: {
    presetId: string;
    revision: number;
  };
  onRequestCreateAlert?: (draft: ChartAlertDraft) => void;
  onAddToPortfolio?: (symbol: string, priceHint?: number) => void;
};

export function TradingChart({
  ticker,
  data,
  mode,
  timeframe,
  overlays = {},
  indicatorConfigs = [],
  showVolume = true,
  showHighLow = true,
  logarithmic = false,
  drawMode = "none",
  clearDrawingsSignal = 0,
  onPendingTrendPointChange,
  drawingWorkspaceId = "default-workspace",
  extendedHours,
  preMarketLevels,
  market = "IN",
  panelId,
  crosshairSyncGroupId = "chart-workstation",
  comparisonSeries = [],
  comparisonMode: comparisonModeProp,
  contextEvents = [],
  fundamentals = null,
  marketStatus = null,
  externalReplayToggleRevision,
  externalReplayCommand,
  viewRangeCommand,
  onRequestCreateAlert,
  onAddToPortfolio,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const preSessionAreaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const postSessionAreaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sessionShadingRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const comparisonSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const highLineRef = useRef<IPriceLine | null>(null);
  const lowLineRef = useRef<IPriceLine | null>(null);
  const pmLevelLinesRef = useRef<Array<IPriceLine>>([]);
  const drawingLineSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const drawingPriceLinesRef = useRef<Array<IPriceLine>>([]);
  const pendingTrendPointRef = useRef<DrawingPoint | null>(null);
  const pendingTrendToolRef = useRef<DrawMode | null>(null);
  const drawModeRef = useRef<DrawMode>("none");
  const modeRef = useRef<ChartMode>("candles");
  const parsedByTimeRef = useRef<Map<number, CandlePoint>>(new Map());
  const pendingTrendCbRef = useRef<((pending: boolean) => void) | undefined>(undefined);
  const selectedRef = useRef<CandlePoint | null>(null);
  const hoveredRef = useRef<CandlePoint | null>(null);
  const [drawings, setDrawings] = useState<NormalizedChartDrawing[]>([]);
  const drawingsRef = useRef<NormalizedChartDrawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [editingColor, setEditingColor] = useState<string>("#4ea1ff");
  const [editingLineWidth, setEditingLineWidth] = useState<number>(2);
  const [editingLineStyle, setEditingLineStyle] = useState<DrawingStyle["lineStyle"]>("solid");
  const [editingFillColor, setEditingFillColor] = useState<string>("#4ea1ff");
  const [editingFillOpacity, setEditingFillOpacity] = useState<number>(16);
  const [drawingPanelTab, setDrawingPanelTab] = useState<"objects" | "templates" | null>(null);
  const [templateDraftName, setTemplateDraftName] = useState("");
  const [drawingTemplates, setDrawingTemplates] = useState<DrawingTemplateRecord[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return normalizeStoredDrawingTemplates(JSON.parse(window.localStorage.getItem(DRAWING_TEMPLATE_STORAGE_KEY) || "[]"));
    } catch {
      return [];
    }
  });
  const drawingTemplatesRef = useRef<DrawingTemplateRecord[]>(drawingTemplates);
  const dragRef = useRef<{ drawingId: string; anchorKey: string } | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<CandlePoint | null>(null);
  const [syncedCandle, setSyncedCandle] = useState<CandlePoint | null>(null);
  const [syncedCrosshairX, setSyncedCrosshairX] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; price: number | null; time: number | null } | null>(null);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>("1x");
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayDateInput, setReplayDateInput] = useState("");
  const externalReplayRevisionRef = useRef<number | undefined>(undefined);
  const externalReplayCommandRef = useRef<string>("");
  const viewRangeCommandKeyRef = useRef<string>("");
  const replayEnabledRef = useRef(replayEnabled);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("normalized");
  const [contextMarkerPositions, setContextMarkerPositions] = useState<{
    events: Array<ContextOverlayMarker & { left: number; lane: number }>;
    actions: Array<ContextOverlayMarker & { left: number; lane: number }>;
  }>({ events: [], actions: [] });
  const effectiveComparisonMode = comparisonModeProp ?? comparisonMode;
  const [indicatorChartApi, setIndicatorChartApi] = useState<IChartApi | null>(null);
  const drawingScope = useMemo(
    () => ({
      timeframe: timeframe ?? "1D",
      workspaceId: drawingWorkspaceId,
    }),
    [timeframe, drawingWorkspaceId],
  );
  const drawingScopeRef = useRef(drawingScope);
  const storageKey = `lts:drawings:${ticker.toUpperCase()}:${timeframe ?? "1D"}:${drawingWorkspaceId}`;
  const surfaceStorageKey = useMemo(
    () => getChartSurfaceStorageKey(ticker, timeframe, drawingWorkspaceId, panelId),
    [ticker, timeframe, drawingWorkspaceId, panelId],
  );
  const [surfaceSettings, setSurfaceSettings] = useState<ChartSurfaceSettings>(() =>
    parseChartSurfaceSettings(
      typeof window === "undefined" ? null : window.localStorage.getItem(surfaceStorageKey),
      logarithmic,
    ),
  );
  const initializedDrawingsRef = useRef(false);
  const skipNextRemoteSyncRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const lastAutoViewportKeyRef = useRef<string>("");
  const lastRenderConfigKeyRef = useRef<string>("");
  const { pos: syncedPos, broadcast, syncEnabled } = useCrosshairSync();
  const useInternalRealtime = !String(crosshairSyncGroupId ?? "").startsWith("chart-workstation");
  const quoteTokenMarket = market === "US" ? "NASDAQ" : market === "IN" ? "NSE" : String(market || "").toUpperCase();
  const externalTick = useQuotesStore((s) => s.ticksByToken[`${quoteTokenMarket}:${ticker.toUpperCase()}`] ?? null);
  const hoveredCandleBatchRef = useRef<ReturnType<typeof createRafBatcher<CandlePoint | null>> | null>(null);
  const syncedCursorBatchRef = useRef<
    ReturnType<typeof createRafBatcher<{ candle: CandlePoint | null; x: number | null }>> | null
  >(null);
  const contextMarkerBatchRef = useRef<
    ReturnType<
      typeof createRafBatcher<{
        events: Array<ContextOverlayMarker & { left: number; lane: number }>;
        actions: Array<ContextOverlayMarker & { left: number; lane: number }>;
      }>
    > | null
  >(null);
  const flushContextMarkersImmediately =
    typeof window !== "undefined" && /jsdom/i.test(window.navigator.userAgent);

  if (!hoveredCandleBatchRef.current) {
    hoveredCandleBatchRef.current = createRafBatcher<CandlePoint | null>((next) => {
      startTransition(() => {
        setSelectedCandle(next);
      });
    });
  }
  if (!syncedCursorBatchRef.current) {
    syncedCursorBatchRef.current = createRafBatcher<{ candle: CandlePoint | null; x: number | null }>((next) => {
      startTransition(() => {
        setSyncedCandle(next.candle);
        setSyncedCrosshairX(next.x);
      });
    });
  }
  if (!contextMarkerBatchRef.current) {
    contextMarkerBatchRef.current = createRafBatcher<{
      events: Array<ContextOverlayMarker & { left: number; lane: number }>;
      actions: Array<ContextOverlayMarker & { left: number; lane: number }>;
    }>((next) => {
      startTransition(() => {
        setContextMarkerPositions(next);
      });
    });
  }

  const applyRealtimeTick = useCallback((tick: QuoteTick) => {
    if (tick.symbol !== ticker) return;
    if (!candleRef.current || !volumeRef.current) return;

    const intervalSec =
      timeframe === "1m" ? 60 :
      timeframe === "5m" ? 300 :
      timeframe === "15m" ? 900 :
      timeframe === "1h" ? 3600 :
      timeframe === "1d" ? 86400 : 0;

    if (intervalSec === 0) return;

    const tickTime = Math.floor(new Date(tick.ts).getTime() / 1000);
    const barTime = Math.floor(tickTime / intervalSec) * intervalSec;

    // Update or add bar
    const lastBar = lastParsedRef.current[lastParsedRef.current.length - 1];
    const isNewBar = !lastBar || barTime > lastBar.time;

    let updatedBar: any;
    let prevClose: number | null = null;
    const prevBar = lastParsedRef.current[lastParsedRef.current.length - 2];
    if (isNewBar) {
      updatedBar = {
        time: barTime as UTCTimestamp,
        open: tick.ltp,
        high: tick.ltp,
        low: tick.ltp,
        close: tick.ltp
      };
      prevClose = lastBar ? Number(lastBar.close) : null;
    } else {
      updatedBar = {
        time: lastBar.time as UTCTimestamp,
        open: lastBar.open,
        high: Math.max(lastBar.high, tick.ltp),
        low: Math.min(lastBar.low, tick.ltp),
        close: tick.ltp
      };
      prevClose = prevBar ? Number(prevBar.close) : null;
    }

    const volumeValue = isNewBar
      ? Number(tick.volume || 0)
      : (Number(lastBar.volume || 0) + Number(tick.volume || 0));

    const enhancedCandle = buildEnhancedCandle(
      {
        time: barTime,
        open: Number(updatedBar.open),
        high: Number(updatedBar.high),
        low: Number(updatedBar.low),
        close: Number(updatedBar.close),
        volume: volumeValue,
        session: isNewBar ? "rth" : lastBar.session,
        isExtended: isNewBar ? false : lastBar.isExtended,
      },
      prevClose,
      { up: terminalColors.candleUp, down: terminalColors.candleDown },
      extendedHours,
    );
    const enhancedVolume = buildEnhancedVolumeBar(
      {
        time: barTime,
        open: Number(updatedBar.open),
        high: Number(updatedBar.high),
        low: Number(updatedBar.low),
        close: Number(updatedBar.close),
        volume: volumeValue,
        session: isNewBar ? "rth" : lastBar.session,
        isExtended: isNewBar ? false : lastBar.isExtended,
      },
      prevClose,
      { up: terminalColors.candleUp, down: terminalColors.candleDown },
      extendedHours,
    );

    candleRef.current.update(enhancedCandle as any);
    lineRef.current?.update({ time: barTime as UTCTimestamp, value: Number(updatedBar.close) });
    areaRef.current?.update({ time: barTime as UTCTimestamp, value: Number(updatedBar.close) });
    volumeRef.current.update(enhancedVolume);

    if (isNewBar) {
      lastParsedRef.current.push({
        time: barTime,
        open: updatedBar.open,
        high: updatedBar.high,
        low: updatedBar.low,
        close: updatedBar.close,
        volume: Number(tick.volume || 0)
      });
    } else {
      lastParsedRef.current[lastParsedRef.current.length - 1] = {
        ...lastBar,
        high: updatedBar.high,
        low: updatedBar.low,
        close: updatedBar.close,
        volume: volumeValue
      };
    }
    parsedByTimeRef.current.set(barTime, {
      ...(lastParsedRef.current[lastParsedRef.current.length - 1] as CandlePoint),
    });
  }, [ticker, timeframe, extendedHours]);

  const handleTick = useCallback((tick: QuoteTick) => {
    if (!useInternalRealtime) return;
    applyRealtimeTick(tick);
  }, [applyRealtimeTick, useInternalRealtime]);

  const { subscribe } = useQuotesStream(market || "IN", handleTick);

  useEffect(() => {
    if (!useInternalRealtime) return;
    subscribe([ticker]);
  }, [ticker, subscribe, useInternalRealtime]);

  useEffect(() => {
    if (useInternalRealtime) return;
    if (!externalTick) return;
    applyRealtimeTick(externalTick);
  }, [applyRealtimeTick, externalTick, useInternalRealtime, indicatorChartApi]);

  const parsed = useMemo(
    () =>
      data.map((d) => ({
        time: d.t as UTCTimestamp,
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c,
        volume: d.v,
        session: (d as any).s || "rth",
        isExtended: !!(d as any).ext,
      }))
      .filter(
        (d) =>
          Number.isFinite(Number(d.time)) &&
          Number.isFinite(Number(d.open)) &&
          Number.isFinite(Number(d.high)) &&
          Number.isFinite(Number(d.low)) &&
          Number.isFinite(Number(d.close)),
      )
      .sort((a, b) => Number(a.time) - Number(b.time)),
    [data]
  );
  const replayParsed = useMemo(
    () => replaySlice(parsed, replayEnabled, replayIndex),
    [parsed, replayEnabled, replayIndex],
  );
  const exportableChartData = useMemo(
    () =>
      replayParsed.map((point) => ({
        t: Number(point.time),
        o: point.open,
        h: point.high,
        l: point.low,
        c: point.close,
        v: point.volume,
      })),
    [replayParsed],
  );
  const parsedByTime = useMemo(() => {
    const m = new Map<number, CandlePoint>();
    for (const p of replayParsed) {
      m.set(Number(p.time), {
        time: Number(p.time),
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume,
        session: p.session,
        isExtended: p.isExtended,
      });
    }
    return m;
  }, [replayParsed]);
  const indicatorBars = useMemo<Bar[]>(
    () =>
      replayParsed.map((p) => ({
        time: Number(p.time),
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: Number.isFinite(Number(p.volume)) ? Number(p.volume) : 0,
      })),
    [replayParsed],
  );
  const mainPriceScaleId = surfaceSettings.priceScalePlacement === "left" ? "left" : "right";
  useIndicators(indicatorChartApi, indicatorBars, indicatorConfigs, {
    nonOverlayPaneStartIndex: 1,
    mainPriceScaleId,
  });
  const showSessionLegend = useMemo(
    () => surfaceSettings.sessionOverlayVisible && hasVisibleSessionShading(replayParsed, extendedHours),
    [replayParsed, extendedHours, surfaceSettings.sessionOverlayVisible],
  );
  const compareNormalizedActive = comparisonSeries.length > 0 && effectiveComparisonMode === "normalized";
  const resolvedScaleTransform: PriceScaleTransform = compareNormalizedActive
    ? "percentage"
    : surfaceSettings.priceScaleTransform;
  const resolvedPriceScaleMode = useMemo(
    () => resolvePriceScaleMode(resolvedScaleTransform),
    [resolvedScaleTransform],
  );
  const handleExportPng = useCallback(() => {
    if (!apiRef.current) return;
    exportChartPng(apiRef.current, buildChartExportFilename(ticker, timeframe, "png"));
  }, [ticker, timeframe]);
  const handleExportCsv = useCallback(() => {
    exportChartCsv(exportableChartData, buildChartExportFilename(ticker, timeframe, "csv"));
  }, [exportableChartData, ticker, timeframe]);

  const applyHistoricalViewport = useCallback((targetTime: number) => {
    const chart = apiRef.current;
    const firstTime = Number(parsed[0]?.time);
    const lastTime = Number(parsed[parsed.length - 1]?.time);
    if (!chart || !Number.isFinite(targetTime) || !Number.isFinite(firstTime) || !Number.isFinite(lastTime)) {
      return;
    }
    const halfWindow = Math.floor(navigationWindowSeconds(timeframe) / 2);
    chart.timeScale().setVisibleRange({
      from: Math.max(firstTime, targetTime - halfWindow) as UTCTimestamp,
      to: Math.min(lastTime, targetTime + halfWindow) as UTCTimestamp,
    });
  }, [parsed, timeframe]);

  const handleGoToReplayDate = useCallback((date: string, forceReplay: boolean) => {
    if (!date || !parsed.length) return false;
    const targetIndex = findReplayIndexForDate(parsed, date, {
      extendedHours,
      prefer: "last",
    });
    if (targetIndex < 0) return false;
    const targetBar = parsed[targetIndex];
    setReplayPlaying(false);
    setReplayDateInput(date);
    if (forceReplay || replayEnabledRef.current) {
      setReplayEnabled(true);
      setReplayIndex(targetIndex);
    } else {
      applyHistoricalViewport(Number(targetBar.time));
      setSelectedCandle(candlePointFromReplayBar(targetBar));
    }
    return true;
  }, [applyHistoricalViewport, extendedHours, parsed]);

  const dispatchReplayCommand = useCallback((command: ReplayCommand) => {
    if (!parsed.length) return;
    if (command.type === "toggle") {
      setReplayEnabled((prev) => {
        const next = !prev;
        if (next) {
          setReplayIndex(0);
          setReplayDateInput(replayDateInputValue(parsed[0]?.time ?? null));
        } else {
          setReplayPlaying(false);
          setReplayDateInput(replayDateInputValue(parsed[parsed.length - 1]?.time ?? null));
        }
        return next;
      });
      setReplayPlaying(false);
      return;
    }
    if (command.type === "playPause") {
      if (!replayEnabledRef.current) {
        setReplayEnabled(true);
        setReplayIndex(0);
        setReplayDateInput(replayDateInputValue(parsed[0]?.time ?? null));
        setReplayPlaying(true);
        return;
      }
      setReplayPlaying((prev) => !prev);
      return;
    }
    if (command.type === "stepForward") {
      setReplayEnabled(true);
      setReplayPlaying(false);
      setReplayIndex((prev) => {
        const next = nextReplayIndex(replayEnabledRef.current ? prev : 0, parsed.length, 1);
        setReplayDateInput(replayDateInputValue(parsed[next]?.time ?? null));
        return next;
      });
      return;
    }
    if (command.type === "stepBack") {
      setReplayEnabled(true);
      setReplayPlaying(false);
      setReplayIndex((prev) => {
        const next = previousReplayIndex(replayEnabledRef.current ? prev : parsed.length - 1, parsed.length, 1);
        setReplayDateInput(replayDateInputValue(parsed[next]?.time ?? null));
        return next;
      });
      return;
    }
    if (command.type === "reset") {
      setReplayEnabled(true);
      setReplayPlaying(false);
      setReplayIndex(0);
      setReplayDateInput(replayDateInputValue(parsed[0]?.time ?? null));
      return;
    }
    if (command.type === "prevSession") {
      setReplayEnabled(true);
      setReplayPlaying(false);
      setReplayIndex((prev) => {
        const current = replayEnabledRef.current ? prev : parsed.length - 1;
        const next = findReplaySessionIndex(parsed, current, -1, { extendedHours });
        const resolved = next >= 0 ? next : current;
        setReplayDateInput(replayDateInputValue(parsed[resolved]?.time ?? null));
        return resolved;
      });
      return;
    }
    if (command.type === "nextSession") {
      setReplayEnabled(true);
      setReplayPlaying(false);
      setReplayIndex((prev) => {
        const current = replayEnabledRef.current ? prev : 0;
        const next = findReplaySessionIndex(parsed, current, 1, { extendedHours });
        const resolved = next >= 0 ? next : current;
        setReplayDateInput(replayDateInputValue(parsed[resolved]?.time ?? null));
        return resolved;
      });
      return;
    }
    if (command.type === "goToDate") {
      void handleGoToReplayDate(command.date ?? replayDateInput, replayEnabledRef.current);
    }
  }, [extendedHours, handleGoToReplayDate, parsed, replayDateInput]);

  const toUnixTime = (t: Time | undefined): number | null => {
    if (!t) return null;
    if (typeof t === "number") return t;
    if (typeof t === "object" && t !== null && "year" in t && "month" in t && "day" in t) {
      const d = new Date(Date.UTC(t.year, t.month - 1, t.day, 0, 0, 0));
      return Math.floor(d.getTime() / 1000);
    }
    return null;
  };

  const clearPendingTrendPoint = useCallback(() => {
    pendingTrendPointRef.current = null;
    pendingTrendToolRef.current = null;
    pendingTrendCbRef.current?.(false);
  }, []);

  useEffect(() => {
    if (pendingTrendToolRef.current && pendingTrendToolRef.current !== drawMode) {
      clearPendingTrendPoint();
    }
    drawModeRef.current = drawMode;
  }, [clearPendingTrendPoint, drawMode]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    drawingScopeRef.current = drawingScope;
  }, [drawingScope]);
  useEffect(
    () => () => {
      hoveredCandleBatchRef.current?.cancel();
      syncedCursorBatchRef.current?.cancel();
      contextMarkerBatchRef.current?.cancel();
    },
    [],
  );
  useEffect(() => {
    parsedByTimeRef.current = parsedByTime;
  }, [parsedByTime]);
  useEffect(() => {
    replayEnabledRef.current = replayEnabled;
  }, [replayEnabled]);
  useEffect(() => {
    if (!parsed.length) {
      setReplayDateInput("");
      return;
    }
    const fallbackIndex = replayEnabled ? replayIndex : parsed.length - 1;
    const fallbackDate = replayDateInputValue(parsed[fallbackIndex]?.time ?? null);
    if (!fallbackDate) return;
    setReplayDateInput((prev) => prev || fallbackDate);
  }, [parsed, replayEnabled, replayIndex]);

  useEffect(() => {
    if (!replayParsed.length) {
      setReplayIndex(0);
      setReplayPlaying(false);
      return;
    }
    if (!replayEnabled) {
      setReplayIndex(parsed.length - 1);
      setReplayPlaying(false);
      return;
    }
    setReplayIndex((prev) => Math.max(0, Math.min(prev, parsed.length - 1)));
  }, [parsed, replayEnabled]);

  useEffect(() => {
    if (!replayEnabled || !replayPlaying) return;
    const timer = window.setInterval(() => {
      setReplayIndex((prev) => {
        const next = nextReplayIndex(prev, parsed.length, 1);
        if (next >= parsed.length - 1) {
          setReplayPlaying(false);
        }
        return next;
      });
    }, replaySpeedToMs(replaySpeed));
    return () => window.clearInterval(timer);
  }, [parsed.length, replayEnabled, replayPlaying, replaySpeed]);

  useEffect(() => {
    if (!externalReplayToggleRevision) return;
    if (externalReplayRevisionRef.current === externalReplayToggleRevision) return;
    externalReplayRevisionRef.current = externalReplayToggleRevision;
    dispatchReplayCommand({
      type: "toggle",
      revision: externalReplayToggleRevision,
    });
  }, [dispatchReplayCommand, externalReplayToggleRevision]);

  useEffect(() => {
    if (!externalReplayCommand) return;
    const key = `${externalReplayCommand.type}:${externalReplayCommand.revision}:${externalReplayCommand.date ?? ""}`;
    if (externalReplayCommandRef.current === key) return;
    externalReplayCommandRef.current = key;
    dispatchReplayCommand(externalReplayCommand);
  }, [dispatchReplayCommand, externalReplayCommand]);

  useEffect(() => {
    const chart = apiRef.current;
    const firstTime = parsed[0]?.time;
    const lastTime = parsed[parsed.length - 1]?.time;
    if (!chart || !viewRangeCommand || typeof firstTime !== "number" || typeof lastTime !== "number") return;
    const key = `${viewRangeCommand.presetId}:${viewRangeCommand.revision}:${firstTime}:${lastTime}`;
    if (viewRangeCommandKeyRef.current === key) return;
    viewRangeCommandKeyRef.current = key;
    const days = rangePresetDays(viewRangeCommand.presetId);
    if (days <= 0) {
      chart.timeScale().fitContent();
      return;
    }
    const from = Math.max(firstTime, lastTime - (days * 86400));
    chart.timeScale().setVisibleRange({
      from: from as UTCTimestamp,
      to: lastTime as UTCTimestamp,
    });
  }, [parsed, viewRangeCommand]);

  useEffect(() => {
    pendingTrendCbRef.current = onPendingTrendPointChange;
  }, [onPendingTrendPointChange]);

  useEffect(() => {
    let cancelled = false;
    setSelectedDrawingId(null);
    const loadRemoteOrLocal = async () => {
      try {
        const items = await listChartDrawings(ticker.toUpperCase(), {
          timeframe: drawingScope.timeframe,
          workspaceId: drawingScope.workspaceId,
        });
        if (!cancelled && Array.isArray(items) && items.length > 0) {
          const mapped = items
            .map((row) => normalizeRemoteDrawingRecord(row, drawingScope))
            .filter((drawing): drawing is NormalizedChartDrawing => drawing !== null);
          skipNextRemoteSyncRef.current = true;
          setDrawings(sortDrawingsByOrder(mapped));
          initializedDrawingsRef.current = true;
          return;
        }
      } catch {
        // Fall back to local storage for this load, but keep future remote retries enabled.
      }
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
          setDrawings([]);
          initializedDrawingsRef.current = true;
          return;
        }
        setDrawings(normalizeStoredDrawingCollection(JSON.parse(raw), drawingScope));
      } catch {
        setDrawings([]);
      } finally {
        initializedDrawingsRef.current = true;
      }
    };
    void loadRemoteOrLocal();
    clearPendingTrendPoint();
    return () => {
      cancelled = true;
    };
  }, [clearPendingTrendPoint, drawingScope, storageKey, ticker]);

  useEffect(() => {
    if (!initializedDrawingsRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(serializeDrawingCollection(drawings)));
    } catch {
      // ignore storage errors
    }
  }, [drawings, storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAWING_TEMPLATE_STORAGE_KEY, JSON.stringify(drawingTemplates));
    } catch {
      // ignore storage errors
    }
  }, [drawingTemplates]);

  useEffect(() => {
    drawingTemplatesRef.current = drawingTemplates;
  }, [drawingTemplates]);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    setSurfaceSettings(
      parseChartSurfaceSettings(
        typeof window === "undefined" ? null : window.localStorage.getItem(surfaceStorageKey),
        logarithmic,
      ),
    );
  }, [surfaceStorageKey, logarithmic]);

  useEffect(() => {
    try {
      localStorage.setItem(surfaceStorageKey, JSON.stringify(surfaceSettings));
    } catch {
      // ignore storage errors
    }
  }, [surfaceSettings, surfaceStorageKey]);

  useEffect(() => {
    if (!initializedDrawingsRef.current) return;
    if (skipNextRemoteSyncRef.current) {
      skipNextRemoteSyncRef.current = false;
      return;
    }
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(async () => {
      const symbol = ticker.toUpperCase();
      try {
        const existing = await listChartDrawings(symbol, {
          timeframe: drawingScope.timeframe,
          workspaceId: drawingScope.workspaceId,
        });
        const syncPlan = buildDrawingSyncPlan(drawings, existing, drawingScope);

        if (syncPlan.delete.length) {
          await Promise.all(syncPlan.delete.map((remoteId) => deleteChartDrawing(symbol, remoteId)));
        }
        if (syncPlan.update.length) {
          await Promise.all(
            syncPlan.update.map(({ remoteId, drawing }) =>
              updateChartDrawing(symbol, remoteId, buildRemoteDrawingPayload(drawing)),
            ),
          );
        }
        for (const drawing of syncPlan.create) {
          await createChartDrawing(symbol, buildRemoteDrawingPayload(drawing));
        }
      } catch {
        // Keep retrying on later edits; transient failures should not disable remote persistence.
      }
    }, 550);
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [drawingScope, drawings, ticker]);

  useEffect(() => {
    if (!chartRef.current || apiRef.current) {
      return;
    }
    const chart = createChart(chartRef.current, {
      ...terminalChartTheme,
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight || 520,
      leftPriceScale: {
        borderColor: terminalColors.border,
        visible: mainPriceScaleId === "left",
        mode: resolvedPriceScaleMode,
      },
      rightPriceScale: {
        borderColor: terminalColors.border,
        visible: mainPriceScaleId === "right",
        mode: resolvedPriceScaleMode,
      },
    });
    const candles = chart.addSeries(
      CandlestickSeries,
      {
        upColor: terminalColors.candleUp,
        downColor: terminalColors.candleDown,
        borderVisible: true,
        wickUpColor: terminalColors.candleUp,
        wickDownColor: terminalColors.candleDown,
        visible: mode === "candles",
        priceScaleId: mainPriceScaleId,
      },
      0,
    );
    const line = chart.addSeries(
      LineSeries,
      {
        color: terminalColors.accent,
        lineWidth: 2,
        visible: mode === "line",
        priceScaleId: mainPriceScaleId,
      },
      0,
    );
    const area = chart.addSeries(
      AreaSeries,
      {
        lineColor: terminalColors.accent,
        topColor: terminalColors.accentAreaTop,
        bottomColor: terminalColors.accentAreaBottom,
        visible: mode === "area",
        priceScaleId: mainPriceScaleId,
      },
      0,
    );
    const preSessionArea = chart.addSeries(
      AreaSeries,
      {
        lineColor: "rgba(59, 143, 249, 0.55)",
        topColor: "rgba(59, 143, 249, 0.30)",
        bottomColor: "rgba(59, 143, 249, 0.10)",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        visible: false,
      },
      0,
    );
    const postSessionArea = chart.addSeries(
      AreaSeries,
      {
        lineColor: "rgba(155, 89, 182, 0.55)",
        topColor: "rgba(155, 89, 182, 0.30)",
        bottomColor: "rgba(155, 89, 182, 0.10)",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        visible: false,
      },
      0,
    );
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: "",
        color: terminalColors.accent,
        priceFormat: { type: "volume" },
        visible: showVolume,
      },
      1,
    );
    const sessionShading = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: "",
        visible: true,
        lastValueVisible: false,
        priceLineVisible: false,
      },
      0,
    );
    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0, bottom: 0 },
    });
    chart.panes()[0]?.setStretchFactor(8);
    chart.panes()[1]?.setStretchFactor(2);

    apiRef.current = chart;
    setIndicatorChartApi(chart);
    candleRef.current = candles;
    lineRef.current = line;
    areaRef.current = area;
    preSessionAreaRef.current = preSessionArea;
    postSessionAreaRef.current = postSessionArea;
    volumeRef.current = volume;
    sessionShadingRef.current = sessionShading;

    const extractCandle = (param: MouseEventParams<Time>): CandlePoint | null => {
      const ts = toUnixTime(param.time);
      if (ts === null) return null;
      const fromParsed = parsedByTimeRef.current.get(ts);
      if (fromParsed) return fromParsed;
      const candleData = param.seriesData.get(candles) as
        | { open?: number; high?: number; low?: number; close?: number }
        | undefined;
      if (
        candleData &&
        typeof candleData.open === "number" &&
        typeof candleData.high === "number" &&
        typeof candleData.low === "number" &&
        typeof candleData.close === "number"
      ) {
        return {
          time: ts,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume: 0,
        };
      }
      return null;
    };

    const extractDrawPoint = (param: MouseEventParams<Time>): DrawingPoint | null => {
      const ts = toUnixTime(param.time);
      if (ts === null || !param.point) return null;
      const activeSeries =
        modeRef.current === "line"
          ? line
          : modeRef.current === "area"
          ? area
          : candles;
      const price = activeSeries.coordinateToPrice(param.point.y);
      if (typeof price !== "number" || !Number.isFinite(price)) return null;
      return { time: ts, price };
    };

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (selectedRef.current) {
        return;
      }
      const next = extractCandle(param);
      hoveredRef.current = next;
      hoveredCandleBatchRef.current?.schedule(next);
      if (syncEnabled && panelId) {
        const ts = next ? next.time : null;
        broadcast(panelId, ts, crosshairSyncGroupId);
      }
    };

    const onClick = (param: MouseEventParams<Time>) => {
      const nextDraw = extractDrawPoint(param);
      const next = extractCandle(param);
      if (drawModeRef.current === "none" && nextDraw) {
        const drawingHit = param.point
          ? findDrawingHit(drawingsRef.current, param.point, {
              timeToX: (time) => chart.timeScale().timeToCoordinate(time as UTCTimestamp),
              priceToY: (price) => candles.priceToCoordinate(price),
              fallbackX: DRAWING_HANDLE_FALLBACK_X,
            })
          : null;
        if (drawingHit) {
          const selectedDrawing = drawingsRef.current.find((drawing) => drawing.id === drawingHit.drawingId) ?? null;
          if (selectedDrawing) {
            setSelectedDrawingId(selectedDrawing.id);
            setEditingColor(getDrawingColor(selectedDrawing));
            setEditingLineWidth(getDrawingLineWidth(selectedDrawing));
            setEditingLineStyle(selectedDrawing.style.lineStyle);
            setEditingFillColor(selectedDrawing.style.fillColor || selectedDrawing.style.color);
            setEditingFillOpacity(selectedDrawing.style.fillOpacity);
          }
          selectedRef.current = null;
          setSelectedCandle(null);
          return;
        }
        setSelectedDrawingId(null);
      }
      if (
        (drawModeRef.current === "trendline" ||
          drawModeRef.current === "ray" ||
          drawModeRef.current === "rectangle") &&
        nextDraw
      ) {
        const clicked = snapDrawingPoint(nextDraw, lastParsedRef.current);
        if (!pendingTrendPointRef.current) {
          pendingTrendPointRef.current = clicked;
          pendingTrendToolRef.current = drawModeRef.current;
          pendingTrendCbRef.current?.(true);
          return;
        }
        const start = pendingTrendPointRef.current;
        clearPendingTrendPoint();
        const toolType = drawModeRef.current;
        const preferredStyle =
          resolvePreferredTemplate(
            drawingTemplatesRef.current,
            toolType,
            DRAWING_TOOL_MAP[toolType].family,
          )?.style ?? {};
        const created = createDrawing(toolType, [start, clicked], drawingScopeRef.current, {
          id: `${toolType}-${Date.now()}`,
          order: drawingsRef.current.length,
          style:
            Object.keys(preferredStyle).length > 0
              ? preferredStyle
              : toolType === "rectangle"
              ? { color: "#7bd389", fillColor: "#7bd389", fillOpacity: 16, lineWidth: 1 }
              : toolType === "ray"
              ? { color: "#ef8354", lineWidth: 2 }
              : { color: terminalColors.drawingTrend, lineWidth: 2 },
        });
        if (created) {
          setDrawings((prev) => sortDrawingsByOrder([...prev, created]));
          setSelectedDrawingId(created.id);
        }
        return;
      }
      if ((drawModeRef.current === "hline" || drawModeRef.current === "vline") && nextDraw) {
        const snapped = snapDrawingPoint(nextDraw, lastParsedRef.current);
        const toolType = drawModeRef.current;
        const preferredStyle =
          resolvePreferredTemplate(
            drawingTemplatesRef.current,
            toolType,
            DRAWING_TOOL_MAP[toolType].family,
          )?.style ?? {};
        const created = createDrawing(toolType, [snapped], drawingScopeRef.current, {
          id: `${toolType}-${Date.now()}`,
          order: drawingsRef.current.length,
          style:
            Object.keys(preferredStyle).length > 0
              ? preferredStyle
              : toolType === "vline"
              ? { color: "#9b8cff", lineWidth: 1, lineStyle: "dashed" }
              : { color: terminalColors.drawingHLine, lineWidth: 1, lineStyle: "dashed" },
        });
        if (created) {
          setDrawings((prev) => sortDrawingsByOrder([...prev, created]));
          setSelectedDrawingId(created.id);
        }
        return;
      }
      if (!next) {
        selectedRef.current = null;
        setSelectedCandle(null);
        return;
      }
      selectedRef.current = next;
      setSelectedCandle(next);
    };

    chart.subscribeCrosshairMove(onCrosshairMove);
    chart.subscribeClick(onClick);

    const resizeBatcher = createRafBatcher<{ width: number; height: number }>(({ width, height }) => {
      chart.applyOptions({ width, height });
    });
    const observer = new ResizeObserver(() => {
      if (chartRef.current) {
        resizeBatcher.schedule({
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight || 520,
        });
      }
    });
    observer.observe(chartRef.current);

    return () => {
      observer.disconnect();
      resizeBatcher.cancel();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      apiRef.current = null;
      setIndicatorChartApi(null);
      candleRef.current = null;
      lineRef.current = null;
      areaRef.current = null;
      preSessionAreaRef.current = null;
      postSessionAreaRef.current = null;
      volumeRef.current = null;
      sessionShadingRef.current = null;
      overlaySeriesRef.current = [];
      for (const series of comparisonSeriesRef.current) {
        chart.removeSeries(series);
      }
      comparisonSeriesRef.current = [];
      highLineRef.current = null;
      lowLineRef.current = null;
      selectedRef.current = null;
      hoveredRef.current = null;
    };
  }, []);

  const lastParsedRef = useRef<CandlePoint[]>([]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !lineRef.current || !areaRef.current || !sessionShadingRef.current) {
      return;
    }
    const previousParsedLength = lastParsedRef.current.length;
    if (!replayParsed.length) {
      candleRef.current.setData([]);
      lineRef.current.setData([]);
      areaRef.current.setData([]);
      preSessionAreaRef.current?.setData([]);
      postSessionAreaRef.current?.setData([]);
      volumeRef.current.setData([]);
      sessionShadingRef.current.setData([]);
      lastParsedRef.current = [];
      lastRenderConfigKeyRef.current = "";
      lastAutoViewportKeyRef.current = "";
      return;
    }
    candleRef.current.applyOptions({ visible: mode === "candles" });
    lineRef.current.applyOptions({ visible: mode === "line" });
    areaRef.current.applyOptions({ visible: mode === "area" });

    const showSessionOverlays = surfaceSettings.sessionOverlayVisible && hasVisibleSessionShading(replayParsed, extendedHours);
    const showAreaSessionHighlight = mode === "area" && showSessionOverlays;
    const renderConfigKey = [
      mode,
      showSessionOverlays ? "shade:1" : "shade:0",
      showAreaSessionHighlight ? "area:1" : "area:0",
      extendedHours?.enabled ? "eth:1" : "eth:0",
      extendedHours?.showPreMarket ? "pre:1" : "pre:0",
      extendedHours?.showAfterHours ? "post:1" : "post:0",
    ].join("|");
    const isIncremental =
      lastRenderConfigKeyRef.current === renderConfigKey &&
      canApplyTailUpdate(lastParsedRef.current, replayParsed);
    preSessionAreaRef.current?.applyOptions({ visible: showAreaSessionHighlight });
    postSessionAreaRef.current?.applyOptions({ visible: showAreaSessionHighlight });
    sessionShadingRef.current.applyOptions({ visible: showSessionOverlays });

    if (isIncremental) {
      const updatePayload = buildCorePriceSeriesUpdate(replayParsed, {
        extendedHours,
        showSessionShading: showSessionOverlays,
        includeSessionAreas: showAreaSessionHighlight,
        shadePalette: TRADING_SESSION_SHADE_PALETTE,
      });
      if (updatePayload) {
        candleRef.current.update(updatePayload.candle);
        lineRef.current.update(updatePayload.closePoint);
        areaRef.current.update(updatePayload.closePoint);
        preSessionAreaRef.current?.update(updatePayload.preSessionAreaPoint as any);
        postSessionAreaRef.current?.update(updatePayload.postSessionAreaPoint as any);
        volumeRef.current.update(updatePayload.volumePoint);
        sessionShadingRef.current.update(updatePayload.sessionShadingPoint);
      }
    } else {
      const payload = buildCorePriceSeriesPayload(replayParsed, {
        extendedHours,
        showSessionShading: showSessionOverlays,
        includeSessionAreas: showAreaSessionHighlight,
        shadePalette: TRADING_SESSION_SHADE_PALETTE,
      });
      candleRef.current.setData(payload.candles);
      lineRef.current.setData(payload.closeLine);
      areaRef.current.setData(payload.closeLine);
      preSessionAreaRef.current?.setData(payload.preSessionArea);
      postSessionAreaRef.current?.setData(payload.postSessionArea);
      volumeRef.current.setData(payload.volume);
      sessionShadingRef.current.setData(payload.sessionShading);
    }

    lastParsedRef.current = replayParsed;
    lastRenderConfigKeyRef.current = renderConfigKey;
    volumeRef.current.applyOptions({ visible: showVolume });

    // PM Levels
    const candles = candleRef.current;
    if (candles) {
        for (const line of pmLevelLinesRef.current) {
            candles.removePriceLine(line);
        }
        pmLevelLinesRef.current = [];

        if (preMarketLevels && extendedHours?.enabled) {
            const levels = calculatePreMarketLevels(replayParsed as any);
            pmLevelLinesRef.current = drawPreMarketLevels(candles, levels, preMarketLevels);
        }
    }

    const timeScale = apiRef.current?.timeScale();
    if (timeScale) {
      const viewportKey = `${ticker}:${timeframe ?? "1D"}:${replayEnabled ? `replay:${replayParsed.length}` : "live"}`;
      const shouldAutoViewport =
        replayEnabled ||
        lastAutoViewportKeyRef.current !== viewportKey ||
        previousParsedLength === 0;
      const intradayWindowBars =
        timeframe === "1m"
          ? 390
          : timeframe === "5m"
            ? 390
            : timeframe === "15m"
              ? 260
              : timeframe === "1h"
                ? 180
                : null;
      if (shouldAutoViewport) {
        if (intradayWindowBars && replayParsed.length > intradayWindowBars) {
          timeScale.setVisibleLogicalRange({
            from: Math.max(0, replayParsed.length - intradayWindowBars - 1),
            to: replayParsed.length + 2,
          });
        } else {
          timeScale.fitContent();
        }
        lastAutoViewportKeyRef.current = viewportKey;
      }
    }
  }, [mode, replayParsed, showVolume, extendedHours, preMarketLevels, surfaceSettings.sessionOverlayVisible, timeframe]);

  useEffect(() => {
    if (!apiRef.current) {
      return;
    }
    candleRef.current?.applyOptions({ priceScaleId: mainPriceScaleId });
    lineRef.current?.applyOptions({ priceScaleId: mainPriceScaleId });
    areaRef.current?.applyOptions({ priceScaleId: mainPriceScaleId });
    for (const series of overlaySeriesRef.current) {
      series.applyOptions({ priceScaleId: mainPriceScaleId });
    }
    for (const series of comparisonSeriesRef.current) {
      series.applyOptions({ priceScaleId: mainPriceScaleId });
    }
    for (const series of drawingLineSeriesRef.current) {
      series.applyOptions({ priceScaleId: mainPriceScaleId });
    }
    apiRef.current.applyOptions({
      leftPriceScale: {
        borderColor: terminalColors.border,
        visible: mainPriceScaleId === "left",
        mode: resolvedPriceScaleMode,
      },
      rightPriceScale: {
        borderColor: terminalColors.border,
        visible: mainPriceScaleId === "right",
        mode: resolvedPriceScaleMode,
      },
    });
  }, [mainPriceScaleId, resolvedPriceScaleMode]);

  useEffect(() => {
    const chart = apiRef.current;
    if (!chart) {
      return;
    }
    for (const series of overlaySeriesRef.current) {
      chart.removeSeries(series);
    }
    overlaySeriesRef.current = [];

    const palette = terminalOverlayPalette;
    let colorIdx = 0;

    for (const payload of Object.values(overlays)) {
      if (!payload) {
        continue;
      }
      const keys = new Set<string>();
      for (const point of payload.data) {
        for (const key of Object.keys(point.values)) {
          keys.add(key);
        }
      }
      for (const key of Array.from(keys)) {
        const line = chart.addSeries(LineSeries, {
          color: palette[colorIdx % palette.length],
          lineWidth: key === "middle" ? 2 : 1,
          priceScaleId: mainPriceScaleId,
        });
        colorIdx += 1;
        const lineData = payload.data
          .map((p) => ({ time: p.t as UTCTimestamp, value: p.values[key] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => typeof p.value === "number");
        line.setData(lineData);
        overlaySeriesRef.current.push(line);
      }
    }
  }, [mainPriceScaleId, overlays]);

  useEffect(() => {
    const chart = apiRef.current;
    if (!chart) return;
    for (const s of comparisonSeriesRef.current) {
      chart.removeSeries(s);
    }
    comparisonSeriesRef.current = [];
    if (!comparisonSeries.length) return;

    const palette = [
      "#4EA1FF", // Blue
      "#A0E75A", // Lime
      "#FFB86B", // Orange
      "#D58CFF", // Purple
      "#FF6B6B", // Red
      "#4ECDC4", // Teal
      "#FFE66D", // Yellow
      "#FF9FF3", // Pink
    ];
    comparisonSeries.slice(0, 8).forEach((row, idx) => {
      const points = buildComparisonPoints(row.data || [], effectiveComparisonMode);
      if (!points.length) return;
      const line = chart.addSeries(LineSeries, {
        color: row.color || palette[idx % palette.length],
        lineWidth: 2,
        priceLineVisible: false,
        priceScaleId: mainPriceScaleId,
      });
      line.setData(points);
      comparisonSeriesRef.current.push(line);
    });
  }, [comparisonSeries, effectiveComparisonMode, mainPriceScaleId]);

  useEffect(() => {
    const chart = apiRef.current;
    const candles = candleRef.current;
    if (!chart || !candles) {
      return;
    }

    for (const s of drawingLineSeriesRef.current) {
      chart.removeSeries(s);
    }
    drawingLineSeriesRef.current = [];
    for (const pl of drawingPriceLinesRef.current) {
      candles.removePriceLine(pl);
    }
    drawingPriceLinesRef.current = [];

    const priceBounds = getVisiblePriceBounds(replayParsed);
    const addLineSegment = (drawing: NormalizedChartDrawing, start: DrawingPoint, end: DrawingPoint) => {
      const line = chart.addSeries(LineSeries, {
        color: getDrawingColor(drawing),
        lineWidth: getDrawingLineWidth(drawing),
        lineStyle: resolveChartLineStyle(drawing.style.lineStyle),
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: mainPriceScaleId,
      });
      line.setData([
        { time: start.time as UTCTimestamp, value: start.price },
        { time: end.time as UTCTimestamp, value: end.price },
      ]);
      drawingLineSeriesRef.current.push(line);
    };

    for (const drawing of sortDrawingsByOrder(drawings)) {
      if (!drawing.visible) continue;
      if (drawing.tool.type === "trendline" || drawing.tool.type === "ray") {
        const anchors = getTwoAnchorDrawingAnchors(drawing);
        if (!anchors) continue;
        const [p1, p2] = anchors;
        addLineSegment(
          drawing,
          p1,
          drawing.tool.type === "ray" ? getProjectedRayEndpoint(anchors, replayParsed) : p2,
        );
      } else if (drawing.tool.type === "rectangle") {
        const anchors = getTwoAnchorDrawingAnchors(drawing);
        if (!anchors) continue;
        const [p1, p2] = anchors;
        const left = Math.min(p1.time, p2.time);
        const right = Math.max(p1.time, p2.time);
        const top = Math.max(p1.price, p2.price);
        const bottom = Math.min(p1.price, p2.price);
        addLineSegment(drawing, { time: left, price: top }, { time: right, price: top });
        addLineSegment(drawing, { time: right, price: top }, { time: right, price: bottom });
        addLineSegment(drawing, { time: right, price: bottom }, { time: left, price: bottom });
        addLineSegment(drawing, { time: left, price: bottom }, { time: left, price: top });
      } else if (drawing.tool.type === "hline") {
        const anchor = getPrimaryDrawingAnchor(drawing);
        if (!anchor) continue;
        const pl = candles.createPriceLine({
          price: anchor.price,
          color: getDrawingColor(drawing),
          lineWidth: getDrawingLineWidth(drawing),
          lineStyle: resolveChartLineStyle(drawing.style.lineStyle),
          axisLabelVisible: true,
          title: "HL",
        });
        drawingPriceLinesRef.current.push(pl);
      } else if (drawing.tool.type === "vline" && priceBounds) {
        const anchor = getPrimaryDrawingAnchor(drawing);
        if (!anchor) continue;
        addLineSegment(
          drawing,
          { time: anchor.time, price: priceBounds.low },
          { time: anchor.time, price: priceBounds.high },
        );
      }
    }
  }, [drawings, mainPriceScaleId, replayParsed]);

  useEffect(() => {
    if (!clearDrawingsSignal) {
      return;
    }
    clearPendingTrendPoint();
    setDrawings([]);
    setSelectedDrawingId(null);
    setDrawingPanelTab(null);
  }, [clearDrawingsSignal, clearPendingTrendPoint]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) {
      return;
    }
    if (highLineRef.current) {
      series.removePriceLine(highLineRef.current);
      highLineRef.current = null;
    }
    if (lowLineRef.current) {
      series.removePriceLine(lowLineRef.current);
      lowLineRef.current = null;
    }
    if (!selectedCandle || !showHighLow) {
      return;
    }
    highLineRef.current = series.createPriceLine({
      price: selectedCandle.high,
      color: terminalColors.positive,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "H",
    });
    lowLineRef.current = series.createPriceLine({
      price: selectedCandle.low,
      color: terminalColors.candleDown,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "L",
    });
  }, [selectedCandle, showHighLow]);

  useEffect(() => {
    const chart = apiRef.current;
    if (!chart || !syncEnabled || !panelId) {
      syncedCursorBatchRef.current?.schedule({ candle: null, x: null });
      return;
    }
    if (!syncedPos.time || syncedPos.sourceSlotId === panelId) {
      syncedCursorBatchRef.current?.schedule({ candle: null, x: null });
      return;
    }
    if ((syncedPos.groupId ?? null) !== (crosshairSyncGroupId ?? null)) {
      syncedCursorBatchRef.current?.schedule({ candle: null, x: null });
      return;
    }
    const candle = parsedByTimeRef.current.get(syncedPos.time) ?? null;
    const x = chart.timeScale().timeToCoordinate(syncedPos.time as UTCTimestamp);
    syncedCursorBatchRef.current?.schedule({
      candle,
      x: typeof x === "number" && Number.isFinite(x) ? x : null,
    });
  }, [syncedPos, syncEnabled, panelId, crosshairSyncGroupId]);

  useEffect(() => {
    const chart = apiRef.current;
    if (!chart || !syncEnabled || !panelId) return;
    const recalc = () => {
      if (!syncedPos.time || syncedPos.sourceSlotId === panelId) {
        syncedCursorBatchRef.current?.schedule({ candle: null, x: null });
        return;
      }
      if ((syncedPos.groupId ?? null) !== (crosshairSyncGroupId ?? null)) {
        syncedCursorBatchRef.current?.schedule({ candle: null, x: null });
        return;
      }
      const x = chart.timeScale().timeToCoordinate(syncedPos.time as UTCTimestamp);
      syncedCursorBatchRef.current?.schedule({
        candle: parsedByTimeRef.current.get(syncedPos.time) ?? null,
        x: typeof x === "number" && Number.isFinite(x) ? x : null,
      });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(recalc as never);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(recalc as never);
    };
  }, [syncedPos.time, syncedPos.sourceSlotId, syncedPos.groupId, syncEnabled, panelId, crosshairSyncGroupId]);

  const contextMarkers = useMemo(
    () =>
      buildContextOverlayMarkers(
        contextEvents,
        replayParsed.map((point) => ({
          time: Number(point.time),
          session: point.session,
        })),
      ),
    [contextEvents, replayParsed],
  );

  useEffect(() => {
    const chart = apiRef.current;
    const host = chartRef.current;
    if (!chart || !host || !contextMarkers.length) {
      contextMarkerBatchRef.current?.schedule({ events: [], actions: [] });
      if (flushContextMarkersImmediately) {
        contextMarkerBatchRef.current?.flush();
      }
      return;
    }

    const layout = (markers: ContextOverlayMarker[]) => {
      const width =
        host.clientWidth ||
        host.getBoundingClientRect().width ||
        host.offsetWidth ||
        0;
      const canClampToWidth = width > 16;
      const laneEnds = [-Number.POSITIVE_INFINITY, -Number.POSITIVE_INFINITY];
      return markers
        .map((marker) => {
          const coordinate = chart.timeScale().timeToCoordinate(marker.time as UTCTimestamp);
          const left = typeof coordinate === "number" ? Number(coordinate) : Number.NaN;
          return Number.isFinite(left)
            ? { ...marker, left }
            : null;
        })
        .filter((marker): marker is ContextOverlayMarker & { left: number } => marker !== null)
        .filter((marker) => marker.left >= 8 && (!canClampToWidth || marker.left <= width - 8))
        .sort((left, right) => left.left - right.left)
        .map((marker) => {
          let lane = laneEnds.findIndex((end) => marker.left - end >= 56);
          if (lane < 0) lane = 0;
          laneEnds[lane] = marker.left + 56;
          return { ...marker, lane };
        });
    };

    const recalc = () => {
      contextMarkerBatchRef.current?.schedule({
        events: layout(contextMarkers.filter((marker) => marker.kind === "event")),
        actions: layout(contextMarkers.filter((marker) => marker.kind === "action")),
      });
      if (flushContextMarkersImmediately) {
        contextMarkerBatchRef.current?.flush();
      }
    };

    recalc();
    chart.timeScale().subscribeVisibleTimeRangeChange(recalc as never);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            recalc();
          });
    resizeObserver?.observe(host);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(recalc as never);
      resizeObserver?.disconnect();
      contextMarkerBatchRef.current?.cancel();
    };
  }, [contextMarkers, flushContextMarkersImmediately]);

  const displayCandle = selectedCandle ?? hoveredRef.current ?? syncedCandle;
  const latestParsedCandle = replayParsed.length ? replayParsed[replayParsed.length - 1] : null;
  const inspectedCandle = displayCandle ?? latestParsedCandle;
  const inspectedTime = inspectedCandle ? inspectedCandle.time : null;
  const selectedTime = formatInspectorTime(inspectedTime);
  const latestClose = replayParsed.length ? Number(replayParsed[replayParsed.length - 1].close) : undefined;
  const replayProgress = replayParsed.length && parsed.length ? `${replayParsed.length}/${parsed.length}` : "0/0";
  const selectedChangePct =
    inspectedCandle && inspectedCandle.open
      ? ((inspectedCandle.close - inspectedCandle.open) / inspectedCandle.open) * 100
      : null;
  const sessionContext = useMemo(
    () => describeSessionState(inspectedCandle, replayEnabled),
    [inspectedCandle, replayEnabled],
  );
  const marketContext = useMemo(
    () =>
      describeMarketState({
        market,
        replayEnabled,
        bar: inspectedCandle ?? latestParsedCandle,
        liveMarketStatus: marketStatus,
      }),
    [inspectedCandle, latestParsedCandle, market, marketStatus, replayEnabled],
  );
  const fundamentalContext = useMemo(
    () => pickFundamentalContext(fundamentals),
    [fundamentals],
  );
  const markerLaneBottom = surfaceSettings.statusLineVisible ? 28 : 6;
  const fundamentalOverlayBottom = surfaceSettings.statusLineVisible ? 30 : 8;
  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId) ?? null;
  const overlayInspectorRows = useMemo<InspectorRow[]>(() => {
    const rows: InspectorRow[] = [];
    let colorIdx = 0;
    for (const payload of Object.values(overlays)) {
      if (!payload) continue;
      const point = findPointAtOrBefore(payload.data, inspectedTime);
      const keys = new Set<string>();
      for (const indicatorPoint of payload.data) {
        for (const key of Object.keys(indicatorPoint.values)) {
          keys.add(key);
        }
      }
      for (const key of Array.from(keys).sort()) {
        const value = point?.values?.[key];
        rows.push({
          id: `${payload.indicator}:${key}`,
          label: labelizeOverlayKey(payload.indicator, key),
          value: typeof value === "number" ? formatPriceValue(value) : "-",
          color: terminalOverlayPalette[colorIdx % terminalOverlayPalette.length],
        });
        colorIdx += 1;
      }
    }
    return rows;
  }, [inspectedTime, overlays]);
  const comparisonInspectorRows = useMemo<InspectorRow[]>(() => {
    const rows: InspectorRow[] = [];
    const palette = [
      "#4EA1FF", // Blue
      "#A0E75A", // Lime
      "#FFB86B", // Orange
      "#D58CFF", // Purple
      "#FF6B6B", // Red
      "#4ECDC4", // Teal
      "#FFE66D", // Yellow
      "#FF9FF3", // Pink
    ];
    comparisonSeries.slice(0, 8).forEach((row, idx) => {
      const points = buildComparisonPoints(row.data || [], effectiveComparisonMode);
      const point = findComparisonPointAtOrBefore(points, inspectedTime);
      if (!point) return;
      rows.push({
        id: `cmp:${row.symbol}`,
        label: `CMP ${row.symbol.toUpperCase()}`,
        value:
          effectiveComparisonMode === "normalized"
            ? formatSignedPercent(point.value)
            : formatPriceValue(point.value),
        color: row.color || palette[idx % palette.length],
      });
    });
    return rows;
  }, [comparisonSeries, effectiveComparisonMode, inspectedTime]);
  const compactLegendRows = [...overlayInspectorRows, ...comparisonInspectorRows];
  const sessionLabel = inspectedCandle?.session ? String(inspectedCandle.session).toUpperCase() : "RTH";
  const scaleSummaryLabel = `${surfaceSettings.priceScalePlacement.toUpperCase()} ${SCALE_TRANSFORM_LABELS[resolvedScaleTransform].toUpperCase()}`;
  const statusLine = [
    selectedTime,
    sessionLabel,
    `VOL ${formatVolumeValue(inspectedCandle?.volume)}`,
    `SCALE ${scaleSummaryLabel}`,
  ].join(" | ");
  const activeTemplateTool = selectedDrawing?.tool.type ?? (drawMode !== "none" ? drawMode : null);
  const activeTemplateFamily =
    selectedDrawing?.tool.family ?? (activeTemplateTool ? DRAWING_TOOL_MAP[activeTemplateTool].family : null);
  const scopedDrawingTemplates = useMemo(
    () => templatesForDrawingTool(drawingTemplates, activeTemplateTool, activeTemplateFamily),
    [activeTemplateFamily, activeTemplateTool, drawingTemplates],
  );
  const alertableDrawingIds = useMemo(
    () => drawings.filter((drawing) => isDrawingAlertSupported(drawing)).map((drawing) => drawing.id),
    [drawings],
  );
  const requestDrawingAlert = useCallback(
    (drawing: NormalizedChartDrawing | null) => {
      if (!drawing || !onRequestCreateAlert) return;
      const draft = buildDrawingAlertDraft({
        symbol: ticker,
        market,
        timeframe,
        panelId: panelId ?? null,
        workspaceId: drawingWorkspaceId,
        compareMode: effectiveComparisonMode,
        currentPrice: latestClose ?? null,
        referenceTime: inspectedTime,
        candle: inspectedCandle ? chartPointToAlertCandle({
          t: inspectedCandle.time,
          o: inspectedCandle.open,
          h: inspectedCandle.high,
          l: inspectedCandle.low,
          c: inspectedCandle.close,
          v: inspectedCandle.volume,
          s: inspectedCandle.session,
        }) : null,
        drawing,
      });
      if (draft) {
        onRequestCreateAlert(draft);
      }
    },
    [
      drawingWorkspaceId,
      effectiveComparisonMode,
      inspectedCandle,
      inspectedTime,
      latestClose,
      market,
      onRequestCreateAlert,
      panelId,
      ticker,
      timeframe,
    ],
  );

  useEffect(() => {
    if (!selectedDrawing) return;
    setEditingColor(getDrawingColor(selectedDrawing));
    setEditingLineWidth(getDrawingLineWidth(selectedDrawing));
    setEditingLineStyle(selectedDrawing.style.lineStyle);
    setEditingFillColor(selectedDrawing.style.fillColor || selectedDrawing.style.color);
    setEditingFillOpacity(selectedDrawing.style.fillOpacity);
  }, [selectedDrawing]);

  useEffect(() => {
    if (!selectedDrawingId) return;
    const selected = drawings.find((d) => d.id === selectedDrawingId);
    if (!selected) {
      setSelectedDrawingId(null);
      return;
    }
    setDrawings((prev) =>
      prev.map((d) =>
        d.id === selectedDrawingId
          ? updateDrawingStyle(d, {
              color: editingColor,
              lineWidth: editingLineWidth as 1 | 2 | 3 | 4,
              lineStyle: editingLineStyle,
              fillColor: selected.tool.type === "rectangle" ? editingFillColor : null,
              fillOpacity: selected.tool.type === "rectangle" ? editingFillOpacity : 0,
            })
          : d,
      ),
    );
  }, [editingColor, editingFillColor, editingFillOpacity, editingLineStyle, editingLineWidth, selectedDrawingId]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const host = chartRef.current;
      const chart = apiRef.current;
      const candles = candleRef.current;
      if (!host || !chart || !candles) return;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const price = candles.coordinateToPrice(y);
      if (typeof price !== "number" || !Number.isFinite(price)) return;
      const t = chart.timeScale().coordinateToTime(x);
      const ts = toUnixTime(t ?? undefined);
      if (ts === null) return;

      setDrawings((prev) =>
        prev.map((d) => {
          if (d.id !== drag.drawingId) return d;
          return applyDrawingHandleDrag(d, drag.anchorKey, { time: ts, price }, lastParsedRef.current);
        }),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const handleDots = (() => {
    const chart = apiRef.current;
    const candles = candleRef.current;
    if (!chart || !candles || !selectedDrawing) return [];
    return getDrawingHandles(selectedDrawing, {
      timeToX: (time) => chart.timeScale().timeToCoordinate(time as UTCTimestamp),
      priceToY: (price) => candles.priceToCoordinate(price),
      fallbackX: DRAWING_HANDLE_FALLBACK_X,
    });
  })();

  return (
    <div
      className="relative z-0 h-full w-full rounded border border-terminal-border"
      onContextMenu={(e) => {
        if (!onAddToPortfolio && !onRequestCreateAlert) return;
        e.preventDefault();
        const host = chartRef.current;
        const chart = apiRef.current;
        const candles = candleRef.current;
        const rect = host?.getBoundingClientRect();
        const relativeX = rect ? e.clientX - rect.left : NaN;
        const relativeY = rect ? e.clientY - rect.top : NaN;
        const price =
          rect && candles
            ? candles.coordinateToPrice(relativeY)
            : null;
        const chartTime =
          rect && chart
            ? toUnixTime(chart.timeScale().coordinateToTime(relativeX) ?? undefined)
            : null;
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          price: typeof price === "number" && Number.isFinite(price) ? price : null,
          time: chartTime,
        });
      }}
    >
      <div ref={chartRef} className="h-full w-full" />
      <div className="absolute left-2 top-2 z-[6] flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[10px] text-terminal-text">
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            replayEnabled ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => dispatchReplayCommand({ type: "toggle", revision: Date.now() })}
          aria-label={replayEnabled ? "Disable replay mode" : "Enable replay mode"}
        >
          REPLAY
        </button>
        <input
          type="date"
          value={replayDateInput}
          onChange={(event) => setReplayDateInput(event.target.value)}
          className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
          aria-label="Replay date"
          data-testid="replay-go-to-date-input"
        />
        <button
          type="button"
          className="rounded border border-terminal-border px-1.5 py-0.5"
          onClick={() => {
            void handleGoToReplayDate(replayDateInput, replayEnabled);
          }}
          aria-label="Go to selected date"
          disabled={!replayDateInput}
        >
          GO
        </button>
        {replayEnabled ? (
          <>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5"
              onClick={() => dispatchReplayCommand({ type: "playPause", revision: Date.now() })}
              aria-label={replayPlaying ? "Pause replay" : "Play replay"}
            >
              {replayPlaying ? "PAUSE" : "PLAY"}
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5"
              onClick={() => dispatchReplayCommand({ type: "stepBack", revision: Date.now() })}
              aria-label="Step replay backward"
            >
              BACK
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5"
              onClick={() => dispatchReplayCommand({ type: "stepForward", revision: Date.now() })}
              aria-label="Step replay forward"
            >
              STEP
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5"
              onClick={() => dispatchReplayCommand({ type: "prevSession", revision: Date.now() })}
              aria-label="Previous replay session"
            >
              SES-
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5"
              onClick={() => dispatchReplayCommand({ type: "nextSession", revision: Date.now() })}
              aria-label="Next replay session"
            >
              SES+
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5"
              onClick={() => dispatchReplayCommand({ type: "reset", revision: Date.now() })}
              aria-label="Reset replay"
            >
              RESET
            </button>
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
              value={replaySpeed}
              onChange={(e) => setReplaySpeed(e.target.value as ReplaySpeed)}
              aria-label="Replay speed"
            >
              {REPLAY_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}
                </option>
              ))}
            </select>
            <span data-testid="replay-progress">{replayProgress}</span>
          </>
        ) : null}
        {comparisonSeries.length && !comparisonModeProp ? (
          <>
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 ${
                effectiveComparisonMode === "normalized"
                  ? "border-terminal-accent text-terminal-accent"
                  : "border-terminal-border text-terminal-muted"
              }`}
              onClick={() => setComparisonMode("normalized")}
              aria-label="Comparison normalized mode"
            >
              NORM
            </button>
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 ${
                effectiveComparisonMode === "price"
                  ? "border-terminal-accent text-terminal-accent"
                  : "border-terminal-border text-terminal-muted"
              }`}
              onClick={() => setComparisonMode("price")}
              aria-label="Comparison price mode"
            >
              PRICE
            </button>
          </>
        ) : null}
        {drawings.length || drawMode !== "none" ? (
          <>
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 ${
                drawingPanelTab === "objects"
                  ? "border-terminal-accent text-terminal-accent"
                  : "border-terminal-border text-terminal-muted"
              }`}
              onClick={() => setDrawingPanelTab((prev) => (prev === "objects" ? null : "objects"))}
              data-testid="drawing-objects-toggle"
            >
              OBJ
            </button>
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 ${
                drawingPanelTab === "templates"
                  ? "border-terminal-accent text-terminal-accent"
                  : "border-terminal-border text-terminal-muted"
              }`}
              onClick={() => setDrawingPanelTab((prev) => (prev === "templates" ? null : "templates"))}
              data-testid="drawing-templates-toggle"
            >
              TPL
            </button>
          </>
        ) : null}
      </div>
      <div
        className="absolute right-2 top-2 z-[8] flex items-center gap-1 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[10px] text-terminal-text"
        data-testid="chart-context-controls"
      >
        <button
          type="button"
          className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
          onClick={handleExportPng}
          aria-label="Export chart PNG"
          data-testid="chart-export-png"
        >
          PNG
        </button>
        <button
          type="button"
          className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
          onClick={handleExportCsv}
          aria-label="Export chart CSV"
          data-testid="chart-export-csv"
        >
          CSV
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.legendVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, legendVisible: !prev.legendVisible }))}
          aria-label={surfaceSettings.legendVisible ? "Hide chart legend" : "Show chart legend"}
          data-testid="chart-legend-toggle"
        >
          LEG
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.statusLineVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, statusLineVisible: !prev.statusLineVisible }))}
          aria-label={surfaceSettings.statusLineVisible ? "Hide chart status line" : "Show chart status line"}
        >
          STAT
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.dataWindowVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, dataWindowVisible: !prev.dataWindowVisible }))}
          aria-label={surfaceSettings.dataWindowVisible ? "Hide chart data window" : "Show chart data window"}
          data-testid="chart-data-window-toggle"
        >
          DATA
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.sessionOverlayVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, sessionOverlayVisible: !prev.sessionOverlayVisible }))}
          aria-label={surfaceSettings.sessionOverlayVisible ? "Hide session overlay" : "Show session overlay"}
          data-testid="chart-session-overlay-toggle"
        >
          SESS
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.eventOverlayVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, eventOverlayVisible: !prev.eventOverlayVisible }))}
          aria-label={surfaceSettings.eventOverlayVisible ? "Hide event overlays" : "Show event overlays"}
          data-testid="chart-event-overlay-toggle"
        >
          EVT
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.actionOverlayVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, actionOverlayVisible: !prev.actionOverlayVisible }))}
          aria-label={surfaceSettings.actionOverlayVisible ? "Hide corporate action overlays" : "Show corporate action overlays"}
          data-testid="chart-action-overlay-toggle"
        >
          ACT
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.marketStatusVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, marketStatusVisible: !prev.marketStatusVisible }))}
          aria-label={surfaceSettings.marketStatusVisible ? "Hide market status overlay" : "Show market status overlay"}
          data-testid="chart-market-overlay-toggle"
        >
          MKT
        </button>
        <button
          type="button"
          className={`rounded border px-1.5 py-0.5 ${
            surfaceSettings.fundamentalsVisible ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
          }`}
          onClick={() => setSurfaceSettings((prev) => ({ ...prev, fundamentalsVisible: !prev.fundamentalsVisible }))}
          aria-label={surfaceSettings.fundamentalsVisible ? "Hide fundamentals overlay" : "Show fundamentals overlay"}
          data-testid="chart-fundamentals-overlay-toggle"
        >
          FUND
        </button>
        <button
          type="button"
          className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
          onClick={() =>
            setSurfaceSettings((prev) => ({
              ...prev,
              priceScalePlacement: prev.priceScalePlacement === "right" ? "left" : "right",
            }))
          }
          aria-label={
            surfaceSettings.priceScalePlacement === "right"
              ? "Move price scale to left"
              : "Move price scale to right"
          }
          data-testid="chart-scale-position-toggle"
        >
          {surfaceSettings.priceScalePlacement === "right" ? "PX-R" : "PX-L"}
        </button>
        <select
          className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
          value={compareNormalizedActive ? "percentage" : surfaceSettings.priceScaleTransform}
          onChange={(e) =>
            setSurfaceSettings((prev) => ({
              ...prev,
              priceScaleTransform: e.target.value as PriceScaleTransform,
            }))
          }
          aria-label="Price scale transform"
          data-testid="chart-scale-transform-select"
          disabled={compareNormalizedActive}
          title={compareNormalizedActive ? "Normalized comparison forces percentage scale" : undefined}
        >
          <option value="normal">Linear</option>
          <option value="logarithmic">Log</option>
          <option value="percentage">Percent</option>
          <option value="indexedTo100">Index 100</option>
        </select>
      </div>
      {(surfaceSettings.marketStatusVisible || surfaceSettings.sessionOverlayVisible) &&
      (marketContext || sessionContext) ? (
        <div
          className="pointer-events-none absolute left-1/2 top-12 z-[6] flex -translate-x-1/2 items-center gap-2 rounded border border-terminal-border bg-terminal-panel/95 px-3 py-1 text-[10px] text-terminal-text"
          data-testid="chart-context-summary"
        >
          {surfaceSettings.marketStatusVisible ? (
            <span className={`rounded border px-2 py-0.5 ${overlayToneClass(marketContext.tone)}`} data-testid="chart-market-status">
              MKT {marketContext.label}
            </span>
          ) : null}
          {surfaceSettings.sessionOverlayVisible && sessionContext ? (
            <span className={`rounded border px-2 py-0.5 ${overlayToneClass(sessionContext.tone)}`} data-testid="chart-session-status">
              SESS {sessionContext.label}
            </span>
          ) : null}
        </div>
      ) : null}
      {surfaceSettings.fundamentalsVisible && fundamentalContext.length ? (
        <div
          className="pointer-events-none absolute right-2 z-[6] max-w-[min(26rem,calc(100%-1rem))] rounded border border-terminal-border bg-terminal-panel/95 px-3 py-2 text-[10px] text-terminal-text"
          style={{ bottom: `${fundamentalOverlayBottom}px` }}
          data-testid="chart-fundamental-context"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-terminal-muted">Fundamentals</div>
          <div className="flex flex-wrap gap-2">
            {fundamentalContext.map((metric) => (
              <span key={metric.key} className="rounded border border-terminal-border bg-terminal-bg/70 px-2 py-0.5">
                <span className="text-terminal-muted">{metric.label}</span> {metric.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {surfaceSettings.actionOverlayVisible && contextMarkerPositions.actions.length ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-[6] h-10 text-[10px]"
          style={{ bottom: `${markerLaneBottom}px` }}
          data-testid="chart-action-markers"
        >
          <span className="absolute left-2 top-0 text-terminal-muted">ACT</span>
          {contextMarkerPositions.actions.map((marker) => (
            <span
              key={marker.id}
              className={`absolute -translate-x-1/2 rounded border px-1.5 py-0.5 ${overlayToneClass(marker.tone)}`}
              style={{ left: `${Math.round(marker.left)}px`, top: `${marker.lane * 18}px` }}
              title={marker.detail}
            >
              {marker.label}
            </span>
          ))}
        </div>
      ) : null}
      {surfaceSettings.eventOverlayVisible && contextMarkerPositions.events.length ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-[6] h-10 text-[10px]"
          style={{ bottom: `${markerLaneBottom + (surfaceSettings.actionOverlayVisible && contextMarkerPositions.actions.length ? 22 : 0)}px` }}
          data-testid="chart-event-markers"
        >
          <span className="absolute left-2 top-0 text-terminal-muted">EVT</span>
          {contextMarkerPositions.events.map((marker) => (
            <span
              key={marker.id}
              className={`absolute -translate-x-1/2 rounded border px-1.5 py-0.5 ${overlayToneClass(marker.tone)}`}
              style={{ left: `${Math.round(marker.left)}px`, top: `${marker.lane * 18}px` }}
              title={marker.detail}
            >
              {marker.label}
            </span>
          ))}
        </div>
      ) : null}
      {surfaceSettings.legendVisible && inspectedCandle ? (
        <div
          className="pointer-events-none absolute left-2 top-12 z-[6] max-w-[calc(100%-11rem)] rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[11px] text-terminal-text"
          data-testid="chart-legend"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-terminal-accent">{ticker.toUpperCase()}</span>
            {timeframe ? <span className="text-terminal-muted">{timeframe}</span> : null}
            <span className={selectedChangePct !== null && selectedChangePct < 0 ? "text-terminal-neg" : "text-terminal-pos"}>
              C {formatPriceValue(inspectedCandle.close)}
            </span>
            <span className={selectedChangePct !== null && selectedChangePct < 0 ? "text-terminal-neg" : "text-terminal-pos"}>
              {formatSignedPercent(selectedChangePct)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span><span className="text-terminal-muted">O</span> {formatPriceValue(inspectedCandle.open)}</span>
            <span><span className="text-terminal-muted">H</span> {formatPriceValue(inspectedCandle.high)}</span>
            <span><span className="text-terminal-muted">L</span> {formatPriceValue(inspectedCandle.low)}</span>
            <span><span className="text-terminal-muted">V</span> {formatVolumeValue(inspectedCandle.volume)}</span>
          </div>
          {compactLegendRows.length ? (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {compactLegendRows.slice(0, 4).map((row) => (
                <span key={row.id} style={row.color ? { color: row.color } : undefined}>
                  <span className="text-terminal-muted">{row.label}</span> {row.value}
                </span>
              ))}
            </div>
          ) : null}
          {compactLegendRows.length > 4 ? (
            <div className="mt-1 text-[10px] text-terminal-muted">
              +{compactLegendRows.length - 4} more value{compactLegendRows.length - 4 === 1 ? "" : "s"} in data window
            </div>
          ) : null}
          {showSessionLegend ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(59, 143, 249, 0.16)" }} />
                PRE
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(148, 163, 184, 0.045)" }} />
                RTH
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(155, 89, 182, 0.16)" }} />
                POST
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {surfaceSettings.dataWindowVisible ? (
        <div
          className="pointer-events-none absolute right-2 top-12 z-[6] w-64 rounded border border-terminal-border bg-terminal-panel/95 px-3 py-2 text-[11px] text-terminal-text"
          data-testid="chart-data-window"
        >
          <div className="flex items-center justify-between gap-2 border-b border-terminal-border pb-1">
            <span className="font-semibold text-terminal-accent">DATA WINDOW</span>
            <span className="text-[10px] text-terminal-muted">{selectedTime}</span>
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="text-terminal-muted">Open</span>
            <span>{formatPriceValue(inspectedCandle?.open)}</span>
            <span className="text-terminal-muted">High</span>
            <span>{formatPriceValue(inspectedCandle?.high)}</span>
            <span className="text-terminal-muted">Low</span>
            <span>{formatPriceValue(inspectedCandle?.low)}</span>
            <span className="text-terminal-muted">Close</span>
            <span>{formatPriceValue(inspectedCandle?.close)}</span>
            <span className="text-terminal-muted">Change</span>
            <span>{formatSignedPercent(selectedChangePct)}</span>
            <span className="text-terminal-muted">Volume</span>
            <span>{formatVolumeValue(inspectedCandle?.volume)}</span>
            <span className="text-terminal-muted">Session</span>
            <span>{sessionLabel}</span>
          </div>
          {overlayInspectorRows.length ? (
            <div className="mt-3 border-t border-terminal-border pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-terminal-muted">
                Overlays
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {overlayInspectorRows.map((row) => (
                  <Fragment key={row.id}>
                    <span className="text-terminal-muted" style={row.color ? { color: row.color } : undefined}>{row.label}</span>
                    <span>{row.value}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}
          {comparisonInspectorRows.length ? (
            <div className="mt-3 border-t border-terminal-border pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-terminal-muted">
                Compare
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {comparisonInspectorRows.map((row) => (
                  <Fragment key={row.id}>
                    <span className="text-terminal-muted" style={row.color ? { color: row.color } : undefined}>{row.label}</span>
                    <span>{row.value}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {drawingPanelTab === "objects" ? (
        <div
          className="absolute bottom-12 left-2 z-[44] w-80 max-w-[calc(100%-1rem)] rounded border border-terminal-border bg-terminal-panel/95 p-2 text-terminal-text shadow-xl"
          data-testid="drawing-object-tree-panel"
        >
          <div className="mb-2 flex items-center justify-between border-b border-terminal-border pb-2 text-[11px]">
            <span className="font-semibold text-terminal-accent">Object Tree</span>
            <span className="text-terminal-muted">{drawings.length} item(s)</span>
          </div>
          <DrawingObjectTree
            drawings={drawings}
            selectedDrawingId={selectedDrawingId}
            onSelect={setSelectedDrawingId}
            onToggleVisibility={(drawingId) =>
              setDrawings((prev) =>
                prev.map((drawing) =>
                  drawing.id === drawingId ? toggleDrawingVisibility(drawing) : drawing,
                ),
              )
            }
            onToggleLocked={(drawingId) =>
              setDrawings((prev) =>
                prev.map((drawing) =>
                  drawing.id === drawingId ? toggleDrawingLocked(drawing) : drawing,
                ),
              )
            }
            onMoveLayer={(drawingId, direction) => setDrawings((prev) => moveDrawingLayer(prev, drawingId, direction))}
            onCreateAlert={(drawingId) => {
              const drawing = drawings.find((entry) => entry.id === drawingId) ?? null;
              requestDrawingAlert(drawing);
            }}
            alertableDrawingIds={alertableDrawingIds}
          />
        </div>
      ) : null}
      {drawingPanelTab === "templates" ? (
        <div
          className="absolute bottom-12 left-2 z-[44] w-80 max-w-[calc(100%-1rem)] rounded border border-terminal-border bg-terminal-panel/95 p-2 text-terminal-text shadow-xl"
          data-testid="drawing-template-panel"
        >
          <div className="mb-2 flex items-center justify-between border-b border-terminal-border pb-2 text-[11px]">
            <div>
              <div className="font-semibold text-terminal-accent">Drawing Templates</div>
              <div className="text-[10px] text-terminal-muted">
                {activeTemplateTool ? DRAWING_TOOL_MAP[activeTemplateTool].label : "Select a drawing or tool"}
              </div>
            </div>
            <div className="text-[10px] text-terminal-muted">Favorites apply to new drawings</div>
          </div>
          {selectedDrawing ? (
            <div className="mb-3 flex items-center gap-2">
              <input
                value={templateDraftName}
                onChange={(event) => setTemplateDraftName(event.target.value)}
                placeholder="Template name"
                className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px]"
                data-testid="drawing-template-name-input"
              />
              <button
                type="button"
                className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
                onClick={() => {
                  if (!selectedDrawing) return;
                  setDrawingTemplates((prev) =>
                    upsertDrawingTemplate(
                      prev,
                      createDrawingTemplateFromDrawing(selectedDrawing, templateDraftName || undefined),
                    ),
                  );
                  setTemplateDraftName("");
                }}
                data-testid="drawing-template-save"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="mb-3 rounded border border-dashed border-terminal-border px-2 py-2 text-[11px] text-terminal-muted">
              Select a drawing to save its current style as a reusable template.
            </div>
          )}
          <div className="space-y-2">
            {scopedDrawingTemplates.length ? (
              scopedDrawingTemplates.map((template) => {
                const canApply =
                  !!selectedDrawing &&
                  (selectedDrawing.tool.type === template.toolType || selectedDrawing.tool.family === template.family);
                return (
                  <div
                    key={template.id}
                    className="rounded border border-terminal-border bg-terminal-bg/60 px-2 py-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate">{template.name}</div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                          {template.family} / {template.toolType}
                        </div>
                      </div>
                      <div className="h-3 w-3 rounded-full border border-terminal-border" style={{ background: template.style.color }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted disabled:opacity-50"
                        disabled={!canApply}
                        onClick={() => {
                          if (!selectedDrawing) return;
                          setDrawings((prev) =>
                            prev.map((drawing) =>
                              drawing.id === selectedDrawing.id ? applyDrawingTemplate(drawing, template) : drawing,
                            ),
                          );
                        }}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className={`rounded border px-1.5 py-0.5 ${
                          template.favorite ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
                        }`}
                        onClick={() => setDrawingTemplates((prev) => toggleDrawingTemplateFavorite(prev, template.id))}
                      >
                        {template.favorite ? "Fav" : "Star"}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                        onClick={() => setDrawingTemplates((prev) => deleteDrawingTemplate(prev, template.id))}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded border border-dashed border-terminal-border px-2 py-3 text-[11px] text-terminal-muted">
                No templates for the active drawing scope yet.
              </div>
            )}
          </div>
        </div>
      ) : null}
      {handleDots.map((dot) => (
        <button
          key={dot.id}
          type="button"
          className="absolute z-[40] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-terminal-accent bg-terminal-bg"
          style={{ left: `${dot.left}px`, top: `${dot.top}px` }}
          onMouseDown={(e) => {
            e.stopPropagation();
            dragRef.current = { drawingId: selectedDrawingId as string, anchorKey: dot.anchorKey };
          }}
          aria-label={`Drag ${dot.anchorKey} handle`}
        />
      ))}
      {selectedDrawing ? (
        <div className="absolute bottom-2 right-2 z-[45] flex items-center gap-1 rounded border border-terminal-border bg-terminal-panel/95 p-1 text-[10px]">
          <span className="text-terminal-muted">DRAW</span>
          <button
            type="button"
            className={`rounded border px-1 ${
              selectedDrawing.locked ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
            }`}
            onClick={() =>
              setDrawings((prev) =>
                prev.map((drawing) => (drawing.id === selectedDrawing.id ? toggleDrawingLocked(drawing) : drawing)),
              )
            }
            aria-label={selectedDrawing.locked ? "Unlock drawing" : "Lock drawing"}
          >
            {selectedDrawing.locked ? "LOCKED" : "LOCK"}
          </button>
          <button
            type="button"
            className={`rounded border px-1 ${
              selectedDrawing.visible ? "border-terminal-border text-terminal-muted" : "border-terminal-accent text-terminal-accent"
            }`}
            onClick={() =>
              setDrawings((prev) =>
                prev.map((drawing) => (drawing.id === selectedDrawing.id ? toggleDrawingVisibility(drawing) : drawing)),
              )
            }
            aria-label={selectedDrawing.visible ? "Hide drawing" : "Show drawing"}
          >
            {selectedDrawing.visible ? "HIDE" : "SHOW"}
          </button>
          {onRequestCreateAlert ? (
            <button
              type="button"
              className="rounded border border-terminal-border px-1 text-terminal-muted disabled:opacity-40"
              onClick={() => requestDrawingAlert(selectedDrawing)}
              disabled={!isDrawingAlertSupported(selectedDrawing)}
              aria-label="Create alert from drawing"
            >
              ALERT
            </button>
          ) : null}
          <input
            type="color"
            value={editingColor}
            onChange={(e) => setEditingColor(e.target.value)}
            className="h-5 w-6 rounded border border-terminal-border bg-terminal-bg p-0"
            aria-label="Drawing color"
            disabled={selectedDrawing.locked}
          />
          <select
            value={editingLineWidth}
            onChange={(e) => setEditingLineWidth(Number(e.target.value))}
            className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
            aria-label="Drawing line width"
            disabled={selectedDrawing.locked}
          >
            <option value={1}>1px</option>
            <option value={2}>2px</option>
            <option value={3}>3px</option>
            <option value={4}>4px</option>
          </select>
          <select
            value={editingLineStyle}
            onChange={(e) => setEditingLineStyle(e.target.value as DrawingStyle["lineStyle"])}
            className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
            aria-label="Drawing line style"
            disabled={selectedDrawing.locked}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dash</option>
          </select>
          {selectedDrawing.tool.type === "rectangle" ? (
            <>
              <input
                type="color"
                value={editingFillColor}
                onChange={(e) => setEditingFillColor(e.target.value)}
                className="h-5 w-6 rounded border border-terminal-border bg-terminal-bg p-0"
                aria-label="Drawing fill color"
                disabled={selectedDrawing.locked}
              />
              <select
                value={editingFillOpacity}
                onChange={(e) => setEditingFillOpacity(Number(e.target.value))}
                className="rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px]"
                aria-label="Drawing fill opacity"
                disabled={selectedDrawing.locked}
              >
                <option value={0}>Fill 0%</option>
                <option value={16}>Fill 16%</option>
                <option value={28}>Fill 28%</option>
                <option value={40}>Fill 40%</option>
              </select>
            </>
          ) : null}
          <button
            type="button"
            className="rounded border border-terminal-border px-1 text-terminal-muted hover:text-terminal-neg"
            onClick={() => {
              setDrawings((prev) => sortDrawingsByOrder(prev.filter((d) => d.id !== selectedDrawing.id)));
              setSelectedDrawingId(null);
            }}
          >
            Del
          </button>
        </div>
      ) : null}
      {syncedCrosshairX !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 z-[5] border-l border-dashed border-terminal-accent/90"
          style={{ left: `${Math.round(syncedCrosshairX)}px` }}
          aria-hidden
        />
      )}
      {surfaceSettings.statusLineVisible ? (
        <div
          className="pointer-events-none absolute bottom-2 left-2 right-24 z-[6] truncate rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[10px] text-terminal-text"
          data-testid="chart-status-line"
        >
          {statusLine}
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="fixed z-[120] w-44 rounded-sm border border-terminal-border bg-[#0F141B] p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onRequestCreateAlert ? (
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
              onClick={() => {
                const candleAtPoint =
                  (contextMenu.time !== null ? parsedByTimeRef.current.get(contextMenu.time) : null) ??
                  inspectedCandle ??
                  latestParsedCandle;
                const draft = buildPriceAlertDraft({
                  symbol: ticker,
                  market,
                  timeframe,
                  panelId: panelId ?? null,
                  workspaceId: drawingWorkspaceId,
                  compareMode: effectiveComparisonMode,
                  currentPrice: latestClose ?? null,
                  referencePrice: contextMenu.price ?? candleAtPoint?.close ?? latestClose ?? NaN,
                  referenceTime: contextMenu.time,
                  candle: candleAtPoint
                    ? chartPointToAlertCandle({
                        t: candleAtPoint.time,
                        o: candleAtPoint.open,
                        h: candleAtPoint.high,
                        l: candleAtPoint.low,
                        c: candleAtPoint.close,
                        v: candleAtPoint.volume,
                        s: candleAtPoint.session,
                      })
                    : null,
                });
                if (draft) {
                  onRequestCreateAlert(draft);
                }
                setContextMenu(null);
              }}
            >
              Create Alert
            </button>
          ) : null}
          {onAddToPortfolio ? (
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
              onClick={() => {
                onAddToPortfolio(ticker, inspectedCandle?.close ?? latestClose);
                setContextMenu(null);
              }}
            >
              Add to Portfolio
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
