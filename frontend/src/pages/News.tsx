import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchLatestNews, fetchNewsByTicker, searchLatestNews, type NewsLatestApiItem } from "../api/client";
import { useStock } from "../hooks/useStocks";
import { useStockStore } from "../store/stockStore";

type UiNewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
};

const PAGE_SIZE = 20;

function normalizeNewsItem(item: NewsLatestApiItem): UiNewsItem | null {
  const title = String(item.title || "").trim();
  const url = String(item.url || "").trim();
  if (!title || !url) return null;
  const publishedAt = String(item.published_at || "").trim();
  return {
    id: String(item.id),
    title,
    source: String(item.source || "Unknown"),
    url,
    summary: String(item.summary || ""),
    publishedAt,
  };
}

function formatAgeLabel(iso: string, nowMs: number): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "Updated recently";
  const diffMin = Math.max(0, Math.floor((nowMs - ts) / 60000));
  if (diffMin < 1) return "Updated just now";
  if (diffMin < 60) return `Updated ${diffMin} min ago`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day ago`;
}

function formatPublishedTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString();
}

export function NewsPage() {
  const currentTicker = useStockStore((s) => s.ticker);
  const { data: selectedStock } = useStock(currentTicker);
  const defaultSearchTerm = (selectedStock?.company_name || currentTicker || "").trim();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [nowMs, setNowMs] = useState(Date.now());
  const [isDefaultContext, setIsDefaultContext] = useState(true);

  useEffect(() => {
    if (!defaultSearchTerm || !isDefaultContext) return;
    setSearchInput(defaultSearchTerm);
    setDebouncedSearch(defaultSearchTerm);
  }, [defaultSearchTerm, isDefaultContext]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: ["news-page", currentTicker, debouncedSearch, isDefaultContext],
    queryFn: () => {
      if (isDefaultContext && currentTicker) {
        return fetchNewsByTicker(currentTicker, 200);
      }
      return debouncedSearch ? searchLatestNews(debouncedSearch, 200) : fetchLatestNews(200);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const items = useMemo(
    () => (query.data ?? []).map(normalizeNewsItem).filter((v): v is UiNewsItem => Boolean(v)),
    [query.data],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, items.length]);

  const visibleItems = items.slice(0, visibleCount);
  const newestPublished = items[0]?.publishedAt ?? "";
  const freshness = newestPublished ? formatAgeLabel(newestPublished, nowMs) : "Updated recently";

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">News Feed</div>
            <div className="text-[11px] text-terminal-muted">{freshness}</div>
          </div>
          <div className="text-[11px] text-terminal-muted">{items.length} articles</div>
        </div>
        <div className="mt-2">
          <input
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
            placeholder="Search news..."
            value={searchInput}
            onChange={(e) => {
              setIsDefaultContext(false);
              setSearchInput(e.target.value);
            }}
          />
        </div>
      </div>

      {query.isLoading && <div className="text-xs text-terminal-muted">Loading news...</div>}
      {query.isError && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">Failed to load news</div>}

      <div className="space-y-2">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded border border-terminal-border bg-terminal-panel p-3">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-terminal-accent hover:underline">
              {item.title}
            </a>
            <div className="mt-1 text-[11px] text-terminal-muted">
              {item.source} | {formatPublishedTime(item.publishedAt)}
            </div>
            <p className="mt-2 text-xs text-terminal-text">{item.summary || "-"}</p>
          </article>
        ))}
        {!query.isLoading && visibleItems.length === 0 && (
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">No news found.</div>
        )}
      </div>

      {visibleCount < items.length && (
        <div className="pt-1">
          <button className="rounded border border-terminal-border px-3 py-1 text-xs" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
