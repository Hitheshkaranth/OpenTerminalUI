import { terminalColors } from "../../theme/terminal";

export type FootprintLevelLike = {
  price: number;
  bid_volume: number;
  ask_volume: number;
  delta: number;
};

export type FootprintCandleLike = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  levels: FootprintLevelLike[];
  total_bid_volume: number;
  total_ask_volume: number;
  delta: number;
};

export type FootprintBarLike = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type FootprintProjection = {
  timeToX: (time: number) => number | null;
  priceToY: (price: number) => number | null;
};

export type FootprintRenderOptions = {
  candleWidth?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pricePrecision(step: number): number {
  const text = step.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  if (!text.includes(".")) return 0;
  return text.split(".")[1]?.length ?? 0;
}

function roundPrice(price: number, step: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(step) || step <= 0) return price;
  const precision = pricePrecision(step);
  return Number((Math.round(price / step) * step).toFixed(precision));
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLevel(value: unknown): FootprintLevelLike | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const price = normalizeNumber(row.price);
  const bid = normalizeNumber(row.bid_volume ?? row.bidVolume);
  const ask = normalizeNumber(row.ask_volume ?? row.askVolume);
  const delta = normalizeNumber(row.delta);
  if (price === null || bid === null || ask === null) return null;
  return {
    price,
    bid_volume: bid,
    ask_volume: ask,
    delta: delta ?? ask - bid,
  };
}

export function normalizeFootprintCandles(input: unknown): FootprintCandleLike[] {
  if (!Array.isArray(input)) return [];
  const candles = input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const timestamp = normalizeNumber(row.timestamp ?? row.time);
      const open = normalizeNumber(row.open);
      const high = normalizeNumber(row.high);
      const low = normalizeNumber(row.low);
      const close = normalizeNumber(row.close);
      const levelsRaw = Array.isArray(row.levels)
        ? row.levels
        : row.levels && typeof row.levels === "object"
          ? Object.values(row.levels as Record<string, unknown>)
          : [];
      const levels = levelsRaw.map(normalizeLevel).filter((level): level is FootprintLevelLike => level !== null);
      const totalBid = normalizeNumber(row.total_bid_volume ?? row.totalBidVolume) ?? 0;
      const totalAsk = normalizeNumber(row.total_ask_volume ?? row.totalAskVolume) ?? 0;
      const delta = normalizeNumber(row.delta) ?? totalAsk - totalBid;
      if (timestamp === null || open === null || high === null || low === null || close === null) return null;
      return {
        timestamp,
        open,
        high,
        low,
        close,
        levels: levels.sort((left, right) => left.price - right.price),
        total_bid_volume: totalBid,
        total_ask_volume: totalAsk,
        delta,
      };
    })
    .filter((item): item is FootprintCandleLike => item !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
  return candles;
}

export function buildFootprintFromBars(bars: readonly FootprintBarLike[], priceGranularity = 0.5): FootprintCandleLike[] {
  const granularity = Number.isFinite(priceGranularity) && priceGranularity > 0 ? priceGranularity : 0.5;
  return bars
    .map((bar) => {
      if (!isFiniteNumber(bar?.time) || !isFiniteNumber(bar?.open) || !isFiniteNumber(bar?.high) || !isFiniteNumber(bar?.low) || !isFiniteNumber(bar?.close)) {
        return null;
      }
      const open = bar.open;
      const high = Math.max(bar.high, bar.low);
      const low = Math.min(bar.high, bar.low);
      const close = bar.close;
      const volume = Math.max(0, Number(bar.volume ?? 0));
      const isBuy = close >= open;
      const allocations: Array<[number, number]> = [
        [open, 0.2],
        [high, 0.25],
        [low, 0.25],
        [close, 0.3],
      ];
      const levelMap = new Map<number, { bid_volume: number; ask_volume: number }>();
      for (const [price, fraction] of allocations) {
        const rounded = roundPrice(price, granularity);
        const bucket = levelMap.get(rounded) ?? { bid_volume: 0, ask_volume: 0 };
        if (isBuy) {
          bucket.ask_volume += volume * fraction;
        } else {
          bucket.bid_volume += volume * fraction;
        }
        levelMap.set(rounded, bucket);
      }
      const levels = Array.from(levelMap.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([price, bucket]) => ({
          price,
          bid_volume: bucket.bid_volume,
          ask_volume: bucket.ask_volume,
          delta: bucket.ask_volume - bucket.bid_volume,
        }));
      const totalBid = levels.reduce((sum, level) => sum + level.bid_volume, 0);
      const totalAsk = levels.reduce((sum, level) => sum + level.ask_volume, 0);
      return {
        timestamp: Number(bar.time),
        open,
        high,
        low,
        close,
        levels,
        total_bid_volume: totalBid,
        total_ask_volume: totalAsk,
        delta: totalAsk - totalBid,
      };
    })
    .filter((item): item is FootprintCandleLike => item !== null);
}

function resolveCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number; dpr: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height, dpr };
}

function resolveRowHeight(priceToY: (price: number) => number | null, level: FootprintLevelLike, nextLevel?: FootprintLevelLike): number {
  const currentY = priceToY(level.price);
  const nextY = nextLevel ? priceToY(nextLevel.price) : null;
  if (currentY === null) return 0;
  const delta = nextY !== null ? Math.abs(nextY - currentY) : 8;
  return clamp(delta || 8, 5, 18);
}

export function renderFootprintCanvas(
  canvas: HTMLCanvasElement,
  candlesInput: readonly FootprintCandleLike[],
  projection: FootprintProjection,
  options: FootprintRenderOptions = {},
): void {
  const candles = normalizeFootprintCandles(candlesInput);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height, dpr } = resolveCanvasSize(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width / dpr, height / dpr);
  if (!candles.length) return;

  const allLevels = candles.flatMap((candle) => candle.levels);
  const maxVolume = allLevels.reduce((acc, level) => Math.max(acc, level.ask_volume + level.bid_volume), 0);
  if (maxVolume <= 0) return;

  const visibleWidth = width / dpr;
  const visibleHeight = height / dpr;
  const candleWidth = clamp(options.candleWidth ?? 18, 10, 30);

  ctx.save();
  ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textBaseline = "middle";

  for (const candle of candles) {
    const x = projection.timeToX(candle.timestamp);
    if (x === null || !Number.isFinite(x)) continue;

    const levels = candle.levels;
    const totalVolume = levels.reduce((acc, level) => Math.max(acc, level.ask_volume + level.bid_volume), 0);
    const poc = levels.length
      ? levels.reduce((best, level) => ((level.ask_volume + level.bid_volume) > (best.ask_volume + best.bid_volume) ? level : best), levels[0]!)
      : null;
    const blockLeft = clamp(x - candleWidth / 2, 0, visibleWidth - candleWidth);
    const blockRight = blockLeft + candleWidth;

    for (let index = 0; index < levels.length; index += 1) {
      const level = levels[index]!;
      const nextLevel = levels[index + 1];
      const y = projection.priceToY(level.price);
      if (y === null || !Number.isFinite(y)) continue;
      const rowHeight = resolveRowHeight(projection.priceToY, level, nextLevel);
      const total = level.ask_volume + level.bid_volume;
      const intensity = clamp(total / maxVolume, 0.12, 1);
      const centerY = clamp(y, 0, visibleHeight);
      const halfWidth = candleWidth / 2;
      const leftWidth = halfWidth * clamp(level.bid_volume / maxVolume, 0, 1);
      const rightWidth = halfWidth * clamp(level.ask_volume / maxVolume, 0, 1);
      const top = clamp(centerY - rowHeight / 2, 0, visibleHeight - rowHeight);

      ctx.fillStyle = `rgba(16, 185, 129, ${intensity * 0.7})`;
      ctx.fillRect(blockLeft, top, leftWidth, rowHeight);
      ctx.fillStyle = `rgba(239, 68, 68, ${intensity * 0.7})`;
      ctx.fillRect(x, top, rightWidth, rowHeight);

      ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
      ctx.fillRect(blockLeft, top, candleWidth, 1);

      if (poc && poc.price === level.price) {
        ctx.strokeStyle = terminalColors.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(blockLeft - 1, top - 1, candleWidth + 2, rowHeight + 2);
      }

      ctx.fillStyle = "rgba(226, 232, 240, 0.75)";
      ctx.fillText(level.price.toFixed(2), blockRight + 4, centerY);
    }

    const deltaHeight = 5;
    const lastLevel = levels[levels.length - 1];
    const baseY = lastLevel ? clamp((projection.priceToY(lastLevel.price) ?? visibleHeight / 2) + 8, 0, visibleHeight - deltaHeight) : visibleHeight - deltaHeight - 4;
    ctx.fillStyle = candle.delta >= 0 ? "rgba(16, 185, 129, 0.45)" : "rgba(239, 68, 68, 0.45)";
    ctx.fillRect(blockLeft, baseY, candleWidth, deltaHeight);
    ctx.fillStyle = "rgba(226, 232, 240, 0.7)";
    ctx.fillText(`Δ ${Math.round(candle.delta)}`, blockRight + 4, baseY + deltaHeight / 2);
    ctx.fillStyle = "rgba(148, 163, 184, 0.55)";
    ctx.fillRect(blockLeft + candleWidth / 2 - 0.5, 0, 1, visibleHeight);
  }

  ctx.restore();
}
