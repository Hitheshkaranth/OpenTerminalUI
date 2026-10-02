import { api } from "./base";

export type Scorecard = {
  label: "strong" | "steady" | "weak" | "mixed" | "insufficient_data";
  reasons: string[];
};

export type ResultsQuarter = {
  period: string;
  period_end: string | null;
  revenue: number | null;
  ebitda: number | null;
  net_income: number | null;
  eps: number | null;
  ebitda_margin_pct: number | null;
  net_margin_pct: number | null;
  revenue_yoy_pct: number | null;
  revenue_qoq_pct: number | null;
  profit_yoy_pct: number | null;
  profit_qoq_pct: number | null;
  eps_estimate: number | null;
  eps_surprise_pct: number | null;
};

export type ResultsHistory = {
  symbol: string;
  currency: string | null;
  quarters: ResultsQuarter[];
  scorecard: Scorecard;
  warnings: string[];
};

export type ResultsRow = {
  symbol: string;
  name: string | null;
  period: string;
  announced_at: string | null;
  revenue_yoy_pct: number | null;
  profit_yoy_pct: number | null;
  eps_surprise_pct: number | null;
  scorecard: string;
};

export type LatestResponse = {
  market: string;
  items: ResultsRow[];
  warnings: string[];
};

export async function fetchResultsHistory(
  symbol: string,
  quarters = 8,
): Promise<ResultsHistory> {
  const { data } = await api.get<ResultsHistory>(
    `/results/${encodeURIComponent(symbol)}`,
    { params: { quarters } },
  );
  return data;
}

export async function fetchLatestResults(
  market: string,
  limit = 50,
): Promise<LatestResponse> {
  const { data } = await api.get<LatestResponse>("/results/latest", {
    params: { market, limit },
  });
  return data;
}