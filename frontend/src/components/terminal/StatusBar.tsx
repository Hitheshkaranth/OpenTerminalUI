import { useEffect, useMemo, useState } from "react";

import { useMarketStatus } from "../../hooks/useStocks";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";
import { TerminalBadge } from "./TerminalBadge";

function nowLabel(now: Date): string {
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function StatusBar() {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const ticker = useStockStore((s) => s.ticker);
  const { data: marketStatus } = useMarketStatus();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isMock = useMemo(() => {
    const payload = marketStatus as { fallbackEnabled?: boolean; error?: string } | undefined;
    return Boolean(payload?.fallbackEnabled) || Boolean(payload?.error);
  }, [marketStatus]);

  return (
    <div className="border-t border-terminal-border bg-terminal-panel px-3 py-1 text-[11px] uppercase tracking-wide text-terminal-muted">
      <div className="flex items-center gap-3">
        <span>{selectedMarket}</span>
        <span>{displayCurrency}</span>
        <span>{ticker || "NO-SYMBOL"}</span>
        <TerminalBadge variant={isMock ? "mock" : "live"}>{isMock ? "MOCK" : "LIVE"}</TerminalBadge>
        <span className="tabular-nums">{nowLabel(now)}</span>
      </div>
    </div>
  );
}
