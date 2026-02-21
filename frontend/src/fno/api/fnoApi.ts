import axios from "axios";

import type {
  ChainSummary,
  GreeksChainResponse,
  IvSkewResponse,
  IvSurfaceResponse,
  OIAnalysis,
  OptionChainResponse,
  PCRByStrikePoint,
  PCRCurrentResponse,
  PCRHistoryPoint,
  StrategyLeg,
  StrategyPayoffResponse,
} from "../types/fno";

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
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
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
  const { data } = await api.get<PCRCurrentResponse>(`/fno/pcr/${encodeURIComponent(symbol.trim().toUpperCase())}`, {
    params: { expiry },
  });
  return data;
}

export async function fetchStrategyPayoff(
  legs: StrategyLeg[],
  spotRange?: [number, number],
): Promise<StrategyPayoffResponse> {
  const { data } = await api.post<StrategyPayoffResponse>("/fno/strategy/payoff", {
    legs,
    spot_range: spotRange ? [spotRange[0], spotRange[1]] : undefined,
  });
  return data;
}

export async function fetchStrategyPresets(): Promise<Record<string, unknown>> {
  const { data } = await api.get<{ presets: Record<string, unknown> }>("/fno/strategy/presets");
  return data?.presets ?? {};
}

export async function fetchStrategyFromPreset(payload: {
  preset: string;
  symbol: string;
  expiry?: string;
  strike_gap?: number;
}): Promise<StrategyPayoffResponse> {
  const { data } = await api.post<StrategyPayoffResponse>("/fno/strategy/from-preset", payload);
  return data;
}

export async function fetchPCRHistory(symbol: string, days = 30): Promise<PCRHistoryPoint[]> {
  const { data } = await api.get<{ symbol: string; days: number; items: PCRHistoryPoint[] }>(`/fno/pcr/${encodeURIComponent(symbol.trim().toUpperCase())}/history`, {
    params: { days },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchPCRByStrike(symbol: string, expiry?: string): Promise<PCRByStrikePoint[]> {
  const { data } = await api.get<{ symbol: string; expiry?: string; items: PCRByStrikePoint[] }>(`/fno/pcr/${encodeURIComponent(symbol.trim().toUpperCase())}/by-strike`, {
    params: { expiry },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchIV(symbol: string, expiry?: string): Promise<IvSkewResponse> {
  const { data } = await api.get<IvSkewResponse>(`/fno/iv/${encodeURIComponent(symbol.trim().toUpperCase())}`, { params: { expiry } });
  return data;
}

export async function fetchIVSurface(symbol: string): Promise<IvSurfaceResponse> {
  const { data } = await api.get<IvSurfaceResponse>(`/fno/iv/${encodeURIComponent(symbol.trim().toUpperCase())}/surface`);
  return data;
}

export async function fetchHeatmapOI(): Promise<Array<{ symbol: string; ce_oi_total: number; pe_oi_total: number; pcr_oi: number }>> {
  const { data } = await api.get<{ items: Array<{ symbol: string; ce_oi_total: number; pe_oi_total: number; pcr_oi: number }> }>("/fno/heatmap/oi");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchHeatmapIV(): Promise<Array<{ symbol: string; atm_iv: number; iv_rank: number }>> {
  const { data } = await api.get<{ items: Array<{ symbol: string; atm_iv: number; iv_rank: number }> }>("/fno/heatmap/iv");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchExpiryDashboard(): Promise<Array<{
  symbol: string;
  expiry_date: string;
  days_to_expiry: number;
  atm_iv: number;
  pcr: { pcr_oi: number; pcr_volume: number; pcr_oi_change: number; signal: string };
  max_pain: number;
  support_resistance: { support: number[]; resistance: number[] };
}>> {
  const { data } = await api.get<{
    items: Array<{
      symbol: string;
      expiry_date: string;
      days_to_expiry: number;
      atm_iv: number;
      pcr: { pcr_oi: number; pcr_volume: number; pcr_oi_change: number; signal: string };
      max_pain: number;
      support_resistance: { support: number[]; resistance: number[] };
    }>
  }>("/fno/expiry/dashboard");
  return Array.isArray(data?.items) ? data.items : [];
}
