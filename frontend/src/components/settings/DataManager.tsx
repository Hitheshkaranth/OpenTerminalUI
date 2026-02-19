import { useState } from "react";

type CatalogItem = {
  name: string;
  bytes: number;
  updated_at: number;
};

export function DataManager() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/backtest/data/catalog");
      if (!res.ok) throw new Error(`Catalog load failed (${res.status})`);
      const data = (await res.json()) as { items?: CatalogItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data catalog");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 rounded border border-terminal-border/40 bg-terminal-bg/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-terminal-text">Data Manager</div>
        <button
          className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent"
          onClick={() => void loadCatalog()}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {error && <div className="rounded border border-terminal-neg/50 bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div>}
      <div className="max-h-48 overflow-auto text-xs">
        {!items.length ? (
          <div className="text-terminal-muted">No stored datasets yet.</div>
        ) : (
          <table className="w-full">
            <thead className="text-terminal-muted">
              <tr>
                <th className="text-left">File</th>
                <th className="text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.name} className="border-t border-terminal-border/20">
                  <td>{item.name}</td>
                  <td className="text-right">{item.bytes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
