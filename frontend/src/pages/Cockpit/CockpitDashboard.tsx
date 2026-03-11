import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import {
  fetchNewsByTicker,
  fetchNewsSentiment,
  fetchNewsSentimentSummary,
  fetchPortfolio,
  fetchPortfolioRiskMetrics,
  type NewsLatestApiItem,
  type NewsSentimentMarketSummary,
  type NewsSentimentSummary,
} from "../../api/client";
import { fetchCockpitSummary, fetchRiskSummary } from "../../api/quantClient";
import {
  SentimentBadge,
  SentimentChart,
  TerminalBadge,
  TerminalButton,
  TerminalInput,
  TerminalPanel,
} from "../../components/terminal";
import {
  useAnalystConsensus,
  usePeerComparison,
  usePortfolioEvents,
  useStock,
  useStockHistory,
  useUpcomingEvents,
} from "../../hooks/useStocks";
import { useSettingsStore } from "../../store/settingsStore";
import { useStockStore } from "../../store/stockStore";
import type { ChartPoint, CorporateEvent, PortfolioResponse, PortfolioRiskMetrics } from "../../types";
import { normalizeTicker } from "../../utils/ticker";

type CockpitSummary = {
  portfolio_snapshot?: {
    total_value?: unknown;
    daily_pnl?: unknown;
    active_jobs?: unknown;
  };
  signal_summary?: {
    bullish_count?: unknown;
    bearish_count?: unknown;
    neutral_count?: unknown;
  };
  risk_summary?: {
    var_95?: unknown;
    beta?: unknown;
    ewma_vol?: unknown;
  };
  events?:
    | Array<{ symbol?: string; event_type?: string; name?: string; date?: string }>
    | { events?: Array<{ symbol?: string; event_type?: string; name?: string; date?: string }> };
  news?:
    | Array<{ source?: string; headline?: string; url?: string; published_at?: string }>
    | { news?: Array<{ source?: string; headline?: string; url?: string; published_at?: string }> };
};

type DeskHeadline = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  summary: string | null;
  sentiment: {
    score: number | null;
    label: string | null;
    confidence: number | null;
  } | null;
};

type DeskEvent = {
  key: string;
  symbol: string;
  title: string;
  eventType: string;
  date: string;
  impact: string;
  scope: "focus" | "portfolio" | "desk";
};

const EMPTY_PORTFOLIO: PortfolioResponse = {
  items: [],
  summary: {
    total_cost: 0,
    total_value: 0,
    overall_pnl: 0,
  },
};

function asNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function pctValue(value: unknown, scaleUnit = false): number | null {
  const next = asNumber(value);
  if (next == null) return null;
  if (scaleUnit && Math.abs(next) <= 1) return next * 100;
  return next;
}

function fmtNumber(value: unknown, digits = 0): string {
  const next = asNumber(value);
  if (next == null) return "--";
  return next.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCurrency(value: unknown, currency = "USD", digits = 0): string {
  const next = asNumber(value);
  if (next == null) return "--";
  try {
    return next.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return `${currency} ${fmtNumber(next, digits)}`;
  }
}

function fmtSignedCurrency(value: unknown, currency = "USD", digits = 0): string {
  const next = asNumber(value);
  if (next == null) return "--";
  const base = fmtCurrency(Math.abs(next), currency, digits);
  if (base === "--") return base;
  return `${next >= 0 ? "+" : "-"}${base}`;
}

function fmtPct(value: unknown, digits = 2, scaleUnit = false): string {
  const next = pctValue(value, scaleUnit);
  if (next == null) return "--";
  return `${next >= 0 ? "+" : ""}${next.toFixed(digits)}%`;
}

function formatDateLabel(value: string | null | undefined, withTime = false): string {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return withTime
    ? date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
}

function toNewsArray(summary: CockpitSummary | null | undefined) {
  if (Array.isArray(summary?.news)) return summary.news;
  if (Array.isArray(summary?.news?.news)) return summary.news.news;
  return [];
}

function toEventArray(summary: CockpitSummary | null | undefined) {
  if (Array.isArray(summary?.events)) return summary.events;
  if (Array.isArray(summary?.events?.events)) return summary.events.events;
  return [];
}

function marketTone(label: string | null | undefined, score: number | null | undefined) {
  const nextLabel = (label || "").trim() || (score == null ? "Mixed" : score > 0.1 ? "Bullish" : score < -0.1 ? "Bearish" : "Neutral");
  const normalized = nextLabel.toLowerCase();
  if (normalized.includes("bull")) return { variant: "success" as const, label: nextLabel };
  if (normalized.includes("bear")) return { variant: "danger" as const, label: nextLabel };
  if (normalized.includes("neutral")) return { variant: "neutral" as const, label: nextLabel };
  return { variant: "accent" as const, label: nextLabel };
}

function normalizeHeadline(item: NewsLatestApiItem): DeskHeadline {
  return {
    id: String(item.id ?? `${item.source}-${item.title}`),
    title: item.title || "Desk headline",
    source: item.source || "Newswire",
    url: item.url || "/equity/news",
    publishedAt: typeof item.published_at === "string" ? item.published_at : null,
    summary: item.summary || null,
    sentiment: item.sentiment
      ? {
          score: asNumber(item.sentiment.score),
          label: item.sentiment.label || null,
          confidence: asNumber(item.sentiment.confidence),
        }
      : null,
  };
}

function buildFallbackHeadlineRows(summary: CockpitSummary | null | undefined): DeskHeadline[] {
  return toNewsArray(summary).map((item, index) => ({
    id: `desk-fallback-${index}`,
    title: String(item.headline || "Desk headline"),
    source: String(item.source || "Desk Wire"),
    url: String(item.url || "/equity/news"),
    publishedAt: typeof item.published_at === "string" ? item.published_at : null,
    summary: null,
    sentiment: null,
  }));
}

function buildDeskEvents(
  focusTicker: string,
  focusEvents: CorporateEvent[],
  portfolioEvents: CorporateEvent[],
  summary: CockpitSummary | null | undefined,
): DeskEvent[] {
  const next: DeskEvent[] = [];
  const seen = new Set<string>();

  const push = (row: Omit<DeskEvent, "key">) => {
    const dedupeKey = [row.symbol, row.title, row.date, row.scope].join("|");
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    next.push({ ...row, key: dedupeKey });
  };

  for (const event of focusEvents) {
    push({
      symbol: (event.symbol || focusTicker).toUpperCase(),
      title: event.title || event.description || "Security catalyst",
      eventType: event.event_type || "event",
      date: event.event_date,
      impact: event.impact || "neutral",
      scope: "focus",
    });
  }

  for (const event of portfolioEvents) {
    push({
      symbol: (event.symbol || focusTicker).toUpperCase(),
      title: event.title || event.description || "Portfolio catalyst",
      eventType: event.event_type || "event",
      date: event.event_date,
      impact: event.impact || "neutral",
      scope: (event.symbol || "").toUpperCase() === focusTicker ? "focus" : "portfolio",
    });
  }

  for (const event of toEventArray(summary)) {
    push({
      symbol: String(event.symbol || focusTicker).toUpperCase(),
      title: String(event.name || event.event_type || "Desk event"),
      eventType: String(event.event_type || "event"),
      date: String(event.date || ""),
      impact: "neutral",
      scope: "desk",
    });
  }

  return next.sort((left, right) => {
    const leftTs = new Date(left.date).getTime();
    const rightTs = new Date(right.date).getTime();
    if (!Number.isFinite(leftTs) && !Number.isFinite(rightTs)) return 0;
    if (!Number.isFinite(leftTs)) return 1;
    if (!Number.isFinite(rightTs)) return -1;
    return leftTs - rightTs;
  });
}

function FocusChart({ ticker, points }: { ticker: string; points: ChartPoint[] }) {
  const closes = points
    .map((point) => asNumber(point.c))
    .filter((value): value is number => value != null);

  if (closes.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg text-xs text-terminal-muted">
        No 6M trend data available for {ticker}.
      </div>
    );
  }

  const width = 360;
  const height = 120;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = Math.max(1e-9, max - min);
  const polylinePoints = closes
    .map((close, index) => {
      const x = (index / Math.max(1, closes.length - 1)) * width;
      const y = height - ((close - min) / span) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const polygonPoints = `0,${height} ${polylinePoints} ${width},${height}`;
  const up = closes[closes.length - 1] >= closes[0];
  const gradientId = `desk-focus-${ticker.replace(/[^A-Za-z0-9]/g, "") || "chart"}`;

  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" preserveAspectRatio="none" aria-label={`${ticker} six month trend`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "#00c176" : "#ff5a67"} stopOpacity="0.35" />
            <stop offset="100%" stopColor={up ? "#00c176" : "#ff5a67"} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="#243041" strokeDasharray="4 4" />
        <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="#243041" strokeDasharray="4 4" />
        <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="#243041" strokeDasharray="4 4" />
        <polygon points={polygonPoints} fill={`url(#${gradientId})`} />
        <polyline points={polylinePoints} fill="none" stroke={up ? "#00c176" : "#ff5a67"} strokeWidth="2.5" />
      </svg>
      <div className="mt-2 flex items-center justify-between text-[11px] text-terminal-muted">
        <span>Low {fmtNumber(min, 2)}</span>
        <span>{closes.length} sessions</span>
        <span>High {fmtNumber(max, 2)}</span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  context,
  tone = "text-terminal-text",
}: {
  label: string;
  value: string;
  context?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/70 px-3 py-2">
      <div className="ot-type-label text-terminal-muted">{label}</div>
      <div className={`mt-2 ot-type-data text-sm ${tone}`}>{value}</div>
      {context ? <div className="mt-1 text-[11px] text-terminal-muted">{context}</div> : null}
    </div>
  );
}

function SignalMeter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "positive" | "negative" | "accent";
}) {
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const fillClass =
    tone === "positive"
      ? "bg-terminal-pos/60"
      : tone === "negative"
      ? "bg-terminal-neg/60"
      : "bg-terminal-accent/60";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-terminal-muted">{label}</span>
        <span className="ot-type-data text-terminal-text">{value == null ? "--" : `${clamped.toFixed(0)}%`}</span>
      </div>
      <div className="h-2 rounded bg-terminal-bg">
        <div className={`h-2 rounded ${fillClass}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

type DeskRoute = "security" | "chart" | "news" | "screener" | "portfolio" | "risk" | "macro";

export function CockpitDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const storeTicker = useStockStore((state) => state.ticker);
  const setTicker = useStockStore((state) => state.setTicker);
  const loadTicker = useStockStore((state) => state.load);
  const focusTicker = normalizeTicker(searchParams.get("ticker") || storeTicker || "AAPL");
  const [tickerDraft, setTickerDraft] = useState(focusTicker);

  useEffect(() => {
    setTickerDraft(focusTicker);
  }, [focusTicker]);

  useEffect(() => {
    setTicker(focusTicker);
    void loadTicker();
  }, [focusTicker, loadTicker, setTicker]);

  const cockpitQuery = useQuery<CockpitSummary>({
    queryKey: ["cockpit-summary"],
    queryFn: async () => (await fetchCockpitSummary()) as CockpitSummary,
    staleTime: 60_000,
  });
  const stockQuery = useStock(focusTicker);
  const historyQuery = useStockHistory(focusTicker, "6mo", "1d");
  const analystQuery = useAnalystConsensus(focusTicker);
  const peerQuery = usePeerComparison(focusTicker);
  const focusEventsQuery = useUpcomingEvents(focusTicker, 45);
  const newsQuery = useQuery<NewsLatestApiItem[]>({
    queryKey: ["cockpit", "news", selectedMarket, focusTicker],
    queryFn: () => fetchNewsByTicker(focusTicker, 8, selectedMarket),
    enabled: Boolean(focusTicker),
    staleTime: 30_000,
  });
  const sentimentQuery = useQuery<NewsSentimentSummary>({
    queryKey: ["cockpit", "sentiment", selectedMarket, focusTicker],
    queryFn: () => fetchNewsSentiment(focusTicker, 14, selectedMarket),
    enabled: Boolean(focusTicker),
    staleTime: 60_000,
  });
  const sentimentSummaryQuery = useQuery<NewsSentimentMarketSummary>({
    queryKey: ["cockpit", "market-sentiment-summary", selectedMarket],
    queryFn: () => fetchNewsSentimentSummary(7, 120),
    staleTime: 60_000,
  });
  const portfolioQuery = useQuery<PortfolioResponse>({
    queryKey: ["cockpit", "portfolio"],
    queryFn: fetchPortfolio,
    staleTime: 60_000,
  });
  const portfolioRiskQuery = useQuery<PortfolioRiskMetrics | null>({
    queryKey: ["cockpit", "portfolio-risk"],
    queryFn: async () => {
      try {
        return await fetchPortfolioRiskMetrics({ benchmark: "SPY" });
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
  const riskSummaryQuery = useQuery<Record<string, unknown>>({
    queryKey: ["cockpit", "risk-summary", focusTicker],
    queryFn: async () => (await fetchRiskSummary(focusTicker)) as Record<string, unknown>,
    enabled: Boolean(focusTicker),
    staleTime: 60_000,
  });

  const portfolio = portfolioQuery.data ?? EMPTY_PORTFOLIO;
  const portfolioSymbols = useMemo(
    () => Array.from(new Set((portfolio.items || []).map((item) => item.ticker).filter(Boolean))),
    [portfolio.items],
  );
  const portfolioEventsQuery = usePortfolioEvents(portfolioSymbols, 45);

  const cockpit = cockpitQuery.data ?? null;
  const stock = stockQuery.data;
  const stockRecord = (stockQuery.data ?? {}) as Record<string, unknown>;
  const analyst = (analystQuery.data ?? {}) as Record<string, unknown>;
  const focusRisk = (riskSummaryQuery.data ?? {}) as Record<string, unknown>;
  const peerMetrics = peerQuery.data?.metrics ?? [];
  const chartPoints = historyQuery.data?.data ?? [];
  const currency =
    stock?.classification?.currency ||
    (selectedMarket === "NSE" || selectedMarket === "BSE" ? "INR" : "USD");
  const currentPrice = asNumber(stock?.current_price ?? stockRecord.current_price);
  const changePct = pctValue(stock?.change_pct ?? stockRecord.change_pct);
  const week52Low = asNumber(stock?.fifty_two_week_low ?? stockRecord["52w_low"] ?? stockRecord.low_52_week);
  const week52High = asNumber(stock?.fifty_two_week_high ?? stockRecord["52w_high"] ?? stockRecord.high_52_week);
  const dayOpen = asNumber(stockRecord.open);
  const dayHigh = asNumber(stockRecord.day_high ?? stockRecord.high);
  const dayLow = asNumber(stockRecord.day_low ?? stockRecord.low);
  const portfolioValue = asNumber(portfolio.summary.total_value) ?? asNumber(cockpit?.portfolio_snapshot?.total_value);
  const lifetimePnl = asNumber(portfolio.summary.overall_pnl);
  const dailyPnl = asNumber(cockpit?.portfolio_snapshot?.daily_pnl);
  const activeJobs = asNumber(cockpit?.portfolio_snapshot?.active_jobs);
  const focusBeta = asNumber(focusRisk.beta ?? cockpit?.risk_summary?.beta ?? stock?.beta);
  const focusVar95 = asNumber(focusRisk.var_95 ?? cockpit?.risk_summary?.var_95);
  const focusEwmaVol = asNumber(focusRisk.ewma_vol ?? cockpit?.risk_summary?.ewma_vol);
  const marketToneBadge = marketTone(sentimentSummaryQuery.data?.overall_label ?? null, asNumber(sentimentSummaryQuery.data?.average_score));
  const buyPct = pctValue(analyst.buy_pct, true);
  const holdPct = pctValue(analyst.hold_pct, true);
  const sellPct = pctValue(analyst.sell_pct, true);
  const topHoldings = useMemo(
    () =>
      [...portfolio.items]
        .sort((left, right) => Number(right.current_value ?? 0) - Number(left.current_value ?? 0))
        .slice(0, 6),
    [portfolio.items],
  );
  const quickFocusSymbols = useMemo(
    () => Array.from(new Set([focusTicker, ...topHoldings.map((item) => item.ticker)])).slice(0, 6),
    [focusTicker, topHoldings],
  );
  const headlines = useMemo(() => {
    const preferred = (newsQuery.data ?? []).map(normalizeHeadline);
    return preferred.length ? preferred : buildFallbackHeadlineRows(cockpit);
  }, [cockpit, newsQuery.data]);
  const deskEvents = useMemo(
    () => buildDeskEvents(focusTicker, focusEventsQuery.data ?? [], portfolioEventsQuery.data ?? [], cockpit).slice(0, 10),
    [cockpit, focusEventsQuery.data, focusTicker, portfolioEventsQuery.data],
  );
  const bullishShare =
    pctValue(sentimentQuery.data?.bullish_pct, true) ??
    (() => {
      const bullish = asNumber(cockpit?.signal_summary?.bullish_count) ?? 0;
      const bearish = asNumber(cockpit?.signal_summary?.bearish_count) ?? 0;
      const neutral = asNumber(cockpit?.signal_summary?.neutral_count) ?? 0;
      const total = bullish + bearish + neutral;
      return total > 0 ? (bullish / total) * 100 : null;
    })();
  const bearishShare =
    pctValue(sentimentQuery.data?.bearish_pct, true) ??
    (() => {
      const bullish = asNumber(cockpit?.signal_summary?.bullish_count) ?? 0;
      const bearish = asNumber(cockpit?.signal_summary?.bearish_count) ?? 0;
      const neutral = asNumber(cockpit?.signal_summary?.neutral_count) ?? 0;
      const total = bullish + bearish + neutral;
      return total > 0 ? (bearish / total) * 100 : null;
    })();
  const topSources = sentimentSummaryQuery.data?.top_sources?.slice(0, 4) ?? [];

  function applyFocusTicker(nextTicker: string) {
    const normalized = normalizeTicker(nextTicker);
    if (!normalized) return;
    const next = new URLSearchParams(searchParams);
    next.set("ticker", normalized);
    setSearchParams(next, { replace: normalized === focusTicker });
  }

  function openDeskRoute(route: DeskRoute) {
    setTicker(focusTicker);
    void loadTicker();
    switch (route) {
      case "security":
        navigate(`/equity/security/${encodeURIComponent(focusTicker)}?tab=overview`);
        return;
      case "chart":
        navigate("/equity/chart-workstation");
        return;
      case "news":
        navigate(`/equity/security/${encodeURIComponent(focusTicker)}?tab=news`);
        return;
      case "screener":
        navigate(`/equity/screener?symbol=${encodeURIComponent(focusTicker)}`);
        return;
      case "risk":
        navigate("/equity/risk");
        return;
      case "macro":
        navigate("/equity/economics");
        return;
      default:
        navigate("/equity/portfolio");
    }
  }

  async function refreshDesk() {
    await Promise.allSettled([
      cockpitQuery.refetch(),
      stockQuery.refetch(),
      historyQuery.refetch(),
      analystQuery.refetch(),
      peerQuery.refetch(),
      newsQuery.refetch(),
      sentimentQuery.refetch(),
      sentimentSummaryQuery.refetch(),
      portfolioQuery.refetch(),
      portfolioRiskQuery.refetch(),
      riskSummaryQuery.refetch(),
      focusEventsQuery.refetch(),
      portfolioEventsQuery.refetch(),
    ]);
  }

  const refreshing =
    cockpitQuery.isFetching ||
    stockQuery.isFetching ||
    historyQuery.isFetching ||
    newsQuery.isFetching ||
    sentimentQuery.isFetching ||
    portfolioQuery.isFetching ||
    riskSummaryQuery.isFetching;
  const primaryError =
    (stockQuery.error instanceof Error && stockQuery.error.message) ||
    (newsQuery.error instanceof Error && newsQuery.error.message) ||
    (portfolioQuery.error instanceof Error && portfolioQuery.error.message) ||
    null;

  return (
    <div className="h-full min-h-0 overflow-auto p-2">
      <div className="grid gap-2">
        <section className="rounded-sm border border-terminal-border bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.18),transparent_38%),linear-gradient(135deg,rgba(16,22,32,0.98),rgba(10,14,20,0.96))] px-3 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <TerminalBadge variant="accent" dot>
                  Analyst Desk
                </TerminalBadge>
                <TerminalBadge variant={marketToneBadge.variant}>{marketToneBadge.label}</TerminalBadge>
                <TerminalBadge variant="info">{selectedMarket}</TerminalBadge>
                <TerminalBadge variant="neutral">Focus {focusTicker}</TerminalBadge>
              </div>
              <div>
                <h1 className="ot-type-heading-lg text-terminal-text">Analyst Intelligence Workspace</h1>
                <p className="mt-1 max-w-3xl text-sm text-terminal-muted">
                  Bloomberg-style desk packaging for security monitoring, sentiment, risk, and portfolio context with a single focus ticker.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quickFocusSymbols.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => applyFocusTicker(symbol)}
                    className={`rounded-sm border px-2 py-1 text-[11px] uppercase tracking-wide ${
                      symbol === focusTicker
                        ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                        : "border-terminal-border bg-terminal-bg/60 text-terminal-muted hover:text-terminal-text"
                    }`}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2 xl:min-w-[30rem]">
              <form
                className="grid gap-2 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyFocusTicker(tickerDraft);
                }}
              >
                <TerminalInput
                  value={tickerDraft}
                  onChange={(event) => setTickerDraft(event.target.value.toUpperCase())}
                  placeholder="Ticker or symbol"
                  spellCheck={false}
                />
                <TerminalButton type="submit" variant="accent">
                  Load Focus
                </TerminalButton>
              </form>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <TerminalButton size="md" onClick={() => openDeskRoute("security")}>Security Hub</TerminalButton>
                <TerminalButton size="md" onClick={() => openDeskRoute("chart")}>Chart Desk</TerminalButton>
                <TerminalButton size="md" onClick={() => openDeskRoute("news")}>News</TerminalButton>
                <TerminalButton size="md" onClick={() => openDeskRoute("screener")}>Screener</TerminalButton>
                <TerminalButton size="md" onClick={() => openDeskRoute("portfolio")}>Portfolio</TerminalButton>
                <TerminalButton size="md" onClick={() => openDeskRoute("risk")}>Risk</TerminalButton>
                <TerminalButton size="md" onClick={() => openDeskRoute("macro")}>Macro</TerminalButton>
                <TerminalButton size="md" variant="ghost" loading={refreshing} onClick={() => void refreshDesk()}>
                  Refresh Desk
                </TerminalButton>
              </div>
            </div>
          </div>
        </section>

        {primaryError ? (
          <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-3 py-2 text-sm text-terminal-neg">
            Desk data is partially unavailable: {primaryError}
          </div>
        ) : null}

        <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Desk Focus" value={focusTicker} context={stock?.company_name || "Active security"} tone="text-terminal-accent" />
          <MetricCard label="Last Price" value={fmtCurrency(currentPrice, currency, 2)} context={stock?.exchange || stock?.sector || "Quote monitor"} />
          <MetricCard
            label="Change %"
            value={fmtPct(changePct)}
            context={sentimentQuery.data ? `${sentimentQuery.data.total_articles} articles in scope` : "Intraday move"}
            tone={changePct != null && changePct < 0 ? "text-terminal-neg" : "text-terminal-pos"}
          />
          <MetricCard label="Portfolio Value" value={fmtCurrency(portfolioValue, currency, 0)} context={`${portfolio.items.length} holdings on desk`} />
          <MetricCard
            label="Day PnL"
            value={fmtSignedCurrency(dailyPnl, currency, 0)}
            context={lifetimePnl != null ? `Lifetime ${fmtSignedCurrency(lifetimePnl, currency, 0)}` : "Daily monitor"}
            tone={dailyPnl != null && dailyPnl < 0 ? "text-terminal-neg" : "text-terminal-pos"}
          />
          <MetricCard
            label="Desk Risk"
            value={focusVar95 != null ? `${fmtNumber(focusVar95, 2)} VaR95` : fmtNumber(focusBeta, 2)}
            context={activeJobs != null ? `${fmtNumber(activeJobs, 0)} active jobs` : "Risk snapshot"}
            tone="text-terminal-warn"
          />
        </section>

        <section className="grid gap-2 xl:grid-cols-[1.15fr_1fr_0.9fr]">
          <div className="grid gap-2">
            <TerminalPanel
              title="Focus Security"
              subtitle={stock?.company_name || "Desk focus snapshot"}
              actions={
                <div className="flex flex-wrap items-center gap-1">
                  {stock?.sector ? <TerminalBadge variant="neutral">{stock.sector}</TerminalBadge> : null}
                  {stock?.industry ? <TerminalBadge variant="info">{stock.industry}</TerminalBadge> : null}
                  {sentimentQuery.data ? (
                    <SentimentBadge
                      label={sentimentQuery.data.overall_label}
                      score={sentimentQuery.data.average_score}
                      confidence={Math.abs(Number(sentimentQuery.data.average_score || 0))}
                    />
                  ) : null}
                </div>
              }
              bodyClassName="space-y-3"
            >
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="52W Low" value={fmtCurrency(week52Low, currency, 2)} />
                <MetricCard label="52W High" value={fmtCurrency(week52High, currency, 2)} />
                <MetricCard label="Open" value={fmtCurrency(dayOpen, currency, 2)} />
                <MetricCard label="Day Range" value={`${fmtCurrency(dayLow, currency, 2)} / ${fmtCurrency(dayHigh, currency, 2)}`} />
              </div>
              <FocusChart ticker={focusTicker} points={chartPoints} />
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-terminal-muted">Analyst Consensus</div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-lg text-terminal-text">{String(analyst.consensus || "No consensus")}</span>
                    {analyst.target_price != null ? <TerminalBadge variant="accent">Target {fmtCurrency(analyst.target_price, currency, 2)}</TerminalBadge> : null}
                  </div>
                  <div className="space-y-2">
                    <SignalMeter label="Buy" value={buyPct} tone="positive" />
                    <SignalMeter label="Hold" value={holdPct} tone="accent" />
                    <SignalMeter label="Sell" value={sellPct} tone="negative" />
                  </div>
                </div>
                <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-terminal-muted">Desk Signal Mix</div>
                  <div className="space-y-2">
                    <SignalMeter label="Headline Bullish" value={bullishShare} tone="positive" />
                    <SignalMeter label="Headline Bearish" value={bearishShare} tone="negative" />
                    <SignalMeter label="Beta Regime" value={focusBeta != null ? Math.min(100, Math.abs(focusBeta) * 50) : null} tone="accent" />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-sm border border-terminal-border px-2 py-1">
                      <div className="text-terminal-muted">EWMA Vol</div>
                      <div className="ot-type-data text-terminal-text">{focusEwmaVol != null ? fmtPct(focusEwmaVol, 2, true) : "--"}</div>
                    </div>
                    <div className="rounded-sm border border-terminal-border px-2 py-1">
                      <div className="text-terminal-muted">Market Cap</div>
                      <div className="ot-type-data text-terminal-text">{fmtCurrency(stock?.market_cap, currency, 0)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Peers and Coverage Queue" subtitle="Benchmarking metrics and source mix" bodyClassName="space-y-3">
              <div className="rounded-sm border border-terminal-border bg-terminal-bg">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border text-terminal-muted">
                      <th className="px-2 py-1 text-left">Metric</th>
                      <th className="px-2 py-1 text-right">Target</th>
                      <th className="px-2 py-1 text-right">Peer Median</th>
                      <th className="px-2 py-1 text-right">Percentile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peerMetrics.slice(0, 8).map((metric) => (
                      <tr key={metric.metric} className="border-b border-terminal-border/60">
                        <td className="px-2 py-1 text-terminal-text">{metric.metric}</td>
                        <td className="px-2 py-1 text-right">{fmtNumber(metric.target_value, 2)}</td>
                        <td className="px-2 py-1 text-right">{fmtNumber(metric.peer_median, 2)}</td>
                        <td className="px-2 py-1 text-right">{metric.target_percentile != null ? fmtPct(metric.target_percentile, 1) : "--"}</td>
                      </tr>
                    ))}
                    {peerMetrics.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-terminal-muted" colSpan={4}>Peer comparison metrics are not available for the current focus ticker.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-terminal-muted">Coverage Queue</div>
                  <div className="space-y-2">
                    {topHoldings.slice(0, 4).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => applyFocusTicker(item.ticker)}
                        className="flex w-full items-center justify-between rounded-sm border border-terminal-border px-2 py-1 text-left hover:border-terminal-accent"
                      >
                        <span className="text-terminal-text">{item.ticker}</span>
                        <span className="text-[11px] text-terminal-muted">{fmtCurrency(item.current_value, currency, 0)}</span>
                      </button>
                    ))}
                    {topHoldings.length === 0 ? <div className="text-[11px] text-terminal-muted">Portfolio is empty.</div> : null}
                  </div>
                </div>
                <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-terminal-muted">Market Sentiment Sources</div>
                  <div className="flex flex-wrap gap-1.5">
                    {topSources.map((source) => (
                      <TerminalBadge key={source.source} variant="info">{source.source} {source.count}</TerminalBadge>
                    ))}
                    {topSources.length === 0 ? <span className="text-[11px] text-terminal-muted">No source distribution available.</span> : null}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <MetricCard label="Bullish" value={fmtPct(sentimentSummaryQuery.data?.distribution?.bullish_pct, 1, true)} tone="text-terminal-pos" />
                    <MetricCard label="Neutral" value={fmtPct(sentimentSummaryQuery.data?.distribution?.neutral_pct, 1, true)} />
                    <MetricCard label="Bearish" value={fmtPct(sentimentSummaryQuery.data?.distribution?.bearish_pct, 1, true)} tone="text-terminal-neg" />
                  </div>
                </div>
              </div>
            </TerminalPanel>
          </div>

          <div className="grid gap-2">
            <TerminalPanel title="Headline Monitor" subtitle={`${headlines.length} focus headlines`} bodyClassName="space-y-2">
              {headlines.slice(0, 8).map((headline) => {
                const external = /^https?:\/\//i.test(headline.url);
                return (
                  <a
                    key={headline.id}
                    href={headline.url}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer" : undefined}
                    className="block rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2 hover:border-terminal-accent"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <TerminalBadge variant="neutral">{headline.source}</TerminalBadge>
                      {headline.sentiment ? <SentimentBadge label={headline.sentiment.label} score={headline.sentiment.score} confidence={headline.sentiment.confidence} /> : null}
                      <span className="text-[11px] text-terminal-muted">{formatDateLabel(headline.publishedAt, true)}</span>
                    </div>
                    <div className="mt-2 text-sm text-terminal-text">{headline.title}</div>
                    {headline.summary ? <div className="mt-1 text-[11px] text-terminal-muted">{headline.summary}</div> : null}
                  </a>
                );
              })}
              {headlines.length === 0 ? <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-6 text-sm text-terminal-muted">No ticker headlines or cockpit wire fallback are available.</div> : null}
            </TerminalPanel>

            <TerminalPanel
              title="Sentiment Pulse"
              subtitle={sentimentQuery.data ? `${sentimentQuery.data.total_articles} articles over ${sentimentQuery.data.period_days} days` : "News sentiment trend"}
              bodyClassName="space-y-3"
            >
              <SentimentChart data={sentimentQuery.data?.daily_sentiment ?? []} height={190} />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Overall"
                  value={String(sentimentQuery.data?.overall_label || marketToneBadge.label)}
                  tone={marketTone(sentimentQuery.data?.overall_label, asNumber(sentimentQuery.data?.average_score)).variant === "danger" ? "text-terminal-neg" : "text-terminal-pos"}
                />
                <MetricCard label="Average Score" value={fmtNumber(sentimentQuery.data?.average_score, 2)} />
                <MetricCard label="Bullish %" value={fmtPct(sentimentQuery.data?.bullish_pct, 1, true)} tone="text-terminal-pos" />
                <MetricCard label="Bearish %" value={fmtPct(sentimentQuery.data?.bearish_pct, 1, true)} tone="text-terminal-neg" />
              </div>
            </TerminalPanel>
          </div>

          <div className="grid gap-2">
            <TerminalPanel title="Portfolio Monitor" subtitle="Largest active holdings" bodyClassName="space-y-2">
              <div className="rounded-sm border border-terminal-border bg-terminal-bg">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border text-terminal-muted">
                      <th className="px-2 py-1 text-left">Ticker</th>
                      <th className="px-2 py-1 text-left">Sector</th>
                      <th className="px-2 py-1 text-right">Value</th>
                      <th className="px-2 py-1 text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topHoldings.map((item) => (
                      <tr key={item.id} className="border-b border-terminal-border/60">
                        <td className="px-2 py-1">
                          <button type="button" onClick={() => applyFocusTicker(item.ticker)} className="text-terminal-accent hover:underline">
                            {item.ticker}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-terminal-muted">{item.sector || "--"}</td>
                        <td className="px-2 py-1 text-right">{fmtCurrency(item.current_value, currency, 0)}</td>
                        <td className={`px-2 py-1 text-right ${Number(item.pnl ?? 0) < 0 ? "text-terminal-neg" : "text-terminal-pos"}`}>
                          {fmtSignedCurrency(item.pnl, currency, 0)}
                        </td>
                      </tr>
                    ))}
                    {topHoldings.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-terminal-muted" colSpan={4}>No holdings loaded for the desk.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Risk Monitor" subtitle="Ticker and portfolio overlay" bodyClassName="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <MetricCard label="Focus Beta" value={fmtNumber(focusBeta, 2)} />
                <MetricCard label="VaR 95" value={fmtNumber(focusVar95, 2)} />
                <MetricCard label="Sharpe" value={fmtNumber(portfolioRiskQuery.data?.sharpe_ratio, 2)} />
                <MetricCard label="Max Drawdown" value={fmtPct(portfolioRiskQuery.data?.max_drawdown, 2, true)} />
              </div>
              <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3 text-[11px]">
                <div className="mb-2 uppercase tracking-wide text-terminal-muted">Portfolio Risk Ratios</div>
                <div className="grid grid-cols-3 gap-2">
                  <div><div className="text-terminal-muted">Sortino</div><div className="ot-type-data text-terminal-text">{fmtNumber(portfolioRiskQuery.data?.sortino_ratio, 2)}</div></div>
                  <div><div className="text-terminal-muted">Alpha</div><div className="ot-type-data text-terminal-text">{fmtPct(portfolioRiskQuery.data?.alpha, 2, true)}</div></div>
                  <div><div className="text-terminal-muted">Info Ratio</div><div className="ot-type-data text-terminal-text">{fmtNumber(portfolioRiskQuery.data?.information_ratio, 2)}</div></div>
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Catalyst Agenda" subtitle="Focus, portfolio, and cockpit events" bodyClassName="space-y-2">
              {deskEvents.map((event) => (
                <div key={event.key} className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <TerminalBadge variant={event.scope === "focus" ? "accent" : event.scope === "portfolio" ? "info" : "neutral"}>
                      {event.scope.toUpperCase()}
                    </TerminalBadge>
                    <TerminalBadge variant="neutral">{event.symbol}</TerminalBadge>
                    <span className="text-[11px] text-terminal-muted">{formatDateLabel(event.date)}</span>
                  </div>
                  <div className="mt-2 text-sm text-terminal-text">{event.title}</div>
                  <div className="mt-1 text-[11px] text-terminal-muted">{event.eventType} | impact {event.impact}</div>
                </div>
              ))}
              {deskEvents.length === 0 ? <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-6 text-sm text-terminal-muted">No near-term catalysts are available for the current desk scope.</div> : null}
            </TerminalPanel>
          </div>
        </section>
      </div>
    </div>
  );
}
