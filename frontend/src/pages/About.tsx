import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

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
      <TerminalPanel title="About OpenTerminalUI">
        <div className="text-sm text-terminal-text">
          OpenTerminalUI is a terminal-first equities workspace for screening, charting, financial analysis, and monitoring market signals in one dense interface.
        </div>
      </TerminalPanel>

      <TerminalPanel title="Why It Was Built">
        <p className="mt-2 text-xs leading-relaxed text-terminal-text">
          It was built to cut context switching between scattered finance tools and deliver a fast, keyboard-friendly command center for tracking symbols, reading fundamentals, and acting on data with minimal UI overhead.
        </p>
        <ul className="mt-2 space-y-1 text-xs text-terminal-muted">
          <li>- Terminal density with clear signal over decoration.</li>
          <li>- Unified workflows across quote, chart, screener, portfolio, and news.</li>
          <li>- Market-aware state, caching, and realtime/polling behavior designed for active sessions.</li>
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
