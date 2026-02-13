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

export async function fetchChart(ticker: string, interval = "1d", range = "1y"): Promise<ChartResponse> {
  const { data } = await api.get<ChartResponse>(`/chart/${ticker}`, { params: { interval, range } });
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

export async function fetchStock(ticker: string): Promise<StockSnapshot> {
  const { data } = await api.get<StockSnapshot>(`/stocks/${ticker}`);
  return data;
}

export async function fetchFinancials(ticker: string, period: "annual" | "quarterly"): Promise<FinancialsResponse> {
  const { data } = await api.get<FinancialsResponse>(`/stocks/${ticker}/financials`, { params: { period } });
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

export async function searchStocks(q: string): Promise<Array<{ ticker: string; name: string }>> {
  const { data } = await api.get<{ results: Array<{ ticker: string; name: string }> }>("/search", { params: { q } });
  return data.results;
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
