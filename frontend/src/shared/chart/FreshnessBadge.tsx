import { useEffect, useState } from "react";
import type { Exchange, MarketStatus } from "../../types/market";

interface Props {
  lastUpdate: string | null;
  exchange: Exchange;
}

function getMarketStatus(exchange: Exchange): MarketStatus {
  const now = new Date();
  const day = now.getDay();

  if (day === 0 || day === 6) return "closed";

  if (["NSE", "BSE", "NFO"].includes(exchange)) {
    const istOffset = 5.5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = utcMinutes + istOffset;
    const istHour = Math.floor(istMinutes / 60) % 24;
    const istMin = istMinutes % 60;
    if (istHour > 9 || (istHour === 9 && istMin >= 15)) {
      if (istHour < 15 || (istHour === 15 && istMin < 30)) return "open";
    }
    return "closed";
  }

  if (["NYSE", "NASDAQ", "AMEX"].includes(exchange)) {
    const etOffset = -5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const etMinutes = ((utcMinutes + etOffset) % 1440 + 1440) % 1440;
    if (etMinutes >= 4 * 60 && etMinutes < 9 * 60 + 30) return "pre_market";
    if (etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60) return "open";
    if (etMinutes >= 16 * 60 && etMinutes < 20 * 60) return "after_hours";
    return "closed";
  }

  return "open";
}

function stalenessSec(lastUpdate: string | null): number {
  if (!lastUpdate) return 9999;
  return Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 1000);
}

export function FreshnessBadge({ lastUpdate, exchange }: Props) {
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  const status = getMarketStatus(exchange);
  const stale = stalenessSec(lastUpdate);

  let color: string;
  let label: string;

  if (status === "closed" || status === "holiday") {
    color = "text-zinc-500";
    label = "Market closed";
  } else if (stale < 10) {
    color = "text-emerald-400";
    label = "Live";
  } else if (stale < 120) {
    color = "text-amber-400";
    label = `${stale}s ago`;
  } else {
    color = "text-red-400";
    label = stale > 600 ? "Offline — cached" : `${Math.floor(stale / 60)}m ago`;
  }

  const timeStr = lastUpdate
    ? new Date(lastUpdate).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <div className={`flex items-center gap-1.5 text-xs font-mono ${color}`}>
      <span className="inline-block h-2 w-2 rounded-full bg-current" />
      <span>{label}</span>
      <span className="ml-1 text-zinc-600">{timeStr}</span>
    </div>
  );
}
