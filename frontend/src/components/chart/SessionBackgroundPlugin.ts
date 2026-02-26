
import { IChartApi, UTCTimestamp } from "lightweight-charts";
import { ExtendedHoursConfig } from "../../store/chartWorkstationStore";

export interface ExtendedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: "pre" | "rth" | "post" | "pre_open" | "closing";
  isExtended: boolean;
}

export function drawSessionBackgrounds(
  chart: IChartApi,
  bars: ExtendedBar[],
  config: ExtendedHoursConfig
) {
  if (!config.enabled) return;

  // Lightweight-charts doesn't have a built-in background rectangle primitive
  // that spans the entire price range easily without an extra series.
  // One common trick is to use an AreaSeries with very low opacity or
  // to use the 'markers' (though they are usually points).

  // For simplicity in this implementation, we will use markers to label sessions
  // and vertical lines at transitions.

  let prevSession: string | null = null;
  const markers = [];

  for (const bar of bars) {
    if (prevSession && prevSession !== bar.session) {
       markers.push({
          time: bar.time as UTCTimestamp,
          position: "aboveBar" as const,
          color: "rgba(150, 150, 150, 0.4)",
          shape: "arrowDown" as const,
          text: bar.session.toUpperCase(),
          size: 0,
       });
    }
    prevSession = bar.session;
  }

  // We can't easily return markers here if we want to combine with other markers,
  // so we might need a better way to integrate.
  return markers;
}
