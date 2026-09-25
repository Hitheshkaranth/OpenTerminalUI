import { api } from "./base";

export type ConvictionCatalyst = {
  title?: string;
  description?: string;
  date?: string;
  expected_date?: string;
  impact?: "bullish" | "bearish" | "neutral" | string;
  confidence?: number;
  source?: string;
  [key: string]: unknown;
};

export type ConvictionResponse = {
  symbol: string;
  market?: string;
  bullish_score?: number;
  bearish_score?: number;
  conviction_score?: number;
  label?: "Bullish" | "Bearish" | "Neutral" | string;
  summary?: string;
  catalysts?: ConvictionCatalyst[];
  upcoming_catalysts?: ConvictionCatalyst[];
  updated_at?: string;
  [key: string]: unknown;
};

/** Returns null when no conviction record has been ingested for the symbol (backend 404) — a normal empty state. */
export async function fetchSecurityConviction(symbol: string): Promise<ConvictionResponse | null> {
  const normalized = symbol.trim().toUpperCase();
  const response = await api.get<ConvictionResponse>(`/stock-picking/conviction/${encodeURIComponent(normalized)}`, {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
  });
  return response.status === 404 ? null : response.data;
}

export async function ingestSecurityConviction(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await api.post<Record<string, unknown>>("/stock-picking/conviction/ingest", payload);
  return data;
}
