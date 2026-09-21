import type { CountryCode } from "../types/markets";

export type Exchange = "NSE" | "BSE" | "NYSE" | "NASDAQ";

export type Instrument = { symbol: string; exchange: Exchange | null };

const SUFFIX_MAP: Record<string, Exchange> = {
  NS: "NSE",
  BO: "BSE",
};

const PREFIX_MAP: Record<string, Exchange> = {
  NSE: "NSE",
  BSE: "BSE",
  NYSE: "NYSE",
  NASDAQ: "NASDAQ",
};

export const EXCHANGES: Exchange[] = ["NSE", "BSE", "NYSE", "NASDAQ"];

export function isExchange(v: unknown): v is Exchange {
  return typeof v === "string" && EXCHANGES.includes(v as Exchange);
}

export function parseInstrument(input: string): Instrument {
  const raw = (input || "").trim().toUpperCase();
  if (!raw) return { symbol: "", exchange: null };

  // Check for suffix pattern: "RELIANCE.NS" or "AAPL.NS"
  const suffixDotIndex = raw.lastIndexOf(".");
  if (suffixDotIndex !== -1) {
    const suffix = raw.slice(suffixDotIndex + 1);
    if (suffix in SUFFIX_MAP) {
      const symbol = raw.slice(0, suffixDotIndex);
      if (symbol) {
        return { symbol, exchange: SUFFIX_MAP[suffix] };
      }
    }
  }

  // Check for prefix pattern: "NSE:RELIANCE" or "NASDAQ:AAPL"
  const prefixColonIndex = raw.indexOf(":");
  if (prefixColonIndex !== -1) {
    const prefix = raw.slice(0, prefixColonIndex);
    if (prefix in PREFIX_MAP) {
      const symbol = raw.slice(prefixColonIndex + 1);
      if (symbol) {
        return { symbol, exchange: PREFIX_MAP[prefix] };
      }
    }
  }

  // No recognized prefix or suffix — bare symbol
  return { symbol: raw, exchange: null };
}

export function formatInstrument(i: Instrument): string {
  if (i.exchange) {
    return `${i.exchange}:${i.symbol}`;
  }
  return i.symbol;
}

const EXCHANGE_COUNTRY: Record<Exchange, CountryCode> = {
  NSE: "IN",
  BSE: "IN",
  NYSE: "US",
  NASDAQ: "US",
};

export function countryForExchange(ex: Exchange): "IN" | "US" {
  return EXCHANGE_COUNTRY[ex];
}