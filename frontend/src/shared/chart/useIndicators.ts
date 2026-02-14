import { useEffect, useRef } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Bar } from "oakscriptjs";

import { computeIndicator } from "./IndicatorManager";
import type { IndicatorConfig } from "./types";

type SeriesMap = Record<string, Record<string, ISeriesApi<"Line", Time>>>;
type CacheMeta = Record<string, { length: number; lastTime: number | null }>;

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

export function useIndicators(chart: IChartApi | null, bars: Bar[], configs: IndicatorConfig[]): void {
  const seriesMapRef = useRef<SeriesMap>({});
  const cacheRef = useRef<CacheMeta>({});

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

    let paneIndex = 2;
    for (const cfg of configs.filter((c) => c.visible)) {
      let result;
      try {
        result = computeIndicator(cfg.id, bars, cfg.params);
      } catch {
        continue;
      }
      const overlay = Boolean(result.metadata?.overlay);
      const plots = result.plots ?? {};
      const key = cfg.id;
      const prevMeta = cacheRef.current[key] ?? { length: 0, lastTime: null };
      const nowLast = bars.length ? Number(bars[bars.length - 1].time) : null;
      const canIncremental = prevMeta.length === bars.length && prevMeta.lastTime === nowLast;

      if (!seriesMapRef.current[key]) {
        seriesMapRef.current[key] = {};
      }

      for (const [plotId, rawPoints] of Object.entries(plots)) {
        const points = toPlotData(rawPoints as Array<{ time: unknown; value: unknown }>);
        if (!points.length) continue;
        let series = seriesMapRef.current[key][plotId];
        if (!series) {
          series = chart.addSeries(
            LineSeries,
            {
              color: cfg.color || (overlay ? "#2962FF" : "#7E57C2"),
              lineWidth: ((cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4),
              lastValueVisible: true,
            },
            overlay ? 0 : paneIndex,
          );
          seriesMapRef.current[key][plotId] = series;
          series.setData(points);
          if (!overlay) {
            chart.panes()[paneIndex]?.setStretchFactor(300);
          }
          continue;
        }
        if (canIncremental) {
          const last = points[points.length - 1];
          series.update(last);
        } else {
          series.setData(points);
        }
      }
      if (!overlay) paneIndex += 1;
      cacheRef.current[key] = { length: bars.length, lastTime: nowLast };
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
  }, [chart, bars, configs]);

  useEffect(() => {
    if (!chart) return;
    return () => {
      seriesMapRef.current = clearSeries(chart, seriesMapRef.current);
      cacheRef.current = {};
    };
  }, [chart]);
}
