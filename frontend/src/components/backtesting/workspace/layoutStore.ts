export type WorkspaceLayoutKey =
  | "backtest-research"
  | "risk-monitor"
  | "trade-analysis"
  | "full-report";

const STORAGE_KEY = "backtesting.mosaic.layout";

export function saveLayout(layout: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    // ignore storage errors
  }
}

export function loadLayout(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
