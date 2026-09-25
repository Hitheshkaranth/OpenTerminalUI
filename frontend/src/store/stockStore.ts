import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { fetchChart, fetchStock } from "../api/client";
import { useSettingsStore } from "./settingsStore";
import type { ChartResponse, StockSnapshot } from "../types";
import { normalizeTicker } from "../utils/ticker";
import { parseInstrument, isExchange, type Exchange, type Instrument } from "../lib/instrument";

let loadSeq = 0;

type StockState = {
  ticker: string;
  exchange: Exchange | null;
  interval: string;
  range: string;
  stock: StockSnapshot | null;
  chart: ChartResponse | null;
  loading: boolean;
  error: string | null;
  setTicker: (ticker: string) => void;
  setInstrument: (i: Instrument) => void;
  setInterval: (interval: string) => void;
  setRange: (range: string) => void;
  load: () => Promise<void>;
};

export const useStockStore = create<StockState>()(
  persist(
    (set, get) => ({
      ticker: "RELIANCE",
      exchange: null,
      interval: "1d",
      range: "1y",
      stock: null,
      chart: null,
      loading: false,
      error: null,
      setInstrument: (i) => {
        const parsed = parseInstrument(i.symbol);
        const nextExchange = parsed.exchange ?? i.exchange;
        set({
          ticker: normalizeTicker(parsed.symbol),
          exchange: nextExchange,
        });
      },
      setTicker: (ticker) => {
        const parsed = parseInstrument(ticker);
        const bareTicker = normalizeTicker(parsed.symbol);
        if (parsed.exchange) {
          set({ ticker: bareTicker, exchange: parsed.exchange });
        } else {
          set({ ticker: bareTicker });
        }
      },
      setInterval: (interval) => set({ interval }),
      setRange: (range) => set({ range }),
      load: async () => {
        const seq = ++loadSeq;
        const { ticker, interval, range } = get();
        const normalizedTicker = normalizeTicker(ticker);
        const market = useSettingsStore.getState().selectedMarket;
        set({ loading: true, error: null });
        try {
          const [stockResult, chartResult] = await Promise.allSettled([
            fetchStock(normalizedTicker, market),
            fetchChart(normalizedTicker, interval, range, market),
          ]);
          // A newer load() superseded this one; drop the stale result so it can't overwrite fresher data.
          if (seq !== loadSeq) return;
          const nextStock = stockResult.status === "fulfilled" ? stockResult.value : get().stock;
          const nextChart = chartResult.status === "fulfilled" ? chartResult.value : get().chart;
          const errors: string[] = [];
          // Stock-profile fetch can fail intermittently for some symbols; keep chart usable.
          if (chartResult.status === "rejected") {
            errors.push("Chart request failed");
          }
          set({
            stock: nextStock,
            chart: nextChart,
            error: errors.length > 0 ? errors.join(" | ") : null,
            loading: false,
          });
        } catch (error) {
          if (seq !== loadSeq) return;
          const message = error instanceof Error ? error.message : "Failed to load stock data";
          set({ error: message, loading: false });
        }
      },
    }),
    {
      name: "stock-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        ticker: state.ticker,
        exchange: state.exchange,
        interval: state.interval,
        range: state.range,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<Pick<StockState, "ticker" | "exchange" | "interval" | "range">>) ?? {};
        const current = currentState as StockState;
        const exchange: Exchange | null = isExchange(persisted.exchange) ? persisted.exchange : current.exchange;
        return {
          ...current,
          ticker: typeof persisted.ticker === "string" ? persisted.ticker : current.ticker,
          exchange,
          interval: typeof persisted.interval === "string" ? persisted.interval : current.interval,
          range: typeof persisted.range === "string" ? persisted.range : current.range,
        };
      },
    },
  ),
);
