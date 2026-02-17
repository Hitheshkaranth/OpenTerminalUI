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
import { terminalColors } from "../../theme/terminal";
import { useChartSync } from "./ChartSyncContext";

type SeriesRef = {
  candles: ISeriesApi<"Candlestick", Time> | null;
  line: ISeriesApi<"Line", Time> | null;
  area: ISeriesApi<"Area", Time> | null;
  baseline: ISeriesApi<"Baseline", Time> | null;
  volume: ISeriesApi<"Histogram", Time> | null;
  oi: ISeriesApi<"Area", Time> | null;
  delivery: ISeriesApi<"Line", Time> | null;
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
  canRequestBackfill = false,
  onRequestBackfill,
  showDeliveryOverlay = false,
  deliverySeries = [],
  panelId = "panel-default",
}: ChartEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRef>({ candles: null, line: null, area: null, baseline: null, volume: null, oi: null, delivery: null });
  const byTimeRef = useRef<Map<number, Bar>>(new Map());
  const crosshairCbRef = useRef<ChartEngineProps["onCrosshairOHLC"]>(onCrosshairOHLC);
  const backfillCbRef = useRef<ChartEngineProps["onRequestBackfill"]>(onRequestBackfill);
  const canBackfillRef = useRef<boolean>(canRequestBackfill);
  const barsRef = useRef<Bar[]>(historicalData);
  const backfillInFlightRef = useRef(false);
  const lastBackfillOldestRef = useRef<number | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const { event: syncEvent, publish } = useChartSync();
  const { bars, liveTick } = useRealtimeChart(market, symbol, timeframe, historicalData, enableRealtime);
  const safeBars = useMemo(
    () =>
      bars.filter(
        (b) =>
          Number.isFinite(Number(b.time)) &&
          Number.isFinite(Number(b.open)) &&
          Number.isFinite(Number(b.high)) &&
          Number.isFinite(Number(b.low)) &&
          Number.isFinite(Number(b.close)),
      ),
    [bars],
  );

  const byTime = useMemo(() => {
    const map = new Map<number, Bar>();
    for (const b of safeBars) map.set(Number(b.time), b);
    return map;
  }, [safeBars]);

  useEffect(() => {
    byTimeRef.current = byTime;
  }, [byTime]);

  useEffect(() => {
    crosshairCbRef.current = onCrosshairOHLC;
  }, [onCrosshairOHLC]);
  useEffect(() => {
    backfillCbRef.current = onRequestBackfill;
  }, [onRequestBackfill]);
  useEffect(() => {
    canBackfillRef.current = canRequestBackfill;
  }, [canRequestBackfill]);
  useEffect(() => {
    barsRef.current = safeBars;
  }, [safeBars]);

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
        upColor: terminalColors.candleUp,
        downColor: terminalColors.candleDown,
        borderVisible: false,
        wickUpColor: terminalColors.candleUp,
        wickDownColor: terminalColors.candleDown,
        visible: chartType === "candle",
      },
      0,
    );
    const line = chart.addSeries(LineSeries, { color: terminalColors.accent, lineWidth: 2, visible: chartType === "line" }, 0);
    const area = chart.addSeries(
      AreaSeries,
      { lineColor: terminalColors.accent, topColor: terminalColors.accentAreaTop, bottomColor: terminalColors.accentAreaBottom, visible: chartType === "area" },
      0,
    );
    const baseline = chart.addSeries(
      BaselineSeries,
      {
        visible: chartType === "baseline",
        topLineColor: terminalColors.candleUp,
        bottomLineColor: terminalColors.candleDown,
        topFillColor1: terminalColors.candleUpFillStrong,
        topFillColor2: terminalColors.candleUpFillSoft,
        bottomFillColor1: terminalColors.candleDownFillStrong,
        bottomFillColor2: terminalColors.candleDownFillSoft,
      },
      0,
    );
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        color: terminalColors.candleUpAlpha80,
        visible: showVolume,
      },
      1,
    );
    const delivery = chart.addSeries(
      LineSeries,
      {
        color: terminalColors.info,
        lineWidth: 2,
        visible: showDeliveryOverlay,
        priceScaleId: "delivery-scale",
      },
      0,
    );
    chart.priceScale("delivery-scale").applyOptions({
      borderVisible: false,
      scaleMargins: { top: 0.7, bottom: 0.12 },
    });

    // Keep price action dominant and volume compact.
    chart.panes()[0]?.setStretchFactor(950);
    chart.panes()[1]?.setStretchFactor(90);

    let oi: ISeriesApi<"Area", Time> | null = null;
    if (symbolIsFnO) {
      oi = chart.addSeries(
        AreaSeries,
        {
          topColor: "rgba(245,124,32,0.2)",
          bottomColor: "rgba(245,124,32,0.01)",
          lineColor: terminalColors.accentAlt,
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

    seriesRef.current = { candles, line, area, baseline, volume, oi, delivery };
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
      publish({ sourceId: panelId, timestamp: t, price: Number(b.close) });
      crosshairCbRef.current?.({ open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), time: t });
    };

    chart.subscribeCrosshairMove(onCrosshairMove as never);

    const onVisibleLogicalRangeChange = (logicalRange: { from: number; to: number } | null) => {
      if (!logicalRange || !canBackfillRef.current || backfillInFlightRef.current) return;
      if (logicalRange.from > 20) return;
      const localBars = barsRef.current;
      if (!localBars.length) return;
      const oldest = Number(localBars[0].time);
      if (!Number.isFinite(oldest) || oldest <= 0) return;
      if (lastBackfillOldestRef.current === oldest) return;
      const cb = backfillCbRef.current;
      if (!cb) return;

      backfillInFlightRef.current = true;
      lastBackfillOldestRef.current = oldest;
      Promise.resolve(cb(oldest)).finally(() => {
        backfillInFlightRef.current = false;
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange as never);

    const observer = new ResizeObserver(() => {
      if (!hostRef.current) return;
      chart.applyOptions({ width: hostRef.current.clientWidth, height: hostRef.current.clientHeight || height });
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove as never);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange as never);
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
    if (!s.candles || !s.line || !s.area || !s.baseline || !s.volume || !s.delivery) return;
    const candles = safeBars.map((b) => ({
      time: Number(b.time) as UTCTimestamp,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
    }));
    const closeLine = safeBars.map((b) => ({ time: Number(b.time) as UTCTimestamp, value: Number(b.close) }));
    const vol = safeBars.map((b) => ({
      time: Number(b.time) as UTCTimestamp,
      value: Number(b.volume ?? 0),
      color: Number(b.close) >= Number(b.open) ? terminalColors.candleUpAlpha80 : terminalColors.candleDownAlpha80,
    }));
    s.candles.setData(candles);
    s.line.setData(closeLine);
    s.area.setData(closeLine);
    s.baseline.setData(closeLine);
    s.volume.setData(vol);
    s.volume.applyOptions({ visible: showVolume });
    s.delivery.setData(
      deliverySeries.map((row) => ({
        time: Number(row.time) as UTCTimestamp,
        value: Number(row.value),
      })),
    );
    s.delivery.applyOptions({ visible: showDeliveryOverlay });
    s.oi?.setData(
      safeBars.map((b) => ({
        time: Number(b.time) as UTCTimestamp,
        value: Number(b.volume ?? 0),
      })),
    );
  }, [safeBars, showVolume, deliverySeries, showDeliveryOverlay]);

  useIndicators(chartApi, safeBars, activeIndicators);

  useEffect(() => {
    if (!chartApi || !syncEvent || syncEvent.sourceId === panelId) return;
    const from = Math.max(0, syncEvent.timestamp - 60);
    const to = syncEvent.timestamp + 60;
    chartApi.timeScale().setVisibleRange({
      from: from as UTCTimestamp,
      to: to as UTCTimestamp,
    });
  }, [chartApi, panelId, syncEvent]);

  return (
    <div className="relative z-0 h-full w-full rounded border border-terminal-border">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
