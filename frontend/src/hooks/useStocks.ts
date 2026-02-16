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
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const isCrypto = /-USD$/i.test(ticker || "");
  return useQuery<StockSnapshot>({
    queryKey: ["quote", selectedMarket, ticker, isCrypto ? "crypto" : "equity"],
    queryFn: () =>
      isCrypto
        ? Promise.resolve({
            ticker: ticker.toUpperCase(),
            symbol: ticker.toUpperCase(),
            company_name: `${ticker.toUpperCase()} Crypto`,
            exchange: "CRYPTO",
            country_code: "US",
            indices: [],
          } as StockSnapshot)
        : getQuote(ticker, selectedMarket),
    enabled: Boolean(ticker),
    staleTime: 60 * 1000,
    refetchInterval: (query) => (hasUsableSnapshot(query.state.data as StockSnapshot | undefined) ? false : 5000),
  });
}

export function useStockHistory(ticker: string, range = "1y", interval = "1d") {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const isCrypto = /-USD$/i.test(ticker || "");
  return useQuery<ChartResponse>({
    queryKey: ["history", selectedMarket, ticker, range, interval, isCrypto ? "crypto" : "equity"],
    queryFn: () => (isCrypto ? fetchCryptoCandles(ticker, interval, range) : getHistory(ticker, selectedMarket, interval, range)),
    enabled: Boolean(ticker),
    staleTime: 5 * 60 * 1000,
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
