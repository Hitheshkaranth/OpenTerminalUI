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
  market?: "US" | "NSE";
  spot_price: number;
  timestamp: string;
  expiry_date: string;
  available_expiries: string[];
  atm_strike: number;
  iv_rank?: number;
  iv_percentile?: number;
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
  market?: "US" | "NSE";
  expiry_date: string;
  spot_price: number;
  atm_strike: number;
  atm_iv: number;
  iv_rank?: number;
  iv_percentile?: number;
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

export type StrategyLeg = {
  type: "CE" | "PE";
  strike: number;
  action: "buy" | "sell";
  premium: number;
  lots: number;
  lot_size: number;
  expiry: string;
};

export type StrategyPayoffPoint = { spot: number; pnl: number };

export type StrategyPayoffResponse = {
  legs: StrategyLeg[];
  payoff_at_expiry: StrategyPayoffPoint[];
  max_profit: number | "unlimited";
  max_loss: number | "unlimited";
  breakeven_points: number[];
  risk_reward_ratio: number;
  net_premium: number;
  total_margin_approx: number;
  strategy_name: string;
};

export type PCRCurrentResponse = {
  symbol: string;
  expiry_date: string;
  timestamp: string;
  pcr_oi: number;
  pcr_vol: number;
  pcr_oi_change: number;
  signal: string;
  total_ce_oi: number;
  total_pe_oi: number;
};

export type PCRHistoryPoint = {
  date: string;
  pcr_oi: number;
  pcr_vol: number;
  signal: string;
};

export type PCRByStrikePoint = {
  strike: number;
  ce_oi: number;
  pe_oi: number;
  pcr_oi: number;
  ce_vol: number;
  pe_vol: number;
  pcr_vol: number;
};

export type IvSkewResponse = {
  symbol: string;
  expiry: string;
  spot: number;
  atm_iv: number;
  iv_skew: Array<{ strike: number; ce_iv: number; pe_iv: number; moneyness: number }>;
  iv_percentile: number;
  iv_rank: number;
};

export type IvSurfaceResponse = {
  symbol: string;
  expiries: string[];
  strikes: number[];
  surface: number[][];
};

export type FlowStrikeContext = {
  atm_strike: number;
  pcr_oi: number;
  pcr_volume: number;
  strike_row: StrikeData;
};

export type OptionsFlowItem = {
  timestamp: string;
  symbol: string;
  expiry: string;
  strike: number;
  option_type: "CE" | "PE";
  volume: number;
  avg_volume: number;
  volume_ratio: number;
  oi: number;
  oi_change: number;
  premium_value: number;
  implied_vol: number;
  sentiment: "bullish" | "bearish";
  heat_score: number;
  spot_price?: number;
  chain_context?: FlowStrikeContext;
};

export type OptionsFlowSummary = {
  total_premium: number;
  bullish_premium: number;
  bearish_premium: number;
  bullish_pct: number;
  bearish_pct: number;
  top_symbols: Array<{ symbol: string; premium: number; flow_count: number }>;
  premium_by_hour: Array<{ hour: string; bullish: number; bearish: number }>;
  flow_count?: number;
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
  return `Rs ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
