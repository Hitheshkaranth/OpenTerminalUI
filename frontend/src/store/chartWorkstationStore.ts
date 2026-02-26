import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { IndicatorConfig } from "../shared/chart/types";

// Simple ID generator (avoids uuid dependency)
function makeId(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

export type ChartSlotTimeframe = "1m" | "5m" | "15m" | "1h" | "1D" | "1W" | "1M";
export type ChartSlotType = "candle" | "line" | "area";
export type SlotMarket = "IN" | "US";

export interface ExtendedHoursConfig {
  enabled: boolean;
  showPreMarket: boolean;
  showAfterHours: boolean;
  visualMode: "merged" | "separated" | "overlay";
  colorScheme: "dimmed" | "distinct" | "same";
}

export interface PreMarketLevelConfig {
  showPMHigh: boolean;
  showPMLow: boolean;
  showPMOpen: boolean;
  showPMVWAP: boolean;
  extendIntoRTH: boolean;
  daysToShow: number;
}

export interface ChartSlot {
  id: string;
  ticker: string | null;
  market: SlotMarket;
  timeframe: ChartSlotTimeframe;
  chartType: ChartSlotType;
  indicators: IndicatorConfig[];
  extendedHours: ExtendedHoursConfig;
  preMarketLevels: PreMarketLevelConfig;
}

export interface GridTemplate {
  cols: number;
  rows: number;
  arrangement: "grid" | "custom";
  customAreas?: string;
}

interface ChartWorkstationState {
  slots: ChartSlot[];
  activeSlotId: string | null;
  gridTemplate: GridTemplate;
  syncCrosshair: boolean;
  syncTimeframe: boolean;
  addSlot: () => void;
  removeSlot: (id: string) => void;
  updateSlotTicker: (id: string, ticker: string, market: SlotMarket) => void;
  updateSlotTimeframe: (id: string, tf: ChartSlotTimeframe) => void;
  updateSlotType: (id: string, type: ChartSlotType) => void;
  updateSlotETH: (id: string, eth: Partial<ExtendedHoursConfig>) => void;
  updateSlotPMLevels: (id: string, levels: Partial<PreMarketLevelConfig>) => void;
  updateSlotIndicators: (id: string, indicators: IndicatorConfig[]) => void;
  setActiveSlot: (id: string | null) => void;
  setGridTemplate: (t: GridTemplate) => void;
  setSyncCrosshair: (v: boolean) => void;
  setSyncTimeframe: (v: boolean) => void;
}

const DEFAULT_ETH: ExtendedHoursConfig = {
  enabled: false,
  showPreMarket: true,
  showAfterHours: true,
  visualMode: "merged",
  colorScheme: "dimmed",
};

const DEFAULT_PM_LEVELS: PreMarketLevelConfig = {
  showPMHigh: true,
  showPMLow: true,
  showPMOpen: false,
  showPMVWAP: false,
  extendIntoRTH: true,
  daysToShow: 1,
};

function makeSlot(): ChartSlot {
  return {
    id: makeId(),
    ticker: null,
    market: "IN",
    timeframe: "1D",
    chartType: "candle",
    indicators: [],
    extendedHours: { ...DEFAULT_ETH },
    preMarketLevels: { ...DEFAULT_PM_LEVELS },
  };
}

function normalizeIndicators(input: unknown): IndicatorConfig[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row) return null;
      if (typeof row === "string") {
        return { id: row, params: {}, visible: true } satisfies IndicatorConfig;
      }
      if (typeof row !== "object") return null;
      const r = row as Partial<IndicatorConfig> & Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      if (!id) return null;
      return {
        id,
        params: r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {},
        visible: typeof r.visible === "boolean" ? r.visible : true,
        color: typeof r.color === "string" ? r.color : undefined,
        lineWidth: typeof r.lineWidth === "number" ? r.lineWidth : undefined,
      } satisfies IndicatorConfig;
    })
    .filter((row): row is IndicatorConfig => Boolean(row));
}

function normalizeSlot(slot: Partial<ChartSlot> | undefined): ChartSlot {
  const base = makeSlot();
  return {
    ...base,
    ...(slot ?? {}),
    id: typeof slot?.id === "string" && slot.id ? slot.id : base.id,
    ticker: typeof slot?.ticker === "string" && slot.ticker ? slot.ticker : null,
    market: slot?.market === "US" ? "US" : "IN",
    timeframe: (slot?.timeframe as ChartSlotTimeframe) ?? "1D",
    chartType: (slot?.chartType as ChartSlotType) ?? "candle",
    indicators: normalizeIndicators((slot as any)?.indicators),
    extendedHours: { ...DEFAULT_ETH, ...(slot?.extendedHours ?? {}) },
    preMarketLevels: { ...DEFAULT_PM_LEVELS, ...(slot?.preMarketLevels ?? {}) },
  };
}

export const useChartWorkstationStore = create<ChartWorkstationState>()(
  persist(
    (set) => ({
      slots: [makeSlot()],
      activeSlotId: null,
      gridTemplate: { cols: 1, rows: 1, arrangement: "grid" },
      syncCrosshair: true,
      syncTimeframe: false,

      addSlot: () =>
        set((s) => {
          if (s.slots.length >= 6) return s;
          const next = makeSlot();
          return { slots: [...s.slots, next], activeSlotId: next.id };
        }),

      removeSlot: (id) =>
        set((s) => {
          if (s.slots.length <= 1) return s;
          const slots = s.slots.filter((sl) => sl.id !== id);
          const activeSlotId =
            s.activeSlotId === id ? (slots[0]?.id ?? null) : s.activeSlotId;
          return { slots, activeSlotId };
        }),

      updateSlotTicker: (id, ticker, market) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, ticker, market, extendedHours: { ...sl.extendedHours, enabled: market === "US" } } : sl,
          ),
        })),

      updateSlotTimeframe: (id, tf) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, timeframe: tf } : sl,
          ),
        })),

      updateSlotType: (id, type) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, chartType: type } : sl,
          ),
        })),

      updateSlotETH: (id, eth) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, extendedHours: { ...sl.extendedHours, ...eth } } : sl,
          ),
        })),

      updateSlotPMLevels: (id, levels) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, preMarketLevels: { ...sl.preMarketLevels, ...levels } } : sl,
          ),
        })),

      updateSlotIndicators: (id, indicators) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, indicators: normalizeIndicators(indicators) } : sl,
          ),
        })),

      setActiveSlot: (id) => set({ activeSlotId: id }),

      setGridTemplate: (t) => set({ gridTemplate: t }),

      setSyncCrosshair: (v) => set({ syncCrosshair: v }),

      setSyncTimeframe: (v) => set({ syncTimeframe: v }),
    }),
    {
      name: "ot_chart_workstation",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        slots: s.slots,
        gridTemplate: s.gridTemplate,
        syncCrosshair: s.syncCrosshair,
        syncTimeframe: s.syncTimeframe,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<ChartWorkstationState>) ?? {};
        const current = currentState as ChartWorkstationState;
        return {
          ...current,
          ...persisted,
          slots: Array.isArray(persisted.slots) && persisted.slots.length
            ? persisted.slots.map((slot) => normalizeSlot(slot))
            : current.slots,
          gridTemplate: persisted.gridTemplate
            ? { ...current.gridTemplate, ...persisted.gridTemplate }
            : current.gridTemplate,
        };
      },
    },
  ),
);
