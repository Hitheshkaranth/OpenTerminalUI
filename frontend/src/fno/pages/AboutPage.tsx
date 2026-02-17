import { useMemo } from "react";
import { Link } from "react-router-dom";

import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import logo from "../../assets/logo.png";

function buildLabel(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "unknown";
  return new Date(ts).toLocaleString();
}

function commitLabel(value: string): string {
  if (!value || value === "unknown") return "unknown";
  return value.slice(0, 7);
}

export function FnoAboutPage() {
  const builtDate = useMemo(() => buildLabel(__BUILD_DATE__), []);
  const commit = useMemo(() => commitLabel(__GIT_COMMIT__), []);
  const version = useMemo(() => (__APP_VERSION__ || "0.0.0").trim(), []);

  return (
    <div className="space-y-3 p-3 font-mono">
      <TerminalPanel title="OpenTerminalUI F&O Terminal">
        <div className="flex items-center gap-3">
          <img src={logo} alt="OpenTerminalUI" className="h-14 w-auto object-contain" />
          <div className="text-xs text-terminal-muted">
            Dense F&O terminal focused on derivatives workflows with unified behavior across the Equity and Backtesting experiences.
          </div>
        </div>
      </TerminalPanel>

      <div className="grid gap-3 md:grid-cols-2">
        <TerminalPanel title="F&O Pack Modules">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Option chain with Greeks and OI context for directional and volatility setups.</li>
            <li>- Strategy builder with presets and payoff visualization for multi-leg structures.</li>
            <li>- PCR dashboard, market heatmap, and expiry dashboard for breadth and timing.</li>
            <li>- Futures page with chart + indicators using the shared chart engine.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="Cross-Pack Consistency">
          <ul className="space-y-1 text-xs text-terminal-muted">
            <li>- Shared top market strip with live index and commodity movement.</li>
            <li>- Unified route model and quick links (including direct Heatmap access).</li>
            <li>- Common ticker context to switch Equity/F&O without re-entry.</li>
            <li>- Shared instrument metadata badges for country, exchange, and derivatives capability.</li>
            <li>- Matching visual language, control density, and panel behavior.</li>
          </ul>
        </TerminalPanel>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TerminalPanel title="Build Metadata">
          <div className="text-xs text-terminal-text">
            <div>Built: {builtDate}</div>
            <div>Commit: {commit}</div>
            <div>Version: {version}</div>
          </div>
        </TerminalPanel>
        <TerminalPanel title="Navigation">
          <div className="space-y-2 text-xs text-terminal-muted">
            <div>F1 Option Chain | F2 Greeks | F3 Futures | F4 OI Analysis</div>
            <div>F5 Strategy | F6 PCR | F7 Heatmap | F8 Expiry | F9 About</div>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="inline-block rounded border border-terminal-border px-2 py-1 text-terminal-accent" to="/fno">
                Back to F&O Home
              </Link>
              <Link className="inline-block rounded border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text" to="/equity/stocks/about">
                Equity About
              </Link>
            </div>
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Project Infrastructure">
        <ul className="space-y-1 text-xs text-terminal-muted">
          <li>- FastAPI + React/TypeScript terminal architecture.</li>
          <li>- WebSocket quote stream with fallback polling path.</li>
          <li>- Shared API v1 capabilities: equity analytics, shareholding, mutual funds, indicators, scripting, and crypto endpoints.</li>
          <li>- Background services for instruments, news, and snapshot continuity.</li>
          <li>- Docker and CI-ready build/verify workflow.</li>
        </ul>
      </TerminalPanel>

      <TerminalPanel title="Latest Additions (vs Previous Commit)">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Unified auth stack with JWT + role-protected flows across Equity, F&O, and Backtesting routes.</li>
          <li>- Events/Earnings backend expansion with new dashboard/portfolio widgets.</li>
          <li>- Alerts v2 with websocket push channel and history tracking.</li>
          <li>- Paper trading engine + dashboard and strategy deploy endpoint.</li>
          <li>- Multi-exchange adapter framework (Kite/Yahoo/Crypto) and adapter-first routing foundation.</li>
          <li>- Sidebar user account details panel now pinned at bottom-left for F&O as well.</li>
        </ul>
      </TerminalPanel>
    </div>
  );
}
