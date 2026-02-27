import { useQuery } from "@tanstack/react-query";

import { fetchPortfolio, fetchWatchlist } from "../../api/client";
import { useSettingsStore } from "../../store/settingsStore";
import type { PortfolioResponse, WatchlistItem } from "../../types";

export function HudOverlay() {
  const enabled = useSettingsStore((s) => s.hudOverlayEnabled);
  const setEnabled = useSettingsStore((s) => s.setHudOverlayEnabled);

  const portfolioQuery = useQuery({
    queryKey: ["hud", "portfolio"],
    queryFn: fetchPortfolio,
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const watchlistQuery = useQuery({
    queryKey: ["hud", "watchlist"],
    queryFn: fetchWatchlist,
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  if (!enabled) return null;

  const portfolio = (portfolioQuery.data ?? null) as PortfolioResponse | null;
  const watchlist = (watchlistQuery.data ?? []) as WatchlistItem[];

  return (
    <div className="pointer-events-none fixed right-3 top-[86px] z-[70] w-[260px] rounded border border-terminal-border bg-terminal-panel/95 p-2 shadow-xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <span className="ot-type-label text-terminal-accent">HUD Overlay</span>
        <button
          type="button"
          onClick={() => setEnabled(false)}
          className="pointer-events-auto rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted hover:text-terminal-text"
        >
          HIDE
        </button>
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="rounded border border-terminal-border bg-terminal-bg/50 px-2 py-1">
          <div className="text-terminal-muted">Portfolio Value</div>
          <div className="ot-type-data text-terminal-text">
            {portfolio?.summary?.total_value == null
              ? "NA"
              : Number(portfolio.summary.total_value).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg/50 px-2 py-1">
          <div className="text-terminal-muted">Overall P&L</div>
          <div className={`ot-type-data ${Number(portfolio?.summary?.overall_pnl ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
            {portfolio?.summary?.overall_pnl == null
              ? "NA"
              : Number(portfolio.summary.overall_pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg/50 px-2 py-1">
          <div className="mb-1 text-terminal-muted">Watchlist</div>
          <div className="space-y-1">
            {watchlist.slice(0, 4).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-terminal-text">{item.ticker}</span>
                <span className="text-terminal-muted">{item.watchlist_name}</span>
              </div>
            ))}
            {!watchlist.length ? <div className="text-terminal-muted">No symbols</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
