import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CircleDot } from "lucide-react";

import { useMarketStatus } from "../../hooks/useStocks";
import { useAlertsStore } from "../../store/alertsStore";
import { useQuotesStore } from "../../realtime/useQuotesStream";

function formatZone(now: Date, timeZone: string) {
  return now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  });
}

function marketLabel(value: unknown): "OPEN" | "CLOSED" {
  const raw = String(value || "").toUpperCase();
  return raw.includes("OPEN") ? "OPEN" : "CLOSED";
}

function Dot({ tone }: { tone: "green" | "yellow" | "red" | "gray" }) {
  const cls =
    tone === "green"
      ? "text-emerald-400"
      : tone === "yellow"
        ? "text-amber-400"
        : tone === "red"
          ? "text-rose-400"
          : "text-gray-500";
  return <CircleDot className={`h-3.5 w-3.5 ${cls}`} fill="currentColor" />;
}

export function MarketStatusBar(_props: { tickerOverride?: string | null } = {}) {
  const { data: marketStatus } = useMarketStatus();
  const unreadAlerts = useAlertsStore((s) => s.unreadCount);
  const connectionState = useQuotesStore((s) => s.connectionState);
  const [now, setNow] = useState(() => new Date());
  const [lagMs, setLagMs] = useState(0);
  const lagRef = useRef(performance.now());

  useEffect(() => {
    const timer = setInterval(() => {
      const nextNow = new Date();
      const currentPerf = performance.now();
      const drift = Math.max(0, currentPerf - lagRef.current - 1000);
      lagRef.current = currentPerf;
      setLagMs(Math.round(drift));
      setNow(nextNow);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const perfStats = useMemo(() => {
    const memoryApi = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
    const heapMb = memoryApi?.usedJSHeapSize ? Math.round(memoryApi.usedJSHeapSize / (1024 * 1024)) : null;
    const heapPct =
      memoryApi?.usedJSHeapSize && memoryApi?.jsHeapSizeLimit
        ? Math.round((memoryApi.usedJSHeapSize / memoryApi.jsHeapSizeLimit) * 100)
        : null;
    const cpuHint = Math.min(99, Math.max(1, Math.round(lagMs / 5) + 1));
    return { heapMb, heapPct, cpuHint };
  }, [lagMs]);

  const marketPayload = (marketStatus ?? {}) as {
    marketState?: Array<{ marketStatus?: string }>;
    nseStatus?: string;
    nyseStatus?: string;
    nextOpenTime?: string;
    fallbackEnabled?: boolean;
  };

  const nseOpen = marketLabel(marketPayload.marketState?.[0]?.marketStatus ?? marketPayload.nseStatus);
  const nyseOpen = marketLabel(marketPayload.nyseStatus);
  const connectionTone =
    connectionState === "connected" ? "green" : connectionState === "connecting" ? "yellow" : "red";
  const connText =
    connectionState === "connected" ? "CONNECTED" : connectionState === "connecting" ? "DEGRADED" : "DISCONNECTED";

  return (
    <div className="border-t border-terminal-border bg-[#0D1117] px-3 py-0.5 text-[11px]">
      <div className="grid h-5 grid-cols-[auto_1fr_auto] items-center gap-3 text-terminal-muted">
        <div className="inline-flex items-center gap-3 ot-type-data whitespace-nowrap">
          <span><span className="text-terminal-text">IST</span> {formatZone(now, "Asia/Kolkata")}</span>
          <span><span className="text-terminal-text">ET</span> {formatZone(now, "America/New_York")}</span>
          <span><span className="text-terminal-text">UTC</span> {formatZone(now, "UTC")}</span>
        </div>

        <div className="inline-flex min-w-0 items-center justify-center gap-3 overflow-hidden whitespace-nowrap ot-type-status">
          <span className="inline-flex items-center gap-1">
            <Dot tone={nseOpen === "OPEN" ? "green" : "gray"} />
            <span>NSE: {nseOpen}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Dot tone={nyseOpen === "OPEN" ? "green" : "gray"} />
            <span>NYSE: {nyseOpen}</span>
          </span>
          {marketPayload.nextOpenTime ? <span className="text-terminal-muted">NEXT OPEN {String(marketPayload.nextOpenTime)}</span> : null}
        </div>

        <div className="inline-flex items-center gap-3 ot-type-data whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            <Dot tone={connectionTone} />
            <span>{connText}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Bell className="h-3.5 w-3.5" />
            <span>{unreadAlerts}</span>
          </span>
          <span>CPU~{perfStats.cpuHint}%</span>
          <span>
            MEM {perfStats.heapMb == null ? "NA" : `${perfStats.heapMb}MB${perfStats.heapPct == null ? "" : ` (${perfStats.heapPct}%)`}`}
          </span>
        </div>
      </div>
    </div>
  );
}
