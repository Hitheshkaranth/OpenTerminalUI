import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TerminalBadge, TerminalInput } from "../terminal";

import { COMMAND_FUNCTIONS, executeParsedCommand, fuzzyScore, parseCommand } from "./commanding";

type PaletteItem = {
  id: string;
  label: string;
  description: string;
  command: string;
};

function looksLikeTicker(input: string): boolean {
  const token = input.trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,20}$/.test(token);
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setSelected(0);
        return;
      }
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    const rows: Array<PaletteItem & { score: number }> = COMMAND_FUNCTIONS.map((fn) => ({
      id: `fn-${fn.code}`,
      label: fn.code,
      description: fn.description,
      command: String(fn.code),
      score: q
        ? Math.max(
            fuzzyScore(fn.code, q),
            fuzzyScore(fn.label, q),
            fuzzyScore(fn.description, q),
            ...(fn.aliases ?? []).map((a) => fuzzyScore(a, q)),
          )
        : 1,
    }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (q && looksLikeTicker(q)) {
      rows.unshift({
        id: `ticker-${q.toUpperCase()}`,
        label: q.toUpperCase(),
        description: "Open security hub",
        command: q.toUpperCase(),
        score: 2000,
      });
    }
    return rows.map(({ score: _score, ...rest }) => rest);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setSelected(0);
  }, [open, query]);

  const run = (command: string) => {
    const result = executeParsedCommand(parseCommand(command), navigate);
    if (result.ok) {
      setOpen(false);
      setQuery("");
    }
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
              if (item) run(item.command);
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
              onClick={() => run(item.command)}
            >
              <TerminalBadge variant="neutral" size="sm">CMD</TerminalBadge>
              <span className="min-w-0">
                <span className="block truncate text-sm text-terminal-text">{item.label}</span>
                <span className="block truncate text-xs text-terminal-muted">{item.description}</span>
              </span>
              <span className="text-xs text-terminal-accent">{item.command}</span>
            </button>
          ))}
          {!items.length ? <div className="px-3 py-3 text-xs text-terminal-muted">No matches</div> : null}
        </div>
      </div>
    </div>
  );
}
