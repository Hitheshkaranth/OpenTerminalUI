import axios from "axios";
import { fetchChartData } from "../services/chartDataService";

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
  DataVersion,
  PriceSeriesResponse,
  PitFundamentalsResponse,
  UniverseMembersResponse,
  RiskPortfolioResponse,
  OmsOrder,
  AuditEvent,
  KillSwitch,
  TaxLotSummary,
  TaxLotRealizationResponse,
  PluginManifestItem,
  ScheduledReport,
  PeerResponse,
  RelativeValuationResponse,
  ScreenerResponse,
  ScreenerFactorConfig,
  ScreenerV2Response,
  ScreenerRule,
  ScannerPreset,
  ScannerPresetPayload,
  ScannerResult,
  ScannerRun,
  ShareholdingPatternResponse,
  ScreenerPresetV3,
  ScreenerRunRequestV3,
  ScreenerRunResponseV3,
  StockSnapshot,
  UserScreenV3,
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
  YieldCurveResponse,
  SpreadHistoryResponse,
  EconomicEvent,
  MacroIndicatorsResponse,
  AIQueryResult,
  Watchlist,
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
  extended?: boolean,
): Promise<ChartResponse> {
  // Use unified OHLCV endpoint for normal chart loads/timeframe switches.
  // Keep legacy route for backfill pagination (`limit`/`cursor`).
  if (!limit && !cursor) {
    try {
      const unified = await fetchChartData(symbol, {
        market,
        interval,
        period: range,
        extended,
      });
      return {
        ticker: symbol.toUpperCase(),
        interval,
        currency: market.toUpperCase() === "NSE" || market.toUpperCase() === "BSE" ? "INR" : "USD",
        data: (Array.isArray(unified.data) ? unified.data : []).map((row) => ({
          t: Math.floor(Number(row.t) / 1000),
          o: Number(row.o),
          h: Number(row.h),
          l: Number(row.l),
          c: Number(row.c),
          v: Number(row.v ?? 0),
          s: row.s,
          ext: row.ext,
        })),
        meta: { warnings: [] },
      } as ChartResponse;
    } catch {
      // Fall back to legacy endpoint below.
    }
  }
  const { data } = await api.get<ChartResponse>(`/chart/${symbol}`, {
    params: { market, interval, range, limit, cursor, extended }
  });
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

export type SecurityHubOwnershipResponse = {
  ticker: string;
  shareholding?: Record<string, unknown>;
  institutional_holders?: Array<Record<string, unknown>>;
  insider_transactions?: Array<Record<string, unknown>>;
  source?: Record<string, unknown>;
};

export async function fetchSecurityHubOwnership(ticker: string, limit = 25): Promise<SecurityHubOwnershipResponse> {
  const { data } = await api.get<SecurityHubOwnershipResponse>(`/stocks/${encodeURIComponent(ticker)}/ownership`, {
    params: { limit },
  });
  return data;
}

export type SecurityHubEstimatesResponse = {
  ticker: string;
  analyst_estimates?: Array<Record<string, unknown>>;
  recommendation_trends?: Array<Record<string, unknown>>;
  price_target?: Record<string, unknown>;
  consensus?: unknown;
};

export async function fetchSecurityHubEstimates(ticker: string, limit = 24): Promise<SecurityHubEstimatesResponse> {
  const { data } = await api.get<SecurityHubEstimatesResponse>(`/stocks/${encodeURIComponent(ticker)}/estimates`, {
    params: { limit },
  });
  return data;
}

export type SecurityHubEsgResponse = {
  ticker: string;
  latest?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
  source?: string;
};

export async function fetchSecurityHubEsg(ticker: string, limit = 10): Promise<SecurityHubEsgResponse> {
  const { data } = await api.get<SecurityHubEsgResponse>(`/stocks/${encodeURIComponent(ticker)}/esg`, {
    params: { limit },
  });
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

export async function runScreenerV2(
  rules: ScreenerRule[],
  factors: ScreenerFactorConfig[],
  opts?: { limit?: number; sectorNeutral?: boolean; universe?: string }
): Promise<ScreenerV2Response> {
  const { data } = await api.post<ScreenerV2Response>("/screener/run-v2", {
    rules,
    factors,
    sort_order: "desc",
    limit: opts?.limit ?? 50,
    universe: opts?.universe ?? "nse_eq",
    sector_neutral: opts?.sectorNeutral ?? false,
  });
  return data;
}

export async function fetchScannerPresets(): Promise<ScannerPreset[]> {
  const { data } = await api.get<{ items: ScannerPreset[] }>("/v1/screener/presets");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createScannerPreset(payload: ScannerPresetPayload): Promise<ScannerPreset> {
  const { data } = await api.post<ScannerPreset>("/v1/screener/presets", payload);
  return data;
}

export async function updateScannerPreset(id: string, payload: ScannerPresetPayload): Promise<ScannerPreset> {
  const { data } = await api.put<ScannerPreset>(`/v1/screener/presets/${encodeURIComponent(id)}`, payload);
  return data;
}

export async function deleteScannerPreset(id: string): Promise<void> {
  await api.delete(`/v1/screener/presets/${encodeURIComponent(id)}`);
}

export async function runScanner(payload: { preset_id?: string; inline_preset?: ScannerPresetPayload; limit?: number; offset?: number }): Promise<{
  run_id: string;
  count: number;
  rows: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
}> {
  const { data } = await api.post("/v1/screener/run", payload, { timeout: 120000 });
  return data;
}

export async function fetchScannerRuns(limit = 20, offset = 0): Promise<ScannerRun[]> {
  const { data } = await api.get<{ items: ScannerRun[] }>("/v1/screener/runs", { params: { limit, offset } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchScannerResults(runId: string, limit = 100, offset = 0): Promise<ScannerResult[]> {
  const { data } = await api.get<{ items: ScannerResult[] }>("/v1/screener/results", { params: { run_id: runId, limit, offset } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createScannerAlertRule(payload: {
  preset_id?: string;
  symbol: string;
  setup_type: string;
  trigger_level: number;
  invalidation_level?: number;
  near_trigger_pct?: number;
  dedupe_minutes?: number;
  enabled?: boolean;
  meta_json?: Record<string, unknown>;
}): Promise<void> {
  await api.post("/v1/alerts/scanner-rules", payload);
}

export async function fetchScreenerPresetsV3(): Promise<ScreenerPresetV3[]> {
  const { data } = await api.get<{ items: ScreenerPresetV3[] }>("/screener/presets");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchScreenerPresetV3(id: string): Promise<ScreenerPresetV3> {
  const { data } = await api.get<ScreenerPresetV3>(`/screener/presets/${encodeURIComponent(id)}`);
  return data;
}

export async function runScreenerV3(payload: ScreenerRunRequestV3): Promise<ScreenerRunResponseV3> {
  const { data } = await api.post<ScreenerRunResponseV3>("/screener/run-revamped", payload, { timeout: 120000 });
  return data;
}

export async function fetchScreenerFieldsV3(): Promise<Array<Record<string, string>>> {
  const { data } = await api.get<{ items: Array<Record<string, string>> }>("/screener/fields");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchScreenerUniversesV3(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await api.get<{ items: Array<{ id: string; name: string }> }>("/screener/universes");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchSavedScreensV3(): Promise<UserScreenV3[]> {
  const { data } = await api.get<{ items: UserScreenV3[] }>("/screener/screens");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createSavedScreenV3(payload: {
  name: string;
  description?: string;
  query: string;
  columns_config?: string[];
  viz_config?: Record<string, unknown>;
  is_public?: boolean;
}): Promise<UserScreenV3> {
  const { data } = await api.post<UserScreenV3>("/screener/screens", payload);
  return data;
}

export async function updateSavedScreenV3(
  id: string,
  payload: {
    name: string;
    description?: string;
    query: string;
    columns_config?: string[];
    viz_config?: Record<string, unknown>;
    is_public?: boolean;
  },
): Promise<UserScreenV3> {
  const { data } = await api.put<UserScreenV3>(`/screener/screens/${encodeURIComponent(id)}`, payload);
  return data;
}

export async function deleteSavedScreenV3(id: string): Promise<void> {
  await api.delete(`/screener/screens/${encodeURIComponent(id)}`);
}

export async function fetchPublicScreensV3(limit = 50, offset = 0): Promise<UserScreenV3[]> {
  const { data } = await api.get<{ items: UserScreenV3[] }>("/screener/public", { params: { limit, offset } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function publishScreenV3(id: string): Promise<UserScreenV3> {
  const { data } = await api.post<UserScreenV3>(`/screener/screens/${encodeURIComponent(id)}/publish`);
  return data;
}

export async function forkPublicScreenV3(id: string): Promise<UserScreenV3> {
  const { data } = await api.post<UserScreenV3>(`/screener/screens/${encodeURIComponent(id)}/fork`);
  return data;
}

export async function exportScreenerV3(
  format: "csv" | "xlsx" | "pdf",
  payload: { rows: Array<Record<string, unknown>>; columns?: string[]; title?: string },
): Promise<Blob> {
  const { data } = await api.post(`/screener/export/${format}`, payload, { responseType: "blob" });
  return data as Blob;
}

export async function fetchActiveDataVersion(): Promise<DataVersion> {
  const { data } = await api.get<DataVersion>("/data/version/active");
  return data;
}

export async function createDataVersion(payload: {
  name: string;
  description?: string;
  source?: string;
  activate?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<DataVersion> {
  const { data } = await api.post<DataVersion>("/data/version", payload);
  return data;
}

export async function fetchPriceSeries(
  symbol: string,
  opts?: { adjusted?: boolean; start?: string; end?: string; data_version_id?: string },
): Promise<PriceSeriesResponse> {
  const { data } = await api.get<PriceSeriesResponse>(`/prices/${encodeURIComponent(symbol)}`, { params: opts });
  return data;
}

export async function fetchPitFundamentals(
  symbol: string,
  opts?: { as_of?: string; data_version_id?: string },
): Promise<PitFundamentalsResponse> {
  const { data } = await api.get<PitFundamentalsResponse>(`/fundamentals/${encodeURIComponent(symbol)}`, { params: opts });
  return data;
}

export async function fetchUniverseMembers(
  universeId: string,
  opts?: { as_of?: string; data_version_id?: string },
): Promise<UniverseMembersResponse> {
  const { data } = await api.get<UniverseMembersResponse>(`/universe/${encodeURIComponent(universeId)}`, { params: opts });
  return data;
}

export async function fetchPortfolioRisk(payload: {
  symbols?: string[];
  weights?: number[];
  confidence?: number;
  lookback_days?: number;
  portfolio_value?: number;
}): Promise<RiskPortfolioResponse> {
  const { data } = await api.post<RiskPortfolioResponse>("/risk/portfolio", payload);
  return data;
}

export async function fetchBacktestRisk(runId: string, confidence = 0.95): Promise<RiskPortfolioResponse> {
  const { data } = await api.post<RiskPortfolioResponse>(`/risk/backtest/${encodeURIComponent(runId)}?confidence=${confidence}`, {});
  return data;
}

export async function fetchRiskScenarios(): Promise<Array<Record<string, unknown>>> {
  const { data } = await api.get<{ items: Array<Record<string, unknown>> }>("/risk/scenarios");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createOmsOrder(payload: {
  symbol: string;
  side: "buy" | "sell" | "long" | "short";
  quantity: number;
  order_type?: string;
  limit_price?: number;
  max_position_notional?: number;
  max_adv_pct?: number;
  simulate_fill?: boolean;
}): Promise<{ order: OmsOrder; fill?: Record<string, unknown> | null }> {
  const { data } = await api.post<{ order: OmsOrder; fill?: Record<string, unknown> | null }>("/oms/order", payload);
  return data;
}

export async function fetchOmsOrders(status?: string): Promise<OmsOrder[]> {
  const { data } = await api.get<{ items: OmsOrder[] }>("/oms/orders", { params: status ? { status } : undefined });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function setRestrictedSymbol(payload: { symbol: string; reason?: string; active?: boolean }): Promise<Record<string, unknown>> {
  const { data } = await api.post<Record<string, unknown>>("/oms/restricted", payload);
  return data;
}

export async function fetchAuditEvents(eventType?: string): Promise<AuditEvent[]> {
  const { data } = await api.get<{ items: AuditEvent[] }>("/audit", { params: eventType ? { event_type: eventType } : undefined });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function registerGovernanceRun(payload: {
  run_id: string;
  data_version_id?: string;
  code_hash?: string;
  execution_profile?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { data } = await api.post<Record<string, unknown>>("/governance/runs/register", payload);
  return data;
}

export async function compareGovernanceRuns(runIds: string[]): Promise<Array<Record<string, unknown>>> {
  const { data } = await api.get<{ items: Array<Record<string, unknown>> }>("/governance/runs/compare", {
    params: { run_ids: runIds.join(",") },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function promoteGovernanceModel(payload: {
  registry_name: string;
  run_id: string;
  stage?: "staging" | "prod";
  metadata?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { data } = await api.post<Record<string, unknown>>("/governance/model-registry/promote", payload);
  return data;
}

export async function fetchFeedHealth(): Promise<Record<string, unknown>> {
  const { data } = await api.get<Record<string, unknown>>("/ops/feed-health");
  return data;
}

export async function fetchKillSwitches(): Promise<KillSwitch[]> {
  const { data } = await api.get<{ items: KillSwitch[] }>("/ops/kill-switch");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function setKillSwitch(payload: { scope?: string; enabled: boolean; reason?: string }): Promise<KillSwitch> {
  const { data } = await api.post<KillSwitch>("/ops/kill-switch", payload);
  return data;
}

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

export async function runScreenerScan(payload: ScreenerScanRequest): Promise<ScreenerScanResponse> {
  const { data } = await api.post<ScreenerScanResponse>("/screener/scan", payload, { timeout: 120000 });
  return data;
}

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

export async function fetchOpsDataQuality(): Promise<OpsDataQualityReport> {
  const { data } = await api.get<OpsDataQualityReport>("/ops/data-quality");
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

export type ChartDrawingRecord = {
  id: string;
  symbol: string;
  tool_type: string;
  coordinates: Record<string, unknown>;
  style: Record<string, unknown>;
  created_at?: string;
};

export async function listChartDrawings(symbol: string): Promise<ChartDrawingRecord[]> {
  const { data } = await api.get<{ items: ChartDrawingRecord[] }>(`/chart-drawings/${encodeURIComponent(symbol)}`);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createChartDrawing(symbol: string, payload: { tool_type: string; coordinates: Record<string, unknown>; style?: Record<string, unknown> }): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>(`/chart-drawings/${encodeURIComponent(symbol)}`, payload);
  return data;
}

export async function updateChartDrawing(symbol: string, drawingId: string, payload: { coordinates?: Record<string, unknown>; style?: Record<string, unknown> }): Promise<void> {
  await api.put(`/chart-drawings/${encodeURIComponent(symbol)}/${encodeURIComponent(drawingId)}`, payload);
}

export async function deleteChartDrawing(symbol: string, drawingId: string): Promise<void> {
  await api.delete(`/chart-drawings/${encodeURIComponent(symbol)}/${encodeURIComponent(drawingId)}`);
}

export async function listChartTemplates(): Promise<Array<{ id: string; name: string; layout_config: Record<string, unknown> }>> {
  const { data } = await api.get<{ items: Array<{ id: string; name: string; layout_config: Record<string, unknown> }> }>("/chart-templates");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createChartTemplate(payload: { name: string; layout_config: Record<string, unknown> }): Promise<{ id: string; name: string }> {
  const { data } = await api.post<{ id: string; name: string }>("/chart-templates", payload);
  return data;
}

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
  bins: VolumeProfileBin[];
  poc_price: number | null;
  value_area_high: number | null;
  value_area_low: number | null;
};

export async function fetchVolumeProfile(symbol: string, opts?: { period?: string; bins?: number; market?: string }): Promise<VolumeProfileResponse> {
  const { data } = await api.get<VolumeProfileResponse>(`/charts/volume-profile/${encodeURIComponent(symbol)}`, {
    params: {
      period: opts?.period ?? "20d",
      bins: opts?.bins ?? 50,
      market: opts?.market ?? "NSE",
    },
  });
  return data;
}

export type ChartBatchSource = "batch" | "fallback";

export async function fetchChartsBatchWithMeta(
  items: Array<{ symbol: string; interval?: string; range?: string; market?: string; extended?: boolean }>,
): Promise<{ data: Record<string, ChartResponse>; source: ChartBatchSource }> {
  const normalized = items
    .map((item) => ({
      symbol: item.symbol.trim().toUpperCase(),
      interval: item.interval ?? "1d",
      range: item.range ?? "1y",
      market: (item.market ?? "NSE").trim().toUpperCase(),
      extended: !!item.extended,
    }))
    .filter((item) => Boolean(item.symbol));
  if (!normalized.length) return { data: {}, source: "batch" };

  try {
    const { data } = await api.post<Record<string, ChartResponse>>("/charts/batch", {
      tickers: normalized.map((item) => ({
        symbol: item.symbol,
        timeframe: item.interval,
        market: item.market,
        range: item.range,
        extended: item.extended,
      })),
    });
    if (data && typeof data === "object") {
      return { data, source: "batch" };
    }
  } catch {
    // Fallback to parallel legacy chart requests below.
  }

  const entries = await Promise.all(
    normalized.map(async (item) => {
      const res = await fetchChart(item.symbol, item.interval, item.range, item.market);
      const key = `${item.market}:${item.symbol}|${item.interval}|${item.range}|ext=${item.extended}`;
      return [key, res] as const;
    }),
  );
  return { data: Object.fromEntries(entries), source: "fallback" };
}

export async function fetchChartsBatch(
  items: Array<{ symbol: string; interval?: string; range?: string; market?: string }>,
): Promise<Record<string, ChartResponse>> {
  const result = await fetchChartsBatchWithMeta(items);
  return result.data;
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
  channels?: string[];
}): Promise<void> {
  await api.post("/alerts", payload);
}

export async function updateAlert(alertId: string, payload: { status?: string; cooldown_seconds?: number; parameters?: Record<string, unknown>; channels?: string[] }): Promise<void> {
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

export type CryptoMarketRow = {
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  volume_24h: number;
  market_cap: number;
  sector: string;
};

export type CryptoMoverRow = {
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  volume_24h: number;
  market_cap: number;
};

export type CryptoDominanceResponse = {
  btc_pct: number;
  eth_pct: number;
  others_pct: number;
  total_market_cap: number;
  ts: string;
};

export type CryptoIndexResponse = {
  index_name: string;
  top_n: number;
  component_count: number;
  index_value: number;
  change_24h: number;
  total_market_cap: number;
  ts: string;
};

export type CryptoSectorRow = {
  sector: string;
  change_24h: number;
  market_cap: number;
  components: Array<{ symbol: string; name: string; weight: number }>;
};

export async function fetchCryptoMarkets(limit = 50): Promise<CryptoMarketRow[]> {
  const { data } = await api.get<{ items: CryptoMarketRow[] }>("/v1/crypto/markets", { params: { limit } });
  return data.items || [];
}

export async function fetchCryptoMovers(metric: string, limit = 20): Promise<CryptoMoverRow[]> {
  const { data } = await api.get<{ items: CryptoMoverRow[] }>(`/v1/crypto/movers/${encodeURIComponent(metric)}`, { params: { limit } });
  return data.items || [];
}

export async function fetchCryptoDominance(): Promise<CryptoDominanceResponse> {
  const { data } = await api.get<CryptoDominanceResponse>("/v1/crypto/dominance");
  return data;
}

export async function fetchCryptoIndex(topN = 10): Promise<CryptoIndexResponse> {
  const { data } = await api.get<CryptoIndexResponse>("/v1/crypto/index", { params: { top_n: topN } });
  return data;
}

export async function fetchCryptoSectors(): Promise<CryptoSectorRow[]> {
  const { data } = await api.get<{ items: CryptoSectorRow[] }>("/v1/crypto/sectors");
  return data.items || [];
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

export type MarketSentimentSummary = {
  period_days: number;
  market: string;
  sectors: Array<{
    sector: string;
    articles_count: number;
    avg_sentiment: number;
    bullish_count: number;
    bearish_count: number;
    neutral_count: number;
  }>;
};

export type NewsSentimentMarketSummary = {
  period_days: number;
  total_articles: number;
  average_score: number;
  overall_label: string;
  distribution: {
    bullish_pct: number;
    bearish_pct: number;
    neutral_pct: number;
  };
  top_sources: Array<{ source: string; count: number }>;
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

export async function fetchNewsByTicker(ticker: string, limit = 100, market?: string): Promise<NewsLatestApiItem[]> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return [];
  const { data } = await api.get<{ items: NewsLatestApiItem[] }>(`/news/by-ticker/${encodeURIComponent(symbol)}`, { params: { limit, market } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchNewsSentiment(ticker: string, days = 7, market?: string): Promise<NewsSentimentSummary> {
  const symbol = ticker.trim().toUpperCase();
  const { data } = await api.get<NewsSentimentSummary>(`/news/sentiment/${encodeURIComponent(symbol)}`, { params: { days, market } });
  return data;
}

export async function fetchMarketSentiment(days = 7, market?: string): Promise<MarketSentimentSummary> {
  const { data } = await api.get<MarketSentimentSummary>("/news/sentiment/market", { params: { days, market } });
  return data;
}

export async function fetchNewsSentimentSummary(days = 7, limit = 200): Promise<NewsSentimentMarketSummary> {
  const { data } = await api.get<NewsSentimentMarketSummary>("/news/sentiment/summary", { params: { days, limit } });
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
  timeframe?: string;
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
    trades_per_day?: number;
    average_hold_time_minutes?: number;
    max_intraday_drawdown?: number;
    win_rate_morning?: number;
    win_rate_afternoon?: number;
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

export async function submitBacktestV1(payload: BacktestJobSubmitPayload): Promise<BacktestJobStatus> {
  const { data } = await api.post<BacktestJobStatus>("/v1/backtest/submit", payload);
  return data;
}

export async function fetchBacktestV1Status(runId: string): Promise<BacktestJobStatus> {
  const { data } = await api.get<BacktestJobStatus>(`/v1/backtest/status/${encodeURIComponent(runId)}`);
  return data;
}

export async function fetchBacktestV1Result(runId: string): Promise<BacktestJobResult> {
  const { data } = await api.get<BacktestJobResult>(`/v1/backtest/result/${encodeURIComponent(runId)}`);
  return data;
}

export async function fetchBacktestV1Presets(): Promise<Array<Record<string, unknown>>> {
  const { data } = await api.get<{ items: Array<Record<string, unknown>> }>("/v1/backtest/presets");
  return Array.isArray(data?.items) ? data.items : [];
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

export async function fetchYieldCurve(): Promise<YieldCurveResponse> {
  const { data } = await api.get<YieldCurveResponse>("/fixed-income/yield-curve");
  return data;
}

export async function fetchHistoricalYieldCurve(date: string): Promise<YieldCurveResponse> {
  const { data } = await api.get<YieldCurveResponse>("/fixed-income/yield-curve/historical", { params: { date } });
  return data;
}

export async function fetch2s10sHistory(): Promise<SpreadHistoryResponse> {
  const { data } = await api.get<SpreadHistoryResponse>("/fixed-income/2s10s-spread-history");
  return data;
}

export async function fetchEconomicCalendar(from: string, to: string): Promise<EconomicEvent[]> {
  const { data } = await api.get<EconomicEvent[]>("/economics/calendar", { params: { from, to } });
  return data;
}

export async function fetchMacroIndicators(): Promise<MacroIndicatorsResponse> {
  const { data } = await api.get<MacroIndicatorsResponse>("/economics/indicators");
  return data;
}

export async function aiQuery(query: string, context: Record<string, any>): Promise<AIQueryResult> {
  const { data } = await api.post<AIQueryResult>("/ai/query", { query, context });
  return data;
}

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const { data } = await api.get<Watchlist[]>("/watchlists");
  return data;
}

export async function createWatchlist(name: string): Promise<Watchlist> {
  const { data } = await api.post<Watchlist>("/watchlists", { name });
  return data;
}

export async function updateWatchlist(id: string, payload: { name?: string; symbols?: string[]; column_config?: any }): Promise<Watchlist> {
  const { data } = await api.put<Watchlist>(`/watchlists/${id}`, payload);
  return data;
}

export async function deleteWatchlist(id: string): Promise<void> {
  await api.delete(`/watchlists/${id}`);
}

export async function addWatchlistSymbols(id: string, symbols: string[]): Promise<Watchlist> {
  const { data } = await api.post<Watchlist>(`/watchlists/${id}/symbols`, symbols);
  return data;
}

export async function removeWatchlistSymbol(id: string, symbol: string): Promise<Watchlist> {
  const { data } = await api.delete<Watchlist>(`/watchlists/${id}/symbols/${symbol}`);
  return data;
}

export type SectorRotationData = {
  benchmark: string;
  timestamp: string;
  sectors: Array<{
    symbol: string;
    current: { date: string; x: number; y: number };
    trail: Array<{ date: string; x: number; y: number }>;
  }>;
};

export async function fetchSectorRotation(benchmark: string = "SPY"): Promise<SectorRotationData> {
  const { data } = await api.get<SectorRotationData>("/analytics/sector-rotation", { params: { benchmark } });
  return data;
}

export type ChartComparisonResponse = {
  dates: string[];
  series: Record<string, number[]>;
};

export async function fetchChartComparison(symbols: string[], period = "1y", interval = "1d"): Promise<ChartComparisonResponse> {
  const { data } = await api.get<ChartComparisonResponse>("/charts/compare", {
    params: { symbols: symbols.join(","), period, interval },
  });
  return data;
}

export async function generateAdvancedReport(type: "stock" | "portfolio" | "backtest", params: Record<string, any> = {}): Promise<Blob> {
  const { data } = await api.post<Blob>("/reports/generate", { type, params }, { responseType: "blob" });
  return data;
}
