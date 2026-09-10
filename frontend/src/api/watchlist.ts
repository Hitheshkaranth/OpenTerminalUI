import { api } from "./base";
import type {
  Watchlist,
  WatchlistItem,
} from "../types";

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const { data } = await api.get<Watchlist[] | { watchlists?: Watchlist[] }>("/watchlists");
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as any).watchlists)) return (data as any).watchlists;
  return [];
}

export async function createWatchlist(name: string): Promise<Watchlist> {
  const { data } = await api.post<Watchlist>("/watchlists", { name });
  return data;
}

export async function updateWatchlist(id: string, payload: { name?: string; symbols?: string[]; column_config?: Record<string, unknown> }): Promise<Watchlist> {
  const { data } = await api.put<Watchlist>(`/watchlists/${id}`, payload);
  return data;
}

export async function deleteWatchlist(id: string): Promise<void> {
  await api.delete(`/watchlists/${id}`);
}

export async function addWatchlistSymbols(id: string, symbols: string[]): Promise<Watchlist> {
  const { data } = await api.post<Watchlist>(`/watchlists/${id}/symbols`, symbols);
  return data;
}

export async function removeWatchlistSymbol(id: string, symbol: string): Promise<Watchlist> {
  const { data } = await api.delete<Watchlist>(`/watchlists/${id}/symbols/${symbol}`);
  return data;
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const { data } = await api.get<{ items: WatchlistItem[] }>("/watchlist");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function addWatchlistItem(payload: { watchlist_name: string; ticker: string }): Promise<void> {
  await api.post("/watchlist/items", payload);
}

export async function deleteWatchlistItem(itemId: number): Promise<void> {
  await api.delete(`/watchlist/items/${itemId}`);
}
