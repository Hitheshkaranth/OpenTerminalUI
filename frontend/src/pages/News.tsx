import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchLatestNews, fetchNewsByTicker, fetchNewsSentiment, searchLatestNews, type NewsLatestApiItem } from "../api/client";
import { useStock } from "../hooks/useStocks";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";

type SentimentLabel = "Bullish" | "Bearish" | "Neutral";
type PeriodOption = 1 | 3 | 7 | 14 | 30;
type SourceMode = "by_ticker" | "search" | "latest" | "failed";

type UiNewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  sentiment: {
    score: number;
    label: SentimentLabel;
    confidence: number;
  };
};

type NewsQueryResult = {
  items: NewsLatestApiItem[];
  sourceMode: SourceMode;
  searchTerm?: string;
  errors: string[];
};

const PERIOD_OPTIONS: PeriodOption[] = [1, 3, 7, 14, 30];
const PAGE_SIZE = 20;

function clampScore(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function labelFromScore(score: number): SentimentLabel {
  if (score > 0.1) return "Bullish";
  if (score < -0.1) return "Bearish";
  return "Neutral";
}

function normalizeSentiment(item: NewsLatestApiItem): UiNewsItem["sentiment"] {
  const rawScore = Number(item.sentiment?.score ?? 0);
  const score = Number.isFinite(rawScore) ? clampScore(rawScore) : 0;
  const rawLabel = String(item.sentiment?.label ?? "").trim();
  const label = (rawLabel === "Bullish" || rawLabel === "Bearish" || rawLabel === "Neutral" ? rawLabel : labelFromScore(score)) as SentimentLabel;
  const confidence = Number(item.sentiment?.confidence ?? 0);
  return { score, label, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0 };
}

function normalizeNewsItem(item: NewsLatestApiItem): UiNewsItem | null {
  const title = String(item.title || "").trim();
  const url = String(item.url || "").trim();
  if (!title || !url) return null;
  return {
    id: String(item.id),
    title,
    source: String(item.source || "Unknown"),
    url,
    summary: String(item.summary || ""),
    publishedAt: String(item.published_at || ""),
    sentiment: normalizeSentiment(item),
  };
}

function formatPublishedTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString();
}

function relativeTime(iso: string, nowMs: number): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "recently";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function sentimentColor(label: SentimentLabel): string {
  if (label === "Bullish") return terminalColors.positive;
  if (label === "Bearish") return terminalColors.negative;
  return terminalColors.muted;
}

function sentimentDot(label: SentimentLabel): string {
  if (label === "Bullish") return "GREEN";
  if (label === "Bearish") return "RED";
  return "NEUTRAL";
}

function toUpperWords(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

function relevanceScore(item: UiNewsItem, ticker: string, aliases: string[]): number {
  const text = `${item.title} ${item.summary}`.toUpperCase();
  const tickerToken = ticker.toUpperCase();
  let score = 0;
  if (tickerToken && new RegExp(`\\b${tickerToken}\\b`).test(text)) score += 6;
  for (const alias of aliases) {
    if (alias && new RegExp(`\\b${alias}\\b`).test(text)) score += 3;
  }
  return score;
}

function relevanceReason(item: UiNewsItem, ticker: string, aliases: string[]): string {
  const text = `${item.title} ${item.summary}`.toUpperCase();
  const tickerToken = ticker.toUpperCase();
  if (tickerToken && new RegExp(`\\b${tickerToken}\\b`).test(text)) return "Ticker match";
  for (const alias of aliases) {
    if (alias && new RegExp(`\\b${alias}\\b`).test(text)) return "Company match";
  }
  return "Market fallback";
}

async function loadTickerContextNews(ticker: string, companyName: string, limit = 200): Promise<NewsQueryResult> {
  const symbol = ticker.trim().toUpperCase();
  const errors: string[] = [];
  if (!symbol) {
    try {
      const latest = await fetchLatestNews(limit);
      return { items: latest, sourceMode: "latest", errors };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "latest failed");
      return { items: [], sourceMode: "failed", errors };
    }
  }

  try {
    const byTicker = await fetchNewsByTicker(symbol, limit);
    if (Array.isArray(byTicker) && byTicker.length > 0) {
      return { items: byTicker, sourceMode: "by_ticker", errors };
    }
  } catch (e) {
    errors.push(`by_ticker: ${e instanceof Error ? e.message : "failed"}`);
  }

  const searchTerms = Array.from(
    new Set([companyName, `${symbol} stock`, symbol].map((v) => v.trim()).filter((v) => v.length >= 2)),
  );

  for (const term of searchTerms) {
    try {
      const searched = await searchLatestNews(term, limit);
      if (Array.isArray(searched) && searched.length > 0) {
        return { items: searched, sourceMode: "search", searchTerm: term, errors };
      }
    } catch (e) {
      errors.push(`search(${term}): ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  try {
    const latest = await fetchLatestNews(limit);
    return { items: latest, sourceMode: "latest", errors };
  } catch (e) {
    errors.push(`latest: ${e instanceof Error ? e.message : "failed"}`);
    return { items: [], sourceMode: "failed", errors };
  }
}

export function NewsPage() {
  const currentTicker = useStockStore((s) => s.ticker);
  const { data: selectedStock } = useStock(currentTicker);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [periodDays, setPeriodDays] = useState<PeriodOption>(7);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [nowMs, setNowMs] = useState(Date.now());
  const [isTickerMode, setIsTickerMode] = useState(true);
  const [lastRefreshMs, setLastRefreshMs] = useState<number>(Date.now());
  const relevanceAliases = useMemo(
    () => Array.from(new Set(toUpperWords(String(selectedStock?.company_name || "")).slice(0, 6))),
    [selectedStock?.company_name],
  );

  const tickerDisplay = (selectedStock?.company_name || currentTicker || "").trim();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isTickerMode) return;
    setSearchInput("");
    setDebouncedSearch("");
  }, [currentTicker, isTickerMode]);

  const newsQuery = useQuery<NewsQueryResult>({
    queryKey: ["news-page", currentTicker, selectedStock?.company_name || "", debouncedSearch, isTickerMode],
    queryFn: async () => {
      if (isTickerMode) {
        return loadTickerContextNews(currentTicker, String(selectedStock?.company_name || ""), 200);
      }
      const items = debouncedSearch ? await searchLatestNews(debouncedSearch, 200) : await fetchLatestNews(200);
      return { items, sourceMode: debouncedSearch ? "search" : "latest", searchTerm: debouncedSearch || undefined, errors: [] };
    },
    retry: 2,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (newsQuery.dataUpdatedAt > 0) {
      setLastRefreshMs(newsQuery.dataUpdatedAt);
    }
  }, [newsQuery.dataUpdatedAt]);

  const sentimentQuery = useQuery({
    queryKey: ["news-sentiment", currentTicker, periodDays],
    queryFn: () => fetchNewsSentiment(currentTicker, periodDays),
    enabled: isTickerMode && Boolean(currentTicker),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const normalizedItems = useMemo(() => {
    const raw = newsQuery.data?.items ?? [];
    const mapped = raw.map(normalizeNewsItem).filter((v): v is UiNewsItem => Boolean(v));
    if (!isTickerMode) return mapped;

    const ticker = currentTicker.trim().toUpperCase();
    const aliases = relevanceAliases;
    const scored = mapped.map((item) => ({ item, score: relevanceScore(item, ticker, aliases) }));
    const relevant = scored.filter((x) => x.score >= 3).map((x) => x.item);

    if (relevant.length > 0) return relevant;
    if (newsQuery.data?.sourceMode === "by_ticker") return mapped;
    return mapped.slice(0, 40);
  }, [currentTicker, isTickerMode, newsQuery.data?.items, newsQuery.data?.sourceMode, relevanceAliases]);

  const cutoffMs = nowMs - periodDays * 24 * 60 * 60 * 1000;
  const periodItems = useMemo(
    () =>
      normalizedItems.filter((item) => {
        const ts = Date.parse(item.publishedAt);
        return Number.isFinite(ts) ? ts >= cutoffMs : true;
      }),
    [normalizedItems, cutoffMs],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedSearch, periodDays, periodItems.length, currentTicker, isTickerMode]);

  const fallbackSummary = useMemo(() => {
    const total = periodItems.length;
    if (!total) {
      return {
        average_score: 0,
        bullish_pct: 0,
        bearish_pct: 0,
        neutral_pct: 0,
        overall_label: "Neutral" as SentimentLabel,
        total_articles: 0,
        daily_sentiment: [] as Array<{ date: string; avg_score: number; count: number }>,
      };
    }

    let bullish = 0;
    let bearish = 0;
    let neutral = 0;
    let sum = 0;
    const dayMap = new Map<string, number[]>();
    for (const item of periodItems) {
      sum += item.sentiment.score;
      if (item.sentiment.label === "Bullish") bullish += 1;
      else if (item.sentiment.label === "Bearish") bearish += 1;
      else neutral += 1;
      const d = item.publishedAt.slice(0, 10);
      const arr = dayMap.get(d) ?? [];
      arr.push(item.sentiment.score);
      dayMap.set(d, arr);
    }
    const average = sum / total;
    const daily = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({ date, avg_score: values.reduce((acc, v) => acc + v, 0) / values.length, count: values.length }));
    return {
      average_score: Number(average.toFixed(4)),
      bullish_pct: Number(((bullish * 100) / total).toFixed(1)),
      bearish_pct: Number(((bearish * 100) / total).toFixed(1)),
      neutral_pct: Number(((neutral * 100) / total).toFixed(1)),
      overall_label: labelFromScore(average),
      total_articles: total,
      daily_sentiment: daily,
    };
  }, [periodItems]);

  const summary = isTickerMode && sentimentQuery.data
    ? sentimentQuery.data
    : {
        ticker: currentTicker,
        period_days: periodDays,
        ...fallbackSummary,
      };

  const visibleItems = periodItems.slice(0, visibleCount);

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">News & Sentiment</div>
            <div className="text-[11px] text-terminal-muted">
              {isTickerMode ? `Ticker context: ${tickerDisplay || currentTicker}` : "Global/search context"}
            </div>
            <div className="text-[10px] text-terminal-muted">
              Source: {newsQuery.data?.sourceMode || "-"} {newsQuery.data?.searchTerm ? `(${newsQuery.data.searchTerm})` : ""} | Refreshed: {new Date(lastRefreshMs).toLocaleTimeString()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
              value={String(periodDays)}
              onChange={(e) => setPeriodDays(Number(e.target.value) as PeriodOption)}
            >
              {PERIOD_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}d
                </option>
              ))}
            </select>
            <button className="rounded border border-terminal-border px-2 py-1 text-xs" onClick={() => setIsTickerMode(true)}>
              Use ticker
            </button>
          </div>
        </div>
        <div className="mt-2">
          <input
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
            placeholder="Search news..."
            value={searchInput}
            onChange={(e) => {
              setIsTickerMode(false);
              setSearchInput(e.target.value);
            }}
          />
        </div>
      </div>

      <section className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-black" style={{ backgroundColor: sentimentColor(summary.overall_label as SentimentLabel) }}>
              {summary.overall_label}
            </span>
            <span className="text-sm font-semibold">
              {summary.average_score >= 0 ? "+" : ""}
              {Number(summary.average_score).toFixed(2)}
            </span>
          </div>
          <div className="text-[11px] text-terminal-muted">
            {summary.total_articles} articles | {periodDays}d
          </div>
        </div>

        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-terminal-bg">
            <div className="flex h-full w-full">
            <div style={{ width: `${summary.bullish_pct}%`, background: terminalColors.positive }} />
            <div style={{ width: `${summary.neutral_pct}%`, background: terminalColors.muted }} />
            <div style={{ width: `${summary.bearish_pct}%`, background: terminalColors.negative }} />
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-terminal-muted">
          <span>Bullish {summary.bullish_pct}%</span>
          <span>Neutral {summary.neutral_pct}%</span>
          <span>Bearish {summary.bearish_pct}%</span>
        </div>

        <div className="mt-3 h-28 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.daily_sentiment}>
              <XAxis dataKey="date" hide />
              <YAxis domain={[-1, 1]} hide />
              <Tooltip contentStyle={{ borderRadius: "4px", border: `1px solid ${terminalColors.border}`, background: terminalColors.panel, color: terminalColors.text }} labelStyle={{ color: terminalColors.muted }} />
              <Line type="monotone" dataKey="avg_score" stroke={terminalColors.accent} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {(newsQuery.isLoading || (isTickerMode && sentimentQuery.isLoading)) && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-20 animate-pulse rounded border border-terminal-border bg-terminal-panel" />
          ))}
        </div>
      )}
      {newsQuery.isError && (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">Failed to load latest news feed</div>
      )}
      {isTickerMode && sentimentQuery.isError && (
        <div className="rounded border border-terminal-warn bg-terminal-warn/10 p-2 text-xs text-terminal-warn">
          Sentiment service unavailable. Showing headline feed with fallback sentiment summary.
        </div>
      )}

      <div className="space-y-2">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded border border-terminal-border bg-terminal-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs">
                {sentimentDot(item.sentiment.label)} {item.sentiment.score >= 0 ? "+" : ""}
                {item.sentiment.score.toFixed(2)}
              </div>
              <div className="flex items-center gap-2">
                {isTickerMode && (
                  <span className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted">
                    {relevanceReason(item, currentTicker, relevanceAliases)}
                  </span>
                )}
                <div className="text-[11px] text-terminal-muted">{relativeTime(item.publishedAt, nowMs)}</div>
              </div>
            </div>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm font-semibold text-terminal-accent hover:underline">
              {item.title}
            </a>
            <div className="mt-1 text-[11px] text-terminal-muted">
              {item.source} | {formatPublishedTime(item.publishedAt)}
            </div>
            <p className="mt-2 text-xs text-terminal-text">{item.summary || "-"}</p>
          </article>
        ))}
        {!newsQuery.isLoading && visibleItems.length === 0 && (
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">
            {isTickerMode ? `No relevant latest news found for ${currentTicker}.` : "No news found for this search"}
          </div>
        )}
      </div>

      {visibleCount < periodItems.length && (
        <div className="pt-1">
          <button className="rounded border border-terminal-border px-3 py-1 text-xs" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
