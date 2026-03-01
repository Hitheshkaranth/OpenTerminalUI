import { useEffect, useMemo, useRef, useState } from "react";

import type { VolumeProfileResponse } from "../../api/client";
import type { QuoteTick } from "../../realtime/useQuotesStream";

type Props = {
  profile: VolumeProfileResponse | null;
  liveQuote?: QuoteTick | null;
};

type NormalizedBin = {
  price_low: number;
  price_high: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function yForPricePct(price: number, min: number, max: number) {
  if (max <= min) return 50;
  const pct = ((price - min) / (max - min)) * 100;
  return clamp(100 - pct, 0, 100);
}

function lineTopStyle(price: number | null, minPrice: number, maxPrice: number) {
  if (price == null || !Number.isFinite(price)) return undefined;
  return `${yForPricePct(price, minPrice, maxPrice).toFixed(2)}%`;
}

function normalizeBins(input: VolumeProfileResponse["bins"]): NormalizedBin[] {
  return (input || [])
    .map((row) => ({
      price_low: Number(row.price_low),
      price_high: Number(row.price_high),
      volume: Number(row.volume),
      buy_volume: Number(row.buy_volume),
      sell_volume: Number(row.sell_volume),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.price_low) &&
        Number.isFinite(row.price_high) &&
        Number.isFinite(row.volume) &&
        Number.isFinite(row.buy_volume) &&
        Number.isFinite(row.sell_volume),
    )
    .sort((a, b) => a.price_low - b.price_low);
}

function mergeProfiles(
  prev: VolumeProfileResponse | null,
  next: VolumeProfileResponse | null,
): VolumeProfileResponse | null {
  if (!next) return null;
  if (!prev || prev.symbol !== next.symbol || prev.period !== next.period) return next;

  const prevBins = normalizeBins(prev.bins);
  const nextBins = normalizeBins(next.bins);
  if (prevBins.length !== nextBins.length) return next;

  const byKey = new Map(prevBins.map((row) => [`${row.price_low}|${row.price_high}`, row]));
  const mergedBins = nextBins.map((row) => {
    const key = `${row.price_low}|${row.price_high}`;
    const older = byKey.get(key);
    if (!older) return row;
    return {
      ...row,
      volume: Number.isFinite(row.volume) ? row.volume : older.volume,
      buy_volume: Number.isFinite(row.buy_volume) ? row.buy_volume : older.buy_volume,
      sell_volume: Number.isFinite(row.sell_volume) ? row.sell_volume : older.sell_volume,
    };
  });

  return { ...next, bins: mergedBins };
}

function computeValueAreaIndices(volumes: number[], pocIdx: number, targetVolume: number): [number, number] {
  const included = new Set<number>([pocIdx]);
  let cumulative = Math.max(0, volumes[pocIdx] ?? 0);
  let left = pocIdx - 1;
  let right = pocIdx + 1;

  while (cumulative < targetVolume && (left >= 0 || right < volumes.length)) {
    const leftVol = left >= 0 ? volumes[left] : -1;
    const rightVol = right < volumes.length ? volumes[right] : -1;
    if (rightVol > leftVol) {
      included.add(right);
      cumulative += Math.max(0, rightVol);
      right += 1;
    } else {
      included.add(left);
      cumulative += Math.max(0, leftVol);
      left -= 1;
    }
  }

  const sorted = Array.from(included).sort((a, b) => a - b);
  return [sorted[0], sorted[sorted.length - 1]];
}

function applyLiveIncrement(
  profile: VolumeProfileResponse | null,
  increment: { price: number; volumeDelta: number; isBuy: boolean },
): VolumeProfileResponse | null {
  if (!profile || !Number.isFinite(increment.price) || !Number.isFinite(increment.volumeDelta) || increment.volumeDelta <= 0) {
    return profile;
  }

  const bins = normalizeBins(profile.bins);
  if (!bins.length) return profile;

  const binIdx = bins.findIndex((row, idx) => {
    const inRange = increment.price >= row.price_low && increment.price < row.price_high;
    const inLast = idx === bins.length - 1 && increment.price >= row.price_low && increment.price <= row.price_high;
    return inRange || inLast;
  });
  if (binIdx < 0) return profile;

  const nextBins = bins.map((row, idx) => {
    if (idx !== binIdx) return row;
    const volume = row.volume + increment.volumeDelta;
    return {
      ...row,
      volume,
      buy_volume: increment.isBuy ? row.buy_volume + increment.volumeDelta : row.buy_volume,
      sell_volume: increment.isBuy ? row.sell_volume : row.sell_volume + increment.volumeDelta,
    };
  });

  const volumes = nextBins.map((row) => Math.max(0, row.volume));
  const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
  if (totalVolume <= 0) {
    return {
      ...profile,
      bins: nextBins,
      poc_price: null,
      value_area_high: null,
      value_area_low: null,
    };
  }

  const pocIdx = volumes.reduce((bestIdx, vol, idx) => (vol > volumes[bestIdx] ? idx : bestIdx), 0);
  const targetVolume = totalVolume * 0.7;
  const [valIdx, vahIdx] = computeValueAreaIndices(volumes, pocIdx, targetVolume);
  const pocBin = nextBins[pocIdx];

  return {
    ...profile,
    bins: nextBins,
    poc_price: (pocBin.price_low + pocBin.price_high) / 2,
    value_area_low: nextBins[valIdx]?.price_low ?? null,
    value_area_high: nextBins[vahIdx]?.price_high ?? null,
  };
}

export function VolumeProfile({ profile, liveQuote = null }: Props) {
  const [renderProfile, setRenderProfile] = useState<VolumeProfileResponse | null>(profile);
  const pendingProfileRef = useRef<VolumeProfileResponse | null>(profile);
  const profileRafRef = useRef<number | null>(null);
  const liveRafRef = useRef<number | null>(null);
  const pendingIncrementsRef = useRef<Array<{ price: number; volumeDelta: number; isBuy: boolean }>>([]);
  const lastLiveVolumeRef = useRef<number | null>(null);
  const lastLivePriceRef = useRef<number | null>(null);

  useEffect(() => {
    lastLiveVolumeRef.current = null;
    lastLivePriceRef.current = null;
    pendingProfileRef.current = profile;
    if (profileRafRef.current !== null) return;
    profileRafRef.current = window.requestAnimationFrame(() => {
      profileRafRef.current = null;
      setRenderProfile((prev) => mergeProfiles(prev, pendingProfileRef.current));
    });
    return () => {
      if (profileRafRef.current !== null) {
        window.cancelAnimationFrame(profileRafRef.current);
        profileRafRef.current = null;
      }
    };
  }, [profile]);

  useEffect(() => {
    if (!liveQuote || !Number.isFinite(liveQuote.ltp)) return;
    const currentVolume = Number(liveQuote.volume);
    if (!Number.isFinite(currentVolume) || currentVolume <= 0) {
      lastLivePriceRef.current = liveQuote.ltp;
      return;
    }

    const prevVolume = lastLiveVolumeRef.current;
    const prevPrice = lastLivePriceRef.current;
    lastLiveVolumeRef.current = currentVolume;
    lastLivePriceRef.current = liveQuote.ltp;

    if (prevVolume == null) return;
    const volumeDelta = currentVolume - prevVolume;
    if (!Number.isFinite(volumeDelta) || volumeDelta <= 0) return;
    const isBuy = prevPrice == null ? true : liveQuote.ltp >= prevPrice;

    pendingIncrementsRef.current.push({
      price: liveQuote.ltp,
      volumeDelta,
      isBuy,
    });

    if (liveRafRef.current !== null) return;
    liveRafRef.current = window.requestAnimationFrame(() => {
      liveRafRef.current = null;
      const increments = pendingIncrementsRef.current.splice(0);
      if (!increments.length) return;
      setRenderProfile((prev) => increments.reduce((acc, next) => applyLiveIncrement(acc, next), prev));
    });
  }, [liveQuote]);

  useEffect(
    () => () => {
      if (liveRafRef.current !== null) {
        window.cancelAnimationFrame(liveRafRef.current);
        liveRafRef.current = null;
      }
    },
    [],
  );

  const bins = useMemo(() => normalizeBins(renderProfile?.bins ?? []), [renderProfile?.bins]);
  const maxVolume = useMemo(() => {
    if (!bins.length) return 0;
    return bins.reduce((acc, row) => Math.max(acc, row.volume), 0);
  }, [bins]);

  if (!renderProfile || !bins.length || maxVolume <= 0) return null;

  const minPrice = Math.min(...bins.map((b) => b.price_low));
  const maxPrice = Math.max(...bins.map((b) => b.price_high));
  const pocTop = lineTopStyle(renderProfile.poc_price, minPrice, maxPrice);
  const vaHighTop = lineTopStyle(renderProfile.value_area_high, minPrice, maxPrice);
  const vaLowTop = lineTopStyle(renderProfile.value_area_low, minPrice, maxPrice);

  return (
    <div
      className="pointer-events-none absolute bottom-10 right-2 top-10 z-[6] w-[120px] rounded border border-terminal-border/70 bg-[#0D1117]/70 p-1"
      data-testid="volume-profile-overlay"
    >
      <div className="relative h-full w-full">
        {bins.map((row, idx) => {
          const total = Math.max(0, row.volume);
          const buy = Math.max(0, row.buy_volume);
          const sell = Math.max(0, row.sell_volume);
          const topPct = yForPricePct(row.price_high, minPrice, maxPrice);
          const bottomPct = yForPricePct(row.price_low, minPrice, maxPrice);
          const rowHeightPct = Math.max(0.6, bottomPct - topPct);
          const totalWidthPct = clamp((total / maxVolume) * 100, 2, 100);
          const rawBuyRatio = total > 0 ? clamp(buy / total, 0, 1) : 0;
          const rawSellRatio = total > 0 ? clamp(sell / total, 0, 1) : 0;
          const ratioSum = rawBuyRatio + rawSellRatio;
          const normBuyRatio = ratioSum > 1 ? rawBuyRatio / ratioSum : rawBuyRatio;
          const normSellRatio = ratioSum > 1 ? rawSellRatio / ratioSum : rawSellRatio;
          const buyWidthPct = totalWidthPct * normBuyRatio;
          const sellWidthPct = totalWidthPct * normSellRatio;
          return (
            <div
              key={`${row.price_low}-${row.price_high}-${idx}`}
              className="absolute right-0"
              style={{ top: `${topPct.toFixed(2)}%`, height: `${rowHeightPct.toFixed(2)}%`, width: `${totalWidthPct.toFixed(2)}%` }}
              data-testid={`volume-profile-bin-${idx}`}
              data-volume={total.toFixed(4)}
            >
              <div className="absolute inset-y-0 left-0 right-0 bg-slate-400/25" data-testid={`volume-profile-total-${idx}`} />
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500/45"
                style={{ width: `${buyWidthPct.toFixed(2)}%` }}
                data-testid={`volume-profile-buy-${idx}`}
              />
              <div
                className="absolute inset-y-0 right-0 bg-rose-500/45"
                style={{ width: `${sellWidthPct.toFixed(2)}%` }}
                data-testid={`volume-profile-sell-${idx}`}
              />
            </div>
          );
        })}

        {pocTop ? (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-terminal-accent"
            style={{ top: pocTop }}
            data-testid="volume-profile-line-poc"
          />
        ) : null}
        {vaHighTop ? (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-blue-400/70"
            style={{ top: vaHighTop }}
            data-testid="volume-profile-line-vah"
          />
        ) : null}
        {vaLowTop ? (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-blue-400/70"
            style={{ top: vaLowTop }}
            data-testid="volume-profile-line-val"
          />
        ) : null}
      </div>
    </div>
  );
}
