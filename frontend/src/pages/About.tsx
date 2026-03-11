import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import logo from "../assets/logo.png";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { AsciiHero } from "../home/AsciiHero";

const REPO_URL = "https://github.com/Hitheshkaranth/OpenTerminalUI";
const STAR_URL = `${REPO_URL}/stargazers`;

const PLATFORM_STATS = [
  { value: "79", label: "Routes Indexed", tone: "accent" },
  { value: "70+", label: "Indicators", tone: "accent" },
  { value: "12+", label: "Strategies", tone: "accent" },
  { value: "7", label: "Quant Models", tone: "success" },
  { value: "IN + US", label: "Markets", tone: "info" },
  { value: "WS", label: "Realtime Relay", tone: "success" },
] as const;

const CHANGELOG_ITEMS = [
  {
    kind: "feature",
    title: "Crosshair sync",
    detail: "Linked launchpad and workstation panels now share crosshair timestamps with throttled broadcasts.",
  },
  {
    kind: "feature",
    title: "Volume profile / VPOC",
    detail: "Volume profile overlays expose POC and 70 percent value area controls directly in charting flows.",
  },
  {
    kind: "fix",
    title: "Indicator pane stability",
    detail: "Non-price panes no longer collapse primary price visibility when traders toggle stacked indicators.",
  },
  {
    kind: "perf",
    title: "Command surface hardening",
    detail: "GO bar and command palette shortcuts were tightened for faster keyboard-first route changes.",
  },
  {
    kind: "feature",
    title: "Chart replay toolset",
    detail: "Replay helpers, comparison-series workflows, and transform tooling ship as a coherent analysis deck.",
  },
  {
    kind: "perf",
    title: "Provider registry coverage",
    detail: "Provider waterfall ordering and adapter tests now cover more fallback and regression paths.",
  },
] as const;

const TECH_STACK = [
  { label: "Frontend", value: "React 18 + TypeScript 5 + Vite" },
  { label: "Backend", value: "FastAPI + Python 3.11+" },
  { label: "Charting", value: "Lightweight Charts + custom SVG overlays" },
  { label: "Realtime", value: "WebSocket feeds with REST fallback" },
  { label: "Storage", value: "SQLite + optional Redis caches" },
  { label: "Deploy", value: "Docker Compose" },
  { label: "Styling", value: "Tailwind CSS + terminal theme tokens" },
  { label: "Testing", value: "Vitest + Playwright" },
] as const;

const MODULE_GROUPS = [
  {
    title: "Equity & Analysis",
    items: [
      "Terminal shell + GO bar",
      "Security hub + stock detail",
      "Chart workstation + launchpad",
      "Screener + portfolio + watchlist",
      "Economics + yield curve",
      "Crypto workspace",
      "Paper trading",
    ],
  },
  {
    title: "F&O Derivatives",
    items: [
      "Option chain + Greeks",
      "OI + IV analysis",
      "Strategy builder",
      "PCR + heatmap",
      "Futures terminal",
      "Expiry dashboard",
    ],
  },
  {
    title: "Quant & Risk",
    items: [
      "Risk Engine (VaR/CVaR)",
      "Risk Compute metrics",
      "Model Lab experiments",
      "Portfolio Lab + blends",
      "Walk-forward validation",
      "Execution simulator",
      "Backtesting control deck",
    ],
  },
  {
    title: "Platform & Ops",
    items: [
      "Plugin system",
      "Alert engine",
      "OMS / compliance",
      "Ops dashboard",
      "Provider registry",
      "Auth + account flows",
      "Export pathways",
    ],
  },
] as const;

const QUICK_LINKS = [
  { label: "Market Home", to: "/equity/stocks", badge: "F1" },
  { label: "Security Hub", to: "/equity/security", badge: "SH" },
  { label: "Cockpit", to: "/equity/cockpit", badge: "CP" },
  { label: "Launchpad", to: "/equity/launchpad", badge: "LP" },
  { label: "Workstation", to: "/equity/chart-workstation", badge: "6" },
  { label: "Crypto", to: "/equity/crypto", badge: "CR" },
  { label: "Economics", to: "/equity/economics", badge: "E" },
  { label: "F&O Home", to: "/fno", badge: "F8" },
  { label: "Backtesting", to: "/backtesting", badge: "F9" },
  { label: "Model Lab", to: "/backtesting/model-lab", badge: "ML" },
  { label: "Portfolio Lab", to: "/equity/portfolio/lab", badge: "PL" },
  { label: "Risk Dashboard", to: "/equity/risk", badge: "RSK" },
  { label: "Paper Trading", to: "/equity/paper", badge: "P" },
  { label: "Breakout Scanner", to: "/equity/screener", badge: "SCAN" },
  { label: "Ops", to: "/equity/ops", badge: "OPS" },
] as const;

const COMMAND_SURFACES = [
  {
    keycap: "CTRL/CMD+G",
    title: "GO Bar",
    detail: "Load symbols, desks, or route aliases from the terminal header without leaving context.",
  },
  {
    keycap: "CTRL/CMD+K",
    title: "Command Palette",
    detail: "Search prompt-defined actions, saved routes, and desk-level functions from a single surface.",
  },
  {
    keycap: "F1-F9",
    title: "Desk Functions",
    detail: "Bloomberg-style function keys accelerate movement across market, research, and execution workspaces.",
  },
  {
    keycap: "ESC",
    title: "Back / Close",
    detail: "Preserves the current dossier exit path and backs out of the active screen immediately.",
  },
] as const;

const REPO_FACTS = [
  { label: "License", value: "MIT" },
  { label: "Stars", value: "1" },
  { label: "Commits", value: "54" },
  { label: "Indexed", value: "March 11, 2026" },
] as const;

const REPO_LANGUAGES = [
  { label: "Python", share: 56.2, color: "var(--ot-color-accent-primary)" },
  { label: "TypeScript", share: 42.4, color: "var(--ot-color-accent-secondary)" },
  { label: "Other", share: 1.4, color: "var(--ot-color-border-strong)" },
] as const;

const CHANGELOG_COLORS: Record<(typeof CHANGELOG_ITEMS)[number]["kind"], string> = {
  feature: "var(--ot-color-accent-primary)",
  fix: "var(--ot-color-accent-secondary)",
  perf: "var(--ot-color-market-up)",
};

function buildDateLabel(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "unknown";
  return new Date(ts).toLocaleString();
}

function commitLabel(value: string): string {
  if (!value || value === "unknown") return "unknown";
  return value.slice(0, 7);
}

function StatBadge({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "accent" | "success" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-terminal-pos text-terminal-pos bg-terminal-pos/10"
      : tone === "info"
        ? "border-terminal-border text-terminal-text bg-terminal-bg/60"
        : "border-terminal-accent text-terminal-accent bg-terminal-accent/10";

  return (
    <li className={`min-w-[132px] rounded-sm border px-3 py-2 ${toneClass}`}>
      <div className="text-base font-semibold tracking-[0.12em] [font-variant-numeric:tabular-nums]">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">{label}</div>
    </li>
  );
}

function RegistryGroup({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="rounded-sm border border-terminal-border/70 bg-terminal-bg/50 p-3" aria-label={title}>
      <div className="border-l-2 border-terminal-accent pl-2 text-[11px] uppercase tracking-[0.14em] text-terminal-accent">
        {title}
      </div>
      <ul className="mt-3 space-y-1.5 text-xs text-terminal-text">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-terminal-accent">
              *
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuickNavLink({ label, to, badge }: { label: string; to: string; badge: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between rounded-sm border border-terminal-border bg-terminal-bg/40 px-3 py-2 text-left text-xs text-terminal-text transition-colors hover:border-terminal-accent hover:bg-terminal-accent/10"
      aria-label={label}
    >
      <span>{label}</span>
      <span className="rounded-sm border border-terminal-border bg-terminal-panel px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-terminal-muted group-hover:border-terminal-accent group-hover:text-terminal-accent">
        {badge}
      </span>
    </Link>
  );
}

export interface AboutProps {
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

  const deskLabel = terminalType === "fno" ? "Derivatives Desk" : "Market Desk";
  const descriptor =
    terminalType === "fno"
      ? "Derivatives workflows, strategy tooling, and cross-desk charting in one terminal dossier."
      : "Analyze. Trade. Optimize. Open-source Indian and US market analytics with shared terminal routing.";

  return (
    <div className="space-y-3 p-3 font-mono">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-terminal-muted">
          <span>About | OpenTerminalUI</span>
          <TerminalBadge variant="accent">{deskLabel}</TerminalBadge>
          <TerminalBadge variant="info">Product Dossier</TerminalBadge>
        </div>
        <div className="flex items-center gap-2">
          <TerminalBadge variant="neutral">Esc</TerminalBadge>
          <TerminalButton type="button" size="sm" onClick={() => navigate(-1)} aria-label="Go back">
            Back
          </TerminalButton>
        </div>
      </header>

      <section aria-label="Product dossier header" className="rounded-sm border border-terminal-border bg-terminal-panel p-2">
        <div className="relative overflow-hidden rounded-sm">
          <AsciiHero className="h-[180px] w-full" palette="amber" quality="med" glow={0.5} />
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-terminal-bg/15 via-terminal-bg/45 to-terminal-bg/85 px-4 text-center">
            <img src={logo} alt="OpenTerminalUI logo" className="h-12 w-12 rounded-sm border border-terminal-border bg-terminal-panel/80 p-1.5" />
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.22em] text-terminal-muted">{deskLabel}</div>
              <h1 className="text-2xl uppercase tracking-[0.14em] text-terminal-accent">OpenTerminalUI</h1>
              <p className="mx-auto max-w-2xl text-[11px] text-terminal-muted">{descriptor}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
                v{appVersion} | Built {builtDate} | Commit {shortCommit}
              </p>
            </div>
          </div>
        </div>
      </section>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6" aria-label="Platform stats">
        {PLATFORM_STATS.map((item) => (
          <StatBadge key={item.label} value={item.value} label={item.label} tone={item.tone} />
        ))}
      </ul>

      <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <TerminalPanel title="What's New" actions={<TerminalBadge variant="live">Release</TerminalBadge>}>
          <section aria-label="What's New" className="space-y-2">
            {CHANGELOG_ITEMS.map((item) => (
              <article
                key={`${item.kind}-${item.title}`}
                className="rounded-sm border border-terminal-border/70 bg-terminal-bg/40 p-3"
                style={{ borderLeftWidth: "2px", borderLeftColor: CHANGELOG_COLORS[item.kind] }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]"
                    style={{
                      borderColor: CHANGELOG_COLORS[item.kind],
                      color: CHANGELOG_COLORS[item.kind],
                      backgroundColor: "var(--ot-color-surface-2)",
                    }}
                  >
                    {item.kind}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-terminal-text">{item.title}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-terminal-text">{item.detail}</p>
              </article>
            ))}
          </section>
        </TerminalPanel>

        <TerminalPanel title="Tech Stack" actions={<TerminalBadge variant="info">Stack</TerminalBadge>}>
          <section aria-label="Tech Stack" className="grid gap-2 sm:grid-cols-2">
            {TECH_STACK.map((item) => (
              <div key={item.label} className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">{item.label}</div>
                <div className="mt-1 text-xs leading-5 text-terminal-text">{item.value}</div>
              </div>
            ))}
          </section>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Module Registry" actions={<TerminalBadge variant="accent">Indexed</TerminalBadge>}>
        <section aria-label="Module Registry" className="grid gap-3 lg:grid-cols-2">
          {MODULE_GROUPS.map((group) => (
            <RegistryGroup key={group.title} title={group.title} items={group.items} />
          ))}
        </section>
      </TerminalPanel>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <TerminalPanel title="Quick Navigation" actions={<TerminalBadge variant="info">Routes</TerminalBadge>}>
          <section aria-label="Quick Navigation" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {QUICK_LINKS.map((item) => (
              <QuickNavLink key={item.label} label={item.label} to={item.to} badge={item.badge} />
            ))}
          </section>
        </TerminalPanel>

        <TerminalPanel title="Command Surfaces" actions={<TerminalBadge variant="accent">Prompt</TerminalBadge>}>
          <section aria-label="Command Surfaces" className="space-y-2">
            {COMMAND_SURFACES.map((item) => (
              <article key={item.keycap} className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-sm border border-terminal-border bg-terminal-panel px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-terminal-accent">
                    {item.keycap}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-terminal-text">{item.title}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-terminal-muted">{item.detail}</p>
              </article>
            ))}
          </section>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Repository Intelligence" actions={<TerminalBadge variant="live">GitHub</TerminalBadge>}>
        <section aria-label="Repository Intelligence" className="space-y-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Origin</div>
              <div className="mt-1 break-all text-xs text-terminal-text">{REPO_URL}</div>
              <p className="mt-2 text-[11px] text-terminal-muted">
                Repo snapshot aligns the client dossier with GitHub metadata indexed on March 11, 2026.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center justify-center rounded-sm border border-terminal-accent bg-terminal-accent/20 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-accent"
                aria-label="Open GitHub"
              >
                Open GitHub
              </a>
              <a
                href={STAR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-text"
                aria-label="Star on GitHub"
              >
                Star on GitHub
              </a>
              <TerminalButton type="button" size="sm" onClick={() => void onCopy()} aria-label="Copy repository URL">
                Copy URL
              </TerminalButton>
              {copied ? <TerminalBadge variant="live">Copied</TerminalBadge> : null}
            </div>
          </div>

          <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {REPO_FACTS.map((item) => (
              <div key={item.label} className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 p-3">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">{item.label}</dt>
                <dd className="mt-1 text-sm text-terminal-text [font-variant-numeric:tabular-nums]">{item.value}</dd>
              </div>
            ))}
          </dl>

          <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Language Breakdown</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Python 56.2% | TypeScript 42.4% | Other 1.4%</div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-sm border border-terminal-border bg-terminal-panel" aria-hidden="true">
              <div className="flex h-full">
                {REPO_LANGUAGES.map((segment) => (
                  <div key={segment.label} style={{ width: `${segment.share}%`, backgroundColor: segment.color }} />
                ))}
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
              {REPO_LANGUAGES.map((segment) => (
                <li key={segment.label} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px]" style={{ backgroundColor: segment.color }} />
                  <span>
                    {segment.label} {segment.share.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </TerminalPanel>

      <div className="text-[11px] uppercase tracking-[0.18em] text-terminal-muted">Esc: Back</div>
    </div>
  );
}
