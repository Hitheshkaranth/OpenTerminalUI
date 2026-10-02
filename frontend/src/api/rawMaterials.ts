import { api } from "./base";

export type LinkedCompany = {
  symbol: string | null;
  name: string;
  industry: string | null;
  relation: "input_cost" | "output_price";
  sensitivity: "high" | "medium" | "low";
  market: "IN" | "US";
  source: "curated" | "value_chain";
};

export type CommodityCompanies = {
  commodity_symbol: string;
  name: string;
  impact_note: string;
  companies: LinkedCompany[];
};

// Paths are relative to the api client's baseURL (/api).
export async function fetchCommodityCompanies(commoditySymbol: string): Promise<CommodityCompanies> {
  const { data } = await api.get<CommodityCompanies>(`/raw-materials/${encodeURIComponent(commoditySymbol)}/companies`);
  return data;
}
