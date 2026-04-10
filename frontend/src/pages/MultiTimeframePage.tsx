import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { fetchChart } from "../api/client";
import { TickerDropdown } from "../components/chart-workstation/TickerDropdown";
import { terminalChartTheme } from "../shared/chart/chartTheme";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";
import type { ChartPoint } from "../types";
import { normalizeTicker } from "../utils/ticker";

type ChartMode = "candles" | "line";
type IndicatorPeriod = 20 | 50 | 200;
type TimeframeLabel = "1m" | "5m" | "15m" | "1H" | "4H" | "D" | "W" | "M";
type PanelRole = "long-term" | "medium-term" | "short-term" | "execution";
type TrendDirection = "up" | "down" | "sideways";

type PresetKey = "position" | "swing" | "day-trade" | "scalp";

type TimeframeConfig = {
  label: TimeframeLabel;
  interval: string;
  range: string;
};

type Preset = {
  key: PresetKey;
  label: string;
  frames: [TimeframeConfig, TimeframeConfig, TimeframeConfig, TimeframeConfig];
};

type PanelDataset = {
  interval: TimeframeConfig;
  data: ChartPoint[];
  loading: boolean;
  error: string | null;
};

type TrendSummary = {
  price: number | null;
  ema20: number | null;
  diffPct: number | null;
  direction: TrendDirection;
};

type MtaChartPanelProps = {
  panelId: PanelRole;
  symbol: string;
  intervalLabel: TimeframeLabel;
  data: ChartPoint[];
  loading: boolean;
  error: string | null;
  chartMode: ChartMode;
  indicatorPeriod: IndicatorPeriod;
  syncEnabled: boolean;
  sharedCrosshairTime: number | null;
  onHoverTimeChange: (time: number | null) => void;
  onChartModeChange: (mode: ChartMode) => void;
  onIndicatorPeriodChange: (period: IndicatorPeriod) => void;
};

const PRESETS: Preset[] = [
  {
    key: "position",
    label: "Position",
    frames: [
      { label: "M", interval: "1mo", range: "max" },
      { label: "W", interval: "1wk", range: "5y" },
      { label: "D", interval: "1d", range: "1y" },
      { label: "4H", interval: "4h", range: "6mo" },
    ],
  },
  {
    key: "swing",
    label: "Swing",
    frames: [
      { label: "W", interval: "1wk", range: "5y" },
      { label: "D", interval: "1d", range: "1y" },
      { label: "4H", interval: "4h", range: "6mo" },
      { label: "1H", interval: "1h", range: "3mo" },
    ],
  },
  {
    key: "day-trade",
    label: "Day Trade",
    frames: [
      { label: "D", interval: "1d", range: "1y" },
      { label: "1H", interval: "1h", range: "3mo" },
      { label: "15m", interval: "15m", range: "1mo" },
      { label: "5m", interval: "5m", range: "1mo" },
    ],
  },
  {
    key: "scalp",
    label: "Scalp",
    frames: [
      { label: "1H", interval: "1h", range: "3mo" },
      { label: "15m", interval: "15m", range: "1mo" },
      { label: "5m", interval: "5m", range: "1mo" },
      { label: "1m", interval: "1m", range: "5d" },
    ],
  },
];

const PANEL_ROLES: PanelRole[] = ["long-term", "medium-term", "short-term", "execution"];
const PANEL_TITLES: Record<PanelRole, string> = {
  "long-term": "Long-term",
  "medium-term": "Medium-term",
  "short-term": "Short-term",
  execution: "Execution",
};
const PANEL_CROSSHAIR_COLORS: Record<PanelRole, string> = {
  "long-term": "rgba(255, 107, 0, 0.75)",
  "medium-term": "rgba(78, 161, 255, 0.75)",
  "short-term": "rgba(0, 193, 118, 0.75)",
  execution: "rgba(255, 183, 77, 0.85)",
};
const INDICATOR_PERIODS: IndicatorPeriod[] = [20, 50, 200];

function marketToDropdown(value: string): "IN" | "US" {
  return value === "NSE" || value === "BSE" ? "IN" : "US";
}

function marketToApi(value: string): "NSE" | "NASDAQ" {
  return value === "NSE" || value === "BSE" ? "NSE" : "NASDAQ";
}

function formatPrice(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 1000 ? 1 : 2,
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  });
}

function formatDiffPct(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatTrendMessage(summary: TrendSummary): string {
  if (summary.price === null || summary.ema20 === null || summary.diffPct === null) {
    return "EMA20 unavailable";
  }
  if (summary.direction === "sideways") {
    return `Near EMA20 (${formatDiffPct(summary.diffPct)})`;
  }
  return `${summary.diffPct >= 0 ? "Above" : "Below"} EMA20 by ${Math.abs(summary.diffPct).toFixed(1)}%`;
}

function trendVisual(direction: TrendDirection): { arrow: string; tone: string } {
  if (direction === "up") {
    return { arrow: "↑", tone: "text-terminal-pos border-terminal-pos/40 bg-terminal-pos/10" };
  }
  if (direction === "down") {
    return { arrow: "↓", tone: "text-terminal-neg border-terminal-neg/40 bg-terminal-neg/10" };
  }
  return { arrow: "→", tone: "text-terminal-warn border-terminal-warn/40 bg-terminal-warn/10" };
}

function computeEma(data: ChartPoint[], period: number): Array<{ time: number; value: number }> {
  if (!data.length) return [];
  const alpha = 2 / (period + 1);
  const result: Array<{ time: number; value: number }> = [];
  let ema = Number(data[0]?.c);
  if (!Number.isFinite(ema)) return [];
  for (const point of data) {
    const close = Number(point.c);
    if (!Number.isFinite(close)) continue;
    ema += alpha * (close - ema);
    result.push({ time: Number(point.t), value: ema });
  }
  return result;
}

function findClosestPoint(data: ChartPoint[], targetTime: number | null): ChartPoint | null {
  if (!data.length) return null;
  if (targetTime === null || !Number.isFinite(targetTime)) {
    return data[data.length - 1] ?? null;
  }
  let low = 0;
  let high = data.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const time = Number(data[mid]?.t);
    if (time === targetTime) return data[mid] ?? null;
    if (time < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const left = high >= 0 ? data[high] : null;
  const right = low < data.length ? data[low] : null;
  if (!left) return right;
  if (!right) return left;
  return Math.abs(Number(left.t) - targetTime) <= Math.abs(Number(right.t) - targetTime) ? left : right;
}

function computeTrendSummary(data: ChartPoint[]): TrendSummary {
  if (!data.length) {
    return { price: null, ema20: null, diffPct: null, direction: "sideways" };
  }
  const price = Number(data[data.length - 1]?.c);
  if (!Number.isFinite(price)) {
    return { price: null, ema20: null, diffPct: null, direction: "sideways" };
  }
  const ema20Series = computeEma(data, 20);
  const ema20 = ema20Series[ema20Series.length - 1]?.value ?? null;
  if (ema20 === null || !Number.isFinite(ema20) || ema20 === 0) {
    return { price, ema20: null, diffPct: null, direction: "sideways" };
  }
  const diffPct = ((price - ema20) / ema20) * 100;
  const absDiff = Math.abs(diffPct);
  const direction: TrendDirection = absDiff <= 0.5 ? "sideways" : diffPct > 0 ? "up" : "down";
  return { price, ema20, diffPct, direction };
}

function alignmentBadge(trends: TrendSummary[]): { label: "ALIGNED" | "MIXED"; className: string } {
  const firstDirectional = trends.find((trend) => trend.direction !== "sideways")?.direction ?? null;
  const aligned =
    firstDirectional !== null &&
    trends.every((trend) => trend.direction === firstDirectional);
  return aligned
    ? { label: "ALIGNED", className: "border-terminal-pos/40 bg-terminal-pos/10 text-terminal-pos" }
    : { label: "MIXED", className: "border-terminal-warn/40 bg-terminal-warn/10 text-terminal-warn" };
}

function chartPointSeriesData(data: ChartPoint[]) {
  return data
    .map((point) => ({
      time: Number(point.t) as UTCTimestamp,
      open: Number(point.o),
      high: Number(point.h),
      low: Number(point.l),
      close: Number(point.c),
    }))
    .filter(
      (point) =>
        Number.isFinite(Number(point.time)) &&
        Number.isFinite(point.open) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        Number.isFinite(point.close),
    );
}

function priceLineData(data: ChartPoint[]) {
  return data
    .map((point) => ({
      time: Number(point.t) as UTCTimestamp,
      value: Number(point.c),
    }))
    .filter((point) => Number.isFinite(Number(point.time)) && Number.isFinite(point.value));
}

function MtaChartPanel({
  panelId,
  symbol,
  intervalLabel,
  data,
  loading,
  error,
  chartMode,
  indicatorPeriod,
  syncEnabled,
  sharedCrosshairTime,
  onHoverTimeChange,
  onChartModeChange,
  onIndicatorPeriodChange,
}: MtaChartPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const dataRef = useRef(data);
  const syncEnabledRef = useRef(syncEnabled);
  const hoverTimeChangeRef = useRef(onHoverTimeChange);
  const [crosshairStyle, setCrosshairStyle] = useState<CSSProperties>({ opacity: 0 });
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const chartData = useMemo(() => chartPointSeriesData(data), [data]);
  const lineData = useMemo(() => priceLineData(data), [data]);
  const emaData = useMemo(
    () =>
      computeEma(data, indicatorPeriod).map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      })),
    [data, indicatorPeriod],
  );
  const latestPrice = typeof hoverPrice === "number" && Number.isFinite(hoverPrice)
    ? hoverPrice
    : data.length
      ? Number(data[data.length - 1]?.c)
      : null;

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    syncEnabledRef.current = syncEnabled;
  }, [syncEnabled]);

  useEffect(() => {
    hoverTimeChangeRef.current = onHoverTimeChange;
  }, [onHoverTimeChange]);

  useEffect(() => {
    if (!hostRef.current || chartApiRef.current) return;
    const chart = createChart(hostRef.current, {
      ...terminalChartTheme,
      layout: {
        ...terminalChartTheme.layout,
        background: {
          type: ColorType.Solid,
          color: terminalColors.panel,
        },
      },
      width: hostRef.current.clientWidth,
      height: hostRef.current.clientHeight || 320,
      grid: {
        vertLines: { color: "rgba(45, 55, 69, 0.35)" },
        horzLines: { color: "rgba(45, 55, 69, 0.35)" },
      },
      timeScale: {
        ...terminalChartTheme.timeScale,
        rightOffset: 4,
        barSpacing: 8,
      },
      rightPriceScale: {
        borderColor: terminalColors.border,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: terminalColors.candleUp,
      downColor: terminalColors.candleDown,
      borderVisible: false,
      wickUpColor: terminalColors.candleUp,
      wickDownColor: terminalColors.candleDown,
      visible: chartMode === "candles",
    });
    const line = chart.addSeries(LineSeries, {
      color: terminalColors.accent,
      lineWidth: 2,
      visible: chartMode === "line",
      priceLineVisible: true,
      crosshairMarkerVisible: false,
    });
    const ema = chart.addSeries(LineSeries, {
      color: terminalColors.info,
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    chartApiRef.current = chart;
    candleSeriesRef.current = candles;
    lineSeriesRef.current = line;
    emaSeriesRef.current = ema;

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const nextTime = typeof param.time === "number" ? Number(param.time) : null;
      const matched = findClosestPoint(dataRef.current, nextTime);
      startTransition(() => {
        setHoverPrice(matched ? Number(matched.c) : null);
      });
      if (syncEnabledRef.current) {
        hoverTimeChangeRef.current(nextTime);
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    resizeObserverRef.current = new ResizeObserver(() => {
      const host = hostRef.current;
      if (!host) return;
      chart.applyOptions({
        width: host.clientWidth,
        height: host.clientHeight || 320,
      });
    });
    resizeObserverRef.current.observe(hostRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartMode === "candles" });
    lineSeriesRef.current?.applyOptions({ visible: chartMode === "line" });
  }, [chartMode]);

  useEffect(() => {
    candleSeriesRef.current?.setData(chartData);
    lineSeriesRef.current?.setData(lineData);
    emaSeriesRef.current?.setData(emaData);
    if (chartData.length > 0) {
      chartApiRef.current?.timeScale().fitContent();
    }
  }, [chartData, emaData, lineData]);

  useEffect(() => {
    if (!syncEnabled || sharedCrosshairTime === null) {
      setCrosshairStyle({ opacity: 0 });
      return;
    }
    const chart = chartApiRef.current;
    if (!chart) return;
    const matched = findClosestPoint(data, sharedCrosshairTime);
    if (!matched) {
      setCrosshairStyle({ opacity: 0 });
      return;
    }
    const coordinate = chart.timeScale().timeToCoordinate(Number(matched.t) as UTCTimestamp);
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
      setCrosshairStyle({ opacity: 0 });
      return;
    }
    setCrosshairStyle({
      opacity: 1,
      transform: `translateX(${coordinate}px)`,
    });
  }, [data, sharedCrosshairTime, syncEnabled]);

  return (
    <section
      data-testid={`mta-panel-${panelId}`}
      className="flex min-h-[300px] flex-col rounded-sm border border-terminal-border bg-terminal-panel shadow-[0_0_0_1px_rgba(255,107,0,0.03)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-terminal-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-terminal-muted">{PANEL_TITLES[panelId]}</div>
          <div className="flex items-center gap-2">
            <span
              data-testid={`mta-interval-${panelId}`}
              className="text-sm font-semibold text-terminal-text"
            >
              {intervalLabel}
            </span>
            <span className="text-xs text-terminal-muted">{symbol}</span>
            <span className="text-sm text-terminal-text">{formatPrice(latestPrice)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          <div className="flex items-center gap-1 rounded border border-terminal-border bg-terminal-bg/80 p-0.5">
            {(["candles", "line"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`rounded px-2 py-1 uppercase ${
                  chartMode === mode ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted"
                }`}
                onClick={() => onChartModeChange(mode)}
              >
                {mode === "candles" ? "Candle" : "Line"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded border border-terminal-border bg-terminal-bg/80 p-0.5">
            {INDICATOR_PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                className={`rounded px-2 py-1 ${
                  indicatorPeriod === period ? "bg-terminal-info/15 text-terminal-info" : "text-terminal-muted"
                }`}
                onClick={() => onIndicatorPeriodChange(period)}
              >
                EMA {period}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div ref={hostRef} className="h-full w-full" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 top-0 z-[4] w-px"
          style={{
            ...crosshairStyle,
            background: PANEL_CROSSHAIR_COLORS[panelId],
            boxShadow: `0 0 12px ${PANEL_CROSSHAIR_COLORS[panelId]}`,
          }}
        />
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-terminal-panel/80 text-xs text-terminal-muted">
            Loading {intervalLabel}...
          </div>
        ) : null}
        {!loading && error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-terminal-panel/85 px-4 text-center text-xs text-terminal-neg">
            {error}
          </div>
        ) : null}
        {!loading && !error && data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-terminal-panel/80 text-xs text-terminal-muted">
            No chart data
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function MultiTimeframePage() {
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const persistedTicker = useStockStore((state) => state.ticker);
  const setPersistedTicker = useStockStore((state) => state.setTicker);
  const [symbol, setSymbol] = useState(() => normalizeTicker(persistedTicker || "RELIANCE"));
  const [presetKey, setPresetKey] = useState<PresetKey>("swing");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [sharedCrosshairTime, setSharedCrosshairTime] = useState<number | null>(null);
  const [chartModes, setChartModes] = useState<Record<PanelRole, ChartMode>>({
    "long-term": "candles",
    "medium-term": "candles",
    "short-term": "candles",
    execution: "candles",
  });
  const [indicatorPeriods, setIndicatorPeriods] = useState<Record<PanelRole, IndicatorPeriod>>({
    "long-term": 20,
    "medium-term": 20,
    "short-term": 20,
    execution: 20,
  });
  const [datasets, setDatasets] = useState<Record<PanelRole, PanelDataset>>(() => ({
    "long-term": { interval: PRESETS[1].frames[0], data: [], loading: true, error: null },
    "medium-term": { interval: PRESETS[1].frames[1], data: [], loading: true, error: null },
    "short-term": { interval: PRESETS[1].frames[2], data: [], loading: true, error: null },
    execution: { interval: PRESETS[1].frames[3], data: [], loading: true, error: null },
  }));

  const market = useMemo(() => marketToApi(selectedMarket), [selectedMarket]);
  const dropdownMarket = useMemo(() => marketToDropdown(selectedMarket), [selectedMarket]);
  const preset = useMemo(() => PRESETS.find((item) => item.key === presetKey) ?? PRESETS[1], [presetKey]);

  useEffect(() => {
    const nextSymbol = normalizeTicker(symbol);
    if (!nextSymbol) return;
    setPersistedTicker(nextSymbol);
  }, [setPersistedTicker, symbol]);

  useEffect(() => {
    let active = true;
    const roles = PANEL_ROLES;
    const nextIntervals = preset.frames;

    setDatasets((current) =>
      roles.reduce((acc, role, index) => {
        acc[role] = {
          ...current[role],
          interval: nextIntervals[index],
          loading: true,
          error: null,
        };
        return acc;
      }, {} as Record<PanelRole, PanelDataset>),
    );

    void Promise.all(
      roles.map(async (role, index) => {
        const interval = nextIntervals[index];
        try {
          const response = await fetchChart(symbol, interval.interval, interval.range, market);
          return {
            role,
            interval,
            data: Array.isArray(response.data) ? response.data : [],
            error: null,
          };
        } catch (error) {
          return {
            role,
            interval,
            data: [],
            error: error instanceof Error ? error.message : "Failed to load chart",
          };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setDatasets(
        results.reduce((acc, result) => {
          acc[result.role] = {
            interval: result.interval,
            data: result.data,
            loading: false,
            error: result.error,
          };
          return acc;
        }, {} as Record<PanelRole, PanelDataset>),
      );
    });

    return () => {
      active = false;
    };
  }, [market, preset, symbol]);

  const trendSummaries = useMemo(
    () =>
      PANEL_ROLES.map((role) => ({
        role,
        intervalLabel: datasets[role].interval.label,
        summary: computeTrendSummary(datasets[role].data),
      })),
    [datasets],
  );

  const alignment = useMemo(
    () => alignmentBadge(trendSummaries.map((item) => item.summary)),
    [trendSummaries],
  );

  return (
    <div
      data-testid="mta-page"
      className="flex min-h-full flex-col gap-4 px-4 py-4 md:px-6"
    >
      <section className="rounded-sm border border-terminal-border bg-terminal-panel">
        <div className="flex flex-col gap-3 border-b border-terminal-border px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-terminal-text">Multi-Timeframe Analysis</h1>
              <p className="text-xs text-terminal-muted">
                Four linked contexts for structural trend, intermediate setup, lower timeframe timing, and execution.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[220px] items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-terminal-muted">Symbol</span>
                <TickerDropdown
                  value={symbol}
                  market={dropdownMarket}
                  placeholder="Search symbol"
                  inputTestId="mta-symbol-input"
                  className="w-full"
                  inputClassName="w-full min-w-[180px]"
                  onChange={(ticker) => {
                    const next = normalizeTicker(ticker);
                    setSharedCrosshairTime(null);
                    setSymbol(next);
                  }}
                />
              </div>
              <label
                className="inline-flex items-center gap-2 rounded border border-terminal-border bg-terminal-bg/80 px-3 py-2 text-xs text-terminal-text"
                data-testid="mta-crosshair-toggle"
              >
                <input
                  type="checkbox"
                  checked={syncEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setSyncEnabled(enabled);
                    if (!enabled) setSharedCrosshairTime(null);
                  }}
                  className="accent-terminal-accent"
                />
                Crosshair Sync
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                data-testid={`mta-preset-${item.key}`}
                className={`rounded-sm border px-3 py-2 text-xs ${
                  presetKey === item.key
                    ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                    : "border-terminal-border bg-terminal-bg/80 text-terminal-muted hover:text-terminal-text"
                }`}
                onClick={() => {
                  setPresetKey(item.key);
                  setSharedCrosshairTime(null);
                }}
              >
                {item.label}
                <span className="ml-2 text-[10px] opacity-70">
                  {item.frames.map((frame) => frame.label).join(" / ")}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          data-testid="mta-grid"
          className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2"
        >
          {PANEL_ROLES.map((role) => (
            <MtaChartPanel
              key={role}
              panelId={role}
              symbol={symbol}
              intervalLabel={datasets[role].interval.label}
              data={datasets[role].data}
              loading={datasets[role].loading}
              error={datasets[role].error}
              chartMode={chartModes[role]}
              indicatorPeriod={indicatorPeriods[role]}
              syncEnabled={syncEnabled}
              sharedCrosshairTime={sharedCrosshairTime}
              onHoverTimeChange={(time) => {
                if (!syncEnabled) return;
                setSharedCrosshairTime(time);
              }}
              onChartModeChange={(mode) =>
                setChartModes((current) => ({ ...current, [role]: mode }))
              }
              onIndicatorPeriodChange={(period) =>
                setIndicatorPeriods((current) => ({ ...current, [role]: period }))
              }
            />
          ))}
        </div>
      </section>

      <section
        data-testid="mta-trend-summary"
        className="rounded-sm border border-terminal-border bg-terminal-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-terminal-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-terminal-text">Trend Summary</h2>
            <p className="text-xs text-terminal-muted">
              Relative position versus EMA20 across the selected preset stack.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${alignment.className}`}>
            {alignment.label}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          {trendSummaries.map(({ role, intervalLabel, summary }) => {
            const visual = trendVisual(summary.direction);
            return (
              <div
                key={role}
                data-testid={`mta-trend-${role}`}
                className="rounded-sm border border-terminal-border bg-terminal-bg/70 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-terminal-text">{intervalLabel}</span>
                  <span
                    data-testid={`mta-trend-arrow-${role}`}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm ${visual.tone}`}
                  >
                    {visual.arrow}
                  </span>
                </div>
                <div className="mt-3 text-sm text-terminal-text">{formatPrice(summary.price)}</div>
                <div className="mt-1 text-xs text-terminal-muted">{formatTrendMessage(summary)}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
