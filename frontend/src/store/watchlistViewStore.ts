import { useCallback, useEffect, useMemo, useState } from "react";

export type WatchlistView = {
  preset: "price" | "liquidity" | "custom";
  columns: { last: boolean; change: boolean; volume: boolean };
  density: "compact" | "comfortable";
};

export type WatchlistViewUpdate = Partial<Omit<WatchlistView, "columns">> & {
  columns?: Partial<WatchlistView["columns"]>;
};

type StoredView = { key: string | null; view: WatchlistView; error: string | null };
const STORAGE_PREFIX = "ot:watchlist:view:v1:";
const MAX_STORAGE_CHARS = 4096;
const DEFAULT_COLUMNS = { last: true, change: true, volume: true };
const PRICE_COLUMNS = { last: true, change: true, volume: false };

export function defaultWatchlistView(): WatchlistView {
  return { preset: "liquidity", columns: { ...DEFAULT_COLUMNS }, density: "compact" };
}

export function watchlistViewStorageKey(accountId?: string | null): string | null {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 256) return null;
  try { return STORAGE_PREFIX + encodeURIComponent(accountId); }
  catch { return null; }
}

function presetFor(columns: WatchlistView["columns"]): WatchlistView["preset"] {
  if (columns.last && columns.change) return columns.volume ? "liquidity" : "price";
  return "custom";
}

function parseView(raw: string): WatchlistView {
  if (raw.length > MAX_STORAGE_CHARS) throw new Error("oversized view");
  const payload: unknown = JSON.parse(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid view");
  const { version, view } = payload as { version?: unknown; view?: unknown };
  if (version !== 1 || !view || typeof view !== "object" || Array.isArray(view)) throw new Error("invalid version");
  const { columns, density } = view as { columns?: unknown; density?: unknown };
  if (!columns || typeof columns !== "object" || Array.isArray(columns) || (density !== "compact" && density !== "comfortable")) throw new Error("invalid display settings");
  const saved = columns as Record<string, unknown>;
  if (![saved.last, saved.change, saved.volume].every((value) => typeof value === "boolean")) throw new Error("invalid columns");
  const safeColumns = { last: saved.last as boolean, change: saved.change as boolean, volume: saved.volume as boolean };
  return { preset: presetFor(safeColumns), columns: safeColumns, density };
}

function readView(key: string | null): StoredView {
  const fallback = { key, view: defaultWatchlistView(), error: null };
  if (!key || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    try {
      return { key, view: parseView(raw), error: null };
    } catch {
      return { ...fallback, error: "Saved table settings could not be read. Defaults are shown; changing a setting will replace the unreadable settings." };
    }
  } catch {
    return { ...fallback, error: "Browser storage is unavailable. Table settings will last for this visit only." };
  }
}

export function useWatchlistView(accountId?: string | null) {
  const key = watchlistViewStorageKey(accountId);
  const initial = useMemo(() => readView(key), [key]);
  const [state, setState] = useState<StoredView>(initial);
  // An account switch must never expose the previous account's preferences,
  // including the render before the account-change effect runs.
  const current = state.key === key ? state : initial;

  useEffect(() => { setState(initial); }, [initial]);
  useEffect(() => {
    if (!key) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setState(readView(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const updateView = useCallback((patch: WatchlistViewUpdate) => {
    const columns = patch.preset === "price" ? { ...PRICE_COLUMNS } : patch.preset === "liquidity" ? { ...DEFAULT_COLUMNS } : { ...current.view.columns };
    if (patch.columns) {
      for (const name of ["last", "change", "volume"] as const) {
        if (typeof patch.columns[name] === "boolean") columns[name] = patch.columns[name];
      }
    }
    const density = patch.density === "compact" || patch.density === "comfortable" ? patch.density : current.view.density;
    const view: WatchlistView = { columns, density, preset: presetFor(columns) };
    let error: string | null = null;
    if (key) {
      try { window.localStorage.setItem(key, JSON.stringify({ version: 1, view })); }
      catch { error = "Browser storage is unavailable. Your table changes work for this visit but could not be saved."; }
    }
    setState({ key, view, error });
  }, [current.view, key]);

  const resetView = useCallback(() => updateView(defaultWatchlistView()), [updateView]);
  return { view: current.view, updateView, resetView, storageError: current.error };
}
