import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addNote, deleteNote, listNotes } from "../../api/agentExtras";
import { useAuth } from "../../contexts/AuthContext";
import {
  discardInstrumentNoteDraft, MAX_INSTRUMENT_NOTE_CHARS, normalizeReviewSymbol,
  readInstrumentReviewStatus, REVIEW_STATUSES, saveInstrumentReviewStatus,
  useInstrumentNoteDraft, writeInstrumentNoteDraft,
  type InstrumentNoteDraft, type InstrumentReviewStatus,
} from "../../store/instrumentNotesStore";

const fieldClass = "w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent";

export function InstrumentNotesPanel({ symbol }: { symbol: string }) {
  const { user } = useAuth();
  const normalized = normalizeReviewSymbol(symbol);
  if (!user?.id) return <p className="text-xs text-terminal-muted">Sign in to save instrument notes and review status.</p>;
  if (!normalized) return <p className="text-xs text-terminal-muted">Choose a valid instrument to review.</p>;
  return <InstrumentNotesEditor key={`${user.id}:${normalized}`} accountId={user.id} symbol={normalized} />;
}

function InstrumentNotesEditor({ accountId, symbol }: { accountId: string; symbol: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const queryKey = ["agent", "notes", accountId, symbol];
  const requestScope = useRef(new AbortController());
  useEffect(() => {
    if (requestScope.current.signal.aborted) requestScope.current = new AbortController();
    const controller = requestScope.current;
    return () => controller.abort();
  }, []);
  const notes = useQuery({ queryKey, queryFn: ({ signal }) => listNotes(symbol, { signal }), enabled: Boolean(accountId), staleTime: 15_000, retry: 1 });
  const [storedStatus, setStoredStatus] = useState(() => readInstrumentReviewStatus(accountId, symbol));
  const [status, setStatus] = useState<InstrumentReviewStatus>(storedStatus.status);
  const [statusMessage, setStatusMessage] = useState("");
  const draft = useInstrumentNoteDraft(accountId, symbol);
  const [kind, setKind] = useState<InstrumentNoteDraft["kind"]>(draft.kind);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [noteMessage, setNoteMessage] = useState("");
  const save = useMutation({
    mutationFn: (submitted: InstrumentNoteDraft) => {
      if (requestScope.current.signal.aborted) throw new Error("Instrument context changed before the note was saved.");
      return addNote({ symbol, kind: submitted.kind, content: submitted.content.trim() }, { signal: requestScope.current.signal });
    },
    onSuccess: (_note, submitted) => {
      discardInstrumentNoteDraft(accountId, symbol, submitted);
      setNoteMessage("Note saved to your account.");
      void queryClient.invalidateQueries({ queryKey: ["agent", "notes", accountId] });
    },
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => {
      if (requestScope.current.signal.aborted) throw new Error("Instrument context changed before deletion.");
      return deleteNote(noteId, { signal: requestScope.current.signal });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["agent", "notes", accountId] }); },
  });
  const updateDraft = (next: InstrumentNoteDraft) => {
    setDraftError(writeInstrumentNoteDraft(accountId, symbol, next));
    setNoteMessage("");
    save.reset();
  };
  const scopedNotes = (notes.data?.items || []).filter((note) => note.symbol?.toUpperCase() === symbol).slice(0, 20);
  return <section aria-label={`${symbol} research notes`} className="space-y-4 border-t border-terminal-border pt-3">
    <div>
      <h3 className="text-sm font-semibold text-terminal-text">Review notes</h3>
      <p className="mt-1 text-xs text-terminal-muted">Notes save to your account. Review status stays in this browser for your account.</p>
    </div>
    <div className="space-y-2">
      <label htmlFor={`${id}-status`} className="block text-xs text-terminal-text">Review status</label>
      <div className="flex gap-2">
        <select id={`${id}-status`} value={status} className={fieldClass} onChange={(event) => { setStatus(event.target.value as InstrumentReviewStatus); setStatusMessage(""); }}>
          {REVIEW_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button type="button" className="shrink-0 rounded-sm border border-terminal-border px-2 text-xs text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent" onClick={() => {
          const result = saveInstrumentReviewStatus(accountId, symbol, status);
          setStoredStatus(result);
          setStatusMessage(result.error ? "" : "Review status saved in this browser.");
        }}>Save status</button>
      </div>
      {storedStatus.error && <p role="alert" className="text-xs text-terminal-neg">{storedStatus.error}</p>}
      {statusMessage && <p role="status" className="text-xs text-terminal-text">{statusMessage}</p>}
      {status !== storedStatus.status && <p className="text-xs text-terminal-muted">Unsaved status</p>}
    </div>
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (draft.content.trim() && !save.isPending) { setNoteMessage(""); save.mutate({ ...draft, kind }); } }}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-note`} className="text-xs text-terminal-text">Note for {symbol}</label>
        <select aria-label="Note type" className="rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent" value={kind} disabled={save.isPending} onChange={(event) => {
          const nextKind = event.target.value as InstrumentNoteDraft["kind"];
          setKind(nextKind);
          if (draft.content) updateDraft({ ...draft, kind: nextKind });
        }}>
          <option value="note">Note</option><option value="thesis">Thesis</option>
        </select>
      </div>
      <textarea id={`${id}-note`} rows={3} maxLength={MAX_INSTRUMENT_NOTE_CHARS} value={draft.content} disabled={save.isPending} className={`${fieldClass} resize-y`} placeholder="What deserves a closer look?" onChange={(event) => updateDraft({ kind, content: event.target.value })} aria-describedby={`${id}-draft-hint`} />
      <p id={`${id}-draft-hint`} className="text-xs text-terminal-muted">{draft.content ? "Unsaved draft stays in this tab when you switch instruments." : "Drafts are not saved until you choose Save note."} {draft.content.length}/{MAX_INSTRUMENT_NOTE_CHARS}</p>
      {draftError && <p role="alert" className="text-xs text-terminal-neg">{draftError}</p>}
      {save.isError && <p role="alert" className="text-xs text-terminal-neg">Note could not be saved. Your draft is retained; try again.</p>}
      {noteMessage && <p role="status" className="text-xs text-terminal-text">{noteMessage}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!draft.content.trim() || save.isPending} className="rounded-sm border border-terminal-accent px-3 py-1.5 text-xs text-terminal-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-terminal-accent">{save.isPending ? "Saving note…" : "Save note"}</button>
        {draft.content && <button type="button" disabled={save.isPending} className="px-2 text-xs text-terminal-muted focus-visible:outline focus-visible:outline-terminal-accent" onClick={() => { discardInstrumentNoteDraft(accountId, symbol); setDraftError(null); }}>Discard draft</button>}
      </div>
    </form>
    <div className="space-y-2" aria-label={`Saved ${symbol} notes`}>
      {notes.isPending ? <p role="status" className="text-xs text-terminal-muted">Loading saved notes…</p> : notes.isError ? <div><p role="alert" className="text-xs text-terminal-neg">Saved notes are unavailable. Your draft is retained.</p><button type="button" className="mt-1 text-xs text-terminal-accent" onClick={() => void notes.refetch()}>Retry notes</button></div> : !scopedNotes.length ? <p className="text-xs text-terminal-muted">No saved notes for {symbol}.</p> : <ul className="space-y-2">{scopedNotes.map((note) => <li key={note.id} className="border-b border-terminal-border pb-2">
        <div className="flex items-start justify-between gap-2"><span className="text-xs text-terminal-muted">{note.kind} · {new Date(note.created_at).toLocaleDateString()}</span>{note.kind !== "reflection" && <button type="button" disabled={remove.isPending} className="text-xs text-terminal-muted hover:text-terminal-neg focus-visible:outline focus-visible:outline-terminal-accent" aria-label={`Delete ${symbol} note ${note.id}`} onClick={() => remove.mutate(note.id)}>Delete</button>}</div>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-terminal-text">{note.content.slice(0, MAX_INSTRUMENT_NOTE_CHARS)}</p>
        {note.content.length > MAX_INSTRUMENT_NOTE_CHARS && <p className="text-xs text-terminal-muted">Showing the first 2,000 characters.</p>}
      </li>)}</ul>}
      {remove.isError && <p role="alert" className="text-xs text-terminal-neg">Note could not be deleted. Try again.</p>}
    </div>
  </section>;
}
