import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchBacktestV1Presets, fetchPortfolio, fetchQuotesBatch, fetchWatchlist, fetchLatestNews, fetchPortfolioBenchmarkOverlay, type NewsLatestApiItem } from "../api/client";
import { StatusBar } from "../components/StatusBar";
import { useAuth } from "../contexts/AuthContext";
import { fetchChainSummary } from "../fno/api/fnoApi";
import { useSettingsStore } from "../store/settingsStore";
import logo from "../assets/logo.png";

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

const NAV_TABS = [
  { label: "OVERVIEW", to: "/home" },
  { label: "EQUITY", to: "/equity/stocks" },
  { label: "F&O", to: "/fno" },
  { label: "BACKTEST", to: "/backtesting" },
  { label: "WATCHLIST", to: "/equity/watchlist" },
  { label: "SETTINGS", to: "/equity/settings" },
] as const;

const NAV_CARD_SECTIONS: Array<{ title: string; cards: NavCard[] }> = [
  {
    title: "EQUITY",
    cards: [
      { label: "Market", to: "/equity/stocks", badge: "F1" },
      { label: "Economics", to: "/equity/economics", badge: "E" },
      { label: "Yield Curve", to: "/equity/yield-curve", badge: "YC" },
      { label: "Rotation", to: "/equity/sector-rotation", badge: "ROT" },
      { label: "Launchpad", to: "/equity/launchpad", badge: "LP" },
      { label: "Screener", to: "/equity/screener", badge: "F2" },
      { label: "Portfolio", to: "/equity/portfolio", badge: "F3" },
      { label: "Paper", to: "/equity/paper", badge: "P" },
      { label: "Watchlist", to: "/equity/watchlist", badge: "F4" },
    ],
  },
  {
    title: "F&O",
    cards: [
      { label: "Option Chain", to: "/fno", badge: "O" },
      { label: "Greeks", to: "/fno/greeks", badge: "G" },
      { label: "OI Analysis", to: "/fno/oi", badge: "OI" },
      { label: "PCR", to: "/fno/pcr", badge: "PCR" },
      { label: "Heatmap", to: "/fno/heatmap", badge: "F8" },
      { label: "Expiry", to: "/fno/expiry", badge: "EXP" },
    ],
  },
  {
    title: "BACK TEST",
    cards: [
      { label: "Backtesting", to: "/backtesting", badge: "F9" },
      { label: "Model Lab", to: "/backtesting/model-lab", badge: "ML" },
      { label: "Portfolio Lab", to: "/equity/portfolio/lab", badge: "PL" },
    ],
  },
  {
    title: "WATCHLIST",
    cards: [
      { label: "Watchlist", to: "/equity/watchlist", badge: "F4" },
      { label: "Plugins", to: "/equity/plugins", badge: "PLG" },
      { label: "About", to: "/equity/stocks/about", badge: "F7" },
    ],
  },
  {
    title: "SETTINGS",
    cards: [
      { label: "Settings", to: "/equity/settings", badge: "F6" },
      { label: "Account", to: "/account", badge: "ACC" },
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

function formatInr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "INR --";
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function buildLinePath(points: number[], width: number, height: number): string {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(points: number[], width: number, height: number): string {
  const line = buildLinePath(points, width, height);
  return `${line} L ${width} ${height} L 0 ${height} Z`;
}


export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
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
      const by30d = curve.filter((pt) => {
        const ms = Date.parse(`${pt.date}T00:00:00Z`);
        return Number.isFinite(ms) && ms >= cutoffMs;
      });
      const windowCurve = (by30d.length >= 2 ? by30d : curve.slice(-30));

      const currentPortfolioValue =
        next.equityValue != null && Number.isFinite(next.equityValue)
          ? next.equityValue
          : null;
      const lastNorm = Number(windowCurve[windowCurve.length - 1]?.portfolio ?? NaN);
      const canScale = currentPortfolioValue != null && Number.isFinite(lastNorm) && lastNorm > 0;

      const scaledPoints = windowCurve.map((pt) => {
          const p = Number(pt.portfolio);
          if (!Number.isFinite(p)) return 0;
          return canScale ? (p / lastNorm) * currentPortfolioValue! : p;
        }).filter((v) => Number.isFinite(v) && v > 0);
      if (scaledPoints.length >= 2) {
        setPerformancePoints(scaledPoints);
      }
    }

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
        const items = await fetchLatestNews(15);
        if (active && items.length) {
          setNewsLog(items);
        }
      } catch {
        // ignore
      }
    };
    void loadNews();
    if (newsAutoRefresh) {
      const timer = window.setInterval(() => {
        void loadNews();
      }, newsRefreshSec * 1000);
      return () => window.clearInterval(timer);
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

  const equityPnlPct = useMemo(() => {
    if (snapshot.equityPnl == null || snapshot.equityCost <= 0) return null;
    return (snapshot.equityPnl / snapshot.equityCost) * 100;
  }, [snapshot.equityCost, snapshot.equityPnl]);

  const perfLinePath = useMemo(() => buildLinePath(performancePoints, 360, 128), [performancePoints]);
  const perfAreaPath = useMemo(() => buildAreaPath(performancePoints, 360, 128), [performancePoints]);

  const activeTab = location.pathname.startsWith("/home") || location.pathname === "/" ? "OVERVIEW" : "";
  const updatedLabel = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString("en-IN", { hour12: false }) : "--:--:--";

  return (
    <div className="ot-home-layout">
      <StatusBar left="OPENTERMINALUI | DASHBOARD" center={`USER: ${(user?.email || "unknown").toUpperCase()}`} />

      <div className="ot-home-toolbar">
        <div className="ot-home-brand">
          <img src={logo} alt="OpenTerminalUI" className="ot-home-brand-logo" />
          <span className="ot-home-brand-text">OPENTERMINALUI</span>
        </div>
        <div className="ot-home-tabs">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.label}
              type="button"
              className={`ot-tab ${tab.label === activeTab ? "is-active" : ""}`}
              onClick={() => navigate(tab.to)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {!initializing ? (
        <main className="ot-dashboard-grid">
          <section className="ot-panel ot-panel-portfolio ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.05s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">PORTFOLIO OVERVIEW</span>
              <span className="ot-live-dot ot-live-dot-green" />
            </header>
            <p className="ot-portfolio-value">{formatInr(snapshot.equityValue)}</p>
            <p className={`ot-portfolio-change ${(snapshot.equityPnl ?? 0) >= 0 ? "ot-value-up" : "ot-value-down"}`}>
              {snapshot.equityPnl == null ? "--" : `${snapshot.equityPnl >= 0 ? "+" : ""}${formatInr(snapshot.equityPnl)} (${equityPnlPct == null ? "--" : `${equityPnlPct.toFixed(2)}%`})`}
            </p>

            <div className="ot-portfolio-stats">
              <span>EQUITY HOLDINGS: {snapshot.holdingsCount}</span>
              <span>WATCHLIST: {snapshot.watchlistCount}</span>
              <span>F&O SPOT NIFTY: {snapshot.fnoSpot == null ? "--" : formatPrice(snapshot.fnoSpot)}</span>
              <span>SYNC: {updatedLabel}</span>
            </div>

            <div className="ot-valuation-strip">
              <button type="button" className="ot-valuation-chip" onClick={() => navigate("/equity/portfolio")}>
                <span className="ot-chip-label">EQUITY</span>
                <strong>{formatInr(snapshot.equityValue)}</strong>
              </button>
              <button type="button" className="ot-valuation-chip" onClick={() => navigate("/fno")}>
                <span className="ot-chip-label">F&O</span>
                <strong>{snapshot.fnoSignal} | PCR {snapshot.fnoPcr == null ? "--" : snapshot.fnoPcr.toFixed(2)}</strong>
              </button>
              <button type="button" className="ot-valuation-chip" onClick={() => navigate("/backtesting")}>
                <span className="ot-chip-label">BACK TEST</span>
                <strong>{snapshot.backtestPresetCount} presets</strong>
              </button>
              <button type="button" className="ot-valuation-chip" onClick={() => navigate("/equity/watchlist")}>
                <span className="ot-chip-label">WATCHLIST</span>
                <strong>{snapshot.watchlistCount} symbols ({snapshot.watchlistDerivativesCount} F&O)</strong>
              </button>
              <button type="button" className="ot-valuation-chip" onClick={() => navigate("/equity/settings")}>
                <span className="ot-chip-label">SETTINGS</span>
                <strong>{selectedMarket} | {displayCurrency} | {realtimeMode.toUpperCase()}</strong>
              </button>
            </div>
          </section>

          <section className="ot-panel ot-panel-market ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.15s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">MARKET PULSE</span>
              <span className="ot-live-dot ot-live-dot-cyan" />
            </header>
            <table className="ot-market-table">
              <thead>
                <tr>
                  <th>SYMBOL</th>
                  <th>LTP</th>
                  <th>CHG</th>
                  <th>CHG%</th>
                </tr>
              </thead>
              <tbody>
                {marketRows.map((row) => {
                  const isUp = row.chg >= 0;
                  return (
                    <tr key={row.symbol} className={row.flash ? `ot-flash-${row.flash}` : ""}>
                      <td>{row.label || row.symbol}</td>
                      <td className="ot-align-right">{row.ltp > 0 ? formatPrice(row.ltp) : "--"}</td>
                      <td className={`ot-align-right ${isUp ? "ot-value-up" : "ot-value-down"}`}>{isUp && row.chg > 0 ? "+" : ""}{row.chg !== 0 ? formatPrice(row.chg) : "--"}</td>
                      <td className={`ot-align-right ${isUp ? "ot-value-up" : "ot-value-down"}`}>{isUp && row.chgPct > 0 ? "+" : ""}{row.chgPct !== 0 ? `${row.chgPct.toFixed(2)}%` : "--"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="ot-panel ot-panel-orders ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.25s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">GLOBAL NEWS</span>
              <span className="ot-live-dot ot-live-dot-amber" />
            </header>
            <div className="ot-order-list" role="log" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {newsLog.map((entry, index) => (
                <a key={entry.id} href={entry.url} target="_blank" rel="noreferrer" className={`ot-order-entry ${index === 0 ? "ot-order-new" : ""}`} style={{ textDecoration: "none", display: "block", background: "rgba(255,255,255,0.03)", padding: "0.5rem", borderRadius: "0.25rem", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ fontSize: "0.75rem", marginBottom: "0.25rem", color: "#FF9500" }}>{entry.source} &bull; {entry.published_at ? new Date(entry.published_at).toLocaleTimeString() : ""}</div>
                  <div style={{ color: "#ffffff", fontWeight: 600, fontSize: "0.8rem", whiteSpace: "normal" }}>{entry.title}</div>
                  {entry.sentiment && (
                    <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: entry.sentiment.label === "Bullish" ? "#34C759" : entry.sentiment.label === "Bearish" ? "#FF3B30" : "#8E8E93" }}>
                      {entry.sentiment.label} ({Math.round(entry.sentiment.confidence * 100)}%)
                    </div>
                  )}
                </a>
              ))}
            </div>
            <div className="ot-highlight-note">
              HIGHLIGHTED TEXT: Settings feed {newsAutoRefresh ? "AUTO" : "MANUAL"} refresh every {newsRefreshSec}s.
            </div>
          </section>

          <section className="ot-panel ot-panel-performance ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.35s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">30D PERFORMANCE</span>
            </header>
            <svg className="ot-performance-chart" viewBox="0 0 360 160" preserveAspectRatio="none" role="img" aria-label="30 day performance">
              <defs>
                <linearGradient id="otPerfGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255,149,0,0.12)" />
                  <stop offset="100%" stopColor="rgba(255,149,0,0)" />
                </linearGradient>
              </defs>
              <line x1="0" y1="92" x2="360" y2="92" stroke="#333333" strokeDasharray="4 4" />
              <path d={perfAreaPath} fill="url(#otPerfGrad)" />
              <path d={perfLinePath} fill="none" stroke="#FF9500" strokeWidth="1.5" className="ot-draw-line-long" />
            </svg>
            <div className="ot-performance-axis">
              <span>ROLLING WINDOW</span>
              <span>{formatInr(snapshot.equityValue)}</span>
              <span>NAV SYNCED</span>
            </div>
          </section>

          <section className="ot-panel ot-panel-command ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.45s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">SYSTEM SNAPSHOT</span>
            </header>
            <div className="ot-command-actions ot-command-actions-single">
              <button type="button" className="ot-action-button ot-action-green" onClick={() => navigate("/equity/sector-rotation")}>OPEN ROTATION</button>
              <button type="button" className="ot-action-button ot-action-cyan" onClick={() => navigate("/equity/yield-curve")}>OPEN YIELD CURVE</button>
              <button type="button" className="ot-action-button ot-action-amber" onClick={() => navigate("/equity/economics")}>OPEN ECONOMICS</button>
              <button type="button" className="ot-action-button ot-action-cyan" onClick={() => navigate("/equity/launchpad")}>OPEN LAUNCHPAD</button>
              <button type="button" className="ot-action-button ot-action-amber" onClick={() => navigate("/equity/portfolio")}>OPEN PORTFOLIO</button>
            </div>
            <p className="ot-system-health ot-value-up">DATA RELAY ACTIVE: EQUITY, F&O, BACK TEST, WATCHLIST, SETTINGS</p>
          </section>

          <section className="ot-panel ot-panel-nav ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.55s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">NAVIGATION CARDS</span>
            </header>
            <div className="ot-nav-card-sections">
              {NAV_CARD_SECTIONS.map((section) => (
                <div key={section.title} className="ot-nav-section">
                  <p className="ot-nav-section-title">{section.title}</p>
                  <div className="ot-nav-card-grid">
                    {section.cards.map((card) => (
                      <button key={`${section.title}-${card.to}`} type="button" className="ot-nav-card" onClick={() => navigate(card.to)}>
                        <span className="ot-nav-card-label">{card.label}</span>
                        <span className="ot-nav-card-badge">{card.badge}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      ) : null}

      {initializing ? (
        <div className="ot-loading-overlay" role="status" aria-live="polite">
          <p>INITIALIZING TERMINAL...</p>
          <div className="ot-loading-bar">
            <span />
          </div>
        </div>
      ) : null}
    </div>
  );
}
