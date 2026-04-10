import type { LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";

export type WorkspaceTemplateCategory = "trading" | "research" | "portfolio" | "macro" | "custom";

export interface PanelConfig {
  id: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
  grid: { x: number; y: number; w: number; h: number };
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: WorkspaceTemplateCategory;
  panels: PanelConfig[];
  gridCols: number;
}

export const BUILTIN_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "day-trading",
    name: "Day Trading",
    description: "Intraday charts, depth, and tape for active trading",
    icon: "bolt",
    category: "trading",
    gridCols: 2,
    panels: [
      { id: "p1", type: "chart", title: "1-Min Chart", props: { interval: "1m" }, grid: { x: 0, y: 0, w: 6, h: 6 } },
      { id: "p2", type: "chart", title: "5-Min Chart", props: { interval: "5m" }, grid: { x: 6, y: 0, w: 6, h: 6 } },
      { id: "p3", type: "watchlist", title: "Watchlist", props: {}, grid: { x: 0, y: 6, w: 6, h: 4 } },
      { id: "p4", type: "news", title: "News Feed", props: {}, grid: { x: 6, y: 6, w: 6, h: 4 } },
    ],
  },
  {
    id: "swing-trading",
    name: "Swing Trading",
    description: "Daily/weekly charts with screener and fundamentals",
    icon: "chart-bar",
    category: "trading",
    gridCols: 3,
    panels: [
      { id: "p1", type: "chart", title: "Daily Chart", props: { interval: "1d" }, grid: { x: 0, y: 0, w: 8, h: 6 } },
      { id: "p2", type: "chart", title: "Weekly Chart", props: { interval: "1w" }, grid: { x: 8, y: 0, w: 4, h: 6 } },
      { id: "p3", type: "screener", title: "Screener", props: {}, grid: { x: 0, y: 6, w: 6, h: 4 } },
      { id: "p4", type: "news", title: "News", props: {}, grid: { x: 6, y: 6, w: 6, h: 4 } },
    ],
  },
  {
    id: "options-desk",
    name: "Options Desk",
    description: "Option chain, Greeks, IV analysis, and payoff diagrams",
    icon: "table-cells",
    category: "trading",
    gridCols: 2,
    panels: [
      { id: "p1", type: "chart", title: "Underlying Chart", props: { interval: "15m" }, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "option-chain", title: "Option Chain", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "greeks", title: "Greeks Heatmap", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "oi-chart", title: "OI Analysis", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
  {
    id: "research",
    name: "Research",
    description: "Security analysis with financials, news, and peers",
    icon: "magnifying-glass",
    category: "research",
    gridCols: 2,
    panels: [
      { id: "p1", type: "overview", title: "Company Overview", props: {}, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "financials", title: "Financials", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "news", title: "News & Sentiment", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "peers", title: "Peer Comparison", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
  {
    id: "portfolio-review",
    name: "Portfolio Review",
    description: "Holdings, allocation, performance, and risk at a glance",
    icon: "briefcase",
    category: "portfolio",
    gridCols: 2,
    panels: [
      { id: "p1", type: "portfolio-summary", title: "Holdings", props: {}, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "portfolio-allocation", title: "Allocation", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "portfolio-performance", title: "Performance", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "risk-metrics", title: "Risk Metrics", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
  {
    id: "macro",
    name: "Macro Dashboard",
    description: "Yield curve, sector rotation, economics, and heatmap",
    icon: "globe-alt",
    category: "macro",
    gridCols: 2,
    panels: [
      { id: "p1", type: "yield-curve", title: "Yield Curve", props: {}, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "sector-rotation", title: "Sector Rotation", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "economics", title: "Economic Calendar", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "news", title: "Macro News", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
];

export function inferTemplateGridCols(panels: Array<Pick<LaunchpadPanelConfig, "w">>): number {
  return panels.some((panel) => panel.w <= 4) || panels.length >= 5 ? 3 : 2;
}
