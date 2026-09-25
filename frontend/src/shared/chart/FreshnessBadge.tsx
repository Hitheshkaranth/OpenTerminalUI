import { useEffect, useState } from "react";
import type { Exchange, MarketStatus } from "../../types/market";

interface Props {
  lastUpdate: string | null;
  exchange: Exchange;
}

// Weekday + minutes-since-midnight in the exchange's own zone (DST-aware), not the viewer's.
function zonedClock(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function getMarketStatus(exchange: Exchange): MarketStatus {
  const now = new Date();

  if (["NSE", "BSE", "NFO"].includes(exchange)) {
    const { day, minutes } = zonedClock(now, "Asia/Kolkata");
    if (day === 0 || day === 6) return "closed";
    if (minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30) return "open";
    return "closed";
  }

  if (["NYSE", "NASDAQ", "AMEX"].includes(exchange)) {
    const { day, minutes: etMinutes } = zonedClock(now, "America/New_York");
    if (day === 0 || day === 6) return "closed";
    if (etMinutes >= 4 * 60 && etMinutes < 9 * 60 + 30) return "pre_market";
    if (etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60) return "open";
    if (etMinutes >= 16 * 60 && etMinutes < 20 * 60) return "after_hours";
    return "closed";
  }

  return "open";
}

function stalenessSec(lastUpdate: string | null): number {
  const ts = lastUpdate ? new Date(lastUpdate).getTime() : NaN;
  if (!Number.isFinite(ts)) return 9999;
  return Math.floor((Date.now() - ts) / 1000);
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
    color = "text-terminal-muted";
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

  const timeStr = lastUpdate && Number.isFinite(new Date(lastUpdate).getTime())
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
      <span className="ml-1 text-terminal-muted">{timeStr}</span>
    </div>
  );
}
