import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";

import {
  postSymbolLinkMessage,
  setGroupSymbol,
  useGroupSymbolState,
  type LinkGroup,
} from "../contexts/SymbolLinkContext";
import {
  isLaunchpadPanelType,
  type LaunchpadPanelConfig,
  type LaunchpadPanelType,
} from "../components/layout/LaunchpadContext";

const PANEL_RENDERERS: Record<LaunchpadPanelType, ComponentType<{ panel: LaunchpadPanelConfig }>> = {
  chart: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadChartPanel }))),
  watchlist: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadWatchlistPanel }))),
  news: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadNewsFeedPanel }))),
  "news-feed": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadNewsFeedPanel }))),
  "order-book": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadOrderBookPanel }))),
  "ticker-detail": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTickerDetailPanel }))),
  overview: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTickerDetailPanel }))),
  screener: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadScreenerResultsPanel }))),
  "screener-results": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadScreenerResultsPanel }))),
  alerts: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadAlertsPanel }))),
  financials: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadFundamentalsPanel }))),
  "portfolio-summary": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadPortfolioSummaryPanel }))),
  "portfolio-allocation": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  "portfolio-performance": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  "risk-metrics": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  heatmap: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadHeatmapPanel }))),
  "market-pulse": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadMarketPulsePanel }))),
  fundamentals: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadFundamentalsPanel }))),
  "yield-curve": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadYieldCurvePanel }))),
  economics: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  greeks: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  "oi-chart": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  peers: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTemplatePlaceholderPanel }))),
  "ai-research": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadAIResearchPanel }))),
  "option-chain": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadOptionChainPanel }))),
  "watchlist-heatmap": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadWatchlistHeatmapPanel }))),
  "sector-rotation": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadSectorRotationPanel }))),
  hotkeys: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadHotKeyTradingPanel }))),
};

function toPanelType(value: string | null): LaunchpadPanelType {
  const v = String(value || "").trim() as LaunchpadPanelType;
  if (isLaunchpadPanelType(v) && v in PANEL_RENDERERS) return v;
  return "chart";
}

function normalizeThemeVariant(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (raw === "terminal-noir" || raw === "classic-bloomberg" || raw === "light-desk" || raw === "custom") {
    return raw;
  }
  return "terminal-noir";
}

function readOpenerTheme(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.opener?.document.documentElement.getAttribute("data-ot-theme")?.trim() || null;
  } catch {
    return null;
  }
}

function readThemeVariant(searchTheme: string | null): string {
  if (searchTheme) return normalizeThemeVariant(searchTheme);
  if (typeof document !== "undefined") {
    const current = document.documentElement.getAttribute("data-ot-theme");
    if (current) return normalizeThemeVariant(current);
  }
  return normalizeThemeVariant(readOpenerTheme());
}

function applyThemeVariant(theme: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-ot-theme", theme);
  root.style.colorScheme = theme === "light-desk" ? "light" : "dark";

  if (typeof window !== "undefined") {
    try {
      const openerAccent = window.opener?.document.documentElement.style.getPropertyValue("--ot-custom-accent").trim();
      if (openerAccent) {
        root.style.setProperty("--ot-custom-accent", openerAccent);
      }
    } catch {
      // ignore cross-window theme sync failures
    }
  }
}

function normalizeLinkGroup(value: string | null, linked: boolean): LinkGroup {
  if (value === "red" || value === "blue" || value === "green" || value === "yellow" || value === "none") {
    return value;
  }
  return linked ? "red" : "none";
}

function normalizeSymbol(value: string | null): string | null {
  const next = String(value || "").trim().toUpperCase();
  return next || null;
}

export function LaunchpadPopoutPage() {
  const [search] = useSearchParams();
  const type = toPanelType(search.get("type"));
  const linked = search.get("linked") !== "0";
  const linkGroup = useMemo(() => normalizeLinkGroup(search.get("linkGroup"), linked), [search, linked]);
  const themeVariant = useMemo(() => readThemeVariant(search.get("theme")), [search]);
  const windowIdRef = useRef(`launchpad-popout-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const title = search.get("title") || `${type.toUpperCase()} Panel`;
  const initialSymbol = normalizeSymbol(search.get("symbol"));
  const groupState = useGroupSymbolState(linkGroup);
  const [panelSymbol, setPanelSymbol] = useState<string | null>(() => groupState.symbol ?? initialSymbol);
  const seededLinkGroupRef = useRef(false);

  useEffect(() => {
    applyThemeVariant(themeVariant);
    postSymbolLinkMessage({
      type: "theme-change",
      theme: themeVariant,
      sourceWindowId: windowIdRef.current,
    });
  }, [themeVariant]);

  useEffect(() => {
    if (!linked) return;
    if (!groupState.symbol && panelSymbol && !seededLinkGroupRef.current) {
      seededLinkGroupRef.current = true;
      setGroupSymbol(linkGroup, panelSymbol, windowIdRef.current);
      return;
    }
    if (groupState.symbol && groupState.symbol !== panelSymbol) {
      seededLinkGroupRef.current = true;
      setPanelSymbol(groupState.symbol);
    }
  }, [groupState.symbol, linkGroup, linked, panelSymbol]);

  useEffect(() => {
    const notifyReturn = () => {
      postSymbolLinkMessage({
        type: "panel-return",
        panelId: search.get("id") || "popout",
        linkGroup: linked ? linkGroup : undefined,
        sourceWindowId: windowIdRef.current,
      });
    };

    window.addEventListener("beforeunload", notifyReturn);
    window.addEventListener("pagehide", notifyReturn);
    return () => {
      window.removeEventListener("beforeunload", notifyReturn);
      window.removeEventListener("pagehide", notifyReturn);
    };
  }, [linkGroup, linked, search]);

  const panel = useMemo<LaunchpadPanelConfig>(
    () => ({
      id: search.get("id") || "popout",
      type,
      title,
      symbol: panelSymbol || undefined,
      linked,
      x: 0,
      y: 0,
      w: 12,
      h: 10,
    }),
    [linked, panelSymbol, search, title, type],
  );

  const Panel = PANEL_RENDERERS[type];
  const handleClose = () => {
    postSymbolLinkMessage({
      type: "panel-return",
      panelId: panel.id,
      linkGroup: linked ? linkGroup : undefined,
      sourceWindowId: windowIdRef.current,
    });
    window.close();
  };

  return (
    <div className="h-screen overflow-hidden bg-terminal-bg p-2 text-terminal-text">
      <div className="mb-2 flex items-center justify-between rounded border border-terminal-border bg-terminal-panel px-2 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="ot-type-label truncate text-terminal-accent">{panel.title}</div>
          {linked ? <div className="rounded border border-terminal-border px-1 text-[10px] text-terminal-muted">{linkGroup}</div> : null}
          {panelSymbol ? <div className="rounded border border-terminal-border px-1 text-[10px] text-terminal-muted">{panelSymbol}</div> : null}
        </div>
        <button
          type="button"
          className="rounded border border-terminal-border px-2 py-0.5 text-[11px] text-terminal-muted hover:text-terminal-text"
          onClick={handleClose}
        >
          Close
        </button>
      </div>
      <div className="h-[calc(100%-40px)] rounded border border-terminal-border bg-terminal-panel">
        <Suspense fallback={<div className="p-2 text-xs text-terminal-muted">Loading panel...</div>}>
          <Panel panel={panel} />
        </Suspense>
      </div>
    </div>
  );
}
