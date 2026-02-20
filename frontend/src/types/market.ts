/** Shared market data types — mirrors backend Pydantic/dataclass shapes. */

export type Exchange = "NSE" | "BSE" | "NFO" | "NYSE" | "NASDAQ" | "CME" | "AMEX";

export type Segment = "EQ" | "FUT" | "OPT" | "IDX" | "ETF";

export type OptionType = "CE" | "PE" | "C" | "P";

export interface Quote {
  symbol: string;
  ltp: number;
  bid?: number;
  ask?: number;
  bid_qty?: number;
  ask_qty?: number;
  volume: number;
  open_interest?: number;
  prev_close: number;
  change: number;
  change_pct: number;
  high: number;
  low: number;
  open: number;
  timestamp: string;
  provider?: string;
}

export interface OptionContractData {
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  option_type: OptionType;
  ltp: number;
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  oi: number;
  oi_change: number;
  volume: number;
  lot_size: number;
}

export interface OptionChainData {
  underlying: string;
  spot_price: number;
  expiry: string;
  contracts: OptionContractData[];
  pcr_oi: number;
  pcr_volume: number;
  max_pain: number | null;
  timestamp: string;
}

export interface FuturesContractData {
  symbol: string;
  underlying: string;
  expiry: string;
  ltp: number;
  basis: number;
  basis_pct: number;
  annualized_basis: number;
  oi: number;
  volume: number;
  lot_size: number;
  change: number;
  change_pct: number;
}

export type MarketStatus = "open" | "closed" | "pre_market" | "after_hours" | "holiday";

export interface FreshnessInfo {
  status: MarketStatus;
  last_update: string;
  staleness_sec: number;
  exchange: Exchange;
}
