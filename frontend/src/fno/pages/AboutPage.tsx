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
            Bloomberg-style dense terminal view focused on futures/options analytics while staying aligned with the Equity workspace conventions.
          </div>
        </div>
      </TerminalPanel>

      <div className="grid gap-3 md:grid-cols-2">
        <TerminalPanel title="F&O Pack Modules">
          <ul className="space-y-1 text-xs text-terminal-text">
            <li>- Option Chain, Greeks, OI analysis and Futures chart.</li>
            <li>- Strategy builder, PCR, heatmap and expiry dashboards.</li>
            <li>- Shared chart engine with realtime stream + indicators.</li>
            <li>- ATM/PCR/Max Pain marker overlays and key levels.</li>
          </ul>
        </TerminalPanel>

        <TerminalPanel title="Cross-Pack Consistency">
          <ul className="space-y-1 text-xs text-terminal-muted">
            <li>- Same top market header and bottom data status strip as Equity.</li>
            <li>- Same terminal navigation density and function-key mapping.</li>
            <li>- Shared ticker context for quick pack switching.</li>
            <li>- Matching about/navigation patterns across both packs.</li>
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
          <li>- Background services for news, instruments and snapshots.</li>
          <li>- Docker and CI-enabled build/test workflow.</li>
        </ul>
      </TerminalPanel>
    </div>
  );
}
