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
import { canApplyTailUpdate } from "./chartUtils";
import {
  ALT_CHART_PARAMS_EVENT,
  ALT_CHART_PARAMS_STORAGE_KEY,
  DEFAULT_ALT_CHART_PARAMS,
  sanitizeAlternativeChartParams,
  transformKagiBars,
  transformLineBreakBars,
  transformPointFigureBars,
  transformRenkoBars,
  type AlternativeChartParams,
} from "./alternativeChartTransforms";
import { terminalColors } from "../../theme/terminal";
import { useChartSync } from "./ChartSyncContext";
import {
  COMPACT_SESSION_SHADE_PALETTE,
  buildCorePriceSeriesPayload,
  buildCorePriceSeriesUpdate,
  hasVisibleSessionShading,
} from "./rendererCore";
import { createRafBatcher } from "./rafBatcher";

type SeriesRef = {
  candles: ISeriesApi<"Candlestick", Time> | null;
  line: ISeriesApi<"Line", Time> | null;
  area: ISeriesApi<"Area", Time> | null;
  baseline: ISeriesApi<"Baseline", Time> | null;
  volume: ISeriesApi<"Histogram", Time> | null;
  oi: ISeriesApi<"Area", Time> | null;
  delivery: ISeriesApi<"Line", Time> | null;
  sessionShading: ISeriesApi<"Histogram", Time> | null;
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
  onRealtimeMeta,
  canRequestBackfill = false,
  onRequestBackfill,
  showDeliveryOverlay = false,
  deliverySeries = [],
  panelId = "panel-default",
  extendedHours,
  showSessionShading = true,
  onAddToPortfolio,
}: ChartEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRef>({
    candles: null, line: null, area: null, baseline: null,
    volume: null, oi: null, delivery: null, sessionShading: null
  });
  const byTimeRef = useRef<Map<number, Bar>>(new Map());
  const crosshairCbRef = useRef<ChartEngineProps["onCrosshairOHLC"]>(onCrosshairOHLC);
  const backfillCbRef = useRef<ChartEngineProps["onRequestBackfill"]>(onRequestBackfill);
  const canBackfillRef = useRef<boolean>(canRequestBackfill);
  const barsRef = useRef<Bar[]>(historicalData);
  const backfillInFlightRef = useRef(false);
  const lastBackfillOldestRef = useRef<number | null>(null);
  const lastAutoViewportKeyRef = useRef<string | null>(null);
  const lastRenderConfigKeyRef = useRef<string>("");
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [altParams, setAltParams] = useState<AlternativeChartParams>(DEFAULT_ALT_CHART_PARAMS);
  const { event: syncEvent, publish } = useChartSync();
  const { bars, liveTick, realtimeMeta } = useRealtimeChart(market, symbol, timeframe, historicalData, enableRealtime);
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
  const showSessionLegend = useMemo(
    () => showSessionShading && hasVisibleSessionShading(safeBars, extendedHours),
    [safeBars, extendedHours, showSessionShading],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ALT_CHART_PARAMS_STORAGE_KEY);
      if (raw) {
        setAltParams(sanitizeAlternativeChartParams(JSON.parse(raw) as Partial<AlternativeChartParams>));
      }
    } catch {
      // ignore invalid local storage content
    }
    const onParams = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AlternativeChartParams>>).detail;
      setAltParams(sanitizeAlternativeChartParams(detail));
    };
    window.addEventListener(ALT_CHART_PARAMS_EVENT, onParams as EventListener);
    return () => window.removeEventListener(ALT_CHART_PARAMS_EVENT, onParams as EventListener);
  }, []);

  const transformedBars = useMemo(() => {
    if (chartType === "renko") return transformRenkoBars(safeBars, altParams.renkoBrickSize);
    if (chartType === "kagi") return transformKagiBars(safeBars, altParams.kagiReversal);
    if (chartType === "point_figure") {
      return transformPointFigureBars(safeBars, altParams.pointFigureBoxSize, altParams.pointFigureReversalBoxes);
    }
    if (chartType === "line_break") return transformLineBreakBars(safeBars, altParams.lineBreakCount);
    return safeBars;
  }, [altParams.kagiReversal, altParams.lineBreakCount, altParams.pointFigureBoxSize, altParams.pointFigureReversalBoxes, altParams.renkoBrickSize, chartType, safeBars]);

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
    onRealtimeMeta?.(realtimeMeta);
  }, [onRealtimeMeta, realtimeMeta]);

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
        borderVisible: true,
        wickUpColor: terminalColors.candleUp,
        wickDownColor: terminalColors.candleDown,
        visible:
          chartType === "candle" ||
          chartType === "renko" ||
          chartType === "kagi" ||
          chartType === "point_figure" ||
          chartType === "line_break",
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

    const sessionShading = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      visible: true,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0, bottom: 0 },
    });

    // Keep price action dominant and volume compact.
    chart.panes()[0]?.setStretchFactor(8);
    chart.panes()[1]?.setStretchFactor(2);

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

    seriesRef.current = { candles, line, area, baseline, volume, oi, delivery, sessionShading };
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

    const resizeBatcher = createRafBatcher<{ width: number; height: number }>(({ width, height }) => {
      chart.applyOptions({ width, height });
    });
    const observer = new ResizeObserver(() => {
      if (!hostRef.current) return;
      resizeBatcher.schedule({
        width: hostRef.current.clientWidth,
        height: hostRef.current.clientHeight || height,
      });
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      resizeBatcher.cancel();
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
    s.candles.applyOptions({
      visible:
        chartType === "candle" ||
        chartType === "renko" ||
        chartType === "kagi" ||
        chartType === "point_figure" ||
        chartType === "line_break",
    });
    s.line.applyOptions({ visible: chartType === "line" });
    s.area.applyOptions({ visible: chartType === "area" });
    s.baseline.applyOptions({ visible: chartType === "baseline" });
  }, [chartType]);

  const lastBarsRef = useRef<Bar[]>([]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candles || !s.line || !s.area || !s.baseline || !s.volume || !s.delivery || !s.sessionShading) return;

    const renderSessionShading = showSessionShading && hasVisibleSessionShading(transformedBars, extendedHours);
    const renderConfigKey = [
      renderSessionShading ? "shade:1" : "shade:0",
      extendedHours?.enabled ? "eth:1" : "eth:0",
      extendedHours?.showPreMarket ? "pre:1" : "pre:0",
      extendedHours?.showAfterHours ? "post:1" : "post:0",
    ].join("|");
    const isIncremental =
      lastRenderConfigKeyRef.current === renderConfigKey &&
      canApplyTailUpdate(lastBarsRef.current, transformedBars);

    if (isIncremental) {
      const updatePayload = buildCorePriceSeriesUpdate(transformedBars, {
        extendedHours,
        showSessionShading: renderSessionShading,
        shadePalette: COMPACT_SESSION_SHADE_PALETTE,
      });
      if (updatePayload) {
        s.candles.update(updatePayload.candle as any);
        s.line.update(updatePayload.closePoint);
        s.area.update(updatePayload.closePoint);
        s.baseline.update(updatePayload.closePoint);
        s.volume.update(updatePayload.volumePoint);
        s.sessionShading.update(updatePayload.sessionShadingPoint);
      }
    } else {
      const payload = buildCorePriceSeriesPayload(transformedBars, {
        extendedHours,
        showSessionShading: renderSessionShading,
        shadePalette: COMPACT_SESSION_SHADE_PALETTE,
      });
      s.candles.setData(payload.candles as any);
      s.line.setData(payload.closeLine);
      s.area.setData(payload.closeLine);
      s.baseline.setData(payload.closeLine);
      s.volume.setData(payload.volume);
      s.sessionShading.setData(payload.sessionShading);
    }
    if (transformedBars.length > 0) {
      s.baseline.applyOptions({
        baseValue: { type: "price", price: Number(transformedBars[0].close) },
      });
    }

    const previousBarsLength = lastBarsRef.current.length;
    lastBarsRef.current = transformedBars;
    lastRenderConfigKeyRef.current = renderConfigKey;
    s.volume.applyOptions({ visible: showVolume });
    s.delivery.setData(
      deliverySeries.map((row) => ({
        time: Number(row.time) as UTCTimestamp,
        value: Number(row.value),
      })),
    );
    s.delivery.applyOptions({ visible: showDeliveryOverlay });
    s.oi?.setData(
      transformedBars.map((b) => ({
        time: Number(b.time) as UTCTimestamp,
        value: Number(b.volume ?? 0),
      })),
    );

    const ts = chartRef.current?.timeScale();
    if (ts) {
      const viewportKey = `${market}:${symbol}|${timeframe}`;
      const shouldAutoViewport =
        (lastAutoViewportKeyRef.current !== viewportKey) ||
        (previousBarsLength === 0 && transformedBars.length > 0);
      const intradayWindowBars =
        timeframe === "1m"
          ? 390
          : timeframe === "2m"
            ? 390
          : timeframe === "5m"
            ? 390
          : timeframe === "15m"
            ? 260
            : timeframe === "30m"
              ? 200
            : timeframe === "1h"
                ? 180
                : timeframe === "4h"
                  ? 120
                  : null;
      if (shouldAutoViewport) {
        if (intradayWindowBars && transformedBars.length > intradayWindowBars) {
          ts.setVisibleLogicalRange({
            from: Math.max(0, transformedBars.length - intradayWindowBars - 1),
            to: transformedBars.length + 2,
          });
        } else {
          ts.fitContent();
        }
        lastAutoViewportKeyRef.current = viewportKey;
      }
    }
  }, [transformedBars, showVolume, deliverySeries, showDeliveryOverlay, extendedHours, timeframe, showSessionShading]);

  useIndicators(chartApi, transformedBars, activeIndicators);

  useEffect(() => {
    if (!chartApi || !syncEvent || syncEvent.sourceId === panelId) return;
    const from = Math.max(0, syncEvent.timestamp - 60);
    const to = syncEvent.timestamp + 60;
    chartApi.timeScale().setVisibleRange({
      from: from as UTCTimestamp,
      to: to as UTCTimestamp,
    });
  }, [chartApi, panelId, syncEvent]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const latestClose = transformedBars.length ? Number(transformedBars[transformedBars.length - 1].close) : undefined;

  return (
    <div
      className="relative z-0 h-full w-full rounded border border-terminal-border"
      onContextMenu={(e) => {
        if (!onAddToPortfolio) return;
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div ref={hostRef} className="h-full w-full" />
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
      {contextMenu ? (
        <div
          className="fixed z-[120] w-44 rounded-sm border border-terminal-border bg-[#0F141B] p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
            onClick={() => {
              onAddToPortfolio?.(symbol, latestClose);
              setContextMenu(null);
            }}
          >
            Add to Portfolio
          </button>
        </div>
      ) : null}
    </div>
  );
}
