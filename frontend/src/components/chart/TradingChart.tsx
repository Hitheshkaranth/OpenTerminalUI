import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  PriceScaleMode,
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

type ChartMode = "candles" | "line" | "area";
type TrendPoint = { time: number; price: number };
type ChartDrawing =
  | { id: string; type: "trendline"; p1: TrendPoint; p2: TrendPoint }
  | { id: string; type: "hline"; price: number };

type CandlePoint = { time: number; open: number; high: number; low: number; close: number };

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
  showVolume?: boolean;
  showHighLow?: boolean;
  logarithmic?: boolean;
  drawMode?: DrawMode;
  clearDrawingsSignal?: number;
  onPendingTrendPointChange?: (pending: boolean) => void;
};

export function TradingChart({
  ticker,
  data,
  mode,
  overlays = {},
  showVolume = true,
  showHighLow = true,
  logarithmic = false,
  drawMode = "none",
  clearDrawingsSignal = 0,
  onPendingTrendPointChange,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const highLineRef = useRef<IPriceLine | null>(null);
  const lowLineRef = useRef<IPriceLine | null>(null);
  const drawingLineSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const drawingPriceLinesRef = useRef<Array<IPriceLine>>([]);
  const pendingTrendPointRef = useRef<TrendPoint | null>(null);
  const drawModeRef = useRef<DrawMode>("none");
  const modeRef = useRef<ChartMode>("candles");
  const parsedByTimeRef = useRef<Map<number, CandlePoint>>(new Map());
  const pendingTrendCbRef = useRef<((pending: boolean) => void) | undefined>(undefined);
  const selectedRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [selectedCandle, setSelectedCandle] = useState<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
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
      })),
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
      });
    }
    return m;
  }, [parsed]);

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
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight || 520,
      layout: {
        background: { type: ColorType.Solid, color: "#0c0f14" },
        textColor: "#d8dde7",
      },
      grid: {
        vertLines: { color: "#2a2f3a" },
        horzLines: { color: "#2a2f3a" },
      },
      crosshair: {
        vertLine: { color: "#8e98a8" },
        horzLine: { color: "#8e98a8" },
      },
      rightPriceScale: {
        borderColor: "#2a2f3a",
      },
      timeScale: {
        borderColor: "#2a2f3a",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });
    const candles = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      visible: mode === "candles",
    });
    const line = chart.addLineSeries({
      color: "#ff9f1a",
      lineWidth: 2,
      visible: mode === "line",
    });
    const area = chart.addAreaSeries({
      lineColor: "#ff9f1a",
      topColor: "#ff9f1a55",
      bottomColor: "#ff9f1a12",
      visible: mode === "area",
    });
    const volume = chart.addHistogramSeries({
      priceScaleId: "",
      color: "#ff9f1a",
      priceFormat: { type: "volume" },
      visible: showVolume,
    });
    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    apiRef.current = chart;
    candleRef.current = candles;
    lineRef.current = line;
    areaRef.current = area;
    volumeRef.current = volume;

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
      candleRef.current = null;
      lineRef.current = null;
      areaRef.current = null;
      volumeRef.current = null;
      overlaySeriesRef.current = [];
      highLineRef.current = null;
      lowLineRef.current = null;
      selectedRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !lineRef.current || !areaRef.current) {
      return;
    }
    candleRef.current.applyOptions({ visible: mode === "candles" });
    lineRef.current.applyOptions({ visible: mode === "line" });
    areaRef.current.applyOptions({ visible: mode === "area" });

    candleRef.current.setData(parsed);
    lineRef.current.setData(parsed.map((d) => ({ time: d.time, value: d.close })));
    areaRef.current.setData(parsed.map((d) => ({ time: d.time, value: d.close })));
    volumeRef.current.setData(
      parsed.map((d) => ({
        time: d.time,
        value: d.volume,
        color: d.close >= d.open ? "#26a69a88" : "#ef535088",
      }))
    );
    volumeRef.current.applyOptions({ visible: showVolume });
    apiRef.current?.timeScale().fitContent();
  }, [mode, parsed, showVolume]);

  useEffect(() => {
    if (!apiRef.current) {
      return;
    }
    apiRef.current.applyOptions({
      rightPriceScale: {
        borderColor: "#2a2f3a",
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

    const palette = ["#ff9800", "#00bcd4", "#ab47bc", "#f06292", "#66bb6a", "#ffa726"];
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
        const line = chart.addLineSeries({
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
        const line = chart.addLineSeries({
          color: "#ffd166",
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
          color: "#4dd0e1",
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
      color: "#66bb6a",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "H",
    });
    lowLineRef.current = series.createPriceLine({
      price: selectedCandle.low,
      color: "#ef5350",
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
