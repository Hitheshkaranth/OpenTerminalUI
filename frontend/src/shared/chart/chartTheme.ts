import { ColorType, type DeepPartial, type ChartOptions } from "lightweight-charts";
import { terminalColors } from "../../theme/terminal";

export const terminalChartTheme: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: terminalColors.panel },
    textColor: terminalColors.text,
    fontFamily: "Consolas, IBM Plex Mono, Lucida Console, monospace",
    panes: {
      enableResize: true,
      separatorColor: terminalColors.border,
      separatorHoverColor: terminalColors.accentAlt,
    },
  },
  grid: {
    vertLines: { color: terminalColors.border },
    horzLines: { color: terminalColors.border },
  },
  crosshair: {
    vertLine: { color: terminalColors.muted },
    horzLine: { color: terminalColors.muted },
  },
  rightPriceScale: {
    borderColor: terminalColors.border,
  },
  timeScale: {
    borderColor: terminalColors.border,
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
