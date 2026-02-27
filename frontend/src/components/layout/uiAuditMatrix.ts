export type RouteAuditRow = {
  route: string;
  shellWrapper: string;
  topChrome: string[];
  statusChrome: string[];
  pageShell: string;
  chartOrTablePattern: string[];
  duplicationSignals: string[];
  consolidationTarget: string;
  hotspotPriority: "P0" | "P1" | "P2";
};

export type DuplicationCandidate = {
  area: "shell" | "toolbar" | "status" | "table" | "chart" | "navigation";
  currentImplementations: string[];
  targetPrimitive: string;
  rationale: string;
  migrationPriority: "P0" | "P1" | "P2";
};

export const uiAuditMatrix: RouteAuditRow[] = [
  {
    route: "/equity/stocks",
    shellWrapper: "TerminalShell + EquityLayout",
    topChrome: ["CommandBar", "TickerTape", "TopBar"],
    statusChrome: ["MarketStatusBar"],
    pageShell: "StockDetailPage",
    chartOrTablePattern: ["TradingChart", "ad-hoc inline action rows"],
    duplicationSignals: [
      "Route-local action bars mimic workstation controls",
      "Context badges repeated with minor style differences",
    ],
    consolidationTarget: "PanelChrome + TerminalButton + TerminalBadge",
    hotspotPriority: "P0",
  },
  {
    route: "/equity/compare",
    shellWrapper: "TerminalShell + EquityLayout",
    topChrome: ["CommandBar", "TickerTape", "TopBar"],
    statusChrome: ["MarketStatusBar"],
    pageShell: "SplitComparisonPage",
    chartOrTablePattern: ["paired TradingChart", "comparison control strip"],
    duplicationSignals: [
      "Comparison controls overlap with chart workstation toolbar semantics",
      "Panel header treatment differs from Launchpad panel chrome",
    ],
    consolidationTarget: "ChartToolbar + PanelChrome",
    hotspotPriority: "P0",
  },
  {
    route: "/equity/chart-workstation",
    shellWrapper: "TerminalShell + EquityLayout",
    topChrome: ["CommandBar", "TickerTape", "TopBar"],
    statusChrome: ["MarketStatusBar", "TerminalToastViewport (page-local)"],
    pageShell: "ChartWorkstationPage",
    chartOrTablePattern: ["ChartPanel grid", "chart-specific toolbar actions"],
    duplicationSignals: [
      "Toast viewport mounted locally while global toasts also exist",
      "Chart panel headers differ slightly from launchpad panel headers",
    ],
    consolidationTarget: "Global AlertToasts + shared PanelChrome contract",
    hotspotPriority: "P0",
  },
  {
    route: "/equity/screener",
    shellWrapper: "TerminalShell + EquityLayout",
    topChrome: ["CommandBar", "TickerTape", "TopBar"],
    statusChrome: ["MarketStatusBar", "local screener status strips"],
    pageShell: "ScreenerPage + MultiMarketScanPanel",
    chartOrTablePattern: ["DenseTable", "legacy screener sub-panels"],
    duplicationSignals: [
      "Multiple mini-status bars and filter bars in screener subtree",
      "Button/input variants mixed between primitives and bespoke classes",
    ],
    consolidationTarget: "DenseTable header actions + TerminalInput/TerminalButton",
    hotspotPriority: "P0",
  },
  {
    route: "/equity/portfolio",
    shellWrapper: "TerminalShell + EquityLayout",
    topChrome: ["CommandBar", "TickerTape", "TopBar"],
    statusChrome: ["MarketStatusBar"],
    pageShell: "PortfolioPage + PortfolioManager",
    chartOrTablePattern: ["DenseTable holdings", "portfolio summary cards"],
    duplicationSignals: [
      "Legacy and manager modes both render separate control clusters",
      "Form controls use repeated layout snippets",
    ],
    consolidationTarget: "TerminalModal + TerminalInput + TerminalButton form sections",
    hotspotPriority: "P1",
  },
  {
    route: "/equity/news",
    shellWrapper: "TerminalShell + EquityLayout",
    topChrome: ["CommandBar", "TickerTape", "TopBar"],
    statusChrome: ["MarketStatusBar"],
    pageShell: "NewsPage",
    chartOrTablePattern: ["news list table-like rows", "sentiment badges"],
    duplicationSignals: [
      "List row actions repeated across news/security-hub views",
      "Badge semantics overlap with terminal badge variants",
    ],
    consolidationTarget: "DenseTable list mode + SentimentBadge",
    hotspotPriority: "P1",
  },
  {
    route: "/fno/*",
    shellWrapper: "FnoLayout",
    topChrome: ["module-specific top nav"],
    statusChrome: ["module-specific status patterns"],
    pageShell: "F&O page shells",
    chartOrTablePattern: ["mixed route-local toolbars/tables"],
    duplicationSignals: [
      "Layout chrome diverges from equity shell primitives",
      "Repeated section header/button styles in module pages",
    ],
    consolidationTarget: "Adopt TerminalShell-compatible module chrome adapters",
    hotspotPriority: "P1",
  },
  {
    route: "/backtesting/*",
    shellWrapper: "BacktestingLayout",
    topChrome: ["module-specific top bar"],
    statusChrome: ["module-specific status chips"],
    pageShell: "Backtesting page shells",
    chartOrTablePattern: ["analytics tables", "report panels"],
    duplicationSignals: [
      "Top bar/status composition overlaps with terminal shell capabilities",
      "Panel heading styles partially duplicated",
    ],
    consolidationTarget: "TerminalPanel + TerminalTabs + shared status primitives",
    hotspotPriority: "P2",
  },
];

export const duplicationCandidates: DuplicationCandidate[] = [
  {
    area: "shell",
    currentImplementations: ["TerminalShell", "FnoLayout", "BacktestingLayout", "AccountLayout"],
    targetPrimitive: "TerminalShell contract + module adapters",
    rationale: "Standardizes command/ticker/status layering and reduces route-specific shell drift.",
    migrationPriority: "P0",
  },
  {
    area: "toolbar",
    currentImplementations: ["TopBar", "Chart toolbar clusters", "Screener filter/status strips"],
    targetPrimitive: "TerminalButton + TerminalDropdown + TerminalTabs",
    rationale: "Removes ad-hoc toolbar class duplication and unifies keyboard/disabled behavior.",
    migrationPriority: "P0",
  },
  {
    area: "status",
    currentImplementations: ["MarketStatusBar", "local status rows", "page-local toast/status blocks"],
    targetPrimitive: "MarketStatusBar + AlertToasts + TerminalBadge",
    rationale: "Prevents duplicate status messaging systems with inconsistent semantics.",
    migrationPriority: "P0",
  },
  {
    area: "table",
    currentImplementations: ["DenseTable", "legacy table markup across pages"],
    targetPrimitive: "DenseTable with shared cell formatters",
    rationale: "Centralizes dense data behavior (sorting, density, deltas, selection).",
    migrationPriority: "P1",
  },
  {
    area: "chart",
    currentImplementations: ["TradingChart wrappers in stock/compare/workstation/launchpad"],
    targetPrimitive: "PanelChrome + ChartToolbar + ChartEngine bridge",
    rationale: "Avoids chart panel header and action drift as feature surface expands.",
    migrationPriority: "P1",
  },
  {
    area: "navigation",
    currentImplementations: ["Sidebar", "TopBar links", "module-local quick links"],
    targetPrimitive: "GO-command routing + shared quick-nav schema",
    rationale: "Reduces route-link duplication and keeps keyboard-first navigation consistent.",
    migrationPriority: "P2",
  },
];

export const migrationHotspots = {
  immediate: [
    "Unify chart/workstation/launchpad panel headers under PanelChrome",
    "Remove page-local toast viewports where AlertToasts already exists",
    "Normalize screener filter/status strips to terminal primitives",
  ],
  nearTerm: [
    "Refactor portfolio legacy + manager form controls into shared field sections",
    "Adopt DenseTable list mode for news-like tabular feeds",
  ],
  later: [
    "Introduce module adapters so FNO/backtesting inherit terminal shell chrome",
    "Converge route-link maps to GO-command-first navigation model",
  ],
} as const;
