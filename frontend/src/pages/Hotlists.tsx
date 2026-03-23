import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DenseTable, type DenseTableColumn } from "../components/terminal/DenseTable";

type HotlistType = "gainers" | "losers" | "most_active" | "52w_high" | "52w_low" | "gap_up" | "gap_down" | "unusual_volume";
type HotlistMarket = "IN" | "US";

type HotlistItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  sparkline: number[];
};

type HotlistResponse = {
  list_type: string;
  market: string;
  items: HotlistItem[];
  updated_at: string;
};

type HotlistRow = HotlistItem & { rank: number };

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "") || "/api";

const HOTLIST_TABS: Array<{ id: HotlistType; label: string }> = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "most_active", label: "Most Active" },
  { id: "52w_high", label: "52W High" },
  { id: "52w_low", label: "52W Low" },
  { id: "gap_up", label: "Gap Up" },
  { id: "gap_down", label: "Gap Down" },
  { id: "unusual_volume", label: "Unusual Volume" },
];

function isMarketHours(market: HotlistMarket): boolean {
  const locale = market === "IN" ? "en-IN" : "en-US";
  const tz = market === "IN" ? "Asia/Kolkata" : "America/New_York";
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  if (market === "IN") return mins >= 555 && mins <= 930;
  return mins >= 570 && mins <= 960;
}

function toRow(item: HotlistItem, index: number): HotlistRow {
  return {
    rank: index + 1,
    symbol: String(item.symbol || "").toUpperCase(),
    name: String(item.name || item.symbol || "").trim(),
    price: Number(item.price || 0),
    change: Number(item.change || 0),
    change_pct: Number(item.change_pct || 0),
    volume: Number(item.volume || 0),
    sparkline: Array.isArray(item.sparkline) ? item.sparkline.map((point) => Number(point || 0)) : [],
  };
}

export function HotlistsPage() {
  const navigate = useNavigate();
  const [market, setMarket] = useState<HotlistMarket>("IN");
  const [listType, setListType] = useState<HotlistType>("gainers");
  const [rows, setRows] = useState<HotlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        if (active) {
          setLoading(true);
          setError(null);
        }
        const params = new URLSearchParams({
          list_type: listType,
          market,
          limit: "25",
        });
        const response = await fetch(`${API_BASE}/hotlists?${params.toString()}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`hotlists fetch failed (${response.status})`);
        }
        const payload = (await response.json()) as HotlistResponse;
        if (!active) return;
        setRows((payload.items || []).map(toRow));
        setUpdatedAt(payload.updated_at || new Date().toISOString());
      } catch (err) {
        if (!active) return;
        setRows([]);
        setError(err instanceof Error ? err.message : "Unable to load hotlists");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const pollMs = isMarketHours(market) ? 5_000 : 60_000;
    const timer = window.setInterval(() => {
      void load();
    }, pollMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [listType, market]);

  const columns = useMemo<Array<DenseTableColumn<HotlistRow>>>(() => {
    return [
      { key: "rank", title: "Rank", width: 56, align: "right", type: "number", sortable: true, frozen: true, getValue: (row) => row.rank },
      { key: "symbol", title: "Symbol", width: 120, type: "text", sortable: true, frozen: true, getValue: (row) => row.symbol },
      { key: "name", title: "Name", width: 220, type: "text", sortable: true, getValue: (row) => row.name },
      { key: "price", title: "Price", width: 120, align: "right", type: "currency", sortable: true, getValue: (row) => row.price },
      {
        key: "change",
        title: "Change",
        width: 110,
        align: "right",
        type: "currency",
        sortable: true,
        getValue: (row) => row.change,
        render: (row) => (
          <span className={row.change >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
            {row.change >= 0 ? "+" : ""}
            {row.change.toFixed(2)}
          </span>
        ),
      },
      {
        key: "change_pct",
        title: "Change %",
        width: 110,
        align: "right",
        type: "percent",
        sortable: true,
        getValue: (row) => row.change_pct,
        render: (row) => (
          <span className={row.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
            {row.change_pct >= 0 ? "+" : ""}
            {row.change_pct.toFixed(2)}%
          </span>
        ),
      },
      { key: "volume", title: "Volume", width: 130, align: "right", type: "volume", sortable: true, getValue: (row) => row.volume },
      { key: "sparkline", title: "Sparkline", width: 100, type: "sparkline", getValue: (row) => row.sparkline },
    ];
  }, []);

  return (
    <div className="h-full overflow-hidden px-3 py-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {HOTLIST_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
                listType === tab.id
                  ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent"
                  : "border-terminal-border bg-terminal-bg text-terminal-muted hover:text-terminal-text"
              }`}
              onClick={() => setListType(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 rounded border border-terminal-border bg-terminal-panel p-1 text-[10px] uppercase tracking-[0.12em]">
          <button
            type="button"
            className={`rounded px-2 py-1 ${market === "IN" ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"}`}
            onClick={() => setMarket("IN")}
          >
            IN
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 ${market === "US" ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"}`}
            onClick={() => setMarket("US")}
          >
            US
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-[11px] text-terminal-muted">
        <span>{loading ? "Refreshing..." : `Live ${HOTLIST_TABS.find((tab) => tab.id === listType)?.label ?? "Hotlist"} rankings`}</span>
        <span>
          Updated:{" "}
          {updatedAt
            ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "--:--:--"}
        </span>
      </div>

      {error ? (
        <div className="rounded border border-terminal-neg/40 bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">{error}</div>
      ) : null}

      <DenseTable<HotlistRow>
        id="hotlists-main"
        rows={rows}
        columns={columns}
        rowKey={(row) => `${market}:${listType}:${row.symbol}`}
        height={640}
        rowHeight={24}
        onRowClick={(row) => navigate(`/equity/stocks?ticker=${encodeURIComponent(row.symbol)}`)}
        onRowOpenInChart={(row) => navigate(`/equity/chart-workstation?ticker=${encodeURIComponent(row.symbol)}&symbol=${encodeURIComponent(row.symbol)}`)}
        onAddToWatchlist={(row) => navigate(`/equity/watchlist?symbol=${encodeURIComponent(row.symbol)}`)}
        onAddToPortfolio={(row) => navigate(`/equity/portfolio?symbol=${encodeURIComponent(row.symbol)}`)}
        onViewDetails={(row) => navigate(`/equity/security/${encodeURIComponent(row.symbol)}?tab=overview`)}
      />
    </div>
  );
}

export default HotlistsPage;
