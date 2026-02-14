import { ColorType, type DeepPartial, type ChartOptions } from "lightweight-charts";

export const terminalChartTheme: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: "#0c0f14" },
    textColor: "#d8dde7",
    fontFamily: "Consolas, IBM Plex Mono, Lucida Console, monospace",
    panes: {
      enableResize: true,
      separatorColor: "#2a2f3a",
      separatorHoverColor: "#f57c20",
    },
  },
  grid: {
    vertLines: { color: "#2a2f3a" },
    horzLines: { color: "#2a2f3a" },
  },
  crosshair: {
    vertLine: { color: "#8e98a8" },
    horzLine: { color: "#8e98a8" },
  },
  rightPriceScale: {
    borderColor: "#2a2f3a",
  },
  timeScale: {
    borderColor: "#2a2f3a",
    timeVisible: true,
    secondsVisible: false,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: true,
    mouseWheel: true,
    pinch: true,
  },
};
