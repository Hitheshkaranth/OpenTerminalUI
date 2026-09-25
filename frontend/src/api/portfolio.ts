import { api } from "./base";
import type {
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
} from "../types";
import type {
  MultiPortfolio,
  MultiPortfolioHolding,
  MultiPortfolioAnalytics,
  CorrelationMatrixResponse,
  CorrelationRollingResponse,
  CorrelationClustersResponse,
} from "./types";

export async function fetchPortfolios(): Promise<MultiPortfolio[]> {
  const { data } = await api.get<{ items: MultiPortfolio[] }>("/portfolios");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createPortfolio(payload: { name: string; description?: string; benchmark_symbol?: string; currency?: string; starting_cash?: number }): Promise<{ id: string; name: string }> {
  const { data } = await api.post<{ id: string; name: string }>("/portfolios", payload);
  return data;
}

export async function fetchPortfolioById(portfolioId: string): Promise<MultiPortfolio> {
  const { data } = await api.get<MultiPortfolio>(`/portfolios/${encodeURIComponent(portfolioId)}`);
  return data;
}

export async function updatePortfolioById(portfolioId: string, payload: { name?: string; description?: string; benchmark_symbol?: string; currency?: string }): Promise<void> {
  await api.patch(`/portfolios/${encodeURIComponent(portfolioId)}`, payload);
}

export async function deletePortfolioById(portfolioId: string): Promise<void> {
  await api.delete(`/portfolios/${encodeURIComponent(portfolioId)}`);
}

export async function fetchPortfolioHoldings(portfolioId: string): Promise<MultiPortfolioHolding[]> {
  const { data } = await api.get<{ items: MultiPortfolioHolding[] }>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function addPortfolioHolding(portfolioId: string, payload: { symbol: string; shares: number; cost_basis_per_share: number; purchase_date: string; notes?: string; lot_id?: string }): Promise<{ id: string; symbol: string }> {
  const { data } = await api.post<{ id: string; symbol: string }>(`/portfolios/${encodeURIComponent(portfolioId)}/holdings`, payload);
  return data;
}

export async function addPortfolioTransaction(portfolioId: string, payload: { symbol: string; type: "buy" | "sell" | "dividend"; shares?: number; price?: number; date: string; fees?: number; lot_id?: string; notes?: string }): Promise<{ id: string; status: string }> {
  const { data } = await api.post<{ id: string; status: string }>(`/portfolios/${encodeURIComponent(portfolioId)}/transactions`, payload);
  return data;
}

export async function fetchPortfolioTransactions(portfolioId: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await api.get<{ items: Array<Record<string, unknown>> }>(`/portfolios/${encodeURIComponent(portfolioId)}/transactions`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPortfolioAnalyticsV2(portfolioId: string): Promise<MultiPortfolioAnalytics> {
  const { data } = await api.get<MultiPortfolioAnalytics>(`/portfolios/${encodeURIComponent(portfolioId)}/analytics`);
  return data;
}

export async function addHolding(payload: { ticker: string; quantity: number; avg_buy_price: number; buy_date: string }): Promise<void> {
  await api.post("/portfolio/holdings", payload);
}

export async function deleteHolding(holdingId: string | number): Promise<void> {
  await api.delete(`/portfolio/holdings/${holdingId}`);
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
  method?: string;
  specific_lot_ids?: number[];
}): Promise<TaxLotRealizationResponse> {
  const { data } = await api.post<TaxLotRealizationResponse>("/portfolio/tax-lots/realize", payload);
  return data;
}

export async function fetchPortfolioMutualFunds(): Promise<PortfolioMutualFundsResponse> {
  const { data } = await api.get<PortfolioMutualFundsResponse>("/mutual-funds/portfolio");
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

export async function fetchPaperPortfolio(): Promise<PaperPortfolio> {
  const { data } = await api.get<PaperPortfolio>("/paper/portfolio");
  return data;
}

export async function placePaperOrder(payload: {
  portfolio_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: string;
  price?: number;
  limit_price?: number;
  sl_price?: number;
}): Promise<PaperOrder> {
  const { data } = await api.post<PaperOrder>("/paper/orders", payload);
  return data;
}

export async function createPaperOrder(payload: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: string;
  price?: number;
  limit_price?: number;
}): Promise<PaperOrder> {
  const { data } = await api.post<PaperOrder>("/paper/orders", payload);
  return data;
}

export async function fetchPaperOrders(portfolioId: string): Promise<PaperOrder[]> {
  const { data } = await api.get<{ items: PaperOrder[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/orders`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function cancelPaperOrder(orderId: string): Promise<void> {
  await api.delete(`/paper/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchPaperTrades(portfolioId: string): Promise<PaperTrade[]> {
  const { data } = await api.get<{ items: PaperTrade[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/trades`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperPositions(portfolioId: string): Promise<PaperPosition[]> {
  const { data } = await api.get<{ items: PaperPosition[] }>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/positions`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPaperPerformance(portfolioId: string): Promise<PaperPerformance> {
  const { data } = await api.get<PaperPerformance>(`/paper/portfolios/${encodeURIComponent(portfolioId)}/performance`);
  return data;
}

export async function fetchCorrelationMatrix(payload: {
  symbols: string[];
  lookback_days?: number;
  period?: string;
  frequency?: string;
}): Promise<CorrelationMatrixResponse> {
  const { data } = await api.post<CorrelationMatrixResponse>("/correlation/matrix", payload);
  return data;
}

export async function fetchRollingCorrelation(payload: {
  symbols?: string[];
  target_symbol?: string;
  window?: number;
  lookback_days?: number;
  symbol1?: string;
  symbol2?: string;
  period?: string;
}): Promise<CorrelationRollingResponse> {
  const { data } = await api.post<CorrelationRollingResponse>("/correlation/rolling", payload);
  return data;
}

export async function fetchCorrelationClusters(payload: {
  symbols: string[];
  lookback_days?: number;
  period?: string;
  n_clusters?: number;
}): Promise<CorrelationClustersResponse> {
  const { data } = await api.post<CorrelationClustersResponse>("/correlation/clusters", payload);
  return data;
}
