import { useMemo } from "react";

export type ShortcutCategory = "navigation" | "charts" | "trading" | "screener" | "global";

export interface ShortcutDefinition {
  id: string;
  label: string;
  keys: string;
  action: string;
  category: ShortcutCategory;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: "go-bar", label: "Focus GO Bar", keys: "Ctrl+G", action: "focus-go-bar", category: "global" },
  { id: "show-shortcuts", label: "Show Shortcuts Help", keys: "Ctrl+/", action: "show-shortcuts", category: "global" },
  { id: "toggle-trading-panel", label: "Toggle Trading Panel", keys: "Ctrl+T", action: "toggle-trading-panel", category: "trading" },
  { id: "market-heatmap", label: "Market Heatmap", keys: "G, H", action: "/equity/heatmap", category: "navigation" },
  { id: "screener", label: "Screener", keys: "G, S", action: "/equity/screener", category: "screener" },
  { id: "portfolio", label: "Portfolio", keys: "G, P", action: "/equity/portfolio", category: "navigation" },
  { id: "watchlist", label: "Watchlist", keys: "G, W", action: "/equity/watchlist", category: "navigation" },
  { id: "chart-workstation", label: "Chart Workstation", keys: "G, C", action: "/equity/chart-workstation", category: "charts" },
  { id: "fno-chain", label: "Option Chain", keys: "G, O", action: "/fno", category: "charts" },
  { id: "fno-futures", label: "Futures", keys: "G, U", action: "/fno/futures", category: "charts" },
  { id: "fno-oi", label: "Open Interest", keys: "G, I", action: "/fno/oi", category: "charts" },
  { id: "fno-pcr", label: "PCR", keys: "G, R", action: "/fno/pcr", category: "charts" },
  { id: "risk", label: "Risk Dashboard", keys: "G, R", action: "/equity/risk", category: "navigation" },
  { id: "paper-trading", label: "Paper Trading", keys: "G, A", action: "/equity/paper", category: "trading" },
  { id: "journal", label: "Trade Journal", keys: "G, J", action: "/equity/journal", category: "trading" },
  { id: "settings", label: "Settings", keys: "G, X", action: "/equity/settings", category: "global" },
  { id: "oms", label: "OMS / Compliance", keys: "G, M", action: "/equity/oms", category: "trading" },
  { id: "ops", label: "Ops Dashboard", keys: "G, D", action: "/equity/ops", category: "global" },
  { id: "mutual-funds", label: "Mutual Funds", keys: "G, F", action: "/equity/mutual-funds", category: "navigation" },
  { id: "bonds", label: "Bonds", keys: "G, B", action: "/equity/bonds", category: "navigation" },
  { id: "hotlists", label: "Hotlists", keys: "G, L", action: "/equity/hotlists", category: "navigation" },
  { id: "security-hub", label: "Security Hub", keys: "G, H", action: "/equity/security", category: "charts" },
  { id: "dividends", label: "Dividend Dashboard", keys: "G, V", action: "/equity/dividends", category: "screener" },
  { id: "saved-views", label: "Saved Views", keys: "G, Q", action: "/equity/saved-views", category: "screener" },
];

export function getShortcutsByCategory(): Record<ShortcutCategory, ShortcutDefinition[]> {
  const groups: Record<ShortcutCategory, ShortcutDefinition[]> = {
    navigation: [],
    charts: [],
    trading: [],
    screener: [],
    global: [],
  };
  for (const s of SHORTCUT_DEFINITIONS) {
    groups[s.category].push(s);
  }
  return groups;
}

export function filterShortcuts(query: string): ShortcutDefinition[] {
  if (!query.trim()) return SHORTCUT_DEFINITIONS;
  const q = query.toLowerCase();
  return SHORTCUT_DEFINITIONS.filter(
    (s) => s.label.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
  );
}