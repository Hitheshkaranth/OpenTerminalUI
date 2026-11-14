import { api } from "./base";
import type {
  FuturesChainContract,
} from "./types";

export async function fetchFuturesUnderlyings(q: string, limit = 25): Promise<string[]> {
  const { data } = await api.get<{ count: number; items: string[] }>("/futures/underlyings", { params: { q, limit } });
  return Array.isArray(data?.items) ? data.items : [];
}

export type FuturesChainResponse = {
  source?: string;
  as_of?: string | null;
  data_status?: string;
  underlying: string;
  count: number;
  ws_symbols: string[];
  token_to_ws_symbol: Record<string, string>;
  contracts: FuturesChainContract[];
};

export async function fetchFuturesChain(underlying: string): Promise<FuturesChainResponse> {
  const { data } = await api.get<FuturesChainResponse>(`/futures/chain/${encodeURIComponent(underlying)}`);
  return data;
}
