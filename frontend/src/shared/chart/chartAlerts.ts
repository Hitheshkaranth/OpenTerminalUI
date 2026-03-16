import { computeIndicator, listIndicators } from "./IndicatorManager";
import { chartPointsToBars } from "./chartUtils";
import type { NormalizedChartDrawing } from "./drawingEngine";
import type { IndicatorConfig } from "./types";
import type { AlertRule, ChartPoint } from "../../types";

export type ChartAlertSource = "price" | "drawing" | "indicator";

export type ChartAlertCandleSnapshot = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session?: string;
};

export type ChartAlertContext = {
  version: 1;
  surface: "chart";
  source: ChartAlertSource;
  symbol: string;
  market: string;
  timeframe: string;
  panelId: string | null;
  workspaceId: string | null;
  compareMode: string | null;
  sourceLabel: string;
  referencePrice: number;
  referenceTime: number | null;
  candle?: ChartAlertCandleSnapshot | null;
  drawing?: {
    id: string;
    remoteId?: string;
    toolType: string;
    label: string;
    family: string;
    anchors: Array<{ key: string; role: string; time: number; price: number }>;
    style: {
      color: string;
      lineWidth: number;
      lineStyle: string;
      fillColor: string | null;
      fillOpacity: number;
    };
  } | null;
  indicator?: {
    id: string;
    label: string;
    plotId: string;
    value: number;
    params: Record<string, unknown>;
    overlay: boolean;
  } | null;
};

export type ChartAlertDraft = {
  symbol: string;
  title: string;
  threshold: number;
  suggestedConditionType: "price_above" | "price_below";
  note: string;
  chartContext: ChartAlertContext;
};

export type ActiveChartAlertPreview = {
  id: string;
  source: ChartAlertSource;
  sourceLabel: string;
  conditionLabel: string;
  thresholdLabel: string;
  subtitle: string;
};

type DraftArgsBase = {
  symbol: string;
  market: string;
  timeframe?: string;
  panelId?: string | null;
  workspaceId?: string | null;
  compareMode?: string | null;
  currentPrice?: number | null;
  referenceTime?: number | null;
  candle?: ChartAlertCandleSnapshot | null;
};

type PlotPoint = { time: unknown; value: unknown };

function normalizeSymbol(symbol: string): string {
  return String(symbol || "").trim().toUpperCase();
}

function resolveAlertMarketToken(market: string): string {
  const normalized = String(market || "").trim().toUpperCase();
  if (normalized === "IN" || normalized === "NSE" || normalized === "BSE") return "NSE";
  if (normalized === "US" || normalized === "NASDAQ" || normalized === "NYSE" || normalized === "AMEX") return "NASDAQ";
  return normalized || "UNKNOWN";
}

export function qualifyAlertSymbol(symbol: string, market: string): string {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return "";
  if (normalized.includes(":")) return normalized;
  return `${resolveAlertMarketToken(market)}:${normalized}`;
}

function normalizeThreshold(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveConditionType(currentPrice: number | null | undefined, threshold: number): "price_above" | "price_below" {
  return isFiniteNumber(currentPrice) && currentPrice > threshold ? "price_below" : "price_above";
}

function normalizeCandle(candle?: ChartAlertCandleSnapshot | null): ChartAlertCandleSnapshot | null {
  if (!candle) return null;
  if (
    !isFiniteNumber(candle.time) ||
    !isFiniteNumber(candle.open) ||
    !isFiniteNumber(candle.high) ||
    !isFiniteNumber(candle.low) ||
    !isFiniteNumber(candle.close) ||
    !isFiniteNumber(candle.volume)
  ) {
    return null;
  }
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    session: candle.session,
  };
}

function createBaseContext(
  args: DraftArgsBase,
  source: ChartAlertSource,
  sourceLabel: string,
  referencePrice: number,
): Omit<ChartAlertContext, "drawing" | "indicator"> {
  return {
    version: 1,
    surface: "chart",
    source,
    symbol: qualifyAlertSymbol(args.symbol, args.market),
    market: resolveAlertMarketToken(args.market),
    timeframe: String(args.timeframe || "1D").trim() || "1D",
    panelId: args.panelId ?? null,
    workspaceId: args.workspaceId ?? null,
    compareMode: args.compareMode ?? null,
    sourceLabel,
    referencePrice: normalizeThreshold(referencePrice),
    referenceTime: isFiniteNumber(args.referenceTime) ? args.referenceTime : normalizeCandle(args.candle)?.time ?? null,
    candle: normalizeCandle(args.candle),
  };
}

function indicatorName(indicatorId: string): string {
  return listIndicators().find((indicator) => indicator.id === indicatorId)?.name ?? indicatorId.toUpperCase();
}

function formatConditionLabel(conditionType: string | undefined): string {
  if (conditionType === "price_above") return "Above";
  if (conditionType === "price_below") return "Below";
  return String(conditionType || "Alert")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatThreshold(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "NA";
  const raw = Math.abs(value) >= 1000 ? value.toFixed(2) : Math.abs(value) >= 100 ? value.toFixed(3) : value.toFixed(4);
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

function findPointAtOrBefore(points: PlotPoint[], targetTime: number | null | undefined): number | null {
  if (!Array.isArray(points) || !points.length) return null;
  const normalizedTarget = isFiniteNumber(targetTime) ? targetTime : null;
  if (normalizedTarget === null) {
    const latest = points[points.length - 1];
    const latestValue = Number(latest?.value);
    return Number.isFinite(latestValue) ? latestValue : null;
  }

  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midTime = Number(points[mid]?.time);
    if (!Number.isFinite(midTime)) {
      hi = mid - 1;
      continue;
    }
    if (midTime <= normalizedTarget) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const candidate = best >= 0 ? points[best] : points[points.length - 1];
  const value = Number(candidate?.value);
  return Number.isFinite(value) ? value : null;
}

function referenceTimeForDrawing(drawing: NormalizedChartDrawing, requestedTime: number | null | undefined): number {
  if (isFiniteNumber(requestedTime)) return requestedTime;
  const anchors = drawing.anchors;
  if (!anchors.length) return 0;
  return anchors[anchors.length - 1]?.time ?? anchors[0]?.time ?? 0;
}

function trendlineValueAtTime(
  drawing: NormalizedChartDrawing,
  requestedTime: number | null | undefined,
): number | null {
  if (drawing.anchors.length < 2) return null;
  const [start, end] = drawing.anchors;
  if (!isFiniteNumber(start.time) || !isFiniteNumber(end.time) || !isFiniteNumber(start.price) || !isFiniteNumber(end.price)) {
    return null;
  }
  if (end.time === start.time) return start.price;

  let targetTime = referenceTimeForDrawing(drawing, requestedTime);
  if (drawing.tool.type === "trendline") {
    targetTime = Math.max(start.time, Math.min(end.time, targetTime));
  } else if (drawing.tool.type === "ray") {
    targetTime = Math.max(start.time, targetTime);
  }

  const slope = (end.price - start.price) / (end.time - start.time);
  return start.price + slope * (targetTime - start.time);
}

type DrawingReference = {
  threshold: number;
  sourceLabel: string;
};

function resolveDrawingReference(
  drawing: NormalizedChartDrawing,
  currentPrice: number | null | undefined,
  requestedTime: number | null | undefined,
): DrawingReference | null {
  if (drawing.tool.type === "vline") return null;

  if (drawing.tool.type === "hline") {
    const level = drawing.anchors[0]?.price;
    return isFiniteNumber(level)
      ? { threshold: level, sourceLabel: drawing.tool.label }
      : null;
  }

  if (drawing.tool.type === "rectangle") {
    const first = drawing.anchors[0];
    const second = drawing.anchors[1];
    if (!first || !second) return null;
    const top = Math.max(first.price, second.price);
    const bottom = Math.min(first.price, second.price);
    if (!isFiniteNumber(top) || !isFiniteNumber(bottom)) return null;
    const current = isFiniteNumber(currentPrice) ? currentPrice : null;
    if (current === null) {
      return { threshold: top, sourceLabel: `${drawing.tool.label} Ceiling` };
    }
    const useTop = Math.abs(current - top) <= Math.abs(current - bottom);
    return {
      threshold: useTop ? top : bottom,
      sourceLabel: `${drawing.tool.label} ${useTop ? "Ceiling" : "Floor"}`,
    };
  }

  const projected = trendlineValueAtTime(drawing, requestedTime);
  return isFiniteNumber(projected)
    ? { threshold: projected, sourceLabel: drawing.tool.label }
    : null;
}

export function chartPointToAlertCandle(point: ChartPoint | null | undefined): ChartAlertCandleSnapshot | null {
  if (!point) return null;
  return {
    time: point.t,
    open: point.o,
    high: point.h,
    low: point.l,
    close: point.c,
    volume: point.v,
    session: point.s,
  };
}

export function isDrawingAlertSupported(drawing: NormalizedChartDrawing): boolean {
  return drawing.tool.type !== "vline";
}

export function buildPriceAlertDraft(
  args: DraftArgsBase & { referencePrice: number },
): ChartAlertDraft | null {
  if (!isFiniteNumber(args.referencePrice)) return null;
  const threshold = normalizeThreshold(args.referencePrice);
  const chartContext: ChartAlertContext = {
    ...createBaseContext(args, "price", "Price Snapshot", threshold),
    drawing: null,
    indicator: null,
  };
  return {
    symbol: chartContext.symbol,
    title: "Create Price Alert",
    threshold,
    suggestedConditionType: resolveConditionType(args.currentPrice, threshold),
    note: `Chart price snapshot @ ${formatThreshold(threshold)}`,
    chartContext,
  };
}

export function buildDrawingAlertDraft(
  args: DraftArgsBase & { drawing: NormalizedChartDrawing },
): ChartAlertDraft | null {
  const reference = resolveDrawingReference(args.drawing, args.currentPrice, args.referenceTime);
  if (!reference) return null;
  const threshold = normalizeThreshold(reference.threshold);
  const chartContext: ChartAlertContext = {
    ...createBaseContext(args, "drawing", reference.sourceLabel, threshold),
    drawing: {
      id: args.drawing.id,
      remoteId: args.drawing.remoteId,
      toolType: args.drawing.tool.type,
      label: args.drawing.tool.label,
      family: args.drawing.tool.family,
      anchors: args.drawing.anchors.map((anchor) => ({
        key: anchor.key,
        role: anchor.role,
        time: anchor.time,
        price: anchor.price,
      })),
      style: {
        color: args.drawing.style.color,
        lineWidth: args.drawing.style.lineWidth,
        lineStyle: args.drawing.style.lineStyle,
        fillColor: args.drawing.style.fillColor,
        fillOpacity: args.drawing.style.fillOpacity,
      },
    },
    indicator: null,
  };
  return {
    symbol: chartContext.symbol,
    title: `Create Alert from ${reference.sourceLabel}`,
    threshold,
    suggestedConditionType: resolveConditionType(args.currentPrice, threshold),
    note: `${reference.sourceLabel} @ ${formatThreshold(threshold)}`,
    chartContext,
  };
}

export function buildIndicatorAlertDraft(
  args: DraftArgsBase & { data: ChartPoint[]; config: IndicatorConfig },
): ChartAlertDraft | null {
  if (!Array.isArray(args.data) || !args.data.length) return null;
  let result;
  try {
    result = computeIndicator(args.config.id, chartPointsToBars(args.data), args.config.params);
  } catch {
    return null;
  }

  const plotEntries = Object.entries(result.plots ?? {})
    .map(([plotId, points]) => ({
      plotId,
      value: findPointAtOrBefore(points as PlotPoint[], args.referenceTime ?? normalizeCandle(args.candle)?.time ?? null),
    }))
    .filter((entry) => isFiniteNumber(entry.value));

  if (!plotEntries.length) return null;

  const prioritized =
    plotEntries.find((entry) => entry.plotId === "value") ||
    plotEntries.find((entry) => entry.plotId === "line") ||
    plotEntries[0];
  if (!prioritized || !isFiniteNumber(prioritized.value)) return null;

  const indicatorLabel = indicatorName(args.config.id);
  const sourceLabel = prioritized.plotId === "value" ? indicatorLabel : `${indicatorLabel} ${prioritized.plotId.toUpperCase()}`;
  const threshold = normalizeThreshold(prioritized.value);
  const chartContext: ChartAlertContext = {
    ...createBaseContext(args, "indicator", sourceLabel, threshold),
    drawing: null,
    indicator: {
      id: args.config.id,
      label: indicatorLabel,
      plotId: prioritized.plotId,
      value: threshold,
      params: { ...(args.config.params || {}) },
      overlay: Boolean(result.metadata?.overlay),
    },
  };
  return {
    symbol: chartContext.symbol,
    title: `Create Alert from ${sourceLabel}`,
    threshold,
    suggestedConditionType: resolveConditionType(args.currentPrice, threshold),
    note: `${sourceLabel} snapshot @ ${formatThreshold(threshold)}`,
    chartContext,
  };
}

export function extractChartAlertContext(parameters: unknown): ChartAlertContext | null {
  if (!parameters || typeof parameters !== "object") return null;
  const chartContext = (parameters as Record<string, unknown>).chart_context;
  if (!chartContext || typeof chartContext !== "object") return null;
  const raw = chartContext as Record<string, unknown>;
  const source = raw.source;
  if (source !== "price" && source !== "drawing" && source !== "indicator") return null;
  const referencePrice = Number(raw.referencePrice);
  if (!Number.isFinite(referencePrice)) return null;
  return {
    version: 1,
    surface: "chart",
    source,
    symbol: normalizeSymbol(String(raw.symbol || "")),
    market: String(raw.market || "").trim().toUpperCase() || "UNKNOWN",
    timeframe: String(raw.timeframe || "1D"),
    panelId: typeof raw.panelId === "string" ? raw.panelId : null,
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : null,
    compareMode: typeof raw.compareMode === "string" ? raw.compareMode : null,
    sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : source.toUpperCase(),
    referencePrice: normalizeThreshold(referencePrice),
    referenceTime: isFiniteNumber(Number(raw.referenceTime)) ? Number(raw.referenceTime) : null,
    candle: normalizeCandle(raw.candle as ChartAlertCandleSnapshot | null | undefined),
    drawing: raw.drawing && typeof raw.drawing === "object" ? (raw.drawing as ChartAlertContext["drawing"]) : null,
    indicator: raw.indicator && typeof raw.indicator === "object" ? (raw.indicator as ChartAlertContext["indicator"]) : null,
  };
}

export function buildActiveChartAlertPreview(alert: AlertRule): ActiveChartAlertPreview | null {
  const chartContext = extractChartAlertContext(alert.parameters);
  if (!chartContext) return null;
  const parameters = alert.parameters && typeof alert.parameters === "object" ? alert.parameters : {};
  const threshold =
    Number((parameters as Record<string, unknown>).threshold) ||
    Number((parameters as Record<string, unknown>).level) ||
    chartContext.referencePrice;
  return {
    id: String(alert.id),
    source: chartContext.source,
    sourceLabel: chartContext.sourceLabel,
    conditionLabel: formatConditionLabel(alert.condition_type),
    thresholdLabel: formatThreshold(threshold),
    subtitle: [chartContext.timeframe, chartContext.panelId].filter(Boolean).join(" | "),
  };
}
