import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { CrosshairSyncProvider } from "../contexts/CrosshairSyncContext";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";
import { ChartGridContainer } from "../components/chart-workstation/ChartGridContainer";
import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import { AddChartPlaceholder } from "../components/chart-workstation/AddChartPlaceholder";
import { LayoutSelector } from "../components/chart-workstation/LayoutSelector";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalToast, TerminalToastViewport } from "../components/terminal/TerminalToast";
import { TerminalTooltip } from "../components/terminal/TerminalTooltip";
import { useBatchChartData } from "../hooks/useBatchChartData";
import { useWorkstationQuotes } from "../hooks/useWorkstationQuotes";
import type { ChartSlot, ChartSlotTimeframe, ChartSlotType, SlotMarket } from "../store/chartWorkstationStore";
import type { IndicatorConfig } from "../shared/chart/types";
import { shouldDefaultExtendedHoursOn } from "../shared/chart/candlePresentation";
import "../components/chart-workstation/ChartWorkstation.css";

const MAX_WORKSTATION_SLOTS = 9;
const WORKSPACE_TABS_KEY = "ot:chart-workstation:tabs:v1";
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
};

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
        const validTabs = parsed.tabs.filter((tab) => tab && typeof tab.id === "string" && tab.snapshot?.slots?.length);
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
      },
    ],
    activeTabId: id,
  };
}

export function ChartWorkstationPage() {
  const [fullscreenSlotId, setFullscreenSlotId] = useState<string | null>(null);
  const [layoutNotice, setLayoutNotice] = useState<null | { title: string; message: string; variant: "info" | "success" | "warning" }>(null);
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

      if (currentSlotsJSON !== newSlotsJSON) {
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

  const { bySlotId: chartBatchBySlotId, loadingAny: batchLoadingAny, source: chartBatchSource } = useBatchChartData(visibleSlots);
  const { connectionState: quotesConnectionState, quoteBySlotId } = useWorkstationQuotes(visibleSlots);

  useEffect(() => {
    if (!layoutNotice) return;
    const t = window.setTimeout(() => setLayoutNotice(null), 2500);
    return () => window.clearTimeout(t);
  }, [layoutNotice]);

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
    [slotLinkGroups, slots, updateSlotTimeframe, updateSlotETH],
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
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-1.5 text-[10px]">
          <span className="ot-type-label text-terminal-accent font-bold uppercase tracking-widest">Workspace</span>

          <div className="flex items-center gap-1">
            {workspaceTabs.map((tab) => (
              <div key={tab.id} className="inline-flex items-center rounded border border-terminal-border">
                <button
                  type="button"
                  className={`px-2 py-0.5 text-[10px] uppercase ${tab.id === activeWorkspaceTabId
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

          <div className="h-4 w-px bg-terminal-border" />

          <LayoutSelector current={gridTemplate} onChange={handleLayoutChange} />

          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
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

            {batchLoadingAny && (
              <TerminalBadge variant="live" size="sm" dot className="animate-pulse font-bold">
                LOADING CHARTS
              </TerminalBadge>
            )}

            {!batchLoadingAny && chartBatchSource !== "idle" && (
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
                    SYNC: {chartBatchSource.toUpperCase()}
                  </TerminalBadge>
                </span>
              </TerminalTooltip>
            )}

            <div className="h-4 w-px bg-terminal-border" />

            <span className="text-terminal-muted uppercase font-bold">
              {visibleSlots.length}/{slots.length} PANES
            </span>

            {hiddenSlotCount > 0 && (
              <TerminalBadge variant="info" size="sm" dot className="font-bold">
                {hiddenSlotCount} HIDDEN
              </TerminalBadge>
            )}

            {canAddVisibleSlot && (
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
            )}
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

        {/* Grid Area */}
        <div className="flex-1 min-h-0 relative">
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
        </TerminalToastViewport>
      </div>
    </CrosshairSyncProvider>
  );
}
