import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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

interface AboutProps {
  terminalType?: "market" | "fno";
}

export function AboutPage({ terminalType = "market" }: AboutProps) {
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
      <TerminalPanel title={`OpenTerminalUI ${terminalType === "fno" ? "F&O" : "Market"} Terminal`}>
        <div className="flex items-center gap-3">
          <img src={logo} alt="OpenTerminalUI Logo" className="h-16 w-auto object-contain" />
          <div className="text-xs text-terminal-muted">
            {terminalType === "fno"
              ? "Dense F&O terminal focused on derivatives workflows with unified behavior across the experience."
              : "Analyze. Trade. Optimize. Open-source Indian and US stock analytics workspace."}
            <div className="mt-1">Version {appVersion} | Built {builtDate} | Commit {shortCommit}</div>
          </div>
        </div>
      </TerminalPanel>

      <div className="grid gap-3 lg:grid-cols-2">
        <TerminalPanel title="Equity Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Terminal shell with GO bar, command palette, ticker tape, and keyboard navigation.</li>
            <li>- Security, stock detail, chart workstation, and launchpad chart flows with realtime updates.</li>
            <li>- Research flows: fundamentals, news/sentiment, events, and cockpit overview surfaces.</li>
            <li>- Screener, watchlist, alerts, paper trading, and portfolio/mutual-fund workflows.</li>
            <li>- Economics, yield-curve, sector-rotation, and split-comparison routes.</li>
            <li>- India + US symbol routing across equity APIs and pages.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="F&O Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Option chain, Greeks, OI analytics, IV views, heatmap, and expiry pages.</li>
            <li>- Futures analytics with shared chart and streaming behavior.</li>
            <li>- Strategy builder and PCR workflows.</li>
            <li>- Unified navigation and ticker continuity with equity routes.</li>
          </ul>
        </TerminalPanel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TerminalPanel title="Quant & Risk">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Risk Engine: portfolio VaR/CVaR and stress scenarios.</li>
            <li>- Risk Compute: EWMA volatility, beta, and PCA factor decomposition.</li>
            <li>- Model Lab and Portfolio Lab flows for experiment and portfolio backtesting workflows.</li>
            <li>- Portfolio backtest jobs with async execution and result retrieval.</li>
            <li>- Model governance, OMS/compliance, ops monitoring, and data quality routes.</li>
            <li>- WebSocket quote streams and alert channel integrations.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="Navigation & Workspaces">
          <div className="space-y-2 text-xs text-terminal-muted">
            <div className="grid grid-cols-2 gap-2">
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/stocks">Market Home</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/security">Security Hub</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/cockpit">Cockpit</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/launchpad">Launchpad</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/crypto">Crypto</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/economics">Economics</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/fno">F&O Home</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/backtesting">Backtesting</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/chart-workstation">Workstation</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/ops">Ops</Link>
            </div>
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Repository">
        <div className="mt-1 flex items-center justify-between">
          <div className="break-all text-xs text-terminal-muted">{REPO_URL}</div>
          <div className="flex items-center gap-2">
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
        </div>
      </TerminalPanel>

      <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Esc: Back</div>
    </div>
  );
}
