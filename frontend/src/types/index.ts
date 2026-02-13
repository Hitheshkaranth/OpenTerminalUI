export type ChartPoint = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type ChartResponse = {
  ticker: string;
  interval: string;
  currency: string;
  data: ChartPoint[];
  meta?: {
    warnings?: Array<{ code: string; message: string }>;
  };
};

export type IndicatorPoint = {
  t: number;
  values: Record<string, number | null>;
};

export type IndicatorResponse = {
  ticker: string;
  indicator: string;
  params: Record<string, number | string>;
  data: IndicatorPoint[];
  meta?: {
    warnings?: Array<{ code: string; message: string }>;
  };
};

export type StockSnapshot = {
  ticker: string;
  symbol: string;
  company_name?: string;
  sector?: string;
  industry?: string;
  current_price?: number;
  change_pct?: number;
  market_cap?: number;
  pe?: number;
  forward_pe_calc?: number;
  pb_calc?: number;
  ps_calc?: number;
  ev_ebitda?: number;
  roe_pct?: number;
  roa_pct?: number;
  op_margin_pct?: number;
  net_margin_pct?: number;
  rev_growth_pct?: number;
  eps_growth_pct?: number;
  div_yield_pct?: number;
  beta?: number;
  fifty_two_week_low?: number;
  fifty_two_week_high?: number;
  raw?: any;
};

export type FinancialSection = Array<Record<string, string | number | null>>;

export type FinancialsResponse = {
  ticker: string;
  period: "annual" | "quarterly";
  income_statement: FinancialSection;
  balance_sheet: FinancialSection;
  cashflow: FinancialSection;
};

export type ScreenerRule = {
  field: string;
  op: ">" | "<" | ">=" | "<=" | "==" | "!=";
  value: number;
};

export type ScreenerResponse = {
  count: number;
  rows: Array<Record<string, string | number | null>>;
  meta?: {
    warnings?: Array<{ code: string; message: string }>;
  };
};

export type PeerMetric = {
  metric: string;
  target_value: number;
  peer_median: number | null;
  peer_mean: number | null;
  target_percentile: number | null;
};

export type PeerResponse = {
  ticker: string;
  universe: string;
  metrics: PeerMetric[];
};

export type RelativeValuationResponse = {
  ticker: string;
  current_price: number | null;
  methods: Record<string, number | null>;
  blended_fair_value: number | null;
  upside_pct: number | null;
};

export type DcfResponse = {
  enterprise_value: number;
  equity_value: number;
  per_share_value: number | null;
  terminal_value: number;
  projection: Array<Record<string, number>>;
};

export type FundamentalScoresResponse = {
  ticker: string;
  piotroski_f_score: number;
  altman_z_score: number;
  graham_number: number;
  peg_ratio: number;
  magic_formula_rank: number;
  dupont_analysis: {
    profit_margin: number;
    asset_turnover: number;
    equity_multiplier: number;
    roe: number;
  };
  cash_conversion_cycle: number;
  fcf_yield_pct: number;
  cagr: {
    revenue_3y_pct: number;
    profit_3y_pct: number;
  };
  dvm_score: {
    durability: number;
    valuation: number;
    momentum: number;
    overall: number;
    band: string;
  };
  inputs?: {
    pe?: number;
    earnings_growth_pct?: number;
    earnings_yield?: number;
    roic?: number;
  };
};

export type PortfolioItem = {
  id: number;
  ticker: string;
  quantity: number;
  avg_buy_price: number;
  buy_date: string;
  current_price: number | null;
  current_value: number | null;
  pnl: number | null;
};

export type PortfolioResponse = {
  items: PortfolioItem[];
  summary: {
    total_cost: number;
    total_value: number | null;
    overall_pnl: number | null;
  };
};

export type WatchlistItem = {
  id: number;
  watchlist_name: string;
  ticker: string;
};

export type AlertRule = {
  id: number;
  ticker: string;
  alert_type: string;
  condition: string;
  threshold: number;
  note: string;
  created_at: string;
};

export type BulkDeal = {
  symbol: string;
  clientName: string;
  buySell: "BUY" | "SELL";
  quantity: number | string;
  tradePrice: number | string;
  remarks?: string;
};

export type MarketEvent = {
  date: string;
  ticker: string;
  event: string;
};

export type MarketStatus = {
  market: string;
  marketStatus: string;
  tradeDate: string;
  index: string;
  last: number;
  variation: number;
  percentChange: number;
};
