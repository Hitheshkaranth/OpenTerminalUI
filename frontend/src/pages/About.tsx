import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import logo from "../assets/logo.png";

const REPO_URL = "https://github.com/Hitheshkaranth/OpenTerminalUI";

function buildDateLabel(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "unknown";
  return new Date(ts).toLocaleString();
}

function commitLabel(value: string): string {
  if (!value || value === "unknown") return "unknown";
  return value.slice(0, 7);
}

export function AboutPage() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigate(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const builtDate = useMemo(() => buildDateLabel(__BUILD_DATE__), []);
  const shortCommit = useMemo(() => commitLabel(__GIT_COMMIT__), []);
  const appVersion = useMemo(() => (__APP_VERSION__ || "0.0.0").trim(), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(REPO_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3 p-3 font-mono">
      <TerminalPanel title="OpenTerminalUI">
        <div className="flex items-center gap-3">
          <img src={logo} alt="OpenTerminalUI Logo" className="h-16 w-auto object-contain" />
          <div className="text-xs text-terminal-muted">
            Analyze. Trade. Optimize.
            <div className="mt-1">Open-source Indian and US stock analytics workspace with integrated Equity, F&O, and Backtesting flows.</div>
          </div>
        </div>
      </TerminalPanel>

      <div className="grid gap-3 lg:grid-cols-2">
        <TerminalPanel title="Equity Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Multi-timeframe chart workstation with indicators, delivery overlay, and automatic backfill.</li>
            <li>- Company intelligence stack: overview, scorecard, fundamentals, valuation, peers, reports.</li>
            <li>- Advanced panels: shareholding pattern + trend, capex tracker, and Python execution lab.</li>
            <li>- Operational screens: screener, portfolio, watchlist, mutual funds, and news/sentiment monitor.</li>
            <li>- US Market integration: NYSE/NASDAQ/AMEX support with US stock ticker search and routing.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="F&O Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Option chain with Greeks + OI context for strike-level decision support.</li>
            <li>- Futures terminal with shared chart/indicator engine and live quote sync.</li>
            <li>- Strategy builder, PCR analytics, heatmap, and expiry dashboards.</li>
            <li>- Unified navigation and ticker context across Equity and F&O packs.</li>
          </ul>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Backtesting Control Deck">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Asset input + trade capital input with model presets or custom Python signals.</li>
          <li>- Built-in advanced preset: Pure-Jump Markov Volatility (particle-filtered jump-vol stress + trend gating).</li>
          <li>- Capital-aware execution sizing: share quantity derives from capital and model allocation.</li>
          <li>- Performance block tracks initial capital, final equity, net P/L, and ending cash.</li>
          <li>- Chart-first review with buy/sell markers, indicator overlays, and trade blotter.</li>
          <li>- Visual workflow tabs include chart, equity, drawdown, distribution, rolling metrics, trade analysis, and compare.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Recent Product Updates">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Home terminal refreshed with live portfolio relay and backend-driven market pulse.</li>
          <li>- Unified portfolio navigation: Equity and Mutual Funds are now mode-switched in one portfolio screen.</li>
          <li>- Research Suites highlighting now indicates active backtesting/model-lab screen.</li>
          <li>- Backtesting includes standalone 3D analytics: terrain, regimes, orderbook liquidity, IV surface, volatility surface, and Monte Carlo simulation.</li>
          <li>- Auth recovery upgraded with dedicated Forgot Access flow and backend reset endpoint.</li>
          <li>- Technical Screener upgraded with breakout scanner engine and real-time scanner alert delivery.</li>
          <li>- Risk Engine added: portfolio VaR/CVaR, backtest risk attribution, and configurable stress scenarios.</li>
          <li>- Execution Simulator: cost modeling (commission, slippage, spread, market impact) integrated into backtest runs.</li>
          <li>- OMS / Compliance dashboard: order management, restricted list, fill tracking, and audit log.</li>
          <li>- Model Governance page: run registration, multi-run comparison, and model promotion workflow.</li>
          <li>- Ops Dashboard: data feed health status and kill-switch controls.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Risk, OMS &amp; Governance">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Risk Engine: portfolio VaR/CVaR, backtest risk attribution, and configurable stress scenario analysis.</li>
          <li>- Execution Simulator: transaction cost modeling with commission, slippage, spread, and market-impact parameters.</li>
          <li>- OMS / Compliance: order lifecycle management, fill tracking, restricted-list enforcement, and audit log.</li>
          <li>- Model Governance: run registration with code hash + data version, multi-run comparison, and model promotion workflow.</li>
          <li>- Ops Dashboard: real-time data feed health monitoring and kill-switch controls.</li>
          <li>- Technical Screener: pattern-based screener engine with breakout scanner and real-time scanner alert delivery.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Infrastructure">
        <ul className="space-y-1 text-xs text-terminal-muted">
          <li>- FastAPI backend + React/TypeScript terminal frontend with PWA offline support.</li>
          <li>- Realtime quote stream with resilient snapshot fallback and scrolling market tape.</li>
          <li>- API v1 coverage: equity analytics, shareholding, mutual funds, indicators, crypto, scripting, export, and plugins.</li>
          <li>- Plugin architecture: sandboxed execution, YAML manifests, permission model, and marketplace UI.</li>
          <li>- Cross-market symbol classification with country, exchange, currency, and F/O capability badges.</li>
          <li>- Background services: instruments loader, scheduled news ingestion, cache-aware fetchers.</li>
          <li>- Mobile-first responsive layouts with touch gestures and installable PWA shell.</li>
          <li>- Docker-first deployment with optional Redis profile for L2 caching.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Features">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Auth foundation: JWT access/refresh, auth middleware, role protection, login/register screens.</li>
          <li>- Corporate Events + Earnings: dedicated APIs, timeline/calendar widgets, and stock/portfolio integrations.</li>
          <li>- Alerts v2: user-scoped rules, trigger history, live websocket alerts, and browser notification support.</li>
          <li>- Paper Trading: virtual portfolio/order/position/trade model, performance metrics, strategy deploy API, and UI dashboard.</li>
          <li>- Chart Foundations: chart drawings/templates persistence APIs plus multi-chart crosshair sync context scaffolding.</li>
          <li>- Adapter Layer: pluggable multi-exchange adapter registry with Kite/Yahoo/Crypto base implementations.</li>
          <li>- US stock ticker integration: autocomplete + market-aware symbol routing for US tickers in chart/backtest workflows.</li>
          <li>- Plugin System: sandboxed loader, permission registry, YAML manifests, and marketplace UI with enable/disable controls.</li>
          <li>- Export Engine: PDF, Excel, and CSV report generation for portfolios, watchlists, and analytics data.</li>
          <li>- Portfolio Analytics: benchmark overlay charting, correlation heatmap, dividend tracker, risk metrics panel, and tax lot manager.</li>
          <li>- PWA + Mobile: service worker with offline caching, web app manifest, install prompt, mobile bottom nav, and responsive card layouts.</li>
          <li>- Pull-to-Refresh: touch gesture support on watchlist and alerts for mobile-native feel.</li>
          <li>- Theme System: terminal theme CSS layer with customizable accent colours in settings.</li>
          <li>- E2E Mobile Tests: Playwright test suite covering swipe, touch, and responsive breakpoints.</li>
        </ul>
      </TerminalPanel>

      <div className="grid gap-3 lg:grid-cols-2">
        <TerminalPanel title="Build Metadata">
          <div className="mt-2 space-y-1 text-xs tabular-nums text-terminal-text">
            <div>Built: {builtDate}</div>
            <div>Commit: {shortCommit}</div>
            <div>Version: {appVersion}</div>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Repository">
          <div className="mt-2 break-all text-xs text-terminal-muted">{REPO_URL}</div>
          <div className="mt-3 flex items-center gap-2">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm border border-terminal-accent bg-terminal-accent/20 px-2 py-1 text-xs uppercase text-terminal-accent"
            >
              Open GitHub
            </a>
            <TerminalButton type="button" onClick={() => void onCopy()}>
              Copy URL
            </TerminalButton>
            {copied && <TerminalBadge variant="live">Copied</TerminalBadge>}
          </div>
        </TerminalPanel>
      </div>

      <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Esc: Back</div>
    </div>
  );
}
