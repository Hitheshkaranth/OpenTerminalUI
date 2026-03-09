import { useEffect, useRef } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Bar } from "oakscriptjs";

import { computeIndicator } from "./IndicatorManager";
import type { IndicatorConfig } from "./types";
import { terminalColors } from "../../theme/terminal";

type SeriesMap = Record<string, Record<string, ISeriesApi<"Line", Time>>>;
type CacheMeta = Record<string, { length: number; lastTime: number | null }>;

function normalizeIndicatorId(id: string): string {
  return String(id || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function forceSeparatePane(id: string): boolean {
  const normalized = normalizeIndicatorId(id);
  return [
    "volume-oscillator",
    "volumeoscillator",
    "vo",
    "macd",
    "rsi",
    "stoch",
    "stochastic",
    "atr",
    "adx",
    "cci",
    "mfi",
    "obv",
  ].includes(normalized);
}

function toPlotData(points: Array<{ time: unknown; value: unknown }>): Array<{ time: UTCTimestamp; value: number }> {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  for (const point of points) {
    const t = Number(point.time);
    const v = Number(point.value);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    out.push({ time: t as UTCTimestamp, value: v });
  }
  return out;
}

function clearSeries(chart: IChartApi, map: SeriesMap): SeriesMap {
  for (const plotMap of Object.values(map)) {
    for (const series of Object.values(plotMap)) {
      chart.removeSeries(series);
    }
  }
  return {};
}

export function useIndicators(
  chart: IChartApi | null,
  bars: Bar[],
  configs: IndicatorConfig[],
  options?: { nonOverlayPaneStartIndex?: number; maxNonOverlayPanes?: number },
): void {
  const seriesMapRef = useRef<SeriesMap>({});
  const cacheRef = useRef<CacheMeta>({});
  const nonOverlayPaneStartIndex = options?.nonOverlayPaneStartIndex ?? 2;
  const maxNonOverlayPanes = options?.maxNonOverlayPanes ?? 8;

  useEffect(() => {
    if (!chart) return;
    const active = configs.filter((c) => c.visible).map((c) => c.id);
    const activeSet = new Set(active);
    for (const key of Object.keys(seriesMapRef.current)) {
      if (!activeSet.has(key)) {
        for (const s of Object.values(seriesMapRef.current[key])) {
          chart.removeSeries(s);
        }
        delete seriesMapRef.current[key];
        delete cacheRef.current[key];
      }
    }
  }, [chart, configs]);

  useEffect(() => {
    if (!chart || !bars.length) return;

    let paneIndex = nonOverlayPaneStartIndex;
    const nonOverlayPaneIndexes: number[] = [];
    // Keep price pane dominant while leaving room for non-overlay indicators.
    chart.panes()[0]?.setStretchFactor(8);
    chart.panes()[1]?.setStretchFactor(2);
    for (const cfg of configs.filter((c) => c.visible)) {
      let result;
      try {
        result = computeIndicator(cfg.id, bars, cfg.params);
      } catch {
        continue;
      }
      const overlay = Boolean(result.metadata?.overlay) && !forceSeparatePane(cfg.id);
      const targetPaneIndex = overlay ? 0 : paneIndex;
      if (!overlay) {
        nonOverlayPaneIndexes.push(paneIndex);
      }
      const plots = result.plots ?? {};
      const key = cfg.id;
      if (!seriesMapRef.current[key]) {
        seriesMapRef.current[key] = {};
      }
      const existingPlotIds = new Set(Object.keys(seriesMapRef.current[key]));
      const incomingPlotIds = new Set(Object.keys(plots));

      for (const stalePlotId of existingPlotIds) {
        if (incomingPlotIds.has(stalePlotId)) continue;
        try {
          chart.removeSeries(seriesMapRef.current[key][stalePlotId]);
        } catch {
          // ignore remove failures from stale refs
        }
        delete seriesMapRef.current[key][stalePlotId];
      }

      for (const [plotId, rawPoints] of Object.entries(plots)) {
        const points = toPlotData(rawPoints as Array<{ time: unknown; value: unknown }>);
        if (!points.length) continue;
        points.sort((a, b) => Number(a.time) - Number(b.time));
        let series = seriesMapRef.current[key][plotId];
        if (!series) {
          try {
            series = chart.addSeries(
              LineSeries,
              {
                color: cfg.color || (overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane),
                lineWidth: ((cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4),
                lastValueVisible: true,
              },
              targetPaneIndex,
            );
          } catch {
            continue;
          }
          seriesMapRef.current[key][plotId] = series;
          try {
            series.setData(points);
          } catch {
            try {
              chart.removeSeries(series);
            } catch {
              // ignore stale refs
            }
            delete seriesMapRef.current[key][plotId];
            continue;
          }
          if (!overlay) {
            chart.panes()[targetPaneIndex]?.setStretchFactor(1);
          }
          continue;
        }
        try {
          series.setData(points);
        } catch {
          try {
            chart.removeSeries(series);
          } catch {
            // ignore stale refs
          }
          delete seriesMapRef.current[key][plotId];
          continue;
        }
      }
      if (!overlay) paneIndex += 1;
      if (paneIndex - nonOverlayPaneStartIndex >= maxNonOverlayPanes) {
        break;
      }
      const nowLast = bars.length ? Number(bars[bars.length - 1].time) : null;
      cacheRef.current[key] = { length: bars.length, lastTime: nowLast };
    }

    if (nonOverlayPaneIndexes.length > 0) {
      chart.panes()[0]?.setStretchFactor(12);
      chart.panes()[1]?.setStretchFactor(2);
      for (const idx of nonOverlayPaneIndexes) {
        chart.panes()[idx]?.setStretchFactor(1);
      }
    }

    return () => {
      if (!chart) return;
      const visible = new Set(configs.filter((c) => c.visible).map((c) => c.id));
      for (const id of Object.keys(seriesMapRef.current)) {
        if (visible.has(id)) continue;
        for (const s of Object.values(seriesMapRef.current[id])) {
          chart.removeSeries(s);
        }
        delete seriesMapRef.current[id];
      }
    };
  }, [chart, bars, configs, nonOverlayPaneStartIndex, maxNonOverlayPanes]);

  useEffect(() => {
    if (!chart) return;
    return () => {
      seriesMapRef.current = clearSeries(chart, seriesMapRef.current);
      cacheRef.current = {};
    };
  }, [chart]);
}
