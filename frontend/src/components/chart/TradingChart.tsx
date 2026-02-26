import { useEffect, useMemo, useRef, useState } from "react";
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

import type { ChartPoint, IndicatorResponse } from "../../types";
import type { DrawMode } from "./DrawingTools";
import { terminalChartTheme } from "../../shared/chart/chartTheme";
import { useIndicators } from "../../shared/chart/useIndicators";
import type { IndicatorConfig } from "../../shared/chart/types";
import { terminalColors, terminalOverlayPalette } from "../../theme/terminal";
import type { Bar } from "oakscriptjs";

import type {
  ExtendedHoursConfig,
  PreMarketLevelConfig,
} from "../../store/chartWorkstationStore";
import { calculatePreMarketLevels, drawPreMarketLevels } from "./PreMarketLevels";

type ChartMode = "candles" | "line" | "area";
type TrendPoint = { time: number; price: number };
type ChartDrawing =
  | { id: string; type: "trendline"; p1: TrendPoint; p2: TrendPoint }
  | { id: string; type: "hline"; price: number };

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

function sessionShadeColor(session: string | undefined, eth?: ExtendedHoursConfig): string {
  const normalized = String(session || "rth");
  if (normalized === "pre" || normalized === "pre_open") {
    if (eth && !eth.showPreMarket) return "transparent";
    return "rgba(59, 143, 249, 0.16)";
  }
  if (normalized === "post" || normalized === "closing") {
    if (eth && !eth.showAfterHours) return "transparent";
    return "rgba(155, 89, 182, 0.16)";
  }
  return "rgba(148, 163, 184, 0.045)";
}

function hasVisibleSessionShading(data: CandlePoint[], eth?: ExtendedHoursConfig): boolean {
  if (!data.length) return false;
  const hasTaggedSessions = data.some((d) => d.session && d.session !== "rth");
  if (!hasTaggedSessions) return false;
  if (!eth?.enabled) return true;
  return Boolean(eth.showPreMarket || eth.showAfterHours);
}

function sanitizeDrawings(input: unknown): ChartDrawing[] {
  if (!Array.isArray(input)) return [];
  const out: ChartDrawing[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (d.type === "hline" && typeof d.price === "number") {
      out.push({ id: String(d.id ?? `hl-${Date.now()}`), type: "hline", price: d.price });
      continue;
    }
    if (
      d.type === "trendline" &&
      d.p1 &&
      d.p2 &&
      typeof d.p1 === "object" &&
      typeof d.p2 === "object"
    ) {
      const p1 = d.p1 as Record<string, unknown>;
      const p2 = d.p2 as Record<string, unknown>;
      if (
        typeof p1.time === "number" &&
        typeof p1.price === "number" &&
        typeof p2.time === "number" &&
        typeof p2.price === "number"
      ) {
        if (p1.time === p2.time) {
          continue;
        }
        out.push({
          id: String(d.id ?? `tl-${Date.now()}`),
          type: "trendline",
          p1: { time: p1.time, price: p1.price },
          p2: { time: p2.time, price: p2.price },
        });
      }
    }
  }
  return out;
}

type Props = {
  ticker: string;
  data: ChartPoint[];
  mode: ChartMode;
  overlays?: Record<string, IndicatorResponse | undefined>;
  indicatorConfigs?: IndicatorConfig[];
  showVolume?: boolean;
  showHighLow?: boolean;
  logarithmic?: boolean;
  drawMode?: DrawMode;
  clearDrawingsSignal?: number;
  onPendingTrendPointChange?: (pending: boolean) => void;
  extendedHours?: ExtendedHoursConfig;
  preMarketLevels?: PreMarketLevelConfig;
  market?: "US" | "IN";
};

export function TradingChart({
  ticker,
  data,
  mode,
  overlays = {},
  indicatorConfigs = [],
  showVolume = true,
  showHighLow = true,
  logarithmic = false,
  drawMode = "none",
  clearDrawingsSignal = 0,
  onPendingTrendPointChange,
  extendedHours,
  preMarketLevels,
  market = "IN",
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sessionShadingRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const highLineRef = useRef<IPriceLine | null>(null);
  const lowLineRef = useRef<IPriceLine | null>(null);
  const pmLevelLinesRef = useRef<Array<IPriceLine>>([]);
  const drawingLineSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const drawingPriceLinesRef = useRef<Array<IPriceLine>>([]);
  const pendingTrendPointRef = useRef<TrendPoint | null>(null);
  const drawModeRef = useRef<DrawMode>("none");
  const modeRef = useRef<ChartMode>("candles");
  const parsedByTimeRef = useRef<Map<number, CandlePoint>>(new Map());
  const pendingTrendCbRef = useRef<((pending: boolean) => void) | undefined>(undefined);
  const selectedRef = useRef<CandlePoint | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [selectedCandle, setSelectedCandle] = useState<CandlePoint | null>(null);
  const [indicatorChartApi, setIndicatorChartApi] = useState<IChartApi | null>(null);
  const storageKey = `lts:drawings:${ticker.toUpperCase()}`;

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
  const parsedByTime = useMemo(() => {
    const m = new Map<number, CandlePoint>();
    for (const p of parsed) {
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
  }, [parsed]);
  const indicatorBars = useMemo<Bar[]>(
    () =>
      parsed.map((p) => ({
        time: Number(p.time),
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: Number.isFinite(Number(p.volume)) ? Number(p.volume) : 0,
      })),
    [parsed],
  );
  useIndicators(indicatorChartApi, indicatorBars, indicatorConfigs, { nonOverlayPaneStartIndex: 1 });
  const showSessionLegend = useMemo(
    () => hasVisibleSessionShading(parsed, extendedHours),
    [parsed, extendedHours],
  );

  const toUnixTime = (t: Time | undefined): number | null => {
    if (!t) return null;
    if (typeof t === "number") return t;
    if (typeof t === "object" && t !== null && "year" in t && "month" in t && "day" in t) {
      const d = new Date(Date.UTC(t.year, t.month - 1, t.day, 0, 0, 0));
      return Math.floor(d.getTime() / 1000);
    }
    return null;
  };

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    parsedByTimeRef.current = parsedByTime;
  }, [parsedByTime]);

  useEffect(() => {
    pendingTrendCbRef.current = onPendingTrendPointChange;
  }, [onPendingTrendPointChange]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setDrawings([]);
        pendingTrendPointRef.current = null;
          pendingTrendCbRef.current?.(false);
          return;
      }
      setDrawings(sanitizeDrawings(JSON.parse(raw)));
    } catch {
      setDrawings([]);
    }
    pendingTrendPointRef.current = null;
    pendingTrendCbRef.current?.(false);
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drawings));
    } catch {
      // ignore storage errors
    }
  }, [drawings, storageKey]);

  useEffect(() => {
    if (!chartRef.current || apiRef.current) {
      return;
    }
    const chart = createChart(chartRef.current, {
      ...terminalChartTheme,
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight || 520,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: terminalColors.candleUp,
      downColor: terminalColors.candleDown,
      borderVisible: false,
      wickUpColor: terminalColors.candleUp,
      wickDownColor: terminalColors.candleDown,
      visible: mode === "candles",
    });
    const line = chart.addSeries(LineSeries, {
      color: terminalColors.accent,
      lineWidth: 2,
      visible: mode === "line",
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: terminalColors.accent,
      topColor: terminalColors.accentAreaTop,
      bottomColor: terminalColors.accentAreaBottom,
      visible: mode === "area",
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      color: terminalColors.accent,
      priceFormat: { type: "volume" },
      visible: showVolume,
    });
    const sessionShading = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      visible: true,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0, bottom: 0 },
    });

    apiRef.current = chart;
    setIndicatorChartApi(chart);
    candleRef.current = candles;
    lineRef.current = line;
    areaRef.current = area;
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

    const extractDrawPoint = (param: MouseEventParams<Time>): TrendPoint | null => {
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
      setSelectedCandle(next);
    };

    const onClick = (param: MouseEventParams<Time>) => {
      const nextDraw = extractDrawPoint(param);
      const next = extractCandle(param);
      if (drawModeRef.current === "trendline" && nextDraw) {
        const clicked: TrendPoint = nextDraw;
        if (!pendingTrendPointRef.current) {
          pendingTrendPointRef.current = clicked;
          pendingTrendCbRef.current?.(true);
          return;
        }
        const start = pendingTrendPointRef.current;
        pendingTrendPointRef.current = null;
        pendingTrendCbRef.current?.(false);
        // Lightweight charts requires strictly ascending unique time points.
        if (start.time === clicked.time) {
          return;
        }
        const p1 = start.time < clicked.time ? start : clicked;
        const p2 = start.time < clicked.time ? clicked : start;
        setDrawings((prev) => [
          ...prev,
          { id: `tl-${Date.now()}`, type: "trendline", p1, p2 },
        ]);
        return;
      }
      if (drawModeRef.current === "hline" && nextDraw) {
        setDrawings((prev) => [...prev, { id: `hl-${Date.now()}`, type: "hline", price: nextDraw.price }]);
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

    const observer = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth, height: chartRef.current.clientHeight || 520 });
      }
    });
    observer.observe(chartRef.current);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      apiRef.current = null;
      setIndicatorChartApi(null);
      candleRef.current = null;
      lineRef.current = null;
      areaRef.current = null;
      volumeRef.current = null;
      sessionShadingRef.current = null;
      overlaySeriesRef.current = [];
      highLineRef.current = null;
      lowLineRef.current = null;
      selectedRef.current = null;
    };
  }, []);

  const lastParsedRef = useRef<CandlePoint[]>([]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !lineRef.current || !areaRef.current || !sessionShadingRef.current) {
      return;
    }
    if (!parsed.length) {
      candleRef.current.setData([]);
      lineRef.current.setData([]);
      areaRef.current.setData([]);
      volumeRef.current.setData([]);
      sessionShadingRef.current.setData([]);
      lastParsedRef.current = [];
      return;
    }
    candleRef.current.applyOptions({ visible: mode === "candles" });
    lineRef.current.applyOptions({ visible: mode === "line" });
    areaRef.current.applyOptions({ visible: mode === "area" });

    const isIncremental =
      parsed.length > 0 &&
      lastParsedRef.current.length > 0 &&
      parsed.length === lastParsedRef.current.length &&
      parsed[parsed.length - 2]?.time === lastParsedRef.current[lastParsedRef.current.length - 2]?.time;

    const ethEnabled = extendedHours?.enabled;
    const hasSessionMetadata = parsed.some((d) => d.session && d.session !== "rth");

    // Handle session-aware candle coloring
    if (ethEnabled && mode === "candles") {
      const colorScheme = extendedHours.colorScheme || "dimmed";
      const styledBars = parsed.map((d) => {
        let color: string = d.close >= d.open ? terminalColors.candleUp : terminalColors.candleDown;
        let wickColor: string = d.close >= d.open ? terminalColors.candleUp : terminalColors.candleDown;

        if (d.isExtended) {
          if (colorScheme === "dimmed") {
            color = d.close >= d.open ? "rgba(38, 166, 91, 0.4)" : "rgba(232, 65, 66, 0.4)";
            wickColor = d.close >= d.open ? "rgba(38, 166, 91, 0.2)" : "rgba(232, 65, 66, 0.2)";
          } else if (colorScheme === "distinct") {
             if (d.session === "pre" || d.session === "pre_open") color = "#5B8FF9";
             else if (d.session === "post" || d.session === "closing") color = "#9B59B6";
             wickColor = color;
          }
        }

        return {
          time: d.time as UTCTimestamp,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          color,
          wickColor,
          borderColor: color,
        };
      });

      if (isIncremental) {
        candleRef.current.update(styledBars[styledBars.length - 1]);
      } else {
        candleRef.current.setData(styledBars);
      }
    } else {
      const standardBars = parsed.map(d => ({
        time: d.time as UTCTimestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close
      }));
      if (isIncremental) {
        candleRef.current.update(standardBars[standardBars.length - 1]);
      } else {
        candleRef.current.setData(standardBars);
      }
    }

    const lastPoint = parsed[parsed.length - 1];
    const updatePoint = { time: lastPoint.time as UTCTimestamp, value: lastPoint.close };
    const volUpdate = {
      time: lastPoint.time as UTCTimestamp,
      value: Number.isFinite(Number(lastPoint.volume)) ? Number(lastPoint.volume) : 0,
      color: lastPoint.close >= lastPoint.open
        ? (ethEnabled && lastPoint.isExtended ? "rgba(38, 166, 91, 0.2)" : terminalColors.candleUpAlpha88)
        : (ethEnabled && lastPoint.isExtended ? "rgba(232, 65, 66, 0.2)" : terminalColors.candleDownAlpha88),
    };

    if (isIncremental) {
      lineRef.current.update(updatePoint);
      areaRef.current.update(updatePoint);
      volumeRef.current.update(volUpdate);

      if (ethEnabled || hasSessionMetadata) {
        sessionShadingRef.current.update({
          time: lastPoint.time as UTCTimestamp,
          value: 1000000000,
          color: sessionShadeColor(lastPoint.session, extendedHours),
        });
      } else {
        sessionShadingRef.current.update({ time: lastPoint.time as UTCTimestamp, value: 0, color: "transparent" });
      }
    } else {
      lineRef.current.setData(parsed.map((d) => ({ time: d.time as UTCTimestamp, value: d.close })));
      areaRef.current.setData(parsed.map((d) => ({ time: d.time as UTCTimestamp, value: d.close })));
      volumeRef.current.setData(
        parsed.map((d) => {
          let color: string = d.close >= d.open ? terminalColors.candleUpAlpha88 : terminalColors.candleDownAlpha88;
          if (ethEnabled && d.isExtended) {
               color = d.close >= d.open ? "rgba(38, 166, 91, 0.2)" : "rgba(232, 65, 66, 0.2)";
          }
          return {
              time: d.time as UTCTimestamp,
              value: Number.isFinite(Number(d.volume)) ? Number(d.volume) : 0,
              color,
          };
        })
      );
      sessionShadingRef.current.setData(
        parsed.map((d) => ({
          time: d.time as UTCTimestamp,
          value: 1000000000,
          color: ethEnabled || hasSessionMetadata ? sessionShadeColor(d.session, extendedHours) : "transparent",
        })),
      );
    }

    lastParsedRef.current = parsed;
    volumeRef.current.applyOptions({ visible: showVolume });

    // PM Levels
    const candles = candleRef.current;
    if (candles) {
        for (const line of pmLevelLinesRef.current) {
            candles.removePriceLine(line);
        }
        pmLevelLinesRef.current = [];

        if (preMarketLevels && extendedHours?.enabled) {
            const levels = calculatePreMarketLevels(parsed as any);
            pmLevelLinesRef.current = drawPreMarketLevels(candles, levels, preMarketLevels);
        }
    }

    apiRef.current?.timeScale().fitContent();
  }, [mode, parsed, showVolume, extendedHours, preMarketLevels]);

  useEffect(() => {
    if (!apiRef.current) {
      return;
    }
    apiRef.current.applyOptions({
      rightPriceScale: {
        borderColor: terminalColors.border,
        mode: logarithmic ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
    });
  }, [logarithmic]);

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
        });
        colorIdx += 1;
        const lineData = payload.data
          .map((p) => ({ time: p.t as UTCTimestamp, value: p.values[key] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => typeof p.value === "number");
        line.setData(lineData);
        overlaySeriesRef.current.push(line);
      }
    }
  }, [overlays]);

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

    for (const drawing of drawings) {
      if (drawing.type === "trendline") {
        if (drawing.p1.time === drawing.p2.time) {
          continue;
        }
        const line = chart.addSeries(LineSeries, {
          color: terminalColors.drawingTrend,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        line.setData([
          { time: drawing.p1.time as UTCTimestamp, value: drawing.p1.price },
          { time: drawing.p2.time as UTCTimestamp, value: drawing.p2.price },
        ]);
        drawingLineSeriesRef.current.push(line);
      } else if (drawing.type === "hline") {
        const pl = candles.createPriceLine({
          price: drawing.price,
          color: terminalColors.drawingHLine,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "HL",
        });
        drawingPriceLinesRef.current.push(pl);
      }
    }
  }, [drawings]);

  useEffect(() => {
    if (!clearDrawingsSignal) {
      return;
    }
    pendingTrendPointRef.current = null;
    pendingTrendCbRef.current?.(false);
    setDrawings([]);
  }, [clearDrawingsSignal]);

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

  const selectedTime = selectedCandle ? new Date(selectedCandle.time * 1000).toLocaleString() : "-";
  const selectedChangePct =
    selectedCandle && selectedCandle.open
      ? ((selectedCandle.close - selectedCandle.open) / selectedCandle.open) * 100
      : null;

  return (
    <div className="relative z-0 h-full w-full rounded border border-terminal-border">
      <div ref={chartRef} className="h-full w-full" />
      {showSessionLegend && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[10px] text-terminal-text">
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
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[11px] text-terminal-text">
        <div>Time: {selectedTime}</div>
        <div>O: {selectedCandle ? selectedCandle.open.toFixed(2) : "-"}</div>
        <div>C: {selectedCandle ? selectedCandle.close.toFixed(2) : "-"}</div>
        <div>
          Chg:{" "}
          {selectedChangePct === null ? "-" : `${selectedChangePct >= 0 ? "+" : ""}${selectedChangePct.toFixed(2)}%`}
        </div>
        <div>H: {selectedCandle ? selectedCandle.high.toFixed(2) : "-"}</div>
        <div>L: {selectedCandle ? selectedCandle.low.toFixed(2) : "-"}</div>
      </div>
    </div>
  );
}
