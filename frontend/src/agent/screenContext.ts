import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import type { RunContext } from "./types";

// Routes where the active equity symbol (from the stock store) is the subject
// the user is looking at, even though the ticker isn't in the URL path.
const EQUITY_SYMBOL_ROUTES = [
  "/equity/stocks",
  "/equity/security",
  "/equity/cockpit",
  "/equity/chart",
  "/equity/compare",
  "/stocks",
  "/stock",
  "/security",
];

// Explicit ":ticker" URL routes (e.g. /equity/security/RELIANCE, /stock/AAPL).
const URL_SYMBOL_RE = /\/(?:stock|equity\/security|crypto|forex|commodities)\/([A-Za-z0-9.\-&]+)/;

/** Capture lightweight context about the screen the user is on so the agent
 *  defaults to the stock currently open (no need to re-type the ticker). */
export function buildScreenContext(): RunContext {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const ctx: RunContext = { route: path };

  // 1) Prefer a ticker explicitly present in the URL.
  const match = path.match(URL_SYMBOL_RE);
  if (match) {
    ctx.symbol = decodeURIComponent(match[1]).toUpperCase();
  } else if (EQUITY_SYMBOL_ROUTES.some((r) => path === r || path.startsWith(`${r}/`))) {
    // 2) Otherwise fall back to the active symbol held in the stock store
    //    (the stock detail / cockpit / chart pages drive this).
    const active = useStockStore.getState().ticker?.trim().toUpperCase();
    if (active) ctx.symbol = active;
  }

  // Carry the user's selected market so the agent resolves the right exchange
  // (e.g. an Indian name like "Supra Life Science" -> NSE, not a US ticker).
  try {
    const market = useSettingsStore.getState().selectedMarket;
    if (market) ctx.market = market;
  } catch {
    // settings store unavailable (e.g. in isolated tests) — context stays minimal.
  }

  return ctx;
}
