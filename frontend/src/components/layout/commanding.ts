import type { NavigateFunction } from "react-router-dom";

import { useStockStore } from "../../store/stockStore";

export type CommandFunctionCode =
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
    navigateToSecurityHub(navigate, parsed.ticker, "overview");
    return { ok: true, target: `/equity/security/${parsed.ticker}` };
  }

  if (parsed.kind === "ticker-function") {
    applyTicker(parsed.ticker);
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
