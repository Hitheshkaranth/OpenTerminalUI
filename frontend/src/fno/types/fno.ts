export type Greeks = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
};

export type OptionLegData = {
  oi: number;
  oi_change: number;
  volume: number;
  iv: number;
  ltp: number;
  bid: number;
  ask: number;
  price_change?: number;
  greeks: Greeks;
};

export type StrikeData = {
  strike_price: number;
  ce: OptionLegData | null;
  pe: OptionLegData | null;
};

export type OptionChainResponse = {
  symbol: string;
  spot_price: number;
  timestamp: string;
  expiry_date: string;
  available_expiries: string[];
  atm_strike: number;
  strikes: StrikeData[];
  totals: {
    ce_oi_total: number;
    pe_oi_total: number;
    ce_volume_total: number;
    pe_volume_total: number;
    pcr_oi: number;
    pcr_volume: number;
  };
};

export type OIAnalysis = {
  symbol: string;
  expiry_date: string;
  spot_price: number;
  max_pain: number;
  support_resistance: { support: number[]; resistance: number[] };
  pcr: { pcr_oi: number; pcr_volume: number; pcr_oi_change: number; signal: string };
  buildup: Array<{
    strike_price: number;
    ce_pattern: string;
    pe_pattern: string;
    ce_oi_change: number;
    pe_oi_change: number;
    ce_price_change: number;
    pe_price_change: number;
  }>;
};

export type ChainSummary = {
  symbol: string;
  expiry_date: string;
  spot_price: number;
  atm_strike: number;
  atm_iv: number;
  pcr: { pcr_oi: number; pcr_volume: number; pcr_oi_change: number; signal: string };
  max_pain: number;
  support_resistance: { support: number[]; resistance: number[] };
};

export type GreeksChainResponse = {
  symbol: string;
  expiry_date: string;
  spot_price: number;
  atm_strike: number;
  strikes: StrikeData[];
};

export type FnoContextValue = {
  symbol: string;
  setSymbol: (value: string) => void;
  expiry: string;
  setExpiry: (value: string) => void;
  expiries: string[];
};

export const DEFAULT_FNO_SYMBOLS = [
  "NIFTY",
  "BANKNIFTY",
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "LT",
  "AXISBANK",
  "KOTAKBANK",
  "ITC",
  "BAJFINANCE",
  "MARUTI",
  "TATAMOTORS",
  "BHARTIARTL",
  "SUNPHARMA",
  "HCLTECH",
  "WIPRO",
  "ADANIPORTS",
  "NTPC",
  "ONGC",
] as const;

export function formatIndianCompact(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)}L`;
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function formatCurrencyINR(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `?${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
