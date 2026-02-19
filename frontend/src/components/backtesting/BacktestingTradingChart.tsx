import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "oakscriptjs";

import { terminalChartTheme } from "../../shared/chart/chartTheme";
import { useIndicators } from "../../shared/chart/useIndicators";
import type { ChartKind, IndicatorConfig } from "../../shared/chart/types";
import { terminalColors } from "../../theme/terminal";

type TradeMarker = {
  date: string;
  price: number;
  action: "BUY" | "SELL";
};

type ExecutionWindow = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
};

type ExecutionRect = {
  left: number;
  width: number;
  pnl: number;
};

type Props = {
  bars: Bar[];
  trades: TradeMarker[];
  chartType: ChartKind;
  showVolume: boolean;
  activeIndicators: IndicatorConfig[];
  showMarkers?: boolean;
  height?: number;
  referenceLines?: Array<{ label: string; price: number; color: string }>;
  onVisibleLogicalRangeChange?: (range: { from: number; to: number } | null) => void;
  enableBrushSelection?: boolean;
  brushRange?: { from: number; to: number } | null;
  onBrushRangeChange?: (range: { from: number; to: number } | null) => void;
  onBrushPreviewRangeChange?: (range: { from: number; to: number } | null) => void;
};

export function BacktestingTradingChart({
  bars,
  trades,
  chartType,
  showVolume,
  activeIndicators,
  showMarkers = true,
  height = 420,
  referenceLines = [],
  onVisibleLogicalRangeChange,
  enableBrushSelection = false,
  brushRange = null,
  onBrushRangeChange,
  onBrushPreviewRangeChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line", Time> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area", Time> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const referenceSeriesRef = useRef<Array<{ label: string; series: ISeriesApi<"Line", Time> }>>([]);
  const [executionRects, setExecutionRects] = useState<ExecutionRect[]>([]);
  const [dragBrush, setDragBrush] = useState<{ startX: number; currentX: number } | null>(null);

  const markers = useMemo(
    () =>
      trades
        .map((t) => {
          const ts = Math.floor(new Date(`${t.date}T00:00:00Z`).getTime() / 1000) as UTCTimestamp;
          if (!Number.isFinite(ts)) return null;
          return {
            time: ts,
            position: t.action === "BUY" ? "belowBar" : "aboveBar",
            color: t.action === "BUY" ? terminalColors.positive : terminalColors.negative,
            shape: t.action === "BUY" ? "arrowUp" : "arrowDown",
            text: t.action === "BUY" ? "BUY" : "SELL",
          } as const;
        })
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .sort((a, b) => Number(a.time) - Number(b.time)),
    [trades],
  );
  const executionWindows = useMemo<ExecutionWindow[]>(() => {
    const sorted = [...trades]
      .map((t) => ({
        time: Math.floor(new Date(`${t.date}T00:00:00Z`).getTime() / 1000),
        price: Number(t.price),
        action: t.action,
      }))
      .filter((t) => Number.isFinite(t.time) && Number.isFinite(t.price))
      .sort((a, b) => a.time - b.time);
    const windows: ExecutionWindow[] = [];
    let openBuy: { time: number; price: number } | null = null;
    for (const t of sorted) {
      if (t.action === "BUY") {
        openBuy = { time: t.time, price: t.price };
        continue;
      }
      if (t.action === "SELL" && openBuy) {
        windows.push({
          entryTime: openBuy.time,
          exitTime: t.time,
          entryPrice: openBuy.price,
          exitPrice: t.price,
          pnl: t.price - openBuy.price,
        });
        openBuy = null;
      }
    }
    return windows;
  }, [trades]);
  const byTimeRef = useRef<Map<number, Bar>>(new Map());
  useEffect(() => {
    const map = new Map<number, Bar>();
    for (const b of bars) map.set(Number(b.time), b);
    byTimeRef.current = map;
  }, [bars]);
  const [crosshair, setCrosshair] = useState<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);
  const activeExecution = useMemo(() => {
    if (!crosshair) return null;
    return (
      executionWindows.find((w) => crosshair.time >= w.entryTime && crosshair.time <= w.exitTime) || null
    );
  }, [crosshair, executionWindows]);

  useEffect(() => {
    if (!hostRef.current || chartRef.current) return;
    const chart = createChart(hostRef.current, {
      ...terminalChartTheme,
      width: hostRef.current.clientWidth,
      height,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: terminalColors.candleUp,
      downColor: terminalColors.candleDown,
      borderVisible: false,
      wickUpColor: terminalColors.candleUp,
      wickDownColor: terminalColors.candleDown,
      visible: chartType === "candle",
    });
    const line = chart.addSeries(LineSeries, {
      color: terminalColors.info,
      lineWidth: 2,
      visible: chartType === "line",
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: terminalColors.info,
      topColor: terminalColors.infoAreaTop,
      bottomColor: terminalColors.infoAreaBottom,
      visible: chartType === "area",
    });
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        color: terminalColors.candleUpAlpha80,
        visible: showVolume,
      },
      1,
    );
    chart.panes()[0]?.setStretchFactor(950);
    chart.panes()[1]?.setStretchFactor(90);

    chartRef.current = chart;
    setChartApi(chart);
    candleRef.current = candles;
    lineRef.current = line;
    areaRef.current = area;
    volumeRef.current = volume;

    const observer = new ResizeObserver(() => {
      if (!hostRef.current) return;
      chart.applyOptions({ width: hostRef.current.clientWidth, height: hostRef.current.clientHeight || height });
    });
    observer.observe(hostRef.current);
      const onCrosshairMove = (param: MouseEventParams<Time>) => {
        const t = typeof param.time === "number" ? Number(param.time) : null;
        if (!t) {
          setCrosshair(null);
          return;
        }
        const row = byTimeRef.current.get(t);
        if (!row) {
          setCrosshair(null);
          return;
        }
      setCrosshair({
        time: t,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      setChartApi(null);
      candleRef.current = null;
      lineRef.current = null;
      areaRef.current = null;
      volumeRef.current = null;
      referenceSeriesRef.current = [];
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const recalcExecutionRects = () => {
      const ts = chart.timeScale();
      const host = hostRef.current;
      if (!host) {
        setExecutionRects([]);
        return;
      }
      const rects: ExecutionRect[] = [];
      for (const window of executionWindows) {
        const x1 = ts.timeToCoordinate(window.entryTime as UTCTimestamp);
        const x2 = ts.timeToCoordinate(window.exitTime as UTCTimestamp);
        if (x1 == null || x2 == null) continue;
        const left = Math.max(0, Math.min(x1, x2));
        const right = Math.min(host.clientWidth, Math.max(x1, x2));
        const width = right - left;
        if (width < 1) continue;
        rects.push({ left, width, pnl: window.pnl });
      }
      setExecutionRects(rects);
      if (onVisibleLogicalRangeChange) {
        const range = ts.getVisibleLogicalRange();
        if (range) onVisibleLogicalRangeChange({ from: range.from, to: range.to });
        else onVisibleLogicalRangeChange(null);
      }
    };
    recalcExecutionRects();
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(recalcExecutionRects);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(recalcExecutionRects);
    };
  }, [bars, executionWindows, onVisibleLogicalRangeChange]);

  useEffect(() => {
    candleRef.current?.applyOptions({ visible: chartType === "candle" });
    lineRef.current?.applyOptions({ visible: chartType === "line" });
    areaRef.current?.applyOptions({ visible: chartType === "area" });
  }, [chartType]);

  useEffect(() => {
    const candles = candleRef.current;
    const line = lineRef.current;
    const area = areaRef.current;
    const volume = volumeRef.current;
    if (!candles || !line || !area || !volume) return;
    const safeBars = bars.filter(
      (b) =>
        Number.isFinite(Number(b.time)) &&
        Number.isFinite(Number(b.open)) &&
        Number.isFinite(Number(b.high)) &&
        Number.isFinite(Number(b.low)) &&
        Number.isFinite(Number(b.close)),
    );
    const candleData = safeBars.map((b) => ({
      time: Number(b.time) as UTCTimestamp,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
    }));
    const closeData = safeBars.map((b) => ({ time: Number(b.time) as UTCTimestamp, value: Number(b.close) }));
    candles.setData(candleData);
    line.setData(closeData);
    area.setData(closeData);
    volume.setData(
      safeBars.map((b) => ({
        time: Number(b.time) as UTCTimestamp,
        value: Number(b.volume ?? 0),
        color: Number(b.close) >= Number(b.open) ? terminalColors.candleUpAlpha80 : terminalColors.candleDownAlpha80,
      })),
    );
    volume.applyOptions({ visible: showVolume });
    chartRef.current?.timeScale().fitContent();
  }, [bars, showVolume]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const item of referenceSeriesRef.current) {
      chart.removeSeries(item.series);
    }
    referenceSeriesRef.current = [];
    if (!referenceLines.length || !bars.length) return;

    const firstTime = Number(bars[0].time) as UTCTimestamp;
    const lastTime = Number(bars[bars.length - 1].time) as UTCTimestamp;
    for (const line of referenceLines) {
      if (!Number.isFinite(line.price)) continue;
      const series = chart.addSeries(LineSeries, {
        color: line.color,
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData([
        { time: firstTime, value: Number(line.price) },
        { time: lastTime, value: Number(line.price) },
      ]);
      referenceSeriesRef.current.push({ label: line.label, series });
    }
  }, [bars, referenceLines]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    createSeriesMarkers(series, showMarkers ? markers : []);
  }, [markers, showMarkers]);

  useIndicators(chartApi, bars, activeIndicators);

  const handleZoom = (factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const center = (range.from + range.to) / 2;
    const half = ((range.to - range.from) / 2) * factor;
    ts.setVisibleLogicalRange({ from: center - half, to: center + half });
  };

  const xToLogical = (x: number): number | null => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return null;
    const ts = chart.timeScale() as any;
    if (typeof ts.coordinateToLogical === "function") {
      const v = ts.coordinateToLogical(x);
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return null;
    const clamped = Math.max(0, Math.min(host.clientWidth, x));
    const pct = host.clientWidth > 0 ? clamped / host.clientWidth : 0;
    return range.from + ((range.to - range.from) * pct);
  };

  const logicalToX = (logical: number): number | null => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return null;
    const ts = chart.timeScale() as any;
    if (typeof ts.logicalToCoordinate === "function") {
      const v = ts.logicalToCoordinate(logical);
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range || range.to === range.from) return null;
    const pct = (logical - range.from) / (range.to - range.from);
    return Math.max(0, Math.min(host.clientWidth, pct * host.clientWidth));
  };

  const lockedBrushPixels = useMemo(() => {
    if (!brushRange) return null;
    const x1 = logicalToX(Math.min(brushRange.from, brushRange.to));
    const x2 = logicalToX(Math.max(brushRange.from, brushRange.to));
    if (x1 == null || x2 == null) return null;
    return { left: Math.min(x1, x2), width: Math.max(1, Math.abs(x2 - x1)) };
  }, [brushRange]);

  const activeBrushPixels = useMemo(() => {
    if (dragBrush) {
      const left = Math.min(dragBrush.startX, dragBrush.currentX);
      const width = Math.max(1, Math.abs(dragBrush.currentX - dragBrush.startX));
      return { left, width, dragging: true as const };
    }
    if (lockedBrushPixels) return { ...lockedBrushPixels, dragging: false as const };
    return null;
  }, [dragBrush, lockedBrushPixels]);

  const handleBrushEnd = () => {
    if (!dragBrush || !onBrushRangeChange) return;
    const from = xToLogical(Math.min(dragBrush.startX, dragBrush.currentX));
    const to = xToLogical(Math.max(dragBrush.startX, dragBrush.currentX));
    setDragBrush(null);
    if (onBrushPreviewRangeChange) onBrushPreviewRangeChange(null);
    if (from == null || to == null) {
      onBrushRangeChange(null);
      return;
    }
    if (Math.abs(to - from) < 0.4) {
      onBrushRangeChange(null);
      return;
    }
    onBrushRangeChange({ from, to });
  };

  return (
    <div className="relative h-full w-full rounded border border-terminal-border">
      <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[11px] text-terminal-text">
        {crosshair ? (
          <div>
            <div>T: {new Date(crosshair.time * 1000).toISOString().slice(0, 10)}</div>
            <div>O:{crosshair.open.toFixed(2)} H:{crosshair.high.toFixed(2)} L:{crosshair.low.toFixed(2)} C:{crosshair.close.toFixed(2)}</div>
            {activeExecution && (
              <div className={activeExecution.pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                Exec: {new Date(activeExecution.entryTime * 1000).toISOString().slice(0, 10)} to {new Date(activeExecution.exitTime * 1000).toISOString().slice(0, 10)} ({activeExecution.pnl >= 0 ? "+" : ""}{activeExecution.pnl.toFixed(2)})
              </div>
            )}
          </div>
        ) : (
          <div>Move crosshair for OHLC</div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {executionRects.map((rect, idx) => (
          <div
            key={`exec-window-${idx}`}
            className="absolute bottom-0 top-0 border-l border-r"
            style={{
              left: `${rect.left}px`,
              width: `${rect.width}px`,
              backgroundColor: rect.pnl >= 0 ? "rgba(38, 166, 154, 0.15)" : "rgba(239, 83, 80, 0.15)",
              borderLeftColor: rect.pnl >= 0 ? terminalColors.candleUpAlpha80 : terminalColors.candleDownAlpha80,
              borderRightColor: rect.pnl >= 0 ? terminalColors.candleUpAlpha80 : terminalColors.candleDownAlpha80,
            }}
          />
        ))}
      </div>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text"
          onClick={() => handleZoom(0.8)}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-[11px] text-terminal-muted hover:text-terminal-text"
          onClick={() => handleZoom(1.25)}
          title="Zoom out"
        >
          -
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[11px] text-terminal-muted">
        Trade windows: {executionWindows.length}
      </div>
      {!!referenceLines.length && (
        <div className="pointer-events-none absolute bottom-2 right-2 z-10 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[10px] text-terminal-muted">
          {referenceLines.map((line) => `${line.label}: ${line.price.toFixed(2)}`).join(" | ")}
        </div>
      )}
      {enableBrushSelection && (
        <div
          className="absolute inset-0 z-[9] cursor-crosshair"
          onPointerDown={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            setDragBrush({ startX: x, currentX: x });
            if (onBrushPreviewRangeChange) {
              const logical = xToLogical(x);
              if (logical != null) onBrushPreviewRangeChange({ from: logical, to: logical });
            }
          }}
          onPointerMove={(e) => {
            if (!dragBrush) return;
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            setDragBrush((prev) => {
              if (!prev) return prev;
              if (onBrushPreviewRangeChange) {
                const from = xToLogical(Math.min(prev.startX, x));
                const to = xToLogical(Math.max(prev.startX, x));
                if (from != null && to != null) onBrushPreviewRangeChange({ from, to });
              }
              return { ...prev, currentX: x };
            });
          }}
          onPointerUp={handleBrushEnd}
          onPointerLeave={() => {
            if (dragBrush) handleBrushEnd();
          }}
          onDoubleClick={() => {
            if (onBrushRangeChange) onBrushRangeChange(null);
            if (onBrushPreviewRangeChange) onBrushPreviewRangeChange(null);
          }}
        />
      )}
      {activeBrushPixels && (
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-[8] border-l border-r"
          style={{
            left: `${activeBrushPixels.left}px`,
            width: `${activeBrushPixels.width}px`,
            backgroundColor: "rgba(0, 212, 170, 0.12)",
            borderLeftColor: terminalColors.accent,
            borderRightColor: terminalColors.accent,
          }}
        />
      )}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
