import { useMemo, useState } from "react";
import { TerminalBadge } from "../terminal/TerminalBadge";

export type OpenScriptLibraryItem = {
  id: string;
  name: string;
  description: string;
  source: string;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  scripts: OpenScriptLibraryItem[];
  selectedScriptId: string | null;
  loading?: boolean;
  onSelectScript: (scriptId: string) => void;
  onNewScript: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onDelete: () => void;
  onTogglePublic: () => void;
};

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "Draft";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function ScriptLibrary({
  scripts,
  selectedScriptId,
  loading = false,
  onSelectScript,
  onNewScript,
  onSave,
  onSaveAs,
  onDelete,
  onTogglePublic,
}: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter((script) => `${script.name} ${script.description} ${script.source}`.toLowerCase().includes(q));
  }, [query, scripts]);
  const selected = scripts.find((script) => script.id === selectedScriptId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-terminal-bg/75 text-terminal-text">
      <div className="border-b border-terminal-border px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-accent">My Scripts</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="rounded border border-terminal-accent bg-terminal-accent/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-accent" onClick={onNewScript}>New</button>
          <button type="button" className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted" onClick={onSave} disabled={loading}>Save</button>
          <button type="button" className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted" onClick={onSaveAs} disabled={loading}>Save As</button>
          <button type="button" className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted" onClick={onTogglePublic} disabled={loading}>Share</button>
          <button type="button" className="rounded border border-terminal-neg/80 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-neg" onClick={onDelete} disabled={loading}>Delete</button>
        </div>
        <label className="mt-3 block text-[11px] uppercase tracking-[0.14em] text-terminal-muted">
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 w-full rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
            placeholder="Filter scripts"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {filtered.length ? (
          <div className="space-y-2">
            {filtered.map((script) => {
              const active = script.id === selectedScriptId;
              return (
                <button
                  key={script.id}
                  type="button"
                  className={`block w-full rounded border px-3 py-2 text-left ${active ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-panel/50"}`}
                  onClick={() => onSelectScript(script.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-terminal-text">{script.name}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-terminal-muted">{script.description || "No description"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {script.is_public ? <TerminalBadge variant="accent" size="sm">PUBLIC</TerminalBadge> : null}
                      {active ? <TerminalBadge variant="neutral" size="sm">ACTIVE</TerminalBadge> : null}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-terminal-muted">
                    <span>{formatUpdatedAt(script.updated_at)}</span>
                    <span>{script.source.length.toLocaleString()} chars</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-terminal-border px-3 py-4 text-[11px] text-terminal-muted">
            {loading ? "Loading scripts..." : "No scripts match the current filter."}
          </div>
        )}
      </div>

      {selected ? (
        <div className="border-t border-terminal-border px-3 py-2 text-[10px] text-terminal-muted">
          <div className="flex items-center justify-between gap-2">
            <span className="uppercase tracking-[0.14em] text-terminal-accent">Selected</span>
            <span>{selected.is_public ? "Shared" : "Private"}</span>
          </div>
          <div className="mt-1 truncate text-terminal-text">{selected.name}</div>
        </div>
      ) : null}
    </div>
  );
}
