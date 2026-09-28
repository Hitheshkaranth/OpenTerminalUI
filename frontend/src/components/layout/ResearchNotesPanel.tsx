import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { addNote, deleteNote, listNotes, type NoteItem } from "../../api/agentExtras";
import { extractApiErrorMessage } from "../../api/base";
import type { LaunchpadPanelConfig } from "./LaunchpadContext";

type PanelProps = { panel: LaunchpadPanelConfig };

type Filter = "all" | "note" | "thesis" | "reflection";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "note", label: "Notes" },
  { id: "thesis", label: "Thesis" },
  { id: "reflection", label: "Reflections" },
];

const MAX_CHARS = 2000;
const BANNER_MS = 2500;

function fmtDate(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function kindBadgeClassName(kind: NoteItem["kind"]): string {
  switch (kind) {
    case "thesis":
      return "border-terminal-accent/60 text-terminal-accent";
    case "reflection":
      return "border-terminal-muted/60 text-terminal-muted";
    default:
      return "border-terminal-border text-terminal-muted";
  }
}

export function LaunchpadResearchNotesPanel({ panel }: PanelProps) {
  const queryClient = useQueryClient();
  const controlId = useId();
  const symbol = panel.symbol?.trim().toUpperCase() || null;
  const isLinked = symbol !== null;
  const queryKey = ["agent", "notes", symbol] as const;

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => listNotes(symbol ?? undefined),
  });

  const [kind, setKind] = useState<"note" | "thesis">("note");
  const [content, setContent] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (text: string) => addNote({ symbol, kind, content: text }),
    onSuccess: () => {
      setContent("");
      setBanner(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => setBanner(extractApiErrorMessage(err, "Couldn't save note.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      setDeletingIds(new Set());
      setBanner("Note deleted.");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      setDeletingIds(new Set());
      setBanner(extractApiErrorMessage(err, "Couldn't delete note."));
    },
  });

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), BANNER_MS);
    return () => window.clearTimeout(t);
  }, [banner]);

  const items = useMemo(() => {
    const scopedItems = symbol
      ? (data?.items ?? [])
      : (data?.items ?? []).filter((item) => item.symbol === null);
    return scopedItems.slice().sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }, [data, symbol]);

  const visible = filter === "all" ? items : items.filter((n) => n.kind === filter);

  const handleDelete = (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    deleteMutation.mutate(id);
  };

  const handleSubmit = () => {
    const text = content.trim();
    if (!text || addMutation.isPending) return;
    addMutation.mutate(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy={isLoading || addMutation.isPending || deleteMutation.isPending}>
      <div className="shrink-0 border-b border-terminal-border px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${isLinked ? "text-terminal-accent bg-terminal-accent" : "bg-terminal-muted"}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="ot-type-panel-title truncate text-terminal-accent">Research Notes</div>
              <div className="ot-type-panel-subtitle truncate text-terminal-muted">
                {isLinked ? `Linked · ${symbol}` : "General research notes"}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-[10px] text-terminal-muted" aria-label={`${visible.length} of ${items.length} notes`}>
            {visible.length}/{items.length}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-terminal-border px-2 py-1.5">
        <div role="group" aria-label="Filter notes by kind" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent ${
                filter === f.id
                  ? "border border-terminal-accent/60 text-terminal-accent"
                  : "border border-transparent text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {banner ? (
          <div
            className={`mb-2 rounded-sm border px-2 py-1 text-[10px] ${
              banner.startsWith("Couldn't")
                ? "border-terminal-neg/40 text-terminal-neg"
                : "border-terminal-border text-terminal-text"
            }`}
            role="status"
          >
            {banner}
          </div>
        ) : null}

        {isLoading && <div className="text-[11px] text-terminal-muted">Loading notes…</div>}
        {isError && !isLoading && (
          <div className="text-[11px] text-terminal-neg">{extractApiErrorMessage(error, "Failed to load notes.")}</div>
        )}

        {!isLoading && !isError && !visible.length && (
          <div className="text-[11px] text-terminal-muted">
            {items.length === 0 ? "No research notes yet." : `No ${filter} notes.`}
          </div>
        )}

        <div className="space-y-2">
          {visible.map((n) => (
            <div
              key={n.id}
              className="flex items-start gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded border px-1 font-mono text-[8px] uppercase tracking-wide ${kindBadgeClassName(n.kind)}`}
                  >
                    {n.kind}
                  </span>
                  <span className="font-mono text-[9px] text-terminal-muted">{fmtDate(n.created_at)}</span>
                </div>
                <p className="mt-0.5 break-words text-[11px] leading-snug text-terminal-text">{n.content}</p>
                <div className="mt-1 text-[9px] uppercase tracking-wide text-terminal-muted">
                  Source: {n.source}
                </div>
              </div>
              {n.kind !== "reflection" ? (
                <button
                  type="button"
                  disabled={deletingIds.has(n.id) || deleteMutation.isPending}
                  onClick={() => handleDelete(n.id)}
                  aria-label={`Delete ${n.kind} note from ${n.source}`}
                  title="Delete note"
                  className="shrink-0 p-1 text-terminal-muted hover:text-terminal-neg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent disabled:opacity-40"
                >
                  {deletingIds.has(n.id) ? <span className="text-[9px]">…</span> : <Trash2 size={13} />}
                </button>
              ) : (
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-terminal-muted">Read only</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-terminal-border px-2 py-2">
        <div className="grid grid-cols-[1fr_auto] items-end gap-1.5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${controlId}-kind`} className="text-[10px] font-semibold uppercase tracking-wide text-terminal-muted">
                Type
              </label>
              <select
                id={`${controlId}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as "note" | "thesis")}
                className="rounded-sm border border-terminal-border bg-terminal-bg px-1.5 py-1 text-[11px] text-terminal-text outline-none focus:border-terminal-accent"
              >
                <option value="note">note</option>
                <option value="thesis">thesis</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${controlId}-body`} className="sr-only">
                Note content
              </label>
              <textarea
                id={`${controlId}-body`}
                value={content}
                maxLength={MAX_CHARS}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`Write a ${kind}…`}
                rows={3}
                className="resize-none rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text placeholder:text-terminal-muted outline-none focus:border-terminal-accent"
              />
              <div
                className="text-right text-[9px] text-terminal-muted"
                aria-live="polite"
                aria-atomic="true"
              >
                {content.length}/{MAX_CHARS}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || addMutation.isPending}
            className="shrink-0 rounded-sm border border-terminal-accent/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-terminal-accent transition-colors hover:bg-terminal-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent disabled:opacity-40"
          >
            {addMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
