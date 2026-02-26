import { useEffect, useMemo, useState } from "react";

import { addWatchlistItem, deleteWatchlistItem, fetchQuotesBatch, fetchWatchlist, searchSymbols, type SearchSymbolItem } from "../api/client";
import { CountryFlag } from "../components/common/CountryFlag";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalCombobox } from "../components/terminal/TerminalCombobox";
import { TerminalInput } from "../components/terminal/TerminalInput";
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
  const [tickerResults, setTickerResults] = useState<SearchSymbolItem[]>([]);
  const [tickerSearchOpen, setTickerSearchOpen] = useState(false);
  const [tickerSelectedIdx, setTickerSelectedIdx] = useState(0);
  const [tickerSearchLoading, setTickerSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotByTicker, setSnapshotByTicker] = useState<Record<string, SnapshotQuote>>({});
  const [pullStartY, setPullStartY] = useState<number | null>(null);
  const [pullHint, setPullHint] = useState("");
  const tickerSearchMarket = useMemo(() => (selectedMarket === "NASDAQ" ? "NASDAQ" : "NSE"), [selectedMarket]);

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
    let active = true;
    const q = ticker.trim();
    if (!q) {
      setTickerResults([]);
      setTickerSearchOpen(false);
      setTickerSearchLoading(false);
      return;
    }
    setTickerSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchSymbols(q, tickerSearchMarket);
        if (!active) return;
        setTickerResults(rows.slice(0, 8));
        setTickerSelectedIdx(0);
        setTickerSearchOpen(true);
      } catch {
        if (!active) return;
        setTickerResults([]);
      } finally {
        if (active) setTickerSearchLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [ticker, tickerSearchMarket]);

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
          <TerminalInput
            tone="ui"
            size="sm"
            value={watchlistName}
            onChange={(e) => setWatchlistName(e.target.value)}
          />
          <TerminalCombobox
            value={ticker}
            onChange={(v) => setTicker(v.toUpperCase())}
            onFocus={() => tickerResults.length && setTickerSearchOpen(true)}
            onKeyDown={(e) => {
              if (!tickerSearchOpen) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setTickerSelectedIdx((i) => Math.min(i + 1, tickerResults.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setTickerSelectedIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && tickerResults[tickerSelectedIdx]) {
                e.preventDefault();
                const picked = tickerResults[tickerSelectedIdx];
                setTicker(picked.ticker.toUpperCase());
                setTickerSearchOpen(false);
              } else if (e.key === "Escape") {
                setTickerSearchOpen(false);
              }
            }}
            placeholder={`Search ${selectedMarket} symbol`}
            open={tickerSearchOpen}
            items={tickerResults}
            selectedIndex={tickerSelectedIdx}
            onSelect={(item) => {
              setTicker(item.ticker.toUpperCase());
              setTickerSearchOpen(false);
            }}
            getItemKey={(item) => item.ticker}
            loading={tickerSearchLoading}
            inputClassName={`min-h-8 px-2 py-1 text-xs ${tickerSearchLoading ? "cursor-wait" : ""}`}
            listClassName="mt-1 max-h-56 overflow-auto rounded-sm border border-terminal-border bg-terminal-panel p-1 shadow-lg"
            itemClassName=""
            renderItem={(item, meta) => (
              <div className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-xs ${meta.selected ? "bg-terminal-accent/15 text-terminal-accent" : "hover:bg-terminal-bg text-terminal-text"}`}>
                <span className="inline-flex items-center gap-2">
                  <span>{item.ticker}</span>
                  <TerminalBadge size="sm" variant={item.country_code === "US" ? "info" : "neutral"}>
                    {item.country_code === "US" ? "US" : "IN"}
                  </TerminalBadge>
                </span>
                <span className="truncate text-terminal-muted">{(item.name || "").slice(0, 20)}</span>
              </div>
            )}
          />
          <TerminalButton
            size="sm"
            variant="accent"
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
          </TerminalButton>
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
