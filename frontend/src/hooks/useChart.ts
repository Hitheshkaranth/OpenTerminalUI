import { useCallback, useEffect, useRef, useState } from "react";

import { useChartStore } from "../store/chartStore";
import type { ChartKind, ChartTimeframe } from "../shared/chart/types";

type ChartLifecycleState = "unmounted" | "initializing" | "ready" | "error";

type UseChartReturn = {
  state: ChartLifecycleState;
  chartId: string | null;
  symbol: string;
  timeframe: ChartTimeframe;
  chartType: ChartKind;
  setSymbol: (symbol: string) => void;
  setTimeframe: (tf: ChartTimeframe) => void;
  setChartType: (type: ChartKind) => void;
  reset: () => void;
};

const CHART_ID_PREFIX = "chart-engine";
let chartIdCounter = 0;

export function useChart(): UseChartReturn {
  const [state, setState] = useState<ChartLifecycleState>("unmounted");
  const initializedRef = useRef(false);
  const mountedRef = useRef(false);

  const activeSymbol = useChartStore((s) => s.activeSymbol);
  const activeTimeframe = useChartStore((s) => s.activeTimeframe);
  const activeChartType = useChartStore((s) => s.activeChartType);
  const setActiveChart = useChartStore((s) => s.setActiveChart);
  const setActiveSymbol = useChartStore((s) => s.setActiveSymbol);
  const setActiveTimeframe = useChartStore((s) => s.setActiveTimeframe);
  const setActiveChartType = useChartStore((s) => s.setActiveChartType);
  const resetStore = useChartStore((s) => s.resetChart);

  const chartId = useRef(`${CHART_ID_PREFIX}-${++chartIdCounter}`);

  // Track store state changes to update local state for lifecycle management
  useEffect(() => {
    mountedRef.current = true;
    setState("initializing");
    setActiveChart(chartId.current);

    return () => {
      mountedRef.current = false;
      setState("unmounted");
      setActiveChart(chartId.current ?? "");
    };
  }, [setActiveChart]);

  // Sync symbol from store and from prop
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (activeSymbol) {
      setActiveSymbol(activeSymbol);
    }
  }, [activeSymbol, setActiveSymbol]);

  // Handle timeframe changes
  useEffect(() => {
    if (!mountedRef.current) return;
    setActiveTimeframe(activeTimeframe);
  }, [activeTimeframe, setActiveTimeframe]);

  // Handle chart type changes
  useEffect(() => {
    if (!mountedRef.current) return;
    setActiveChartType(activeChartType);
  }, [activeChartType, setActiveChartType]);

  // Mark as ready after initial mount
  useEffect(() => {
    if (state === "initializing" && mountedRef.current) {
      setState("ready");
    }
  }, [state]);

  const setSymbol = useCallback((symbol: string) => {
    if (!mountedRef.current) return;
    setActiveSymbol(symbol);
  }, [setActiveSymbol]);

  const setTimeframe = useCallback((tf: ChartTimeframe) => {
    if (!mountedRef.current) return;
    setActiveTimeframe(tf);
  }, [setActiveTimeframe]);

  const setChartType = useCallback((type: ChartKind) => {
    if (!mountedRef.current) return;
    setActiveChartType(type);
  }, [setActiveChartType]);

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    resetStore();
    setState("unmounted");
  }, [resetStore]);

  return {
    state,
    chartId: chartId.current,
    symbol: activeSymbol,
    timeframe: activeTimeframe,
    chartType: activeChartType,
    setSymbol,
    setTimeframe,
    setChartType,
    reset,
  };
}