import type { NavigateFunction } from "react-router-dom";

import { useStockStore } from "../../store/stockStore";

export type CommandFunctionCode =
  | "DESK"
  | "DES"
  | "GP"
  | "FA"
  | "NEWS"
  | "OPT"
  | "EST"
  | "PEER"
  | "OWN"
  | "EQS"
  | "PORT"
  | "WL"
  | "TOP"
  | "BT"
  | "SET"
  | "OPS"
  | "LAUNCH"
  | "COMP"
  | "YCURVE"
  | "ECAL"
  | "ECOF"
  | "FRED"
  | "RRG"
  | "CRYP";

export type ParsedCommand =
  | {
      kind: "ticker";
      raw: string;
      ticker: string;
    }
  | {
      kind: "ticker-function";
      raw: string;
      ticker: string;
      func: CommandFunctionCode;
      modifiers: string[];
    }
  | {
      kind: "function";
      raw: string;
      func: CommandFunctionCode;
      modifiers: string[];
    }
  | {
      kind: "natural-language";
      raw: string;
      query: string;
    };

export type CommandExecutionResult = {
  ok: boolean;
  target?: string;
  message?: string;
};

export type CommandFunctionSpec = {
  code: CommandFunctionCode;
  label: string;
  description: string;
  aliases?: string[];
  securityScoped?: boolean;
};

export const COMMAND_FUNCTIONS: CommandFunctionSpec[] = [
  { code: "DESK", label: "Analyst Desk", description: "Open the cockpit analyst workspace", aliases: ["COCKPIT", "MONITOR"] },
  { code: "DES", label: "Description / Security Hub", description: "Open security hub overview", securityScoped: true, aliases: ["SECURITY", "HUB"] },
  { code: "GP", label: "Graph Price", description: "Open chart tab", securityScoped: true, aliases: ["CHART"] },
  { code: "FA", label: "Financial Analysis", description: "Open financials tab", securityScoped: true, aliases: ["FIN", "FUNDAMENTALS"] },
  { code: "NEWS", label: "News", description: "Open news (global or ticker-specific)", aliases: ["N"] },
  { code: "OPT", label: "Options", description: "Open options / F&O view", securityScoped: true, aliases: ["OPTIONS"] },
  { code: "EST", label: "Estimates", description: "Open analyst estimates tab", securityScoped: true, aliases: ["ESTIMATES"] },
  { code: "PEER", label: "Peers", description: "Open peers comparison tab", securityScoped: true, aliases: ["PEERS"] },
  { code: "OWN", label: "Ownership", description: "Open ownership tab", securityScoped: true, aliases: ["OWNERSHIP"] },
  { code: "EQS", label: "Equity Screener", description: "Open equity screener", aliases: ["SCREENER"] },
  { code: "PORT", label: "Portfolio", description: "Open portfolio", aliases: ["PF", "PORTFOLIO"] },
  { code: "WL", label: "Watchlist", description: "Open watchlist", aliases: ["WATCHLIST"] },
  { code: "TOP", label: "Top Stories", description: "Open top market stories", aliases: ["HEADLINES"] },
  { code: "BT", label: "Backtesting", description: "Open backtesting workspace", aliases: ["BACKTEST"] },
  { code: "SET", label: "Settings", description: "Open settings", aliases: ["SETTINGS"] },
  { code: "OPS", label: "Ops Dashboard", description: "Open operations dashboard", aliases: ["OPERATIONS"] },
  { code: "LAUNCH", label: "Launchpad", description: "Open multi-panel launchpad", aliases: ["LP", "LAUNCHPAD"] },
  { code: "COMP", label: "Split Compare", description: "Open split-screen comparison", aliases: ["COMPARE"] },
  { code: "YCURVE", label: "Yield Curve", description: "Open US Treasury yield curve dashboard", aliases: ["GC", "YIELD", "CURVE"] },
  { code: "ECAL", label: "Economic Calendar", description: "Open global economic calendar", aliases: ["CALENDAR"] },
  { code: "ECOF", label: "Macro Dashboard", description: "Open macro indicators dashboard", aliases: ["MACRO", "INDICATORS"] },
  { code: "FRED", label: "FRED Series", description: "Chart a FRED economic series", aliases: ["SERIES"] },
  { code: "RRG", label: "Sector Rotation Map", description: "Relative Rotation Graph (RRG)", aliases: ["SROT", "SECTOR"] },
  { code: "CRYP", label: "Crypto Workspace", description: "Open dedicated crypto workspace", aliases: ["CRYPTO"] },
];

const FUNCTION_LOOKUP = new Map<string, CommandFunctionCode>(
  COMMAND_FUNCTIONS.flatMap((fn) => [fn.code, ...(fn.aliases ?? [])].map((key) => [key.toUpperCase(), fn.code] as const)),
);

function normalizeToken(value: string): string {
  return value.trim().toUpperCase();
}

function looksLikeTicker(token: string): boolean {
  return /^[A-Z0-9.\-]{1,20}$/.test(token);
}

export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();
  const tokens = raw
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  if (!tokens.length) {
    return { kind: "natural-language", raw, query: "" };
  }

  if (tokens.length === 1) {
    const fn = FUNCTION_LOOKUP.get(tokens[0]);
    if (fn) return { kind: "function", raw, func: fn, modifiers: [] };
    if (looksLikeTicker(tokens[0])) return { kind: "ticker", raw, ticker: tokens[0] };
    return { kind: "natural-language", raw, query: raw };
  }

  const firstAsFn = FUNCTION_LOOKUP.get(tokens[0]);
  if (firstAsFn) {
    return { kind: "function", raw, func: firstAsFn, modifiers: tokens.slice(1) };
  }

  const lastToken = tokens[tokens.length - 1];
  const lastAsFn = FUNCTION_LOOKUP.get(lastToken);

  if (lastAsFn && tokens.length > 1) {
    const previousTokens = tokens.slice(0, tokens.length - 1);
    if (previousTokens.every(looksLikeTicker)) {
      if (previousTokens.length > 1) {
        return { kind: "function", raw, func: lastAsFn, modifiers: previousTokens };
      }
      return { kind: "ticker-function", raw, ticker: previousTokens[0], func: lastAsFn, modifiers: [] };
    }
  }

  const secondAsFn = FUNCTION_LOOKUP.get(tokens[1]);
  if (looksLikeTicker(tokens[0]) && secondAsFn) {
    return { kind: "ticker-function", raw, ticker: tokens[0], func: secondAsFn, modifiers: tokens.slice(2) };
  }

  if (looksLikeTicker(tokens[0])) {
    return { kind: "ticker", raw, ticker: tokens[0] };
  }

  return { kind: "natural-language", raw, query: raw };
}

function navigateToSecurityHub(navigate: NavigateFunction, ticker: string, tab: string = "overview", modifiers: string[] = []) {
  let url = `/equity/security/${encodeURIComponent(ticker)}?tab=${encodeURIComponent(tab)}`;
  if (tab === "chart" && modifiers.length > 0) {
    url += `&compare=${encodeURIComponent(modifiers.join(","))}`;
  }
  navigate(url);
}

function navigateToMarketStock(navigate: NavigateFunction, ticker: string) {
  navigate(`/equity/stocks?ticker=${encodeURIComponent(ticker)}`);
}

function applyTicker(ticker: string) {
  const store = useStockStore.getState();
  store.setTicker(ticker);
  void store.load();
}

function securityFuncToTab(func: CommandFunctionCode): string {
  switch (func) {
    case "DES":
      return "overview";
    case "GP":
      return "chart";
    case "FA":
      return "financials";
    case "NEWS":
      return "news";
    case "EST":
      return "estimates";
    case "PEER":
      return "peers";
    case "OWN":
      return "ownership";
    case "OPT":
      return "chart";
    default:
      return "overview";
  }
}

export function executeParsedCommand(parsed: ParsedCommand, navigate: NavigateFunction): CommandExecutionResult {
  if (parsed.kind === "natural-language") {
    if (!parsed.query.trim()) return { ok: false, message: "Empty command" };
    navigate(`/equity/news?q=${encodeURIComponent(parsed.query.trim())}&ai=1`);
    return { ok: true, target: "/equity/news" };
  }

  if (parsed.kind === "ticker") {
    applyTicker(parsed.ticker);
    navigateToMarketStock(navigate, parsed.ticker);
    return { ok: true, target: `/equity/stocks?ticker=${parsed.ticker}` };
  }

  if (parsed.kind === "ticker-function") {
    applyTicker(parsed.ticker);
    if (parsed.func === "DESK") {
      navigate(`/equity/cockpit?ticker=${encodeURIComponent(parsed.ticker)}`);
      return { ok: true, target: "/equity/cockpit" };
    }
    if (parsed.func === "OPT") {
      navigate(`/fno?symbol=${encodeURIComponent(parsed.ticker)}`);
      return { ok: true, target: "/fno" };
    }
    navigateToSecurityHub(navigate, parsed.ticker, securityFuncToTab(parsed.func));
    return { ok: true, target: `/equity/security/${parsed.ticker}` };
  }

  if (parsed.kind === "function") {
    const mod0 = parsed.modifiers[0];
    switch (parsed.func) {
      case "DESK":
        if (mod0 && looksLikeTicker(mod0)) {
          applyTicker(mod0);
          navigate(`/equity/cockpit?ticker=${encodeURIComponent(mod0)}`);
          return { ok: true, target: "/equity/cockpit" };
        }
        navigate("/equity/cockpit");
        return { ok: true, target: "/equity/cockpit" };
      case "EQS":
        navigate("/equity/screener");
        return { ok: true, target: "/equity/screener" };
      case "PORT":
        navigate("/equity/portfolio");
        return { ok: true, target: "/equity/portfolio" };
      case "WL": {
        const name = mod0 || "";
        const target = name ? `/equity/watchlist?name=${encodeURIComponent(name)}` : "/equity/watchlist";
        navigate(target);
        return { ok: true, target: "/equity/watchlist" };
      }
      case "NEWS":
        if (mod0 && looksLikeTicker(mod0)) {
          applyTicker(mod0);
          navigateToSecurityHub(navigate, mod0, "news");
          return { ok: true, target: `/equity/security/${mod0}` };
        }
        navigate("/equity/news");
        return { ok: true, target: "/equity/news" };
      case "TOP":
        navigate("/equity/news?view=top");
        return { ok: true, target: "/equity/news" };
      case "BT":
        navigate("/backtesting");
        return { ok: true, target: "/backtesting" };
      case "SET":
        navigate("/equity/settings");
        return { ok: true, target: "/equity/settings" };
      case "OPS":
        navigate("/equity/ops");
        return { ok: true, target: "/equity/ops" };
      case "LAUNCH":
        navigate("/equity/launchpad");
        return { ok: true, target: "/equity/launchpad" };
      case "YCURVE":
        navigate("/equity/yield-curve");
        return { ok: true, target: "/equity/yield-curve" };
      case "ECAL":
        navigate("/equity/economics?tab=calendar");
        return { ok: true, target: "/equity/economics" };
      case "ECOF":
        navigate("/equity/economics?tab=macro");
        return { ok: true, target: "/equity/economics" };
      case "FRED": {
        const series = mod0 || "CPIAUCSL";
        navigate(`/equity/security/FRED:${series.toUpperCase()}?tab=chart`);
        return { ok: true, target: "/equity/security" };
      }
      case "RRG":
        navigate("/equity/sector-rotation");
        return { ok: true, target: "/equity/sector-rotation" };
      case "CRYP":
        navigate("/equity/crypto");
        return { ok: true, target: "/equity/crypto" };
      case "COMP": {
        const left = mod0 && looksLikeTicker(mod0) ? mod0 : useStockStore.getState().ticker || "AAPL";
        const right = parsed.modifiers[1] && looksLikeTicker(parsed.modifiers[1]) ? parsed.modifiers[1] : "MSFT";
        navigate(`/equity/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
        return { ok: true, target: "/equity/compare" };
      }
      case "DES":
      case "GP":
      case "FA":
      case "OPT":
      case "EST":
      case "PEER":
      case "OWN":
        if (mod0 && looksLikeTicker(mod0)) {
          applyTicker(mod0);
          if (parsed.func === "OPT") {
            navigate(`/fno?symbol=${encodeURIComponent(mod0)}`);
            return { ok: true, target: "/fno" };
          }
          const otherModifiers = parsed.modifiers.slice(1);
          navigateToSecurityHub(navigate, mod0, securityFuncToTab(parsed.func), otherModifiers);
          return { ok: true, target: `/equity/security/${mod0}` };
        }
        return { ok: false, message: `${parsed.func} requires a ticker` };
      default:
        return { ok: false, message: "Unknown function" };
    }
  }

  return { ok: false, message: "Unsupported command" };
}

export type CommandSuggestion =
  | {
      kind: "function";
      key: string;
      title: string;
      subtitle: string;
      command: string;
    }
  | {
      kind: "ticker";
      key: string;
      title: string;
      subtitle: string;
      command: string;
      price?: number | null;
    }
  | {
      kind: "recent";
      key: string;
      title: string;
      subtitle: string;
      command: string;
    };

export type ShortcutScope = "global" | "chart-workstation" | "chart-panel" | "command-bar";

export type ShortcutSpec = {
  id: string;
  combo: string;
  description: string;
  scope: ShortcutScope;
};

export type ShortcutConflict = {
  combo: string;
  entries: ShortcutSpec[];
};

export type ChartWorkstationActionId =
  | "chart.toggleIndicators"
  | "chart.toggleDrawingTools"
  | "chart.toggleVolumeProfile"
  | "chart.toggleReplay"
  | "chart.openAlerts";

export type ChartWorkstationCommandSpec = {
  id: ChartWorkstationActionId;
  title: string;
  description: string;
  command: string;
  shortcut: string;
  keywords: string[];
};

export const CHART_WORKSTATION_ACTION_EVENT = "ot:chart-workstation:action";
export type ChartWorkstationActionEventDetail = {
  id: ChartWorkstationActionId;
  handled?: boolean;
  ok?: boolean;
  message?: string;
};

export const CHART_WORKSTATION_COMMAND_SPECS: ChartWorkstationCommandSpec[] = [
  {
    id: "chart.toggleIndicators",
    title: "Toggle Indicators",
    description: "Open or close indicators for the focused chart pane",
    command: "chart indicators",
    shortcut: "I",
    keywords: ["indicator", "study", "overlay", "panel"],
  },
  {
    id: "chart.toggleDrawingTools",
    title: "Toggle Drawing Tools",
    description: "Open or close drawing tools for the focused chart pane",
    command: "chart drawings",
    shortcut: "D",
    keywords: ["draw", "trendline", "objects", "annotations"],
  },
  {
    id: "chart.toggleVolumeProfile",
    title: "Toggle Volume Profile",
    description: "Show or hide the volume profile overlay for the focused chart pane",
    command: "chart volume profile",
    shortcut: "V",
    keywords: ["vpoc", "volume", "profile", "histogram"],
  },
  {
    id: "chart.toggleReplay",
    title: "Toggle Replay",
    description: "Enable or disable replay controls for the focused chart pane",
    command: "chart replay",
    shortcut: "R",
    keywords: ["bar replay", "replay", "backtest", "session"],
  },
  {
    id: "chart.openAlerts",
    title: "Open Alert Center",
    description: "Open alert workflows for the focused chart symbol",
    command: "chart alerts",
    shortcut: "A",
    keywords: ["alert", "price alert", "notifications", "trigger"],
  },
];

export const SHORTCUT_SPECS: ShortcutSpec[] = [
  { id: "palette.toggle", combo: "Ctrl/Cmd+K", description: "Toggle command palette", scope: "global" },
  { id: "shortcuts.help", combo: "Ctrl/Cmd+/", description: "Open shortcut help", scope: "global" },
  { id: "command.focus", combo: "Ctrl/Cmd+G", description: "Focus GO command bar", scope: "command-bar" },
  { id: "news.open", combo: "Ctrl/Cmd+N", description: "Open news", scope: "global" },
  { id: "watchlist.open", combo: "Ctrl/Cmd+W", description: "Open watchlist (non-workstation pages)", scope: "global" },
  { id: "launchpad.open", combo: "Ctrl/Cmd+9", description: "Open launchpad", scope: "global" },
  { id: "ws.panel.next", combo: "Tab", description: "Focus next visible chart panel", scope: "chart-workstation" },
  { id: "ws.panel.prev", combo: "Shift+Tab", description: "Focus previous visible chart panel", scope: "chart-workstation" },
  { id: "ws.panel.pick", combo: "1-9", description: "Focus visible chart panel by index", scope: "chart-workstation" },
  { id: "ws.panel.add", combo: "Ctrl/Cmd+Shift+N", description: "Add chart panel", scope: "chart-workstation" },
  { id: "ws.panel.close", combo: "Ctrl/Cmd+W", description: "Close active chart panel", scope: "chart-workstation" },
  { id: "ws.layout.focus", combo: "Ctrl/Cmd+L", description: "Focus layout selector", scope: "chart-workstation" },
  { id: "ws.fullscreen", combo: "F", description: "Toggle active panel fullscreen", scope: "chart-workstation" },
  { id: "ws.escape", combo: "Escape", description: "Exit fullscreen or clear active panel", scope: "chart-workstation" },
  { id: "ws.tf.hotkeys", combo: "Alt+1..7", description: "Set timeframe (1m,5m,15m,1h,1D,1W,1M)", scope: "chart-workstation" },
  { id: "chart.indicators", combo: "I", description: "Toggle indicators for the focused chart pane", scope: "chart-panel" },
  { id: "chart.drawings", combo: "D", description: "Toggle drawing tools for the focused chart pane", scope: "chart-panel" },
  { id: "chart.volume-profile", combo: "V", description: "Toggle volume profile for the focused chart pane", scope: "chart-panel" },
  { id: "chart.replay", combo: "R", description: "Toggle replay for the focused chart pane", scope: "chart-panel" },
  { id: "chart.alerts", combo: "A", description: "Open alert center for the focused chart symbol", scope: "chart-panel" },
];

export function isShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isShortcutMenuTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="menu"]'));
}

export function isShortcutWithinChartPanel(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("[data-slot-id]"));
}

export function dispatchChartWorkstationAction(actionId: ChartWorkstationActionId): CommandExecutionResult {
  if (typeof window === "undefined") {
    return { ok: false, message: "Chart workstation is unavailable" };
  }
  const detail: ChartWorkstationActionEventDetail = {
    id: actionId,
    handled: false,
    ok: false,
  };
  window.dispatchEvent(
    new CustomEvent<ChartWorkstationActionEventDetail>(CHART_WORKSTATION_ACTION_EVENT, {
      detail,
    }),
  );
  if (!detail.handled) {
    return { ok: false, message: "Chart workstation is not ready" };
  }
  return detail.ok
    ? { ok: true }
    : { ok: false, message: detail.message || "Chart command could not be completed" };
}

function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a === b) return true;
  if (a === "global" || b === "global") return true;
  return false;
}

export function findShortcutConflicts(specs: ShortcutSpec[] = SHORTCUT_SPECS): ShortcutConflict[] {
  const byCombo = new Map<string, ShortcutSpec[]>();
  for (const spec of specs) {
    const key = spec.combo.trim().toLowerCase();
    const rows = byCombo.get(key);
    if (rows) rows.push(spec);
    else byCombo.set(key, [spec]);
  }

  const conflicts: ShortcutConflict[] = [];
  for (const [combo, rows] of byCombo) {
    if (rows.length < 2) continue;
    let overlapping = false;
    for (let i = 0; i < rows.length && !overlapping; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (scopesOverlap(rows[i].scope, rows[j].scope)) {
          overlapping = true;
          break;
        }
      }
    }
    if (overlapping) {
      conflicts.push({ combo, entries: rows });
    }
  }
  return conflicts;
}

export function fuzzyScore(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 0;
  if (h === n) return 1000;
  if (h.startsWith(n)) return 800 - (h.length - n.length);
  if (h.includes(n)) return 500 - h.indexOf(n);
  let score = 0;
  let cursor = 0;
  for (const ch of n) {
    const idx = h.indexOf(ch, cursor);
    if (idx < 0) return -1;
    score += idx === cursor ? 12 : 4;
    cursor = idx + 1;
  }
  return score;
}
