import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchLatestNews, fetchNewsByTicker, fetchNewsSentiment, searchLatestNews, type NewsLatestApiItem } from "../api/client";
import { useStock } from "../hooks/useStocks";
import { useStockStore } from "../store/stockStore";

type SentimentLabel = "Bullish" | "Bearish" | "Neutral";
type PeriodOption = 1 | 3 | 7 | 14 | 30;

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
  if (label === "Bullish") return "#10b981";
  if (label === "Bearish") return "#ef4444";
  return "#6b7280";
}

function sentimentDot(label: SentimentLabel): string {
  if (label === "Bullish") return "🟢";
  if (label === "Bearish") return "🔴";
  return "⚪";
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

  const newsQuery = useQuery({
    queryKey: ["news-page", currentTicker, debouncedSearch, isTickerMode],
    queryFn: () => {
      if (isTickerMode && currentTicker) return fetchNewsByTicker(currentTicker, 200);
      return debouncedSearch ? searchLatestNews(debouncedSearch, 200) : fetchLatestNews(200);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const sentimentQuery = useQuery({
    queryKey: ["news-sentiment", currentTicker, periodDays],
    queryFn: () => fetchNewsSentiment(currentTicker, periodDays),
    enabled: isTickerMode && Boolean(currentTicker),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const normalizedItems = useMemo(
    () => (newsQuery.data ?? []).map(normalizeNewsItem).filter((v): v is UiNewsItem => Boolean(v)),
    [newsQuery.data],
  );

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
  }, [debouncedSearch, periodDays, periodItems.length]);

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

  const summary = isTickerMode && sentimentQuery.data ? sentimentQuery.data : {
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
            <button
              className="rounded border border-terminal-border px-2 py-1 text-xs"
              onClick={() => setIsTickerMode(true)}
            >
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
            <span
              className="rounded px-2 py-0.5 text-[11px] font-semibold text-black"
              style={{ backgroundColor: sentimentColor(summary.overall_label as SentimentLabel) }}
            >
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
            <div style={{ width: `${summary.bullish_pct}%`, background: "#10b981" }} />
            <div style={{ width: `${summary.neutral_pct}%`, background: "#6b7280" }} />
            <div style={{ width: `${summary.bearish_pct}%`, background: "#ef4444" }} />
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
              <Tooltip
                contentStyle={{ borderRadius: "4px", border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
                labelStyle={{ color: "#8e98a8" }}
              />
              <Line type="monotone" dataKey="avg_score" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {(newsQuery.isLoading || sentimentQuery.isLoading) && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-20 animate-pulse rounded border border-terminal-border bg-terminal-panel" />
          ))}
        </div>
      )}
      {(newsQuery.isError || sentimentQuery.isError) && (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">Failed to load news sentiment</div>
      )}

      <div className="space-y-2">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded border border-terminal-border bg-terminal-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs">
                {sentimentDot(item.sentiment.label)} {item.sentiment.score >= 0 ? "+" : ""}
                {item.sentiment.score.toFixed(2)}
              </div>
              <div className="text-[11px] text-terminal-muted">{relativeTime(item.publishedAt, nowMs)}</div>
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
            {isTickerMode ? `No news found for ${currentTicker}` : "No news found for this search"}
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
