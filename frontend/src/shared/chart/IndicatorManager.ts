import { indicatorRegistry } from "lightweight-charts-indicators";
import type { Bar, IndicatorResult } from "oakscriptjs";

import type { IndicatorRegistryView } from "./types";

export const INDICATOR_CATEGORIES: Record<string, string[]> = {
  "Moving Averages": ["sma", "ema", "wma", "dema", "tema", "hma", "vwma", "alma", "ma-cross", "ma-ribbon"],
  Oscillators: ["rsi", "stochastic", "stoch-rsi", "cci", "williams-r", "awesome-oscillator", "fisher-transform", "ultimate-oscillator"],
  Momentum: ["macd", "momentum", "roc", "bop", "trix", "coppock-curve", "price-oscillator"],
  Trend: ["adx", "dmi", "ichimoku", "parabolic-sar", "supertrend", "aroon", "williams-alligator", "vortex"],
  Volatility: ["atr", "bb", "keltner", "donchian", "bb-bandwidth", "historical-volatility"],
  Volume: ["obv", "mfi", "pvt", "volume-oscillator", "chaikin-mf", "klinger"],
};

export function listIndicators(): IndicatorRegistryView[] {
  return indicatorRegistry.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    overlay: Boolean(i.overlay),
    defaultInputs: (i.defaultInputs ?? {}) as Record<string, unknown>,
  }));
}

export function computeIndicator(id: string, bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const indicator = indicatorRegistry.find((i) => i.id === id);
  if (!indicator) {
    throw new Error(`Unknown indicator: ${id}`);
  }
  const merged = { ...(indicator.defaultInputs ?? {}), ...(params ?? {}) };
  return indicator.calculate(bars, merged) as IndicatorResult;
}

export function getIndicatorDefaults(id: string): { params: Record<string, unknown>; overlay: boolean } {
  const indicator = indicatorRegistry.find((i) => i.id === id);
  return {
    params: (indicator?.defaultInputs ?? {}) as Record<string, unknown>,
    overlay: Boolean(indicator?.overlay),
  };
}
