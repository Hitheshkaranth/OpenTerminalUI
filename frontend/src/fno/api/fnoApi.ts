import axios from "axios";

import type { ChainSummary, GreeksChainResponse, OIAnalysis, OptionChainResponse } from "../types/fno";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

export async function fetchOptionChain(symbol: string, expiry?: string, range = 20): Promise<OptionChainResponse> {
  const { data } = await api.get<OptionChainResponse>(`/fno/chain/${encodeURIComponent(symbol.trim().toUpperCase())}`, {
    params: { expiry, range },
  });
  return data;
}

export async function fetchExpiries(symbol: string): Promise<string[]> {
  const { data } = await api.get<{ symbol: string; expiries: string[] }>(`/fno/chain/${encodeURIComponent(symbol.trim().toUpperCase())}/expiries`);
  return Array.isArray(data?.expiries) ? data.expiries : [];
}

export async function fetchChainSummary(symbol: string, expiry?: string): Promise<ChainSummary> {
  const { data } = await api.get<ChainSummary>(`/fno/chain/${encodeURIComponent(symbol.trim().toUpperCase())}/summary`, { params: { expiry } });
  return data;
}

export async function fetchGreeks(symbol: string, expiry?: string, range = 20): Promise<GreeksChainResponse> {
  const { data } = await api.get<GreeksChainResponse>(`/fno/greeks/${encodeURIComponent(symbol.trim().toUpperCase())}`, {
    params: { expiry, range },
  });
  return data;
}

export async function fetchOIAnalysis(symbol: string, expiry?: string, range = 20): Promise<OIAnalysis> {
  const { data } = await api.get<OIAnalysis>(`/fno/oi/${encodeURIComponent(symbol.trim().toUpperCase())}`, {
    params: { expiry, range },
  });
  return data;
}

export async function fetchPCR(symbol: string, expiry?: string): Promise<{ pcr_oi: number; pcr_vol: number; signal: string }> {
  const { data } = await api.get<{ pcr_oi: number; pcr_vol: number; signal: string }>(`/fno/pcr/${encodeURIComponent(symbol.trim().toUpperCase())}`, {
    params: { expiry },
  });
  return data;
}
