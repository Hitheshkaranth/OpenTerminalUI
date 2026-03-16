import { useEffect, useRef } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Bar } from "oakscriptjs";

import { computeIndicator } from "./IndicatorManager";
import { resolveIndicatorPaneKey } from "./indicatorCatalog";
import type { IndicatorConfig } from "./types";
import { terminalColors } from "../../theme/terminal";

type SeriesMap = Record<string, Record<string, ISeriesApi<"Line", Time>>>;
type CacheMeta = Record<string, { length: number; lastTime: number | null }>;
type SeriesPlacementMap = Record<string, Record<string, { paneIndex: number; priceScaleId: string }>>;

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

function clearPlacementMap(): SeriesPlacementMap {
  return {};
}

function removeIndicatorSeries(
  chart: IChartApi,
  seriesMap: SeriesMap,
  placementMap: SeriesPlacementMap,
  indicatorId: string,
): void {
  for (const series of Object.values(seriesMap[indicatorId] ?? {})) {
    chart.removeSeries(series);
  }
  delete seriesMap[indicatorId];
  delete placementMap[indicatorId];
}

export function useIndicators(
  chart: IChartApi | null,
  bars: Bar[],
  configs: IndicatorConfig[],
  options?: { nonOverlayPaneStartIndex?: number; maxNonOverlayPanes?: number; mainPriceScaleId?: "left" | "right" },
): void {
  const seriesMapRef = useRef<SeriesMap>({});
  const cacheRef = useRef<CacheMeta>({});
  const placementRef = useRef<SeriesPlacementMap>(clearPlacementMap());
  const nonOverlayPaneStartIndex = options?.nonOverlayPaneStartIndex ?? 2;
  const maxNonOverlayPanes = options?.maxNonOverlayPanes ?? 8;
  const mainPriceScaleId = options?.mainPriceScaleId ?? "right";

  useEffect(() => {
    if (!chart) return;
    const active = configs.filter((c) => c.visible).map((c) => c.instanceId);
    const activeSet = new Set(active);
    for (const key of Object.keys(seriesMapRef.current)) {
      if (!activeSet.has(key)) {
        removeIndicatorSeries(chart, seriesMapRef.current, placementRef.current, key);
        delete cacheRef.current[key];
      }
    }
  }, [chart, configs]);

  useEffect(() => {
    if (!chart || !bars.length) return;

    const paneAssignments = new Map<string, number>();
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
      const defaultOverlay = Boolean(result.metadata?.overlay) && !forceSeparatePane(cfg.id);
      const placement = resolveIndicatorPaneKey(cfg, defaultOverlay);
      let targetPaneIndex = 0;
      if (!placement.overlay) {
        const paneKey = placement.paneKey || `auto:${cfg.id}`;
        let assignedPaneIndex = paneAssignments.get(paneKey);
        if (assignedPaneIndex === undefined) {
          if (paneAssignments.size >= maxNonOverlayPanes) {
            removeIndicatorSeries(chart, seriesMapRef.current, placementRef.current, cfg.id);
            delete cacheRef.current[cfg.id];
            continue;
          }
          assignedPaneIndex = nonOverlayPaneStartIndex + paneAssignments.size;
          paneAssignments.set(paneKey, assignedPaneIndex);
        }
        targetPaneIndex = assignedPaneIndex;
        if (!nonOverlayPaneIndexes.includes(targetPaneIndex)) {
          nonOverlayPaneIndexes.push(targetPaneIndex);
        }
      }
      const priceScaleId =
        placement.scaleBehavior === "separate"
          ? `indicator-scale:${placement.paneKey ?? "overlay"}:${normalizeIndicatorId(cfg.instanceId)}`
          : placement.overlay
            ? mainPriceScaleId
            : "right";
      const plots = result.plots ?? {};
      const key = cfg.instanceId;
      if (!seriesMapRef.current[key]) {
        seriesMapRef.current[key] = {};
      }
      if (!placementRef.current[key]) {
        placementRef.current[key] = {};
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
        delete placementRef.current[key][stalePlotId];
      }

      for (const [plotId, rawPoints] of Object.entries(plots)) {
        const points = toPlotData(rawPoints as Array<{ time: unknown; value: unknown }>);
        if (!points.length) continue;
        points.sort((a, b) => Number(a.time) - Number(b.time));
        let series: ISeriesApi<"Line", Time> | undefined = seriesMapRef.current[key][plotId];
        const placementMeta = placementRef.current[key][plotId];
        const placementChanged =
          placementMeta?.paneIndex !== targetPaneIndex || placementMeta?.priceScaleId !== priceScaleId;
        if (series && placementChanged) {
          try {
            chart.removeSeries(series);
          } catch {
            // ignore stale refs
          }
          delete seriesMapRef.current[key][plotId];
          delete placementRef.current[key][plotId];
          series = undefined;
        }
        if (!series) {
          try {
            series = chart.addSeries(
              LineSeries,
              {
                color: cfg.color || (placement.overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane),
                lineWidth: ((cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4),
                lastValueVisible: true,
                priceScaleId,
              },
              targetPaneIndex,
            );
          } catch {
            continue;
          }
          seriesMapRef.current[key][plotId] = series;
          placementRef.current[key][plotId] = { paneIndex: targetPaneIndex, priceScaleId };
          try {
            series.setData(points);
            series.applyOptions({
              color: cfg.color || (placement.overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane),
              lineWidth: ((cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4),
              priceScaleId,
            });
            if (placement.scaleBehavior === "separate") {
              series.priceScale?.().applyOptions?.({
                visible: true,
                borderColor: terminalColors.border,
              });
            }
          } catch {
            try {
              chart.removeSeries(series);
            } catch {
              // ignore stale refs
            }
            delete seriesMapRef.current[key][plotId];
            delete placementRef.current[key][plotId];
            continue;
          }
          if (!placement.overlay) {
            chart.panes()[targetPaneIndex]?.setStretchFactor(1);
          }
          continue;
        }
        try {
          series.applyOptions({
            color: cfg.color || (placement.overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane),
            lineWidth: ((cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4),
            priceScaleId,
          });
          series.setData(points);
          if (placement.scaleBehavior === "separate") {
            series.priceScale?.().applyOptions?.({
              visible: true,
              borderColor: terminalColors.border,
            });
          }
        } catch {
          try {
            chart.removeSeries(series);
          } catch {
            // ignore stale refs
          }
          delete seriesMapRef.current[key][plotId];
          delete placementRef.current[key][plotId];
          continue;
        }
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
      const visible = new Set(configs.filter((c) => c.visible).map((c) => c.instanceId));
      for (const id of Object.keys(seriesMapRef.current)) {
        if (visible.has(id)) continue;
        removeIndicatorSeries(chart, seriesMapRef.current, placementRef.current, id);
      }
    };
  }, [chart, bars, configs, mainPriceScaleId, nonOverlayPaneStartIndex, maxNonOverlayPanes]);

  useEffect(() => {
    if (!chart) return;
    return () => {
      seriesMapRef.current = clearSeries(chart, seriesMapRef.current);
      cacheRef.current = {};
      placementRef.current = clearPlacementMap();
    };
  }, [chart]);
}
