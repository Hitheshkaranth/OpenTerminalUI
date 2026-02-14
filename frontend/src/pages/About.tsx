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
            <div className="mt-1">Open-source NSE trading analytics workspace with Equity and F&O terminal packs.</div>
          </div>
        </div>
      </TerminalPanel>

      <div className="grid gap-3 lg:grid-cols-2">
        <TerminalPanel title="Equity Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Search, charting, screener and technical overlays.</li>
            <li>- Fundamentals, DCF valuation and peer comparison.</li>
            <li>- Portfolio/backtest workflows and alerts.</li>
            <li>- News + sentiment linked to selected ticker.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="F&O Pack">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Option chain, Greeks and OI analysis dashboards.</li>
            <li>- Strategy builder with payoff views and presets.</li>
            <li>- PCR, IV, heatmap and expiry workflows.</li>
            <li>- Shared realtime chart engine + indicator framework.</li>
          </ul>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Infrastructure">
        <ul className="space-y-1 text-xs text-terminal-muted">
          <li>- FastAPI backend + React/TypeScript terminal frontend.</li>
          <li>- Realtime WebSocket quotes with REST fallback paths.</li>
          <li>- Background services: instruments loader, news ingestion, snapshots.</li>
          <li>- Caching layers and Docker-ready deployment model.</li>
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
