
import { ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { PreMarketLevelConfig } from "../../store/chartWorkstationStore";

interface ExtendedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session: string;
  isExtended: boolean;
}

export interface DayLevels {
  date: number;
  pmHigh: number;
  pmLow: number;
  pmOpen: number;
  pmClose: number;
  pmVolume: number;
}

export function calculatePreMarketLevels(bars: ExtendedBar[]): DayLevels[] {
  // Group bars by day (roughly, by checking gaps or session transitions)
  const days: DayLevels[] = [];
  let currentPM: ExtendedBar[] = [];
  let prevDate = "";

  for (const bar of bars) {
    const d = new Date(bar.time * 1000).toDateString();
    if (d !== prevDate) {
      if (currentPM.length > 0) {
        days.push({
          date: currentPM[0].time,
          pmHigh: Math.max(...currentPM.map(b => b.high)),
          pmLow: Math.min(...currentPM.map(b => b.low)),
          pmOpen: currentPM[0].open,
          pmClose: currentPM[currentPM.length - 1].close,
          pmVolume: currentPM.reduce((sum, b) => sum + b.volume, 0),
        });
        currentPM = [];
      }
      prevDate = d;
    }

    if (bar.session === "pre" || bar.session === "pre_open") {
      currentPM.push(bar);
    }
  }

  // Push last day
  if (currentPM.length > 0) {
     days.push({
          date: currentPM[0].time,
          pmHigh: Math.max(...currentPM.map(b => b.high)),
          pmLow: Math.min(...currentPM.map(b => b.low)),
          pmOpen: currentPM[0].open,
          pmClose: currentPM[currentPM.length - 1].close,
          pmVolume: currentPM.reduce((sum, b) => sum + b.volume, 0),
    });
  }

  return days;
}

export function drawPreMarketLevels(
  series: ISeriesApi<"Candlestick">,
  levels: DayLevels[],
  config: PreMarketLevelConfig
) {
  // In lightweight-charts, we use createPriceLine for horizontal lines.
  // Note: These usually span the entire chart.
  // If we want they to only span a certain range, we'd need to use a LineSeries with limited points.

  // For simplicity, we use global price lines for the most recent day's PM levels.
  if (levels.length === 0) return [];

  const last = levels[levels.length - 1];
  const priceLines = [];

  if (config.showPMHigh) {
    priceLines.push(series.createPriceLine({
      price: last.pmHigh,
      color: "rgba(38, 166, 91, 0.6)",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "PM HIGH",
    }));
  }

  if (config.showPMLow) {
    priceLines.push(series.createPriceLine({
      price: last.pmLow,
      color: "rgba(232, 65, 66, 0.6)",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "PM LOW",
    }));
  }

  return priceLines;
}
