import { useEffect, useState } from "react";

import { addWatchlistItem, deleteWatchlistItem, fetchQuotesBatch, fetchWatchlist } from "../api/client";
import { CountryFlag } from "../components/common/CountryFlag";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { useQuotesStore, useQuotesStream } from "../realtime/useQuotesStream";
import { useSettingsStore } from "../store/settingsStore";
import type { WatchlistItem } from "../types";
import { InstrumentBadges } from "../components/common/InstrumentBadges";

type SnapshotQuote = { ltp: number; change: number; change_pct: number };

export function WatchlistPage() {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const { formatDisplayMoney } = useDisplayCurrency();
  const { subscribe, unsubscribe, isConnected } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [watchlistName, setWatchlistName] = useState("Core Picks");
  const [ticker, setTicker] = useState("INFY");
  const [error, setError] = useState<string | null>(null);
  const [snapshotByTicker, setSnapshotByTicker] = useState<Record<string, SnapshotQuote>>({});
  const [pullStartY, setPullStartY] = useState<number | null>(null);
  const [pullHint, setPullHint] = useState("");

  const load = async () => {
    try {
      setError(null);
      setItems(await fetchWatchlist());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load watchlist");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const symbols = items.map((item) => item.ticker);
    if (!symbols.length) {
      setSnapshotByTicker({});
      return;
    }

    let active = true;
    subscribe(symbols);

    void (async () => {
      try {
        const payload = await fetchQuotesBatch(symbols, selectedMarket);
        if (!active) return;
        const next: Record<string, SnapshotQuote> = {};
        for (const row of payload.quotes || []) {
          const key = String(row.symbol || "").toUpperCase();
          const ltp = Number(row.last);
          if (!Number.isFinite(ltp) || !key) continue;
          next[key] = {
            ltp,
            change: Number.isFinite(Number(row.change)) ? Number(row.change) : 0,
            change_pct: Number.isFinite(Number(row.changePct)) ? Number(row.changePct) : 0,
          };
        }
        setSnapshotByTicker(next);
      } catch {
        // Snapshot fallback can fail; live ticks may still be available.
      }
    })();

    return () => {
      active = false;
      unsubscribe(symbols);
    };
  }, [items, selectedMarket, subscribe, unsubscribe]);

  return (
    <div
      className="space-y-3 p-4"
      onTouchStart={(e) => {
        if (window.scrollY <= 0) setPullStartY(e.touches[0]?.clientY ?? null);
      }}
      onTouchMove={(e) => {
        if (pullStartY == null) return;
        const delta = (e.touches[0]?.clientY ?? 0) - pullStartY;
        if (delta > 70) setPullHint("Release to refresh");
        else if (delta > 20) setPullHint("Pull to refresh");
      }}
      onTouchEnd={async (e) => {
        if (pullStartY == null) return;
        const delta = (e.changedTouches[0]?.clientY ?? 0) - pullStartY;
        setPullStartY(null);
        if (delta > 70) await load();
        setPullHint("");
      }}
    >
      {pullHint ? <div className="text-center text-xs text-terminal-muted">{pullHint}</div> : null}
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold">Add to Watchlist</div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={watchlistName} onChange={(e) => setWatchlistName(e.target.value)} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
          <button
            className="rounded bg-terminal-accent px-3 py-1 text-xs text-white"
            onClick={async () => {
              try {
                await addWatchlistItem({ watchlist_name: watchlistName, ticker });
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to add watchlist item");
              }
            }}
          >
            Add
          </button>
        </div>
      </div>
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>Watchlist Items ({items.length})</span>
          <span className={`rounded border px-2 py-0.5 text-[11px] ${isConnected ? "border-terminal-pos text-terminal-pos" : "border-terminal-border text-terminal-muted"}`}>
            LIVE
          </span>
        </div>
        <div className="space-y-2 md:hidden">
          {items.map((item) => {
            const symbol = item.ticker.toUpperCase();
            const token = `${selectedMarket}:${symbol}`;
            const live = ticksByToken[token];
            const snapshot = snapshotByTicker[symbol];
            const ltp = live?.ltp ?? snapshot?.ltp ?? null;
            const changePct = live?.change_pct ?? snapshot?.change_pct ?? null;
            const moveClass =
              changePct === null ? "text-terminal-muted" : changePct >= 0 ? "text-terminal-pos" : "text-terminal-neg";
            return (
              <div key={`m-${item.id}`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5">
                    <CountryFlag countryCode={item.country_code} flagEmoji={item.flag_emoji} />
                    <span className="font-semibold">{item.ticker}</span>
                  </span>
                  <span className={moveClass}>{changePct == null ? "-" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-terminal-muted">{item.watchlist_name}</span>
                  <span className="text-terminal-text">{ltp !== null ? formatDisplayMoney(ltp) : "-"}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden overflow-auto md:block">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted">
                <th className="px-2 py-1 text-left">Watchlist</th>
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-left">F&O</th>
                <th className="px-2 py-1 text-right">LTP</th>
                <th className="px-2 py-1 text-right">Change</th>
                <th className="px-2 py-1 text-right">Change %</th>
                <th className="px-2 py-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const symbol = item.ticker.toUpperCase();
                const token = `${selectedMarket}:${symbol}`;
                const live = ticksByToken[token];
                const snapshot = snapshotByTicker[symbol];
                const ltp = live?.ltp ?? snapshot?.ltp ?? null;
                const change = live?.change ?? snapshot?.change ?? null;
                const changePct = live?.change_pct ?? snapshot?.change_pct ?? null;
                const moveClass =
                  changePct === null ? "text-terminal-muted" : changePct >= 0 ? "text-terminal-pos" : "text-terminal-neg";
                return (
                  <tr key={item.id} className="border-b border-terminal-border/50">
                    <td className="px-2 py-1">{item.watchlist_name}</td>
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center gap-1.5">
                        <CountryFlag countryCode={item.country_code} flagEmoji={item.flag_emoji} />
                        <span>{item.ticker}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <InstrumentBadges exchange={item.exchange} hasFutures={item.has_futures} hasOptions={item.has_options} />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {ltp !== null ? formatDisplayMoney(ltp) : "-"}
                    </td>
                    <td className={`px-2 py-1 text-right tabular-nums ${moveClass}`}>
                      {change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}` : "-"}
                    </td>
                    <td className={`px-2 py-1 text-right tabular-nums ${moveClass}`}>
                      {changePct !== null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "-"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        className="rounded border border-terminal-border px-2 py-1"
                        onClick={async () => {
                          try {
                            await deleteWatchlistItem(item.id);
                            await load();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Failed to delete watchlist item");
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
