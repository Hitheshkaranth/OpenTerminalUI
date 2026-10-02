import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";

import { useStockHistory } from "../../hooks/useStocks";
import { terminalChartTheme } from "../../shared/chart/chartTheme";
import { terminalColors } from "../../theme/terminal";
import type { ChartPoint } from "../../types";

const RANGES = [
  { id: "1M", range: "1mo", interval: "1d" },
  { id: "3M", range: "3mo", interval: "1d" },
  { id: "6M", range: "6mo", interval: "1d" },
  { id: "1Y", range: "1y", interval: "1d" },
  { id: "5Y", range: "5y", interval: "1wk" },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const fmtPrice = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (t: number, withYear: boolean) =>
  new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });

function toSeconds(t: number): number {
  return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
}

type Props = { symbol: string; height?: number };

/** Security Hub overview price chart: range tabs, period change, hover readout, volume. */
export function PriceOverviewChart({ symbol, height = 230 }: Props) {
  const [rangeId, setRangeId] = useState<RangeId>("6M");
  const spec = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];
  const history = useStockHistory(symbol, spec.range, spec.interval);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [hover, setHover] = useState<{ t: number; c: number } | null>(null);

  const points = useMemo(() => {
    const raw = ((history.data as { data?: ChartPoint[] } | undefined)?.data ?? []) as ChartPoint[];
    const byTime = new Map<number, ChartPoint>();
    for (const p of raw) {
      const c = Number(p.c);
      if (!Number.isFinite(c) || c <= 0) continue;
      byTime.set(toSeconds(Number(p.t)), p); // lightweight-charts needs unique, ascending times
    }
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => ({ t, c: Number(p.c), v: Number(p.v) || 0 }));
  }, [history.data]);

  const first = points[0]?.c ?? null;
  const last = points[points.length - 1]?.c ?? null;
  const change = first != null && last != null ? last - first : null;
  const changePct = change != null && first ? (change / first) * 100 : null;
  const up = (change ?? 0) >= 0;
  const lineColor = up ? terminalColors.positive : terminalColors.negative;

  // Create the chart once; it autosizes to its container.
  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      ...terminalChartTheme,
      autoSize: true,
      grid: { vertLines: { visible: false }, horzLines: { color: terminalColors.border, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
      crosshair: {
        vertLine: { color: terminalColors.muted, style: LineStyle.Dashed, labelVisible: false },
        horzLine: { color: terminalColors.muted, style: LineStyle.Dashed },
      },
    });
    areaRef.current = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const onMove = (param: MouseEventParams) => {
      const data = param.time && areaRef.current ? param.seriesData.get(areaRef.current) : undefined;
      if (data && "value" in data) setHover({ t: Number(param.time), c: Number(data.value) });
      else setHover(null);
    };
    chart.subscribeCrosshairMove(onMove);
    chartRef.current = chart;
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      areaRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // Feed data + direction colours whenever the range or symbol changes.
  useEffect(() => {
    const area = areaRef.current;
    const volume = volumeRef.current;
    if (!area || !volume) return;
    area.applyOptions({
      lineColor,
      topColor: `${lineColor}40`,
      bottomColor: `${lineColor}05`,
    });
    area.setData(points.map((p) => ({ time: p.t as UTCTimestamp, value: p.c })));
    volume.setData(
      points.map((p, i) => ({
        time: p.t as UTCTimestamp,
        value: p.v,
        color: i > 0 && p.c < points[i - 1].c ? `${terminalColors.negative}55` : `${terminalColors.positive}55`,
      })),
    );
    for (const line of area.priceLines()) area.removePriceLine(line);
    if (first != null) {
      area.createPriceLine({
        price: first,
        color: terminalColors.muted,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
    }
    chartRef.current?.timeScale().fitContent();
  }, [points, lineColor, first]);

  const shown = hover ?? (last != null && points.length ? { t: points[points.length - 1].t, c: last } : null);
  const shownChange = shown && first ? shown.c - first : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="ot-type-data text-lg text-terminal-text">{shown ? fmtPrice(shown.c) : "—"}</div>
          <div className="ot-type-data text-xs">
            {shownChange != null && first ? (
              <span className={shownChange >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                {shownChange >= 0 ? "+" : ""}
                {fmtPrice(shownChange)} ({shownChange >= 0 ? "+" : ""}
                {((shownChange / first) * 100).toFixed(2)}%)
              </span>
            ) : (
              <span className="text-terminal-muted">{"—"}</span>
            )}
            <span className="ml-2 text-terminal-muted">
              {hover ? fmtDate(hover.t, true) : `over ${rangeId}`}
            </span>
          </div>
        </div>
        <div className="flex gap-0.5 rounded-sm border border-terminal-border bg-terminal-bg p-0.5" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={rangeId === r.id}
              onClick={() => setRangeId(r.id)}
              className={`rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent ${
                rangeId === r.id ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>
      <div className="relative" style={{ height }}>
        <div ref={hostRef} className="absolute inset-0" />
        {history.isLoading ? (
          <div className="absolute inset-0 animate-pulse rounded-sm bg-terminal-bg/60 motion-reduce:animate-none" aria-label="Loading chart" />
        ) : !points.length ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-terminal-muted">No price history for {symbol}.</div>
        ) : null}
      </div>
      {changePct != null && !hover ? (
        <div className="sr-only">
          {symbol} {up ? "up" : "down"} {Math.abs(changePct).toFixed(2)} percent over {rangeId}
        </div>
      ) : null}
    </div>
  );
}
