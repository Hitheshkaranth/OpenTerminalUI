import axios from "axios";

import type {
  ChartResponse,
  DcfResponse,
  FinancialsResponse,
  FundamentalScoresResponse,
  IndicatorResponse,
  PortfolioResponse,
  PeerResponse,
  RelativeValuationResponse,
  ScreenerResponse,
  ScreenerRule,
  StockSnapshot,
  WatchlistItem,
  AlertRule,
} from "../types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

export async function getHistory(symbol: string, market: string, interval = "1d", range = "1y"): Promise<ChartResponse> {
  const { data } = await api.get<ChartResponse>(`/chart/${symbol}`, { params: { market, interval, range } });
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

export async function searchSymbols(q: string, market: string): Promise<Array<{ ticker: string; name: string }>> {
  const { data } = await api.get<{ results: Array<{ ticker: string; name: string }> }>("/search", { params: { q, market } });
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

export async function searchStocks(q: string, market = "NSE"): Promise<Array<{ ticker: string; name: string }>> {
  return searchSymbols(q, market);
}

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const { data } = await api.get<PortfolioResponse>("/portfolio");
  return data;
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

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const { data } = await api.get<{ items: WatchlistItem[] }>("/watchlists");
  return data.items;
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
  ticker: string;
  alert_type: string;
  condition: string;
  threshold: number;
  note: string;
}): Promise<void> {
  await api.post("/alerts", payload);
}

export async function deleteAlert(alertId: number): Promise<void> {
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

export async function fetchMarketStatus(): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>("/reports/market-status");
  return data;
}

export async function fetchStockReturns(ticker: string): Promise<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }> {
  const { data } = await api.get<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }>(`/stocks/${ticker}/returns`);
  return data ?? {};
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
    bars: number;
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
