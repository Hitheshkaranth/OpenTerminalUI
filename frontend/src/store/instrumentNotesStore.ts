import { useEffect, useState, useSyncExternalStore } from "react";

export const REVIEW_STATUSES = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "watching", label: "Watching" },
  { value: "researching", label: "Researching" },
  { value: "ready", label: "Ready for review" },
  { value: "archived", label: "Archived" },
] as const;
export type InstrumentReviewStatus = typeof REVIEW_STATUSES[number]["value"];
export const REVIEW_STATUS_EVENT = "ot:instrument-review-status-changed";
export const MAX_INSTRUMENT_NOTE_CHARS = 2000;
const MAX_DRAFTS = 50;
const MAX_STATUS_BYTES = 1024;
export type InstrumentReviewState = { status: InstrumentReviewStatus; updatedAt: string | null; error: string | null };

export function normalizeReviewSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9^=:.!/_-]{0,63}$/.test(symbol) ? symbol : null;
}

export function instrumentReviewStorageKey(accountId: string | undefined, symbol: string): string | null {
  const normalized = normalizeReviewSymbol(symbol);
  if (!accountId || accountId.length > 256 || /[\u0000-\u001f\u007f]/.test(accountId) || !normalized) return null;
  return `ot:instrument-review:v1:${encodeURIComponent(accountId)}:${encodeURIComponent(normalized)}`;
}

function emptyState(error: string | null = null): InstrumentReviewState {
  return { status: "unreviewed", updatedAt: null, error };
}

export function readInstrumentReviewStatus(accountId: string | undefined, symbol: string): InstrumentReviewState {
  const key = instrumentReviewStorageKey(accountId, symbol);
  if (!key) return emptyState("Sign in and choose a valid instrument to save review status.");
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyState();
    if (raw.length > MAX_STATUS_BYTES) return emptyState("The saved review status is unreadable. Save a status to replace it.");
    const row: unknown = JSON.parse(raw);
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
    const value = row as Record<string, unknown>;
    if (value.version !== 1 || !REVIEW_STATUSES.some((item) => item.value === value.status)
      || typeof value.updatedAt !== "string" || value.updatedAt.length > 40 || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error();
    return { status: value.status as InstrumentReviewStatus, updatedAt: value.updatedAt, error: null };
  } catch {
    return emptyState("The saved review status could not be read. Your server notes are unaffected. Save a status to retry.");
  }
}

export function saveInstrumentReviewStatus(accountId: string | undefined, symbol: string, status: InstrumentReviewStatus): InstrumentReviewState {
  const key = instrumentReviewStorageKey(accountId, symbol);
  if (!key || !REVIEW_STATUSES.some((item) => item.value === status)) return emptyState("Choose a valid account, instrument and review status.");
  const updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, status, updatedAt }));
    window.dispatchEvent(new CustomEvent(REVIEW_STATUS_EVENT, { detail: { accountId, symbol: normalizeReviewSymbol(symbol) } }));
    return { status, updatedAt, error: null };
  } catch {
    return { status, updatedAt: null, error: "Review status could not be saved in this browser. Retry after checking browser storage." };
  }
}

export function useInstrumentReviewStatuses(accountId: string | undefined, symbols: readonly string[]): Record<string, InstrumentReviewStatus> {
  const context = JSON.stringify([accountId, symbols]);
  const read = () => Object.fromEntries(symbols.map((symbol) => [symbol, readInstrumentReviewStatus(accountId, symbol).status]));
  const [snapshot, setSnapshot] = useState(() => ({ context, values: read() }));
  useEffect(() => {
    const refresh = () => setSnapshot({ context, values: read() });
    refresh();
    window.addEventListener(REVIEW_STATUS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(REVIEW_STATUS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [context]);
  // Never expose the prior account's status for the render before the effect runs.
  return snapshot.context === context ? snapshot.values : read();
}

export type InstrumentNoteDraft = { content: string; kind: "note" | "thesis" };
const EMPTY_DRAFT: InstrumentNoteDraft = { content: "", kind: "note" };
const drafts = new Map<string, InstrumentNoteDraft>();
const draftListeners = new Set<() => void>();
const notifyDrafts = () => draftListeners.forEach((listener) => listener());

export function writeInstrumentNoteDraft(accountId: string | undefined, symbol: string, draft: InstrumentNoteDraft): string | null {
  const key = instrumentReviewStorageKey(accountId, symbol);
  if (!key || !["note", "thesis"].includes(draft.kind)) return "Choose a valid account and instrument before writing a note.";
  if (draft.content.length > MAX_INSTRUMENT_NOTE_CHARS) return `Use ${MAX_INSTRUMENT_NOTE_CHARS.toLocaleString()} characters or fewer.`;
  if (!draft.content) {
    drafts.delete(key);
  } else {
    if (!drafts.has(key) && drafts.size >= MAX_DRAFTS) return "You have 50 unsaved instrument drafts. Save or discard one before starting another.";
    drafts.set(key, { ...draft });
  }
  notifyDrafts();
  return null;
}

export function discardInstrumentNoteDraft(accountId: string | undefined, symbol: string, expected?: InstrumentNoteDraft): void {
  const key = instrumentReviewStorageKey(accountId, symbol);
  if (!key) return;
  const current = drafts.get(key);
  if (expected && (!current || current.content !== expected.content || current.kind !== expected.kind)) return;
  drafts.delete(key);
  notifyDrafts();
}

export function useInstrumentNoteDraft(accountId: string | undefined, symbol: string): InstrumentNoteDraft {
  const key = instrumentReviewStorageKey(accountId, symbol);
  return useSyncExternalStore(
    (listener) => { draftListeners.add(listener); return () => { draftListeners.delete(listener); }; },
    () => (key ? drafts.get(key) : undefined) ?? EMPTY_DRAFT,
    () => EMPTY_DRAFT,
  );
}
