import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { StatusBar } from "../components/StatusBar";
import { useAuth } from "../contexts/AuthContext";
import logo from "../assets/logo.png";

type MarketRow = {
  symbol: string;
  ltp: number;
  chg: number;
  chgPct: number;
  flash: "up" | "down" | null;
};

type OrderEntry = {
  id: string;
  time: string;
  side: "BUY" | "SELL";
  symbol: string;
  qty: number;
  price: number;
  status: "FILLED" | "PARTIAL" | "QUEUED";
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

const INITIAL_MARKET_ROWS: MarketRow[] = [
  { symbol: "NIFTY", ltp: 24856.5, chg: 124.3, chgPct: 0.5, flash: null },
  { symbol: "SENSEX", ltp: 81234.1, chg: -89.4, chgPct: -0.11, flash: null },
  { symbol: "BANKNIFTY", ltp: 52120, chg: 310.55, chgPct: 0.6, flash: null },
  { symbol: "RELIANCE", ltp: 2891.5, chg: 12.3, chgPct: 0.43, flash: null },
  { symbol: "TCS", ltp: 4120.8, chg: -18.9, chgPct: -0.46, flash: null },
  { symbol: "INFY", ltp: 1890.2, chg: 8.45, chgPct: 0.45, flash: null },
  { symbol: "HDFCBANK", ltp: 1732.2, chg: -4.2, chgPct: -0.24, flash: null },
  { symbol: "ITC", ltp: 487.45, chg: 2.76, chgPct: 0.57, flash: null },
];

const INITIAL_ORDER_LOG: OrderEntry[] = [
  { id: "1", time: "09:31:02", side: "BUY", symbol: "RELIANCE", qty: 50, price: 2890.5, status: "FILLED" },
  { id: "2", time: "09:29:48", side: "SELL", symbol: "TCS", qty: 20, price: 4122.1, status: "FILLED" },
  { id: "3", time: "09:26:11", side: "BUY", symbol: "INFY", qty: 65, price: 1888.95, status: "PARTIAL" },
  { id: "4", time: "09:23:54", side: "BUY", symbol: "HDFCBANK", qty: 40, price: 1731.8, status: "FILLED" },
  { id: "5", time: "09:22:17", side: "SELL", symbol: "ITC", qty: 130, price: 486.2, status: "QUEUED" },
  { id: "6", time: "09:19:03", side: "BUY", symbol: "NIFTY", qty: 25, price: 24811.55, status: "FILLED" },
];

const SPARKLINE_POINTS = [14, 16, 18, 17, 20, 19, 21, 22, 20, 24, 26, 25, 27, 29, 31, 30, 32, 33, 35, 36];
const PERFORMANCE_POINTS = [
  24300000, 24200000, 24400000, 24500000, 24450000, 24680000, 24720000, 24610000, 24790000, 24840000,
  24770000, 24890000, 24950000, 24810000, 24780000, 24910000, 25030000, 24980000, 25120000, 25190000,
  25150000, 25230000, 25310000, 25280000, 25390000, 25470000, 25420000, 25510000, 25590000, 25670000,
];

function randomIndices(limit: number, count: number): number[] {
  const set = new Set<number>();
  while (set.size < count) {
    set.add(Math.floor(Math.random() * limit));
  }
  return Array.from(set);
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLargeInr(value: number): string {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
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

function nextOrderEntry(): OrderEntry {
  const symbols = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ITC", "NIFTY"];
  const side = Math.random() > 0.52 ? "BUY" : "SELL";
  const symbol = symbols[Math.floor(Math.random() * symbols.length)];
  const qty = 10 + Math.floor(Math.random() * 140);
  const price = 480 + Math.random() * 4200;
  const status: OrderEntry["status"] = Math.random() > 0.8 ? "QUEUED" : Math.random() > 0.4 ? "FILLED" : "PARTIAL";

  const now = new Date();
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(now);

  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    time,
    side,
    symbol,
    qty,
    price,
    status,
  };
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [marketRows, setMarketRows] = useState<MarketRow[]>(INITIAL_MARKET_ROWS);
  const [orderLog, setOrderLog] = useState<OrderEntry[]>(INITIAL_ORDER_LOG);
  const [initializing, setInitializing] = useState(() => sessionStorage.getItem(TRANSITION_FLAG_KEY) === "1");

  useEffect(() => {
    // Placeholder until wired to /api/ws/quotes.
    const timer = window.setInterval(() => {
      setMarketRows((prev) => {
        const updates = randomIndices(prev.length, 2 + Math.floor(Math.random() * 2));
        return prev.map((row, index) => {
          if (!updates.includes(index)) {
            if (!row.flash) return row;
            return { ...row, flash: null };
          }

          const pctMove = (Math.random() - 0.5) * 1.3;
          const ltp = row.ltp * (1 + pctMove / 100);
          const chg = row.chg + ltp - row.ltp;
          const chgPct = row.chgPct + pctMove;

          return {
            ...row,
            ltp,
            chg,
            chgPct,
            flash: pctMove >= 0 ? "up" : "down",
          };
        });
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setOrderLog((prev) => [nextOrderEntry(), ...prev].slice(0, 18));
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!initializing) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(TRANSITION_FLAG_KEY);
      setInitializing(false);
    }, 1300);

    return () => window.clearTimeout(timer);
  }, [initializing]);

  const sparklinePath = useMemo(() => buildLinePath(SPARKLINE_POINTS, 680, 60), []);
  const sparklineArea = useMemo(() => buildAreaPath(SPARKLINE_POINTS, 680, 60), []);

  const perfLinePath = useMemo(() => buildLinePath(PERFORMANCE_POINTS, 360, 128), []);
  const perfAreaPath = useMemo(() => buildAreaPath(PERFORMANCE_POINTS, 360, 128), []);

  const activeTab = location.pathname.startsWith("/home") || location.pathname === "/" ? "OVERVIEW" : "";

  return (
    <div className="ot-home-layout">
      <StatusBar
        left="OPENTERMINALUI | DASHBOARD"
        center={`USER: ${(user?.email || "unknown").toUpperCase()}`}
      />

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
            <p className="ot-portfolio-value">?2,45,67,890</p>
            <p className="ot-portfolio-change ot-value-up">? +3.42% TODAY</p>

            <svg className="ot-sparkline" viewBox="0 0 680 60" preserveAspectRatio="none" role="img" aria-label="portfolio sparkline">
              <path d={sparklineArea} fill="rgba(255,149,0,0.08)" />
              <path d={sparklinePath} fill="none" stroke="#FF9500" strokeWidth="1.4" className="ot-draw-line" />
            </svg>

            <div className="ot-portfolio-stats">
              <span>DAY HIGH: ?2,48,00,000</span>
              <span>DAY LOW: ?2,41,00,000</span>
              <span>OPEN: ?2,43,50,000</span>
              <span>VOL: 12.4M</span>
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
                      <td>{row.symbol}</td>
                      <td className="ot-align-right">{formatPrice(row.ltp)}</td>
                      <td className={`ot-align-right ${isUp ? "ot-value-up" : "ot-value-down"}`}>{isUp ? "+" : ""}{formatPrice(row.chg)}</td>
                      <td className={`ot-align-right ${isUp ? "ot-value-up" : "ot-value-down"}`}>{isUp ? "+" : ""}{row.chgPct.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="ot-panel ot-panel-orders ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.25s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">ORDER LOG</span>
              <span className="ot-live-dot ot-live-dot-amber" />
            </header>

            <div className="ot-order-list" role="log" aria-live="polite">
              {orderLog.map((entry, index) => (
                <p key={entry.id} className={`ot-order-entry ${index === 0 ? "ot-order-new" : ""}`}>
                  <span className="ot-muted">{entry.time}</span>{" "}
                  <span className={entry.side === "BUY" ? "ot-value-up" : "ot-value-down"}>{entry.side}</span>{" "}
                  <span className="ot-white">{entry.symbol}</span>{" "}
                  <span>x{entry.qty}</span>{" "}
                  <span>@?{formatPrice(entry.price)}</span>{" "}
                  <span className="ot-value-cyan">{entry.status}</span>
                </p>
              ))}
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
              <span>22 JAN</span>
              <span>{formatLargeInr(24900000)}</span>
              <span>20 FEB</span>
            </div>
          </section>

          <section className="ot-panel ot-panel-command ot-stagger-cell" style={{ ["--cell-delay" as string]: "0.45s" }}>
            <header className="ot-panel-header">
              <span className="ot-panel-header-title">COMMAND CENTER</span>
            </header>

            <div className="ot-command-input">ot &gt; <span className="ot-cursor" /></div>

            <div className="ot-command-actions">
              <button type="button" className="ot-action-button ot-action-amber" onClick={() => navigate("/equity/stocks")}>NEW ORDER</button>
              <button type="button" className="ot-action-button ot-action-cyan" onClick={() => navigate("/equity/screener")}>SCREENER</button>
              <button type="button" className="ot-action-button ot-action-green" onClick={() => navigate("/equity/portfolio")}>EXPORT</button>
              <button type="button" className="ot-action-button ot-action-red" onClick={() => navigate("/equity/alerts")}>ALERTS</button>
            </div>

            <p className="ot-system-health ot-value-up">SYSTEM HEALTH: ALL NOMINAL</p>
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
