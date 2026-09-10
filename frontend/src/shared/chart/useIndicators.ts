import { useEffect, useMemo, useRef, useCallback } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { Bar } from "oakscriptjs";

import { computeIndicator } from "./IndicatorManager";
import { resolveIndicatorPaneKey } from "./indicatorCatalog";
import type { IndicatorConfig } from "./types";
import { terminalColors } from "../../theme/terminal";

type SeriesMap = Record<string, Record<string, ISeriesApi<"Line", Time>>>;
type CacheMeta = Record<string, { length: number; lastTime: number | null }>;
type SeriesPlacementMap = Record<string, Record<string, { paneIndex: number; priceScaleId: string }>>;

type ComputedIndicator = {
  instanceId: string;
  plots: Record<string, Array<{ time: unknown; value: unknown }>>;
  metadata: Record<string, unknown> | undefined;
  placement: ReturnType<typeof resolveIndicatorPaneKey>;
  paneIndex: number;
  priceScaleId: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeMetadata(value: any): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

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

/**
 * Memoizes indicator computation so that when bars don't change,
 * we avoid re-computing indicator values on every render.
 */
function computeIndicatorData(
  configs: IndicatorConfig[],
  bars: Bar[],
  nonOverlayPaneStartIndex: number,
  maxNonOverlayPanes: number,
  mainPriceScaleId: string,
): ComputedIndicator[] {
  const paneAssignments = new Map<string, number>();
  const results: ComputedIndicator[] = [];

  for (const cfg of configs.filter((c) => c.visible)) {
    let result: ReturnType<typeof computeIndicator>;
    try {
      result = computeIndicator(cfg.id, bars, cfg.params);
    } catch {
      continue;
    }
    const defaultOverlay = Boolean(result.metadata?.overlay) && !forceSeparatePane(cfg.id);
    const placement = resolveIndicatorPaneKey(cfg, defaultOverlay);

    let paneIndex = 0;
    if (!placement.overlay) {
      const paneKey = placement.paneKey || `auto:${cfg.id}`;
      let assignedPaneIndex = paneAssignments.get(paneKey);
      if (assignedPaneIndex === undefined) {
        if (paneAssignments.size >= maxNonOverlayPanes) {
          continue;
        }
        assignedPaneIndex = nonOverlayPaneStartIndex + paneAssignments.size;
        paneAssignments.set(paneKey, assignedPaneIndex);
      }
      paneIndex = assignedPaneIndex;
    }

    const priceScaleId =
      placement.scaleBehavior === "separate"
        ? `indicator-scale:${placement.paneKey ?? "overlay"}:${normalizeIndicatorId(cfg.instanceId)}`
        : placement.overlay
          ? mainPriceScaleId
          : "right";

    results.push({
      instanceId: cfg.instanceId,
      plots: result.plots ?? {},
      metadata: safeMetadata(result.metadata),
      placement,
      paneIndex,
      priceScaleId,
    });
  }

  return results;
}

/**
 * Memoized cleanup function for when a config is removed.
 */
const buildRemoveCallback = (
  chart: IChartApi,
  seriesMap: SeriesMap,
  placementMap: SeriesPlacementMap,
  removedIds: string[],
): (() => void) => {
  return () => {
    for (const id of removedIds) {
      removeIndicatorSeries(chart, seriesMap, placementMap, id);
    }
  };
};

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

  // Memoize the set of active (visible) indicator instance IDs
  const activeConfigIds = useMemo(
    () => new Set(configs.filter((c) => c.visible).map((c) => c.instanceId)),
    [configs],
  );

  // Memoize the computed indicator data — only recompute when bars or visible configs change
  const computedIndicators = useMemo(
    () => computeIndicatorData(configs, bars, nonOverlayPaneStartIndex, maxNonOverlayPanes, mainPriceScaleId),
    [configs, bars, nonOverlayPaneStartIndex, maxNonOverlayPanes, mainPriceScaleId],
  );

  // Memoize the cleanup function for removing indicator series
  const buildRemoveSeriesCallback = useCallback(
    (inactiveIds: string[]) => {
      return buildRemoveCallback(chart!, seriesMapRef.current, placementRef.current, inactiveIds);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // chart ref doesn't change identity, and we guard with `if (!chart) return`
  );

  // Remove indicator series when configs change — only run when chart is available
  useEffect(() => {
    if (!chart) return;
    const existingIds = new Set(Object.keys(seriesMapRef.current));
    const inactiveIds = Array.from(existingIds).filter((id) => !activeConfigIds.has(id));
    if (inactiveIds.length > 0) {
      for (const id of inactiveIds) {
        removeIndicatorSeries(chart, seriesMapRef.current, placementRef.current, id);
        delete cacheRef.current[id];
      }
    }
  }, [chart, activeConfigIds]);

  // Apply indicator series when chart and data are ready
  useEffect(() => {
    if (!chart || !bars.length || computedIndicators.length === 0) return;

    const nonOverlayPaneIndexes: number[] = [];
    // Keep price pane dominant while leaving room for non-overlay indicators.
    chart.panes()[0]?.setStretchFactor(8);
    chart.panes()[1]?.setStretchFactor(2);

    for (const indicator of computedIndicators) {
      const { instanceId, plots, placement, paneIndex, priceScaleId } = indicator;
      const key = instanceId;

      if (!seriesMapRef.current[key]) {
        seriesMapRef.current[key] = {};
      }
      if (!placementRef.current[key]) {
        placementRef.current[key] = {};
      }

      const existingPlotIds = new Set(Object.keys(seriesMapRef.current[key]));
      const incomingPlotIds = new Set(Object.keys(plots));

      // Remove stale series
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

      // Create or update series for each plot
      for (const [plotId, rawPoints] of Object.entries(plots)) {
        const points = toPlotData(rawPoints as Array<{ time: unknown; value: unknown }>);
        if (!points.length) continue;
        points.sort((a, b) => Number(a.time) - Number(b.time));

        let series: ISeriesApi<"Line", Time> | undefined = seriesMapRef.current[key][plotId];
        const placementMeta = placementRef.current[key][plotId];
        const placementChanged =
          placementMeta?.paneIndex !== paneIndex || placementMeta?.priceScaleId !== priceScaleId;

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
                color: placement.overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane,
                lineWidth: 2,
                lastValueVisible: true,
                priceScaleId,
              },
              paneIndex,
            );
          } catch {
            continue;
          }
          seriesMapRef.current[key][plotId] = series;
          placementRef.current[key][plotId] = { paneIndex, priceScaleId };
          try {
            series.setData(points);
            series.applyOptions({
              color: placement.overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane,
              lineWidth: 2,
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
            chart.panes()[paneIndex]?.setStretchFactor(1);
            if (!nonOverlayPaneIndexes.includes(paneIndex)) {
              nonOverlayPaneIndexes.push(paneIndex);
            }
          }
          continue;
        }

        try {
          series.applyOptions({
            color: placement.overlay ? terminalColors.indicatorOverlay : terminalColors.indicatorPane,
            lineWidth: 2,
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

    // Adjust pane stretch factors for non-overlay indicators
    if (nonOverlayPaneIndexes.length > 0) {
      chart.panes()[0]?.setStretchFactor(12);
      chart.panes()[1]?.setStretchFactor(2);
      for (const idx of nonOverlayPaneIndexes) {
        chart.panes()[idx]?.setStretchFactor(1);
      }
    }

    return () => {
      if (!chart) return;
      const visible = new Set(computedIndicators.map((c) => c.instanceId));
      for (const id of Object.keys(seriesMapRef.current)) {
        if (visible.has(id)) continue;
        removeIndicatorSeries(chart, seriesMapRef.current, placementRef.current, id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, bars, computedIndicators, mainPriceScaleId, nonOverlayPaneStartIndex, maxNonOverlayPanes]);

  // Cleanup on unmount
  useEffect(() => {
    if (!chart) return;
    return () => {
      seriesMapRef.current = clearSeries(chart, seriesMapRef.current);
      cacheRef.current = {};
      placementRef.current = clearPlacementMap();
    };
  }, [chart]);
}