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
      <TerminalPanel title="F&O Pack About">
        <div className="flex items-center gap-3">
          <img src={logo} alt="OpenTerminalUI" className="h-14 w-auto object-contain" />
          <div className="text-xs text-terminal-muted">
            Bloomberg-style dense F&O workspace for option chain, Greeks, OI signals, strategy design and expiry monitoring.
          </div>
        </div>
      </TerminalPanel>

      <TerminalPanel title="F&O Capabilities">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Option Chain with ATM focus, range filter and OI structure.</li>
          <li>- Greeks analytics (Delta/Gamma/Theta/Vega) and exposure views.</li>
          <li>- OI analysis with max pain, support/resistance and buildup patterns.</li>
          <li>- Strategy, PCR, Heatmap and Expiry dashboards.</li>
        </ul>
      </TerminalPanel>

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
            <Link className="inline-block rounded border border-terminal-border px-2 py-1 text-terminal-accent" to="/fno">
              Back to F&O Home
            </Link>
          </div>
        </TerminalPanel>
      </div>
    </div>
  );
}
