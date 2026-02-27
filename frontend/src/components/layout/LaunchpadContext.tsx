import {
  createContext,
  type ComponentType,
  lazy,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LaunchpadPanelType =
  | "chart"
  | "watchlist"
  | "news-feed"
  | "order-book"
  | "ticker-detail"
  | "screener-results"
  | "alerts"
  | "portfolio-summary"
  | "heatmap"
  | "market-pulse"
  | "fundamentals";

export type LaunchpadPanelConfig = {
  id: string;
  type: LaunchpadPanelType;
  title: string;
  symbol?: string;
  linked?: boolean;
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
  closePanel: (panelId: string) => void;
  addPanel: (type: LaunchpadPanelType) => void;
  reorderPanels: (sourceId: string, targetId: string) => void;
  emitSymbolChange: (symbol: string, sourcePanelId?: string) => void;
  symbolEventVersion: number;
  lastBroadcastSymbol: string | null;
  loadingLayouts: boolean;
};

const LaunchpadContext = createContext<LaunchpadContextValue | null>(null);
const STORAGE_KEY = "ot:launchpad:layouts:v1";
const ACTIVE_KEY = "ot:launchpad:active:v1";

function makePanel(id: string, type: LaunchpadPanelType, title: string, x: number, y: number, w: number, h: number, symbol?: string): LaunchpadPanelConfig {
  return { id, type, title, x, y, w, h, symbol, linked: true };
}

function defaultPresets(): LaunchpadLayoutPreset[] {
  return [
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
        makePanel("r-chart", "chart", "Chart", 0, 0, 7, 10, "AAPL"),
        makePanel("r-fund", "fundamentals", "Fundamentals", 7, 0, 5, 10, "AAPL"),
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

function readLocalLayouts(): LaunchpadLayoutPreset[] {
  if (typeof window === "undefined") return defaultPresets();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPresets();
    const parsed = JSON.parse(raw) as LaunchpadLayoutPreset[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaultPresets();
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

const PANEL_REGISTRY: Record<LaunchpadPanelType, ComponentType<{ panel: LaunchpadPanelConfig }>> = {
  chart: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadChartPanel }))),
  watchlist: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadWatchlistPanel }))),
  "news-feed": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadNewsFeedPanel }))),
  "order-book": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadOrderBookPanel }))),
  "ticker-detail": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadTickerDetailPanel }))),
  "screener-results": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadScreenerResultsPanel }))),
  alerts: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadAlertsPanel }))),
  "portfolio-summary": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadPortfolioSummaryPanel }))),
  heatmap: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadHeatmapPanel }))),
  "market-pulse": lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadMarketPulsePanel }))),
  fundamentals: lazy(() => import("./LaunchpadPanels").then((m) => ({ default: m.LaunchpadFundamentalsPanel }))),
};

export function LaunchpadProvider({ children }: { children: ReactNode }) {
  const [savedLayouts, setSavedLayouts] = useState<LaunchpadLayoutPreset[]>(() => readLocalLayouts());
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
          const serverItems = payload.items;
          startTransition(() => {
            setSavedLayouts(serverItems);
            if (!serverItems.some((l) => l.id === activeLayoutId)) setActiveLayoutId(serverItems[0].id);
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
  }, [activeLayoutId]);

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

  const value = useMemo<LaunchpadContextValue>(
    () => ({
      activeLayoutId,
      activeLayout,
      savedLayouts,
      panelRegistry: PANEL_REGISTRY,
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
          panels: layout.panels.map((panel) => (panel.id === panelId ? { ...panel, ...patch } : panel)),
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
      closePanel: (panelId) => {
        mutateActiveLayout((layout) => ({
          ...layout,
          panels: layout.panels.filter((panel) => panel.id !== panelId),
        }));
      },
      addPanel: (type) => {
        mutateActiveLayout((layout) => {
          const n = layout.panels.length;
          return {
            ...layout,
            panels: [
              ...layout.panels,
              makePanel(`panel-${Date.now()}`, type, type.toUpperCase(), (n % 3) * 4, Math.floor(n / 3) * 4, 4, 4),
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
      emitSymbolChange: (symbol, sourcePanelId) => {
        const normalized = symbol.toUpperCase();
        mutateActiveLayout((layout) => ({
          ...layout,
          panels: layout.panels.map((panel) => {
            if (!panel.linked) return panel;
            if (sourcePanelId && panel.id === sourcePanelId) return panel;
            return { ...panel, symbol: normalized };
          }),
        }));
        setLastBroadcastSymbol(normalized);
        setSymbolEventVersion((v) => v + 1);
      },
      symbolEventVersion,
      lastBroadcastSymbol,
      loadingLayouts,
    }),
    [activeLayout, activeLayoutId, lastBroadcastSymbol, loadingLayouts, savedLayouts, symbolEventVersion],
  );

  return <LaunchpadContext.Provider value={value}>{children}</LaunchpadContext.Provider>;
}

export function useLaunchpad() {
  const ctx = useContext(LaunchpadContext);
  if (!ctx) throw new Error("useLaunchpad must be used within LaunchpadProvider");
  return ctx;
}
