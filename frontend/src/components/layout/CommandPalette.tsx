import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchCryptoSearch, searchSymbols, type SearchSymbolItem } from "../../api/client";
import { useNavigationHistory } from "../../hooks/useNavigationHistory";
import { useSettingsStore } from "../../store/settingsStore";
import { TerminalBadge, TerminalInput } from "../terminal";

import {
  CHART_WORKSTATION_COMMAND_SPECS,
  COMMAND_FUNCTIONS,
  buildAssetDisambiguationOptions,
  buildTickerCommandHints,
  SHORTCUT_SPECS,
  dispatchChartWorkstationAction,
  executeParsedCommand,
  findShortcutConflicts,
  fuzzyScore,
  parseCommand,
  type CommandExecutionResult,
  type ShortcutScope,
} from "./commanding";

type PaletteItem = {
  id: string;
  label: string;
  description: string;
  command: string;
  badge: "CMD" | "CHART" | "FUNC" | "ASSET" | "NAV";
  run?: () => CommandExecutionResult;
};

function looksLikeTicker(input: string): boolean {
  const token = input.trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,20}$/.test(token);
}

function dedupeSearchMatches(items: SearchSymbolItem[]): SearchSymbolItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${String(item.ticker || "").toUpperCase()}|${String(item.exchange || "").toUpperCase()}|${String(item.name || "").toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function CommandPalette() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const { recentPages } = useNavigationHistory();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchMatches, setSearchMatches] = useState<SearchSymbolItem[]>([]);
  const onChartWorkstation = location.pathname.includes("/equity/chart-workstation");

  const isFunctionToken = (token: string) =>
    COMMAND_FUNCTIONS.some((fn) => {
      const normalized = token.trim().toUpperCase();
      return fn.code === normalized || (fn.aliases ?? []).some((alias) => alias === normalized);
    });

  const visibleShortcutSpecs = useMemo(
    () =>
      SHORTCUT_SPECS.filter(
        (spec) => onChartWorkstation || (spec.scope !== "chart-workstation" && spec.scope !== "chart-panel"),
      ),
    [onChartWorkstation],
  );

  const shortcutGroups = useMemo(() => {
    const grouped = new Map<ShortcutScope, typeof SHORTCUT_SPECS>();
    for (const spec of visibleShortcutSpecs) {
      const rows = grouped.get(spec.scope);
      if (rows) rows.push(spec);
      else grouped.set(spec.scope, [spec]);
    }
    return grouped;
  }, [visibleShortcutSpecs]);

  const shortcutConflicts = useMemo(() => findShortcutConflicts(visibleShortcutSpecs), [visibleShortcutSpecs]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable),
      );

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        if (isEditable && !open) return;
        ev.preventDefault();
        setOpen((v) => !v);
        setHelpOpen(false);
        setQuery("");
        setSelected(0);
        setFeedback(null);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "/") {
        if (isEditable && !open) return;
        ev.preventDefault();
        setOpen(true);
        setHelpOpen((v) => !v);
        setFeedback(null);
        return;
      }
      if (ev.key === "Escape") {
        if (helpOpen) {
          ev.preventDefault();
          setHelpOpen(false);
          return;
        }
        if (open) {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen, open]);

  useEffect(() => {
    const firstToken = query.trim().split(/\s+/)[0] ?? "";
    if (!firstToken || !looksLikeTicker(firstToken) || isFunctionToken(firstToken)) {
      setSearchMatches([]);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [equities, crypto] = await Promise.all([
            searchSymbols(firstToken, selectedMarket),
            fetchCryptoSearch(firstToken),
          ]);
          if (!active) return;
          setSearchMatches(dedupeSearchMatches([...(equities || []), ...(crypto || [])]));
        } catch {
          if (active) {
            setSearchMatches([]);
          }
        }
      })();
    }, 180);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, selectedMarket]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    const rows: Array<PaletteItem & { score: number }> = [];
    const disambiguationItems = buildAssetDisambiguationOptions(q, searchMatches);
    const tickerHints = buildTickerCommandHints(q);
    const recentPageItems = recentPages
      .map((page, idx) => ({
        id: `nav-${page.path}`,
        label: page.label,
        description: page.breadcrumbs.join(" > "),
        command: page.path,
        badge: "NAV" as const,
        run: () => {
          navigate(page.path);
          return { ok: true, target: page.path };
        },
        score: q
          ? Math.max(fuzzyScore(page.label, q), fuzzyScore(page.path, q), fuzzyScore(page.breadcrumbs.join(" "), q))
          : 1700 - idx,
      }))
      .filter((item) => item.score >= 0)
      .slice(0, 10);

    rows.push(...recentPageItems);

    rows.push(
      ...disambiguationItems.map((item, idx) => ({
        id: item.key,
        label: item.symbol,
        description: item.description,
        command: item.command,
        badge: "ASSET" as const,
        score: 2100 - idx,
      })),
    );

    rows.push(
      ...tickerHints.map((hint, idx) => ({
        id: hint.key,
        label: hint.title,
        description: hint.subtitle,
        command: hint.command,
        badge: "FUNC" as const,
        score: 1800 - idx,
      })),
    );

    if (onChartWorkstation) {
      rows.push(
        ...CHART_WORKSTATION_COMMAND_SPECS.map((action) => ({
          id: action.id,
          label: action.title,
          description: action.description,
          command: action.command,
          badge: "CHART" as const,
          run: () => dispatchChartWorkstationAction(action.id),
          score: q
            ? Math.max(
                fuzzyScore(action.title, q),
                fuzzyScore(action.description, q),
                fuzzyScore(action.command, q),
                fuzzyScore(action.shortcut, q),
                ...action.keywords.map((keyword) => fuzzyScore(keyword, q)),
              )
            : 900,
        })),
      );
    }

    rows.push(
      ...COMMAND_FUNCTIONS.map((fn) => ({
        id: `fn-${fn.code}`,
        label: fn.code,
        description: fn.description,
        command: String(fn.code),
        badge: "CMD" as const,
        score: q
          ? Math.max(
              fuzzyScore(fn.code, q),
              fuzzyScore(fn.label, q),
              fuzzyScore(fn.description, q),
              ...(fn.aliases ?? []).map((a) => fuzzyScore(a, q)),
            )
          : 1,
      })),
    );

    if (q && looksLikeTicker(q) && !disambiguationItems.length) {
      rows.unshift({
        id: `ticker-${q.toUpperCase()}`,
        label: q.toUpperCase(),
        description: "Open market page",
        command: q.toUpperCase(),
        badge: "CMD",
        score: 2000,
      });
    }

    return rows
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ score: _score, ...rest }) => rest);
  }, [navigate, onChartWorkstation, query, recentPages, searchMatches]);

  useEffect(() => {
    if (!open) return;
    setSelected(0);
    setFeedback(null);
  }, [open, query]);

  const run = (item: PaletteItem) => {
    const result = item.run
      ? item.run()
      : executeParsedCommand(parseCommand(item.command), navigate);
    if (result.ok) {
      setOpen(false);
      setQuery("");
      setFeedback(null);
      return;
    }
    setFeedback(result.message || "Command could not be completed");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 p-4 md:p-10" onClick={() => setOpen(false)}>
      <div
        className="mx-auto max-w-2xl rounded border border-terminal-border bg-terminal-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-terminal-border px-3 py-2 text-xs uppercase tracking-[0.14em] text-terminal-muted">
          Command Palette
        </div>
        <TerminalInput
          as="input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((idx) => (items.length ? (idx + 1) % items.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((idx) => (items.length ? (idx - 1 + items.length) % items.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = items[selected];
              if (item) run(item);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          size="lg"
          tone="ui"
          className="h-11 rounded-none border-0 border-b border-terminal-border bg-terminal-bg px-3 text-sm text-terminal-text focus:border-terminal-accent"
          placeholder="Type function code, alias, or ticker..."
        />
        <div className="max-h-[52vh] overflow-auto py-1">
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-left ${
                idx === selected ? "bg-terminal-accent/12" : "hover:bg-terminal-bg/70"
              }`}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => run(item)}
            >
              <TerminalBadge variant={item.badge === "CHART" || item.badge === "FUNC" ? "accent" : "neutral"} size="sm">{item.badge}</TerminalBadge>
              <span className="min-w-0">
                <span className="block truncate text-sm text-terminal-text">{item.label}</span>
                <span className="block truncate text-xs text-terminal-muted">{item.description}</span>
              </span>
              <span className="text-xs text-terminal-accent">{item.command}</span>
            </button>
          ))}
          {!items.length ? <div className="px-3 py-3 text-xs text-terminal-muted">No matches</div> : null}
        </div>
        {feedback ? (
          <div className="border-t border-terminal-border px-3 py-2 text-xs text-terminal-warn">
            {feedback}
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-terminal-border px-3 py-2 text-[10px] text-terminal-muted">
          <span>Enter: run | Esc: close | Ctrl/Cmd+/: shortcuts</span>
          {shortcutConflicts.length ? (
            <span className="text-amber-400">{shortcutConflicts.length} conflict(s)</span>
          ) : (
            <span className="text-emerald-400">No shortcut conflicts</span>
          )}
        </div>
      </div>
      {helpOpen ? (
        <div
          className="mx-auto mt-3 max-w-2xl rounded border border-terminal-border bg-terminal-panel shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-terminal-border px-3 py-2 text-xs uppercase tracking-[0.14em] text-terminal-muted">
            Shortcut Help
          </div>
          <div className="grid gap-2 p-3 text-xs">
            {(["global", "command-bar", "chart-workstation", "chart-panel"] as ShortcutScope[]).map((scope) => {
              const rows = shortcutGroups.get(scope) ?? [];
              if (!rows.length) return null;
              return (
                <div key={scope} className="rounded border border-terminal-border/70">
                  <div className="border-b border-terminal-border/70 px-2 py-1 uppercase tracking-[0.12em] text-terminal-muted">
                    {scope}
                  </div>
                  <div className="divide-y divide-terminal-border/60">
                    {rows.map((row) => (
                      <div key={row.id} className="grid grid-cols-[auto_1fr] gap-2 px-2 py-1.5">
                        <span className="text-terminal-accent">{row.combo}</span>
                        <span className="text-terminal-text">{row.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {shortcutConflicts.length ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
                Review conflicts: {shortcutConflicts.map((c) => c.combo).join(", ")}
              </div>
            ) : null}
            {onChartWorkstation ? (
              <div className="rounded border border-terminal-accent/30 bg-terminal-accent/10 px-2 py-1 text-terminal-text">
                Chart pane shortcuts apply only when a chart pane has focus. Use `1-9` or click a pane first.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
