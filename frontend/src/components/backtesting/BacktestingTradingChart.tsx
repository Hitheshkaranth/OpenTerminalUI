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

type Props = {
  bars: Bar[];
  trades: TradeMarker[];
  chartType: ChartKind;
  showVolume: boolean;
  activeIndicators: IndicatorConfig[];
  showMarkers?: boolean;
  height?: number;
};

export function BacktestingTradingChart({
  bars,
  trades,
  chartType,
  showVolume,
  activeIndicators,
  showMarkers = true,
  height = 420,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line", Time> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area", Time> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);

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
    };
  }, [height]);

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

  return (
    <div className="relative h-full w-full rounded border border-terminal-border">
      <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-terminal-border bg-terminal-panel/95 px-2 py-1 text-[11px] text-terminal-text">
        {crosshair ? (
          <div>
            <div>T: {new Date(crosshair.time * 1000).toISOString().slice(0, 10)}</div>
            <div>O:{crosshair.open.toFixed(2)} H:{crosshair.high.toFixed(2)} L:{crosshair.low.toFixed(2)} C:{crosshair.close.toFixed(2)}</div>
          </div>
        ) : (
          <div>Move crosshair for OHLC</div>
        )}
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
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
