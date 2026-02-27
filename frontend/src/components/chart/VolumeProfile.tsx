import { useMemo } from "react";

import type { VolumeProfileResponse } from "../../api/client";

type Props = {
  profile: VolumeProfileResponse | null;
};

function yForPrice(price: number, min: number, max: number, height: number) {
  if (max <= min) return height / 2;
  const pct = (price - min) / (max - min);
  return Math.max(0, Math.min(height, height - pct * height));
}

export function VolumeProfile({ profile }: Props) {
  const bins = profile?.bins ?? [];
  const maxVolume = useMemo(() => {
    if (!bins.length) return 0;
    return bins.reduce((acc, row) => Math.max(acc, Number(row.volume) || 0), 0);
  }, [bins]);

  if (!profile || !bins.length || maxVolume <= 0) return null;

  const minPrice = Math.min(...bins.map((b) => Number(b.price_low) || 0));
  const maxPrice = Math.max(...bins.map((b) => Number(b.price_high) || 0));
  const panelHeight = 420;

  return (
    <div className="pointer-events-none absolute bottom-10 right-2 top-10 z-[6] w-[112px] rounded border border-terminal-border/70 bg-[#0D1117]/70 p-1">
      <div className="relative h-full w-full">
        {bins.map((row, idx) => {
          const total = Number(row.volume) || 0;
          const buy = Number(row.buy_volume) || 0;
          const sell = Number(row.sell_volume) || 0;
          const rowH = Math.max(1, (panelHeight / bins.length) * 0.9);
          const y = (idx / bins.length) * panelHeight;
          const totalW = Math.max(2, (total / maxVolume) * 100);
          const buyW = total > 0 ? Math.max(1, (buy / total) * totalW) : 0;
          const sellW = total > 0 ? Math.max(1, (sell / total) * totalW) : 0;
          return (
            <div
              key={`${row.price_low}-${row.price_high}-${idx}`}
              className="absolute right-0"
              style={{ top: `${y}px`, height: `${rowH}px`, width: `${Math.min(100, totalW)}px` }}
            >
              <div className="absolute inset-y-0 right-0 bg-slate-400/30" style={{ width: `${totalW}%` }} />
              <div className="absolute inset-y-0 left-0 bg-emerald-500/45" style={{ width: `${buyW}%` }} />
              <div className="absolute inset-y-0 right-0 bg-rose-500/45" style={{ width: `${sellW}%` }} />
            </div>
          );
        })}

        {profile.poc_price != null ? (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-terminal-accent"
            style={{ top: `${yForPrice(profile.poc_price, minPrice, maxPrice, panelHeight)}px` }}
          />
        ) : null}
        {profile.value_area_high != null ? (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-blue-400/70"
            style={{ top: `${yForPrice(profile.value_area_high, minPrice, maxPrice, panelHeight)}px` }}
          />
        ) : null}
        {profile.value_area_low != null ? (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-blue-400/70"
            style={{ top: `${yForPrice(profile.value_area_low, minPrice, maxPrice, panelHeight)}px` }}
          />
        ) : null}
      </div>
    </div>
  );
}
