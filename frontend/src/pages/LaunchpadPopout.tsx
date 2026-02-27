import { Suspense, lazy, useMemo, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";

import type { LaunchpadPanelConfig, LaunchpadPanelType } from "../components/layout/LaunchpadContext";

const PANEL_RENDERERS: Record<LaunchpadPanelType, ComponentType<{ panel: LaunchpadPanelConfig }>> = {
  chart: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadChartPanel }))),
  watchlist: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadWatchlistPanel }))),
  "news-feed": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadNewsFeedPanel }))),
  "order-book": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadOrderBookPanel }))),
  "ticker-detail": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadTickerDetailPanel }))),
  "screener-results": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadScreenerResultsPanel }))),
  alerts: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadAlertsPanel }))),
  "portfolio-summary": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadPortfolioSummaryPanel }))),
  heatmap: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadHeatmapPanel }))),
  "market-pulse": lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadMarketPulsePanel }))),
  fundamentals: lazy(() => import("../components/layout/LaunchpadPanels").then((m) => ({ default: m.LaunchpadFundamentalsPanel }))),
};

function toPanelType(value: string | null): LaunchpadPanelType {
  const v = String(value || "").trim() as LaunchpadPanelType;
  if (v in PANEL_RENDERERS) return v;
  return "chart";
}

export function LaunchpadPopoutPage() {
  const [search] = useSearchParams();
  const type = toPanelType(search.get("type"));
  const panel = useMemo<LaunchpadPanelConfig>(
    () => ({
      id: search.get("id") || "popout",
      type,
      title: search.get("title") || `${type.toUpperCase()} Panel`,
      symbol: search.get("symbol") || undefined,
      linked: search.get("linked") !== "0",
      x: 0,
      y: 0,
      w: 12,
      h: 10,
    }),
    [search, type],
  );

  const Panel = PANEL_RENDERERS[type];

  return (
    <div className="h-screen overflow-hidden bg-terminal-bg p-2 text-terminal-text">
      <div className="mb-2 flex items-center justify-between rounded border border-terminal-border bg-terminal-panel px-2 py-1">
        <div className="ot-type-label text-terminal-accent">{panel.title}</div>
        <button
          type="button"
          className="rounded border border-terminal-border px-2 py-0.5 text-[11px] text-terminal-muted hover:text-terminal-text"
          onClick={() => window.close()}
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
