import { create } from "zustand";

import type { SearchSymbolItem } from "../api/client";

export type ScreenerFilter = {
  key: string;
  operator: "gte" | "lte" | "eq" | "ne" | "contains" | "gt" | "lt";
  value: string | number;
};

export type ScreenerColumn = {
  key: string;
  label: string;
  sortable: boolean;
  format?: "currency" | "percent" | "number" | "raw";
};

type ScreenerStoreState = {
  query: string;
  filters: ScreenerFilter[];
  columns: ScreenerColumn[];
  sortKey: string;
  sortDir: "asc" | "desc";
  results: SearchSymbolItem[];
  isLoading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  totalResults: number;
  lastFetchedAt: number | null;
  setQuery: (q: string) => void;
  setFilters: (filters: ScreenerFilter[]) => void;
  addFilter: (filter: ScreenerFilter) => void;
  removeFilter: (key: string) => void;
  setColumns: (cols: ScreenerColumn[]) => void;
  setSort: (key: string, dir: "asc" | "desc") => void;
  setResults: (results: SearchSymbolItem[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setTotalResults: (total: number) => void;
  runQuery: (market?: string) => Promise<void>;
  reset: () => void;
};

export const useScreenerStore = create<ScreenerStoreState>()((set, get) => ({
  query: "",
  filters: [],
  columns: [
    { key: "ticker", label: "Symbol", sortable: true, format: "raw" },
    { key: "name", label: "Name", sortable: true, format: "raw" },
    { key: "current_price", label: "Price", sortable: true, format: "currency" },
    { key: "change_pct", label: "Change %", sortable: true, format: "percent" },
    { key: "volume", label: "Volume", sortable: true, format: "number" },
  ],
  sortKey: "volume",
  sortDir: "desc",
  results: [],
  isLoading: false,
  error: null,
  page: 0,
  pageSize: 50,
  totalResults: 0,
  lastFetchedAt: null,

  setQuery: (q) => set({ query: q }),
  setFilters: (filters) => set({ filters }),
  addFilter: (filter) => set((state) => ({ filters: [...state.filters, filter] })),
  removeFilter: (key) => set((state) => ({ filters: state.filters.filter((f) => f.key !== key) })),
  setColumns: (cols) => set({ columns: cols }),
  setSort: (key, dir) => set({ sortKey: key, sortDir: dir }),
  setResults: (results) => set({ results }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize }),
  setTotalResults: (total) => set({ totalResults: total }),

  runQuery: async (market?: string) => {
    set({ isLoading: true, error: null });
    try {
      // eslint-disable-next-line no-undef
      const res = await fetch(
        `/api/screener?q=${encodeURIComponent(get().query)}&market=${encodeURIComponent(market || "")}&page=${get().page}&limit=${get().pageSize}`,
      );
      if (!res.ok) throw new Error(`Screener request failed: ${res.status}`);
      const data = await res.json();
      set({
        results: data.results ?? [],
        totalResults: data.total ?? 0,
        isLoading: false,
        lastFetchedAt: Date.now(),
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to run screener query",
        isLoading: false,
      });
    }
  },

  reset: () =>
    set({
      query: "",
      filters: [],
      sortKey: "volume",
      sortDir: "desc",
      results: [],
      isLoading: false,
      error: null,
      page: 0,
      totalResults: 0,
      lastFetchedAt: null,
    }),
}));