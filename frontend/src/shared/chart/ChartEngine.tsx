import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "oakscriptjs";

import { terminalChartTheme } from "./chartTheme";
import { useIndicators } from "./useIndicators";
import { useRealtimeChart } from "./useRealtimeChart";
import type { ChartEngineProps } from "./types";

type SeriesRef = {
  candles: ISeriesApi<"Candlestick", Time> | null;
  line: ISeriesApi<"Line", Time> | null;
  area: ISeriesApi<"Area", Time> | null;
  baseline: ISeriesApi<"Baseline", Time> | null;
  volume: ISeriesApi<"Histogram", Time> | null;
  oi: ISeriesApi<"Area", Time> | null;
};

export function ChartEngine({
  symbol,
  timeframe,
  historicalData,
  activeIndicators,
  chartType,
  showVolume,
  enableRealtime,
  height = 540,
  market = "NSE",
  symbolIsFnO = false,
  onCrosshairOHLC,
  onTick,
}: ChartEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRef>({ candles: null, line: null, area: null, baseline: null, volume: null, oi: null });
  const byTimeRef = useRef<Map<number, Bar>>(new Map());
  const crosshairCbRef = useRef<ChartEngineProps["onCrosshairOHLC"]>(onCrosshairOHLC);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const { bars, liveTick } = useRealtimeChart(market, symbol, timeframe, historicalData, enableRealtime);

  const byTime = useMemo(() => {
    const map = new Map<number, Bar>();
    for (const b of bars) map.set(Number(b.time), b);
    return map;
  }, [bars]);

  useEffect(() => {
    byTimeRef.current = byTime;
  }, [byTime]);

  useEffect(() => {
    crosshairCbRef.current = onCrosshairOHLC;
  }, [onCrosshairOHLC]);

  useEffect(() => {
    onTick?.(liveTick);
  }, [liveTick, onTick]);

  useEffect(() => {
    if (!hostRef.current || chartRef.current) return;
    const chart = createChart(hostRef.current, {
      ...terminalChartTheme,
      width: hostRef.current.clientWidth,
      height,
    });

    const candles = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
        visible: chartType === "candle",
      },
      0,
    );
    const line = chart.addSeries(LineSeries, { color: "#ff9f1a", lineWidth: 2, visible: chartType === "line" }, 0);
    const area = chart.addSeries(
      AreaSeries,
      { lineColor: "#ff9f1a", topColor: "#ff9f1a55", bottomColor: "#ff9f1a12", visible: chartType === "area" },
      0,
    );
    const baseline = chart.addSeries(
      BaselineSeries,
      {
        visible: chartType === "baseline",
        topLineColor: "#26a69a",
        bottomLineColor: "#ef5350",
        topFillColor1: "#26a69a44",
        topFillColor2: "#26a69a11",
        bottomFillColor1: "#ef535044",
        bottomFillColor2: "#ef535011",
      },
      0,
    );
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        color: "#26a69a80",
        visible: showVolume,
      },
      1,
    );

    chart.panes()[1]?.setStretchFactor(250);

    let oi: ISeriesApi<"Area", Time> | null = null;
    if (symbolIsFnO) {
      oi = chart.addSeries(
        AreaSeries,
        {
          topColor: "rgba(245,124,32,0.2)",
          bottomColor: "rgba(245,124,32,0.01)",
          lineColor: "#f57c20",
          lineWidth: 1,
          priceScaleId: "oi-scale",
        },
        0,
      );
      chart.priceScale("oi-scale").applyOptions({
        scaleMargins: { top: 0.7, bottom: 0 },
        borderVisible: false,
      });
    }

    seriesRef.current = { candles, line, area, baseline, volume, oi };
    chartRef.current = chart;
    setChartApi(chart);

    const onCrosshairMove = (param: { time?: Time }) => {
      const t = typeof param.time === "number" ? Number(param.time) : null;
      if (!t) {
        onCrosshairOHLC?.(null);
        return;
      }
      const b = byTimeRef.current.get(t);
      if (!b) {
        crosshairCbRef.current?.(null);
        return;
      }
      crosshairCbRef.current?.({ open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), time: t });
    };

    chart.subscribeCrosshairMove(onCrosshairMove as never);

    const observer = new ResizeObserver(() => {
      if (!hostRef.current) return;
      chart.applyOptions({ width: hostRef.current.clientWidth, height: hostRef.current.clientHeight || height });
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove as never);
      chart.remove();
      chartRef.current = null;
      setChartApi(null);
    };
  }, [height, symbolIsFnO]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candles || !s.line || !s.area || !s.baseline) return;
    s.candles.applyOptions({ visible: chartType === "candle" });
    s.line.applyOptions({ visible: chartType === "line" });
    s.area.applyOptions({ visible: chartType === "area" });
    s.baseline.applyOptions({ visible: chartType === "baseline" });
  }, [chartType]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candles || !s.line || !s.area || !s.baseline || !s.volume) return;
    const candles = bars.map((b) => ({
      time: Number(b.time) as UTCTimestamp,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
    }));
    const closeLine = bars.map((b) => ({ time: Number(b.time) as UTCTimestamp, value: Number(b.close) }));
    const vol = bars.map((b) => ({
      time: Number(b.time) as UTCTimestamp,
      value: Number(b.volume ?? 0),
      color: Number(b.close) >= Number(b.open) ? "#26a69a80" : "#ef535080",
    }));
    s.candles.setData(candles);
    s.line.setData(closeLine);
    s.area.setData(closeLine);
    s.baseline.setData(closeLine);
    s.volume.setData(vol);
    s.volume.applyOptions({ visible: showVolume });
    s.oi?.setData(
      bars.map((b) => ({
        time: Number(b.time) as UTCTimestamp,
        value: Number(b.volume ?? 0),
      })),
    );
  }, [bars, showVolume]);

  useIndicators(chartApi, bars, activeIndicators);

  return (
    <div className="relative z-0 h-full w-full rounded border border-terminal-border">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
