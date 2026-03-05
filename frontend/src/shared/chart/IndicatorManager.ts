import { indicatorRegistry } from "lightweight-charts-indicators";
import type { Bar, IndicatorResult } from "oakscriptjs";

import type { IndicatorRegistryView } from "./types";

export const INDICATOR_CATEGORIES: Record<string, string[]> = {
  "Moving Averages": ["sma", "ema", "wma", "dema", "tema", "hma", "vwma", "alma", "ma-cross", "ma-ribbon", "session-vwap", "anchored-vwap"],
  Oscillators: ["rsi", "stochastic", "stoch-rsi", "cci", "williams-r", "awesome-oscillator", "fisher-transform", "ultimate-oscillator"],
  Momentum: ["macd", "momentum", "roc", "bop", "trix", "coppock-curve", "price-oscillator", "tsi", "ultimate-oscillator", "kdj"],
  Trend: ["adx", "dmi", "ichimoku", "parabolic-sar", "supertrend", "aroon", "williams-alligator", "vortex"],
  Volatility: ["atr", "bb", "keltner", "donchian", "bb-bandwidth", "historical-volatility", "stddev", "hv", "chaikin-volatility"],
  Volume: ["obv", "mfi", "pvt", "volume-oscillator", "chaikin-mf", "klinger"],
};

type CustomIndicator = {
  id: string;
  name: string;
  category: string;
  overlay: boolean;
  defaultInputs: Record<string, unknown>;
  calculate: (bars: Bar[], params: Record<string, unknown>) => IndicatorResult;
};

const TREND_NAME_OVERRIDES: Record<string, string> = {
  hma: "Hull MA",
  ichimoku: "Ichimoku Cloud",
  "parabolic-sar": "Parabolic SAR",
  supertrend: "Supertrend",
  adx: "ADX",
  aroon: "Aroon",
  vwma: "VWMA",
  dema: "DEMA",
  tema: "TEMA",
  wma: "WMA",
  ema: "EMA",
  sma: "SMA",
};

function toTimeValue(bars: Bar[], values: Array<number | null | undefined>) {
  const out: Array<{ time: number; value: number }> = [];
  const n = Math.min(bars.length, values.length);
  for (let i = 0; i < n; i += 1) {
    const raw = values[i];
    if (raw === null || raw === undefined) continue;
    const t = Number(bars[i].time);
    const v = Number(raw);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    out.push({ time: t, value: v });
  }
  return out;
}

function closeSeries(bars: Bar[]): number[] {
  return bars.map((b) => Number(b.close));
}

function findRegistryIndicator(id: string) {
  const indicator = indicatorRegistry.find((i) => i.id === id);
  if (!indicator) {
    throw new Error(`Unknown indicator: ${id}`);
  }
  return indicator;
}

function computeRegistryIndicatorById(id: string, bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const indicator = findRegistryIndicator(id);
  const merged = { ...(indicator.defaultInputs ?? {}), ...(params ?? {}) };
  return indicator.calculate(bars, merged) as IndicatorResult;
}

function computeKama(bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const period = Math.max(2, Number(params.period ?? 10));
  const fastPeriod = Math.max(1, Number(params.fastPeriod ?? 2));
  const slowPeriod = Math.max(fastPeriod + 1, Number(params.slowPeriod ?? 30));
  const closes = closeSeries(bars);
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length < period) {
    return {
      metadata: { title: "KAMA", overlay: true },
      plots: { kama: [] },
    };
  }
  const fastSC = 2 / (fastPeriod + 1);
  const slowSC = 2 / (slowPeriod + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) {
    seed += closes[i];
  }
  out[period - 1] = seed / period;

  const diffPrefix = new Array<number>(closes.length + 1).fill(0);
  for (let i = 1; i < closes.length; i += 1) {
    diffPrefix[i + 1] = diffPrefix[i] + Math.abs(closes[i] - closes[i - 1]);
  }

  for (let i = period; i < closes.length; i += 1) {
    const prev = out[i - 1] ?? closes[i - 1];
    const change = Math.abs(closes[i] - closes[i - period]);
    const volatility = diffPrefix[i + 1] - diffPrefix[i - period + 1];
    const er = volatility > 0 ? change / volatility : 0;
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
    out[i] = prev + sc * (closes[i] - prev);
  }

  return {
    metadata: {
      title: "KAMA",
      overlay: true,
      inputs: [
        { type: "int", name: "period", title: "Period", defval: period },
        { type: "int", name: "fastPeriod", title: "Fast", defval: fastPeriod },
        { type: "int", name: "slowPeriod", title: "Slow", defval: slowPeriod },
      ],
      plots: [{ varName: "kama", title: "KAMA", color: "#4ea1ff", linewidth: 2, style: "line" }],
    },
    plots: {
      kama: toTimeValue(bars, out),
    },
  };
}

function computeLinearRegressionChannel(bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const period = Math.max(2, Number(params.period ?? 100));
  const stdDevMultiplier = Math.max(0, Number(params.stdDevMultiplier ?? 2));
  const closes = closeSeries(bars);
  const center: Array<number | null> = Array(closes.length).fill(null);
  const upper: Array<number | null> = Array(closes.length).fill(null);
  const lower: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length < period) {
    return {
      metadata: {
        title: "Linear Regression Channel",
        overlay: true,
      },
      plots: { center: [], upper: [], lower: [] },
    };
  }

  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  const denom = n * sumX2 - sumX * sumX;

  const prefixY = new Array<number>(closes.length + 1).fill(0);
  const prefixY2 = new Array<number>(closes.length + 1).fill(0);
  for (let i = 0; i < closes.length; i += 1) {
    prefixY[i + 1] = prefixY[i] + closes[i];
    prefixY2[i + 1] = prefixY2[i] + closes[i] * closes[i];
  }

  let sumXY = 0;
  for (let i = 0; i < n; i += 1) {
    sumXY += i * closes[i];
  }

  for (let i = n - 1; i < closes.length; i += 1) {
    const start = i - n + 1;
    const sumY = prefixY[i + 1] - prefixY[start];
    const sumY2 = prefixY2[i + 1] - prefixY2[start];
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;
    const regLast = intercept + slope * (n - 1);
    const sse =
      sumY2 +
      n * intercept * intercept +
      slope * slope * sumX2 +
      2 * intercept * slope * sumX -
      2 * intercept * sumY -
      2 * slope * sumXY;
    const stdDev = Math.sqrt(Math.max(0, sse / n));
    center[i] = regLast;
    upper[i] = regLast + stdDevMultiplier * stdDev;
    lower[i] = regLast - stdDevMultiplier * stdDev;

    if (i + 1 < closes.length) {
      const leaving = closes[start];
      const entering = closes[i + 1];
      sumXY = sumXY - sumY + leaving + (n - 1) * entering;
    }
  }

  return {
    metadata: {
      title: "Linear Regression Channel",
      overlay: true,
      inputs: [
        { type: "int", name: "period", title: "Period", defval: period },
        { type: "float", name: "stdDevMultiplier", title: "StdDev", defval: stdDevMultiplier },
      ],
      plots: [
        { varName: "center", title: "Center", color: "#4ea1ff", linewidth: 2, style: "line" },
        { varName: "upper", title: "Upper", color: "#ffb74d", linewidth: 1, style: "line" },
        { varName: "lower", title: "Lower", color: "#ffb74d", linewidth: 1, style: "line" },
      ],
    },
    plots: {
      center: toTimeValue(bars, center),
      upper: toTimeValue(bars, upper),
      lower: toTimeValue(bars, lower),
    },
  };
}

function computeKdj(bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const period = Math.max(2, Number(params.period ?? 9));
  const kPeriod = Math.max(1, Number(params.kPeriod ?? 3));
  const dPeriod = Math.max(1, Number(params.dPeriod ?? 3));
  const kValues: number[] = [];
  const dValues: number[] = [];
  const jValues: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const start = Math.max(0, i - period + 1);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = start; j <= i; j += 1) {
      const high = Number(bars[j].high);
      const low = Number(bars[j].low);
      if (Number.isFinite(high) && high > highest) highest = high;
      if (Number.isFinite(low) && low < lowest) lowest = low;
    }
    const close = Number(bars[i].close);
    const rsv = highest > lowest ? ((close - lowest) / (highest - lowest)) * 100 : 50;
    const prevK = i > 0 ? kValues[i - 1] : 50;
    const prevD = i > 0 ? dValues[i - 1] : 50;
    const k = ((kPeriod - 1) * prevK + rsv) / kPeriod;
    const d = ((dPeriod - 1) * prevD + k) / dPeriod;
    const j = 3 * k - 2 * d;
    kValues.push(k);
    dValues.push(d);
    jValues.push(j);
  }
  return {
    metadata: {
      title: "KDJ",
      overlay: false,
      inputs: [
        { type: "int", name: "period", title: "Period", defval: period },
        { type: "int", name: "kPeriod", title: "K Smooth", defval: kPeriod },
        { type: "int", name: "dPeriod", title: "D Smooth", defval: dPeriod },
      ],
      plots: [
        { varName: "k", title: "K", color: "#4ea1ff", linewidth: 2, style: "line" },
        { varName: "d", title: "D", color: "#ffb74d", linewidth: 2, style: "line" },
        { varName: "j", title: "J", color: "#f06292", linewidth: 1, style: "line" },
      ],
    },
    plots: {
      k: toTimeValue(bars, kValues),
      d: toTimeValue(bars, dValues),
      j: toTimeValue(bars, jValues),
    },
  };
}

function computeChaikinVolatility(bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const emaPeriod = Math.max(1, Number(params.emaPeriod ?? 10));
  const rocPeriod = Math.max(1, Number(params.rocPeriod ?? 10));
  const ranges = bars.map((b) => Number(b.high) - Number(b.low));
  if (bars.length < 2 || ranges.some((r) => !Number.isFinite(r))) {
    return {
      metadata: { title: "Chaikin Volatility", overlay: false },
      plots: { chaikinVolatility: [] },
    };
  }

  const alpha = 2 / (emaPeriod + 1);
  const ema = new Array<number>(ranges.length).fill(NaN);
  ema[0] = ranges[0];
  for (let i = 1; i < ranges.length; i += 1) {
    ema[i] = ema[i - 1] + alpha * (ranges[i] - ema[i - 1]);
  }

  const out: Array<number | null> = new Array(ranges.length).fill(null);
  for (let i = rocPeriod; i < ranges.length; i += 1) {
    const prev = ema[i - rocPeriod];
    if (!Number.isFinite(prev) || prev === 0) {
      out[i] = 0;
      continue;
    }
    out[i] = ((ema[i] - prev) / Math.abs(prev)) * 100;
  }

  return {
    metadata: {
      title: "Chaikin Volatility",
      overlay: false,
      inputs: [
        { type: "int", name: "emaPeriod", title: "EMA", defval: emaPeriod },
        { type: "int", name: "rocPeriod", title: "ROC", defval: rocPeriod },
      ],
      plots: [{ varName: "chaikinVolatility", title: "Chaikin Volatility", color: "#4ea1ff", linewidth: 2, style: "line" }],
    },
    plots: {
      chaikinVolatility: toTimeValue(bars, out),
    },
  };
}

function computeSessionVwap(bars: Bar[]): IndicatorResult {
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  let lastSessionKey: string | null = null;
  const out: number[] = [];
  for (const bar of bars) {
    const t = Number(bar.time);
    const sessionKey = Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : null;
    if (sessionKey && sessionKey !== lastSessionKey) {
      cumulativePV = 0;
      cumulativeVolume = 0;
      lastSessionKey = sessionKey;
    }
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const volume = Math.max(0, Number(bar.volume));
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) {
      out.push(out.length ? out[out.length - 1] : 0);
      continue;
    }
    const typical = (high + low + close) / 3;
    cumulativePV += typical * volume;
    cumulativeVolume += volume;
    out.push(cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : typical);
  }
  return {
    metadata: {
      title: "Session VWAP",
      overlay: true,
      plots: [{ varName: "vwap", title: "VWAP", color: "#f9a825", linewidth: 2, style: "line" }],
    },
    plots: { vwap: toTimeValue(bars, out) },
  };
}

function computeAnchoredVwap(bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const anchorBars = Math.max(1, Math.floor(Number(params.anchorBars ?? 50)));
  if (!bars.length) {
    return {
      metadata: { title: "Anchored VWAP", overlay: true },
      plots: { anchoredVwap: [] },
    };
  }
  const startIdx = Math.max(0, bars.length - anchorBars);
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  const out: Array<number | null> = new Array(bars.length).fill(null);
  for (let i = startIdx; i < bars.length; i += 1) {
    const bar = bars[i];
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const volume = Math.max(0, Number(bar.volume));
    const typical = (high + low + close) / 3;
    cumulativePV += typical * volume;
    cumulativeVolume += volume;
    out[i] = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : typical;
  }
  return {
    metadata: {
      title: "Anchored VWAP",
      overlay: true,
      inputs: [{ type: "int", name: "anchorBars", title: "Anchor Bars", defval: anchorBars }],
      plots: [{ varName: "anchoredVwap", title: "Anchored VWAP", color: "#ff7043", linewidth: 2, style: "line" }],
    },
    plots: { anchoredVwap: toTimeValue(bars, out) },
  };
}

const CUSTOM_INDICATORS: Record<string, CustomIndicator> = {
  kama: {
    id: "kama",
    name: "KAMA",
    category: "Trend",
    overlay: true,
    defaultInputs: { period: 10, fastPeriod: 2, slowPeriod: 30 },
    calculate: computeKama,
  },
  "linear-regression-channel": {
    id: "linear-regression-channel",
    name: "Linear Regression Channel",
    category: "Trend",
    overlay: true,
    defaultInputs: { period: 100, stdDevMultiplier: 2 },
    calculate: computeLinearRegressionChannel,
  },
  "ultimate-oscillator": {
    id: "ultimate-oscillator",
    name: "Ultimate Oscillator",
    category: "Momentum",
    overlay: false,
    defaultInputs: { period1: 7, period2: 14, period3: 28 },
    calculate: (bars, params) => {
      const result = computeRegistryIndicatorById("ultimate-osc", bars, params);
      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          title: "Ultimate Oscillator",
          overlay: false,
        },
      };
    },
  },
  kdj: {
    id: "kdj",
    name: "KDJ",
    category: "Momentum",
    overlay: false,
    defaultInputs: { period: 9, kPeriod: 3, dPeriod: 3 },
    calculate: computeKdj,
  },
  stddev: {
    id: "stddev",
    name: "Standard Deviation",
    category: "Volatility",
    overlay: false,
    defaultInputs: { period: 20 },
    calculate: (bars, params) => computeRegistryIndicatorById("stdev", bars, params),
  },
  "historical-volatility": {
    id: "historical-volatility",
    name: "Historical Volatility",
    category: "Volatility",
    overlay: false,
    defaultInputs: { period: 20, annualizationFactor: 252 },
    calculate: (bars, params) => computeRegistryIndicatorById("hist-volatility", bars, params),
  },
  hv: {
    id: "hv",
    name: "Historical Volatility",
    category: "Volatility",
    overlay: false,
    defaultInputs: { period: 20, annualizationFactor: 252 },
    calculate: (bars, params) => computeRegistryIndicatorById("hist-volatility", bars, params),
  },
  "chaikin-volatility": {
    id: "chaikin-volatility",
    name: "Chaikin Volatility",
    category: "Volatility",
    overlay: false,
    defaultInputs: { emaPeriod: 10, rocPeriod: 10 },
    calculate: computeChaikinVolatility,
  },
  "session-vwap": {
    id: "session-vwap",
    name: "Session VWAP",
    category: "Moving Averages",
    overlay: true,
    defaultInputs: {},
    calculate: (bars) => computeSessionVwap(bars),
  },
  "anchored-vwap": {
    id: "anchored-vwap",
    name: "Anchored VWAP",
    category: "Moving Averages",
    overlay: true,
    defaultInputs: { anchorBars: 50 },
    calculate: computeAnchoredVwap,
  },
};

type CustomJsIndicatorRecord = {
  id: string;
  name: string;
  category: string;
  overlay: boolean;
  defaultInputs: Record<string, unknown>;
  script: string;
};

export const CUSTOM_JS_INDICATORS_STORAGE_KEY = "chart:custom-js-indicators:v1";
export const CUSTOM_JS_INDICATORS_UPDATED_EVENT = "chart:custom-js-indicators:updated";

const MAX_CUSTOM_SCRIPT_LENGTH = 12000;
const DANGEROUS_SCRIPT_PATTERN =
  /\b(?:window|document|globalThis|Function|eval|XMLHttpRequest|fetch|WebSocket|importScripts|require|process|localStorage|sessionStorage|indexedDB)\b/;
const customJsRunnerCache = new Map<string, (bars: Bar[], params: Record<string, unknown>) => unknown>();

function sanitizeCustomId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function sanitizeCustomRecord(input: CustomJsIndicatorRecord): CustomJsIndicatorRecord {
  const rawId = String(input.id || input.name || "custom").trim().replace(/^custom-js:/i, "");
  const idPart = sanitizeCustomId(rawId);
  if (!idPart) throw new Error("Custom indicator id/name is required");
  return {
    id: `custom-js:${idPart}`,
    name: String(input.name || idPart).trim() || idPart,
    category: String(input.category || "Custom JS").trim() || "Custom JS",
    overlay: Boolean(input.overlay),
    defaultInputs: typeof input.defaultInputs === "object" && input.defaultInputs ? { ...input.defaultInputs } : {},
    script: String(input.script || ""),
  };
}

function emitCustomJsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CUSTOM_JS_INDICATORS_UPDATED_EVENT));
}

function readCustomJsIndicators(): CustomJsIndicatorRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_JS_INDICATORS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && typeof row === "object")
      .map((row) => sanitizeCustomRecord(row as CustomJsIndicatorRecord));
  } catch {
    return [];
  }
}

function writeCustomJsIndicators(rows: CustomJsIndicatorRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_JS_INDICATORS_STORAGE_KEY, JSON.stringify(rows));
  emitCustomJsUpdated();
}

function compileCustomJsRunner(spec: CustomJsIndicatorRecord): (bars: Bar[], params: Record<string, unknown>) => unknown {
  const script = String(spec.script || "").trim();
  if (!script) throw new Error("Custom indicator script is required");
  if (script.length > MAX_CUSTOM_SCRIPT_LENGTH) {
    throw new Error(`Custom script exceeds max length ${MAX_CUSTOM_SCRIPT_LENGTH}`);
  }
  if (DANGEROUS_SCRIPT_PATTERN.test(script)) {
    throw new Error("Custom script contains disallowed tokens");
  }
  const cacheKey = `${spec.id}|${script}`;
  const cached = customJsRunnerCache.get(cacheKey);
  if (cached) return cached;
  let calculateFn: unknown;
  try {
    const factory = new Function(
      `"use strict";\n${script}\n; if (typeof calculate !== "function") { throw new Error("Custom script must define calculate(bars, params)"); }\nreturn calculate;`,
    );
    calculateFn = factory();
  } catch (error) {
    throw new Error(`Custom script parse error: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (typeof calculateFn !== "function") {
    throw new Error("Custom script did not provide calculate(bars, params)");
  }
  const runner = (bars: Bar[], params: Record<string, unknown>) => (calculateFn as (rows: Bar[], p: Record<string, unknown>) => unknown)(bars, params);
  customJsRunnerCache.set(cacheKey, runner);
  return runner;
}

function sanitizeRuntimeResult(
  spec: CustomJsIndicatorRecord,
  bars: Bar[],
  runtimeResult: unknown,
): IndicatorResult {
  const empty: IndicatorResult = {
    metadata: { title: spec.name, overlay: spec.overlay },
    plots: { [spec.id]: [] },
  };
  if (!runtimeResult || typeof runtimeResult !== "object") return empty;
  const row = runtimeResult as Record<string, unknown>;
  const plotsRaw = (row.plots ?? {}) as Record<string, unknown>;
  const plots: Record<string, Array<{ time: number; value: number }>> = {};
  for (const [plotId, pointsRaw] of Object.entries(plotsRaw)) {
    if (!Array.isArray(pointsRaw)) continue;
    const points: Array<{ time: number; value: number }> = [];
    for (const point of pointsRaw) {
      if (!point || typeof point !== "object") continue;
      const p = point as Record<string, unknown>;
      const time = Number(p.time);
      const value = Number(p.value);
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      points.push({ time, value });
      if (points.length >= bars.length) break;
    }
    if (!points.length) continue;
    plots[String(plotId)] = points;
    if (Object.keys(plots).length >= 10) break;
  }
  if (!Object.keys(plots).length) return empty;
  return {
    metadata: {
      title: String((row.metadata as Record<string, unknown> | undefined)?.title || spec.name),
      overlay: spec.overlay,
    },
    plots,
  };
}

function computeCustomJsIndicator(spec: CustomJsIndicatorRecord, bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const runner = compileCustomJsRunner(spec);
  const mergedParams = { ...(spec.defaultInputs || {}), ...(params || {}) };
  let runtimeResult: unknown;
  try {
    runtimeResult = runner(bars, mergedParams);
  } catch (error) {
    throw new Error(`Custom script runtime error: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return sanitizeRuntimeResult(spec, bars, runtimeResult);
}

export function listCustomJsIndicators(): Array<Omit<CustomJsIndicatorRecord, "script">> {
  return readCustomJsIndicators().map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    overlay: row.overlay,
    defaultInputs: { ...(row.defaultInputs || {}) },
  }));
}

export function upsertCustomJsIndicator(input: CustomJsIndicatorRecord): CustomJsIndicatorRecord {
  const next = sanitizeCustomRecord(input);
  compileCustomJsRunner(next);
  const rows = readCustomJsIndicators();
  const filtered = rows.filter((row) => row.id !== next.id);
  filtered.push(next);
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  writeCustomJsIndicators(filtered);
  return next;
}

export function removeCustomJsIndicator(id: string): void {
  const raw = String(id || "").trim().toLowerCase();
  const targetId = raw.startsWith("custom-js:") ? raw : `custom-js:${sanitizeCustomId(raw)}`;
  const rows = readCustomJsIndicators();
  const next = rows.filter((row) => row.id !== targetId);
  writeCustomJsIndicators(next);
}

function registryView(): IndicatorRegistryView[] {
  const base = indicatorRegistry.map((i) => ({
    id: i.id,
    name: TREND_NAME_OVERRIDES[i.id] || i.name,
    category: i.category,
    overlay: Boolean(i.overlay),
    defaultInputs: (i.defaultInputs ?? {}) as Record<string, unknown>,
  }));
  const custom = Object.values(CUSTOM_INDICATORS).map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    overlay: i.overlay,
    defaultInputs: i.defaultInputs,
    isCustom: false,
  }));
  const customJs = readCustomJsIndicators().map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    overlay: row.overlay,
    defaultInputs: { ...(row.defaultInputs || {}) },
    isCustom: true,
  }));
  return [...base, ...custom, ...customJs].sort((a, b) => a.name.localeCompare(b.name));
}

export function listIndicators(): IndicatorRegistryView[] {
  return registryView();
}

export function computeIndicator(id: string, bars: Bar[], params: Record<string, unknown>): IndicatorResult {
  const custom = CUSTOM_INDICATORS[id];
  if (custom) {
    return custom.calculate(bars, { ...custom.defaultInputs, ...(params ?? {}) });
  }
  const customJs = readCustomJsIndicators().find((row) => row.id === id);
  if (customJs) {
    return computeCustomJsIndicator(customJs, bars, params);
  }
  return computeRegistryIndicatorById(id, bars, params);
}

export function getIndicatorDefaults(id: string): { params: Record<string, unknown>; overlay: boolean } {
  const custom = CUSTOM_INDICATORS[id];
  if (custom) {
    return { params: { ...custom.defaultInputs }, overlay: custom.overlay };
  }
  const customJs = readCustomJsIndicators().find((row) => row.id === id);
  if (customJs) {
    return { params: { ...(customJs.defaultInputs || {}) }, overlay: customJs.overlay };
  }
  const indicator = indicatorRegistry.find((i) => i.id === id);
  return {
    params: (indicator?.defaultInputs ?? {}) as Record<string, unknown>,
    overlay: Boolean(indicator?.overlay),
  };
}
