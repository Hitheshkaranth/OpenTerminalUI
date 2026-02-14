import { create } from "zustand";

import { fetchChart, fetchStock } from "../api/client";
import { useSettingsStore } from "./settingsStore";
import type { ChartResponse, StockSnapshot } from "../types";

type StockState = {
  ticker: string;
  interval: string;
  range: string;
  stock: StockSnapshot | null;
  chart: ChartResponse | null;
  loading: boolean;
  error: string | null;
  setTicker: (ticker: string) => void;
  setInterval: (interval: string) => void;
  setRange: (range: string) => void;
  load: () => Promise<void>;
};

export const useStockStore = create<StockState>((set, get) => ({
  ticker: "RELIANCE",
  interval: "1d",
  range: "1y",
  stock: null,
  chart: null,
  loading: false,
  error: null,
  setTicker: (ticker) => set({ ticker: ticker.toUpperCase() }),
  setInterval: (interval) => set({ interval }),
  setRange: (range) => set({ range }),
  load: async () => {
    const { ticker, interval, range } = get();
    const market = useSettingsStore.getState().selectedMarket;
    set({ loading: true, error: null });
    try {
      const [stockResult, chartResult] = await Promise.allSettled([
        fetchStock(ticker, market),
        fetchChart(ticker, interval, range, market),
      ]);
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
      const message = error instanceof Error ? error.message : "Failed to load stock data";
      set({ error: message, loading: false });
    }
  },
}));
