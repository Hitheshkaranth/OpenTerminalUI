export type ReviewInstrument = {
  symbol: string;
  chartSymbol: string;
  market: string;
  kind: "equity" | "commodity" | "crypto" | "forex" | "index";
  label: string;
  primaryPath: string;
  primaryLabel: string;
  chartAvailable?: boolean;
};

const INDEX_SYMBOLS: Record<string, string> = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK", FINNIFTY: "NIFTY_FIN_SERVICE.NS" };

/** Explicit suffixes and known indices win over the desk's selected exchange. */
export function reviewInstrument(symbol: string, market: string): ReviewInstrument {
  const value = symbol.trim().toUpperCase();
  const encoded = encodeURIComponent(value);
  const qualified = /^(NSE|BSE|NASDAQ|NYSE|AMEX):(.+)$/.exec(value);
  const resolvedMarket = qualified?.[1] || (value.endsWith(".NS") ? "NSE" : value.endsWith(".BO") ? "BSE" : market);
  const chartSymbol = qualified?.[2] || value;
  const securitySymbol = qualified || /\.(NS|BO)$/.test(value) ? value : /^(NSE|BSE|NASDAQ|NYSE|AMEX)$/.test(resolvedMarket) ? `${resolvedMarket}:${value}` : value;
  if (value.endsWith("=F")) return { symbol: value, chartSymbol: value, market: "NASDAQ", kind: "commodity", label: "Commodity continuous contract", primaryPath: `/equity/commodities?symbol=${encoded}`, primaryLabel: "Open commodity" };
  if (/^[A-Z0-9]+-(USD|USDT)$/.test(value)) return { symbol: value, chartSymbol: value, market: "NASDAQ", kind: "crypto", chartAvailable: !value.endsWith("-USDT"), label: "Crypto pair", primaryPath: `/equity/crypto?symbol=${encoded}`, primaryLabel: "Open crypto" };
  if (/^[A-Z]{6}=X$/.test(value)) return { symbol: value, chartSymbol: value, market: "NASDAQ", kind: "forex", label: "Currency pair", primaryPath: `/equity/forex?pair=${encodeURIComponent(value.slice(0, 6))}`, primaryLabel: "Open forex" };
  if (value.startsWith("^") && !Object.values(INDEX_SYMBOLS).includes(value)) return { symbol: value, chartSymbol: value, market: value.startsWith("^NSE") ? "NSE" : "NASDAQ", kind: "index", label: "Market index", primaryPath: `/equity/chart-workstation?ticker=${encoded}&symbol=${encoded}`, primaryLabel: "Open index chart" };
  if (INDEX_SYMBOLS[value] || Object.values(INDEX_SYMBOLS).includes(value)) return { symbol: value, chartSymbol: INDEX_SYMBOLS[value] || value, market: "NSE", kind: "index", label: "NSE underlying index", primaryPath: `/fno/futures?symbol=${encodeURIComponent(Object.entries(INDEX_SYMBOLS).find(([key, chart]) => key === value || chart === value)?.[0] || value)}`, primaryLabel: "Open futures" };
  return { symbol: value, chartSymbol, market: resolvedMarket, kind: "equity", label: "Security", primaryPath: `/equity/security?ticker=${encodeURIComponent(securitySymbol)}`, primaryLabel: "Open security" };
}
