import axios from "axios";

import type {
  ChartResponse,
  DcfResponse,
  DeliverySeriesResponse,
  CapexTrackerResponse,
  TopBarTickersResponse,
  PythonExecuteResponse,
  PromoterHoldingsResponse,
  FinancialsResponse,
  FundamentalScoresResponse,
  IndicatorResponse,
  EquityPerformanceSnapshot,
  PortfolioResponse,
  SectorAllocationResponse,
  PortfolioRiskMetrics,
  PortfolioCorrelationResponse,
  PortfolioDividendTracker,
  PortfolioBenchmarkOverlay,
  TaxLotSummary,
  TaxLotRealizationResponse,
  PluginManifestItem,
  ScheduledReport,
  PeerResponse,
  RelativeValuationResponse,
  ScreenerResponse,
  ScreenerRule,
  ShareholdingPatternResponse,
  StockSnapshot,
  WatchlistItem,
  AlertRule,
  AlertTriggerEvent,
  MutualFund,
  MutualFundCompareResponse,
  MutualFundDetailsResponse,
  MutualFundNavHistoryResponse,
  MutualFundPerformance,
  PortfolioMutualFundsResponse,
  CorporateEvent,
  EarningsDate,
  QuarterlyFinancial,
  EarningsAnalysis,
  PaperPortfolio,
  PaperOrder,
  PaperTrade,
  PaperPosition,
  PaperPerformance,
} from "../types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

let accessTokenGetter: (() => string | null) | null = null;

export function setAccessTokenGetter(getter: (() => string | null) | null): void {
  accessTokenGetter = getter;
}

api.interceptors.request.use((config) => {
  const token = accessTokenGetter ? accessTokenGetter() : null;
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function getHistory(
  symbol: string,
  market: string,
  interval = "1d",
  range = "1y",
  limit?: number,
  cursor?: number,
): Promise<ChartResponse> {
  const { data } = await api.get<ChartResponse>(`/chart/${symbol}`, { params: { market, interval, range, limit, cursor } });
  return data;
}

export async function fetchIndicator(
  ticker: string,
  type: string,
  interval = "1d",
  range = "1y",
  params: Record<string, number> = {}
): Promise<IndicatorResponse> {
  const { data } = await api.get<IndicatorResponse>(`/chart/${ticker}/indicators`, {
    params: { type, interval, range, ...params },
  });
  return data;
}

export async function getQuote(symbol: string, market: string): Promise<StockSnapshot> {
  const { data } = await api.get<StockSnapshot>(`/stocks/${symbol}`, { params: { market } });
  return data;
}

export async function getFinancials(symbol: string, market: string, period: "annual" | "quarterly"): Promise<FinancialsResponse> {
  const { data } = await api.get<FinancialsResponse>(`/stocks/${symbol}/financials`, { params: { market, period } });
  return data;
}

export async function fetchPeers(ticker: string): Promise<PeerResponse> {
  const { data } = await api.get<PeerResponse>(`/peers/${ticker}`);
  return data;
}

export async function fetchDcf(ticker: string): Promise<DcfResponse> {
  const { data } = await api.get<DcfResponse>(`/valuation/${ticker}/dcf`, { params: { auto: true } });
  return data;
}

export async function fetchRelativeValuation(ticker: string): Promise<RelativeValuationResponse> {
  const { data } = await api.get<RelativeValuationResponse>(`/valuation/${ticker}/relative`);
  return data;
}

export async function fetchFundamentalScores(ticker: string): Promise<FundamentalScoresResponse> {
  const { data } = await api.get<FundamentalScoresResponse>(`/stocks/${ticker}/scores`);
  return data;
}

export async function runScreener(rules: ScreenerRule[], limit = 50): Promise<ScreenerResponse> {
  const { data } = await api.post<ScreenerResponse>("/screener/run", {
    rules,
    sort_by: "roe_pct",
    sort_order: "desc",
    limit,
    universe: "nse_eq",
  });
  return data;
}

export type SearchSymbolItem = {
  ticker: string;
  name: string;
  exchange?: string;
  country_code?: string;
  flag_emoji?: string;
};

export async function searchSymbols(q: string, market: string): Promise<SearchSymbolItem[]> {
  const { data } = await api.get<{ results: SearchSymbolItem[] }>("/search", { params: { q, market } });
  return data.results;
}

export async function fetchChart(ticker: string, interval = "1d", range = "1y", market = "NSE"): Promise<ChartResponse> {
  return getHistory(ticker, market, interval, range);
}

export async function fetchStock(ticker: string, market = "NSE"): Promise<StockSnapshot> {
  return getQuote(ticker, market);
}

export async function fetchFinancials(ticker: string, period: "annual" | "quarterly", market = "NSE"): Promise<FinancialsResponse> {
  return getFinancials(ticker, market, period);
}

export async function searchStocks(q: string, market = "NSE"): Promise<SearchSymbolItem[]> {
  return searchSymbols(q, market);
}

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const { data } = await api.get<PortfolioResponse>("/portfolio");
  const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
  const summary = (data as any)?.summary && typeof (data as any).summary === "object" ? (data as any).summary : {};
  return {
    items,
    summary: {
      total_cost: Number((summary as any).total_cost ?? 0),
      total_value: typeof (summary as any).total_value === "number" ? (summary as any).total_value : null,
      overall_pnl: typeof (summary as any).overall_pnl === "number" ? (summary as any).overall_pnl : null,
    },
  };
}

export async function fetchSectorAllocation(): Promise<SectorAllocationResponse> {
  const { data } = await api.get<SectorAllocationResponse>("/portfolio/analytics/sector-allocation");
  return data;
}

export async function fetchPortfolioRiskMetrics(params?: { risk_free_rate?: number; benchmark?: string }): Promise<PortfolioRiskMetrics> {
  const { data } = await api.get<PortfolioRiskMetrics>("/portfolio/analytics/risk-metrics", { params });
  return data;
}

export async function fetchPortfolioCorrelation(params?: { window?: number }): Promise<PortfolioCorrelationResponse> {
  const { data } = await api.get<PortfolioCorrelationResponse>("/portfolio/analytics/correlation", { params });
  return data;
}

export async function fetchPortfolioDividends(params?: { days?: number }): Promise<PortfolioDividendTracker> {
  const { data } = await api.get<PortfolioDividendTracker>("/portfolio/analytics/dividends", { params });
  return data;
}

export async function fetchPortfolioBenchmarkOverlay(params?: { benchmark?: string }): Promise<PortfolioBenchmarkOverlay> {
  const { data } = await api.get<PortfolioBenchmarkOverlay>("/portfolio/analytics/benchmark-overlay", { params });
  return data;
}

export async function fetchTaxLots(params?: { ticker?: string }): Promise<TaxLotSummary> {
  const { data } = await api.get<TaxLotSummary>("/portfolio/tax-lots", { params });
  return data;
}

export async function addTaxLot(payload: { ticker: string; quantity: number; buy_price: number; buy_date: string }): Promise<void> {
  await api.post("/portfolio/tax-lots", payload);
}

export async function realizeTaxLots(payload: {
  ticker: string;
  quantity: number;
  sell_price: number;
  sell_date: string;
  method: "FIFO" | "LIFO" | "SPECIFIC";
  specific_lot_ids?: number[];
}): Promise<TaxLotRealizationResponse> {
  const { data } = await api.post<TaxLotRealizationResponse>("/portfolio/tax-lots/realize", payload);
  return data;
}

export async function downloadExport(dataType: string, format: "csv" | "xlsx" | "pdf"): Promise<Blob> {
  const { data } = await api.get(`/export/${encodeURIComponent(dataType)}`, {
    params: { format },
    responseType: "blob",
  });
  return data as Blob;
}

export async function fetchScheduledReports(): Promise<ScheduledReport[]> {
  const { data } = await api.get<{ items: ScheduledReport[] }>("/reports/scheduled");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createScheduledReport(payload: { report_type: string; frequency: string; email: string; data_type: string }): Promise<ScheduledReport> {
  const { data } = await api.post<ScheduledReport>("/reports/scheduled", payload);
  return data;
}

export async function deleteScheduledReport(configId: string): Promise<void> {
  await api.delete(`/reports/scheduled/${encodeURIComponent(configId)}`);
}

export async function fetchPlugins(): Promise<PluginManifestItem[]> {
  const { data } = await api.get<{ items: PluginManifestItem[] }>("/plugins");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  const encoded = encodeURIComponent(pluginId);
  await api.post(`/plugins/${encoded}/${enabled ? "enable" : "disable"}`);
}

export async function reloadPlugin(pluginId: string): Promise<void> {
  const encoded = encodeURIComponent(pluginId);
  await api.post(`/plugins/${encoded}/reload`);
}

export async function addHolding(payload: {
  ticker: string;
  quantity: number;
  avg_buy_price: number;
  buy_date: string;
}): Promise<void> {
  await api.post("/portfolio/holdings", payload);
}

export async function deleteHolding(holdingId: number): Promise<void> {
  await api.delete(`/portfolio/holdings/${holdingId}`);
}

export async function searchMutualFunds(q: string, category?: string): Promise<MutualFund[]> {
  const { data } = await api.get<{ items: MutualFund[] }>("/mutual-funds/search", { params: { q, category } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchMutualFundDetails(schemeCode: number): Promise<MutualFundDetailsResponse> {
  const { data } = await api.get<MutualFundDetailsResponse>(`/mutual-funds/${schemeCode}`);
  return data;
}

export async function fetchMutualFundPerformance(schemeCode: number): Promise<MutualFundPerformance> {
  const { data } = await api.get<MutualFundPerformance>(`/mutual-funds/${schemeCode}/performance`);
  return data;
}

export async function fetchMutualFundNavHistory(schemeCode: number): Promise<MutualFundNavHistoryResponse> {
  const { data } = await api.get<MutualFundNavHistoryResponse>(`/mutual-funds/${schemeCode}/nav-history`);
  return data;
}

export async function compareMutualFunds(codes: number[], period = "1y"): Promise<MutualFundCompareResponse> {
  const { data } = await api.get<MutualFundCompareResponse>("/mutual-funds/compare", {
    params: { codes: codes.join(","), period },
  });
  return data;
}

export async function fetchTopMutualFunds(category: string, sortBy = "returns_1y", limit = 20): Promise<MutualFundPerformance[]> {
  const { data } = await api.get<{ items: MutualFundPerformance[] }>(`/mutual-funds/top/${encodeURIComponent(category)}`, {
    params: { sort_by: sortBy, limit },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function addMutualFundHolding(payload: {
  scheme_code: number;
  scheme_name: string;
  fund_house?: string;
  category?: string;
  units: number;
  avg_nav: number;
  xirr?: number;
  sip_transactions?: Array<Record<string, unknown>>;
}): Promise<void> {
  await api.post("/mutual-funds/portfolio/add", payload);
}

export async function fetchMutualFundPortfolio(): Promise<PortfolioMutualFundsResponse> {
  const { data } = await api.get<PortfolioMutualFundsResponse>("/mutual-funds/portfolio");
  return data;
}

export async function deleteMutualFundHolding(holdingId: string): Promise<void> {
  await api.delete(`/mutual-funds/portfolio/${holdingId}`);
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const { data } = await api.get<{ items: WatchlistItem[] }>("/watchlists");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function addWatchlistItem(payload: { watchlist_name: string; ticker: string }): Promise<void> {
  await api.post("/watchlists/items", payload);
}

export async function deleteWatchlistItem(itemId: number): Promise<void> {
  await api.delete(`/watchlists/items/${itemId}`);
}

export async function fetchAlerts(): Promise<AlertRule[]> {
  const { data } = await api.get<{ alerts: AlertRule[] }>("/alerts");
  return data.alerts;
}

export async function createAlert(payload: {
  symbol?: string;
  condition_type?: string;
  parameters?: Record<string, unknown>;
  cooldown_seconds?: number;
  ticker?: string;
  alert_type?: string;
  condition?: string;
  threshold?: number;
  note?: string;
}): Promise<void> {
  await api.post("/alerts", payload);
}

export async function updateAlert(alertId: string, payload: { status?: string; cooldown_seconds?: number; parameters?: Record<string, unknown> }): Promise<void> {
  await api.patch(`/alerts/${alertId}`, payload);
}

export async function fetchAlertHistory(page = 1, pageSize = 25): Promise<{ page: number; page_size: number; total: number; history: AlertTriggerEvent[] }> {
  const { data } = await api.get<{ page: number; page_size: number; total: number; history: AlertTriggerEvent[] }>("/alerts/history", {
    params: { page, page_size: pageSize },
  });
  return data;
}

export async function deleteAlert(alertId: string): Promise<void> {
  await api.delete(`/alerts/${alertId}`);
}

export async function fetchShareholding(ticker: string): Promise<{ history?: Array<Record<string, unknown>>; warning?: string }> {
  const { data } = await api.get<{ history?: Array<Record<string, unknown>>; warning?: string }>(`/stocks/${ticker}/shareholding`);
  return data;
}

export async function fetchCorporateActions(ticker: string): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>(`/stocks/${ticker}/corporate-actions`);
  return data;
}

export async function fetchAnalystConsensus(ticker: string): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>(`/stocks/${ticker}/analyst-consensus`);
  return data;
}

export async function fetchBulkDeals(): Promise<{ data?: Array<Record<string, unknown>>; error?: string }> {
  const { data } = await api.get<{ data?: Array<Record<string, unknown>>; error?: string }>("/reports/bulk-deals");
  return data;
}

export async function fetchEvents(): Promise<Array<{ date: string; ticker: string; event: string }>> {
  const { data } = await api.get<Array<{ date: string; ticker: string; event: string }>>("/reports/events");
  return data;
}

export async function fetchStockEvents(
  symbol: string,
  params?: { types?: string; from_date?: string; to_date?: string },
): Promise<CorporateEvent[]> {
  const { data } = await api.get<{ items: CorporateEvent[] }>(`/events/${encodeURIComponent(symbol)}`, { params });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchUpcomingEvents(symbol: string, days = 90): Promise<CorporateEvent[]> {
  const { data } = await api.get<{ items: CorporateEvent[] }>(`/events/${encodeURIComponent(symbol)}/upcoming`, { params: { days } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchDividendHistory(symbol: string): Promise<CorporateEvent[]> {
  const { data } = await api.get<{ items: CorporateEvent[] }>(`/events/${encodeURIComponent(symbol)}/dividends`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPortfolioEvents(symbols: string[], days = 30): Promise<CorporateEvent[]> {
  if (!symbols.length) return [];
  const { data } = await api.get<{ items: CorporateEvent[] }>("/events/portfolio/upcoming", {
    params: { symbols: symbols.join(","), days },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchMarketStatus(): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>("/reports/market-status");
  return data;
}

export async function fetchStockReturns(ticker: string): Promise<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }> {
  const { data } = await api.get<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }>(`/stocks/${ticker}/returns`);
  return data ?? {};
}

export async function fetchEarningsCalendar(
  params?: { from_date?: string; to_date?: string; symbols?: string[] },
): Promise<EarningsDate[]> {
  const query = {
    from_date: params?.from_date,
    to_date: params?.to_date,
    symbols: params?.symbols?.length ? params.symbols.join(",") : undefined,
  };
  const { data } = await api.get<{ items: EarningsDate[] }>("/earnings/calendar", { params: query });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchNextEarnings(symbol: string): Promise<EarningsDate | null> {
  const { data } = await api.get<{ item: EarningsDate | null }>(`/earnings/${encodeURIComponent(symbol)}/next`);
  return data?.item ?? null;
}

export async function fetchQuarterlyEarningsFinancials(symbol: string, quarters = 12): Promise<QuarterlyFinancial[]> {
  const { data } = await api.get<{ items: QuarterlyFinancial[] }>(`/earnings/${encodeURIComponent(symbol)}/financials`, { params: { quarters } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchEarningsAnalysis(symbol: string): Promise<EarningsAnalysis> {
  const { data } = await api.get<EarningsAnalysis>(`/earnings/${encodeURIComponent(symbol)}/analysis`);
  return data;
}

export async function fetchPortfolioEarnings(symbols: string[], days = 30): Promise<EarningsDate[]> {
  if (!symbols.length) return [];
  const { data } = await api.get<{ items: EarningsDate[] }>("/earnings/portfolio", {
    params: { symbols: symbols.join(","), days },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchEquityPerformance(symbol: string): Promise<EquityPerformanceSnapshot> {
  const { data } = await api.get<EquityPerformanceSnapshot>(`/v1/equity/company/${encodeURIComponent(symbol)}/performance`);
  return data;
}

export async function fetchPromoterHoldings(symbol: string): Promise<PromoterHoldingsResponse> {
  const { data } = await api.get<PromoterHoldingsResponse>(`/v1/equity/company/${encodeURIComponent(symbol)}/promoter-holdings`);
  return data;
}

export async function fetchShareholdingPattern(symbol: string): Promise<ShareholdingPatternResponse> {
  const { data } = await api.get<ShareholdingPatternResponse>(`/shareholding/${encodeURIComponent(symbol)}`);
  return data;
}

export async function fetchDeliverySeries(symbol: string, interval = "1d", range = "1y"): Promise<DeliverySeriesResponse> {
  const { data } = await api.get<DeliverySeriesResponse>(`/v1/equity/company/${encodeURIComponent(symbol)}/delivery-series`, {
    params: { interval, range },
  });
  return data;
}

export async function fetchCapexTracker(symbol: string): Promise<CapexTrackerResponse> {
  const { data } = await api.get<CapexTrackerResponse>(`/v1/equity/company/${encodeURIComponent(symbol)}/capex-tracker`);
  return data;
}

export async function fetchTopBarTickers(): Promise<TopBarTickersResponse> {
  const { data } = await api.get<TopBarTickersResponse>("/v1/equity/overview/top-tickers");
  return data;
}

export async function fetchCryptoSearch(q: string): Promise<Array<{ ticker: string; name: string }>> {
  const { data } = await api.get<{ items: Array<{ symbol: string; name: string }> }>("/v1/crypto/search", { params: { q } });
  return (data.items || []).map((row) => ({ ticker: row.symbol, name: row.name }));
}

export async function fetchCryptoCandles(symbol: string, interval = "1d", range = "1y"): Promise<ChartResponse> {
  const { data } = await api.get<ChartResponse>("/v1/crypto/candles", { params: { symbol, interval, range } });
  return data;
}

export async function executePython(payload: { code: string; timeout_seconds?: number }): Promise<PythonExecuteResponse> {
  const { data } = await api.post<PythonExecuteResponse>("/v1/scripting/python/execute", payload);
  return data;
}

export type NewsApiItem = {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  summary?: string;
};

export type NewsLatestApiItem = {
  id: string | number;
  title: string;
  source: string;
  url: string;
  summary?: string;
  image_url?: string;
  published_at?: string;
  sentiment?: {
    score: number;
    label: "Bullish" | "Bearish" | "Neutral" | string;
    confidence: number;
  };
};

export type NewsSentimentSummary = {
  ticker: string;
  period_days: number;
  total_articles: number;
  average_score: number;
  bullish_pct: number;
  bearish_pct: number;
  neutral_pct: number;
  overall_label: "Bullish" | "Bearish" | "Neutral" | string;
  daily_sentiment: Array<{ date: string; avg_score: number; count: number }>;
};

export async function fetchSymbolNews(market: string, symbol: string, limit = 30): Promise<NewsApiItem[]> {
  const { data } = await api.get<{ items: NewsApiItem[] }>("/news/symbol", { params: { market, symbol, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchMarketNews(market: string, limit = 30): Promise<NewsApiItem[]> {
  const { data } = await api.get<{ items: NewsApiItem[] }>("/news/market", { params: { market, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchLatestNews(limit = 100): Promise<NewsLatestApiItem[]> {
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>("/news/latest", { params: { limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function searchLatestNews(q: string, limit = 100): Promise<NewsLatestApiItem[]> {
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>("/news/search", { params: { q, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchNewsByTicker(ticker: string, limit = 100): Promise<NewsLatestApiItem[]> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return [];
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>(`/news/by-ticker/${encodeURIComponent(symbol)}`, { params: { limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchNewsSentiment(ticker: string, days = 7): Promise<NewsSentimentSummary> {
  const symbol = ticker.trim().toUpperCase();
  const { data } = await api.get<NewsSentimentSummary>(`/news/sentiment/${encodeURIComponent(symbol)}`, { params: { days } });
  return data;
}

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

export async function fetchQuarterlyReports(market: string, symbol: string, limit = 8): Promise<QuarterlyReportApiItem[]> {
  const { data } = await api.get<{ items: QuarterlyReportApiItem[] }>("/reports/quarterly", {
    params: { market, symbol, limit },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchQuotesBatch(
  symbols: string[],
  market: string,
): Promise<{ market: string; status?: string; quotes: Array<{ symbol: string; last: number; change: number; changePct: number; ts: string }> }> {
  if (!symbols.length) return { market, quotes: [] };
  const tickers = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",");
  if (!tickers) return { market, quotes: [] };
  const { data } = await api.get<{ market: string; status?: string; quotes: Array<{ symbol: string; last: number; change: number; changePct: number; ts: string }> }>("/quotes", {
    params: { symbols: tickers, market },
  });
  return data;
}

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

export async function fetchFuturesUnderlyings(q: string, limit = 25): Promise<string[]> {
  const { data } = await api.get<{ count: number; items: string[] }>("/futures/underlyings", { params: { q, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchFuturesChain(underlying: string): Promise<{
  underlying: string;
  count: number;
  ws_symbols: string[];
  token_to_ws_symbol: Record<string, string>;
  contracts: FuturesChainContract[];
}> {
  const { data } = await api.get<{
    underlying: string;
    count: number;
    ws_symbols: string[];
    token_to_ws_symbol: Record<string, string>;
    contracts: FuturesChainContract[];
  }>(`/futures/chain/${encodeURIComponent(underlying)}`);
  return data;
}

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
    alpha_total_return: number;
  };
  equity_curve: Array<{ date: string; strategy: number; benchmark: number }>;
  holdings: Array<{ rebalance_date: string; holdings: string; turnover: number; cost_applied: number }>;
};

export async function runBacktest(payload: BacktestPayload): Promise<BacktestResponse> {
  const { data } = await api.post<BacktestResponse>("/backtest/run", payload, { timeout: 120000 });
  return data;
}

export type BacktestJobSubmitPayload = {
  symbol: string;
  asset?: string;
  market: string;
  start?: string;
  end?: string;
  limit?: number;
  strategy: string;
  context?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type BacktestJobStatus = {
  run_id: string;
  status: "queued" | "running" | "done" | "failed" | "not_found";
};

export type BacktestJobResult = {
  run_id: string;
  status: "queued" | "running" | "done" | "failed";
  result?: {
    symbol: string;
    asset: string;
    bars: number;
    initial_cash: number;
    final_equity: number;
    pnl_amount: number;
    ending_cash: number;
    total_return: number;
    max_drawdown: number;
    sharpe: number;
    trades: Array<{ date: string; action: string; quantity: number; price: number }>;
    equity_curve: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      equity: number;
      signal: number;
      cash: number;
      position: number;
    }>;
  } | null;
  logs?: string;
  error?: string;
};

export async function submitBacktestJob(payload: BacktestJobSubmitPayload): Promise<BacktestJobStatus> {
  const { data } = await api.post<BacktestJobStatus>("/backtests", payload);
  return data;
}

export async function fetchBacktestJobStatus(runId: string): Promise<BacktestJobStatus> {
  const { data } = await api.get<BacktestJobStatus>(`/backtests/${encodeURIComponent(runId)}/status`);
  return data;
}

export async function fetchBacktestJobResult(runId: string): Promise<BacktestJobResult> {
  const { data } = await api.get<BacktestJobResult>(`/backtests/${encodeURIComponent(runId)}/result`);
  return data;
}

export async function createPaperPortfolio(payload: { name: string; initial_capital: number }): Promise<PaperPortfolio> {
  const { data } = await api.post<PaperPortfolio>("/paper/portfolios", payload);
  return data;
}

export async function fetchPaperPortfolios(): Promise<PaperPortfolio[]> {
  const { data } = await api.get<{ items: PaperPortfolio[] }>("/paper/portfolios");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function placePaperOrder(payload: {
  portfolio_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_type: "market" | "limit" | "sl";
  quantity: number;
  limit_price?: number;
  sl_price?: number;
  slippage_bps?: number;
  commission?: number;
}): Promise<{ id: string; status: string; symbol: string; fill_price?: number | null; fill_time?: string | null }> {
  const { data } = await api.post<{ id: string; status: string; symbol: string; fill_price?: number | null; fill_time?: string | null }>("/paper/orders", payload);
  return data;
}

export async function fetchPaperPositions(portfolioId: string): Promise<PaperPosition[]> {
  const { data } = await api.get<{ items: PaperPosition[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/positions`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperOrders(portfolioId: string): Promise<PaperOrder[]> {
  const { data } = await api.get<{ items: PaperOrder[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/orders`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperTrades(portfolioId: string): Promise<PaperTrade[]> {
  const { data } = await api.get<{ items: PaperTrade[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/trades`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperPerformance(portfolioId: string): Promise<PaperPerformance> {
  const { data } = await api.get<PaperPerformance>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/performance`);
  return data;
}

export async function deployBacktestToPaper(payload: {
  name: string;
  initial_capital: number;
  symbol: string;
  market: string;
  strategy: string;
  context?: Record<string, unknown>;
}): Promise<{ portfolio_id: string; status: string }> {
  const { data } = await api.post<{ portfolio_id: string; status: string }>("/paper/deploy-strategy", payload);
  return data;
}
