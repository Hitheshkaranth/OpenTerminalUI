import { api, extractApiErrorMessage } from "./base";

// --- Shared / filings-rag types (see docs/FILINGS_INTELLIGENCE.md) ---
// Paths are relative to the api client's baseURL (/api). Extraction runs retrieval + an LLM pass
// over the filings and can take minutes, beyond the client's 30 s default.
const EXTRACT_TIMEOUT_MS = 300_000;

export type Citation = {
  doc_id: number;
  title: string;
  page_start: number;
  page_end: number;
  section: string | null;
  quote: string;
  source_url: string | null;
};

// --- Business metrics (agent D) ---
export type KpiCategory = "order_book" | "capacity" | "operational" | "customers" | "financial";
export type KpiPoint = { period: string; value: number; citation: Citation | null };
export type KpiSeries = {
  key: string;
  label: string;
  unit: string | null;
  category: KpiCategory;
  points: KpiPoint[];
};
export type MixDimension = "segment" | "geography" | "product" | "customer";
export type MixItem = { name: string; value: number | null; unit: string | null; share_pct: number | null };
export type MixSnapshot = {
  period: string;
  dimension: MixDimension;
  items: MixItem[];
  citation: Citation | null;
};
export type ShareSeries = {
  market: string;
  points: { period: string; share_pct: number; citation: Citation | null }[];
};
export type BusinessMetrics = {
  symbol: string;
  updated_at: string | null;
  engine: "llm" | "lexical" | null;
  kpis: KpiSeries[];
  revenue_mix: MixSnapshot[];
  market_share: ShareSeries[];
  warnings: string[];
};

// --- Value chain (agent E) ---
export type ChainRelation = "customer" | "supplier" | "competitor";
export type ChainOrigin = "filings" | "peers" | "curated";
export type ChainNode = {
  name: string;
  symbol: string | null;
  relation: ChainRelation;
  detail: string | null;
  share_pct: number | null;
  origin: ChainOrigin;
  citation: Citation | null;
};
export type RawMaterialOrigin = "filings" | "curated";
export type RawMaterial = {
  name: string;
  commodity_symbol: string | null;
  price: number | null;
  currency: string | null;
  change_1m_pct: number | null;
  change_1y_pct: number | null;
  cost_share_pct: number | null;
  origin: RawMaterialOrigin;
  citation: Citation | null;
};
export type ValueChain = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  customers: ChainNode[];
  suppliers: ChainNode[];
  competitors: ChainNode[];
  raw_materials: RawMaterial[];
  updated_at: string | null;
  warnings: string[];
};

// --- Reverse DCF (agent F) ---
export type ReverseDcfVerdict = "priced_for_perfection" | "demanding" | "reasonable" | "undemanding" | "not_meaningful";
export type ReverseDcfBasis = "fcf" | "net_income";
export type ReverseDcf = {
  symbol: string;
  currency: string | null;
  price: number | null;
  market_cap: number | null;
  net_debt: number | null;
  basis: ReverseDcfBasis;
  base_cash_flow: number | null;
  discount_rate: number;
  terminal_growth: number;
  years: number;
  implied_growth_pct: number | null;
  historical: {
    revenue_cagr_3y: number | null;
    revenue_cagr_5y: number | null;
    profit_cagr_3y: number | null;
    profit_cagr_5y: number | null;
  };
  verdict: ReverseDcfVerdict;
  sensitivity: {
    discount_rates: number[];
    terminal_growths: number[];
    implied_growth_pct: (number | null)[][];
  };
  notes: string[];
};

export type ReverseDcfParams = {
  discount_rate?: number;
  terminal_growth?: number;
  years?: number;
  basis?: ReverseDcfBasis;
};

export async function fetchBusinessMetrics(symbol: string): Promise<BusinessMetrics> {
  try {
    const { data } = await api.get<BusinessMetrics>(`/business/${encodeURIComponent(symbol)}/metrics`);
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to load business metrics"));
  }
}

export async function extractBusinessMetrics(
  symbol: string,
  payload: { use_llm?: boolean } = {},
): Promise<BusinessMetrics> {
  try {
    const { data } = await api.post<BusinessMetrics>(
      `/business/${encodeURIComponent(symbol)}/metrics/extract`,
      payload,
      { timeout: EXTRACT_TIMEOUT_MS },
    );
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to extract business metrics"));
  }
}

export async function fetchValueChain(symbol: string): Promise<ValueChain> {
  try {
    const { data } = await api.get<ValueChain>(`/value-chain/${encodeURIComponent(symbol)}`);
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to load value chain"));
  }
}

export async function extractValueChain(symbol: string, payload: { use_llm?: boolean } = {}): Promise<ValueChain> {
  try {
    const { data } = await api.post<ValueChain>(`/value-chain/${encodeURIComponent(symbol)}/extract`, payload, {
      timeout: EXTRACT_TIMEOUT_MS,
    });
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to extract value chain"));
  }
}

export async function fetchReverseDcf(symbol: string, params: ReverseDcfParams = {}): Promise<ReverseDcf> {
  const query: Record<string, number | string> = {};
  if (params.discount_rate != null) query.discount_rate = params.discount_rate;
  if (params.terminal_growth != null) query.terminal_growth = params.terminal_growth;
  if (params.years != null) query.years = params.years;
  if (params.basis) query.basis = params.basis;
  try {
    const { data } = await api.get<ReverseDcf>(`/valuation/${encodeURIComponent(symbol)}/reverse-dcf`, {
      params: query,
    });
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to load reverse DCF"));
  }
}