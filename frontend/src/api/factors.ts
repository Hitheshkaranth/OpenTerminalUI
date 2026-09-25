import { api } from "./base";

export type FactorMarket = "US" | "India";

export type FactorScores = {
  value?: number;
  momentum?: number;
  quality?: number;
  low_vol?: number;
  composite?: number;
};

/** Raw backend factor scores: sector-neutral z-scores plus composite percentile/rank. */
export type BackendFactorScores = {
  value?: number;
  momentum?: number;
  quality?: number;
  low_volatility?: number;
  composite?: number;
  percentile?: number;
  rank?: number;
};

export type StockIdea = {
  symbol: string;
  name?: string;
  market?: string;
  sector?: string;
  rank?: number;
  composite_score?: number;
  percentile?: number;
  company_name?: string;
  scores?: BackendFactorScores;
  factors?: FactorScores;
  chips?: string[];
  why_ranked?: string[];
};

export type FactorIdeaResponse = {
  items?: StockIdea[];
  ideas?: StockIdea[];
  rows?: StockIdea[];
};

export type SymbolFactorResponse = {
  symbol: string;
  market?: string;
  sector?: string;
  company_name?: string;
  scores?: BackendFactorScores;
  factors?: FactorScores;
  chips?: string[];
  why_ranked?: string[];
};

export async function fetchStockIdeas(params: {
  market: FactorMarket;
  sector?: string;
  quintile?: number;
  limit?: number;
}): Promise<StockIdea[]> {
  const { data } = await api.get<FactorIdeaResponse | StockIdea[]>("/stock-picking/ideas", {
    params: {
      market: params.market,
      sector: params.sector || undefined,
      quintile: params.quintile ?? 5,
      limit: params.limit ?? 50,
    },
  });
  if (Array.isArray(data)) return data;
  return data.items || data.ideas || data.rows || [];
}

export async function fetchSymbolFactors(symbol: string, market: FactorMarket): Promise<SymbolFactorResponse> {
  const { data } = await api.get<SymbolFactorResponse>(`/stock-picking/factors/${encodeURIComponent(symbol)}`, {
    params: { market },
  });
  return data;
}
