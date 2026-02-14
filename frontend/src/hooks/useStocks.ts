import { useQuery } from "@tanstack/react-query";

import {
  fetchAnalystConsensus,
  fetchBulkDeals,
  fetchCorporateActions,
  fetchDcf,
  fetchEvents,
  fetchFundamentalScores,
  fetchMarketStatus,
  fetchPeers,
  fetchRelativeValuation,
  fetchShareholding,
  getFinancials,
  getHistory,
  getQuote,
  searchSymbols,
} from "../api/client";
import { useSettingsStore } from "../store/settingsStore";
import type {
  ChartResponse,
  DcfResponse,
  FinancialsResponse,
  FundamentalScoresResponse,
  PeerResponse,
  RelativeValuationResponse,
  StockSnapshot,
} from "../types";

export function useStock(ticker: string) {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  return useQuery<StockSnapshot>({
    queryKey: ["quote", selectedMarket, ticker],
    queryFn: () => getQuote(ticker, selectedMarket),
    enabled: Boolean(ticker),
    staleTime: 60 * 1000,
  });
}

export function useStockHistory(ticker: string, range = "1y", interval = "1d") {
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  return useQuery<ChartResponse>({
    queryKey: ["history", selectedMarket, ticker, range, interval],
    queryFn: () => getHistory(ticker, selectedMarket, interval, range),
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
    queryFn: () => searchSymbols(query, selectedMarket),
    enabled: query.length > 1,
    staleTime: 60 * 60 * 1000,
  });
}
