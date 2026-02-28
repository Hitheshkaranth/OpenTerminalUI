import { useState, useEffect, useMemo } from "react";
import { Plus, MoreVertical, Table, Grid3X3, Trash2, Edit2, Search, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  fetchWatchlists, createWatchlist, updateWatchlist, deleteWatchlist,
  addWatchlistSymbols, removeWatchlistSymbol, fetchQuotesBatch, searchSymbols
} from "../../api/client";
import { HeatmapView } from "./HeatmapView";
import { useQuotesStream, useQuotesStore } from "../../realtime/useQuotesStream";
import { useSettingsStore } from "../../store/settingsStore";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalCombobox } from "../terminal/TerminalCombobox";

export function WatchlistManager() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedMarket = useSettingsStore(s => s.selectedMarket);
  const { formatDisplayMoney } = useDisplayCurrency();
  const { subscribe, unsubscribe } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore(s => s.ticksByToken);

  const [activeWlId, setActiveWlId] = useState<string | null>(null);
  const [viewMode, setViewByMode] = useState<"table" | "heatmap">("table");
  const [isCreating, setIsCreating] = useState(false);
  const [newWlName, setNewWlName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTickerSearchOpen, setIsTickerSearchOpen] = useState(false);
  const [tickerResults, setTickerResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Data fetching
  const { data: watchlists, isLoading: loadingWl } = useQuery({
    queryKey: ["watchlists"],
    queryFn: fetchWatchlists
  });

  const activeWl = useMemo(() => {
    const nameParam = searchParams.get("name");
    const safeWatchlists = watchlists || [];
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

  // Search logic
  useEffect(() => {
    if (!searchQuery) return;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchSymbols(searchQuery, selectedMarket === "NASDAQ" ? "NASDAQ" : "NSE");
        setTickerResults(results.slice(0, 10));
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedMarket]);

  if (loadingWl) return <div className="p-8 text-center text-terminal-muted animate-pulse">SYNCHRONIZING WATCHLISTS...</div>;

  const heatmapData = activeWl?.symbols.map(s => {
    const live = ticksByToken[`${selectedMarket}:${s}`];
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
          <button onClick={() => setIsCreating(true)} className="text-terminal-muted hover:text-terminal-accent">
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {isCreating && (
            <div className="p-2 border border-terminal-accent bg-terminal-accent/5 rounded mb-2">
              <TerminalInput
                autoFocus
                size="sm"
                placeholder="Name..."
                value={newWlName}
                onChange={e => setNewWlName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createMut.mutate(newWlName)}
              />
              <div className="mt-2 flex gap-2">
                <TerminalButton size="sm" variant="accent" onClick={() => createMut.mutate(newWlName)}>SAVE</TerminalButton>
                <TerminalButton size="sm" onClick={() => setIsCreating(false)}>CANCEL</TerminalButton>
              </div>
            </div>
          )}

          {watchlists?.map(wl => (
            <div
              key={wl.id}
              onClick={() => setActiveWlId(wl.id)}
              className={`group flex items-center justify-between rounded px-3 py-2 cursor-pointer transition-colors ${activeWlId === wl.id ? 'bg-terminal-accent/20 text-terminal-accent' : 'text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text'}`}
            >
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase">{wl.name}</span>
                <span className="text-[9px] opacity-60">{wl.symbols.length} items</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); if(confirm('Delete?')) deleteMut.mutate(wl.id); }}
                className="opacity-0 group-hover:opacity-100 text-terminal-neg hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {activeWl ? (
          <>
            <header className="flex items-center justify-between border-b border-terminal-border bg-terminal-panel/50 px-4 py-2">
              <div className="flex items-center gap-4">
                <h1 className="text-sm font-bold uppercase text-terminal-accent">{activeWl.name}</h1>
                <div className="flex rounded border border-terminal-border p-0.5 bg-terminal-bg">
                  <button
                    onClick={() => setViewByMode("table")}
                    className={`p-1 rounded-sm ${viewMode === 'table' ? 'bg-terminal-accent text-terminal-bg' : 'text-terminal-muted'}`}
                  >
                    <Table size={14} />
                  </button>
                  <button
                    onClick={() => setViewByMode("heatmap")}
                    className={`p-1 rounded-sm ${viewMode === 'heatmap' ? 'bg-terminal-accent text-terminal-bg' : 'text-terminal-muted'}`}
                  >
                    <Grid3X3 size={14} />
                  </button>
                </div>
              </div>

              <div className="w-64">
                <TerminalCombobox
                  placeholder="Add ticker..."
                  value={searchQuery}
                  items={tickerResults}
                  loading={isSearching}
                  open={isTickerSearchOpen}
                  onFocus={() => setIsTickerSearchOpen(true)}
                  onBlur={() => setTimeout(() => setIsTickerSearchOpen(false), 200)}
                  onChange={v => setSearchQuery(v)}
                  getItemKey={item => item.ticker}
                  onSelect={item => {
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
              </div>
            </header>

            <div className="flex-1 overflow-auto p-4">
              {viewMode === "table" ? (
                <div className="overflow-x-auto rounded border border-terminal-border">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-terminal-panel text-terminal-muted border-b border-terminal-border">
                      <tr>
                        <th className="px-3 py-2">SYMBOL</th>
                        <th className="px-3 py-2 text-right">LTP</th>
                        <th className="px-3 py-2 text-right">CHG%</th>
                        <th className="px-3 py-2 text-right">VOLUME</th>
                        <th className="px-3 py-2 text-center">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/30">
                      {activeWl.symbols.map(s => {
                        const live = ticksByToken[`${selectedMarket}:${s}`];
                        const changePct = live?.change_pct || 0;
                        return (
                          <tr key={s} className="hover:bg-terminal-accent/5 cursor-pointer" onClick={() => navigate(`/equity/stocks?ticker=${s}`)}>
                            <td className="px-3 py-2 font-bold text-terminal-accent">{s}</td>
                            <td className="px-3 py-2 text-right text-terminal-text">{live?.ltp?.toFixed(2) || '--'}</td>
                            <td className={`px-3 py-2 text-right ${changePct >= 0 ? 'text-terminal-pos' : 'text-terminal-neg'}`}>
                              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-right text-terminal-muted">{live?.volume?.toLocaleString() || '--'}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={(e) => { e.stopPropagation(); removeSymbolMut.mutate({ id: activeWl.id, symbol: s }); }}
                                className="text-terminal-muted hover:text-terminal-neg"
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
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-terminal-muted italic">
            Select or create a watchlist to begin.
          </div>
        )}
      </main>
    </div>
  );
}
