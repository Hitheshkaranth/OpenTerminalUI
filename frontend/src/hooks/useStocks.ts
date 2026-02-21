import { useQuery } from "@tanstack/react-query";

import {
  fetchAnalystConsensus,
  fetchBulkDeals,
  fetchCapexTracker,
  fetchCryptoCandles,
  fetchTopBarTickers,
  fetchCorporateActions,
  fetchDcf,
  fetchDeliverySeries,
  fetchEquityPerformance,
  fetchPromoterHoldings,
  fetchEvents,
  fetchStockEvents,
  fetchUpcomingEvents,
  fetchDividendHistory,
  fetchPortfolioEvents,
  fetchEarningsCalendar,
  fetchNextEarnings,
  fetchQuarterlyEarningsFinancials,
  fetchEarningsAnalysis,
  fetchPortfolioEarnings,
  fetchFundamentalScores,
  fetchMarketStatus,
  fetchPeers,
  fetchRelativeValuation,
  fetchShareholdingPattern,
  fetchShareholding,
  fetchStockReturns,
  fetchCryptoSearch,
  getFinancials,
  getHistory,
  getQuote,
  searchSymbols,
} from "../api/client";
import { useSettingsStore } from "../store/settingsStore";
import { normalizeTicker } from "../utils/ticker";
import type {
  ChartResponse,
  DcfResponse,
  CapexTrackerResponse,
  TopBarTickersResponse,
  DeliverySeriesResponse,
  FinancialsResponse,
  FundamentalScoresResponse,
  PromoterHoldingsResponse,
  EquityPerformanceSnapshot,
  PeerResponse,
  RelativeValuationResponse,
  ShareholdingPatternResponse,
  StockSnapshot,
  CorporateEvent,
  EarningsDate,
  QuarterlyFinancial,
  EarningsAnalysis,
} from "../types";

function hasUsableSnapshot(data: StockSnapshot | undefined): boolean {
  if (!data) return false;
  const currentPrice =
    typeof data.current_price === "number"
      ? data.current_price
      : Number.isFinite(Number(data.current_price))
        ? Number(data.current_price)
        : null;
  return Boolean(data.company_name || data.sector || (currentPrice !== null && currentPrice > 0));
}

export function useStock(ticker: string) {
  const normalizedTicker = normalizeTicker(ticker);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const isCrypto = /-USD$/i.test(normalizedTicker || "");
  return useQuery<StockSnapshot>({
    queryKey: ["quote", selectedMarket, normalizedTicker, isCrypto ? "crypto" : "equity"],
    queryFn: () =>
      isCrypto
        ? Promise.resolve({
          ticker: normalizedTicker.toUpperCase(),
          symbol: normalizedTicker.toUpperCase(),
          company_name: `${normalizedTicker.toUpperCase()} Crypto`,
          exchange: "CRYPTO",
          country_code: "US",
          indices: [],
        } as StockSnapshot)
        : getQuote(normalizedTicker, selectedMarket),
    enabled: Boolean(normalizedTicker),
    staleTime: 60 * 1000,
    refetchInterval: (query) => (hasUsableSnapshot(query.state.data as StockSnapshot | undefined) ? false : 5000),
  });
}

export function useStockHistory(ticker: string, range = "1y", interval = "1d") {
  const normalizedTicker = normalizeTicker(ticker);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const isCrypto = /-USD$/i.test(normalizedTicker || "");
  return useQuery<ChartResponse>({
    queryKey: ["history", selectedMarket, normalizedTicker, range, interval, isCrypto ? "crypto" : "equity"],
    queryFn: () => (isCrypto ? fetchCryptoCandles(normalizedTicker, interval, range) : getHistory(normalizedTicker, selectedMarket, interval, range)),
    enabled: Boolean(normalizedTicker),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60 * 1000, // 1 minute realtime update interval
  });
}

export function useFinancials(ticker: string, period: "annual" | "quarterly" = "annual") {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  return useQuery<FinancialsResponse>({
    queryKey: ["financials", selectedMarket, ticker, period],
    queryFn: () => getFinancials(ticker, selectedMarket, period),
    enabled: Boolean(ticker),
  });
}

export function useScores(ticker: string) {
  return useQuery<FundamentalScoresResponse>({
    queryKey: ["scores", ticker],
    queryFn: () => fetchFundamentalScores(ticker),
    enabled: Boolean(ticker),
  });
}

export function usePeerComparison(ticker: string) {
  return useQuery<PeerResponse>({
    queryKey: ["peers", ticker],
    queryFn: () => fetchPeers(ticker),
    enabled: Boolean(ticker),
  });
}

export function useValuation(ticker: string) {
  return useQuery<RelativeValuationResponse>({
    queryKey: ["valuation", ticker],
    queryFn: () => fetchRelativeValuation(ticker),
    enabled: Boolean(ticker),
  });
}

export function useDCF(ticker: string) {
  return useQuery<DcfResponse>({
    queryKey: ["dcf", ticker],
    queryFn: () => fetchDcf(ticker),
    enabled: Boolean(ticker),
  });
}

export function useShareholding(ticker: string) {
  return useQuery({
    queryKey: ["shareholding", ticker],
    queryFn: () => fetchShareholding(ticker),
    enabled: Boolean(ticker),
  });
}

export function useCorporateActions(ticker: string) {
  return useQuery({
    queryKey: ["corporate-actions", ticker],
    queryFn: () => fetchCorporateActions(ticker),
    enabled: Boolean(ticker),
  });
}

export function useAnalystConsensus(ticker: string) {
  return useQuery({
    queryKey: ["analyst-consensus", ticker],
    queryFn: () => fetchAnalystConsensus(ticker),
    enabled: Boolean(ticker),
  });
}

export function useBulkDeals() {
  return useQuery({
    queryKey: ["bulk-deals"],
    queryFn: fetchBulkDeals,
  });
}

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: fetchEvents,
  });
}

export function useStockEvents(symbol: string, params?: { types?: string; from_date?: string; to_date?: string }) {
  return useQuery<CorporateEvent[]>({
    queryKey: ["stock-events", symbol, params?.types, params?.from_date, params?.to_date],
    queryFn: () => fetchStockEvents(symbol, params),
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpcomingEvents(symbol: string, days = 90) {
  return useQuery<CorporateEvent[]>({
    queryKey: ["upcoming-events", symbol, days],
    queryFn: () => fetchUpcomingEvents(symbol, days),
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDividendHistory(symbol: string) {
  return useQuery<CorporateEvent[]>({
    queryKey: ["dividend-history", symbol],
    queryFn: () => fetchDividendHistory(symbol),
    enabled: Boolean(symbol),
    staleTime: 10 * 60 * 1000,
  });
}

export function usePortfolioEvents(symbols: string[], days = 30) {
  return useQuery<CorporateEvent[]>({
    queryKey: ["portfolio-events", symbols.join(","), days],
    queryFn: () => fetchPortfolioEvents(symbols, days),
    enabled: symbols.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketStatus() {
  return useQuery({
    queryKey: ["market-status"],
    queryFn: fetchMarketStatus,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useSearch(query: string) {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  return useQuery({
    queryKey: ["search", selectedMarket, query],
    queryFn: async () => {
      const [equity, crypto] = await Promise.all([searchSymbols(query, selectedMarket), fetchCryptoSearch(query)]);
      return [...equity, ...crypto];
    },
    enabled: query.length > 1,
    staleTime: 60 * 60 * 1000,
  });
}

export function useStockReturns(ticker: string) {
  return useQuery<{ "1m"?: number | null; "3m"?: number | null; "1y"?: number | null }>({
    queryKey: ["returns", ticker],
    queryFn: () => fetchStockReturns(ticker),
    enabled: Boolean(ticker),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useEarningsCalendar(params?: { from_date?: string; to_date?: string; symbols?: string[] }) {
  return useQuery<EarningsDate[]>({
    queryKey: ["earnings-calendar", params?.from_date, params?.to_date, (params?.symbols || []).join(",")],
    queryFn: () => fetchEarningsCalendar(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useNextEarnings(symbol: string) {
  return useQuery<EarningsDate | null>({
    queryKey: ["next-earnings", symbol],
    queryFn: () => fetchNextEarnings(symbol),
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });
}

export function useQuarterlyEarningsFinancials(symbol: string, quarters = 12) {
  return useQuery<QuarterlyFinancial[]>({
    queryKey: ["earnings-financials", symbol, quarters],
    queryFn: () => fetchQuarterlyEarningsFinancials(symbol, quarters),
    enabled: Boolean(symbol),
    staleTime: 10 * 60 * 1000,
  });
}

export function useEarningsAnalysis(symbol: string) {
  return useQuery<EarningsAnalysis>({
    queryKey: ["earnings-analysis", symbol],
    queryFn: () => fetchEarningsAnalysis(symbol),
    enabled: Boolean(symbol),
    staleTime: 10 * 60 * 1000,
  });
}

export function usePortfolioEarnings(symbols: string[], days = 30) {
  return useQuery<EarningsDate[]>({
    queryKey: ["portfolio-earnings", symbols.join(","), days],
    queryFn: () => fetchPortfolioEarnings(symbols, days),
    enabled: symbols.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEquityPerformance(ticker: string) {
  return useQuery<EquityPerformanceSnapshot>({
    queryKey: ["equity-performance", ticker],
    queryFn: () => fetchEquityPerformance(ticker),
    enabled: Boolean(ticker),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePromoterHoldings(ticker: string) {
  return useQuery<PromoterHoldingsResponse>({
    queryKey: ["promoter-holdings-v1", ticker],
    queryFn: () => fetchPromoterHoldings(ticker),
    enabled: Boolean(ticker),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useShareholdingPattern(ticker: string, enabled = true) {
  return useQuery<ShareholdingPatternResponse>({
    queryKey: ["shareholding-pattern", ticker],
    queryFn: () => fetchShareholdingPattern(ticker),
    enabled: Boolean(ticker) && enabled,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useDeliverySeries(ticker: string, interval = "1d", range = "1y") {
  return useQuery<DeliverySeriesResponse>({
    queryKey: ["delivery-series", ticker, interval, range],
    queryFn: () => fetchDeliverySeries(ticker, interval, range),
    enabled: Boolean(ticker),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCapexTracker(ticker: string) {
  return useQuery<CapexTrackerResponse>({
    queryKey: ["capex-tracker", ticker],
    queryFn: () => fetchCapexTracker(ticker),
    enabled: Boolean(ticker),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useTopBarTickers() {
  return useQuery<TopBarTickersResponse>({
    queryKey: ["top-bar-tickers"],
    queryFn: fetchTopBarTickers,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
