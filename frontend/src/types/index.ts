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
    pagination?: {
      cursor?: number | null;
      has_more?: boolean;
      limit?: number | null;
      requested_cursor?: number | null;
      returned?: number;
      total?: number;
    };
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
  country_code?: string;
  exchange?: string;
  classification?: {
    exchange?: string;
    country_code?: string;
    flag_emoji?: string;
    currency?: string;
    has_futures?: boolean;
    has_options?: boolean;
  };
  indices?: string[];
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

export type ScreenerFactorConfig = {
  field: string;
  weight: number;
  higher_is_better: boolean;
};

export type ScreenerV2Meta = {
  warnings?: Array<{ code: string; message: string }>;
  factors?: ScreenerFactorConfig[];
  sector_neutral?: boolean;
  heatmap?: Array<{ id: string; data: Array<{ x: string; y: number }> }>;
};

export type ScreenerV2Response = {
  count: number;
  rows: Array<Record<string, string | number | null>>;
  meta?: ScreenerV2Meta;
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
  sector?: string | null;
  current_price: number | null;
  current_value: number | null;
  pnl: number | null;
  exchange?: string | null;
  country_code?: string | null;
  flag_emoji?: string | null;
  has_futures?: boolean;
  has_options?: boolean;
};

export type PortfolioResponse = {
  items: PortfolioItem[];
  summary: {
    total_cost: number;
    total_value: number | null;
    overall_pnl: number | null;
  };
};

export type SectorAllocationResponse = {
  total_value: number;
  sectors: Array<{ sector: string; value: number; weight_pct: number }>;
  industries: Array<{ industry: string; value: number; weight_pct: number }>;
};

export type PortfolioRiskMetrics = {
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown: number;
  beta: number;
  alpha: number;
  information_ratio: number;
};

export type PortfolioCorrelationResponse = {
  symbols: string[];
  matrix: Array<Array<{ x: string; y: string; value: number }>>;
  rolling: Array<{ date: string; pair: string; value: number }>;
};

export type PortfolioDividendTracker = {
  upcoming: Array<{
    symbol: string;
    event_date: string;
    ex_date?: string | null;
    payment_date?: string | null;
    dividend_per_share: number;
    position_qty: number;
    projected_income: number;
    title: string;
  }>;
  annual_income_projection: number;
};

export type PortfolioBenchmarkOverlay = {
  benchmark: string;
  equity_curve: Array<{ date: string; portfolio: number; benchmark: number }>;
  alpha: number;
  tracking_error: number;
};

export type TaxLotRow = {
  id: number;
  ticker: string;
  quantity: number;
  remaining_quantity: number;
  buy_price: number;
  buy_date: string;
  current_price?: number | null;
  unrealized_gain?: number | null;
};

export type TaxLotSummary = {
  lots: TaxLotRow[];
  unrealized_gain_total: number;
};

export type TaxLotRealizationResponse = {
  symbol: string;
  method: string;
  sell_quantity: number;
  sell_price: number;
  sell_date: string;
  realizations: Array<{
    lot_id: number;
    ticker: string;
    quantity: number;
    buy_price: number;
    sell_price: number;
    buy_date: string;
    sell_date: string;
    holding_days: number;
    holding_period: "short_term" | "long_term";
    realized_gain: number;
  }>;
  realized_gain_total: number;
  short_term_gain: number;
  long_term_gain: number;
};

export type PluginManifestItem = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry_point: string;
  required_permissions: string[];
  enabled: boolean;
};

export type ScheduledReport = {
  id: string;
  report_type: string;
  frequency: string;
  email: string;
  data_type: string;
  enabled: boolean;
};

export type WatchlistItem = {
  id: number;
  watchlist_name: string;
  ticker: string;
  exchange?: string | null;
  country_code?: string | null;
  flag_emoji?: string | null;
  has_futures?: boolean;
  has_options?: boolean;
};

export type AlertRule = {
  id: string;
  symbol?: string;
  condition_type?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  triggered_at?: string | null;
  cooldown_seconds?: number;
  ticker: string;
  alert_type: string;
  condition: string;
  threshold: number | null | undefined;
  note: string;
  created_at: string;
};

export type AlertTriggerEvent = {
  id: string;
  alert_id: string;
  symbol: string;
  condition_type: string;
  triggered_value?: number | null;
  triggered_at: string;
};

export type PaperPortfolio = {
  id: string;
  name: string;
  initial_capital: number;
  current_cash: number;
  is_active?: boolean;
  created_at?: string;
};

export type PaperOrder = {
  id: string;
  symbol: string;
  side: string;
  order_type: string;
  quantity: number;
  limit_price?: number | null;
  sl_price?: number | null;
  status: string;
  fill_price?: number | null;
  fill_time?: string | null;
  slippage_bps?: number;
  commission?: number;
};

export type PaperTrade = {
  id: string;
  order_id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  pnl_realized?: number | null;
};

export type PaperPosition = {
  id: string;
  symbol: string;
  quantity: number;
  avg_entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
};

export type PaperPerformance = {
  portfolio_id: string;
  equity: number;
  pnl: number;
  cumulative_return: number;
  daily_pnl_curve: Array<{ t: string; equity: number }>;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  avg_win_loss_ratio: number;
  profit_factor: number;
  trade_count: number;
};

export type PriceRange = {
  low?: number | null;
  high?: number | null;
};

export type EquityPerformanceSnapshot = {
  symbol: string;
  period_changes_pct: {
    "1D"?: number | null;
    "1W"?: number | null;
    "1M"?: number | null;
    "3M"?: number | null;
    "6M"?: number | null;
    "1Y"?: number | null;
  };
  max_up_move_pct?: number | null;
  max_down_move_pct?: number | null;
  day_range: PriceRange;
  range_52w: PriceRange;
};

export type PromoterHoldingPoint = {
  date: string;
  promoter: number;
  fii: number;
  dii: number;
  public: number;
};

export type PromoterHoldingsResponse = {
  symbol: string;
  history: PromoterHoldingPoint[];
  warning?: string | null;
};

export type ShareholdingCategory = {
  category: string;
  percentage: number;
  shares?: number | null;
  quarter: string;
};

export type ShareholdingTrendPoint = {
  quarter: string;
  promoter: number;
  fii: number;
  dii: number;
  public: number;
  government?: number;
};

export type InstitutionalHolder = {
  holder: string;
  shares: number;
  change: number;
  date_reported?: string;
};

export type ShareholdingPatternResponse = {
  symbol: string;
  total_shares: number;
  promoter_holding: number;
  fii_holding: number;
  dii_holding: number;
  public_holding: number;
  government_holding: number;
  categories: ShareholdingCategory[];
  quarter: string;
  as_of_date: string;
  historical: ShareholdingTrendPoint[];
  source?: "nse" | "fmp" | string;
  institutional_holders?: InstitutionalHolder[];
  warning?: string | null;
};

export type DeliverySeriesPoint = {
  date: string;
  close: number;
  volume: number;
  delivery_pct: number;
};

export type DeliverySeriesResponse = {
  symbol: string;
  interval: string;
  points: DeliverySeriesPoint[];
};

export type CapexPoint = {
  date: string;
  capex: number;
  source: "reported" | "estimated" | string;
};

export type CapexTrackerResponse = {
  symbol: string;
  points: CapexPoint[];
};

export type TopBarTicker = {
  key: string;
  label: string;
  symbol: string;
  price?: number | null;
  change_pct?: number | null;
};

export type TopBarTickersResponse = {
  items: TopBarTicker[];
};

export type PythonExecuteResponse = {
  stdout: string;
  stderr: string;
  result: unknown;
  timed_out: boolean;
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

export type MutualFund = {
  scheme_code: number;
  scheme_name: string;
  isin_growth?: string | null;
  isin_div_payout?: string | null;
  nav: number;
  nav_date: string;
  fund_house: string;
  scheme_type: string;
  scheme_category: string;
  scheme_sub_category: string;
  returns_1y?: number | null;
};

export type MutualFundNavPoint = {
  date: string;
  nav: number;
};

export type MutualFundNavHistoryResponse = {
  scheme_code: number;
  scheme_name: string;
  nav_history: MutualFundNavPoint[];
};

export type MutualFundPerformance = {
  scheme_code: number;
  scheme_name: string;
  fund_house: string;
  category: string;
  current_nav: number;
  returns_1m?: number | null;
  returns_3m?: number | null;
  returns_6m?: number | null;
  returns_1y?: number | null;
  returns_3y?: number | null;
  returns_5y?: number | null;
  returns_since_inception?: number | null;
  expense_ratio?: number | null;
  aum_cr?: number | null;
  risk_rating?: string | null;
};

export type MutualFundDetailsResponse = {
  fund: MutualFund | null;
  nav_history: MutualFundNavHistoryResponse;
  performance: MutualFundPerformance;
};

export type MutualFundCompareResponse = {
  period: string;
  funds: MutualFundPerformance[];
  normalized: Record<string, Array<{ date: string; value: number }>>;
};

export type PortfolioMutualFund = {
  id: string;
  scheme_code: number;
  scheme_name: string;
  fund_house: string;
  category: string;
  units: number;
  avg_nav: number;
  current_nav: number;
  invested_amount: number;
  current_value: number;
  pnl: number;
  pnl_pct: number;
  xirr?: number | null;
  sip_transactions: Array<Record<string, unknown>>;
  added_at: string;
};

export type PortfolioMutualFundsResponse = {
  items: PortfolioMutualFund[];
  summary: {
    total_invested: number;
    total_current_value: number;
    total_pnl: number;
    total_pnl_pct: number;
  };
};

export type CorporateEventType =
  | "dividend"
  | "bonus"
  | "split"
  | "rights"
  | "agm"
  | "egm"
  | "board_meeting"
  | "buyback"
  | "delisting"
  | "ipo"
  | "merger"
  | "earnings"
  | "insider_trade"
  | "block_deal"
  | "bulk_deal"
  | "credit_rating";

export type CorporateEvent = {
  symbol: string;
  event_type: CorporateEventType;
  title: string;
  description: string;
  event_date: string;
  ex_date?: string | null;
  record_date?: string | null;
  payment_date?: string | null;
  value?: string | null;
  source: string;
  impact: "positive" | "negative" | "neutral" | string;
  url?: string | null;
};

export type EarningsDate = {
  symbol: string;
  company_name: string;
  earnings_date: string;
  fiscal_quarter: string;
  fiscal_year: number;
  quarter: number;
  estimated_eps?: number | null;
  actual_eps?: number | null;
  eps_surprise?: number | null;
  eps_surprise_pct?: number | null;
  estimated_revenue?: number | null;
  actual_revenue?: number | null;
  revenue_surprise?: number | null;
  revenue_surprise_pct?: number | null;
  time: string;
  source: string;
};

export type QuarterlyFinancial = {
  symbol: string;
  quarter: string;
  quarter_end_date: string;
  revenue: number;
  revenue_qoq_pct?: number | null;
  revenue_yoy_pct?: number | null;
  net_profit: number;
  net_profit_qoq_pct?: number | null;
  net_profit_yoy_pct?: number | null;
  operating_profit?: number | null;
  operating_margin_pct?: number | null;
  net_margin_pct?: number | null;
  ebitda?: number | null;
  eps?: number | null;
  eps_qoq_pct?: number | null;
  eps_yoy_pct?: number | null;
};

export type EarningsAnalysis = {
  symbol: string;
  company_name: string;
  next_earnings_date?: EarningsDate | null;
  last_earnings?: EarningsDate | null;
  quarterly_financials: QuarterlyFinancial[];
  revenue_trend: string;
  profit_trend: string;
  consecutive_beats: number;
  avg_eps_surprise_pct: number;
};

export * from "./markets";
export * from "./financialReports";
