import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  fetchBacktestV1Presets,
  fetchLatestNews,
  fetchPortfolio,
  fetchPortfolioBenchmarkOverlay,
  fetchQuotesBatch,
  fetchWatchlist,
  type NewsLatestApiItem,
} from "../api/client";
import { LiveClockStrip } from "../components/home/LiveClockStrip";
import { MarketHeatStrip, type MarketHeatStripItem } from "../components/home/MarketHeatStrip";
import { MetricCard } from "../components/home/MetricCard";
import { PortfolioMiniChart } from "../components/home/PortfolioMiniChart";
import { ProfileCompletionRing } from "../components/home/ProfileCompletionRing";
import { QuickNavGrid, type QuickNavSection } from "../components/home/QuickNavGrid";
import { SystemHealthBar, type SystemHealthItem } from "../components/home/SystemHealthBar";
import { TerminalShell } from "../components/layout/TerminalShell";
import { useAuth } from "../contexts/AuthContext";
import { fetchChainSummary } from "../fno/api/fnoApi";
import { useSettingsStore } from "../store/settingsStore";

type MarketRow = {
  symbol: string;
  label?: string;
  ltp: number;
  chg: number;
  chgPct: number;
  flash: "up" | "down" | null;
};

type DashboardSnapshot = {
  equityValue: number | null;
  equityCost: number;
  equityPnl: number | null;
  holdingsCount: number;
  watchlistCount: number;
  watchlistDerivativesCount: number;
  backtestPresetCount: number;
  fnoSpot: number | null;
  fnoPcr: number | null;
  fnoSignal: string;
  updatedAt: number | null;
};

type NavCard = {
  label: string;
  to: string;
  badge: string;
};

const TRANSITION_FLAG_KEY = "ot-terminal-transition";
const NEWS_LIMIT = 15;

const NAV_CARD_SECTIONS: Array<{ title: string; cards: NavCard[] }> = [
  {
    title: "EQUITY",
    cards: [
      { label: "Market", to: "/equity/stocks", badge: "F1" },
      { label: "Economics", to: "/equity/economics", badge: "EC" },
      { label: "Yield Curve", to: "/equity/yield-curve", badge: "YC" },
      { label: "Rotation", to: "/equity/sector-rotation", badge: "ROT" },
      { label: "Security Hub", to: "/equity/security", badge: "SH" },
      { label: "Compare", to: "/equity/compare", badge: "CMP" },
      { label: "Launchpad", to: "/equity/launchpad", badge: "LP" },
      { label: "Workstation", to: "/equity/chart-workstation", badge: "WS" },
      { label: "Crypto", to: "/equity/crypto", badge: "CR" },
      { label: "Screener", to: "/equity/screener", badge: "F2" },
      { label: "Portfolio", to: "/equity/portfolio", badge: "F3" },
      { label: "Paper", to: "/equity/paper", badge: "PP" },
      { label: "Watchlist", to: "/equity/watchlist", badge: "F4" },
    ],
  },
  {
    title: "F&O",
    cards: [
      { label: "Option Chain", to: "/fno", badge: "OP" },
      { label: "Greeks", to: "/fno/greeks", badge: "GR" },
      { label: "OI Analysis", to: "/fno/oi", badge: "OI" },
      { label: "PCR", to: "/fno/pcr", badge: "PCR" },
      { label: "Heatmap", to: "/fno/heatmap", badge: "HM" },
      { label: "Expiry", to: "/fno/expiry", badge: "EXP" },
    ],
  },
  {
    title: "BACK TEST",
    cards: [
      { label: "Backtesting", to: "/backtesting", badge: "F9" },
      { label: "Model Lab", to: "/backtesting/model-lab", badge: "ML" },
      { label: "Model Compare", to: "/backtesting/model-lab/compare", badge: "MC" },
      { label: "Portfolio Lab", to: "/equity/portfolio/lab", badge: "PL" },
      { label: "Portfolio Blends", to: "/equity/portfolio/lab/blends", badge: "BL" },
    ],
  },
  {
    title: "INTEL",
    cards: [
      { label: "Watchlist", to: "/equity/watchlist", badge: "WL" },
      { label: "News", to: "/equity/news", badge: "NW" },
      { label: "Alerts", to: "/equity/alerts", badge: "AL" },
      { label: "Plugins", to: "/equity/plugins", badge: "PLG" },
      { label: "About", to: "/equity/stocks/about", badge: "AB" },
    ],
  },
  {
    title: "SETTINGS",
    cards: [
      { label: "Settings", to: "/equity/settings", badge: "F6" },
      { label: "Account", to: "/account", badge: "ACC" },
      { label: "Cockpit", to: "/equity/cockpit", badge: "CP" },
    ],
  },
];

const INITIAL_MARKET_ROWS: MarketRow[] = [
  { symbol: "^NSEI", label: "NIFTY 50", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "^BSESN", label: "SENSEX", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "^IXIC", label: "NASDAQ", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "^GSPC", label: "S&P 500", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "GC=F", label: "GOLD", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "SI=F", label: "SILVER", ltp: 0, chg: 0, chgPct: 0, flash: null },
  { symbol: "CL=F", label: "CRUDE OIL", ltp: 0, chg: 0, chgPct: 0, flash: null },
];

const MARKET_PULSE_SYMBOLS = INITIAL_MARKET_ROWS.map((row) => row.symbol);

const FALLBACK_PERFORMANCE_POINTS = [
  24300000, 24200000, 24400000, 24500000, 24450000, 24680000, 24720000, 24610000, 24790000, 24840000,
  24770000, 24890000, 24950000, 24810000, 24780000, 24910000, 25030000, 24980000, 25120000, 25190000,
  25150000, 25230000, 25310000, 25280000, 25390000, 25470000, 25420000, 25510000, 25590000, 25670000,
];

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  equityValue: null,
  equityCost: 0,
  equityPnl: null,
  holdingsCount: 0,
  watchlistCount: 0,
  watchlistDerivativesCount: 0,
  backtestPresetCount: 0,
  fnoSpot: null,
  fnoPcr: null,
  fnoSignal: "NA",
  updatedAt: null,
};

function formatPrice(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatInr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "INR --";
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatSignedInr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "INR --";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}INR ${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatCompactDateLabel(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getMetricTone(value: number | null): "accent" | "up" | "down" | "neutral" {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

function getSignalTone(signal: string): "accent" | "up" | "down" | "neutral" {
  const normalized = signal.trim().toUpperCase();
  if (normalized.includes("BULL")) return "up";
  if (normalized.includes("BEAR")) return "down";
  if (normalized === "NA") return "neutral";
  return "accent";
}

function getSystemTone(signal: string): SystemHealthItem["tone"] {
  const normalized = signal.trim().toUpperCase();
  if (normalized.includes("BULL")) return "ok";
  if (normalized.includes("BEAR")) return "warning";
  if (normalized === "NA") return "neutral";
  return "info";
}

function getSentimentClass(label?: string): string {
  if (label === "Bullish") return "text-terminal-pos";
  if (label === "Bearish") return "text-terminal-neg";
  return "text-terminal-muted";
}

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);
  const newsAutoRefresh = useSettingsStore((s) => s.newsAutoRefresh);
  const newsRefreshSec = useSettingsStore((s) => s.newsRefreshSec);

  const [marketRows, setMarketRows] = useState<MarketRow[]>(INITIAL_MARKET_ROWS);
  const [newsLog, setNewsLog] = useState<NewsLatestApiItem[]>([]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY_SNAPSHOT);
  const [performancePoints, setPerformancePoints] = useState<number[]>(FALLBACK_PERFORMANCE_POINTS);
  const [performanceBenchmarkPoints, setPerformanceBenchmarkPoints] = useState<number[]>([]);
  const [performanceLabels, setPerformanceLabels] = useState<string[]>([]);
  const [selectedHeatId, setSelectedHeatId] = useState<string | null>(INITIAL_MARKET_ROWS[0]?.symbol ?? null);
  const [initializing, setInitializing] = useState(() => sessionStorage.getItem(TRANSITION_FLAG_KEY) === "1");

  const loadSnapshot = useCallback(async () => {
    const [portfolioRes, watchlistRes, backtestRes, chainRes, benchmarkRes] = await Promise.allSettled([
      fetchPortfolio(),
      fetchWatchlist(),
      fetchBacktestV1Presets(),
      fetchChainSummary("NIFTY"),
      fetchPortfolioBenchmarkOverlay(),
    ]);

    let next = { ...EMPTY_SNAPSHOT };
    let nextBenchmarkPoints: number[] = [];
    let nextPerformanceLabels: string[] = [];

    if (portfolioRes.status === "fulfilled") {
      const data = portfolioRes.value;
      const derivedValue = data.summary.total_value ?? data.items.reduce((acc, row) => acc + Number(row.current_value ?? 0), 0);
      next.equityValue = Number.isFinite(derivedValue) ? derivedValue : null;
      next.equityCost = Number(data.summary.total_cost ?? 0);
      next.equityPnl =
        typeof data.summary.overall_pnl === "number"
          ? data.summary.overall_pnl
          : next.equityValue != null
            ? next.equityValue - next.equityCost
            : null;
      next.holdingsCount = data.items.length;
    }

    if (watchlistRes.status === "fulfilled") {
      const items = watchlistRes.value;
      next.watchlistCount = items.length;
      next.watchlistDerivativesCount = items.filter((row) => row.has_futures || row.has_options).length;
    }

    if (backtestRes.status === "fulfilled") {
      next.backtestPresetCount = backtestRes.value.length;
    }

    if (chainRes.status === "fulfilled") {
      next.fnoSpot = Number.isFinite(chainRes.value.spot_price) ? chainRes.value.spot_price : null;
      next.fnoPcr = Number.isFinite(chainRes.value.pcr?.pcr_oi) ? chainRes.value.pcr.pcr_oi : null;
      next.fnoSignal = String(chainRes.value.pcr?.signal || "NA").toUpperCase();
    }

    if (benchmarkRes.status === "fulfilled" && benchmarkRes.value?.equity_curve?.length > 0) {
      const curve = benchmarkRes.value.equity_curve;
      const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentCurve = curve.filter((pt) => {
        const ms = Date.parse(`${pt.date}T00:00:00Z`);
        return Number.isFinite(ms) && ms >= cutoffMs;
      });
      const windowCurve = (recentCurve.length >= 2 ? recentCurve : curve.slice(-30)).filter((pt) =>
        Number.isFinite(Number(pt.portfolio)) && Number(pt.portfolio) > 0,
      );

      const currentPortfolioValue =
        next.equityValue != null && Number.isFinite(next.equityValue)
          ? next.equityValue
          : null;
      const lastPortfolio = Number(windowCurve[windowCurve.length - 1]?.portfolio ?? NaN);
      const lastBenchmark = Number(windowCurve[windowCurve.length - 1]?.benchmark ?? NaN);
      const canScalePortfolio = currentPortfolioValue != null && Number.isFinite(lastPortfolio) && lastPortfolio > 0;
      const canScaleBenchmark = currentPortfolioValue != null && Number.isFinite(lastBenchmark) && lastBenchmark > 0;

      const scaledPoints = windowCurve
        .map((pt) => {
          const portfolio = Number(pt.portfolio);
          if (!Number.isFinite(portfolio)) return 0;
          return canScalePortfolio ? (portfolio / lastPortfolio) * currentPortfolioValue! : portfolio;
        })
        .filter((value) => Number.isFinite(value) && value > 0);

      const scaledBenchmarkPoints = windowCurve
        .map((pt) => {
          const benchmark = Number(pt.benchmark);
          if (!Number.isFinite(benchmark)) return 0;
          return canScaleBenchmark ? (benchmark / lastBenchmark) * currentPortfolioValue! : benchmark;
        })
        .filter((value) => Number.isFinite(value) && value > 0);

      if (scaledPoints.length >= 2) {
        setPerformancePoints(scaledPoints);
        nextPerformanceLabels = windowCurve.map((pt) => formatCompactDateLabel(pt.date));
      }

      if (scaledBenchmarkPoints.length >= 2) {
        nextBenchmarkPoints = scaledBenchmarkPoints;
      }
    }

    setPerformanceBenchmarkPoints(nextBenchmarkPoints);
    setPerformanceLabels(nextPerformanceLabels);
    next.updatedAt = Date.now();
    setSnapshot(next);
  }, []);

  useEffect(() => {
    void loadSnapshot();
    const timer = window.setInterval(() => {
      void loadSnapshot();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadSnapshot]);

  useEffect(() => {
    let active = true;

    const loadMarketPulse = async () => {
      try {
        const payload = await fetchQuotesBatch(MARKET_PULSE_SYMBOLS, selectedMarket);
        if (!active) return;
        const quotesBySymbol = new Map(
          (payload?.quotes || []).map((quote) => [String(quote.symbol || "").toUpperCase(), quote]),
        );
        setMarketRows((prev) =>
          prev.map((row) => {
            const quote = quotesBySymbol.get(row.symbol.toUpperCase());
            if (!quote || !Number.isFinite(Number(quote.last))) {
              return row.flash ? { ...row, flash: null } : row;
            }
            const nextLtp = Number(quote.last);
            const nextChg = Number.isFinite(Number(quote.change)) ? Number(quote.change) : row.chg;
            const nextChgPct = Number.isFinite(Number(quote.changePct)) ? Number(quote.changePct) : row.chgPct;
            const flash: MarketRow["flash"] = nextLtp > row.ltp ? "up" : nextLtp < row.ltp ? "down" : null;
            return {
              ...row,
              ltp: nextLtp,
              chg: nextChg,
              chgPct: nextChgPct,
              flash,
            };
          }),
        );
      } catch {
        if (!active) return;
      }
    };

    void loadMarketPulse();
    const timer = window.setInterval(() => {
      void loadMarketPulse();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedMarket]);

  useEffect(() => {
    let active = true;

    const loadNews = async () => {
      try {
        const items = await fetchLatestNews(NEWS_LIMIT);
        if (active && items.length) {
          setNewsLog(items);
        }
      } catch {
        if (!active) return;
      }
    };

    void loadNews();
    if (newsAutoRefresh) {
      const timer = window.setInterval(() => {
        void loadNews();
      }, newsRefreshSec * 1000);
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }

    return () => {
      active = false;
    };
  }, [newsAutoRefresh, newsRefreshSec]);

  useEffect(() => {
    if (!initializing) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(TRANSITION_FLAG_KEY);
      setInitializing(false);
    }, 1300);
    return () => window.clearTimeout(timer);
  }, [initializing]);

  useEffect(() => {
    if (marketRows.some((row) => row.symbol === selectedHeatId)) return;
    setSelectedHeatId(marketRows[0]?.symbol ?? null);
  }, [marketRows, selectedHeatId]);

  const equityPnlPct = useMemo(() => {
    if (snapshot.equityPnl == null || snapshot.equityCost <= 0) return null;
    return (snapshot.equityPnl / snapshot.equityCost) * 100;
  }, [snapshot.equityCost, snapshot.equityPnl]);

  const performanceSeries = useMemo(
    () =>
      performancePoints.map((value, index) => ({
        label: performanceLabels[index] ?? `D${index + 1}`,
        value,
      })),
    [performanceLabels, performancePoints],
  );

  const benchmarkSeries = useMemo(
    () =>
      performanceBenchmarkPoints.map((value, index) => ({
        label: performanceLabels[index] ?? `D${index + 1}`,
        value,
      })),
    [performanceBenchmarkPoints, performanceLabels],
  );

  const heatItems = useMemo<MarketHeatStripItem[]>(
    () =>
      marketRows.map((row) => ({
        id: row.symbol,
        label: row.label || row.symbol,
        value: row.ltp > 0 ? row.ltp : null,
        changePct: row.ltp > 0 ? row.chgPct : null,
        changeLabel:
          row.ltp > 0
            ? `${row.chg >= 0 ? "+" : ""}${formatPrice(row.chg)} / ${formatPercent(row.chgPct)}`
            : "--",
        flash: row.flash,
      })),
    [marketRows],
  );

  const focusedMarket = useMemo(
    () => marketRows.find((row) => row.symbol === selectedHeatId) ?? marketRows[0] ?? null,
    [marketRows, selectedHeatId],
  );

  const launchSections = useMemo<QuickNavSection[]>(
    () =>
      NAV_CARD_SECTIONS.map((section) => ({
        id: slugify(section.title),
        title: section.title,
        items: section.cards.map((card) => ({
          id: `${slugify(section.title)}-${slugify(card.label)}`,
          label: card.label,
          shortcut: card.badge,
          description: `${section.title} desk access`,
          onSelect: () => navigate(card.to),
        })),
      })),
    [navigate],
  );

  const updatedLabel = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleTimeString("en-IN", { hour12: false })
    : "--:--:--";

  const profileMissingFields = useMemo(() => {
    const missing: string[] = [];
    if (!user?.email) missing.push("Email");
    if (!user?.role) missing.push("Role");
    if (snapshot.updatedAt == null) missing.push("Snapshot");
    if (newsLog.length === 0) missing.push("News");
    return missing;
  }, [newsLog.length, snapshot.updatedAt, user?.email, user?.role]);

  const profileCompletion = Math.round(((4 - profileMissingFields.length) / 4) * 100);

  const systemHealthItems = useMemo<SystemHealthItem[]>(
    () => [
      {
        id: "auth",
        label: "AUTH",
        value: user ? `${user.role.toUpperCase()} READY` : "GUEST",
        tone: user ? "ok" : "warning",
      },
      {
        id: "relay",
        label: "RELAY",
        value: `${selectedMarket} ${realtimeMode.toUpperCase()}`,
        tone: realtimeMode === "ws" ? "ok" : "info",
      },
      {
        id: "snapshot",
        label: "SNAPSHOT",
        value: updatedLabel,
        tone: snapshot.updatedAt ? "stale" : "offline",
      },
      {
        id: "news",
        label: "NEWS",
        value: newsAutoRefresh ? `AUTO ${newsRefreshSec}s` : "MANUAL",
        tone: newsAutoRefresh ? "info" : "neutral",
      },
      {
        id: "fno",
        label: "F&O",
        value: `${snapshot.fnoSignal}${snapshot.fnoPcr != null ? ` | ${snapshot.fnoPcr.toFixed(2)}` : ""}`,
        tone: getSystemTone(snapshot.fnoSignal),
      },
    ],
    [newsAutoRefresh, newsRefreshSec, realtimeMode, selectedMarket, snapshot.fnoPcr, snapshot.fnoSignal, snapshot.updatedAt, updatedLabel, user],
  );

  const leadHeadline = newsLog[0] ?? null;

  return (
    <TerminalShell
      contentClassName="bg-terminal-bg"
      hideTickerLoader
      showMobileBottomNav
      showWorkspaceControls={false}
      statusBarTickerOverride="MISSION CONTROL"
    >
      <div className="relative min-h-full bg-terminal-bg">
        {initializing ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-terminal-bg/95" role="status" aria-live="polite">
            <p className="ot-type-panel-title uppercase tracking-[0.18em] text-terminal-accent">Initializing Mission Control</p>
            <div className="h-1.5 w-64 overflow-hidden rounded-full border border-terminal-border bg-terminal-panel/80">
              <span className="block h-full w-2/3 animate-pulse bg-terminal-accent/80" />
            </div>
          </div>
        ) : null}

        {!initializing ? (
          <main className="flex min-h-full flex-col gap-3 p-3 md:p-4" aria-label="Mission Control Dashboard">
            <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Home Header">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                  <p className="ot-type-panel-title uppercase tracking-[0.18em] text-terminal-accent">Mission Control</p>
                  <h1 className="text-2xl font-semibold uppercase tracking-[0.12em] text-terminal-text">Home Dashboard</h1>
                  <p className="max-w-3xl text-sm text-terminal-muted">
                    Bloomberg-dense market command surface with live pulse, portfolio intelligence, and fast launch paths into the terminal.
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.12em] text-terminal-muted">
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Desk {(user?.email || "unknown").toUpperCase()}
                    </span>
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Market {selectedMarket}
                    </span>
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Currency {displayCurrency}
                    </span>
                    <span className="rounded-sm border border-terminal-border px-2 py-1">
                      Refresh {newsAutoRefresh ? `${newsRefreshSec}s` : "Manual"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 xl:items-end">
                  <LiveClockStrip />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/portfolio")}
                    >
                      Portfolio HQ
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/launchpad")}
                    >
                      Launchpad
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/news")}
                    >
                      Intel Wire
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <MarketHeatStrip
                  ariaLabel="Market heat strip"
                  items={heatItems}
                  selectedItemId={selectedHeatId}
                  formatValue={(value) => (typeof value === "number" ? formatPrice(value) : "--")}
                  onSelect={(item) => setSelectedHeatId(item.id)}
                />
              </div>
            </section>

            <section className="grid gap-3 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]" aria-label="Portfolio HQ">
              <div className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3">
                <div className="flex flex-col gap-3 border-b border-terminal-border pb-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Portfolio HQ</h2>
                    <p className="mt-1 text-sm text-terminal-muted">
                      Equity valuation, derivatives posture, and performance telemetry anchored to the current home snapshot.
                    </p>
                  </div>
                  <ProfileCompletionRing
                    value={profileCompletion}
                    missingFields={profileMissingFields}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  <MetricCard
                    label="Net Liquidation"
                    value={formatInr(snapshot.equityValue)}
                    tone={getMetricTone(snapshot.equityPnl)}
                    delta={
                      snapshot.equityPnl == null
                        ? undefined
                        : {
                            label: `${formatSignedInr(snapshot.equityPnl)} (${formatPercent(equityPnlPct)})`,
                            tone: getMetricTone(snapshot.equityPnl),
                          }
                    }
                    details={[
                      { label: "Holdings", value: String(snapshot.holdingsCount) },
                      { label: "Watchlist", value: String(snapshot.watchlistCount), tone: "accent" },
                      { label: "Backtests", value: String(snapshot.backtestPresetCount) },
                      { label: "Sync", value: updatedLabel, tone: "neutral" },
                    ]}
                    sparklinePoints={performancePoints}
                    sparklineAriaLabel="Net liquidation trend"
                    footer={
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                          onClick={() => navigate("/equity/portfolio")}
                        >
                          Open Portfolio
                        </button>
                        <button
                          type="button"
                          className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                          onClick={() => navigate("/backtesting")}
                        >
                          Run Backtests
                        </button>
                      </div>
                    }
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetricCard
                      label="Market Focus"
                      value={focusedMarket?.ltp && focusedMarket.ltp > 0 ? formatPrice(focusedMarket.ltp) : "--"}
                      tone={getMetricTone(focusedMarket?.chg ?? null)}
                      delta={
                        focusedMarket
                          ? {
                              label:
                                focusedMarket.ltp > 0
                                  ? `${focusedMarket.chg >= 0 ? "+" : ""}${formatPrice(focusedMarket.chg)} (${formatPercent(focusedMarket.chgPct)})`
                                  : "--",
                              tone: getMetricTone(focusedMarket.chg),
                            }
                          : undefined
                      }
                      details={[
                        { label: "Ticker", value: focusedMarket?.label || "--" },
                        { label: "Desk", value: selectedMarket, tone: "accent" },
                      ]}
                    />

                    <MetricCard
                      label="F&O Regime"
                      value={snapshot.fnoSignal}
                      tone={getSignalTone(snapshot.fnoSignal)}
                      details={[
                        {
                          label: "PCR",
                          value: snapshot.fnoPcr != null ? snapshot.fnoPcr.toFixed(2) : "--",
                          tone: getSignalTone(snapshot.fnoSignal),
                        },
                        {
                          label: "Spot",
                          value: snapshot.fnoSpot != null ? formatPrice(snapshot.fnoSpot) : "--",
                        },
                      ]}
                    />

                    <MetricCard
                      label="Watchlist Radar"
                      value={`${snapshot.watchlistCount} Symbols`}
                      tone={snapshot.watchlistCount > 0 ? "accent" : "neutral"}
                      delta={{
                        label: `${snapshot.watchlistDerivativesCount} F&O linked`,
                        tone: snapshot.watchlistDerivativesCount > 0 ? "up" : "neutral",
                      }}
                      details={[
                        { label: "Derivatives", value: String(snapshot.watchlistDerivativesCount) },
                        { label: "Relay", value: realtimeMode.toUpperCase() },
                      ]}
                    />

                    <MetricCard
                      label="Research Queue"
                      value={`${newsLog.length} Headlines`}
                      tone={leadHeadline?.sentiment?.label === "Bearish" ? "down" : leadHeadline ? "accent" : "neutral"}
                      delta={{
                        label: newsAutoRefresh ? `Auto refresh ${newsRefreshSec}s` : "Manual news sync",
                        tone: newsAutoRefresh ? "accent" : "neutral",
                      }}
                      details={[
                        { label: "Lead Source", value: leadHeadline?.source || "--" },
                        { label: "Headlines", value: String(newsLog.length) },
                      ]}
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-sm border border-terminal-border bg-terminal-bg/40 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">30D Performance</h3>
                      <p className="mt-1 text-xs text-terminal-muted">
                        Portfolio trajectory normalized against the benchmark overlay from the portfolio analytics feed.
                      </p>
                    </div>
                    <span className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted">
                      Synced {updatedLabel}
                    </span>
                  </div>
                  <PortfolioMiniChart
                    points={performanceSeries}
                    benchmarkPoints={benchmarkSeries}
                    ariaLabel="Portfolio HQ chart"
                    valueFormatter={(value) => formatInr(value)}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="System Health">
                  <div className="mb-3">
                    <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">System Health</h2>
                    <p className="mt-1 text-sm text-terminal-muted">
                      Auth, relay mode, news cadence, and derivatives signal surfaced as a single mission-control rail.
                    </p>
                  </div>
                  <SystemHealthBar ariaLabel="System health indicators" items={systemHealthItems} />
                  <div className="mt-3 grid gap-2 text-xs text-terminal-muted sm:grid-cols-2">
                    <div className="rounded-sm border border-terminal-border bg-terminal-bg/40 px-2 py-2">
                      <span className="block text-[11px] uppercase tracking-[0.12em]">Focus Asset</span>
                      <span className="mt-1 block text-sm text-terminal-text">{focusedMarket?.label || "--"}</span>
                    </div>
                    <div className="rounded-sm border border-terminal-border bg-terminal-bg/40 px-2 py-2">
                      <span className="block text-[11px] uppercase tracking-[0.12em]">Desk Mode</span>
                      <span className="mt-1 block text-sm text-terminal-text">
                        {selectedMarket} / {displayCurrency}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Intel Wire">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Intel Wire</h2>
                      <p className="mt-1 text-sm text-terminal-muted">
                        Latest headlines from the existing news polling loop with sentiment carried through from the API payload.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => navigate("/equity/news")}
                    >
                      Open News
                    </button>
                  </div>

                  {newsLog.length > 0 ? (
                    <ol className="space-y-2" role="list" aria-label="Latest headlines">
                      {newsLog.slice(0, 5).map((entry) => (
                        <li key={String(entry.id)} className="rounded-sm border border-terminal-border bg-terminal-bg/40 p-2">
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block focus-visible:outline-none focus-visible:text-terminal-accent hover:text-terminal-accent"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.12em] text-terminal-muted">
                                  {entry.source}
                                  {entry.published_at
                                    ? ` • ${new Date(entry.published_at).toLocaleTimeString("en-US", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        hour12: false,
                                      })}`
                                    : ""}
                                </p>
                                <p className="mt-1 text-sm font-medium text-terminal-text">{entry.title}</p>
                              </div>
                              {entry.sentiment ? (
                                <span className={`shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] ${getSentimentClass(entry.sentiment.label)}`}>
                                  {entry.sentiment.label} {Math.round(entry.sentiment.confidence * 100)}%
                                </span>
                              ) : null}
                            </div>
                          </a>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="rounded-sm border border-terminal-border bg-terminal-bg/40 px-3 py-4 text-sm text-terminal-muted">
                      News feed is online but no headlines have populated yet.
                    </div>
                  )}
                </section>
              </div>
            </section>

            <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3" aria-label="Launch Matrix">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Launch Matrix</h2>
                  <p className="mt-1 text-sm text-terminal-muted">
                    Dense function-key style routing into equity, derivatives, research, and settings workspaces.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => navigate("/equity/chart-workstation")}
                  >
                    Open Workstation
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => navigate("/equity/screener")}
                  >
                    Open Screener
                  </button>
                </div>
              </div>
              <QuickNavGrid ariaLabel="Launch matrix" sections={launchSections} columnCount={4} />
            </section>
          </main>
        ) : null}
      </div>
    </TerminalShell>
  );
}
