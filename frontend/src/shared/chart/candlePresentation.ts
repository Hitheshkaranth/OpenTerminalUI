import type { UTCTimestamp } from "lightweight-charts";

export type CandlePresentationInput = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  session?: string;
  isExtended?: boolean;
};

export type ExtendedHoursPresentation = {
  enabled?: boolean;
  colorScheme?: "dimmed" | "distinct" | "same";
};

type ColorSet = {
  up: string;
  down: string;
};

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const RGBA_CACHE = new Map<string, string>();

function toRgba(hexColor: string, alpha: number): string {
  const raw = String(hexColor || "").trim();
  if (raw.startsWith("rgba(") || raw.startsWith("rgb(")) return raw;
  const cacheKey = `${raw}|${alpha}`;
  const cached = RGBA_CACHE.get(cacheKey);
  if (cached) return cached;
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (normalized.length !== 6) return raw;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return raw;
  const value = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  RGBA_CACHE.set(cacheKey, value);
  return value;
}

function sessionDistinctColor(session: string | undefined): string | null {
  if (session === "pre" || session === "pre_open") return "#5B8FF9";
  if (session === "post" || session === "closing") return "#9B59B6";
  return null;
}

function directionalColor(point: CandlePresentationInput, prevClose: number | null, palette: ColorSet): string {
  if (prevClose === null || !Number.isFinite(prevClose)) {
    return point.close >= point.open ? palette.up : palette.down;
  }
  return point.close >= prevClose ? palette.up : palette.down;
}

function renderColorForBar(
  point: CandlePresentationInput,
  prevClose: number | null,
  palette: ColorSet,
  extendedHours?: ExtendedHoursPresentation,
): string {
  const direction = directionalColor(point, prevClose, palette);
  if (!extendedHours?.enabled || !point.isExtended) return direction;
  if (extendedHours.colorScheme === "distinct") {
    return sessionDistinctColor(point.session) ?? direction;
  }
  return toRgba(direction, 0.5);
}

export function buildEnhancedCandle(
  point: CandlePresentationInput,
  prevClose: number | null,
  palette: ColorSet,
  extendedHours?: ExtendedHoursPresentation,
) {
  const renderColor = renderColorForBar(point, prevClose, palette, extendedHours);
  const hollowBody = point.close > point.open;
  return {
    time: point.time as UTCTimestamp,
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    color: hollowBody ? TRANSPARENT : renderColor,
    wickColor: renderColor,
    borderColor: renderColor,
  };
}

export function buildEnhancedVolumeBar(
  point: CandlePresentationInput,
  prevClose: number | null,
  palette: ColorSet,
  extendedHours?: ExtendedHoursPresentation,
) {
  const direction = directionalColor(point, prevClose, palette);
  const color = extendedHours?.enabled && point.isExtended ? toRgba(direction, 0.5) : toRgba(direction, 0.88);
  return {
    time: point.time as UTCTimestamp,
    value: Number.isFinite(Number(point.volume)) ? Number(point.volume) : 0,
    color,
  };
}

export function shouldDefaultExtendedHoursOn(timeframe?: string): boolean {
  const raw = String(timeframe || "").trim();
  if (!raw) return false;
  if (raw.endsWith("m")) return true;
  if (raw.endsWith("h") || raw.endsWith("H")) return true;
  return false;
}
