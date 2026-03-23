export type OHLCVLike = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type AnchoredVwapConfig = {
  anchorBarIndex: number;
  anchorTimestamp: number;
  showBands: boolean;
  bandMultipliers: number[];
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
};

export type AnchoredVwapResult = {
  vwap: Array<number | null>;
  upperBands: Array<Array<number | null>>;
  lowerBands: Array<Array<number | null>>;
};

function safeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampLineWidth(value: unknown): 1 | 2 | 3 | 4 {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) return 1;
  if (parsed >= 4) return 4;
  if (parsed < 2) return 1;
  if (parsed < 3) return 2;
  if (parsed < 4) return 3;
  return 4;
}

export function createAnchoredVwapConfig(
  anchorBarIndex: number,
  anchorTimestamp: number,
  overrides: Partial<Omit<AnchoredVwapConfig, "anchorBarIndex" | "anchorTimestamp">> = {},
): AnchoredVwapConfig {
  return {
    anchorBarIndex,
    anchorTimestamp,
    showBands: overrides.showBands ?? true,
    bandMultipliers: Array.isArray(overrides.bandMultipliers) && overrides.bandMultipliers.length ? overrides.bandMultipliers : [1, 2],
    color: typeof overrides.color === "string" && overrides.color.trim() ? overrides.color.trim() : "#7ea6e0",
    lineWidth: clampLineWidth(overrides.lineWidth ?? 2),
  };
}

export function computeAnchoredVwap(
  bars: readonly OHLCVLike[],
  anchorIndex: number,
  bandMultipliers: number[] = [1, 2],
): AnchoredVwapResult {
  const size = bars.length;
  const vwap = new Array<number | null>(size).fill(null);
  const upperBands = bandMultipliers.map(() => new Array<number | null>(size).fill(null));
  const lowerBands = bandMultipliers.map(() => new Array<number | null>(size).fill(null));

  if (!size || anchorIndex < 0 || anchorIndex >= size) {
    return { vwap, upperBands, lowerBands };
  }

  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  let mean = 0;
  let m2 = 0;
  let count = 0;

  for (let index = anchorIndex; index < size; index += 1) {
    const bar = bars[index];
    const open = safeNumber(bar?.open);
    const high = safeNumber(bar?.high);
    const low = safeNumber(bar?.low);
    const close = safeNumber(bar?.close);
    const volume = Math.max(0, safeNumber(bar?.volume) ?? 0);
    if (open === null || high === null || low === null || close === null) {
      continue;
    }

    const typicalPrice = (high + low + close) / 3;
    cumulativeVolume += volume;
    cumulativePriceVolume += typicalPrice * volume;
    count += 1;

    const delta = typicalPrice - mean;
    mean += delta / count;
    m2 += delta * (typicalPrice - mean);
    const variance = count > 1 ? m2 / (count - 1) : 0;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const currentVwap = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : typicalPrice;

    vwap[index] = currentVwap;
    bandMultipliers.forEach((multiplier, bandIndex) => {
      upperBands[bandIndex]![index] = currentVwap + multiplier * stdDev;
      lowerBands[bandIndex]![index] = currentVwap - multiplier * stdDev;
    });
  }

  return { vwap, upperBands, lowerBands };
}

export function resolveAnchoredVwapAnchorIndex(bars: readonly OHLCVLike[], anchorTimestamp: number): number {
  if (!Number.isFinite(anchorTimestamp)) return -1;
  let bestIndex = -1;
  for (let index = 0; index < bars.length; index += 1) {
    const ts = safeNumber(bars[index]?.time);
    if (ts === null) continue;
    if (ts <= anchorTimestamp) {
      bestIndex = index;
    }
  }
  return bestIndex;
}
