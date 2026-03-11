import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { CrosshairSyncProvider } from "../contexts/CrosshairSyncContext";
import { createChartTemplate, listChartTemplates } from "../api/client";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";
import { ChartGridContainer } from "../components/chart-workstation/ChartGridContainer";
import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import { AddChartPlaceholder } from "../components/chart-workstation/AddChartPlaceholder";
import { LayoutSelector } from "../components/chart-workstation/LayoutSelector";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalToast, TerminalToastViewport } from "../components/terminal/TerminalToast";
import { TerminalTooltip } from "../components/terminal/TerminalTooltip";
import { useBatchChartData } from "../hooks/useBatchChartData";
import { useWorkstationQuotes } from "../hooks/useWorkstationQuotes";
import type { ChartSlot, ChartSlotTimeframe, ChartSlotType, SlotMarket } from "../store/chartWorkstationStore";
import type { IndicatorConfig } from "../shared/chart/types";
import { shouldDefaultExtendedHoursOn } from "../shared/chart/candlePresentation";
import { fetchChartData } from "../services/chartDataService";
import type { ChartPoint } from "../types";
import { useStockStore } from "../store/stockStore";
import "../components/chart-workstation/ChartWorkstation.css";

const MAX_WORKSTATION_SLOTS = 9;
const MAX_COMPARE_SYMBOLS = 3;
const WORKSPACE_TABS_KEY = "ot:chart-workstation:tabs:v1";
const COMPARE_PALETTE = ["#FFB000", "#4EA1FF", "#7CFFB2"] as const;
const TIMEFRAME_HOTKEY_MAP: Record<string, ChartSlotTimeframe> = {
  "1": "1m",
  "2": "5m",
  "3": "15m",
  "4": "1h",
  "5": "1D",
  "6": "1W",
  "7": "1M",
};
export const CUSTOM_SPLIT_TEMPLATE = {
  cols: 3,
  rows: 2,
  arrangement: "custom" as const,
  customAreas: `"a a b" "c d b"`,
};

export type WorkspaceLinkGroup = "off" | "A" | "B" | "C";

type WorkspaceSnapshot = {
  slots: ChartSlot[];
  gridTemplate: {
    cols: number;
    rows: number;
    arrangement: "grid" | "custom";
    customAreas?: string;
  };
  syncCrosshair: boolean;
};

type WorkspaceTab = {
  id: string;
  name: string;
  snapshot: WorkspaceSnapshot;
  linkGroups: Record<string, WorkspaceLinkGroup>;
  compareSymbols: string[];
};

type WorkspaceTemplate = {
  id: string;
  name: string;
  layout_config: Record<string, unknown>;
};

type ParsedWorkspaceTemplate = {
  snapshot: WorkspaceSnapshot;
  linkGroups: Record<string, WorkspaceLinkGroup>;
  compareSymbols: string[];
};

const DEFAULT_EXTENDED_HOURS = {
  enabled: false,
  showPreMarket: true,
  showAfterHours: true,
  visualMode: "merged" as const,
  colorScheme: "dimmed" as const,
};

const DEFAULT_PREMARKET_LEVELS = {
  showPMHigh: true,
  showPMLow: true,
  showPMOpen: false,
  showPMVWAP: false,
  extendIntoRTH: true,
  daysToShow: 1,
};

const TIMEFRAME_TO_INTERVAL: Record<ChartSlotTimeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "1D": "1d",
  "1W": "1wk",
  "1M": "1mo",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimeframe(value: unknown): value is ChartSlotTimeframe {
  return value === "1m" || value === "5m" || value === "15m" || value === "1h" || value === "1D" || value === "1W" || value === "1M";
}

function isChartType(value: unknown): value is ChartSlotType {
  return value === "candle" || value === "line" || value === "area";
}

function inferGridTemplate(slotCount: number): WorkspaceSnapshot["gridTemplate"] {
  if (slotCount >= 5) return { cols: 3, rows: 2, arrangement: "grid" };
  if (slotCount === 4) return { cols: 2, rows: 2, arrangement: "grid" };
  if (slotCount === 3) return { cols: 2, rows: 2, arrangement: "grid" };
  if (slotCount === 2) return { cols: 2, rows: 1, arrangement: "grid" };
  return { cols: 1, rows: 1, arrangement: "grid" };
}

function buildTemplateSlot(slot: Partial<ChartSlot> | null | undefined): ChartSlot {
  const market = slot?.market === "US" ? "US" : "IN";
  return {
    id: typeof slot?.id === "string" && slot.id ? slot.id : createSlotId(),
    ticker: typeof slot?.ticker === "string" && slot.ticker.trim() ? slot.ticker.trim().toUpperCase() : null,
    companyName: typeof slot?.companyName === "string" && slot.companyName.trim() ? slot.companyName.trim() : null,
    market,
    timeframe: isTimeframe(slot?.timeframe) ? slot.timeframe : "1D",
    chartType: isChartType(slot?.chartType) ? slot.chartType : "candle",
    indicators: Array.isArray(slot?.indicators) ? slot.indicators : [],
    extendedHours: { ...DEFAULT_EXTENDED_HOURS, ...(slot?.extendedHours ?? {}), enabled: market === "US" && Boolean(slot?.extendedHours?.enabled) },
    preMarketLevels: { ...DEFAULT_PREMARKET_LEVELS, ...(slot?.preMarketLevels ?? {}) },
  };
}

export function normalizeCompareSymbols(input: Array<string | null | undefined>, activeSymbol?: string | null): string[] {
  const active = String(activeSymbol || "").trim().toUpperCase();
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of input) {
    const next = String(raw || "").trim().toUpperCase();
    if (!next || next === active || seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
    if (normalized.length >= MAX_COMPARE_SYMBOLS) break;
  }
  return normalized;
}

function buildTemplatePayload(
  snapshot: WorkspaceSnapshot,
  linkGroups: Record<string, WorkspaceLinkGroup>,
  compareSymbols: string[],
): Record<string, unknown> {
  return {
    version: 2,
    slots: snapshot.slots,
    gridTemplate: snapshot.gridTemplate,
    syncCrosshair: snapshot.syncCrosshair,
    linkGroups,
    compareSymbols,
  };
}

export function parseWorkspaceTemplateConfig(layoutConfig: Record<string, unknown>): ParsedWorkspaceTemplate | null {
  if (!isRecord(layoutConfig)) return null;

  const directSlots = Array.isArray(layoutConfig.slots) ? layoutConfig.slots : null;
  const legacyPanels = Array.isArray(layoutConfig.panels) ? layoutConfig.panels : null;
  const slotSource = directSlots ?? legacyPanels;
  if (!slotSource?.length) return null;

  const slots = slotSource
    .map((row) => {
      if (!isRecord(row)) return null;
      const ticker = typeof row.ticker === "string"
        ? row.ticker
        : typeof row.symbol === "string"
          ? row.symbol
          : null;
      const timeframe = isTimeframe(row.timeframe) ? row.timeframe : "1D";
      const chartType = isChartType(row.chartType) ? row.chartType : "candle";
      const market = row.market === "US" ? "US" : row.market === "IN" ? "IN" : "US";
      return buildTemplateSlot({
        ticker,
        companyName: typeof row.companyName === "string" ? row.companyName : null,
        timeframe,
        chartType,
        market,
        indicators: Array.isArray(row.indicators) ? (row.indicators as IndicatorConfig[]) : [],
        extendedHours: isRecord(row.extendedHours) ? row.extendedHours as unknown as ChartSlot["extendedHours"] : undefined,
        preMarketLevels: isRecord(row.preMarketLevels) ? row.preMarketLevels as unknown as ChartSlot["preMarketLevels"] : undefined,
      });
    })
    .filter((row): row is ChartSlot => row !== null);

  if (!slots.length) return null;

  const rawGrid = isRecord(layoutConfig.gridTemplate) ? layoutConfig.gridTemplate : null;
  const gridTemplate = rawGrid
    ? {
        cols: typeof rawGrid.cols === "number" && rawGrid.cols > 0 ? rawGrid.cols : inferGridTemplate(slots.length).cols,
        rows: typeof rawGrid.rows === "number" && rawGrid.rows > 0 ? rawGrid.rows : inferGridTemplate(slots.length).rows,
        arrangement: rawGrid.arrangement === "custom" ? "custom" as const : "grid" as const,
        customAreas: typeof rawGrid.customAreas === "string" ? rawGrid.customAreas : undefined,
      }
    : inferGridTemplate(slots.length);
  const compareSymbols = normalizeCompareSymbols(
    Array.isArray(layoutConfig.compareSymbols) ? layoutConfig.compareSymbols.map((row) => String(row)) : [],
  );

  return {
    snapshot: {
      slots,
      gridTemplate,
      syncCrosshair: typeof layoutConfig.syncCrosshair === "boolean" ? layoutConfig.syncCrosshair : true,
    },
    linkGroups: normalizeLinkGroups(
      slots,
      isRecord(layoutConfig.linkGroups)
        ? layoutConfig.linkGroups as Record<string, WorkspaceLinkGroup>
        : isRecord(layoutConfig.link_groups)
          ? layoutConfig.link_groups as Record<string, WorkspaceLinkGroup>
          : null,
    ),
    compareSymbols,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isMenuTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="menu"]'));
}

function focusPanelBySlotId(slotId: string) {
  const el = document.querySelector<HTMLElement>(`[data-slot-id="${slotId}"]`);
  el?.focus();
}

function focusLayoutSelector() {
  const btn = document.querySelector<HTMLElement>(".layout-selector .layout-btn.active, .layout-selector .layout-btn");
  btn?.focus();
}

function applyMultiTimeframePreset() {
  const state = useChartWorkstationStore.getState();
  const active = state.slots.find((s) => s.id === state.activeSlotId) || state.slots[0];
  const symbol = active?.ticker || "AAPL";
  const market = active?.market || "US";
  const nextSlots = [...state.slots];
  while (nextSlots.length < 4) {
    const id = Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    nextSlots.push({
      id,
      ticker: symbol,
      companyName: active?.companyName ?? null,
      market,
      timeframe: "1D",
      chartType: "candle",
      indicators: [],
      extendedHours: { ...active?.extendedHours, enabled: market === "US", showPreMarket: true, showAfterHours: true, visualMode: "merged", colorScheme: "dimmed" },
      preMarketLevels: { ...active?.preMarketLevels, showPMHigh: true, showPMLow: true, showPMOpen: false, showPMVWAP: false, extendIntoRTH: true, daysToShow: 1 },
    });
  }
  const tfs: ChartSlotTimeframe[] = ["1D", "1h", "15m", "5m"];
  const patched = nextSlots.map((slot, idx) => (idx < 4 ? { ...slot, ticker: symbol, market, timeframe: tfs[idx] } : slot));
  useChartWorkstationStore.setState({
    slots: patched,
    activeSlotId: patched[0]?.id ?? null,
    gridTemplate: { cols: 2, rows: 2, arrangement: "grid" },
  });
}

function createSlotId(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function buildNewSlotFromActive(slots: ChartSlot[], activeSlotId: string | null): ChartSlot {
  const active = slots.find((s) => s.id === activeSlotId) ?? slots[0];
  const market = active?.market ?? "IN";
  return {
    id: createSlotId(),
    ticker: active?.ticker ?? null,
    companyName: active?.companyName ?? null,
    market,
    timeframe: active?.timeframe ?? "1D",
    chartType: active?.chartType ?? "candle",
    indicators: Array.isArray(active?.indicators) ? active.indicators : [],
    extendedHours: active?.extendedHours
      ? { ...active.extendedHours, enabled: market === "US" }
      : {
        enabled: market === "US",
        showPreMarket: true,
        showAfterHours: true,
        visualMode: "merged",
        colorScheme: "dimmed",
      },
    preMarketLevels: active?.preMarketLevels
      ? { ...active.preMarketLevels }
      : {
        showPMHigh: true,
        showPMLow: true,
        showPMOpen: false,
        showPMVWAP: false,
        extendIntoRTH: true,
        daysToShow: 1,
      },
  };
}

function getLayoutCapacity(cols: number, rows: number) {
  return Math.max(1, Math.min(MAX_WORKSTATION_SLOTS, cols * rows));
}

function createWorkspaceSnapshot(
  slots: ChartSlot[],
  gridTemplate: WorkspaceSnapshot["gridTemplate"],
  syncCrosshair: boolean,
): WorkspaceSnapshot {
  return {
    slots: slots.map((slot) => ({
      ...slot,
      indicators: Array.isArray(slot.indicators) ? [...slot.indicators] : [],
      extendedHours: { ...slot.extendedHours },
      preMarketLevels: { ...slot.preMarketLevels },
    })),
    gridTemplate: { ...gridTemplate },
    syncCrosshair,
  };
}

export function makeDefaultLinkGroups(slots: ChartSlot[]): Record<string, WorkspaceLinkGroup> {
  const next: Record<string, WorkspaceLinkGroup> = {};
  slots.forEach((slot, idx) => {
    next[slot.id] = idx === 0 ? "A" : "off";
  });
  return next;
}

function normalizeLinkGroups(
  slots: ChartSlot[],
  groups: Record<string, WorkspaceLinkGroup> | null | undefined,
): Record<string, WorkspaceLinkGroup> {
  const base = makeDefaultLinkGroups(slots);
  if (!groups) return base;
  for (const slot of slots) {
    const g = groups[slot.id];
    if (g === "A" || g === "B" || g === "C" || g === "off") {
      base[slot.id] = g;
    }
  }
  return base;
}

export function propagateLinkedSlots(
  slots: ChartSlot[],
  groups: Record<string, WorkspaceLinkGroup>,
  sourceSlotId: string,
  apply: (slot: ChartSlot) => ChartSlot,
): ChartSlot[] {
  const sourceGroup = groups[sourceSlotId] ?? "off";
  if (sourceGroup === "off") return slots;
  return slots.map((slot) => {
    if (slot.id === sourceSlotId) return slot;
    if ((groups[slot.id] ?? "off") !== sourceGroup) return slot;
    return apply(slot);
  });
}

function readWorkspaceTabs(
  fallbackSlots: ChartSlot[],
  fallbackTemplate: WorkspaceSnapshot["gridTemplate"],
  fallbackSyncCrosshair: boolean,
): { tabs: WorkspaceTab[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(WORKSPACE_TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs?: WorkspaceTab[]; activeTabId?: string };
      if (Array.isArray(parsed?.tabs) && parsed.tabs.length) {
        const validTabs = parsed.tabs
          .filter((tab) => tab && typeof tab.id === "string" && tab.snapshot?.slots?.length)
          .map((tab) => ({
            ...tab,
            compareSymbols: normalizeCompareSymbols(Array.isArray(tab.compareSymbols) ? tab.compareSymbols : []),
          }));
        if (validTabs.length) {
          const activeTabId = validTabs.some((tab) => tab.id === parsed.activeTabId)
            ? (parsed.activeTabId as string)
            : validTabs[0].id;
          return { tabs: validTabs, activeTabId };
        }
      }
    }
  } catch {
    // ignore invalid persisted payloads
  }
  const id = `ws-${Date.now()}`;
  return {
    tabs: [
      {
        id,
        name: "Main",
        snapshot: createWorkspaceSnapshot(fallbackSlots, fallbackTemplate, fallbackSyncCrosshair),
        linkGroups: makeDefaultLinkGroups(fallbackSlots),
        compareSymbols: [],
      },
    ],
    activeTabId: id,
  };
}

export function ChartWorkstationPage() {
  const navigate = useNavigate();
  const setTicker = useStockStore((s) => s.setTicker);
  const [fullscreenSlotId, setFullscreenSlotId] = useState<string | null>(null);
  const [layoutNotice, setLayoutNotice] = useState<null | { title: string; message: string; variant: "info" | "success" | "warning" }>(null);
  const [templateNotice, setTemplateNotice] = useState<null | { title: string; message: string; variant: "info" | "success" | "warning" }>(null);
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDraftName, setTemplateDraftName] = useState("");
  const [compareInput, setCompareInput] = useState("");
  const [compareMode, setCompareMode] = useState<"normalized" | "price">("normalized");
  const [compareSeries, setCompareSeries] = useState<Array<{ symbol: string; data: ChartPoint[]; color?: string }>>([]);
  const {
    slots,
    activeSlotId,
    gridTemplate,
    removeSlot,
    updateSlotTicker,
    updateSlotTimeframe,
    updateSlotType,
    updateSlotETH,
    updateSlotPMLevels,
    updateSlotIndicators,
    setActiveSlot,
    setGridTemplate,
    syncCrosshair,
    syncTimeframe,
    setSyncCrosshair,
    setSyncTimeframe,
  } = useChartWorkstationStore();
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(null);
  const [slotLinkGroups, setSlotLinkGroups] = useState<Record<string, WorkspaceLinkGroup>>({});
  const [workspaceReady, setWorkspaceReady] = useState(false);

  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const persisted = readWorkspaceTabs(slots, gridTemplate, syncCrosshair);
    setWorkspaceTabs(persisted.tabs);
    setActiveWorkspaceTabId(persisted.activeTabId);

    const active = persisted.tabs.find((tab) => tab.id === persisted.activeTabId) ?? persisted.tabs[0];
    if (active) {
      setSlotLinkGroups(normalizeLinkGroups(active.snapshot.slots, active.linkGroups));

      const newSlots = active.snapshot.slots;
      const currentSlotsJSON = JSON.stringify(slots);
      const newSlotsJSON = JSON.stringify(newSlots);
      const gridChanged = JSON.stringify(gridTemplate) !== JSON.stringify(active.snapshot.gridTemplate);
      const syncChanged = syncCrosshair !== active.snapshot.syncCrosshair;

      if (currentSlotsJSON !== newSlotsJSON || gridChanged || syncChanged) {
        useChartWorkstationStore.setState({
          slots: newSlots,
          gridTemplate: active.snapshot.gridTemplate,
          syncCrosshair: active.snapshot.syncCrosshair,
          activeSlotId: newSlots[0]?.id ?? null,
        });
      }
    }

    setWorkspaceReady(true);
  }, [gridTemplate, slots, syncCrosshair]);

  useEffect(() => {
    if (!workspaceReady || !activeWorkspaceTabId) return;
    setSlotLinkGroups((prev) => {
      const next = normalizeLinkGroups(slots, prev);
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
  }, [activeWorkspaceTabId, slots, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !activeWorkspaceTabId) return;
    setWorkspaceTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        if (tab.id !== activeWorkspaceTabId) return tab;
        const newSnapshot = createWorkspaceSnapshot(slots, gridTemplate, syncCrosshair);
        const newLinkGroups = normalizeLinkGroups(slots, slotLinkGroups);
        const snapshotSame = JSON.stringify(tab.snapshot) === JSON.stringify(newSnapshot);
        const linkGroupsSame = JSON.stringify(tab.linkGroups) === JSON.stringify(newLinkGroups);

        if (snapshotSame && linkGroupsSame) return tab;

        changed = true;
        return {
          ...tab,
          snapshot: newSnapshot,
          linkGroups: newLinkGroups,
        };
      });
      return changed ? next : prev;
    });
  }, [activeWorkspaceTabId, gridTemplate, slotLinkGroups, slots, syncCrosshair, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !workspaceTabs.length || !activeWorkspaceTabId) return;
    try {
      localStorage.setItem(
        WORKSPACE_TABS_KEY,
        JSON.stringify({
          tabs: workspaceTabs,
          activeTabId: activeWorkspaceTabId,
        }),
      );
    } catch {
      // ignore persistence failures
    }
  }, [activeWorkspaceTabId, workspaceReady, workspaceTabs]);

  const visibleCapacity = getLayoutCapacity(gridTemplate.cols || 1, gridTemplate.rows || 1);
  const visibleSlots = useMemo(() => slots.slice(0, visibleCapacity), [slots, visibleCapacity]);
  const hiddenSlotCount = Math.max(0, slots.length - visibleSlots.length);
  const canAddVisibleSlot =
    slots.length < MAX_WORKSTATION_SLOTS && visibleSlots.length < visibleCapacity;
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null,
    [activeWorkspaceTabId, workspaceTabs],
  );
  const activeSlot = useMemo(
    () => slots.find((slot) => slot.id === activeSlotId) ?? visibleSlots[0] ?? null,
    [activeSlotId, slots, visibleSlots],
  );
  const activeTicker = activeSlot?.ticker?.toUpperCase() ?? null;
  const activeCompareSymbols = useMemo(
    () => normalizeCompareSymbols(activeWorkspaceTab?.compareSymbols ?? [], activeTicker),
    [activeTicker, activeWorkspaceTab?.compareSymbols],
  );
  const activeLinkGroup = activeSlot ? (slotLinkGroups[activeSlot.id] ?? "off") : "off";
  const linkedSymbolCount = useMemo(() => {
    if (!activeSlot || activeLinkGroup === "off") return activeSlot?.ticker ? 1 : 0;
    return slots.filter((slot) => (slotLinkGroups[slot.id] ?? "off") === activeLinkGroup && slot.ticker).length;
  }, [activeLinkGroup, activeSlot, slotLinkGroups, slots]);

  const { bySlotId: chartBatchBySlotId, loadingAny: batchLoadingAny, source: chartBatchSource } = useBatchChartData(visibleSlots);
  const { connectionState: quotesConnectionState, quoteBySlotId } = useWorkstationQuotes(visibleSlots);

  useEffect(() => {
    if (!layoutNotice) return;
    const t = window.setTimeout(() => setLayoutNotice(null), 2500);
    return () => window.clearTimeout(t);
  }, [layoutNotice]);

  useEffect(() => {
    if (!templateNotice) return;
    const t = window.setTimeout(() => setTemplateNotice(null), 2500);
    return () => window.clearTimeout(t);
  }, [templateNotice]);

  const refreshTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const rows = await listChartTemplates();
      setTemplates(rows);
      setSelectedTemplateId((prev) => (prev && rows.some((row) => row.id === prev) ? prev : rows[0]?.id ?? ""));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load templates";
      setTemplateNotice({
        title: "Template catalog unavailable",
        message,
        variant: "warning",
      });
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  const updateActiveTabCompareSymbols = useCallback((symbols: string[]) => {
    if (!activeWorkspaceTabId) return;
    setWorkspaceTabs((prev) => prev.map((tab) => (
      tab.id === activeWorkspaceTabId
        ? { ...tab, compareSymbols: normalizeCompareSymbols(symbols, activeTicker) }
        : tab
    )));
  }, [activeTicker, activeWorkspaceTabId]);

  useEffect(() => {
    let cancelled = false;
    if (!activeSlot?.ticker || !activeCompareSymbols.length) {
      setCompareSeries([]);
      return;
    }

    const market = activeSlot.market === "IN" ? "NSE" : "NASDAQ";
    const interval = TIMEFRAME_TO_INTERVAL[activeSlot.timeframe];
    const extended = activeSlot.extendedHours.enabled && activeSlot.market === "US";

    Promise.all(
      activeCompareSymbols.map(async (symbol, idx) => {
        const response = await fetchChartData(symbol, {
          market,
          interval,
          period: "1y",
          extended,
        });
        return {
          symbol,
          color: COMPARE_PALETTE[idx % COMPARE_PALETTE.length],
          data: (response.data || []).map((bar) => ({
            t: Math.floor(Number(bar.t) / 1000),
            o: Number(bar.o),
            h: Number(bar.h),
            l: Number(bar.l),
            c: Number(bar.c),
            v: Number(bar.v),
            s: bar.s,
            ext: bar.ext,
          })),
        };
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        setCompareSeries(rows.filter((row) => row.data.length > 0));
      })
      .catch(() => {
        if (cancelled) return;
        setCompareSeries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCompareSymbols, activeSlot]);

  const handleLayoutChange = useCallback(
    (nextTemplate: typeof gridTemplate) => {
      const nextCapacity = getLayoutCapacity(nextTemplate.cols || 1, nextTemplate.rows || 1);
      const currentVisiblePopulated = slots
        .slice(0, visibleCapacity)
        .filter((slot) => Boolean(slot.ticker))
        .length;
      const nextVisiblePopulated = slots
        .slice(0, nextCapacity)
        .filter((slot) => Boolean(slot.ticker))
        .length;
      const populatedThatWillBeHidden = Math.max(0, currentVisiblePopulated - nextVisiblePopulated);
      const nextHiddenCount = Math.max(0, slots.length - Math.min(slots.length, nextCapacity));

      if (nextCapacity < visibleCapacity && populatedThatWillBeHidden > 0) {
        const ok = window.confirm(
          `Switch layout to ${nextTemplate.cols}x${nextTemplate.rows}? ` +
          `${populatedThatWillBeHidden} populated chart(s) will be hidden (not deleted).`,
        );
        if (!ok) return;
      }

      setGridTemplate(nextTemplate);
      if (nextCapacity < visibleCapacity && nextHiddenCount > hiddenSlotCount) {
        setLayoutNotice({
          title: "Layout reduced",
          message: `${nextHiddenCount} chart(s) hidden. They are preserved and will reappear when you expand the layout.`,
          variant: "warning",
        });
      } else if (nextCapacity > visibleCapacity && hiddenSlotCount > 0) {
        const restored = Math.min(hiddenSlotCount, nextCapacity - visibleCapacity);
        setLayoutNotice({
          title: "Layout expanded",
          message: `${restored} hidden chart(s) restored to view.`,
          variant: "success",
        });
      } else {
        setLayoutNotice({
          title: "Layout updated",
          message: `Switched to ${nextTemplate.cols}x${nextTemplate.rows}.`,
          variant: "info",
        });
      }
    },
    [hiddenSlotCount, setGridTemplate, slots, visibleCapacity],
  );

  const handleTickerChange = useCallback(
    (slotId: string) =>
      (ticker: string, market: SlotMarket, companyName?: string | null) => {
        updateSlotTicker(slotId, ticker, market, companyName);
        const sourceGroup = slotLinkGroups[slotId] ?? "off";
        if (sourceGroup === "off") return;
        useChartWorkstationStore.setState((state) => ({
          slots: propagateLinkedSlots(state.slots, slotLinkGroups, slotId, (slot) => ({
            ...slot,
            ticker,
            companyName: typeof companyName === "string" ? companyName : slot.companyName ?? null,
            market,
            extendedHours: { ...slot.extendedHours, enabled: market === "US" },
          })),
        }));
      },
    [slotLinkGroups, updateSlotTicker],
  );

  const handleTimeframeChange = useCallback(
    (slotId: string) =>
      (tf: ChartSlotTimeframe) => {
        updateSlotTimeframe(slotId, tf);
        const slot = slots.find((s) => s.id === slotId);
        const isUS = (slot?.market ?? "IN") === "US";
        updateSlotETH(slotId, { enabled: isUS && shouldDefaultExtendedHoursOn(tf) });
        if (!syncTimeframe) return;
        const sourceGroup = slotLinkGroups[slotId] ?? "off";
        if (sourceGroup === "off") return;
        useChartWorkstationStore.setState((state) => ({
          slots: propagateLinkedSlots(state.slots, slotLinkGroups, slotId, (linkedSlot) => {
            const linkedIsUS = (linkedSlot.market ?? "IN") === "US";
            return {
              ...linkedSlot,
              timeframe: tf,
              extendedHours: {
                ...linkedSlot.extendedHours,
                enabled: linkedIsUS && shouldDefaultExtendedHoursOn(tf),
              },
            };
          }),
        }));
      },
    [slotLinkGroups, slots, syncTimeframe, updateSlotTimeframe, updateSlotETH],
  );

  const handleChartTypeChange = useCallback(
    (slotId: string) =>
      (chartType: ChartSlotType) => {
        updateSlotType(slotId, chartType);
      },
    [updateSlotType],
  );

  const handleETHChange = useCallback(
    (slotId: string) =>
      (eth: Partial<Parameters<typeof updateSlotETH>[1]>) => {
        updateSlotETH(slotId, eth);
      },
    [updateSlotETH],
  );

  const handlePMLevelsChange = useCallback(
    (slotId: string) =>
      (levels: Partial<Parameters<typeof updateSlotPMLevels>[1]>) => {
        updateSlotPMLevels(slotId, levels);
      },
    [updateSlotPMLevels],
  );

  const handleIndicatorsChange = useCallback(
    (slotId: string) =>
      (indicators: IndicatorConfig[]) => {
        updateSlotIndicators(slotId, indicators);
      },
    [updateSlotIndicators],
  );

  const switchWorkspaceTab = useCallback(
    (tabId: string) => {
      const next = workspaceTabs.find((tab) => tab.id === tabId);
      if (!next) return;
      setActiveWorkspaceTabId(tabId);
      const normalizedGroups = normalizeLinkGroups(next.snapshot.slots, next.linkGroups);
      setSlotLinkGroups(normalizedGroups);
      useChartWorkstationStore.setState({
        slots: next.snapshot.slots,
        gridTemplate: next.snapshot.gridTemplate,
        syncCrosshair: next.snapshot.syncCrosshair,
        activeSlotId: next.snapshot.slots[0]?.id ?? null,
      });
      setFullscreenSlotId(null);
    },
    [workspaceTabs],
  );

  const handleAddWorkspaceTab = useCallback(() => {
    const id = `ws-${Date.now()}`;
    const nextTab: WorkspaceTab = {
      id,
      name: `Workspace ${workspaceTabs.length + 1}`,
      snapshot: createWorkspaceSnapshot(slots, gridTemplate, syncCrosshair),
      linkGroups: normalizeLinkGroups(slots, slotLinkGroups),
      compareSymbols: [],
    };
    setWorkspaceTabs((prev) => [...prev, nextTab]);
    setActiveWorkspaceTabId(id);
  }, [gridTemplate, slotLinkGroups, slots, syncCrosshair, workspaceTabs.length]);

  const handleRemoveWorkspaceTab = useCallback(
    (tabId: string) => {
      if (workspaceTabs.length <= 1) return;
      const remaining = workspaceTabs.filter((tab) => tab.id !== tabId);
      setWorkspaceTabs(remaining);
      if (activeWorkspaceTabId === tabId) {
        switchWorkspaceTab(remaining[0].id);
      }
    },
    [activeWorkspaceTabId, switchWorkspaceTab, workspaceTabs],
  );

  const handleAddSlot = useCallback(() => {
    useChartWorkstationStore.setState((state) => {
      if (state.slots.length >= MAX_WORKSTATION_SLOTS) return state;
      const next = buildNewSlotFromActive(state.slots, state.activeSlotId);
      return {
        slots: [...state.slots, next],
        activeSlotId: next.id,
      };
    });
  }, []);

  const applyTemplateToWorkspace = useCallback((template: WorkspaceTemplate, openAsNewTab: boolean) => {
    const parsed = parseWorkspaceTemplateConfig(template.layout_config);
    if (!parsed) {
      setTemplateNotice({
        title: "Template skipped",
        message: "Selected template does not contain a usable workstation layout.",
        variant: "warning",
      });
      return;
    }

    const nextTabId = openAsNewTab ? `ws-${Date.now()}` : activeWorkspaceTabId ?? `ws-${Date.now()}`;
    const nextTab: WorkspaceTab = {
      id: nextTabId,
      name: openAsNewTab ? template.name : (activeWorkspaceTab?.name || template.name),
      snapshot: parsed.snapshot,
      linkGroups: parsed.linkGroups,
      compareSymbols: parsed.compareSymbols,
    };

    setWorkspaceTabs((prev) => {
      if (openAsNewTab) return [...prev, nextTab];
      return prev.map((tab) => (tab.id === nextTabId ? nextTab : tab));
    });
    setActiveWorkspaceTabId(nextTabId);
    setSlotLinkGroups(parsed.linkGroups);
    useChartWorkstationStore.setState({
      slots: parsed.snapshot.slots,
      gridTemplate: parsed.snapshot.gridTemplate,
      syncCrosshair: parsed.snapshot.syncCrosshair,
      activeSlotId: parsed.snapshot.slots[0]?.id ?? null,
    });
    setFullscreenSlotId(null);
    setTemplateNotice({
      title: openAsNewTab ? "Template opened in new tab" : "Template applied",
      message: `${template.name} loaded with ${parsed.snapshot.slots.length} pane(s).`,
      variant: "success",
    });
  }, [activeWorkspaceTab?.name, activeWorkspaceTabId]);

  const handleSaveCurrentTemplate = useCallback(async () => {
    const name = templateDraftName.trim();
    if (!name) {
      setTemplateNotice({
        title: "Template name required",
        message: "Provide a workstation template name before saving.",
        variant: "warning",
      });
      return;
    }

    try {
      await createChartTemplate({
        name,
        layout_config: buildTemplatePayload(
          createWorkspaceSnapshot(slots, gridTemplate, syncCrosshair),
          normalizeLinkGroups(slots, slotLinkGroups),
          activeCompareSymbols,
        ),
      });
      setTemplateDraftName("");
      await refreshTemplates();
      setTemplateNotice({
        title: "Template saved",
        message: `${name} is now available in the workstation template rack.`,
        variant: "success",
      });
    } catch (error) {
      setTemplateNotice({
        title: "Template save failed",
        message: error instanceof Error ? error.message : "Unable to save chart template.",
        variant: "warning",
      });
    }
  }, [activeCompareSymbols, gridTemplate, refreshTemplates, slotLinkGroups, slots, syncCrosshair, templateDraftName]);

  const handleAddCompareSymbol = useCallback(() => {
    const next = normalizeCompareSymbols([...activeCompareSymbols, compareInput], activeTicker);
    updateActiveTabCompareSymbols(next);
    setCompareInput("");
  }, [activeCompareSymbols, activeTicker, compareInput, updateActiveTabCompareSymbols]);

  const handleRemoveCompareSymbol = useCallback((symbol: string) => {
    updateActiveTabCompareSymbols(activeCompareSymbols.filter((row) => row !== symbol));
  }, [activeCompareSymbols, updateActiveTabCompareSymbols]);

  const drillInto = useCallback((route: "security" | "news" | "screener" | "compare" | "portfolio") => {
    if (!activeTicker) return;
    setTicker(activeTicker);
    if (route === "security") {
      navigate(`/equity/security/${activeTicker}`);
      return;
    }
    if (route === "news") {
      navigate(`/equity/news?ticker=${encodeURIComponent(activeTicker)}`);
      return;
    }
    if (route === "screener") {
      navigate(`/equity/screener?symbol=${encodeURIComponent(activeTicker)}`);
      return;
    }
    if (route === "compare") {
      const compareSymbols = [activeTicker, ...activeCompareSymbols].join(",");
      navigate(`/equity/compare?symbols=${encodeURIComponent(compareSymbols)}`);
      return;
    }
    navigate(`/equity/portfolio?ticker=${encodeURIComponent(activeTicker)}`);
  }, [activeCompareSymbols, activeTicker, navigate, setTicker]);

  useEffect(() => {
    if (fullscreenSlotId && !slots.some((slot) => slot.id === fullscreenSlotId)) {
      setFullscreenSlotId(null);
    }
  }, [fullscreenSlotId, slots]);

  useEffect(() => {
    if (fullscreenSlotId && !visibleSlots.some((slot) => slot.id === fullscreenSlotId)) {
      setFullscreenSlotId(null);
    }
  }, [fullscreenSlotId, visibleSlots]);

  useEffect(() => {
    if (!activeSlotId) return;
    const activeIsVisible = visibleSlots.some((slot) => slot.id === activeSlotId);
    if (!activeIsVisible) {
      setActiveSlot(visibleSlots[0]?.id ?? null);
    }
  }, [activeSlotId, setActiveSlot, visibleSlots]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (isMenuTarget(event.target)) return;

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        if (!visibleSlots.length) return;
        event.preventDefault();
        const currentIndex = Math.max(0, visibleSlots.findIndex((slot) => slot.id === activeSlotId));
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + visibleSlots.length) % visibleSlots.length
          : (currentIndex + 1) % visibleSlots.length;
        const nextSlot = visibleSlots[nextIndex];
        if (nextSlot) {
          setActiveSlot(nextSlot.id);
          focusPanelBySlotId(nextSlot.id);
        }
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const slot = visibleSlots[index];
        if (slot) {
          event.preventDefault();
          setActiveSlot(slot.id);
          focusPanelBySlotId(slot.id);
        }
        return;
      }

      if (!event.ctrlKey && !event.metaKey && event.altKey && !event.shiftKey && activeSlotId) {
        const tf = TIMEFRAME_HOTKEY_MAP[event.key];
        if (tf) {
          event.preventDefault();
          handleTimeframeChange(activeSlotId)(tf);
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        if (!activeSlotId) return;
        event.preventDefault();
        setFullscreenSlotId((prev) => (prev === activeSlotId ? null : activeSlotId));
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Escape") {
        if (fullscreenSlotId) {
          event.preventDefault();
          setFullscreenSlotId(null);
          return;
        }
        if (activeSlotId) {
          event.preventDefault();
          setActiveSlot(null);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        if (!canAddVisibleSlot) return;
        event.preventDefault();
        handleAddSlot();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        focusLayoutSelector();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "w" && activeSlotId) {
        event.preventDefault();
        removeSlot(activeSlotId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeSlotId,
    canAddVisibleSlot,
    fullscreenSlotId,
    handleAddSlot,
    handleTimeframeChange,
    removeSlot,
    setActiveSlot,
    slots,
    visibleSlots,
  ]);


  return (
    <CrosshairSyncProvider enabled={syncCrosshair}>
      <div className="chart-workstation flex h-full flex-col bg-terminal-canvas text-terminal-text" data-testid="chart-workstation">
        <div className="border-b border-terminal-border bg-terminal-panel px-3 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-terminal-muted">Chart Workstation</span>
                  <TerminalBadge variant="accent">Wave 2</TerminalBadge>
                  <TerminalBadge variant="info">Template Rack</TerminalBadge>
                  <TerminalBadge variant="neutral">Linked Compare</TerminalBadge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {workspaceTabs.map((tab) => (
                    <div key={tab.id} className="inline-flex items-center rounded border border-terminal-border bg-terminal-bg/50">
                      <button
                        type="button"
                        className={`px-2 py-1 text-[10px] uppercase ${
                          tab.id === activeWorkspaceTabId
                            ? "bg-terminal-accent/15 text-terminal-accent"
                            : "text-terminal-muted hover:text-terminal-text"
                        }`}
                        onClick={() => switchWorkspaceTab(tab.id)}
                      >
                        {tab.name}
                      </button>
                      {workspaceTabs.length > 1 ? (
                        <button
                          type="button"
                          className="px-1 text-terminal-muted hover:text-terminal-neg"
                          onClick={() => handleRemoveWorkspaceTab(tab.id)}
                          aria-label={`Close ${tab.name}`}
                        >
                          x
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="px-2 font-bold uppercase"
                    onClick={handleAddWorkspaceTab}
                  >
                    + TAB
                  </TerminalButton>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <TerminalBadge
                  variant={
                    quotesConnectionState === "connected"
                      ? "success"
                      : quotesConnectionState === "connecting"
                        ? "info"
                        : "danger"
                  }
                  size="sm"
                  dot
                  className="font-bold"
                >
                  DATA: {quotesConnectionState.toUpperCase()}
                </TerminalBadge>

                {batchLoadingAny ? (
                  <TerminalBadge variant="live" size="sm" dot className="animate-pulse font-bold">
                    LOADING CHARTS
                  </TerminalBadge>
                ) : null}

                {!batchLoadingAny && chartBatchSource !== "idle" ? (
                  <TerminalTooltip
                    side="bottom"
                    content={
                      chartBatchSource === "batch"
                        ? "Chart data loaded via high-performance batch endpoint."
                        : "Chart data loaded via parallel fallback requests."
                    }
                  >
                    <span>
                      <TerminalBadge
                        variant={chartBatchSource === "batch" ? "success" : "warn"}
                        size="sm"
                        className="font-bold"
                      >
                        SOURCE: {chartBatchSource.toUpperCase()}
                      </TerminalBadge>
                    </span>
                  </TerminalTooltip>
                ) : null}

                <span className="text-[10px] font-bold uppercase text-terminal-muted">
                  {visibleSlots.length}/{slots.length} panes
                </span>

                {hiddenSlotCount > 0 ? (
                  <TerminalBadge variant="info" size="sm" dot className="font-bold">
                    {hiddenSlotCount} hidden
                  </TerminalBadge>
                ) : null}

                <LayoutSelector current={gridTemplate} onChange={handleLayoutChange} />

                {canAddVisibleSlot ? (
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="px-2 font-bold uppercase"
                    onClick={handleAddSlot}
                    data-testid="add-chart-btn"
                  >
                    + ADD PANE
                  </TerminalButton>
                ) : null}
                <TerminalButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="px-2 font-bold uppercase"
                  onClick={applyMultiTimeframePreset}
                >
                  4-TF PRESET
                </TerminalButton>
                <TerminalButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="px-2 font-bold uppercase"
                  onClick={() => handleLayoutChange(CUSTOM_SPLIT_TEMPLATE)}
                >
                  CUSTOM SPLIT
                </TerminalButton>
              </div>
            </div>

            <div className="hidden gap-2 md:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="ot-type-label text-terminal-muted">Template Rack</div>
                  <TerminalBadge variant="neutral" size="sm">{templates.length}</TerminalBadge>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <TerminalInput
                    as="select"
                    size="sm"
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                    disabled={templatesLoading || templates.length === 0}
                  >
                    <option value="">{templatesLoading ? "Loading templates..." : "Select workstation template"}</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </TerminalInput>
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={!selectedTemplateId}
                    onClick={() => {
                      const template = templates.find((row) => row.id === selectedTemplateId);
                      if (template) applyTemplateToWorkspace(template, false);
                    }}
                  >
                    Apply
                  </TerminalButton>
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!selectedTemplateId}
                    onClick={() => {
                      const template = templates.find((row) => row.id === selectedTemplateId);
                      if (template) applyTemplateToWorkspace(template, true);
                    }}
                  >
                    New Tab
                  </TerminalButton>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <TerminalInput
                    size="sm"
                    value={templateDraftName}
                    placeholder="Save current workstation as template"
                    onChange={(event) => setTemplateDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSaveCurrentTemplate();
                      }
                    }}
                  />
                  <TerminalButton type="button" size="sm" variant="accent" onClick={() => void handleSaveCurrentTemplate()}>
                    Save Current
                  </TerminalButton>
                </div>
              </section>

              <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="ot-type-label text-terminal-muted">Compare Overlay</div>
                  <div className="inline-flex items-center gap-1">
                    <TerminalButton
                      type="button"
                      size="sm"
                      variant={compareMode === "normalized" ? "accent" : "ghost"}
                      className="px-2"
                      onClick={() => setCompareMode("normalized")}
                    >
                      %
                    </TerminalButton>
                    <TerminalButton
                      type="button"
                      size="sm"
                      variant={compareMode === "price" ? "accent" : "ghost"}
                      className="px-2"
                      onClick={() => setCompareMode("price")}
                    >
                      PX
                    </TerminalButton>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <TerminalInput
                    size="sm"
                    value={compareInput}
                    placeholder={activeTicker ? `Add compare symbol for ${activeTicker}` : "Select an active chart first"}
                    disabled={!activeTicker || activeCompareSymbols.length >= MAX_COMPARE_SYMBOLS}
                    onChange={(event) => setCompareInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddCompareSymbol();
                      }
                    }}
                  />
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={!compareInput.trim() || !activeTicker || activeCompareSymbols.length >= MAX_COMPARE_SYMBOLS}
                    onClick={handleAddCompareSymbol}
                  >
                    Add
                  </TerminalButton>
                </div>
                <div className="mt-2 flex min-h-8 flex-wrap gap-1">
                  {activeCompareSymbols.length ? activeCompareSymbols.map((symbol, idx) => (
                    <button
                      key={symbol}
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-text"
                      onClick={() => handleRemoveCompareSymbol(symbol)}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COMPARE_PALETTE[idx % COMPARE_PALETTE.length] }} />
                      {symbol}
                      <span className="text-terminal-muted">x</span>
                    </button>
                  )) : (
                    <div className="text-[10px] text-terminal-muted">Overlay up to three peers on the active panel.</div>
                  )}
                </div>
              </section>

              <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="ot-type-label text-terminal-muted">Analyst Handoff</div>
                  <TerminalBadge variant={activeTicker ? "accent" : "neutral"} size="sm">
                    {activeTicker || "No focus"}
                  </TerminalBadge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => drillInto("security")}>
                    Security
                  </TerminalButton>
                  <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => drillInto("news")}>
                    News
                  </TerminalButton>
                  <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => drillInto("screener")}>
                    Screener
                  </TerminalButton>
                  <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => drillInto("compare")}>
                    Compare
                  </TerminalButton>
                  <TerminalButton type="button" size="sm" variant="ghost" disabled={!activeTicker} onClick={() => drillInto("portfolio")}>
                    Portfolio
                  </TerminalButton>
                </div>
                <div className="mt-2 text-[10px] leading-4 text-terminal-muted">
                  Push the active chart into research, news, screening, and portfolio review without losing workstation context.
                </div>
              </section>
            </div>

            <div className="hidden gap-2 md:grid md:grid-cols-2 xl:grid-cols-4">
              <section className="rounded border border-terminal-border bg-terminal-bg/40 px-2 py-1.5 text-[10px]">
                <div className="uppercase tracking-[0.18em] text-terminal-muted">Active Focus</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm text-terminal-text">{activeTicker || "--"}</span>
                  {activeSlot ? <TerminalBadge size="sm" variant="neutral">{activeSlot.market}</TerminalBadge> : null}
                </div>
                <div className="mt-1 text-terminal-muted">
                  {activeSlot ? `${activeSlot.timeframe} ${activeSlot.chartType.toUpperCase()} chart` : "Select a pane to inspect"}
                </div>
              </section>

              <section className="rounded border border-terminal-border bg-terminal-bg/40 px-2 py-1.5 text-[10px]">
                <div className="uppercase tracking-[0.18em] text-terminal-muted">Sync Controls</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant={syncCrosshair ? "accent" : "ghost"}
                    className="px-2"
                    onClick={() => setSyncCrosshair(!syncCrosshair)}
                  >
                    Crosshair {syncCrosshair ? "On" : "Off"}
                  </TerminalButton>
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant={syncTimeframe ? "accent" : "ghost"}
                    className="px-2"
                    onClick={() => setSyncTimeframe(!syncTimeframe)}
                  >
                    TF Link {syncTimeframe ? "On" : "Off"}
                  </TerminalButton>
                </div>
                <div className="mt-1 text-terminal-muted">Link groups always propagate symbol changes. Timeframe propagation is now explicit.</div>
              </section>

              <section className="rounded border border-terminal-border bg-terminal-bg/40 px-2 py-1.5 text-[10px]">
                <div className="uppercase tracking-[0.18em] text-terminal-muted">Link Map</div>
                <div className="mt-1 text-terminal-text">
                  {activeLinkGroup === "off" ? "Unlinked focus pane" : `Group ${activeLinkGroup} leader`}
                </div>
                <div className="mt-1 text-terminal-muted">
                  {linkedSymbolCount} linked symbol{linkedSymbolCount === 1 ? "" : "s"} ready for synchronized rotation.
                </div>
              </section>

              <section className="rounded border border-terminal-border bg-terminal-bg/40 px-2 py-1.5 text-[10px]">
                <div className="uppercase tracking-[0.18em] text-terminal-muted">Keyboard</div>
                <div className="mt-1 text-terminal-muted">`Tab` cycle panes, `1-9` focus pane, `Alt+1..7` change timeframe.</div>
                <div className="mt-1 text-terminal-muted">`Ctrl/Cmd+Shift+N` add pane, `F` fullscreen, `Esc` clear focus.</div>
              </section>
            </div>
          </div>
        </div>

        {/* Grid Area */}
        <div className="relative flex-1 min-h-0 pb-16 md:pb-0">
          <ChartGridContainer slotCount={visibleSlots.length} template={gridTemplate}>
            {visibleSlots.map((slot) => (
              <ChartPanel
                key={slot.id}
                slot={slot}
                isActive={slot.id === activeSlotId}
                isFullscreen={slot.id === fullscreenSlotId}
                onActivate={() => setActiveSlot(slot.id)}
                onToggleFullscreen={() =>
                  setFullscreenSlotId((prev) => (prev === slot.id ? null : slot.id))
                }
                onRemove={() => removeSlot(slot.id)}
                linkGroup={slotLinkGroups[slot.id] ?? "off"}
                onLinkGroupChange={(group) =>
                  setSlotLinkGroups((prev) => ({ ...prev, [slot.id]: group }))
                }
                onTickerChange={handleTickerChange(slot.id)}
                onTimeframeChange={handleTimeframeChange(slot.id)}
                onChartTypeChange={handleChartTypeChange(slot.id)}
                onETHChange={handleETHChange(slot.id)}
                onPMLevelsChange={handlePMLevelsChange(slot.id)}
                onIndicatorsChange={handleIndicatorsChange(slot.id)}
                chartResponse={chartBatchBySlotId[slot.id]?.data ?? null}
                chartLoading={chartBatchBySlotId[slot.id]?.loading ?? false}
                chartError={chartBatchBySlotId[slot.id]?.error ?? null}
                liveQuote={quoteBySlotId[slot.id] ?? null}
                comparisonSeries={slot.id === activeSlotId ? compareSeries : []}
                comparisonMode={slot.id === activeSlotId ? compareMode : "normalized"}
              />
            ))}
            {canAddVisibleSlot && (
              <AddChartPlaceholder onClick={handleAddSlot} />
            )}
          </ChartGridContainer>
        </div>

        <TerminalToastViewport className="top-14">
          {layoutNotice ? (
            <TerminalToast
              title={layoutNotice.title}
              message={layoutNotice.message}
              variant={layoutNotice.variant}
            />
          ) : null}
          {templateNotice ? (
            <TerminalToast
              title={templateNotice.title}
              message={templateNotice.message}
              variant={templateNotice.variant}
            />
          ) : null}
        </TerminalToastViewport>
      </div>
    </CrosshairSyncProvider>
  );
}
