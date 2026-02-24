import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { getMarketNews, getSymbolNews } from "../../providers/newsProvider";
import { useSettingsStore } from "../../store/settingsStore";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTable } from "../terminal/TerminalTable";

type Scope = "symbol" | "market";

type Props = {
  symbol: string;
  market: string;
  limit?: number;
};

type Row = {
  id: string;
  timeLabel: string;
  source: string;
  headline: string;
  summary?: string;
  url: string;
};

function formatTime(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "--:--";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function openNewsUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function NewsPanel({ symbol, market, limit = 14 }: Props) {
  const newsAutoRefresh = useSettingsStore((s) => s.newsAutoRefresh);
  const newsRefreshSec = useSettingsStore((s) => s.newsRefreshSec);
  const [scope, setScope] = useState<Scope>("symbol");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const query = useQuery({
    queryKey: ["news", scope, market, symbol, limit],
    queryFn: () => (scope === "symbol" ? getSymbolNews({ symbol, market, limit }) : getMarketNews({ market, limit })),
    enabled: scope === "market" || Boolean(symbol),
    refetchInterval: newsAutoRefresh ? Math.max(5, newsRefreshSec) * 1000 : false,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });

  const rows = useMemo<Row[]>(() => {
    return (query.data ?? [])
      .filter((item) => {
        if (!searchTerm) return true;
        const text = `${item.headline} ${item.summary ?? ""} ${item.source}`.toLowerCase();
        return text.includes(searchTerm.toLowerCase());
      })
      .map((item) => ({
        id: item.id,
        timeLabel: formatTime(item.publishedAt),
        source: item.source,
        headline: item.headline,
        summary: item.summary,
        url: item.url,
      }));
  }, [query.data, searchTerm]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [scope, searchTerm, symbol, market]);

  useEffect(() => {
    if (selectedIndex >= rows.length) setSelectedIndex(Math.max(0, rows.length - 1));
  }, [rows.length, selectedIndex]);

  const onOpenSelected = () => {
    const selected = rows[selectedIndex];
    if (!selected?.url) return;
    openNewsUrl(selected.url);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "/") {
      event.preventDefault();
      searchInputRef.current?.focus();
      return;
    }
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      void query.refetch();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (searchTerm) {
        setSearchTerm("");
        return;
      }
      setSelectedIndex(0);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenSelected();
    }
  };

  return (
    <TerminalPanel
      title="News"
      subtitle="Up/Down select | Enter open | R refresh | / search | Esc clear"
      actions={
        <div className="flex items-center gap-1">
          <TerminalButton variant={scope === "symbol" ? "accent" : "default"} onClick={() => setScope("symbol")}>
            Symbol
          </TerminalButton>
          <TerminalButton variant={scope === "market" ? "accent" : "default"} onClick={() => setScope("market")}>
            Market
          </TerminalButton>
        </div>
      }
      className="focus-within:border-terminal-accent"
      bodyClassName="space-y-2 p-2"
    >
      <div tabIndex={0} onKeyDown={onKeyDown} className="space-y-2 outline-none">
        <input
          ref={searchInputRef}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search news (/)"
          className="w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] outline-none focus:border-terminal-accent"
        />
        {query.isLoading && <div className="py-3 text-center text-[11px] text-terminal-muted">Loading news...</div>}
        {!query.isLoading && (
          <TerminalTable
            rows={rows}
            rowKey={(row) => row.id}
            selectedIndex={selectedIndex}
            onRowSelect={setSelectedIndex}
            onRowOpen={(idx) => {
              const row = rows[idx];
              if (row?.url) openNewsUrl(row.url);
            }}
            density="compact"
            emptyText="No news items"
            className="max-h-64"
            columns={[
              { key: "time", label: "Time", widthClassName: "w-20", render: (row) => row.timeLabel },
              { key: "source", label: "Source", widthClassName: "w-28", render: (row) => <span className="truncate">{row.source}</span> },
              {
                key: "headline",
                label: "Headline",
                render: (row) => (
                  <button type="button" onClick={() => openNewsUrl(row.url)} className="w-full text-left">
                    <div className="truncate text-terminal-text">{row.headline}</div>
                    {row.summary && <div className="truncate text-[11px] text-terminal-muted">{row.summary}</div>}
                  </button>
                ),
              },
            ]}
          />
        )}
      </div>
    </TerminalPanel>
  );
}
