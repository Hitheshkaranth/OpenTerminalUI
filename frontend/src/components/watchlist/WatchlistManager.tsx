import { useState, useEffect, useMemo, useRef } from "react";
import { MoreHorizontal, Plus, Table, Grid3X3, Trash2, Upload } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  fetchWatchlists, createWatchlist, deleteWatchlist,
  addWatchlistSymbols, removeWatchlistSymbol, searchSymbols
} from "../../api/client";
import { HeatmapView } from "./HeatmapView";
import { fetchQuotesBatch } from "../../api/marketData";
import { useQuotesStream, useQuotesStore } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { ExportButton } from "../common/ExportButton";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalCombobox } from "../terminal/TerminalCombobox";
import { SymbolContextMenu } from "../common/SymbolContextMenu";
import { WatchlistImportPanel } from "./WatchlistImportPanel";

const PULL_THRESHOLD = 30;
const RELEASE_THRESHOLD = 70;
const SORT_OPTIONS = [
  { id: "manual", label: "Watchlist order" },
  { id: "symbol", label: "Symbol A–Z" },
  { id: "change", label: "Change: highest first" },
  { id: "price", label: "Price: highest first" },
] as const;
type WatchlistSort = typeof SORT_OPTIONS[number]["id"];
function readSort(): WatchlistSort {
  try {
    const saved = localStorage.getItem("ot:watchlist:sort");
    return SORT_OPTIONS.some((option) => option.id === saved) ? saved as WatchlistSort : "manual";
  } catch { return "manual"; }
}

export function WatchlistManager() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedMarket = useSettingsStore(s => s.selectedMarket);
  const { subscribe, unsubscribe, connectionState } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore(s => s.ticksByToken);

  const [activeWlId, setActiveWlId] = useState<string | null>(null);
  const [viewMode, setViewByMode] = useState<"table" | "heatmap">("table");
  const [isCreating, setIsCreating] = useState(false);
  const [newWlName, setNewWlName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTickerSearchOpen, setIsTickerSearchOpen] = useState(false);
  const [tickerResults, setTickerResults] = useState<any[]>([]);
  const [resultsQuery, setResultsQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ symbol: string; x: number; y: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [sort, setSort] = useState<WatchlistSort>(readSort);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem("ot:watchlist:sort", sort); } catch { /* Sorting still works for this visit. */ }
  }, [sort]);
  useEffect(() => { if (importPending) setContextMenu(null); }, [importPending]);

  // Pull-to-refresh state
  const [pullY, setPullY] = useState(0);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const pullYRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Data fetching
  const { data: watchlists, isLoading: loadingWl } = useQuery({
    queryKey: ["watchlists"],
    queryFn: fetchWatchlists
  });

  const activeWl = useMemo(() => {
    const nameParam = searchParams.get("name");
    const safeWatchlists = Array.isArray(watchlists) ? watchlists : [];
    if (nameParam && safeWatchlists.length > 0) {
      const found = safeWatchlists.find(w => w.name.toLowerCase() === nameParam.toLowerCase());
      if (found) return found;
    }
    return safeWatchlists.find(w => w.id === activeWlId) || safeWatchlists[0];
  }, [watchlists, activeWlId, searchParams]);

  useEffect(() => {
    if (activeWl && activeWlId !== activeWl.id) setActiveWlId(activeWl.id);
  }, [activeWl, activeWlId]);

  // WebSocket Sync
  useEffect(() => {
    if (!activeWl?.symbols.length) return;
    subscribe(activeWl.symbols);
    return () => unsubscribe(activeWl.symbols);
  }, [activeWl?.symbols, subscribe, unsubscribe]);

  // REST fallback: when no live tick has arrived (markets closed / feed idle),
  // show the last/snapshot price so the watchlist is never blank.
  const restQuotesQuery = useQuery({
    queryKey: ["watchlist-quotes", selectedMarket, activeWl?.symbols.join(",") || ""],
    queryFn: async () => {
      const symbols = activeWl?.symbols || [];
      const primary = await fetchQuotesBatch(symbols, selectedMarket);
      const quotes = (primary.quotes || []).map((q) => ({ ...q, market: selectedMarket as string }));
      // A watchlist can mix exchanges (AAPL on an NSE desk): resolve symbols the desk market
      // didn't price against the other country's market instead of leaving them blank.
      const priced = new Set(quotes.map((q) => String(q.symbol).toUpperCase()));
      const missing = symbols.filter((sym) => !priced.has(sym.toUpperCase()));
      if (missing.length) {
        const altMarket = selectedMarket === "NSE" || selectedMarket === "BSE" ? "NASDAQ" : "NSE";
        const alt = await fetchQuotesBatch(missing, altMarket).catch(() => ({ quotes: [] as typeof primary.quotes }));
        quotes.push(...(alt.quotes || []).map((q) => ({ ...q, market: altMarket })));
      }
      return { quotes };
    },
    enabled: Boolean(activeWl?.symbols.length),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const restBySymbol = useMemo(() => {
    const map: Record<string, { ltp: number; change_pct: number; market: string; volume?: number | null }> = {};
    for (const q of restQuotesQuery.data?.quotes || []) {
      map[String(q.symbol).toUpperCase()] = { ltp: q.last, change_pct: q.changePct, market: q.market, volume: q.volume ?? null };
    }
    return map;
  }, [restQuotesQuery.data]);
  // Markets the rows are actually priced from (e.g. "NASDAQ" for a US list on an NSE desk).
  const quoteMarketsLabel = useMemo(() => {
    const markets = Array.from(new Set(Object.values(restBySymbol).map((q) => q.market)));
    return markets.length ? markets.join("/") : selectedMarket;
  }, [restBySymbol, selectedMarket]);
  // Merge a live tick with the REST fallback so callers get a single quote view.
  const quoteFor = (symbol: string) => {
    const live = ticksByToken[`${selectedMarket}:${symbol}`];
    const rest = restBySymbol[symbol.toUpperCase()];
    return {
      ltp: live?.ltp ?? rest?.ltp,
      change_pct: live?.change_pct ?? rest?.change_pct,
      volume: live?.volume ?? rest?.volume ?? null,
    };
  };

  const displayedSymbols = [...(activeWl?.symbols || [])];
  if (sort === "symbol") displayedSymbols.sort((left, right) => left.localeCompare(right));
  if (sort === "change" || sort === "price") {
    displayedSymbols.sort((left, right) => {
      const leftQuote = quoteFor(left);
      const rightQuote = quoteFor(right);
      const leftValue = sort === "price" ? leftQuote.ltp : leftQuote.change_pct;
      const rightValue = sort === "price" ? rightQuote.ltp : rightQuote.change_pct;
      const leftValid = typeof leftValue === "number" && Number.isFinite(leftValue);
      const rightValid = typeof rightValue === "number" && Number.isFinite(rightValue);
      if (!leftValid) return rightValid ? 1 : 0;
      if (!rightValid) return -1;
      return rightValue - leftValue;
    });
  }
  const rowTabStop = displayedSymbols.includes(focusedSymbol || "") ? focusedSymbol : displayedSymbols[0];

  // Mutations
  const createMut = useMutation({
    mutationFn: createWatchlist,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setActiveWlId(data.id);
      setIsCreating(false);
      setNewWlName("");
    }
  });

  const deleteMut = useMutation({
    mutationFn: deleteWatchlist,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] })
  });

  const addSymbolMut = useMutation({
    mutationFn: ({ id, symbols }: { id: string, symbols: string[] }) => addWatchlistSymbols(id, symbols),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] })
  });

  const removeSymbolMut = useMutation({
    mutationFn: ({ id, symbol }: { id: string, symbol: string }) => removeWatchlistSymbol(id, symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] })
  });

  const closeContextMenu = () => setContextMenu(null);

  // Add the typed ticker: an exact search match wins, else the top result. Only symbols
  // the search endpoint returned are added, so typos never land in the watchlist.
  const addFromSearch = () => {
    if (!activeWl || importPending) return;
    const typed = searchQuery.trim().toUpperCase();
    // Results still belong to an earlier query while the debounced search is in flight.
    if (resultsQuery.trim().toUpperCase() !== typed) return;
    const pick = tickerResults.find((r) => String(r.ticker).toUpperCase() === typed) ?? tickerResults[0];
    if (!pick) return;
    addSymbolMut.mutate({ id: activeWl.id, symbols: [pick.ticker] });
    setSearchQuery("");
    setIsTickerSearchOpen(false);
  };

  // Search logic
  useEffect(() => {
    if (!searchQuery) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchSymbols(searchQuery, selectedMarket === "NASDAQ" ? "NASDAQ" : "NSE");
        // Drop responses for a query the user has already typed past.
        if (!cancelled) {
          setTickerResults(results.slice(0, 10));
          setResultsQuery(searchQuery);
        }
      } catch {
        if (!cancelled) setTickerResults([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, selectedMarket]);

  // Attach native touch listeners so custom Events dispatched via dispatchEvent() are handled
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onStart = (e: Event) => {
      const te = e as any;
      pullStartY.current = te.touches?.[0]?.clientY ?? 0;
      isPulling.current = true;
    };

    const onMove = (e: Event) => {
      if (!isPulling.current) return;
      const te = e as any;
      const delta = (te.touches?.[0]?.clientY ?? 0) - pullStartY.current;
      if (delta > 0) {
        pullYRef.current = delta;
        setPullY(delta);
      }
    };

    const onEnd = () => {
      if (pullYRef.current >= RELEASE_THRESHOLD) {
        queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      }
      pullYRef.current = 0;
      setPullY(0);
      isPulling.current = false;
    };

    el.addEventListener("touchstart", onStart);
    el.addEventListener("touchmove", onMove);
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const heatmapData = activeWl?.symbols.map(s => {
    const live = quoteFor(s);
    return {
      ticker: s,
      changePct: live?.change_pct || 0,
      value: 100, // Default to equal weight for now, can be extended to fetch market cap
      price: live?.ltp || 0
    };
  }) || [];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-terminal-bg lg:flex-row">
      {/* Sidebar: Watchlist List */}
      <aside className="w-full border-r border-terminal-border bg-terminal-panel lg:w-64 flex flex-col shrink-0">
        <div className="flex items-center justify-between border-b border-terminal-border p-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-terminal-muted">Watchlists</h2>
          <button disabled={importPending} aria-label="Create watchlist" onClick={() => setIsCreating(true)} className="text-terminal-muted hover:text-terminal-accent disabled:opacity-50">
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {isCreating && (
            <div className="p-2 border border-terminal-accent bg-terminal-accent/5 rounded mb-2">
              <TerminalInput
                autoFocus
                disabled={importPending}
                size="sm"
                placeholder="Name..."
                value={newWlName}
                onChange={e => setNewWlName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !importPending && createMut.mutate(newWlName)}
              />
              <div className="mt-2 flex gap-2">
                <TerminalButton size="sm" variant="accent" disabled={importPending} onClick={() => createMut.mutate(newWlName)}>SAVE</TerminalButton>
                <TerminalButton size="sm" onClick={() => setIsCreating(false)}>CANCEL</TerminalButton>
              </div>
            </div>
          )}

          {watchlists?.map(wl => (
            <div
              key={wl.id}
              className={`group flex items-center justify-between rounded transition-colors ${activeWlId === wl.id ? 'bg-terminal-accent/20 text-terminal-accent' : 'text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text'}`}
            >
              <button
                type="button"
                disabled={importPending}
                onClick={() => setActiveWlId(wl.id)}
                className="flex min-w-0 flex-1 flex-col px-3 py-2 text-left"
                aria-pressed={activeWlId === wl.id}
              >
                <span className="text-xs font-bold uppercase">{wl.name}</span>
                <span className="text-[9px] opacity-60">{wl.symbols.length} items</span>
              </button>
              <button
                disabled={importPending}
                onClick={(e) => { e.stopPropagation(); if(confirm('Delete?')) deleteMut.mutate(wl.id); }}
                className="mr-2 text-terminal-neg opacity-0 hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                aria-label={`Delete watchlist ${wl.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header — always rendered so "Add to Watchlist" is always visible */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-terminal-border bg-terminal-panel/50 px-4 py-2">
          <div className="flex flex-wrap items-center gap-3">
            {activeWl && (
              <>
                <h1 className="text-sm font-bold uppercase text-terminal-accent">{activeWl.name}</h1>
                <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[10px] uppercase text-terminal-muted" data-testid="watchlist-route-status">
                  {quoteMarketsLabel} {connectionState}
                </div>
                <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[10px] uppercase text-terminal-muted">
                  {activeWl.symbols.length} symbols
                </div>
                <div className="flex rounded border border-terminal-border p-0.5 bg-terminal-bg">
                  <button
                    type="button"
                    aria-label="Show watchlist table"
                    aria-pressed={viewMode === "table"}
                    onClick={() => setViewByMode("table")}
                    className={`p-1 rounded-sm ${viewMode === 'table' ? 'bg-terminal-accent text-terminal-bg' : 'text-terminal-muted'}`}
                  >
                    <Table size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Show watchlist heatmap"
                    aria-pressed={viewMode === "heatmap"}
                    onClick={() => setViewByMode("heatmap")}
                    className={`p-1 rounded-sm ${viewMode === 'heatmap' ? 'bg-terminal-accent text-terminal-bg' : 'text-terminal-muted'}`}
                  >
                    <Grid3X3 size={14} />
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeWl && (
              <>
                <ExportButton
                  source="watchlist"
                  data={activeWl.symbols.map(s => {
                    const live = quoteFor(s);
                    return { symbol: s, price: live?.ltp, change_pct: live?.change_pct, volume: live?.volume };
                  })}
                  filename={`${activeWl.name}_watchlist.csv`}
                />
                <TerminalButton size="sm" disabled={importPending} aria-expanded={importOpen} aria-controls="watchlist-import-region" leftIcon={<Upload size={13} aria-hidden="true" />} onClick={() => setImportOpen((open) => !open)}>Import symbols</TerminalButton>
                <fieldset disabled={importPending} className="relative min-w-0 w-52">
                  <TerminalCombobox
                  placeholder="Search ticker..."
                  listClassName="absolute right-0 z-50 mt-1 max-h-64 w-72 overflow-auto rounded-sm border border-terminal-border bg-terminal-panel p-1 shadow-lg"
                  itemClassName="cursor-pointer rounded-sm hover:bg-terminal-accent/15"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFromSearch();
                    }
                  }}
                  value={searchQuery}
                  items={tickerResults}
                  loading={isSearching}
                  open={isTickerSearchOpen}
                  onFocus={() => setIsTickerSearchOpen(true)}
                  onBlur={() => setTimeout(() => setIsTickerSearchOpen(false), 200)}
                  onChange={v => setSearchQuery(v)}
                  getItemKey={item => item.ticker}
                  onSelect={item => {
                    if (importPending) return;
                    addSymbolMut.mutate({ id: activeWl.id, symbols: [item.ticker] });
                    setSearchQuery("");
                    setIsTickerSearchOpen(false);
                  }}
                  renderItem={(item) => (
                    <div className="flex items-center justify-between text-xs px-2 py-1">
                      <span className="font-bold">{item.ticker}</span>
                      <span className="text-terminal-muted truncate ml-2">{item.name}</span>
                    </div>
                  )}
                />
              </fieldset>
              </>
            )}
            <TerminalButton
              size="sm"
              disabled={importPending}
              variant="accent"
              onClick={() => {
                if (!activeWl) setIsCreating(true);
                else if (searchQuery.trim()) addFromSearch();
                else setIsTickerSearchOpen(true);
              }}
            >
              Add to Watchlist
            </TerminalButton>
          </div>
        </header>

        {/* Scrollable body — div.space-y-3.p-4 always present for touch-event targeting */}
        <div className="flex-1 overflow-auto">
          {pullY > PULL_THRESHOLD && (
            <div className="border-b border-terminal-border py-2 text-center text-xs text-terminal-muted">
              {pullY >= RELEASE_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
            </div>
          )}
          <div
            ref={containerRef}
            className="space-y-3 p-4"
          >
            {activeWl && importOpen && <div id="watchlist-import-region"><WatchlistImportPanel key={activeWl.id} watchlist={activeWl} onPendingChange={setImportPending} onClose={() => setImportOpen(false)} onImported={() => { void queryClient.invalidateQueries({ queryKey: ["watchlists"] }); }} /></div>}
            {activeWl && viewMode === "table" && <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="watchlist-keyboard-help" className="text-[11px] text-terminal-muted">Focus a row, use ↑ / ↓ or Home / End to move, and Enter to open Security Hub.</p>
              <label className="flex items-center gap-2 text-xs text-terminal-muted">Sort rows<select value={sort} onChange={(event) => setSort(event.target.value as WatchlistSort)} className="min-h-8 rounded-sm border border-terminal-border bg-terminal-panel px-2 text-xs text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent">{SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            </div>}
            {loadingWl ? (
              <p className="animate-pulse text-center text-xs text-terminal-muted">SYNCHRONIZING WATCHLISTS...</p>
            ) : activeWl ? (
              viewMode === "table" ? (
                <div className="overflow-x-auto rounded border border-terminal-border">
                  <table className="w-full text-left text-xs font-mono" aria-describedby="watchlist-keyboard-help">
                    <caption className="sr-only">{activeWl.name} watchlist quotes</caption>
                    <thead className="bg-terminal-panel text-terminal-muted border-b border-terminal-border">
                      <tr>
                        <th scope="col" aria-sort={sort === "symbol" ? "ascending" : undefined} className="px-3 py-2">SYMBOL</th>
                        <th scope="col" aria-sort={sort === "price" ? "descending" : undefined} className="px-3 py-2 text-right">LTP</th>
                        <th scope="col" aria-sort={sort === "change" ? "descending" : undefined} className="px-3 py-2 text-right">CHG%</th>
                        <th scope="col" className="px-3 py-2 text-right">VOLUME</th>
                        <th scope="col" className="px-3 py-2 text-center">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/30">
                      {displayedSymbols.map(s => {
                        const live = quoteFor(s);
                        const changePct = Number.isFinite(Number(live?.change_pct)) && live?.ltp != null ? Number(live.change_pct) : null;
                        return (
                          <tr
                            key={s}
                            className="cursor-pointer hover:bg-terminal-accent/5 focus-within:bg-terminal-accent/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent"
                            tabIndex={rowTabStop === s ? 0 : -1}
                            data-watchlist-symbol={s}
                            onFocus={() => setFocusedSymbol(s)}
                            onClick={() => navigate(`/equity/security?ticker=${encodeURIComponent(s)}`)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                                event.preventDefault();
                                event.stopPropagation();
                                const rows = Array.from(event.currentTarget.closest("table")!.querySelectorAll<HTMLTableRowElement>("tbody tr[data-watchlist-symbol]"));
                                const index = rows.indexOf(event.currentTarget);
                                const target = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
                                rows[target]?.focus();
                              }
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                navigate(`/equity/security?ticker=${encodeURIComponent(s)}`);
                              }
                              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                                event.preventDefault();
                                const rect = event.currentTarget.getBoundingClientRect();
                                setContextMenu({ symbol: s, x: rect.left + Math.min(rect.width / 2, 220), y: rect.bottom + 4 });
                              }
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setContextMenu({ symbol: s, x: event.clientX, y: event.clientY });
                            }}
                          >
                            <td className="px-3 py-2 font-bold text-terminal-accent">{s}</td>
                            <td className="px-3 py-2 text-right text-terminal-text">{live?.ltp?.toFixed(2) || '--'}</td>
                            <td className={`px-3 py-2 text-right ${changePct == null || changePct === 0 ? 'text-terminal-muted' : changePct > 0 ? 'text-terminal-pos' : 'text-terminal-neg'}`}>
                              {changePct == null ? '--' : `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                            </td>
                            <td className="px-3 py-2 text-right text-terminal-muted">{live?.volume?.toLocaleString() || '--'}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                disabled={importPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setContextMenu({ symbol: s, x: rect.left, y: rect.bottom + 4 });
                                }}
                                className="mr-2 text-terminal-muted hover:text-terminal-accent"
                                aria-label={`Open context menu for ${s}`}
                              >
                                <MoreHorizontal size={12} />
                              </button>
                              <button
                                type="button"
                                disabled={importPending}
                                onClick={(e) => { e.stopPropagation(); removeSymbolMut.mutate({ id: activeWl.id, symbol: s }); }}
                                className="text-terminal-muted hover:text-terminal-neg"
                                aria-label={`Remove ${s} from watchlist`}
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-full rounded border border-terminal-border bg-terminal-panel/30 p-2">
                  <HeatmapView
                    data={heatmapData}
                    width={800}
                    height={500}
                    sizeBy="equal"
                  />
                </div>
              )
            ) : (
              <p className="text-center text-sm italic text-terminal-muted">
                Select or create a watchlist to begin.
              </p>
            )}
          </div>
        </div>
      </main>

      {contextMenu && activeWl ? (
        <SymbolContextMenu
          open={Boolean(contextMenu)}
          symbol={contextMenu.symbol}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
          market={selectedMarket}
          customActions={[
            {
              id: "watchlist-remove-symbol",
              label: "Remove from Watchlist",
              danger: true,
              onAction: async (symbol) => {
                await removeSymbolMut.mutateAsync({ id: activeWl.id, symbol });
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
