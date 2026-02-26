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
            <li>- Multi-timeframe chart workstation with unified India/US OHLCV routing.</li>
            <li>- Realtime tick-to-candle aggregation with continuous refresh.</li>
            <li>- Company intelligence stack: overview, scorecard, fundamentals, valuation.</li>
            <li>- Advanced panels: shareholding pattern, capex tracker, and Python lab.</li>
            <li>- US market integration: NYSE/NASDAQ/AMEX support.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="F&O Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Option chain with Greeks + OI context for strike-level support.</li>
            <li>- Futures terminal with shared chart engine and realtime stream.</li>
            <li>- Strategy builder, PCR analytics, heatmap, and expiry dashboards.</li>
            <li>- Unified navigation and ticker context across packs.</li>
          </ul>
        </TerminalPanel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TerminalPanel title="Quant & Risk">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Risk Engine: portfolio VaR/CVaR and stress scenarios.</li>
            <li>- Risk Compute: EWMA volatility, beta, and PCA factor decomposition.</li>
            <li>- Model Governance: run registration and model promotion workflow.</li>
            <li>- Portfolio Backtest Jobs: async job-based testing with results.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="Navigation & Workspace">
          <div className="space-y-2 text-xs text-terminal-muted">
            <div className="grid grid-cols-2 gap-2">
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/stocks">Market Home</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/fno">F&O Home</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/backtesting">Backtesting</Link>
              <Link className="rounded border border-terminal-border px-2 py-1 text-center hover:bg-terminal-accent/10" to="/equity/chart-workstation">Workstation</Link>
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
