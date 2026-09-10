import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, Clock, Filter, Newspaper, Search } from "lucide-react";

import { fetchLatestNews, fetchMarketSentiment, fetchNewsByTicker, fetchNewsSentiment, fetchNewsSentimentSummary, fetchStockEmotion, searchLatestNews, type NewsLatestApiItem } from "../api/client";
import { EmotionIndicator } from "../components/terminal/EmotionIndicator";
import { SentimentBadge } from "../components/terminal/SentimentBadge";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useStock } from "../hooks/useStocks";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import { terminalColors } from "../theme/terminal";

type NewsRegion = "IN" | "US";

// Region-scoped query used for the default (non-ticker) feed so the headlines match the
// market selected in the header instead of always showing a generic global feed.
const REGION_QUERY: Record<NewsRegion, string> = {
  IN: "India stock market Sensex Nifty NSE BSE",
  US: "US stock market Wall Street Nasdaq S&P 500",
};
const REGION_LABEL: Record<NewsRegion, string> = { IN: "India", US: "United States" };

function regionForMarket(market: string): NewsRegion {
  const code = (market || "").trim().toUpperCase();
  return code === "NSE" || code === "BSE" || code === "IN" ? "IN" : "US";
}
import { NewsSentimentOverview } from "./news/NewsSentimentOverview";

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

async function loadRegionNews(region: NewsRegion, limit: number, errors: string[]): Promise<NewsQueryResult> {
  // Prefer a region-scoped search so IN/US selection drives the default feed; fall back to the
  // generic latest endpoint only if the region search yields nothing.
  try {
    const scoped = await searchLatestNews(REGION_QUERY[region], limit);
    if (Array.isArray(scoped) && scoped.length > 0) {
      return { items: scoped, sourceMode: "latest", searchTerm: REGION_LABEL[region], errors };
    }
  } catch (e) {
    errors.push(`region(${region}): ${e instanceof Error ? e.message : "failed"}`);
  }
  try {
    const latest = await fetchLatestNews(limit);
    return { items: latest, sourceMode: "latest", searchTerm: REGION_LABEL[region], errors };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "latest failed");
    return { items: [], sourceMode: "failed", errors };
  }
}

async function loadTickerContextNews(ticker: string, companyName: string, market: string, region: NewsRegion, limit = 200): Promise<NewsQueryResult> {
  const symbol = ticker.trim().toUpperCase();
  const marketCode = String(market || "").trim().toUpperCase();
  const errors: string[] = [];
  if (!symbol) {
    return loadRegionNews(region, limit, errors);
  }

  try {
    const byTicker = await fetchNewsByTicker(symbol, limit, marketCode || undefined);
    if (Array.isArray(byTicker) && byTicker.length > 0) {
      return { items: byTicker, sourceMode: "by_ticker", errors };
    }
  } catch (e) {
    errors.push(`by_ticker: ${e instanceof Error ? e.message : "failed"}`);
  }

  const searchTerms = Array.from(
    new Set([companyName, `${symbol} stock`, symbol].map((v) => v.trim()).filter((v) => v.length >= 2)),
  );
  if (marketCode === "NSE" || marketCode === "BSE") {
    searchTerms.unshift(
      `${symbol} ${marketCode} India stock`,
      `${companyName} ${marketCode}`.trim(),
    );
  }

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

  return loadRegionNews(region, limit, errors);
}

export function NewsPage() {
  const currentTicker = useStockStore((s) => s.ticker);
  const { data: selectedStock } = useStock(currentTicker);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const region = regionForMarket(String(selectedStock?.exchange || selectedMarket || ""));
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [periodDays, setPeriodDays] = useState<PeriodOption>(7);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [nowMs, setNowMs] = useState(Date.now());
  const [isTickerMode, setIsTickerMode] = useState(true);
  const [sortMode, setSortMode] = useState<"time" | "sentiment">("time");
  const [keywordInput, setKeywordInput] = useState(localStorage.getItem("news:keyword-alerts") || "");
  const [keywordHits, setKeywordHits] = useState<Array<{ keyword: string; title: string; source: string; publishedAt: string }>>([]);
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
    queryKey: ["news-page", currentTicker, selectedStock?.company_name || "", debouncedSearch, isTickerMode, region],
    queryFn: async () => {
      if (isTickerMode) {
        return loadTickerContextNews(
          currentTicker,
          String(selectedStock?.company_name || ""),
          String(selectedStock?.exchange || selectedMarket || ""),
          region,
          200,
        );
      }
      if (debouncedSearch) {
        const items = await searchLatestNews(debouncedSearch, 200);
        return { items, sourceMode: "search", searchTerm: debouncedSearch, errors: [] };
      }
      // No ticker, no search: default to the region's market news from the header selection.
      return loadRegionNews(region, 200, []);
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

  useEffect(() => {
    localStorage.setItem("news:keyword-alerts", keywordInput);
  }, [keywordInput]);

  const sentimentQuery = useQuery({
    queryKey: ["news-sentiment", currentTicker, periodDays],
    queryFn: () => fetchNewsSentiment(currentTicker, periodDays, String(selectedStock?.exchange || "")),
    enabled: isTickerMode && Boolean(currentTicker),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const marketSentimentQuery = useQuery({
    queryKey: ["news-sentiment-market", periodDays, String(selectedStock?.exchange || "")],
    queryFn: () => fetchMarketSentiment(periodDays, String(selectedStock?.exchange || "")),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const sentimentSummaryQuery = useQuery({
    queryKey: ["news-sentiment-summary", periodDays],
    queryFn: () => fetchNewsSentimentSummary(periodDays, 200),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const emotionQuery = useQuery({
    queryKey: ["stock-emotion", currentTicker, periodDays, String(selectedStock?.exchange || "")],
    queryFn: () => fetchStockEmotion(currentTicker, periodDays, String(selectedStock?.exchange || "")),
    enabled: isTickerMode && Boolean(currentTicker),
    staleTime: 120_000,
    refetchInterval: 300_000,
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
    // Backend ticker feed is already symbol-scoped; trust it as-is.
    if (newsQuery.data?.sourceMode === "by_ticker") return mapped;
    // Search/latest fallbacks are not ticker-specific — show nothing rather
    // than generic market news when a specific ticker is selected.
    return [];
  }, [currentTicker, isTickerMode, newsQuery.data?.items, newsQuery.data?.sourceMode, relevanceAliases]);

  useEffect(() => {
    const keywords = keywordInput
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (!keywords.length || !normalizedItems.length) {
      setKeywordHits([]);
      return;
    }
    const hits: Array<{ keyword: string; title: string; source: string; publishedAt: string }> = [];
    for (const item of normalizedItems.slice(0, 80)) {
      const text = `${item.title} ${item.summary}`.toLowerCase();
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          hits.push({ keyword, title: item.title, source: item.source, publishedAt: item.publishedAt });
          break;
        }
      }
      if (hits.length >= 8) break;
    }
    setKeywordHits(hits);
  }, [keywordInput, normalizedItems]);

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

  const sortedItems = useMemo(() => {
    const next = [...periodItems];
    if (sortMode === "sentiment") {
      next.sort((a, b) => b.sentiment.score - a.sentiment.score);
      return next;
    }
    next.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return next;
  }, [periodItems, sortMode]);
  const visibleItems = sortedItems.slice(0, visibleCount);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.08),transparent_34rem)] p-3 md:p-5">
      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
        <section className="rounded-md border border-terminal-border/70 bg-terminal-panel/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)] md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TerminalBadge variant="accent">News & Sentiment</TerminalBadge>
                <TerminalBadge variant="info">{region === "IN" ? "🇮🇳 India" : "🇺🇸 United States"}</TerminalBadge>
                <TerminalBadge variant="neutral">
                  {isTickerMode && (tickerDisplay || currentTicker) ? tickerDisplay || currentTicker : `${REGION_LABEL[region]} market feed`}
                </TerminalBadge>
              </div>
              <h1 className="max-w-4xl font-sans text-2xl font-semibold tracking-normal text-terminal-text md:text-3xl">
                Track the story moving your stocks.
              </h1>
              <p className="mt-2 max-w-3xl font-sans text-sm leading-6 text-terminal-muted">
                {isTickerMode && (tickerDisplay || currentTicker)
                  ? `Sentiment-scored headlines for ${tickerDisplay || currentTicker}, refreshed live.`
                  : `Sentiment-scored ${REGION_LABEL[region]} market headlines, refreshed live. Switch the market in the header to change the region.`}
              </p>
              <div className="mt-2 text-[10px] text-terminal-muted">
                Source: {newsQuery.data?.sourceMode || "-"} {newsQuery.data?.searchTerm ? `(${newsQuery.data.searchTerm})` : ""} | Refreshed: {new Date(lastRefreshMs).toLocaleTimeString()}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs md:min-w-[420px]">
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Articles</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{summary.total_articles}</div>
              </div>
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Overall</div>
                <div className="mt-1 truncate text-xl font-semibold text-terminal-text">{summary.overall_label}</div>
              </div>
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Bullish</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{summary.bullish_pct}%</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px]">
              <label className="block">
                <span className="mb-1 block font-sans text-xs text-terminal-muted">Search news</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
                  <TerminalInput
                    value={searchInput}
                    onChange={(e) => {
                      setIsTickerMode(false);
                      setSearchInput(e.target.value);
                    }}
                    className="pl-9"
                    tone="ui"
                    placeholder="Search news..."
                  />
                </div>
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 font-sans text-xs text-terminal-muted">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Period
                </span>
                <TerminalInput
                  as="select"
                  value={String(periodDays)}
                  onChange={(e) => setPeriodDays(Number(e.target.value) as PeriodOption)}
                  tone="ui"
                >
                  {PERIOD_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}d
                    </option>
                  ))}
                </TerminalInput>
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 font-sans text-xs text-terminal-muted">
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden="true" />
                  Sort
                </span>
                <TerminalInput
                  as="select"
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as "time" | "sentiment")}
                  tone="ui"
                >
                  <option value="time">Time</option>
                  <option value="sentiment">Sentiment</option>
                </TerminalInput>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <TerminalButton variant="accent" size="lg" leftIcon={<Newspaper className="h-4 w-4" />} onClick={() => setIsTickerMode(true)}>
                Use ticker
              </TerminalButton>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <TerminalPanel
              title="Headlines"
              subtitle={`${periodItems.length} articles in the last ${periodDays}d`}
              actions={
                <TerminalBadge variant="info" dot>
                  {sortMode === "time" ? "Time" : "Sentiment"}
                </TerminalBadge>
              }
            >
              {(newsQuery.isLoading || (isTickerMode && sentimentQuery.isLoading)) && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={idx} className="h-20 animate-pulse rounded border border-terminal-border bg-terminal-bg/60" />
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
                  <article key={item.id} className="rounded border border-terminal-border bg-terminal-bg/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SentimentBadge label={item.sentiment.label} score={item.sentiment.score} confidence={item.sentiment.confidence} />
                      <div className="flex flex-wrap items-center gap-2">
                        {isTickerMode && (
                          <span className="rounded border border-terminal-border bg-terminal-panel/70 px-1.5 py-0.5 text-[10px] text-terminal-muted">
                            {relevanceReason(item, currentTicker, relevanceAliases)}
                          </span>
                        )}
                        <div className="text-[11px] text-terminal-muted">{relativeTime(item.publishedAt, nowMs)}</div>
                      </div>
                    </div>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-2 block font-sans text-sm font-semibold text-terminal-accent hover:underline">
                      {item.title}
                    </a>
                    <div className="mt-1 text-[11px] text-terminal-muted">
                      {item.source} | {formatPublishedTime(item.publishedAt)}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-terminal-text">{item.summary || "-"}</p>
                  </article>
                ))}
                {!newsQuery.isLoading && visibleItems.length === 0 && (
                  <div className="rounded border border-terminal-border bg-terminal-bg/60 p-3 text-xs text-terminal-muted">
                    {isTickerMode ? `No relevant latest news found for ${currentTicker}.` : "No news found for this search"}
                  </div>
                )}
              </div>

              {visibleCount < periodItems.length && (
                <div className="pt-3">
                  <TerminalButton variant="default" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} leftIcon={<Filter className="h-3.5 w-3.5" />}>
                    Load more
                  </TerminalButton>
                </div>
              )}
            </TerminalPanel>

            {isTickerMode && currentTicker && (
              <EmotionIndicator
                ticker={currentTicker}
                data={emotionQuery.data}
                isLoading={emotionQuery.isLoading}
                isError={emotionQuery.isError}
              />
            )}
          </div>

          <aside className="space-y-4">
            <NewsSentimentOverview
              overallLabel={summary.overall_label as "Bullish" | "Bearish" | "Neutral"}
              averageScore={Number(summary.average_score)}
              bullishPct={Number(summary.bullish_pct)}
              neutralPct={Number(summary.neutral_pct)}
              bearishPct={Number(summary.bearish_pct)}
              totalArticles={Number(summary.total_articles)}
              periodDays={periodDays}
              dailySentiment={(summary.daily_sentiment ?? []) as Array<{ date: string; avg_score: number; count: number }>}
              sectors={(marketSentimentQuery.data?.sectors ?? []).map((r) => ({ sector: String(r.sector), avg_sentiment: Number(r.avg_sentiment) }))}
              topSources={(sentimentSummaryQuery.data?.top_sources ?? []).map((r) => ({ source: String(r.source), count: Number(r.count) }))}
              keywordInput={keywordInput}
              onKeywordChange={setKeywordInput}
              keywordHits={keywordHits}
            />
          </aside>
        </section>
      </main>
    </div>
  );
}
