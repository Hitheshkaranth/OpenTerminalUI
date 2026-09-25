import { api } from "./base";
import type {
  MutualFund,
  MutualFundCompareResponse,
  MutualFundDetailsResponse,
  MutualFundNavHistoryResponse,
  MutualFundPerformance,
  MutualFundRanking,
  RollingReturnsResponse,
  SipCalcResponse,
  FundOverlapResponse,
  PortfolioMutualFundsResponse,
} from "../types";

export async function fetchMutualFunds(params?: { category?: string; search?: string; limit?: number }): Promise<MutualFund[]> {
  const { data } = await api.get<{ items: MutualFund[] }>("/mutual-funds/search", {
    params: { q: params?.search ?? "", category: params?.category },
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  return params?.limit ? items.slice(0, params.limit) : items;
}

export async function searchMutualFunds(q: string, category?: string): Promise<MutualFund[]> {
  return fetchMutualFunds({ search: q, category });
}

export async function fetchMutualFundDetails(schemeCode: number | string): Promise<MutualFundDetailsResponse> {
  const { data } = await api.get<MutualFundDetailsResponse>(`/mutual-funds/${encodeURIComponent(schemeCode)}`);
  return data;
}

export async function fetchMutualFundPerformance(schemeCode: number | string): Promise<MutualFundPerformance> {
  const { data } = await api.get<MutualFundPerformance>(`/mutual-funds/${encodeURIComponent(schemeCode)}/performance`);
  return data;
}

export async function fetchMutualFundNavHistory(schemeCode: number | string, days = 365): Promise<MutualFundNavHistoryResponse> {
  const { data } = await api.get<MutualFundNavHistoryResponse>(`/mutual-funds/${encodeURIComponent(schemeCode)}/nav-history`, {
    params: { days },
  });
  return data;
}

export async function compareMutualFunds(codes: number[] | string[], period = "1y"): Promise<MutualFundCompareResponse> {
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

export async function fetchMutualFundRankings(category: string): Promise<MutualFundRanking[]> {
  const { data } = await api.get<{ items: MutualFundRanking[] }>("/mutual-funds/rankings", {
    params: { category },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchMutualFundRollingReturns(schemeCode: number | string, window = 3): Promise<RollingReturnsResponse> {
  const { data } = await api.get<RollingReturnsResponse>(`/mutual-funds/${encodeURIComponent(schemeCode)}/rolling-returns`, {
    params: { window },
  });
  return data;
}

export async function calculateMutualFundSip(monthlyAmount: number, years: number, expectedReturn: number): Promise<SipCalcResponse> {
  const { data } = await api.get<SipCalcResponse>("/mutual-funds/sip-calc", {
    params: { monthly_amount: monthlyAmount, years, expected_return: expectedReturn },
  });
  return data;
}

export async function fetchMutualFundOverlap(codes: number[] | string[]): Promise<FundOverlapResponse> {
  const { data } = await api.get<FundOverlapResponse>("/mutual-funds/overlap", {
    params: { codes: codes.join(",") },
  });
  return data;
}

export async function addMutualFundHolding(payload: {
  scheme_code: string | number;
  scheme_name?: string;
  fund_house?: string;
  category?: string;
  avg_nav?: number;
  sip_transactions?: Array<Record<string, unknown>>;
  units: number;
  nav?: number;
  date?: string;
}): Promise<void> {
  await api.post("/mutual-funds/portfolio/add", payload);
}

export async function fetchMutualFundPortfolio(): Promise<PortfolioMutualFundsResponse> {
  const { data } = await api.get<PortfolioMutualFundsResponse>("/mutual-funds/portfolio");
  return data;
}

export async function deleteMutualFundHolding(holdingId: string | number): Promise<void> {
  await api.delete(`/mutual-funds/portfolio/${encodeURIComponent(holdingId)}`);
}
