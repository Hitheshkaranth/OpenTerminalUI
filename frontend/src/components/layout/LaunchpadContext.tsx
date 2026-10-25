import {
  createContext,
  type ComponentType,
  lazy,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
  useReducer,
  type ReactNode,
} from "react";

import { validateGroupContext, type WorkspaceGroupContext } from "../../workspace/groupContext";
import { readPendingArtifacts, clearPendingArtifacts } from "../../workspace/pinnedArtifacts";
import { parseWorkspace, serializeWorkspace } from "../../workspace/portableLayout";

import type { LinkGroup } from "../../contexts/SymbolLinkContext";
import { getWorkspacePresetConfig, readWorkspacePreset } from "../../workspace/presets";

export type LaunchpadPanelType =
  | "chart"
  | "watchlist"
  | "news"
  | "news-feed"
  | "order-book"
  | "ticker-detail"
  | "overview"
  | "screener"
  | "screener-results"
  | "alerts"
  | "financials"
  | "portfolio-summary"
  | "portfolio-allocation"
  | "portfolio-performance"
  | "risk-metrics"
  | "heatmap"
  | "market-pulse"
  | "fundamentals"
  | "yield-curve"
  | "economics"
  | "greeks"
  | "oi-chart"
  | "peers"
  | "ai-research"
  | "option-chain"
  | "watchlist-heatmap"
  | "sector-rotation"
  | "hotkeys"
  | "research-notes"
  | "research-artifact"
  | `plugin:${string}`;

export type LaunchpadPanelConfig = {
  id: string;
  type: LaunchpadPanelType;
  title: string;
  symbol?: string;
  linked?: boolean;
  linkGroup?: LinkGroup;
  poppedOut?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  props?: Record<string, unknown>;
};

export type LaunchpadLayoutPreset = {
  id: string;
  name: string;
  panels: LaunchpadPanelConfig[];
  groups?: Partial<Record<Exclude<LinkGroup, "none">, WorkspaceGroupContext>>;
};

type LaunchpadContextValue = {
  activeLayoutId: string;
  activeLayout: LaunchpadLayoutPreset | null;
  savedLayouts: LaunchpadLayoutPreset[];
  panelRegistry: Record<LaunchpadPanelType, ComponentType<{ panel: LaunchpadPanelConfig }>>;
  setActiveLayoutId: (id: string) => void;
  createLayout: () => void;
  renameLayout: (id: string, name: string) => void;
  deleteLayout: (id: string) => void;
  updatePanel: (panelId: string, patch: Partial<LaunchpadPanelConfig>) => void;
  updatePanelsLayout: (panels: Array<Pick<LaunchpadPanelConfig, "id" | "x" | "y" | "w" | "h">>) => void;
  replacePanels: (panels: LaunchpadPanelConfig[]) => void;
  closePanel: (panelId: string) => void;
  setPanelPoppedOut: (panelId: string, poppedOut: boolean) => void;
  addPanel: (type: LaunchpadPanelType) => void;
  reorderPanels: (sourceId: string, targetId: string) => void;
  emitSymbolChange: (symbol: string, sourcePanelId?: string, linkGroupOverride?: LinkGroup) => void;
  symbolEventVersion: number;
  lastBroadcastSymbol: string | null;
  loadingLayouts: boolean;
  updateGroupContext: (group: Exclude<LinkGroup, "none">, context: WorkspaceGroupContext) => void;
  canUndo: boolean;
  undo: () => void;
  exportWorkspace: () => string;
  importWorkspace: (raw: string) => void;
};

const LaunchpadContext = createContext<LaunchpadContextValue | null>(null);
const STORAGE_KEY = "ot:launchpad:layouts:v1";
const ACTIVE_KEY = "ot:launchpad:active:v1";

export const SUPPORTED_LAUNCHPAD_PANEL_TYPES: LaunchpadPanelType[] = [
  "chart",
  "watchlist",
  "news",
  "news-feed",
  "order-book",
  "ticker-detail",
  "overview",
  "screener",
  "screener-results",
  "alerts",
  "financials",
  "portfolio-summary",
  "portfolio-allocation",
  "portfolio-performance",
  "risk-metrics",
  "heatmap",
  "market-pulse",
  "fundamentals",
  "yield-curve",
  "economics",
  "greeks",
  "oi-chart",
  "peers",
  "ai-research",
  "option-chain",
  "watchlist-heatmap",
  "sector-rotation",
  "hotkeys",
  "research-notes",
  "research-artifact",
];

export function isLaunchpadPanelType(value: string): value is LaunchpadPanelType {
  return SUPPORTED_LAUNCHPAD_PANEL_TYPES.includes(value as LaunchpadPanelType);
}

function isLinkGroup(value: unknown): value is LinkGroup {
  return value === "none" || value === "red" || value === "blue" || value === "green" || value === "yellow";
}

function normalizePanelLinkGroup(panel: Pick<LaunchpadPanelConfig, "linkGroup" | "linked"> | null | undefined): LinkGroup {
  if (isLinkGroup(panel?.linkGroup)) return panel.linkGroup;
  return panel?.linked === false ? "none" : "red";
}

function normalizePanelConfig(panel: LaunchpadPanelConfig): LaunchpadPanelConfig {
  const linkGroup = normalizePanelLinkGroup(panel);
  return {
    ...panel,
    linkGroup,
    linked: linkGroup !== "none",
    poppedOut: Boolean(panel.poppedOut),
  };
}

function normalizeLayoutPreset(layout: LaunchpadLayoutPreset): LaunchpadLayoutPreset {
  return {
    ...layout,
    panels: Array.isArray(layout.panels) ? layout.panels.map((panel) => normalizePanelConfig(panel)) : [],
  };
}

function makePanel(id: string, type: LaunchpadPanelType, title: string, x: number, y: number, w: number, h: number, symbol?: string): LaunchpadPanelConfig {
  return normalizePanelConfig({ id, type, title, x, y, w, h, symbol, linked: true, linkGroup: "red", poppedOut: false });
}

function defaultPresets(): LaunchpadLayoutPreset[] {
  const config = getWorkspacePresetConfig(readWorkspacePreset());
  const roleLayout: LaunchpadLayoutPreset = {
    id: config.launchpadLayoutId,
    name: `${config.label} Default`,
    panels: config.launchpadPanels.map((panel, index) =>
      makePanel(`${config.launchpadLayoutId}-${index}`, panel.type as LaunchpadPanelType, panel.title, panel.x, panel.y, panel.w, panel.h, panel.symbol),
    ),
  };
  return [
    roleLayout,
    {
      id: "trading-desk",
      name: "Trading Desk",
      panels: [
        makePanel("td-chart", "chart", "Chart", 0, 0, 7, 6, "RELIANCE"),
        makePanel("td-watch", "watchlist", "Watchlist", 7, 0, 5, 6),
        makePanel("td-news", "news-feed", "News", 0, 6, 7, 4, "RELIANCE"),
        makePanel("td-book", "order-book", "Order Book", 7, 6, 5, 4, "RELIANCE"),
      ],
    },
    {
      id: "research",
      name: "Research",
      panels: [
        makePanel("r-chart", "chart", "Chart", 0, 0, 7, 5, "AAPL"),
        makePanel("r-fund", "fundamentals", "Fundamentals", 7, 0, 5, 5, "AAPL"),
        makePanel("r-notes", "research-notes", "Research Notes", 0, 5, 12, 5, "AAPL"),
      ],
    },
    {
      id: "monitoring",
      name: "Monitoring",
      panels: [
        makePanel("m-chart-1", "chart", "Chart 1", 0, 0, 3, 5, "NIFTY"),
        makePanel("m-chart-2", "chart", "Chart 2", 3, 0, 3, 5, "BANKNIFTY"),
        makePanel("m-chart-3", "chart", "Chart 3", 6, 0, 3, 5, "SPY"),
        makePanel("m-chart-4", "chart", "Chart 4", 9, 0, 3, 5, "QQQ"),
        makePanel("m-pulse", "market-pulse", "Market Pulse", 0, 5, 8, 5),
        makePanel("m-alerts", "alerts", "Alerts", 8, 5, 4, 5),
      ],
    },
  ];
}

export function migrateLegacyBuiltInLayouts(layouts: LaunchpadLayoutPreset[]): LaunchpadLayoutPreset[] {
  const currentResearch = defaultPresets().find((layout) => layout.id === "research");
  if (!currentResearch) return layouts;

  return layouts.map((layout) => {
    const panelIds = new Set(layout.panels.map((panel) => panel.id));
    const isUntouchedLegacyResearch =
      layout.id === "research" &&
      layout.panels.length === 2 &&
      panelIds.has("r-chart") &&
      panelIds.has("r-fund");

    return isUntouchedLegacyResearch ? currentResearch : layout;
  });
}

function readLocalLayouts(): LaunchpadLayoutPreset[] {
  if (typeof window === "undefined") return defaultPresets();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPresets();
    const parsed = JSON.parse(raw) as LaunchpadLayoutPreset[];
    return Array.isArray(parsed) && parsed.length
      ? migrateLegacyBuiltInLayouts(parsed.map((layout) => normalizeLayoutPreset(layout)))
      : defaultPresets();
  } catch {
    return defaultPresets();
  }
}

function writeLocalLayouts(layouts: LaunchpadLayoutPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // ignore
  }
}

export const PANEL_REGISTRY: Record<LaunchpadPanelType, ComponentType<{ panel: LaunchpadPanelConfig }>> = {
  "research-artifact": lazy(() => import("./ResearchPanels").then((m) => ({ default: m.ResearchArtifactPanel }))),
  chart: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadChartPanel }))),
  watchlist: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadWatchlistPanel }))),
  news: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadNewsFeedPanel }))),
  "news-feed": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadNewsFeedPanel }))),
  "order-book": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadOrderBookPanel }))),
  "ticker-detail": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadTickerDetailPanel }))),
  overview: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadTickerDetailPanel }))),
  screener: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadScreenerResultsPanel }))),
  "screener-results": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadScreenerResultsPanel }))),
  alerts: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadAlertsPanel }))),
  financials: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadFundamentalsPanel }))),
  "portfolio-summary": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadPortfolioSummaryPanel }))),
  "portfolio-allocation": lazy(() => import("./ResearchPanels").then((m) => ({ default: m.AllocationPanel }))),
  "portfolio-performance": lazy(() => import("./ResearchPanels").then((m) => ({ default: m.PerformancePanel }))),
  "risk-metrics": lazy(() => import("./ResearchPanels").then((m) => ({ default: m.RiskMetricsPanel }))),
  heatmap: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadHeatmapPanel }))),
  "market-pulse": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadMarketPulsePanel }))),
  fundamentals: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadFundamentalsPanel }))),
  "yield-curve": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadYieldCurvePanel }))),
  economics: lazy(() => import("./ResearchPanels").then((m) => ({ default: m.EconomicsPanel }))),
  greeks: lazy(() => import("./ResearchPanels").then((m) => ({ default: m.DerivativesPanel }))),
  "oi-chart": lazy(() => import("./ResearchPanels").then((m) => ({ default: m.DerivativesPanel }))),
  peers: lazy(() => import("./ResearchPanels").then((m) => ({ default: m.PeersPanel }))),
  "ai-research": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadAIResearchPanel }))),
  "option-chain": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadOptionChainPanel }))),
  "watchlist-heatmap": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadWatchlistHeatmapPanel }))),
  "sector-rotation": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadSectorRotationPanel }))),
  hotkeys: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadHotKeyTradingPanel }))),
  "research-notes": lazy(() => import("./ResearchNotesPanel").then((m) => ({ default: m.LaunchpadResearchNotesPanel }))),
};

/** Register trusted, bundled extensions before mounting the application. */
export function registerWorkspaceWidget(definition: {
  id: `plugin:${string}`;
  title: string;
  version: 1;
  component: ComponentType<{ panel: LaunchpadPanelConfig }>;
}): void {
  if (definition.version !== 1 || !/^plugin:[a-z0-9][a-z0-9-]{1,63}$/.test(definition.id) || !definition.title.trim()) throw new Error("Invalid widget definition.");
  if (SUPPORTED_LAUNCHPAD_PANEL_TYPES.includes(definition.id)) throw new Error(`Widget already registered: ${definition.id}`);
  PANEL_REGISTRY[definition.id] = definition.component;
  SUPPORTED_LAUNCHPAD_PANEL_TYPES.push(definition.id);
}

export function LaunchpadProvider({ children }: { children: ReactNode }) {
  type LayoutUpdate = LaunchpadLayoutPreset[] | ((prev: LaunchpadLayoutPreset[]) => LaunchpadLayoutPreset[]);
  type LayoutState = { layouts: LaunchpadLayoutPreset[]; history: LaunchpadLayoutPreset[][] };
  const [layoutState, dispatchLayouts] = useReducer((state: LayoutState, action: { type: "update" | "hydrate" | "undo"; update?: LayoutUpdate }): LayoutState => {
    if (action.type === "undo") {
      const previous = state.history[state.history.length - 1];
      return previous ? { layouts: previous, history: state.history.slice(0, -1) } : state;
    }
    const next = typeof action.update === "function" ? action.update(state.layouts) : action.update!;
    if (JSON.stringify(state.layouts) === JSON.stringify(next)) return state;
    return { layouts: next, history: action.type === "hydrate" ? [] : [...state.history.slice(-29), state.layouts] };
  }, undefined, () => ({ layouts: readLocalLayouts(), history: [] }));
  const savedLayouts = layoutState.layouts;
  const historySize = layoutState.history.length;
  const setSavedLayouts = (update: LayoutUpdate) => dispatchLayouts({ type: "update", update });
  const setLayouts = (update: LayoutUpdate) => dispatchLayouts({ type: "hydrate", update });
  const [activeLayoutId, setActiveLayoutId] = useState<string>(() => {
    if (typeof window === "undefined") return defaultPresets()[0].id;
    return localStorage.getItem(ACTIVE_KEY) || readLocalLayouts()[0]?.id || defaultPresets()[0].id;
  });
  const [lastBroadcastSymbol, setLastBroadcastSymbol] = useState<string | null>(null);
  const [symbolEventVersion, setSymbolEventVersion] = useState(0);
  const [loadingLayouts, setLoadingLayouts] = useState(false);
  const [serverHydrated, setServerHydrated] = useState(false);

  useEffect(() => {
    writeLocalLayouts(savedLayouts);
  }, [savedLayouts]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_KEY, activeLayoutId);
    } catch {
      // ignore
    }
  }, [activeLayoutId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingLayouts(true);
      try {
        const res = await fetch("/api/user/layouts", { credentials: "include" });
        if (!res.ok) return;
        const payload = (await res.json()) as { items?: LaunchpadLayoutPreset[] };
        if (cancelled) return;
        if (Array.isArray(payload?.items) && payload.items.length) {
          const serverItems = migrateLegacyBuiltInLayouts(payload.items.map((layout) => normalizeLayoutPreset(layout)));
          startTransition(() => {
            setLayouts(serverItems);
            setActiveLayoutId((current) => (serverItems.some((l) => l.id === current) ? current : serverItems[0].id));
          });
        }
      } catch {
        // local fallback remains active
      } finally {
        if (!cancelled) {
          setLoadingLayouts(false);
          setServerHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Hydrate from the server once on mount. Re-running on every layout switch
    // re-fetched the (not yet synced) server list and clobbered newly created /
    // deleted layouts before the debounced PUT landed.
  }, []);

  useEffect(() => {
    if (!serverHydrated) return;
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch("/api/user/layouts", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: savedLayouts }),
        signal: ctrl.signal,
      }).catch(() => undefined);
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      ctrl.abort();
    };
  }, [savedLayouts, serverHydrated]);

  const activeLayout = useMemo(
    () => savedLayouts.find((layout) => layout.id === activeLayoutId) ?? savedLayouts[0] ?? null,
    [activeLayoutId, savedLayouts],
  );

  const mutateActiveLayout = (updater: (layout: LaunchpadLayoutPreset) => LaunchpadLayoutPreset) => {
    setSavedLayouts((prev) =>
      prev.map((layout) => (layout.id === activeLayoutId ? updater(layout) : layout)),
    );
  };

  useEffect(() => {
    if (!serverHydrated) return;
    const receive = () => {
      const pending = readPendingArtifacts();
      if (!pending.length) return;
      mutateActiveLayout((layout) => ({ ...layout, panels: [...layout.panels, ...pending.filter((item) => !layout.panels.some((panel) => panel.id === `artifact-${item.artifact.id}`)).map((item, index) => ({
        ...makePanel(`artifact-${item.artifact.id}`, "research-artifact", item.artifact.name || "Research result", 0, Math.max(0, ...layout.panels.map((panel) => panel.y + panel.h)) + index * 6, 6, 6),
        linkGroup: "none" as const, linked: false, props: item,
      }))] }));
      clearPendingArtifacts();
    };
    receive();
    window.addEventListener("ot:pin-artifact", receive);
    return () => window.removeEventListener("ot:pin-artifact", receive);
  }, [activeLayoutId, serverHydrated]);

  const value = useMemo<LaunchpadContextValue>(
    () => ({
      activeLayoutId,
      activeLayout,
      savedLayouts,
      panelRegistry: PANEL_REGISTRY,
      updateGroupContext: (group, raw) => {
        const context = validateGroupContext(raw);
        mutateActiveLayout((layout) => ({ ...layout, groups: { ...layout.groups, [group]: context }, panels: layout.panels.map((panel) => normalizePanelLinkGroup(panel) !== group ? panel : { ...panel, symbol: context.symbol || panel.symbol, props: { ...panel.props, dateRange: context.dateRange, reportingCurrency: context.currency, contextName: context.name } }) }));
      },
      canUndo: historySize > 0,
      undo: () => {
        const previous = layoutState.history[layoutState.history.length - 1];
        if (!previous) return;
        dispatchLayouts({ type: "undo" });
        if (!previous.some((layout) => layout.id === activeLayoutId)) setActiveLayoutId(previous[0]?.id || "");
      },
      exportWorkspace: () => { if (!activeLayout) throw new Error("No active workspace."); return serializeWorkspace(activeLayout); },
      importWorkspace: (raw) => {
        const imported = parseWorkspace(raw, SUPPORTED_LAUNCHPAD_PANEL_TYPES);
        setSavedLayouts((prev) => [...prev, imported]);
        setActiveLayoutId(imported.id);
      },
      setActiveLayoutId,
      createLayout: () => {
        const id = `layout-${Date.now()}`;
        const next: LaunchpadLayoutPreset = {
          id,
          name: `Layout ${savedLayouts.length + 1}`,
          panels: [makePanel(`${id}-panel`, "chart", "Chart", 0, 0, 6, 6, "RELIANCE")],
        };
        setSavedLayouts((prev) => [...prev, next]);
        setActiveLayoutId(id);
      },
      renameLayout: (id, name) => {
        setSavedLayouts((prev) => prev.map((layout) => (layout.id === id ? { ...layout, name } : layout)));
      },
      deleteLayout: (id) => {
        setSavedLayouts((prev) => {
          const next = prev.filter((layout) => layout.id !== id);
          if (!next.length) return defaultPresets();
          if (activeLayoutId === id) setActiveLayoutId(next[0].id);
          return next;
        });
      },
      updatePanel: (panelId, patch) => {
        mutateActiveLayout((layout) => ({
          ...layout,
          panels: layout.panels.map((panel) =>
            panel.id === panelId ? (() => {
              const context = patch.linkGroup && patch.linkGroup !== "none" ? layout.groups?.[patch.linkGroup] : undefined;
              return normalizePanelConfig({ ...panel, ...patch, ...(context ? { symbol: context.symbol || patch.symbol || panel.symbol, props: { ...panel.props, ...patch.props, dateRange: context.dateRange, reportingCurrency: context.currency, contextName: context.name } } : {}) } as LaunchpadPanelConfig);
            })() : panel,
          ),
        }));
      },
      updatePanelsLayout: (panels) => {
        const byId = new Map(panels.map((p) => [p.id, p] as const));
        mutateActiveLayout((layout) => {
          let changed = false;
          const nextPanels = layout.panels.map((panel) => {
            const next = byId.get(panel.id);
            if (!next) return panel;
            if (
              panel.x === next.x &&
              panel.y === next.y &&
              panel.w === next.w &&
              panel.h === next.h
            ) {
              return panel;
            }
            changed = true;
            return { ...panel, x: next.x, y: next.y, w: next.w, h: next.h };
          });
          return changed ? { ...layout, panels: nextPanels } : layout;
        });
      },
      replacePanels: (panels) => {
        mutateActiveLayout((layout) => ({
          ...layout,
          panels: panels.map((panel) => normalizePanelConfig(panel)),
        }));
      },
      closePanel: (panelId) => {
        mutateActiveLayout((layout) => ({
          ...layout,
          panels: layout.panels.filter((panel) => panel.id !== panelId),
        }));
      },
      setPanelPoppedOut: (panelId, poppedOut) => {
        mutateActiveLayout((layout) => ({
          ...layout,
          panels: layout.panels.map((panel) =>
            panel.id === panelId ? normalizePanelConfig({ ...panel, poppedOut } as LaunchpadPanelConfig) : panel,
          ),
        }));
      },
      addPanel: (type) => {
        mutateActiveLayout((layout) => {
          const n = layout.panels.length;
          const context = layout.groups?.red;
          const nextPanel = makePanel(`panel-${crypto.randomUUID()}`, type, type.toUpperCase(), (n % 3) * 4, Math.floor(n / 3) * 4, 4, 4, context?.symbol);
          if (context) nextPanel.props = { dateRange: context.dateRange, reportingCurrency: context.currency, contextName: context.name };
          return {
            ...layout,
            panels: [
              ...layout.panels,
              nextPanel,
            ],
          };
        });
      },
      reorderPanels: (sourceId, targetId) => {
        mutateActiveLayout((layout) => {
          const next = [...layout.panels];
          const from = next.findIndex((p) => p.id === sourceId);
          const to = next.findIndex((p) => p.id === targetId);
          if (from < 0 || to < 0 || from === to) return layout;
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { ...layout, panels: next };
        });
      },
      emitSymbolChange: (symbol, sourcePanelId, linkGroupOverride) => {
        const normalized = symbol.toUpperCase();
        if (!normalized) return;
        mutateActiveLayout((layout) => ({
          ...layout,
          groups: Object.fromEntries(Object.entries(layout.groups || {}).map(([group, context]) => {
            const source = layout.panels.find((candidate) => candidate.id === sourcePanelId);
            const target = linkGroupOverride ?? (source ? normalizePanelLinkGroup(source) : null);
            return [group, context && (target == null || target === group) ? { ...context, symbol: normalized } : context];
          })),
          panels: layout.panels.map((panel) => {
            const sourcePanel = sourcePanelId
              ? layout.panels.find((candidate) => candidate.id === sourcePanelId) ?? null
              : null;
            const targetGroup = linkGroupOverride ?? (sourcePanel ? normalizePanelLinkGroup(sourcePanel) : null);
            const panelGroup = normalizePanelLinkGroup(panel);

            if (targetGroup == null) {
              if (panelGroup === "none") return panel;
              return normalizePanelConfig({ ...panel, symbol: normalized } as LaunchpadPanelConfig);
            }

            if (targetGroup === "none") {
              if (sourcePanelId && panel.id === sourcePanelId) {
                return normalizePanelConfig({ ...panel, symbol: normalized } as LaunchpadPanelConfig);
              }
              return panel;
            }

            if (panelGroup !== targetGroup) return panel;
            return normalizePanelConfig({ ...panel, symbol: normalized } as LaunchpadPanelConfig);
          }),
        }));
        setLastBroadcastSymbol(normalized);
        setSymbolEventVersion((v) => v + 1);
      },
      symbolEventVersion,
      lastBroadcastSymbol,
      loadingLayouts,
    }),
    [activeLayout, activeLayoutId, lastBroadcastSymbol, loadingLayouts, savedLayouts, symbolEventVersion, historySize],
  );

  return <LaunchpadContext.Provider value={value}>{children}</LaunchpadContext.Provider>;
}

export function useLaunchpad() {
  const ctx = useContext(LaunchpadContext);
  if (!ctx) throw new Error("useLaunchpad must be used within LaunchpadProvider");
  return ctx;
}
