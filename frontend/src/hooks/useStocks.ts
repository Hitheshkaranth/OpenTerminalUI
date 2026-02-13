import { useQuery } from "@tanstack/react-query";

import {
  fetchAnalystConsensus,
  fetchBulkDeals,
  fetchChart,
  fetchCorporateActions,
  fetchDcf,
  fetchEvents,
  fetchFinancials,
  fetchFundamentalScores,
  fetchMarketStatus,
  fetchPeers,
  fetchRelativeValuation,
  fetchShareholding,
  fetchStock,
  searchStocks,
} from "../api/client";
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
  return useQuery<StockSnapshot>({
    queryKey: ["stock", ticker],
    queryFn: () => fetchStock(ticker),
    enabled: Boolean(ticker),
    staleTime: 60 * 1000,
  });
}

export function useStockHistory(ticker: string, range = "1y", interval = "1d") {
  return useQuery<ChartResponse>({
    queryKey: ["chart", ticker, range, interval],
    queryFn: () => fetchChart(ticker, interval, range),
    enabled: Boolean(ticker),
    staleTime: 5 * 60 * 1000,
  });
}

export function useFinancials(ticker: string, period: "annual" | "quarterly" = "annual") {
  return useQuery<FinancialsResponse>({
    queryKey: ["financials", ticker, period],
    queryFn: () => fetchFinancials(ticker, period),
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
    refetchInterval: 60 * 1000,
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => searchStocks(query),
    enabled: query.length > 1,
    staleTime: 60 * 60 * 1000,
  });
}
