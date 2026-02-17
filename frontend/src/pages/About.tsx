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
            <div className="mt-1">Open-source trading analytics workspace with integrated Equity, F&O, and Backtesting flows.</div>
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
          <li>- Capital-aware execution sizing: share quantity derives from capital and model allocation.</li>
          <li>- Performance block tracks initial capital, final equity, net P/L, and ending cash.</li>
          <li>- Chart-first review with buy/sell markers, indicator overlays, and trade blotter.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Infrastructure">
        <ul className="space-y-1 text-xs text-terminal-muted">
          <li>- FastAPI backend + React/TypeScript terminal frontend.</li>
          <li>- Realtime quote stream with resilient snapshot fallback and scrolling market tape.</li>
          <li>- API v1 coverage: equity analytics, shareholding, mutual funds, indicators, crypto candles/search, and scripting.</li>
          <li>- Cross-market symbol classification with country, exchange, currency, and F/O capability badges.</li>
          <li>- Background services: instruments loader, scheduled news ingestion, cache-aware fetchers.</li>
          <li>- Docker-first deployment with optional Redis profile for L2 caching.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Latest Additions (vs Previous Commit)">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Auth foundation: JWT access/refresh, auth middleware, role protection, login/register screens.</li>
          <li>- Corporate Events + Earnings: dedicated APIs, timeline/calendar widgets, and stock/portfolio integrations.</li>
          <li>- Alerts v2: user-scoped rules, trigger history, live websocket alerts, and browser notification support.</li>
          <li>- Paper Trading: virtual portfolio/order/position/trade model, performance metrics, strategy deploy API, and UI dashboard.</li>
          <li>- Chart Foundations: chart drawings/templates persistence APIs plus multi-chart crosshair sync context scaffolding.</li>
          <li>- Adapter Layer: pluggable multi-exchange adapter registry with Kite/Yahoo/Crypto base implementations.</li>
          <li>- UI/Navigation: sidebar account details panel now visible in Equity, F&O, and Backtesting.</li>
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
