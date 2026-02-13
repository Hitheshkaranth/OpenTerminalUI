import { useEffect, useState } from "react";

import { addWatchlistItem, deleteWatchlistItem, fetchWatchlist } from "../api/client";
import type { WatchlistItem } from "../types";

export function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [watchlistName, setWatchlistName] = useState("Core Picks");
  const [ticker, setTicker] = useState("INFY");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-3 p-4">
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
        <div className="mb-2 text-sm font-semibold">Watchlist Items ({items.length})</div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted">
                <th className="px-2 py-1 text-left">Watchlist</th>
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-terminal-border/50">
                  <td className="px-2 py-1">{item.watchlist_name}</td>
                  <td className="px-2 py-1">{item.ticker}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
