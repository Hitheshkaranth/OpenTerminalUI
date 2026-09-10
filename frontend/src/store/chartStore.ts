import { create } from "zustand";

import type { ChartKind, ChartTimeframe } from "../shared/chart/types";

type ChartStoreState = {
  activeChartId: string | null;
  activeSymbol: string;
  activeTimeframe: ChartTimeframe;
  activeChartType: ChartKind;
  visibleIndicators: string[];
  hoveredCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
    time: number;
  } | null;
  selectedCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
    time: number;
  } | null;
  isFullscreen: boolean;
  showVolume: boolean;
  logarithmicScale: boolean;
  setActiveChart: (chartId: string | null) => void;
  setActiveSymbol: (symbol: string) => void;
  setActiveTimeframe: (tf: ChartTimeframe) => void;
  setActiveChartType: (type: ChartKind) => void;
  setVisibleIndicators: (ids: string[]) => void;
  setHoveredCandle: (candle: ChartStoreState["hoveredCandle"]) => void;
  setSelectedCandle: (candle: ChartStoreState["selectedCandle"]) => void;
  toggleFullscreen: () => void;
  setShowVolume: (show: boolean) => void;
  setLogarithmicScale: (log: boolean) => void;
  resetChart: () => void;
};

export const useChartStore = create<ChartStoreState>()((set, get) => ({
  activeChartId: null,
  activeSymbol: "NIFTY",
  activeTimeframe: "1D",
  activeChartType: "candle",
  visibleIndicators: [],
  hoveredCandle: null,
  selectedCandle: null,
  isFullscreen: false,
  showVolume: true,
  logarithmicScale: false,

  setActiveChart: (chartId) => set({ activeChartId: chartId }),
  setActiveSymbol: (symbol: string) => set({ activeSymbol: symbol.toUpperCase() }),
  setActiveTimeframe: (tf: ChartTimeframe) => set({ activeTimeframe: tf }),
  setActiveChartType: (type: ChartKind) => set({ activeChartType: type }),
  setVisibleIndicators: (ids: string[]) => set({ visibleIndicators: ids }),
  setHoveredCandle: (candle) => set({ hoveredCandle: candle }),
  setSelectedCandle: (candle) => set({ selectedCandle: candle }),
  toggleFullscreen: () => set((state) => ({ isFullscreen: !state.isFullscreen })),
  setShowVolume: (show: boolean) => set({ showVolume: show }),
  setLogarithmicScale: (log: boolean) => set({ logarithmicScale: log }),
  resetChart: () =>
    set({
      activeChartId: null,
      activeSymbol: "NIFTY",
      activeTimeframe: "1D",
      activeChartType: "candle",
      visibleIndicators: [],
      hoveredCandle: null,
      selectedCandle: null,
      isFullscreen: false,
    }),
}));