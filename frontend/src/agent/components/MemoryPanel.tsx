import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listNotes, addNote, deleteNote, runReflections, type NoteItem } from "../../api/agentExtras";
import { extractApiErrorMessage } from "../../api/base";

export function MemoryPanel({ symbol }: { symbol: string | null }) {
  const queryClient = useQueryClient();
  const queryKey = ["agent", "notes", symbol] as const;

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => listNotes(symbol ?? undefined),
  });

  const [kind, setKind] = useState<"note" | "thesis">("note");
  const [content, setContent] = useState("");

  const addMutation = useMutation({
    mutationFn: (content: string) => addNote({ symbol: symbol ? symbol.toUpperCase() : null, kind, content }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const reflectionMutation = useMutation({
    mutationFn: () => runReflections(0),
    onSuccess: (data) => {
      const msg = data.created > 0
        ? `Created ${data.created} reflection${data.created !== 1 ? "s" : ""}, ${data.skipped} skipped`
        : `${data.skipped} reflections skipped`;
      alert(msg);
    },
  });

  return (
    <div className="border-t border-terminal-border">
      <details className="group" open>
        <summary className="cursor-pointer px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-terminal-muted hover:text-terminal-text">
          Memory{symbol ? ` · ${symbol}` : ""}
        </summary>
        <div className="flex flex-col gap-2 border-t border-terminal-border/50 p-2">
          {isLoading && <span className="text-[11px] text-terminal-muted">Loading…</span>}
          {error && <span className="text-[11px] text-terminal-neg">Failed to load notes.</span>}

          {!isLoading && !error && !data?.items?.length && (
            <span className="text-[11px] text-terminal-muted">No memory notes yet.</span>
          )}

          {data?.items?.map((n: NoteItem) => (
            <div key={n.id} className="flex items-start gap-2 rounded border border-terminal-border/60 bg-terminal-bg/40 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded border px-1 font-mono text-[8px] uppercase tracking-wide ${
                    n.kind === "thesis"
                      ? "border-terminal-accent/60 text-terminal-accent"
                      : n.kind === "reflection"
                        ? "border-terminal-muted/60 text-terminal-muted"
                        : "border-terminal-border text-terminal-muted"
                  }`}>
                    {n.kind}
                  </span>
                  <span className="font-mono text-[9px] text-terminal-muted">
                    {new Date(n.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-terminal-text">{n.content}</p>
              </div>
              <button
                onClick={() => void deleteMutation.mutate(n.id)}
                className="shrink-0 text-[10px] text-terminal-muted hover:text-terminal-neg"
                title="Delete note"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "note" | "thesis")}
              className="rounded border border-terminal-border bg-terminal-bg px-1.5 py-0.5 text-[11px] text-terminal-text"
            >
              <option value="note">note</option>
              <option value="thesis">thesis</option>
            </select>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write a note…"
              rows={2}
              className="resize-none rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] text-terminal-text placeholder:text-terminal-muted"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => { if (content.trim()) addMutation.mutate(content.trim()); }}
                disabled={!content.trim() || addMutation.isPending}
                className="rounded border border-terminal-accent/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-terminal-accent transition-colors hover:bg-terminal-accent/10 disabled:opacity-40"
              >
                {addMutation.isPending ? "…" : "Save"}
              </button>
              <button
                onClick={() => reflectionMutation.mutate()}
                disabled={reflectionMutation.isPending}
                className="rounded border border-terminal-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-terminal-muted transition-colors hover:text-terminal-text disabled:opacity-40"
              >
                {reflectionMutation.isPending ? "…" : "Run reflections"}
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}