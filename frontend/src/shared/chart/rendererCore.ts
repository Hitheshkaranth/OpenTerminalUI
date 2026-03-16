import type { UTCTimestamp } from "lightweight-charts";

import { terminalColors } from "../../theme/terminal";
import type { ExtendedHoursConfig } from "../../store/chartWorkstationStore";
import {
  buildEnhancedCandle,
  buildEnhancedVolumeBar,
} from "./candlePresentation";

export type RendererBarInput = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  session?: string;
  s?: string;
  isExtended?: boolean;
  ext?: boolean;
};

export type SessionShadePalette = {
  pre: string;
  regular: string;
  post: string;
};

export type SessionAreaPoint =
  | { time: UTCTimestamp }
  | { time: UTCTimestamp; value: number };

export type CorePriceSeriesPayload = {
  candles: Array<ReturnType<typeof buildEnhancedCandle>>;
  closeLine: Array<{ time: UTCTimestamp; value: number }>;
  volume: Array<ReturnType<typeof buildEnhancedVolumeBar>>;
  sessionShading: Array<{ time: UTCTimestamp; value: number; color: string }>;
  preSessionArea: SessionAreaPoint[];
  postSessionArea: SessionAreaPoint[];
};

export type CorePriceSeriesUpdate = {
  candle: ReturnType<typeof buildEnhancedCandle>;
  closePoint: { time: UTCTimestamp; value: number };
  volumePoint: ReturnType<typeof buildEnhancedVolumeBar>;
  sessionShadingPoint: { time: UTCTimestamp; value: number; color: string };
  preSessionAreaPoint: SessionAreaPoint;
  postSessionAreaPoint: SessionAreaPoint;
};

export const SESSION_SHADING_VALUE = 1_000_000_000;

export const TRADING_SESSION_SHADE_PALETTE: SessionShadePalette = {
  pre: "rgba(59, 143, 249, 0.28)",
  regular: "rgba(148, 163, 184, 0.06)",
  post: "rgba(155, 89, 182, 0.28)",
};

export const COMPACT_SESSION_SHADE_PALETTE: SessionShadePalette = {
  pre: "rgba(59, 143, 249, 0.16)",
  regular: "rgba(148, 163, 184, 0.045)",
  post: "rgba(155, 89, 182, 0.16)",
};

type CoreSeriesOptions = {
  extendedHours?: ExtendedHoursConfig;
  showSessionShading?: boolean;
  includeSessionAreas?: boolean;
  shadePalette?: SessionShadePalette;
};

type NormalizedRendererBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session?: string;
  isExtended: boolean;
};

function normalizeRendererBar(input: RendererBarInput): NormalizedRendererBar {
  return {
    time: Number(input.time),
    open: Number(input.open),
    high: Number(input.high),
    low: Number(input.low),
    close: Number(input.close),
    volume: Number(input.volume ?? 0),
    session: input.session ?? input.s,
    isExtended: Boolean(input.isExtended ?? input.ext),
  };
}

function buildSessionAreaPoint(
  time: number,
  value: number,
  active: boolean,
): SessionAreaPoint {
  return active
    ? { time: time as UTCTimestamp, value }
    : { time: time as UTCTimestamp };
}

export function isPreSession(session: string | undefined): boolean {
  return session === "pre" || session === "pre_open";
}

export function isPostSession(session: string | undefined): boolean {
  return session === "post" || session === "closing";
}

export function resolveSessionShadeColor(
  session: string | undefined,
  extendedHours?: ExtendedHoursConfig,
  palette: SessionShadePalette = TRADING_SESSION_SHADE_PALETTE,
): string {
  const normalized = String(session || "rth");
  if (isPreSession(normalized)) {
    if (extendedHours?.enabled && !extendedHours.showPreMarket) return "transparent";
    return palette.pre;
  }
  if (isPostSession(normalized)) {
    if (extendedHours?.enabled && !extendedHours.showAfterHours) return "transparent";
    return palette.post;
  }
  return palette.regular;
}

export function hasVisibleSessionShading(
  data: readonly RendererBarInput[],
  extendedHours?: ExtendedHoursConfig,
): boolean {
  if (!data.length) return false;
  const hasTaggedSessions = data.some((row) => {
    const session = row.session ?? row.s;
    return typeof session === "string" && session !== "rth";
  });
  if (!hasTaggedSessions) return false;
  if (!extendedHours?.enabled) return true;
  return Boolean(extendedHours.showPreMarket || extendedHours.showAfterHours);
}

export function buildSessionAreaMask(
  data: readonly RendererBarInput[],
  predicate: (session: string | undefined) => boolean,
): SessionAreaPoint[] {
  return data.map((row) => {
    const time = Number(row.time);
    const value = Number(row.close);
    return buildSessionAreaPoint(time, value, predicate(row.session ?? row.s));
  });
}

export function buildCorePriceSeriesPayload(
  data: readonly RendererBarInput[],
  options: CoreSeriesOptions = {},
): CorePriceSeriesPayload {
  const size = data.length;
  const candles = new Array(size) as CorePriceSeriesPayload["candles"];
  const closeLine = new Array(size) as CorePriceSeriesPayload["closeLine"];
  const volume = new Array(size) as CorePriceSeriesPayload["volume"];
  const sessionShading = new Array(size) as CorePriceSeriesPayload["sessionShading"];
  const preSessionArea = options.includeSessionAreas ? new Array(size) as SessionAreaPoint[] : [];
  const postSessionArea = options.includeSessionAreas ? new Array(size) as SessionAreaPoint[] : [];
  let previousClose: number | null = null;
  const showSessionShading = Boolean(options.showSessionShading);

  for (let index = 0; index < size; index += 1) {
    const row = data[index]!;
    const normalized = normalizeRendererBar(row);
    candles[index] = (
      buildEnhancedCandle(
        normalized,
        previousClose,
        { up: terminalColors.candleUp, down: terminalColors.candleDown },
        options.extendedHours,
      )
    );
    closeLine[index] = {
      time: normalized.time as UTCTimestamp,
      value: normalized.close,
    };
    volume[index] = (
      buildEnhancedVolumeBar(
        normalized,
        previousClose,
        { up: terminalColors.candleUp, down: terminalColors.candleDown },
        options.extendedHours,
      )
    );
    sessionShading[index] = {
      time: normalized.time as UTCTimestamp,
      value: showSessionShading ? SESSION_SHADING_VALUE : 0,
      color: showSessionShading
        ? resolveSessionShadeColor(normalized.session, options.extendedHours, options.shadePalette)
        : "transparent",
    };

    if (options.includeSessionAreas) {
      preSessionArea[index] = buildSessionAreaPoint(normalized.time, normalized.close, isPreSession(normalized.session));
      postSessionArea[index] = buildSessionAreaPoint(normalized.time, normalized.close, isPostSession(normalized.session));
    }

    previousClose = normalized.close;
  }

  return {
    candles,
    closeLine,
    volume,
    sessionShading,
    preSessionArea,
    postSessionArea,
  };
}

export function buildCorePriceSeriesUpdate(
  data: readonly RendererBarInput[],
  options: CoreSeriesOptions = {},
): CorePriceSeriesUpdate | null {
  if (!data.length) return null;
  const last = normalizeRendererBar(data[data.length - 1]);
  const previousClose = data.length > 1 ? Number(data[data.length - 2]?.close) : null;

  return {
    candle: buildEnhancedCandle(
      last,
      previousClose,
      { up: terminalColors.candleUp, down: terminalColors.candleDown },
      options.extendedHours,
    ),
    closePoint: {
      time: last.time as UTCTimestamp,
      value: last.close,
    },
    volumePoint: buildEnhancedVolumeBar(
      last,
      previousClose,
      { up: terminalColors.candleUp, down: terminalColors.candleDown },
      options.extendedHours,
    ),
    sessionShadingPoint: {
      time: last.time as UTCTimestamp,
      value: options.showSessionShading ? SESSION_SHADING_VALUE : 0,
      color: options.showSessionShading
        ? resolveSessionShadeColor(last.session, options.extendedHours, options.shadePalette)
        : "transparent",
    },
    preSessionAreaPoint: buildSessionAreaPoint(last.time, last.close, Boolean(options.includeSessionAreas && isPreSession(last.session))),
    postSessionAreaPoint: buildSessionAreaPoint(last.time, last.close, Boolean(options.includeSessionAreas && isPostSession(last.session))),
  };
}
