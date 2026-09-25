export type NavItem = {
  id: string;
  label: string;
  to: string;
  glyph: string;
  hotkey?: string;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "markets",
    label: "Markets",
    items: [
      { id: "home", label: "Home", to: "/home", glyph: "HM" },
      { id: "market", label: "Market", to: "/equity/stocks", glyph: "MK" },
      { id: "watchlist", label: "Watchlist", to: "/equity/watchlist", glyph: "WL" },
      { id: "hotlists", label: "Hotlists", to: "/equity/hotlists", glyph: "HOT" },
      { id: "equity-heatmap", label: "Heatmap", to: "/equity/heatmap", glyph: "HM2" },
      { id: "news", label: "News", to: "/equity/news", glyph: "NW" },
      { id: "economics", label: "Economics", to: "/equity/economics", glyph: "EC" },
      { id: "commodities", label: "Commodities", to: "/equity/commodities", glyph: "CM" },
      { id: "forex", label: "Forex", to: "/equity/forex", glyph: "FX" },
      { id: "crypto", label: "Crypto", to: "/equity/crypto", glyph: "CR" },
      { id: "bonds", label: "Bonds", to: "/equity/bonds", glyph: "BD" },
      { id: "yield-curve", label: "Yield Curve", to: "/equity/yield-curve", glyph: "YC" },
      { id: "etf", label: "ETF", to: "/equity/etf-analytics", glyph: "ETF" },
      { id: "mutual-funds", label: "Mutual Funds", to: "/equity/mutual-funds", glyph: "MF" },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      { id: "security-hub", label: "Security Hub", to: "/equity/security", glyph: "SH" },
      { id: "screener", label: "Screener", to: "/equity/screener", glyph: "SC" },
      { id: "factors", label: "Factors", to: "/equity/factors", glyph: "FA" },
      { id: "insider", label: "Insider", to: "/equity/insider", glyph: "IN" },
      { id: "dividends", label: "Dividends", to: "/equity/dividends", glyph: "DV" },
      { id: "earnings", label: "Earnings", to: "/equity/earnings", glyph: "ER" },
      { id: "intelligence", label: "Intelligence", to: "/equity/intelligence-timeline", glyph: "IT" },
      { id: "research-library", label: "Research Library", to: "/equity/research", glyph: "RL" },
      { id: "sector-rotation", label: "Sector Rotation", to: "/equity/sector-rotation", glyph: "RO" },
      { id: "relative-strength", label: "Relative Strength", to: "/equity/rs", glyph: "RS" },
    ],
  },
  {
    id: "charts",
    label: "Charts",
    items: [
      { id: "workstation", label: "Workstation", to: "/equity/chart-workstation", glyph: "WS" },
      { id: "launchpad", label: "Launchpad", to: "/equity/launchpad", glyph: "LP" },
      { id: "compare", label: "Compare", to: "/equity/compare", glyph: "CP" },
      { id: "multi-tf", label: "Multi-TF", to: "/equity/mta", glyph: "MT" },
      { id: "dom", label: "DOM", to: "/equity/dom", glyph: "DM" },
      { id: "tape", label: "Tape", to: "/equity/tape", glyph: "TP" },
    ],
  },
  {
    id: "derivatives",
    label: "Derivatives",
    items: [
      { id: "option-chain", label: "Option Chain", to: "/fno", glyph: "OC" },
      { id: "greeks", label: "Greeks", to: "/fno/greeks", glyph: "GK" },
      { id: "futures", label: "Futures", to: "/fno/futures", glyph: "FU" },
      { id: "oi", label: "OI", to: "/fno/oi", glyph: "OI" },
      { id: "strategy", label: "Strategy", to: "/fno/strategy", glyph: "ST" },
      { id: "pcr", label: "PCR", to: "/fno/pcr", glyph: "PC" },
      { id: "flow", label: "Flow", to: "/fno/flow", glyph: "FL" },
      { id: "heatmap", label: "F&O Heatmap", to: "/fno/heatmap", glyph: "FH" },
      { id: "expiry", label: "Expiry", to: "/fno/expiry", glyph: "EX" },
      { id: "greeks-calc", label: "Greeks Calc", to: "/equity/option-greeks", glyph: "GC" },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    items: [
      { id: "portfolio", label: "Portfolio", to: "/equity/portfolio", glyph: "PF" },
      { id: "portfolio-lab", label: "Portfolio Lab", to: "/equity/portfolio/lab", glyph: "PL" },
      { id: "optimizer", label: "Optimizer", to: "/backtesting/portfolio-optimizer", glyph: "PO" },
      { id: "paper", label: "Paper", to: "/equity/paper", glyph: "PT" },
      { id: "journal", label: "Journal", to: "/equity/journal", glyph: "JR" },
      { id: "position-sizer", label: "Position Sizer", to: "/equity/position-sizer", glyph: "PS" },
      { id: "shadow", label: "Shadow", to: "/equity/shadow-account", glyph: "SA" },
      { id: "alerts", label: "Alerts", to: "/equity/alerts", glyph: "AL" },
    ],
  },
  {
    id: "quant",
    label: "Quant",
    items: [
      { id: "backtesting", label: "Backtesting", to: "/backtesting", glyph: "BT" },
      { id: "model-lab", label: "Model Lab", to: "/backtesting/model-lab", glyph: "ML" },
      { id: "governance", label: "Governance", to: "/backtesting/model-governance", glyph: "MG" },
      { id: "algo-framework", label: "Algo Framework", to: "/backtesting/algorithm-framework", glyph: "AF" },
      { id: "stat-lab", label: "Stat Lab", to: "/equity/stat-lab", glyph: "SL" },
      { id: "pair-trading", label: "Pair Trading", to: "/equity/pair-trading", glyph: "PR" },
      { id: "alpha-zoo", label: "Alpha Zoo", to: "/equity/alpha-zoo", glyph: "AZ" },
      { id: "research-autopilot", label: "Research Autopilot", to: "/equity/research-autopilot", glyph: "RA" },
      { id: "strategy-export", label: "Strategy Export", to: "/equity/strategy-export", glyph: "SE" },
    ],
  },
  {
    id: "risk_ops",
    label: "Risk & Ops",
    items: [
      { id: "risk", label: "Risk", to: "/equity/risk", glyph: "RK" },
      { id: "correlation", label: "Correlation", to: "/equity/correlation", glyph: "CO" },
      { id: "cockpit", label: "Cockpit", to: "/equity/cockpit", glyph: "CK" },
      { id: "oms", label: "OMS", to: "/equity/oms", glyph: "OM" },
      { id: "ops", label: "Ops", to: "/equity/ops", glyph: "OP" },
      { id: "data-quality", label: "Data Quality", to: "/equity/data-quality", glyph: "DQ" },
      { id: "reports", label: "Reports", to: "/equity/reports", glyph: "RP" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { id: "plugins", label: "Plugins", to: "/equity/plugins", glyph: "PG" },
      { id: "saved-views", label: "Saved Views", to: "/equity/saved-views", glyph: "SV" },
      { id: "settings", label: "Settings", to: "/equity/settings", glyph: "SG" },
      { id: "account", label: "Account", to: "/account", glyph: "AC" },
      { id: "about", label: "About", to: "/equity/stocks/about", glyph: "AB" },
    ],
  },
];

export const PINNED_DEFAULT: string[] = [
  "home",
  "market",
  "security-hub",
  "screener",
  "workstation",
  "portfolio",
  "watchlist",
  "alerts",
  "settings",
];

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota exceeded or private browsing */
  }
}

export function findNavItem(pathname: string): { section: NavSection; item: NavItem } | null {
  let bestMatch: { section: NavSection; item: NavItem } | null = null;

  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.to === pathname) {
        return { section, item };
      }
      if (pathname.startsWith(item.to + "/")) {
        if (!bestMatch || item.to.length > (bestMatch.item.to.length)) {
          bestMatch = { section, item };
        }
      }
    }
  }

  return bestMatch;
}