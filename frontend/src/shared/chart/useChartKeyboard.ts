import { useEffect } from "react";
import type { ChartTimeframe } from "./types";

const TIMEFRAME_CYCLE: ChartTimeframe[] = ["1m", "5m", "15m", "1h", "1D", "1W"];

interface ChartKeyboardActions {
  onCycleTimeframe?: (next: ChartTimeframe, current: ChartTimeframe) => void;
  onToggleIndicators?: () => void;
  onToggleCompare?: () => void;
  onToggleDrawing?: () => void;
  onFullscreen?: () => void;
  onExportPng?: () => void;
  onExportCsv?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  currentTimeframe: ChartTimeframe;
  enabled?: boolean;
}

export function useChartKeyboard(actions: ChartKeyboardActions) {
  useEffect(() => {
    if (actions.enabled === false) return;

    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key.toLowerCase()) {
        case "t":
          if (!e.ctrlKey && !e.metaKey) {
            const idx = TIMEFRAME_CYCLE.indexOf(actions.currentTimeframe);
            const next = TIMEFRAME_CYCLE[(idx + 1) % TIMEFRAME_CYCLE.length];
            actions.onCycleTimeframe?.(next, actions.currentTimeframe);
          }
          break;
        case "i":
          if (!e.ctrlKey && !e.metaKey) actions.onToggleIndicators?.();
          break;
        case "c":
          if (!e.ctrlKey && !e.metaKey) actions.onToggleCompare?.();
          break;
        case "d":
          if (!e.ctrlKey && !e.metaKey) actions.onToggleDrawing?.();
          break;
        case "f":
          if (!e.ctrlKey && !e.metaKey) actions.onFullscreen?.();
          break;
        case "s":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) actions.onExportCsv?.();
            else actions.onExportPng?.();
          }
          break;
        case "[":
          actions.onZoomOut?.();
          break;
        case "]":
          actions.onZoomIn?.();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}
