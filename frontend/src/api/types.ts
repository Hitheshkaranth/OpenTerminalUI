import type {
  ChartResponse,
  StockSnapshot,
  AlertRule,
  AlertCondition,
  AlertTriggerEvent,
  AlertDeliveryOptions,
  ScreenerResponse,
  ScreenerRule,
  ScreenerFactorConfig,
  ScreenerV2Response,
  ScannerPreset,
  ScannerPresetPayload,
  ScannerResult,
  ScannerRun,
  ScreenerPresetV3,
  ScreenerRunRequestV3,
  ScreenerRunResponseV3,
  UserScreenV3,
  CustomFormulaRunRequest,
  CustomFormulaResponse,
  SavedFormula,
  KillSwitch,
  DataVersion,
  PortfolioResponse,
  SectorAllocationResponse,
  PortfolioRiskMetrics,
  PortfolioCorrelationResponse,
  PortfolioDividendTracker,
  PortfolioBenchmarkOverlay,
  TaxLotSummary,
  TaxLotRealizationResponse,
  PortfolioMutualFundsResponse,
  PaperPortfolio,
  PaperOrder,
  PaperTrade,
  PaperPosition,
  PaperPerformance,
  MutualFund,
  MutualFundCompareResponse,
  MutualFundDetailsResponse,
  MutualFundNavHistoryResponse,
  MutualFundPerformance,
  MutualFundRanking,
  RollingReturnsResponse,
  SipCalcResponse,
  FundOverlapResponse,
  BondScreenerItem,
  CreditSpreadPoint,
  RatingsMigrationItem,
  YieldCurveResponse,
  SpreadHistoryResponse,
  EconomicEvent,
  MacroIndicatorsResponse,
  AIQueryResult,
  Watchlist,
  WatchlistItem,
  JournalEntry,
  JournalStats,
  JournalEquityPoint,
  JournalCalendarDay,
  InsiderTrade,
  InsiderStockResponse,
  InsiderTopActivityRow,
  InsiderClusterRow,
  PluginManifestItem,
  ScheduledReport,
  FinancialsResponse,
  PeerResponse,
  DcfResponse,
  RelativeValuationResponse,
  FundamentalScoresResponse,
  PitFundamentalsResponse,
  UniverseMembersResponse,
  ShareholdingPatternResponse,
  EquityPerformanceSnapshot,
  PromoterHoldingsResponse,
  DeliverySeriesResponse,
  CapexTrackerResponse,
  TopBarTickersResponse,
  CorporateEvent,
  EarningsDate,
  QuarterlyFinancial,
  EarningsAnalysis,
  RiskPortfolioResponse,
  OmsOrder,
  AuditEvent,
  PythonExecuteResponse,
  CorrelationMatrixResponse,
  CorrelationRollingResponse,
  CorrelationClustersResponse,
} from "../types";

export type {
  ChartResponse,
  StockSnapshot,
  AlertRule,
  AlertCondition,
  AlertTriggerEvent,
  AlertDeliveryOptions,
  ScreenerResponse,
  ScreenerRule,
  ScreenerFactorConfig,
  ScreenerV2Response,
  ScannerPreset,
  ScannerPresetPayload,
  ScannerResult,
  ScannerRun,
  ScreenerPresetV3,
  ScreenerRunRequestV3,
  ScreenerRunResponseV3,
  UserScreenV3,
  CustomFormulaRunRequest,
  CustomFormulaResponse,
  SavedFormula,
  KillSwitch,
  DataVersion,
  PortfolioResponse,
  SectorAllocationResponse,
  PortfolioRiskMetrics,
  PortfolioCorrelationResponse,
  PortfolioDividendTracker,
  PortfolioBenchmarkOverlay,
  TaxLotSummary,
  TaxLotRealizationResponse,
  PortfolioMutualFundsResponse,
  PaperPortfolio,
  PaperOrder,
  PaperTrade,
  PaperPosition,
  PaperPerformance,
  MutualFund,
  MutualFundCompareResponse,
  MutualFundDetailsResponse,
  MutualFundNavHistoryResponse,
  MutualFundPerformance,
  MutualFundRanking,
  RollingReturnsResponse,
  SipCalcResponse,
  FundOverlapResponse,
  BondScreenerItem,
  CreditSpreadPoint,
  RatingsMigrationItem,
  YieldCurveResponse,
  SpreadHistoryResponse,
  EconomicEvent,
  MacroIndicatorsResponse,
  AIQueryResult,
  Watchlist,
  WatchlistItem,
  JournalEntry,
  JournalStats,
  JournalEquityPoint,
  JournalCalendarDay,
  InsiderTrade,
  InsiderStockResponse,
  InsiderTopActivityRow,
  InsiderClusterRow,
  PluginManifestItem,
  ScheduledReport,
  FinancialsResponse,
  PeerResponse,
  DcfResponse,
  RelativeValuationResponse,
  FundamentalScoresResponse,
  PitFundamentalsResponse,
  UniverseMembersResponse,
  ShareholdingPatternResponse,
  EquityPerformanceSnapshot,
  PromoterHoldingsResponse,
  DeliverySeriesResponse,
  CapexTrackerResponse,
  TopBarTickersResponse,
  CorporateEvent,
  EarningsDate,
  QuarterlyFinancial,
  EarningsAnalysis,
  RiskPortfolioResponse,
  OmsOrder,
  AuditEvent,
  PythonExecuteResponse,
  CorrelationMatrixResponse,
  CorrelationRollingResponse,
  CorrelationClustersResponse,
};

export type SecurityHubOwnershipResponse = {
  ticker: string;
  shareholding?: Record<string, unknown>;
  institutional_holders?: Array<Record<string, unknown>>;
  insider_transactions?: Array<Record<string, unknown>>;
  source?: Record<string, unknown>;
};

export type SecurityHubEstimatesResponse = {
  ticker: string;
  analyst_estimates?: Array<Record<string, unknown>>;
  recommendation_trends?: Array<Record<string, unknown>>;
  price_target?: Record<string, unknown>;
  consensus?: unknown;
};

export type SecurityHubEsgResponse = {
  ticker: string;
  latest?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
  source?: string;
};

export type MultiPortfolio = {
  id: string;
  name: string;
  description?: string;
  benchmark_symbol?: string | null;
  currency?: string;
  total_value?: number;
  created_at?: string;
};

export type MultiPortfolioHolding = {
  id: string;
  symbol: string;
  shares: number;
  cost_basis_per_share: number;
  purchase_date: string;
  notes?: string;
  lot_id?: string;
  current_price?: number;
};

export type MultiPortfolioAnalytics = {
  portfolio_id: string;
  total_value: number;
  total_cost: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  realized_pnl: number;
  day_change: number;
  day_change_pct: number;
  allocation_by_sector: Array<{ name: string; value: number }>;
  allocation_by_market: Array<{ name: string; value: number }>;
  top_gainers: Array<Record<string, unknown>>;
  top_losers: Array<Record<string, unknown>>;
  dividend_income_ytd: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
};

export type ScreenerScanFilter = { field: string; op: string; value: unknown };
export type ScreenerScanRequest = {
  markets: string[];
  filters: ScreenerScanFilter[];
  sort: { field: string; order: "asc" | "desc" };
  limit: number;
  formula?: string;
};
export type ScreenerScanResponse = {
  count: number;
  rows: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
};

export type OpsDataQualitySymbolRow = {
  symbol: string;
  last_tick_time: string | null;
  ticks_per_minute: number;
  tick_rate_history?: number[];
  bars_received_today: number;
  bars_expected_today: number;
  average_latency_ms: number;
  provider_source: string;
  health_status: "healthy" | "degraded" | "stale" | "disconnected" | string;
};

export type OpsDataQualityReport = {
  timestamp: string;
  symbols: OpsDataQualitySymbolRow[];
  provider_health?: Record<string, Record<string, unknown>>;
  gaps?: Array<Record<string, unknown>>;
  us_stream?: Record<string, unknown>;
};

export type SearchSymbolItem = {
  ticker: string;
  name: string;
  exchange?: string;
  country_code?: string;
  flag_emoji?: string;
};

export type ChartDrawingRecord = {
  id: string;
  symbol: string;
  tool_type: string;
  coordinates: Record<string, unknown>;
  style: Record<string, unknown>;
  created_at?: string;
};

export type VolumeProfileBin = {
  price_low: number;
  price_high: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
};

export type VolumeProfileResponse = {
  symbol: string;
  period: string;
  mode?: "fixed" | "session" | "visible";
  lookback_bars?: number | null;
  bins: VolumeProfileBin[];
  poc_price: number | null;
  value_area_high: number | null;
  value_area_low: number | null;
};

export interface TapeTrade {
  timestamp: string;
  price: number;
  quantity: number;
  value: number;
  side: "buy" | "sell" | "neutral";
}

export interface TapeRecentResponse {
  trades: TapeTrade[];
}

export interface TapeSummaryResponse {
  total_volume: number;
  buy_volume: number;
  sell_volume: number;
  buy_pct: number;
  large_trade_count: number;
  avg_trade_size: number;
  trades_per_min: number;
}

export type ChartBatchSource = "batch" | "fallback";

export type DepthLevel = {
  price: number;
  quantity: number;
  size: number;
  orders: number;
  cumulative_qty: number;
};

export type DepthSnapshotResponse = {
  symbol: string;
  market: string;
  provider_key: string;
  as_of: string;
  mid_price: number;
  spread: number;
  spread_pct: number;
  tick_size: number;
  levels: number;
  total_bid_quantity: number;
  total_ask_quantity: number;
  total_bid_qty: number;
  total_ask_qty: number;
  last_price: number;
  last_qty: number;
  imbalance: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
};

export interface Notification {
  id: number;
  type: "alert" | "news" | "system" | "trade";
  priority: "low" | "medium" | "high" | "critical";
  title: string;
  body?: string;
  ticker?: string;
  action_url?: string;
  read: boolean;
  created_at: string;
}

export type CryptoMarketRow = {
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  market_cap: number;
  volume_24h: number;
  rank?: number;
  sector?: string;
};

export type CryptoMarketsQuery = {
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  q?: string;
  sector?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type CryptoMoverRow = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_24h: number;
  metric_value: number;
  volume_24h: number;
  market_cap: number;
};

export type CryptoDominanceResponse = {
  btc: number;
  eth: number;
  others: number;
  total_market_cap: number;
  market_cap_change_24h: number;
  btc_pct: number;
  eth_pct: number;
  others_pct: number;
};

export type CryptoIndexResponse = {
  name: string;
  value: number;
  change_24h: number;
  constituents: Array<{ symbol: string; weight: number }>;
  index_value: number;
  index_name?: string;
  component_count?: number;
  total_market_cap: number;
  top_n?: number;
};

export type CryptoSectorRow = {
  name: string;
  market_cap: number;
  change_24h: number;
  top_gainers: string[];
  sector: string;
  components?: Array<{ symbol: string; name: string; price: number; change_24h: number }>;
};

export type CryptoCoinDetail = {
  symbol: string;
  name: string;
  description: string;
  links: Record<string, string>;
  market_data: Record<string, unknown>;
  sentiment: Record<string, number>;
  price: number;
  change_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  market_cap: number;
  sparkline: number[];
};

export type NewsApiItem = {
  id: string;
  title: string;
  url: string;
  published_at: string;
  publishedAt?: string;
  source: string;
  summary?: string;
  sentiment?: number | { label: string; score: number; confidence: number };
  ticker?: string;
};

export type NewsLatestApiItem = {
  id: string;
  title: string;
  url: string;
  published_at: string;
  source: string;
  summary?: string;
  tickers?: string[];
  sentiment_score?: number;
  sentiment_label?: string;
  sentiment?: { label: string; score: number; confidence: number };
};

export type NewsSentimentSummary = {
  ticker: string;
  score: number;
  label: "positive" | "negative" | "neutral";
  count: number;
  period_days: number;
  overall_label?: string;
  average_score: number;
  total_articles?: number;
  bullish_pct?: number;
  bearish_pct?: number;
  neutral_pct?: number;
  daily_sentiment?: Record<string, unknown>[];
};

export type MarketSentimentSummary = {
  overall_score: number;
  label: string;
  sectors: Array<{ sector: string; score: number; avg_sentiment: number }>;
  top_sources: Array<{ source: string; score: number }>;
};

export type NewsSentimentMarketSummary = {
  global_score: number;
  trending_tickers: Array<{ ticker: string; score: number }>;
  top_sources: Array<{ source: string; count: number }>;
  overall_label?: string;
  average_score?: number;
  distribution?: {
    bullish_pct: number;
    neutral_pct: number;
    bearish_pct: number;
  };
};

export type StockEmotionArticle = {
  title: string;
  url: string;
  sentiment: number;
  emotion_label: string;
  sentiment_label: string;
  sentiment_score: number;
  emotion_intensity: number;
  emotion: string;
  rationale?: string;
};

export type StockEmotion = {
  ticker: string;
  average_score: number;
  dominant_emotion: string;
  articles?: StockEmotionArticle[];
  emotion_distribution?: Array<{ label: string; count: number; emotion: string; share: number }>;
  engine?: string;
  model?: string;
  articles_analyzed?: number;
  period_days?: number;
  emotion_index?: number;
  emotion_index_label?: string;
  sentiment_label?: string;
  sentiment_score?: number;
  confidence?: number;
  narrative?: string;
};

export type AiInsightSection = {
  title: string;
  content: string;
  bullet_points?: string[];
  tone?: "positive" | "negative" | "neutral";
  points?: string[];
};

export type AiInsight = {
  ticker: string;
  summary: string;
  sections: AiInsightSection[];
  sentiment_score: number;
  recommendation?: string;
  engine: string;
  model: string;
  generated_at?: string;
};

export type QuarterlyReportApiItem = {
  id: string;
  symbol: string;
  market: string;
  periodEndDate: string;
  publishedAt: string;
  reportType: string;
  title: string;
  links: Array<{ label: string; url: string }>;
  source: string;
};

export type FuturesChainContract = {
  expiry_date: string;
  tradingsymbol: string;
  exchange: string;
  ws_symbol: string;
  instrument_token: number;
  lot_size: number;
  tick_size: number;
  ltp?: number | null;
  change?: number | null;
  change_pct?: number | null;
  oi?: number | null;
  volume?: number | null;
};

export type BacktestPayload = {
  tickers: string[];
  start?: string;
  end?: string;
  lookback_days?: number;
  rebalance_freq?: string;
  top_n?: number;
  transaction_cost_bps?: number;
  benchmark?: string;
};

export type BacktestResponse = {
  summary: {
    strategy: Record<string, number>;
    benchmark: Record<string, number>;
    metrics: Record<string, number>;
    alpha_total_return?: number;
  };
  returns: Array<{ date: string; strategy: number; benchmark: number }>;
  weights: Array<{ date: string; weights: Record<string, number> }>;
  equity_curve: Array<{ date: string; value: number }>;
  holdings: Array<{
    symbol: string;
    quantity: number;
    weight: number;
    rebalance_date?: string;
    holdings?: string;
    turnover?: number;
    cost_applied?: number;
  }>;
};

export type BacktestJobSubmitPayload = {
  strategy_name?: string;
  symbols?: string[];
  params?: Record<string, unknown>;
  start_date?: string;
  end_date?: string;
  symbol?: string;
  asset?: string;
  market?: string;
  start?: string;
  end?: string;
  timeframe?: string;
  strategy?: string;
  context?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type BacktestJobStatus = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | "done";
  progress: number;
  error?: string;
  result_id?: string;
  run_id?: string;
};

export type BacktestJobResult = {
  job_id: string;
  summary: Record<string, number>;
  charts: Record<string, unknown>;
  trades: Array<Record<string, unknown>>;
  result?: {
    equity_curve?: Array<{
      date: string;
      equity: number;
      cash?: number;
      open?: number;
      high?: number;
      low?: number;
      close?: number;
      position?: number;
    }>;
    trades?: Array<{
      date: string;
      price: number;
      action: string;
      quantity: number;
    }>;
    asset?: string;
    initial_cash?: number;
    final_equity?: number;
    pnl_amount?: number;
    ending_cash?: number;
    total_return: number;
    sharpe: number;
    max_drawdown: number;
    max_intraday_drawdown?: number;
    average_hold_time_minutes?: number;
    trades_per_day?: number;
    win_rate_morning?: number;
    win_rate_afternoon?: number;
  };
  logs?: string;
  status: string;
  error?: string;
};

export type SectorRotationData = {
  benchmark: string;
  timestamp: string;
  sectors: Array<{
    symbol: string;
    current: { date: string; x: number; y: number };
    trail: Array<{ date: string; x: number; y: number }>;
  }>;
};

export type ChartComparisonResponse = {
  dates: string[];
  series: Record<string, number[]>;
};

export type JournalEntryPayload = {
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_date: string;
  entry_price: number;
  exit_date?: string | null;
  exit_price?: number | null;
  quantity: number;
  fees?: number;
  strategy?: string | null;
  setup?: string | null;
  emotion?: string | null;
  notes?: string | null;
  tags?: string[];
  rating?: number | null;
};

export type JournalEntryUpdatePayload = Partial<JournalEntryPayload> & {
  clear_exit?: boolean;
};

export type JournalListFilters = {
  symbol?: string;
  strategy?: string;
  emotion?: string;
  start?: string;
  end?: string;
  tags?: string[];
};

export type HeatmapGroupBy = "sector" | "industry";
export type HeatmapPeriod = "1d" | "1w" | "1m" | "3m" | "ytd" | "1y";
export type HeatmapSizeBy = "market_cap" | "volume" | "turnover";
export type HeatmapMarket = "IN" | "US";

export type HeatmapLeaf = {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  market_cap: number;
  price: number;
  change_pct: number;
  volume: number;
  turnover: number;
  value: number;
};

export type HeatmapGroup = {
  name: string;
  group_by: HeatmapGroupBy;
  size_metric: HeatmapSizeBy;
  value: number;
  children: HeatmapLeaf[];
};

export type HeatmapTreemapResponse = {
  market: HeatmapMarket;
  group: HeatmapGroupBy;
  period: HeatmapPeriod;
  size_by: HeatmapSizeBy;
  total_value: number;
  data: HeatmapLeaf[];
  groups: HeatmapGroup[];
};

export type ExperimentCreate = {
  name: string;
  description?: string;
  tags?: string[];
  model_key: string;
  params_json?: Record<string, unknown>;
  universe_json?: Record<string, unknown>;
  benchmark_symbol?: string;
  start_date: string;
  end_date: string;
  cost_model_json?: Record<string, unknown>;
};

export type ExperimentSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  model_key: string;
  benchmark_symbol?: string | null;
  start_date: string;
  end_date: string;
  created_at: string;
};

export type ExperimentDetail = ExperimentSummary & {
  params_json: Record<string, unknown>;
  universe_json: Record<string, unknown>;
  cost_model_json: Record<string, unknown>;
  runs: Array<{
    id: string;
    status: "queued" | "running" | "succeeded" | "failed";
    started_at: string;
    finished_at?: string | null;
    error?: string | null;
  }>;
};

export type ModelRunStatus = {
  run_id: string;
  experiment_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
};

export type ModelRunReport = {
  run_id: string;
  experiment_id?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  metrics: Record<string, number>;
  series: {
    equity_curve: Array<{ date: string; value: number }>;
    benchmark_curve: Array<{ date: string; value: number }>;
    drawdown: Array<{ date: string; value: number }>;
    underwater: Array<{ date: string; value: number }>;
    rolling_sharpe_30: number[];
    rolling_sharpe_90: number[];
    monthly_returns: Array<{ year: number; month: number; return_pct: number }>;
    returns_histogram: { bins: number[]; counts: number[] };
    trades?: Array<{ date: string; action: string; quantity: number; price: number }>;
  };
  error?: string | null;
};

export type ModelCompareResponse = {
  runs: ModelRunReport[];
  summary: Array<{
    run_id: string;
    status: string;
    total_return: number;
    sharpe: number;
    sortino: number;
    max_drawdown: number;
    calmar: number;
    vol_annual: number;
    turnover: number;
    pareto: boolean;
  }>;
};

export type WeightingMethod = "EQUAL" | "VOL_TARGET" | "RISK_PARITY";
export type RebalanceFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export type PortfolioDefinition = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  benchmark_symbol?: string | null;
  start_date: string;
  end_date: string;
  rebalance_frequency: RebalanceFrequency;
  weighting_method: WeightingMethod;
  created_at: string;
};

export type StrategyBlend = {
  id: string;
  name: string;
  strategies_json: Array<{ model_key: string; params_json?: Record<string, unknown>; weight: number }>;
  blend_method: "WEIGHTED_SUM_RETURNS" | "WEIGHTED_SUM_SIGNALS";
  created_at?: string;
};

export type PortfolioRunStatus = {
  run_id: string;
  portfolio_id: string;
  blend_id?: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  started_at?: string;
  finished_at?: string | null;
  error?: string | null;
};

export type PortfolioReport = {
  run_id: string;
  portfolio_id: string;
  blend_id?: string | null;
  status: string;
  metrics: Record<string, number>;
  series: {
    portfolio_equity: Array<{ date: string; value: number }>;
    benchmark_equity: Array<{ date: string; value: number }>;
    drawdown: Array<{ date: string; value: number }>;
    underwater: Array<{ date: string; value: number }>;
    exposure: Array<{ date: string; value: number }>;
    leverage: Array<{ date: string; value: number }>;
    returns: Array<{ date: string; return: number }>;
    weights_over_time: Array<{ date: string; weights: Record<string, number> }>;
    turnover_series: Array<{ date: string; turnover: number }>;
    contribution_series: Array<Record<string, number | string>>;
    rolling_sharpe_30: Array<{ date: string; value: number }>;
    rolling_sharpe_90: Array<{ date: string; value: number }>;
    rolling_volatility: Array<{ date: string; value: number }>;
    monthly_returns: Array<{ year: number; month: number; return_pct: number }>;
  };
  tables: {
    top_contributors: Array<{ asset: string; contribution: number }>;
    top_detractors: Array<{ asset: string; contribution: number }>;
    worst_drawdowns: Array<{ date: string; drawdown: number }>;
    rebalance_log: Array<{ date: string; turnover: number }>;
    latest_weights: Array<{ asset: string; weight: number }>;
  };
  matrices: {
    correlation: { labels: string[]; values: number[][]; cluster_order?: number[] };
    labels: string[];
    cluster_order: number[];
  };
};

export type InsightSection = {
  title: string;
  tone: "positive" | "negative" | "neutral";
  points: string[];
};

export type InsightData = {
  engine: string;
  model: string;
  summary: string;
  sections: InsightSection[];
  generated_at?: string;
};
