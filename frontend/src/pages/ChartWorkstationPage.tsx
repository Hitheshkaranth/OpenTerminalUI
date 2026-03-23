import { createPortal } from "react-dom";
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CrosshairSyncProvider } from "../contexts/CrosshairSyncContext";
import { createChartTemplate, listChartTemplates } from "../api/client";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";
import { ChartGridContainer } from "../components/chart-workstation/ChartGridContainer";
import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import { AddChartPlaceholder } from "../components/chart-workstation/AddChartPlaceholder";
import { ChartShellToolbar } from "../components/chart-workstation/ChartShellToolbar";
import { PanelBody, PanelFrame, PanelHeader } from "../components/layout/PanelChrome";
import {
  CHART_WORKSTATION_ACTION_EVENT,
  isShortcutEditableTarget,
  isShortcutMenuTarget,
  isShortcutWithinChartPanel,
  type ChartWorkstationActionEventDetail,
  type ChartWorkstationActionId,
  type CommandExecutionResult,
} from "../components/layout/commanding";
import { TerminalToast, TerminalToastViewport } from "../components/terminal/TerminalToast";
import { SparklineCell } from "../components/home/SparklineCell";
import {
  DEFAULT_OPENSCRIPT_TEMPLATE,
  type OpenScriptCompileError,
  type OpenScriptCompileResult,
  type OpenScriptOutput,
  type OpenScriptRunResult,
  ScriptEditor,
} from "../components/chart/ScriptEditor";
import { ScriptLibrary, type OpenScriptLibraryItem } from "../components/chart/ScriptLibrary";
import { useBatchChartData } from "../hooks/useBatchChartData";
import { useWorkstationQuotes } from "../hooks/useWorkstationQuotes";
import type { ChartSlot, ChartSlotTimeframe, ChartSlotType, SlotMarket } from "../store/chartWorkstationStore";
import type { ReplayCommand } from "../shared/chart/replay";
import { normalizeIndicatorConfigs } from "../shared/chart/indicatorCatalog";
import type { IndicatorConfig } from "../shared/chart/types";
import { shouldDefaultExtendedHoursOn } from "../shared/chart/candlePresentation";
import { fetchChartData } from "../services/chartDataService";
import type { ChartPoint } from "../types";
import { useStockStore } from "../store/stockStore";
import {
  LEGACY_WORKSTATION_STORE_KEY,
  WORKSTATION_BOUNDARY_SUMMARY,
  WORKSTATION_SHARE_QUERY_PARAM,
  WORKSTATION_SNAPSHOT_STORAGE_KEY,
  buildWorkstationExportFilename,
  buildWorkstationSnapshotPayload,
  createWorkstationSnapshotRecord,
  decodeWorkstationSharePayload,
  downloadTextFile,
  encodeWorkstationSharePayload,
  isolateWorkstationLayoutConfig,
  normalizeStoredWorkstationSnapshots,
  type WorkstationSnapshotPayload,
  type WorkstationSnapshotRecord,
} from "../shared/chart/workstationPersistence";
import "../components/chart-workstation/ChartWorkstation.css";

const MAX_WORKSTATION_SLOTS = 9;
const MAX_COMPARE_SYMBOLS = 3;
const WORKSPACE_TABS_KEY = "ot:chart-workstation:tabs:v1";
const WORKSPACE_DEFAULTS_KEY = "ot:chart-workstation:default:v1";
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
export const WORKSPACE_RANGE_PRESETS = [
  { id: "1D", label: "1D", rangeDays: 1 },
  { id: "5D", label: "5D", rangeDays: 5 },
  { id: "1W", label: "1W", rangeDays: 7 },
  { id: "1M", label: "1M", rangeDays: 30 },
  { id: "3M", label: "3M", rangeDays: 90 },
  { id: "6M", label: "6M", rangeDays: 180 },
  { id: "1Y", label: "1Y", rangeDays: 365 },
  { id: "MAX", label: "MAX", rangeDays: 0 },
] as const;

export type WorkspaceLinkGroup = "off" | "A" | "B" | "C";
export type WorkspaceLinkDimension = "symbol" | "interval" | "crosshair" | "replay" | "dateRange";
export type WorkspaceComparePlacement = "active" | "linked" | "all";
export type WorkspaceRangePresetId = (typeof WORKSPACE_RANGE_PRESETS)[number]["id"];
export type WorkspaceLinkSettings = Record<WorkspaceLinkDimension, boolean>;

type WorkspaceCompareConfig = {
  mode: "normalized" | "price";
  placement: WorkspaceComparePlacement;
};

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

type WorkspaceState = {
  snapshot: WorkspaceSnapshot;
  linkGroups: Record<string, WorkspaceLinkGroup>;
  linkSettings: WorkspaceLinkSettings;
  compareSymbols: string[];
  compareConfig: WorkspaceCompareConfig;
  rangePresets: Record<string, WorkspaceRangePresetId>;
};

type WorkspaceTab = {
  id: string;
  name: string;
} & WorkspaceState;

type WorkspaceDefaultConfig = {
  name: string;
} & WorkspaceState;

type WorkspaceRangeCommand = {
  presetId: WorkspaceRangePresetId;
  revision: number;
};

type PanelCommand = {
  id: "toggleIndicators" | "toggleDrawingTools" | "toggleVolumeProfile";
  revision: number;
};

type WorkspaceTemplate = {
  id: string;
  name: string;
  layout_config: Record<string, unknown>;
};

type ParsedWorkspaceTemplate = WorkspaceState;
const DEFAULT_WORKSTATION_IMPORT_MARKET: SlotMarket = "IN";

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
const DEFAULT_LINK_SETTINGS: WorkspaceLinkSettings = {
  symbol: true,
  interval: true,
  crosshair: true,
  replay: false,
  dateRange: false,
};
const DEFAULT_COMPARE_CONFIG: WorkspaceCompareConfig = {
  mode: "normalized",
  placement: "active",
};
const DEFAULT_RANGE_PRESET: WorkspaceRangePresetId = "6M";
const SCRIPT_PANEL_STORAGE_KEY = "ot:chart-workstation:openscript-panel:v1";
const SCRIPT_PANEL_SIZE_KEY = "ot:chart-workstation:openscript-panel-size:v1";
const SCRIPT_API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "") || "/api";

function scriptApiUrl(path: string): string {
  return `${SCRIPT_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestScriptJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(scriptApiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const raw = await response.text();
  let body: any = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  if (!response.ok) {
    const message =
      (body && typeof body === "object" && typeof body.detail === "string" && body.detail) ||
      (body && typeof body === "object" && typeof body.message === "string" && body.message) ||
      (typeof body === "string" && body) ||
      response.statusText ||
      "Script request failed";
    throw new Error(message);
  }
  return body as T;
}

function normalizeScriptRecord(value: unknown): OpenScriptLibraryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const name = typeof row.name === "string" ? row.name : "";
  const source = typeof row.source === "string" ? row.source : "";
  if (!id || !name || !source) return null;
  return {
    id,
    name,
    description: typeof row.description === "string" ? row.description : "",
    source,
    is_public: typeof row.is_public === "boolean" ? row.is_public : false,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
}

function toScriptOutputs(outputs: Array<Record<string, unknown>> | OpenScriptOutput[] | undefined): OpenScriptOutput[] {
  if (!Array.isArray(outputs)) return [];
  return outputs.map((row) => ({
    kind: String(row.kind || "plot"),
    title: typeof row.title === "string" ? row.title : null,
    color: typeof row.color === "string" ? row.color : null,
    linewidth: typeof row.linewidth === "number" ? row.linewidth : null,
    message: typeof row.message === "string" ? row.message : null,
    series: Array.isArray(row.series) ? row.series.map((value) => value as number | string | boolean | null) : [],
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimeframe(value: unknown): value is ChartSlotTimeframe {
  return value === "1m" || value === "5m" || value === "15m" || value === "1h" || value === "1D" || value === "1W" || value === "1M";
}

function isChartType(value: unknown): value is ChartSlotType {
  return value === "candle" || value === "line" || value === "area";
}

function isCompareMode(value: unknown): value is WorkspaceCompareConfig["mode"] {
  return value === "normalized" || value === "price";
}

function isComparePlacement(value: unknown): value is WorkspaceComparePlacement {
  return value === "active" || value === "linked" || value === "all";
}

function isRangePresetId(value: unknown): value is WorkspaceRangePresetId {
  return WORKSPACE_RANGE_PRESETS.some((preset) => preset.id === value);
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
    indicators: normalizeIndicatorConfigs(slot?.indicators),
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

export function normalizeWorkspaceLinkSettings(
  input: Record<string, unknown> | null | undefined,
  legacy?: {
    syncCrosshair?: boolean;
    syncTimeframe?: boolean;
  },
): WorkspaceLinkSettings {
  return {
    symbol: typeof input?.symbol === "boolean" ? input.symbol : DEFAULT_LINK_SETTINGS.symbol,
    interval: typeof input?.interval === "boolean" ? input.interval : typeof legacy?.syncTimeframe === "boolean" ? legacy.syncTimeframe : DEFAULT_LINK_SETTINGS.interval,
    crosshair: typeof input?.crosshair === "boolean" ? input.crosshair : typeof legacy?.syncCrosshair === "boolean" ? legacy.syncCrosshair : DEFAULT_LINK_SETTINGS.crosshair,
    replay: typeof input?.replay === "boolean" ? input.replay : DEFAULT_LINK_SETTINGS.replay,
    dateRange: typeof input?.dateRange === "boolean" ? input.dateRange : DEFAULT_LINK_SETTINGS.dateRange,
  };
}

function normalizeWorkspaceCompareConfig(
  input: Record<string, unknown> | null | undefined,
  legacyMode?: unknown,
  legacyPlacement?: unknown,
): WorkspaceCompareConfig {
  const mode = isCompareMode(input?.mode) ? input.mode : isCompareMode(legacyMode) ? legacyMode : DEFAULT_COMPARE_CONFIG.mode;
  const placement = isComparePlacement(input?.placement)
    ? input.placement
    : isComparePlacement(legacyPlacement)
      ? legacyPlacement
      : DEFAULT_COMPARE_CONFIG.placement;
  return { mode, placement };
}

function normalizeRangePresets(
  slots: ChartSlot[],
  input: Record<string, unknown> | null | undefined,
): Record<string, WorkspaceRangePresetId> {
  const next: Record<string, WorkspaceRangePresetId> = {};
  slots.forEach((slot) => {
    const raw = input?.[slot.id];
    next[slot.id] = isRangePresetId(raw) ? raw : DEFAULT_RANGE_PRESET;
  });
  return next;
}

function getRangePreset(presetId: WorkspaceRangePresetId): { id: WorkspaceRangePresetId; label: string; rangeDays: number } {
  return WORKSPACE_RANGE_PRESETS.find((preset) => preset.id === presetId) ?? WORKSPACE_RANGE_PRESETS.find((preset) => preset.id === DEFAULT_RANGE_PRESET)!;
}

function buildTemplatePayload(
  snapshot: WorkspaceSnapshot,
  linkGroups: Record<string, WorkspaceLinkGroup>,
  linkSettings: WorkspaceLinkSettings,
  compareSymbols: string[],
  compareConfig: WorkspaceCompareConfig,
  rangePresets: Record<string, WorkspaceRangePresetId>,
): Record<string, unknown> {
  return {
    version: 3,
    slots: snapshot.slots,
    gridTemplate: snapshot.gridTemplate,
    syncCrosshair: snapshot.syncCrosshair,
    syncTimeframe: linkSettings.interval,
    linkGroups,
    linkSettings,
    compareSymbols,
    compareConfig,
    compareMode: compareConfig.mode,
    comparePlacement: compareConfig.placement,
    rangePresets,
  };
}

export function parseWorkspaceTemplateConfig(
  layoutConfig: Record<string, unknown>,
  fallbackMarket: SlotMarket = DEFAULT_WORKSTATION_IMPORT_MARKET,
): ParsedWorkspaceTemplate | null {
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
      const market = row.market === "US" ? "US" : row.market === "IN" ? "IN" : fallbackMarket;
      return buildTemplateSlot({
        id: typeof row.id === "string" ? row.id : undefined,
        ticker,
        companyName: typeof row.companyName === "string" ? row.companyName : null,
        timeframe,
        chartType,
        market,
        indicators: normalizeIndicatorConfigs(row.indicators),
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
    linkSettings: normalizeWorkspaceLinkSettings(
      isRecord(layoutConfig.linkSettings)
        ? layoutConfig.linkSettings
        : isRecord(layoutConfig.linkMatrix)
          ? layoutConfig.linkMatrix
          : null,
      {
        syncCrosshair: typeof layoutConfig.syncCrosshair === "boolean" ? layoutConfig.syncCrosshair : undefined,
        syncTimeframe: typeof layoutConfig.syncTimeframe === "boolean" ? layoutConfig.syncTimeframe : undefined,
      },
    ),
    compareConfig: normalizeWorkspaceCompareConfig(
      isRecord(layoutConfig.compareConfig)
        ? layoutConfig.compareConfig
        : isRecord(layoutConfig.compare)
          ? layoutConfig.compare
          : null,
      layoutConfig.compareMode,
      layoutConfig.comparePlacement,
    ),
    rangePresets: normalizeRangePresets(
      slots,
      isRecord(layoutConfig.rangePresets) ? layoutConfig.rangePresets : null,
    ),
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return isShortcutEditableTarget(target);
}

function isMenuTarget(target: EventTarget | null): boolean {
  return isShortcutMenuTarget(target);
}

function isPanelTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.hasAttribute("data-slot-id");
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
  crosshairLinked: boolean,
): WorkspaceSnapshot {
  return {
    slots: slots.map((slot) => ({
      ...slot,
      indicators: Array.isArray(slot.indicators) ? [...slot.indicators] : [],
      extendedHours: { ...slot.extendedHours },
      preMarketLevels: { ...slot.preMarketLevels },
    })),
    gridTemplate: { ...gridTemplate },
    syncCrosshair: crosshairLinked,
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

function resolveLinkedSlotIds(
  slots: ChartSlot[],
  sourceSlotId: string | null,
  groups: Record<string, WorkspaceLinkGroup>,
  enabled: boolean,
): string[] {
  if (!sourceSlotId) return [];
  if (!enabled) return [sourceSlotId];
  const sourceGroup = groups[sourceSlotId] ?? "off";
  if (sourceGroup === "off") return [sourceSlotId];
  return slots
    .filter((slot) => (groups[slot.id] ?? "off") === sourceGroup)
    .map((slot) => slot.id);
}

export function resolveCompareSlotIds(
  slots: ChartSlot[],
  activeSlotId: string | null,
  groups: Record<string, WorkspaceLinkGroup>,
  placement: WorkspaceComparePlacement,
): string[] {
  if (!activeSlotId) return [];
  if (placement === "all") return slots.map((slot) => slot.id);
  if (placement === "linked") {
    return resolveLinkedSlotIds(slots, activeSlotId, groups, true);
  }
  return [activeSlotId];
}

function readWorkspaceDefault(): WorkspaceDefaultConfig | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_DEFAULTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = parseWorkspaceTemplateConfig(parsed, DEFAULT_WORKSTATION_IMPORT_MARKET);
    if (!normalized) return null;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Default",
      ...normalized,
    };
  } catch {
    return null;
  }
}

function readWorkspaceTabs(
  fallbackSlots: ChartSlot[],
  fallbackTemplate: WorkspaceSnapshot["gridTemplate"],
  fallbackLinkSettings: WorkspaceLinkSettings,
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
            linkGroups: normalizeLinkGroups(tab.snapshot.slots, isRecord(tab.linkGroups) ? tab.linkGroups as Record<string, WorkspaceLinkGroup> : null),
            linkSettings: normalizeWorkspaceLinkSettings(
              isRecord((tab as unknown as Record<string, unknown>).linkSettings)
                ? (tab as unknown as Record<string, unknown>).linkSettings as Record<string, unknown>
                : isRecord((tab as unknown as Record<string, unknown>).linkMatrix)
                  ? (tab as unknown as Record<string, unknown>).linkMatrix as Record<string, unknown>
                  : null,
              {
                syncCrosshair: tab.snapshot.syncCrosshair,
                syncTimeframe: typeof (tab as unknown as Record<string, unknown>).syncTimeframe === "boolean"
                  ? (tab as unknown as Record<string, unknown>).syncTimeframe as boolean
                  : fallbackLinkSettings.interval,
              },
            ),
            compareSymbols: normalizeCompareSymbols(Array.isArray(tab.compareSymbols) ? tab.compareSymbols : []),
            compareConfig: normalizeWorkspaceCompareConfig(
              isRecord((tab as unknown as Record<string, unknown>).compareConfig)
                ? (tab as unknown as Record<string, unknown>).compareConfig as Record<string, unknown>
                : isRecord((tab as unknown as Record<string, unknown>).compare)
                  ? (tab as unknown as Record<string, unknown>).compare as Record<string, unknown>
                  : null,
              (tab as unknown as Record<string, unknown>).compareMode,
              (tab as unknown as Record<string, unknown>).comparePlacement,
            ),
            rangePresets: normalizeRangePresets(
              tab.snapshot.slots,
              isRecord((tab as unknown as Record<string, unknown>).rangePresets)
                ? (tab as unknown as Record<string, unknown>).rangePresets as Record<string, unknown>
                : null,
            ),
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
  const savedDefault = readWorkspaceDefault();
  const id = `ws-${Date.now()}`;
  if (savedDefault) {
    const isolatedDefault = parseWorkspaceTemplateConfig(
      isolateWorkstationLayoutConfig(
        buildTemplatePayload(
          savedDefault.snapshot,
          savedDefault.linkGroups,
          savedDefault.linkSettings,
          savedDefault.compareSymbols,
          savedDefault.compareConfig,
          savedDefault.rangePresets,
        ),
      ),
      DEFAULT_WORKSTATION_IMPORT_MARKET,
    );
    if (isolatedDefault) {
      return {
        tabs: [
          {
            id,
            name: savedDefault.name,
            snapshot: isolatedDefault.snapshot,
            linkGroups: isolatedDefault.linkGroups,
            linkSettings: isolatedDefault.linkSettings,
            compareSymbols: isolatedDefault.compareSymbols,
            compareConfig: isolatedDefault.compareConfig,
            rangePresets: isolatedDefault.rangePresets,
          },
        ],
        activeTabId: id,
      };
    }
    return {
      tabs: [
        {
          id,
          name: savedDefault.name,
          snapshot: savedDefault.snapshot,
          linkGroups: savedDefault.linkGroups,
          linkSettings: savedDefault.linkSettings,
          compareSymbols: savedDefault.compareSymbols,
          compareConfig: savedDefault.compareConfig,
          rangePresets: savedDefault.rangePresets,
        },
      ],
      activeTabId: id,
    };
  }
  return {
    tabs: [
      {
        id,
        name: "Main",
        snapshot: createWorkspaceSnapshot(fallbackSlots, fallbackTemplate, fallbackLinkSettings.crosshair),
        linkGroups: makeDefaultLinkGroups(fallbackSlots),
        linkSettings: fallbackLinkSettings,
        compareSymbols: [],
        compareConfig: DEFAULT_COMPARE_CONFIG,
        rangePresets: normalizeRangePresets(fallbackSlots, null),
      },
    ],
    activeTabId: id,
  };
}

export function ChartWorkstationPage() {
  const location = useLocation();
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
  const [linkSettings, setLinkSettings] = useState<WorkspaceLinkSettings>(DEFAULT_LINK_SETTINGS);
  const [compareConfig, setCompareConfig] = useState<WorkspaceCompareConfig>(DEFAULT_COMPARE_CONFIG);
  const [compareSeriesBySlotId, setCompareSeriesBySlotId] = useState<Record<string, Array<{ symbol: string; data: ChartPoint[]; color?: string }>>>({});
  const [rangePresets, setRangePresets] = useState<Record<string, WorkspaceRangePresetId>>({});
  const [rangePresetRevisions, setRangePresetRevisions] = useState<Record<string, number>>({});
  const [panelCommands, setPanelCommands] = useState<Record<string, PanelCommand | undefined>>({});
  const [replayCommands, setReplayCommands] = useState<Record<string, ReplayCommand | undefined>>({});
  const [replayDateDraft, setReplayDateDraft] = useState("");
  const [hasSavedDefault, setHasSavedDefault] = useState(false);
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState<WorkstationSnapshotRecord[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return normalizeStoredWorkstationSnapshots(JSON.parse(window.localStorage.getItem(WORKSTATION_SNAPSHOT_STORAGE_KEY) || "[]"));
    } catch {
      return [];
    }
  });
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
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
  const [scriptPanelOpen, setScriptPanelOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SCRIPT_PANEL_STORAGE_KEY) === "open";
  });
  const [scriptPanelSize, setScriptPanelSize] = useState(() => {
    if (typeof window === "undefined") return { width: 780, height: 560 };
    try {
      const raw = window.localStorage.getItem(SCRIPT_PANEL_SIZE_KEY);
      if (!raw) return { width: 780, height: 560 };
      const parsed = JSON.parse(raw) as Partial<{ width: number; height: number }>;
      return {
        width: typeof parsed.width === "number" ? Math.max(520, Math.min(1200, parsed.width)) : 780,
        height: typeof parsed.height === "number" ? Math.max(420, Math.min(900, parsed.height)) : 560,
      };
    } catch {
      return { width: 780, height: 560 };
    }
  });
  const [scriptScripts, setScriptScripts] = useState<OpenScriptLibraryItem[]>([]);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptSelectedId, setScriptSelectedId] = useState<string | null>(null);
  const [scriptTitle, setScriptTitle] = useState("My Custom Indicator");
  const [scriptDescription, setScriptDescription] = useState("");
  const [scriptSource, setScriptSource] = useState(DEFAULT_OPENSCRIPT_TEMPLATE);
  const [scriptPublic, setScriptPublic] = useState(false);
  const [scriptDirty, setScriptDirty] = useState(false);
  const [scriptCompileResult, setScriptCompileResult] = useState<OpenScriptCompileResult | null>(null);
  const [scriptRunResult, setScriptRunResult] = useState<OpenScriptRunResult | null>(null);
  const [scriptOverlayOutputs, setScriptOverlayOutputs] = useState<OpenScriptOutput[]>([]);
  const scriptPanelRef = useRef<HTMLDivElement | null>(null);
  const activeChartRowsRef = useRef<ChartPoint[]>([]);

  const initRef = useRef(false);
  const importedShareRef = useRef("");
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null,
    [activeWorkspaceTabId, workspaceTabs],
  );
  const activeCompareSymbolsStored = activeWorkspaceTab?.compareSymbols ?? [];
  const selectedWorkspaceSnapshot = useMemo(
    () => workspaceSnapshots.find((row) => row.id === selectedSnapshotId) ?? null,
    [selectedSnapshotId, workspaceSnapshots],
  );
  const activeWorkspaceLayoutConfig = useMemo(
    () =>
      buildTemplatePayload(
        createWorkspaceSnapshot(slots, gridTemplate, linkSettings.crosshair),
        normalizeLinkGroups(slots, slotLinkGroups),
        linkSettings,
        activeCompareSymbolsStored,
        compareConfig,
        normalizeRangePresets(slots, rangePresets),
      ),
    [activeCompareSymbolsStored, compareConfig, gridTemplate, linkSettings, rangePresets, slotLinkGroups, slots],
  );
  const activeWorkspacePayload = useMemo(
    () => buildWorkstationSnapshotPayload(activeWorkspaceTab?.name ?? "Main", activeWorkspaceLayoutConfig),
    [activeWorkspaceLayoutConfig, activeWorkspaceTab?.name],
  );

  const buildPayloadFromWorkspaceState = useCallback(
    (name: string, state: WorkspaceState): WorkstationSnapshotPayload =>
      buildWorkstationSnapshotPayload(
        name,
        buildTemplatePayload(
          state.snapshot,
          state.linkGroups,
          state.linkSettings,
          state.compareSymbols,
          state.compareConfig,
          state.rangePresets,
        ),
      ),
    [],
  );

  const refreshScripts = useCallback(async () => {
    setScriptLoading(true);
    try {
      const rows = await requestScriptJson<unknown[]>("/scripting/scripts", { method: "GET" });
      const normalized = Array.isArray(rows)
        ? rows.map((row) => normalizeScriptRecord(row)).filter((row): row is OpenScriptLibraryItem => Boolean(row))
        : [];
      setScriptScripts(normalized);
      setScriptSelectedId((current) => (current && normalized.some((row) => row.id === current) ? current : normalized[0]?.id ?? null));
    } catch {
      setScriptScripts([]);
      setScriptSelectedId((current) => current);
    } finally {
      setScriptLoading(false);
    }
  }, []);

  const applyScriptRecord = useCallback((record: OpenScriptLibraryItem | null) => {
    if (!record) {
      setScriptSelectedId(null);
      setScriptTitle("My Custom Indicator");
      setScriptDescription("");
      setScriptSource(DEFAULT_OPENSCRIPT_TEMPLATE);
      setScriptPublic(false);
      setScriptCompileResult(null);
      setScriptRunResult(null);
      setScriptOverlayOutputs([]);
      setScriptDirty(false);
      return;
    }
    setScriptSelectedId(record.id);
    setScriptTitle(record.name);
    setScriptDescription(record.description);
    setScriptSource(record.source);
    setScriptPublic(record.is_public);
    setScriptCompileResult(null);
    setScriptRunResult(null);
    setScriptOverlayOutputs([]);
    setScriptDirty(false);
  }, []);

  const previewCurrentScript = useCallback(
    async (scriptId: string, source: string, name: string, description: string, isPublic: boolean, saveAs: boolean) => {
      setScriptBusy(true);
      try {
        const compile = await requestScriptJson<OpenScriptCompileResult>("/scripting/compile", {
          method: "POST",
          body: JSON.stringify({ source }),
        });
        setScriptCompileResult(compile);
        if (!compile.success) {
          setScriptRunResult(null);
          setScriptOverlayOutputs([]);
          return false;
        }

        const payload = {
          name: name.trim() || "Untitled OpenScript",
          description,
          source,
          is_public: isPublic,
        };
        const saved = saveAs || !scriptId
          ? await requestScriptJson<OpenScriptLibraryItem>("/scripting/scripts", {
              method: "POST",
              body: JSON.stringify(payload),
            })
          : await requestScriptJson<OpenScriptLibraryItem>(`/scripting/scripts/${encodeURIComponent(scriptId)}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });

        await refreshScripts();
        setScriptSelectedId(saved.id);
        setScriptTitle(saved.name);
        setScriptDescription(saved.description);
        setScriptPublic(saved.is_public);
        setScriptDirty(false);

        const run = await requestScriptJson<OpenScriptRunResult>(`/scripting/scripts/${encodeURIComponent(saved.id)}/run`, {
          method: "POST",
          body: JSON.stringify({
            ohlcv: activeChartRowsRef.current.map((row) => ({
              time: row.t,
              open: row.o,
              high: row.h,
              low: row.l,
              close: row.c,
              volume: row.v,
            })),
          }),
        });
        setScriptRunResult(run);
        setScriptOverlayOutputs(toScriptOutputs(run.outputs));
        return true;
      } catch (error) {
        setScriptRunResult(null);
        setScriptOverlayOutputs([]);
        setLayoutNotice({
          title: "OpenScript failed",
          message: error instanceof Error ? error.message : "Unable to compile or run the script.",
          variant: "warning",
        });
        return false;
      } finally {
        setScriptBusy(false);
      }
    },
    [activeChartRowsRef, refreshScripts],
  );

  const saveScript = useCallback(() => {
    void previewCurrentScript(
      scriptSelectedId ?? "",
      scriptSource,
      scriptTitle,
      scriptDescription,
      scriptPublic,
      false,
    );
  }, [previewCurrentScript, scriptDescription, scriptPublic, scriptSelectedId, scriptSource, scriptTitle]);

  const saveScriptAs = useCallback(() => {
    void previewCurrentScript(
      "",
      scriptSource,
      `${scriptTitle} Copy`,
      scriptDescription,
      scriptPublic,
      true,
    );
  }, [previewCurrentScript, scriptDescription, scriptPublic, scriptSource, scriptTitle]);

  const runScript = useCallback(() => {
    void previewCurrentScript(
      scriptSelectedId ?? "",
      scriptSource,
      scriptTitle,
      scriptDescription,
      scriptPublic,
      false,
    );
  }, [previewCurrentScript, scriptDescription, scriptPublic, scriptSelectedId, scriptSource, scriptTitle]);

  const rerunSelectedScript = useCallback(async () => {
    if (!scriptSelectedId || scriptDirty) return;
    try {
      const run = await requestScriptJson<OpenScriptRunResult>(`/scripting/scripts/${encodeURIComponent(scriptSelectedId)}/run`, {
        method: "POST",
        body: JSON.stringify({
          ohlcv: activeChartRowsRef.current.map((row) => ({
            time: row.t,
            open: row.o,
            high: row.h,
            low: row.l,
            close: row.c,
            volume: row.v,
          })),
        }),
      });
        setScriptRunResult(run);
        setScriptOverlayOutputs(toScriptOutputs(run.outputs));
      } catch {
        // ignore rerun failures while data is still settling
      }
  }, [activeChartRowsRef, scriptDirty, scriptSelectedId]);

  const deleteScript = useCallback(async () => {
    if (!scriptSelectedId) {
      applyScriptRecord(null);
      return;
    }
    setScriptBusy(true);
    try {
      await requestScriptJson<{ deleted: boolean; id: string }>(`/scripting/scripts/${encodeURIComponent(scriptSelectedId)}`, {
        method: "DELETE",
      });
      await refreshScripts();
      applyScriptRecord(null);
    } catch (error) {
      setLayoutNotice({
        title: "Delete failed",
        message: error instanceof Error ? error.message : "Unable to delete the script.",
        variant: "warning",
      });
    } finally {
      setScriptBusy(false);
    }
  }, [applyScriptRecord, refreshScripts, scriptSelectedId]);

  const selectScript = useCallback(
    (scriptId: string) => {
      const record = scriptScripts.find((row) => row.id === scriptId) ?? null;
      applyScriptRecord(record);
    },
    [applyScriptRecord, scriptScripts],
  );

  const newScript = useCallback(() => {
    applyScriptRecord(null);
  }, [applyScriptRecord]);

  const toggleScriptPanel = useCallback(() => {
    setScriptPanelOpen((value) => !value);
  }, []);

  const applyWorkspaceState = useCallback((nextState: WorkspaceState) => {
    setSlotLinkGroups(normalizeLinkGroups(nextState.snapshot.slots, nextState.linkGroups));
    setLinkSettings(nextState.linkSettings);
    setCompareConfig(nextState.compareConfig);
    setRangePresets(normalizeRangePresets(nextState.snapshot.slots, nextState.rangePresets));
    setRangePresetRevisions({});
    setReplayCommands({});
    setReplayDateDraft("");
    useChartWorkstationStore.setState({
      slots: nextState.snapshot.slots,
      gridTemplate: nextState.snapshot.gridTemplate,
      syncCrosshair: nextState.linkSettings.crosshair,
      syncTimeframe: nextState.linkSettings.interval,
      activeSlotId: nextState.snapshot.slots[0]?.id ?? null,
    });
    setFullscreenSlotId(null);
  }, []);

  const materializeWorkspaceFromLayout = useCallback(
    (
      name: string,
      layoutConfig: Record<string, unknown>,
      openAsNewTab: boolean,
      options?: {
        isolateSlotIds?: boolean;
      },
    ): WorkspaceTab | null => {
      const isolateSlotIds = options?.isolateSlotIds ?? true;
      const parsed = parseWorkspaceTemplateConfig(
        isolateSlotIds ? isolateWorkstationLayoutConfig(layoutConfig) : layoutConfig,
        DEFAULT_WORKSTATION_IMPORT_MARKET,
      );
      if (!parsed) return null;

      const nextTabId = openAsNewTab ? `ws-${Date.now()}` : activeWorkspaceTabId ?? `ws-${Date.now()}`;
      const nextTab: WorkspaceTab = {
        id: nextTabId,
        name: openAsNewTab ? name : (activeWorkspaceTab?.name || name),
        snapshot: parsed.snapshot,
        linkGroups: parsed.linkGroups,
        linkSettings: parsed.linkSettings,
        compareSymbols: parsed.compareSymbols,
        compareConfig: parsed.compareConfig,
        rangePresets: parsed.rangePresets,
      };

      setWorkspaceTabs((prev) => {
        if (openAsNewTab) return [...prev, nextTab];
        if (!prev.some((tab) => tab.id === nextTabId)) return [...prev, nextTab];
        return prev.map((tab) => (tab.id === nextTabId ? nextTab : tab));
      });
      setActiveWorkspaceTabId(nextTabId);
      applyWorkspaceState(nextTab);
      return nextTab;
    },
    [activeWorkspaceTab?.name, activeWorkspaceTabId, applyWorkspaceState],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    try {
      localStorage.removeItem(LEGACY_WORKSTATION_STORE_KEY);
    } catch {
      // ignore cleanup failures
    }

    const persisted = readWorkspaceTabs(
      slots,
      gridTemplate,
      normalizeWorkspaceLinkSettings(null, {
        syncCrosshair,
        syncTimeframe,
      }),
    );
    setWorkspaceTabs(persisted.tabs);
    setActiveWorkspaceTabId(persisted.activeTabId);
    setHasSavedDefault(Boolean(readWorkspaceDefault()));

    const active = persisted.tabs.find((tab) => tab.id === persisted.activeTabId) ?? persisted.tabs[0];
    if (active) {
      applyWorkspaceState(active);
    }

    setWorkspaceReady(true);
  }, [applyWorkspaceState, gridTemplate, slots, syncCrosshair, syncTimeframe]);

  useEffect(() => {
    setSelectedSnapshotId((prev) => (prev && workspaceSnapshots.some((row) => row.id === prev) ? prev : workspaceSnapshots[0]?.id ?? ""));
  }, [workspaceSnapshots]);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSTATION_SNAPSHOT_STORAGE_KEY, JSON.stringify(workspaceSnapshots));
    } catch {
      // ignore snapshot persistence failures
    }
  }, [workspaceSnapshots]);

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
        const newSnapshot = createWorkspaceSnapshot(slots, gridTemplate, linkSettings.crosshair);
        const newLinkGroups = normalizeLinkGroups(slots, slotLinkGroups);
        const newRangePresets = normalizeRangePresets(slots, rangePresets);
        const snapshotSame = JSON.stringify(tab.snapshot) === JSON.stringify(newSnapshot);
        const linkGroupsSame = JSON.stringify(tab.linkGroups) === JSON.stringify(newLinkGroups);
        const linkSettingsSame = JSON.stringify(tab.linkSettings) === JSON.stringify(linkSettings);
        const compareConfigSame = JSON.stringify(tab.compareConfig) === JSON.stringify(compareConfig);
        const rangePresetsSame = JSON.stringify(tab.rangePresets) === JSON.stringify(newRangePresets);

        if (snapshotSame && linkGroupsSame && linkSettingsSame && compareConfigSame && rangePresetsSame) return tab;

        changed = true;
        return {
          ...tab,
          snapshot: newSnapshot,
          linkGroups: newLinkGroups,
          linkSettings,
          compareConfig,
          rangePresets: newRangePresets,
        };
      });
      return changed ? next : prev;
    });
  }, [activeWorkspaceTabId, compareConfig, gridTemplate, linkSettings, rangePresets, slotLinkGroups, slots, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !activeWorkspaceTabId) return;
    setRangePresets((prev) => {
      const next = normalizeRangePresets(slots, prev);
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
  }, [activeWorkspaceTabId, slots, workspaceReady]);

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

  useEffect(() => {
    if (!workspaceReady) return;
    const params = new URLSearchParams(location.search);
    const shared = params.get(WORKSTATION_SHARE_QUERY_PARAM);
    if (!shared || importedShareRef.current === shared) return;

    importedShareRef.current = shared;
    const payload = decodeWorkstationSharePayload(shared);
    if (!payload) {
      setLayoutNotice({
        title: "Shared workspace invalid",
        message: "The shared workstation payload could not be decoded.",
        variant: "warning",
      });
    } else {
      const nextTab = materializeWorkspaceFromLayout(payload.name, payload.layout_config, true);
      setLayoutNotice({
        title: nextTab ? "Shared workspace opened" : "Shared workspace invalid",
        message: nextTab
          ? `${payload.name} opened in a new tab. Drawings remain scoped to the receiving workspace.`
          : "The shared workstation payload did not contain a usable layout.",
        variant: nextTab ? "success" : "warning",
      });
    }

    params.delete(WORKSTATION_SHARE_QUERY_PARAM);
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, materializeWorkspaceFromLayout, navigate, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return;
    if (syncCrosshair !== linkSettings.crosshair) {
      setSyncCrosshair(linkSettings.crosshair);
    }
    if (syncTimeframe !== linkSettings.interval) {
      setSyncTimeframe(linkSettings.interval);
    }
  }, [linkSettings.crosshair, linkSettings.interval, setSyncCrosshair, setSyncTimeframe, syncCrosshair, syncTimeframe, workspaceReady]);

  const visibleCapacity = getLayoutCapacity(gridTemplate.cols || 1, gridTemplate.rows || 1);
  const visibleSlots = useMemo(() => slots.slice(0, visibleCapacity), [slots, visibleCapacity]);
  const hiddenSlotCount = Math.max(0, slots.length - visibleSlots.length);
  const canAddVisibleSlot =
    slots.length < MAX_WORKSTATION_SLOTS && visibleSlots.length < visibleCapacity;
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
  const compareTargetSlotIds = useMemo(
    () => resolveCompareSlotIds(visibleSlots, activeSlotId, slotLinkGroups, compareConfig.placement),
    [activeSlotId, compareConfig.placement, slotLinkGroups, visibleSlots],
  );
  const activeRangePreset = activeSlot ? (rangePresets[activeSlot.id] ?? DEFAULT_RANGE_PRESET) : DEFAULT_RANGE_PRESET;
  const activePaneIndex = activeSlot ? visibleSlots.findIndex((slot) => slot.id === activeSlot.id) + 1 : 0;
  const denseShell = visibleSlots.length >= 4 || hiddenSlotCount > 0 || gridTemplate.rows > 1;
  const linkedSymbolCount = useMemo(() => {
    if (!activeSlot || activeLinkGroup === "off") return activeSlot?.ticker ? 1 : 0;
    return slots.filter((slot) => (slotLinkGroups[slot.id] ?? "off") === activeLinkGroup && slot.ticker).length;
  }, [activeLinkGroup, activeSlot, slotLinkGroups, slots]);

  const { bySlotId: chartBatchBySlotId, loadingAny: batchLoadingAny, source: chartBatchSource } = useBatchChartData(visibleSlots);
  const { connectionState: quotesConnectionState, quoteBySlotId } = useWorkstationQuotes(visibleSlots);
  const activeChartResponse = activeSlot ? chartBatchBySlotId[activeSlot.id]?.data ?? null : null;
  const activeChartRows = activeChartResponse?.data ?? [];
  const activeScriptRecord = useMemo(
    () => scriptScripts.find((row) => row.id === scriptSelectedId) ?? null,
    [scriptScripts, scriptSelectedId],
  );

  useEffect(() => {
    activeChartRowsRef.current = activeChartRows;
  }, [activeChartRows]);

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

  useEffect(() => {
    void refreshScripts();
  }, [refreshScripts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SCRIPT_PANEL_STORAGE_KEY, scriptPanelOpen ? "open" : "closed");
  }, [scriptPanelOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SCRIPT_PANEL_SIZE_KEY, JSON.stringify(scriptPanelSize));
  }, [scriptPanelSize]);

  useEffect(() => {
    if (!scriptPanelOpen || typeof ResizeObserver === "undefined") return;
    const el = scriptPanelRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(520, Math.min(1200, Math.round(entry.contentRect.width)));
      const nextHeight = Math.max(420, Math.min(900, Math.round(entry.contentRect.height)));
      setScriptPanelSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scriptPanelOpen]);

  useEffect(() => {
    if (!scriptPanelOpen || scriptDirty || !scriptSelectedId) return;
    void rerunSelectedScript();
  }, [activeChartRows, rerunSelectedScript, scriptDirty, scriptPanelOpen, scriptSelectedId]);

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
    if (!activeCompareSymbols.length || !compareTargetSlotIds.length) {
      setCompareSeriesBySlotId({});
      return;
    }

    const targetSlots = visibleSlots.filter((slot) => compareTargetSlotIds.includes(slot.id) && slot.ticker);
    if (!targetSlots.length) {
      setCompareSeriesBySlotId({});
      return;
    }

    Promise.all(
      targetSlots.map(async (slot) => {
        const market = slot.market === "IN" ? "NSE" : "NASDAQ";
        const interval = TIMEFRAME_TO_INTERVAL[slot.timeframe];
        const extended = slot.extendedHours.enabled && slot.market === "US";
        const compareSymbols = activeCompareSymbols.filter((symbol) => symbol !== slot.ticker?.toUpperCase());
        const rows = await Promise.all(
          compareSymbols.map(async (symbol, idx) => {
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
        );
        return {
          slotId: slot.id,
          series: rows.filter((row) => row.data.length > 0),
        };
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, Array<{ symbol: string; data: ChartPoint[]; color?: string }>> = {};
        rows.forEach((row) => {
          next[row.slotId] = row.series;
        });
        setCompareSeriesBySlotId(next);
      })
      .catch(() => {
        if (cancelled) return;
        setCompareSeriesBySlotId({});
      });

    return () => {
      cancelled = true;
    };
  }, [activeCompareSymbols, compareTargetSlotIds, visibleSlots]);

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
        if (!linkSettings.symbol) return;
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
    [linkSettings.symbol, slotLinkGroups, updateSlotTicker],
  );

  const handleTimeframeChange = useCallback(
    (slotId: string) =>
      (tf: ChartSlotTimeframe) => {
        updateSlotTimeframe(slotId, tf);
        const slot = slots.find((s) => s.id === slotId);
        const isUS = (slot?.market ?? "IN") === "US";
        updateSlotETH(slotId, { enabled: isUS && shouldDefaultExtendedHoursOn(tf) });
        if (!linkSettings.interval) return;
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
    [linkSettings.interval, slotLinkGroups, slots, updateSlotTimeframe, updateSlotETH],
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
      applyWorkspaceState(next);
    },
    [applyWorkspaceState, workspaceTabs],
  );

  const handleAddWorkspaceTab = useCallback(() => {
    materializeWorkspaceFromLayout(`Workspace ${workspaceTabs.length + 1}`, activeWorkspaceLayoutConfig, true);
  }, [activeWorkspaceLayoutConfig, materializeWorkspaceFromLayout, workspaceTabs.length]);

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
    const nextTab = materializeWorkspaceFromLayout(template.name, template.layout_config, openAsNewTab);
    if (!nextTab) {
      setTemplateNotice({
        title: "Template skipped",
        message: "Selected template does not contain a usable workstation layout.",
        variant: "warning",
      });
      return;
    }

    setTemplateNotice({
      title: openAsNewTab ? "Template opened in new tab" : "Template applied",
      message: `${template.name} loaded with ${nextTab.snapshot.slots.length} pane(s).`,
      variant: "success",
    });
  }, [materializeWorkspaceFromLayout]);

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
        layout_config: activeWorkspaceLayoutConfig,
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
  }, [activeWorkspaceLayoutConfig, refreshTemplates, templateDraftName]);

  const handleAddCompareSymbol = useCallback(() => {
    const next = normalizeCompareSymbols([...activeCompareSymbols, compareInput], activeTicker);
    updateActiveTabCompareSymbols(next);
    setCompareInput("");
  }, [activeCompareSymbols, activeTicker, compareInput, updateActiveTabCompareSymbols]);

  const handleRemoveCompareSymbol = useCallback((symbol: string) => {
    updateActiveTabCompareSymbols(activeCompareSymbols.filter((row) => row !== symbol));
  }, [activeCompareSymbols, updateActiveTabCompareSymbols]);

  const handleApplySelectedTemplate = useCallback(() => {
    const template = templates.find((row) => row.id === selectedTemplateId);
    if (template) applyTemplateToWorkspace(template, false);
  }, [applyTemplateToWorkspace, selectedTemplateId, templates]);

  const handleOpenTemplateInNewTab = useCallback(() => {
    const template = templates.find((row) => row.id === selectedTemplateId);
    if (template) applyTemplateToWorkspace(template, true);
  }, [applyTemplateToWorkspace, selectedTemplateId, templates]);

  const handleSetLinkDimension = useCallback((dimension: WorkspaceLinkDimension, enabled: boolean) => {
    setLinkSettings((prev) => ({ ...prev, [dimension]: enabled }));
  }, []);

  const handleSetComparePlacement = useCallback((placement: WorkspaceComparePlacement) => {
    setCompareConfig((prev) => ({ ...prev, placement }));
  }, []);

  const handleSetCompareMode = useCallback((mode: WorkspaceCompareConfig["mode"]) => {
    setCompareConfig((prev) => ({ ...prev, mode }));
  }, []);

  const reportMissingActivePane = useCallback((actionLabel: string): CommandExecutionResult => {
    const message = `${actionLabel} requires an active chart pane. Click a pane or use 1-9 first.`;
    setLayoutNotice({
      title: "No active pane",
      message,
      variant: "warning",
    });
    return { ok: false, message };
  }, []);

  const reportMissingActiveSymbol = useCallback((actionLabel: string): CommandExecutionResult => {
    const message = `${actionLabel} requires a symbol on the active chart pane. Load a symbol and retry.`;
    setLayoutNotice({
      title: "No active symbol",
      message,
      variant: "warning",
    });
    return { ok: false, message };
  }, []);

  const handleSetRangePreset = useCallback((presetId: WorkspaceRangePresetId) => {
    const targetIds = resolveLinkedSlotIds(slots, activeSlotId, slotLinkGroups, linkSettings.dateRange);
    if (!targetIds.length) return;
    setRangePresets((prev) => {
      const next = { ...normalizeRangePresets(slots, prev) };
      targetIds.forEach((slotId) => {
        next[slotId] = presetId;
      });
      return next;
    });
    setRangePresetRevisions((prev) => {
      const next = { ...prev };
      targetIds.forEach((slotId) => {
        next[slotId] = (next[slotId] ?? 0) + 1;
      });
      return next;
    });
  }, [activeSlotId, linkSettings.dateRange, slotLinkGroups, slots]);

  const dispatchPanelCommand = useCallback((commandId: PanelCommand["id"]): CommandExecutionResult => {
    if (!activeSlotId) {
      const actionLabel =
        commandId === "toggleIndicators"
          ? "Indicator toggle"
          : commandId === "toggleDrawingTools"
            ? "Drawing tools"
            : "Volume profile";
      return reportMissingActivePane(actionLabel);
    }
    setPanelCommands((prev) => ({
      ...prev,
      [activeSlotId]: {
        id: commandId,
        revision: (prev[activeSlotId]?.revision ?? 0) + 1,
      },
    }));
    focusPanelBySlotId(activeSlotId);
    return { ok: true };
  }, [activeSlotId, reportMissingActivePane]);

  const dispatchReplayCommand = useCallback((command: Omit<ReplayCommand, "revision">): CommandExecutionResult => {
    const targetIds = resolveLinkedSlotIds(visibleSlots, activeSlotId, slotLinkGroups, linkSettings.replay);
    if (!targetIds.length) {
      return reportMissingActivePane("Replay controls");
    }
    setReplayCommands((prev) => {
      const next = { ...prev };
      targetIds.forEach((slotId) => {
        next[slotId] = {
          ...command,
          revision: (next[slotId]?.revision ?? 0) + 1,
        };
      });
      return next;
    });
    return { ok: true };
  }, [activeSlotId, linkSettings.replay, reportMissingActivePane, slotLinkGroups, visibleSlots]);

  const handleToggleReplay = useCallback(() => {
    return dispatchReplayCommand({ type: "toggle" });
  }, [dispatchReplayCommand]);

  const handleReplayGoToDate = useCallback(() => {
    const trimmed = replayDateDraft.trim();
    if (!trimmed) return { ok: false, message: "Enter a replay date before applying it" };
    return dispatchReplayCommand({ type: "goToDate", date: trimmed });
  }, [dispatchReplayCommand, replayDateDraft]);

  const handleToggleMaximize = useCallback(() => {
    if (fullscreenSlotId) {
      setFullscreenSlotId(null);
      return { ok: true };
    }
    if (!activeSlotId) return reportMissingActivePane("Maximize");
    setFullscreenSlotId(activeSlotId);
    return { ok: true };
  }, [activeSlotId, fullscreenSlotId, reportMissingActivePane]);

  const handleSaveWorkspaceDefault = useCallback(() => {
    try {
      localStorage.setItem(
        WORKSPACE_DEFAULTS_KEY,
        JSON.stringify({
          name: activeWorkspaceTab?.name ?? "Main",
          ...activeWorkspaceLayoutConfig,
        }),
      );
      setHasSavedDefault(true);
      setLayoutNotice({
        title: "Workspace default saved",
        message: "Current layout, link matrix, compare scope, and range presets will seed new workspaces.",
        variant: "success",
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to persist workstation defaults.";
      setLayoutNotice({
        title: "Default save failed",
        message,
        variant: "warning",
      });
      return { ok: false, message };
    }
  }, [activeWorkspaceLayoutConfig, activeWorkspaceTab?.name]);

  const handleRestoreWorkspaceDefault = useCallback(() => {
    const savedDefault = readWorkspaceDefault();
    if (!savedDefault) {
      const message = "Save a workspace default before trying to restore it.";
      setLayoutNotice({
        title: "No saved default",
        message,
        variant: "warning",
      });
      return { ok: false, message };
    }

    const payload = buildPayloadFromWorkspaceState(savedDefault.name, savedDefault);
    const nextTab = materializeWorkspaceFromLayout(savedDefault.name, payload.layout_config, false, {
      isolateSlotIds: false,
    });
    if (!nextTab) {
      const message = "Saved workspace default did not contain a usable layout.";
      setLayoutNotice({
        title: "Default restore failed",
        message,
        variant: "warning",
      });
      return { ok: false, message };
    }
    setLayoutNotice({
      title: "Workspace default restored",
      message: "The active workspace now matches your saved default configuration with fresh pane scopes.",
      variant: "success",
    });
    return { ok: true };
  }, [buildPayloadFromWorkspaceState, materializeWorkspaceFromLayout]);

  const handleSaveWorkspaceSnapshot = useCallback(() => {
    const record = createWorkstationSnapshotRecord(activeWorkspacePayload.name, activeWorkspaceLayoutConfig);
    setWorkspaceSnapshots((prev) => [record, ...prev].slice(0, 16));
    setSelectedSnapshotId(record.id);
    setLayoutNotice({
      title: "Workspace snapshot saved",
      message: `${record.name} saved. Snapshot payloads exclude pane-scoped drawings and chart surface toggles by design.`,
      variant: "success",
    });
    return { ok: true };
  }, [activeWorkspaceLayoutConfig, activeWorkspacePayload.name]);

  const handleApplySelectedSnapshot = useCallback((openAsNewTab: boolean) => {
    if (!selectedWorkspaceSnapshot) return { ok: false, message: "Select a snapshot first" };
    const nextTab = materializeWorkspaceFromLayout(
      selectedWorkspaceSnapshot.payload.name,
      selectedWorkspaceSnapshot.payload.layout_config,
      openAsNewTab,
    );
    if (!nextTab) {
      const message = "Selected snapshot did not contain a usable workstation layout.";
      setLayoutNotice({
        title: "Snapshot restore failed",
        message,
        variant: "warning",
      });
      return { ok: false, message };
    }
    setLayoutNotice({
      title: openAsNewTab ? "Snapshot opened in new tab" : "Snapshot restored",
      message: `${selectedWorkspaceSnapshot.name} loaded with fresh pane scopes.`,
      variant: "success",
    });
    return { ok: true };
  }, [materializeWorkspaceFromLayout, selectedWorkspaceSnapshot]);

  const handleCopyShareLink = useCallback(async () => {
    if (typeof window === "undefined") return { ok: false, message: "Clipboard unavailable" };
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(WORKSTATION_SHARE_QUERY_PARAM, encodeWorkstationSharePayload(activeWorkspacePayload));
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      setLayoutNotice({
        title: "Share link copied",
        message: "The link includes layout, chart, and indicator state. Drawings remain workspace-scoped.",
        variant: "success",
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clipboard access was not available.";
      setLayoutNotice({
        title: "Share link failed",
        message,
        variant: "warning",
      });
      return { ok: false, message };
    }
  }, [activeWorkspacePayload]);

  const handleExportWorkspaceJson = useCallback(() => {
    downloadTextFile(
      buildWorkstationExportFilename(activeWorkspacePayload.name, "json"),
      JSON.stringify(activeWorkspacePayload, null, 2),
    );
    setLayoutNotice({
      title: "Workspace export ready",
      message: "The exported JSON is deterministic for the current layout payload and excludes pane-scoped drawings.",
      variant: "success",
    });
    return { ok: true };
  }, [activeWorkspacePayload]);

  const handleOpenAlerts = useCallback(() => {
    if (!activeSlotId) return reportMissingActivePane("Alert center");
    if (!activeTicker) return reportMissingActiveSymbol("Alert center");
    setTicker(activeTicker);
    navigate(`/equity/alerts?ticker=${encodeURIComponent(activeTicker)}`);
    return { ok: true };
  }, [activeSlotId, activeTicker, navigate, reportMissingActivePane, reportMissingActiveSymbol, setTicker]);

  const drillInto = useCallback((route: "security" | "news" | "screener" | "compare" | "portfolio") => {
    if (!activeTicker) return reportMissingActiveSymbol("Navigation");
    setTicker(activeTicker);
    if (route === "security") {
      navigate(`/equity/security/${activeTicker}`);
    } else if (route === "news") {
      navigate(`/equity/news?ticker=${encodeURIComponent(activeTicker)}`);
    } else if (route === "screener") {
      navigate(`/equity/screener?symbol=${encodeURIComponent(activeTicker)}`);
    } else if (route === "compare") {
      const compareSymbols = [activeTicker, ...activeCompareSymbols].join(",");
      navigate(`/equity/compare?symbols=${encodeURIComponent(compareSymbols)}`);
    } else {
      navigate(`/equity/portfolio?ticker=${encodeURIComponent(activeTicker)}`);
    }
    return { ok: true };
  }, [activeCompareSymbols, activeTicker, navigate, reportMissingActiveSymbol, setTicker]);

  const handleChartWorkstationAction = useCallback((actionId: ChartWorkstationActionId): CommandExecutionResult => {
    if (actionId === "chart.toggleIndicators") return dispatchPanelCommand("toggleIndicators");
    if (actionId === "chart.toggleDrawingTools") return dispatchPanelCommand("toggleDrawingTools");
    if (actionId === "chart.toggleVolumeProfile") return dispatchPanelCommand("toggleVolumeProfile");
    if (actionId === "chart.toggleReplay") return handleToggleReplay();
    if (actionId === "chart.openAlerts") return handleOpenAlerts();
    return { ok: false, message: "Unknown chart workstation action" };
  }, [dispatchPanelCommand, handleOpenAlerts, handleToggleReplay]);

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
    const onChartAction = (event: Event) => {
      const detail = (event as CustomEvent<ChartWorkstationActionEventDetail>).detail;
      if (!detail?.id) return;
      const result = handleChartWorkstationAction(detail.id);
      detail.handled = true;
      detail.ok = result.ok;
      detail.message = result.message;
    };

    window.addEventListener(CHART_WORKSTATION_ACTION_EVENT, onChartAction as EventListener);
    return () => window.removeEventListener(CHART_WORKSTATION_ACTION_EVENT, onChartAction as EventListener);
  }, [handleChartWorkstationAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (isMenuTarget(event.target)) return;
      const chartPaneFocused =
        isShortcutWithinChartPanel(event.target) ||
        isShortcutWithinChartPanel(document.activeElement);

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        if (!isPanelTarget(event.target)) return;
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

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && chartPaneFocused) {
        const key = event.key.toLowerCase();
        if (key === "i") {
          event.preventDefault();
          dispatchPanelCommand("toggleIndicators");
          return;
        }
        if (key === "d") {
          event.preventDefault();
          dispatchPanelCommand("toggleDrawingTools");
          return;
        }
        if (key === "v") {
          event.preventDefault();
          dispatchPanelCommand("toggleVolumeProfile");
          return;
        }
        if (key === "r") {
          event.preventDefault();
          handleToggleReplay();
          return;
        }
        if (key === "a") {
          event.preventDefault();
          handleOpenAlerts();
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        toggleScriptPanel();
        return;
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
    dispatchPanelCommand,
    fullscreenSlotId,
    handleAddSlot,
    handleOpenAlerts,
    handleToggleReplay,
    handleTimeframeChange,
    removeSlot,
    toggleScriptPanel,
    setActiveSlot,
    slots,
    visibleSlots,
  ]);

  const scriptOverlayTarget =
    typeof document !== "undefined" && activeSlotId
      ? document.querySelector<HTMLElement>(`.chart-panel[data-slot-id="${activeSlotId}"] .chart-panel-body`)
      : null;
  const scriptOverlaySeries = useMemo(
    () => scriptOverlayOutputs.find((item) => item.series.some((value) => typeof value === "number" && Number.isFinite(value)))?.series ?? [],
    [scriptOverlayOutputs],
  );


  return (
    <CrosshairSyncProvider enabled={linkSettings.crosshair}>
      <div className="chart-workstation flex h-full flex-col bg-terminal-canvas text-terminal-text" data-testid="chart-workstation">
        <div className="border-b border-terminal-border bg-terminal-panel px-3 py-3">
          <ChartShellToolbar
            dense={denseShell}
            visiblePaneCount={visibleSlots.length}
            totalPaneCount={slots.length}
            hiddenPaneCount={hiddenSlotCount}
            activePaneIndex={activePaneIndex}
            activeSlot={activeSlot}
            activeLinkGroup={activeLinkGroup}
            linkedSymbolCount={linkedSymbolCount}
            canAddVisibleSlot={canAddVisibleSlot}
            compareInput={compareInput}
            compareMode={compareConfig.mode}
            comparePlacement={compareConfig.placement}
            activeCompareSymbols={activeCompareSymbols}
            activeRangePreset={activeRangePreset}
            replayDateDraft={replayDateDraft}
            linkSettings={linkSettings}
            isMaximized={Boolean(fullscreenSlotId)}
            hasSavedDefault={hasSavedDefault}
            persistenceBoundaryNote={WORKSTATION_BOUNDARY_SUMMARY}
            workspaceTabs={workspaceTabs.map((tab) => ({ id: tab.id, name: tab.name }))}
            activeWorkspaceTabId={activeWorkspaceTabId}
            templates={templates.map((template) => ({ id: template.id, name: template.name }))}
            templatesLoading={templatesLoading}
            selectedTemplateId={selectedTemplateId}
            templateDraftName={templateDraftName}
            snapshots={workspaceSnapshots.map((snapshot) => ({
              id: snapshot.id,
              label: `${snapshot.name} | ${new Date(snapshot.createdAt).toLocaleString()}`,
            }))}
            selectedSnapshotId={selectedSnapshotId}
            quotesConnectionState={quotesConnectionState}
            chartBatchSource={chartBatchSource}
            batchLoadingAny={batchLoadingAny}
            gridTemplate={gridTemplate}
            onSwitchWorkspaceTab={switchWorkspaceTab}
            onAddWorkspaceTab={handleAddWorkspaceTab}
            onRemoveWorkspaceTab={handleRemoveWorkspaceTab}
            onLayoutChange={handleLayoutChange}
            onAddPane={handleAddSlot}
            onApplyMultiTimeframePreset={applyMultiTimeframePreset}
            onApplyCustomSplit={() => handleLayoutChange(CUSTOM_SPLIT_TEMPLATE)}
            onTickerChange={(ticker, market, companyName) => {
              if (!activeSlot) return;
              handleTickerChange(activeSlot.id)(ticker, market, companyName);
            }}
            onTimeframeChange={(timeframe) => {
              if (!activeSlot) return;
              handleTimeframeChange(activeSlot.id)(timeframe);
            }}
            onChartTypeChange={(chartType) => {
              if (!activeSlot) return;
              handleChartTypeChange(activeSlot.id)(chartType);
            }}
            onLinkGroupChange={(group) => {
              if (!activeSlot) return;
              setSlotLinkGroups((prev) => ({ ...prev, [activeSlot.id]: group }));
            }}
            onSetCompareInput={(value) => setCompareInput(value)}
            onSetCompareMode={handleSetCompareMode}
            onSetComparePlacement={handleSetComparePlacement}
            onAddCompareSymbol={handleAddCompareSymbol}
            onRemoveCompareSymbol={handleRemoveCompareSymbol}
            onOpenAlerts={handleOpenAlerts}
            onToggleReplay={handleToggleReplay}
            onReplayStepBack={() => dispatchReplayCommand({ type: "stepBack" })}
            onReplayStepForward={() => dispatchReplayCommand({ type: "stepForward" })}
            onReplayPrevSession={() => dispatchReplayCommand({ type: "prevSession" })}
            onReplayNextSession={() => dispatchReplayCommand({ type: "nextSession" })}
            onSetReplayDateDraft={setReplayDateDraft}
            onCommitReplayDate={handleReplayGoToDate}
            onSetLinkDimension={handleSetLinkDimension}
            onSetRangePreset={handleSetRangePreset}
            onToggleMaximize={handleToggleMaximize}
            onSaveWorkspaceDefault={handleSaveWorkspaceDefault}
            onRestoreWorkspaceDefault={handleRestoreWorkspaceDefault}
            onSaveWorkspaceSnapshot={handleSaveWorkspaceSnapshot}
            onSetSelectedSnapshotId={(value) => setSelectedSnapshotId(value)}
            onApplySelectedSnapshot={() => handleApplySelectedSnapshot(false)}
            onOpenSnapshotInNewTab={() => handleApplySelectedSnapshot(true)}
            onCopyShareLink={() => {
              void handleCopyShareLink();
            }}
            onExportWorkspaceJson={handleExportWorkspaceJson}
            onSetSelectedTemplateId={(value) => setSelectedTemplateId(value)}
            onApplySelectedTemplate={handleApplySelectedTemplate}
            onOpenTemplateInNewTab={handleOpenTemplateInNewTab}
            onSetTemplateDraftName={(value) => setTemplateDraftName(value)}
            onSaveCurrentTemplate={handleSaveCurrentTemplate}
            onDrillInto={drillInto}
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={toggleScriptPanel}
            >
              {scriptPanelOpen ? "Hide OpenScript" : "Open OpenScript"}
            </button>
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
                panelIndex={visibleSlots.findIndex((row) => row.id === slot.id) + 1}
                visiblePanelCount={visibleSlots.length}
                denseToolbar={denseShell}
                onActivate={() => setActiveSlot(slot.id)}
                onToggleFullscreen={() =>
                  setFullscreenSlotId((prev) => (prev === slot.id ? null : slot.id))
                }
                onRemove={() => removeSlot(slot.id)}
                linkGroup={slotLinkGroups[slot.id] ?? "off"}
                linkSettings={linkSettings}
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
                comparisonSeries={compareSeriesBySlotId[slot.id] ?? []}
                comparisonMode={compareConfig.mode}
                panelCommand={panelCommands[slot.id]}
                replayCommand={replayCommands[slot.id]}
                viewRangeCommand={{
                  presetId: rangePresets[slot.id] ?? DEFAULT_RANGE_PRESET,
                  revision: rangePresetRevisions[slot.id] ?? 0,
                }}
              />
            ))}
            {canAddVisibleSlot && (
              <AddChartPlaceholder onClick={handleAddSlot} />
            )}
          </ChartGridContainer>
        </div>

        {scriptOverlayTarget && scriptOverlayOutputs.length ? createPortal(
          <div className="pointer-events-none absolute left-2 top-2 z-20 max-w-[min(22rem,calc(100%-1rem))] rounded border border-terminal-accent/50 bg-terminal-panel/95 px-2 py-2 text-[10px] shadow-xl backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold uppercase tracking-[0.18em] text-terminal-accent">OpenScript</span>
              <span className="text-terminal-muted">{scriptRunResult?.row_count ?? 0} rows</span>
            </div>
            <div className="mt-1 truncate text-terminal-text">{scriptRunResult?.script_name ?? scriptTitle}</div>
            <div className="mt-1 text-terminal-muted">{scriptOverlayOutputs.length} output(s)</div>
            {scriptOverlaySeries.length ? (
              <div className="mt-2">
                <SparklineCell
                  points={scriptOverlaySeries as number[]}
                  width={210}
                  height={44}
                  color="var(--ot-color-accent-primary)"
                  areaColor="var(--ot-color-feedback-info-soft)"
                  className="rounded border border-terminal-border/60 bg-terminal-bg/50"
                  ariaLabel="OpenScript preview"
                />
              </div>
            ) : null}
            <div className="mt-2 space-y-1">
              {scriptOverlayOutputs.slice(0, 3).map((output, index) => (
                <div key={`${output.kind}-${index}`} className="rounded border border-terminal-border/70 bg-terminal-bg/40 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-terminal-text">{output.title || output.kind.toUpperCase()}</span>
                    <span className="text-terminal-muted">{output.kind}</span>
                  </div>
                  <div className="truncate text-terminal-muted">
                    {output.message || `${output.series.length} row(s)`}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          scriptOverlayTarget,
        ) : null}

        {scriptPanelOpen ? (
          <div
            ref={scriptPanelRef}
            className="absolute bottom-4 right-4 z-40 resize overflow-hidden rounded border border-terminal-border bg-terminal-panel shadow-2xl"
            style={{
              width: `${scriptPanelSize.width}px`,
              height: `${scriptPanelSize.height}px`,
              minWidth: "520px",
              minHeight: "420px",
              maxWidth: "96vw",
              maxHeight: "85vh",
            }}
          >
            <PanelFrame as="div" className="flex h-full min-h-0 flex-col bg-terminal-panel">
              <PanelHeader
                title="OpenScript IDE"
                subtitle={activeSlot?.ticker ? `${activeSlot.ticker} · ${activeSlot.market}` : "Attach to an active chart to preview outputs"}
                actions={
                  <button
                    type="button"
                    className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => setScriptPanelOpen(false)}
                  >
                    Close
                  </button>
                }
              />
              <PanelBody className="flex min-h-0 flex-1 p-0">
                <div className="min-h-0 w-[280px] shrink-0 border-r border-terminal-border">
                  <ScriptLibrary
                    scripts={scriptScripts}
                    selectedScriptId={scriptSelectedId}
                    loading={scriptLoading}
                    onSelectScript={selectScript}
                    onNewScript={newScript}
                    onSave={saveScript}
                    onSaveAs={saveScriptAs}
                    onDelete={() => {
                      void deleteScript();
                    }}
                    onTogglePublic={() => {
                      setScriptPublic((value) => !value);
                      setScriptDirty(true);
                    }}
                  />
                </div>
                <div className="min-h-0 min-w-0 flex-1">
                  <ScriptEditor
                    chartSymbol={activeSlot?.ticker ?? ""}
                    chartMarket={activeSlot?.market ?? ""}
                    source={scriptSource}
                    title={scriptTitle}
                    description={scriptDescription}
                    isPublic={scriptPublic}
                    selectedScriptId={scriptSelectedId}
                    dirty={scriptDirty}
                    saving={scriptBusy}
                    running={scriptBusy}
                    compileResult={scriptCompileResult}
                    runResult={scriptRunResult}
                    onSourceChange={(value) => {
                      setScriptSource(value);
                      setScriptDirty(true);
                    }}
                    onTitleChange={(value) => {
                      setScriptTitle(value);
                      setScriptDirty(true);
                    }}
                    onDescriptionChange={(value) => {
                      setScriptDescription(value);
                      setScriptDirty(true);
                    }}
                    onPublicChange={(value) => {
                      setScriptPublic(value);
                      setScriptDirty(true);
                    }}
                    onSave={saveScript}
                    onRun={runScript}
                    onClose={() => setScriptPanelOpen(false)}
                    onIndicatorOutput={setScriptOverlayOutputs}
                  />
                </div>
              </PanelBody>
            </PanelFrame>
          </div>
        ) : null}

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
